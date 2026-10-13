// Wintertuin Finance: user management for org admins and super admins.
// Runs server-side with the service role key, so the browser never handles
// other people's passwords. Only touches fin_app_users and auth users.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const RANK: Record<string, number> = { staff: 1, manager: 2, org_admin: 3, super_admin: 4 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Who is calling?
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: caller, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller?.user) return json({ error: "Not signed in" }, 401);

    const body = await req.json();
    const orgId: string = body.organization_id;
    if (!orgId) return json({ error: "organization_id missing" }, 400);

    const { data: me } = await admin.from("fin_app_users").select("role, organization_id, active")
      .eq("user_id", caller.user.id).eq("active", true);
    const myRank = Math.max(0, ...(me || [])
      .filter((r) => r.role === "super_admin" || r.organization_id === orgId)
      .map((r) => RANK[r.role] || 0));
    if (myRank < 3) return json({ error: "Not allowed" }, 403);

    const canGive = (role: string) => RANK[role] && (RANK[role] < 4 || myRank === 4);
    // The table trigger logs the row change; this line records who did it.
    const audit = (action: string, rowId: string | null, details: Record<string, unknown>) =>
      admin.from("fin_audit_log").insert({
        organization_id: orgId, user_id: caller.user.id, table_name: "fin_app_users",
        row_id: rowId, action: "ADMIN_" + action, new_data: details,
      });

    switch (body.action) {
      case "list": {
        const { data: rows, error } = await admin.from("fin_app_users")
          .select("id, user_id, role, full_name, language, active, restaurant_id, created_at")
          .eq("organization_id", orgId).order("full_name");
        if (error) throw error;
        const out = [];
        for (const r of rows || []) {
          const { data: u } = await admin.auth.admin.getUserById(r.user_id);
          out.push({ ...r, email: u?.user?.email || "", last_sign_in_at: u?.user?.last_sign_in_at || null });
        }
        return json({ users: out });
      }

      case "create": {
        // Creates a login if the email is new, or gives an existing login (for example a staff app user) access.
        const email = String(body.email || "").trim().toLowerCase();
        const role = String(body.role || "staff");
        if (!email) return json({ error: "Email missing" }, 400);
        if (!canGive(role)) return json({ error: "Not allowed to give this role" }, 403);

        let userId: string | null = null;
        let password: string | null = null;
        let existing = false;
        // Look up existing user by email
        let page = 1;
        while (!userId) {
          const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
          if (error) throw error;
          const hit = list.users.find((u) => (u.email || "").toLowerCase() === email);
          if (hit) { userId = hit.id; existing = true; }
          if (list.users.length < 200) break;
          page++;
        }
        if (!userId) {
          password = body.password || randomPassword();
          const { data: created, error } = await admin.auth.admin.createUser({
            email, password, email_confirm: true, user_metadata: { full_name: body.full_name || email },
          });
          if (error) throw error;
          userId = created.user.id;
        }
        // Never overwrite a row the caller is not allowed to manage (for example a super admin)
        const { data: prev } = await admin.from("fin_app_users").select("role")
          .eq("user_id", userId).eq("organization_id", orgId).maybeSingle();
        if (prev && !canGive(prev.role)) return json({ error: "Not allowed" }, 403);
        const { error: insErr } = await admin.from("fin_app_users").upsert({
          user_id: userId, organization_id: orgId, role, full_name: body.full_name || email,
          language: body.language === "nl" ? "nl" : "en", active: true, restaurant_id: body.restaurant_id || null,
        }, { onConflict: "user_id,organization_id" });
        if (insErr) throw insErr;
        await audit("CREATE", userId, { email, role, existing });
        return json({ ok: true, existing, email, password });
      }

      case "update": {
        const { data: target } = await admin.from("fin_app_users").select("role, user_id")
          .eq("id", body.id).eq("organization_id", orgId).single();
        if (!target) return json({ error: "User not found" }, 404);
        if (!canGive(target.role)) return json({ error: "Not allowed" }, 403);
        if (target.user_id === caller.user.id && (body.active === false || (body.role && RANK[body.role] < myRank))) {
          return json({ error: "You cannot lock yourself out" }, 400);
        }
        const patch: Record<string, unknown> = {};
        if (body.role !== undefined) { if (!canGive(body.role)) return json({ error: "Not allowed to give this role" }, 403); patch.role = body.role; }
        if (body.active !== undefined) patch.active = !!body.active;
        if (body.full_name !== undefined) patch.full_name = body.full_name;
        if (body.language !== undefined) patch.language = body.language === "nl" ? "nl" : "en";
        const { error } = await admin.from("fin_app_users").update(patch).eq("id", body.id);
        if (error) throw error;
        await audit("UPDATE", body.id, patch);
        return json({ ok: true });
      }

      case "reset_password": {
        const { data: target } = await admin.from("fin_app_users").select("role, user_id")
          .eq("id", body.id).eq("organization_id", orgId).single();
        if (!target) return json({ error: "User not found" }, 404);
        if (!canGive(target.role)) return json({ error: "Not allowed" }, 403);
        const password = body.password || randomPassword();
        const { error } = await admin.auth.admin.updateUserById(target.user_id, { password });
        if (error) throw error;
        await audit("RESET_PASSWORD", body.id, {});
        return json({ ok: true, password });
      }

      case "remove": {
        // Removes finance access only. The login itself stays (it may be used by the staff app).
        const { data: target } = await admin.from("fin_app_users").select("role, user_id")
          .eq("id", body.id).eq("organization_id", orgId).single();
        if (!target) return json({ error: "User not found" }, 404);
        if (!canGive(target.role)) return json({ error: "Not allowed" }, 403);
        if (target.user_id === caller.user.id) return json({ error: "You cannot remove yourself" }, 400);
        const { error } = await admin.from("fin_app_users").delete().eq("id", body.id);
        if (error) throw error;
        await audit("REMOVE", body.id, {});
        return json({ ok: true });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
