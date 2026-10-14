// Morning system check for both Wintertuin apps (team app and Finance share one Supabase project).
// Runs every morning from GitHub (.github/workflows/system-check.yml) and on request by a manager
// (Settings > System check in either app). Tests everything the apps depend on, lists the important
// changes of the last 24 hours and the gaps in the data, and stores the result in system_checks.
//   green = works   orange = works, but worth a look   red = broken (the morning job then fails and GitHub e-mails)
//
// Without a signed-in manager (the scheduled job) it runs at most once per 30 minutes; otherwise it
// returns the last result. Deployed with verify_jwt off; it checks the caller itself.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

type Status = "ok" | "warn" | "fail";
interface Check { key: string; status: Status; detail: string; ms?: number }

const TEAM_SITE = "https://joost1305.github.io/wintertuin-staff-app/";
const FIN_SITE = "https://joost1305.github.io/wintertuin-finance/";
const CHECK_EMAIL = "system-check@wintertuin.app";
const BAARN = { lat: 52.2128, lon: 5.2911 };
// 1x1 transparent PNG for the photo storage round trip
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const hoursAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3600000;
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });

async function timed(key: string, fn: () => Promise<{ status: Status; detail: string }>): Promise<Check> {
  const t = Date.now();
  try { return { key, ...(await fn()), ms: Date.now() - t }; } catch (e) { return { key, status: "fail", detail: String((e as Error).message || e).slice(0, 300), ms: Date.now() - t }; }
}

async function ghRuns(repo: string) {
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?branch=main&per_page=10`,
    { signal: AbortSignal.timeout(10000), headers: { accept: "application/vnd.github+json", "user-agent": "wintertuin-system-check" } });
  if (!res.ok) return null;
  return ((await res.json()).workflow_runs || []) as any[];
}

// Website online, and showing the newest published version
async function siteCheck(site: string, repo: string, deployName: RegExp, version: (html: string) => string, newest: (runs: any[] | null) => Promise<string | null>) {
  const res = await fetch(site, { signal: AbortSignal.timeout(15000), headers: { "cache-control": "no-cache" } });
  if (!res.ok) return { status: "fail" as Status, detail: `website answers HTTP ${res.status}` };
  const live = version(await res.text());
  let runs: any[] | null = null;
  try { runs = await ghRuns(repo); } catch { runs = null; }
  if (runs) {
    const done = runs.filter((r) => deployName.test(r.name || "") && r.status === "completed" && !["cancelled", "skipped"].includes(r.conclusion));
    if (done[0] && done[0].conclusion !== "success") return { status: "fail" as Status, detail: `online, but the last update failed to publish (${done[0].conclusion})` };
  }
  const want = await newest(runs).catch(() => null);
  if (want && live && !want.startsWith(live) && !live.startsWith(want)) return { status: "warn" as Status, detail: `online, but version ${live} is shown while ${want} was published` };
  return { status: "ok" as Status, detail: `online, newest version (${live || "?"})` };
}

async function isManager(sb: SupabaseClient, uid: string) {
  const [{ data: p }, { data: f }] = await Promise.all([
    sb.from("profiles").select("role, active").eq("id", uid).maybeSingle(),
    sb.from("fin_app_users").select("role").eq("user_id", uid).eq("active", true),
  ]);
  return (p && p.role === "manager" && p.active !== false) || (f || []).some((x: any) => ["manager", "org_admin", "super_admin"].includes(x.role));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Who is calling: a signed-in manager (manual), or nobody (the morning job)
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let trigger: "manual" | "schedule" = "schedule";
  if (token && token.split(".").length === 3) {
    const { data } = await sb.auth.getUser(token);
    if (data?.user) {
      if (!(await isManager(sb, data.user.id))) return json({ error: "Not allowed" }, 403);
      trigger = "manual";
    }
  }
  if (trigger === "schedule") {
    const { data: last } = await sb.from("system_checks").select("id, run_at, status, checks, gaps").order("run_at", { ascending: false }).limit(1).maybeSingle();
    if (last && hoursAgo(last.run_at) < 0.5) return json({ ok: true, data: { ...last, reused: true } });
  }

  const to = new Date();
  const from = new Date(to.getTime() - 24 * 3600000);
  const checks: Check[] = [];

  // 1. Database, and everything it prepares for this check
  let inputs: any = null;
  checks.push(await timed("database", async () => {
    const { data, error } = await sb.rpc("system_check_inputs", { p_from: from.toISOString(), p_to: to.toISOString() });
    if (error) throw new Error(error.message);
    inputs = data;
    return { status: "ok", detail: "reachable" };
  }));

  // 2 and 3. Both websites online and on the newest version
  checks.push(await timed("team_app", () => siteCheck(TEAM_SITE, "Joost1305/wintertuin-staff-app", /pages/i,
    (html) => (html.match(/js\/app\.js\?v=([^"']+)/) || [])[1] || "",
    async () => {
      const r = await fetch("https://raw.githubusercontent.com/Joost1305/wintertuin-staff-app/main/index.html", { signal: AbortSignal.timeout(10000) });
      return r.ok ? ((await r.text()).match(/js\/app\.js\?v=([^"']+)/) || [])[1] || null : null;
    })));
  checks.push(await timed("finance_app", () => siteCheck(FIN_SITE, "Joost1305/wintertuin-finance", /deploy web app|pages/i,
    (html) => (html.match(/js\/app\.js\?v=([0-9a-f]{7,40})/) || [])[1] || "",
    async (runs) => {
      const ok = (runs || []).find((r) => /deploy web app/i.test(r.name || "") && r.conclusion === "success");
      return ok ? String(ok.head_sha).slice(0, 8) : null;
    })));

  // 4. Signing in with a test account and reading data with normal rights
  checks.push(await timed("sign_in", async () => {
    const password = crypto.randomUUID() + "Aa1!";
    const { data: prof } = await sb.from("profiles").select("id").eq("email", CHECK_EMAIL).maybeSingle();
    let uid = prof?.id as string | undefined;
    if (!uid) {
      const { data, error } = await sb.auth.admin.createUser({ email: CHECK_EMAIL, password, email_confirm: true, user_metadata: { full_name: "System check (automatic)" } });
      if (error) return { status: "fail", detail: `test account could not be made: ${error.message}` };
      uid = data.user.id;
    } else {
      const { error } = await sb.auth.admin.updateUserById(uid, { password });
      if (error) return { status: "fail", detail: `test account could not be prepared: ${error.message}` };
    }
    // The test account never shows up in the roster and has no rights of its own
    await sb.from("profiles").update({ active: false, full_name: "System check (automatic)", role: "staff" }).eq("id", uid);
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await user.auth.signInWithPassword({ email: CHECK_EMAIL, password });
    if (error) return { status: "fail", detail: `signing in does not work: ${error.message}` };
    const [{ error: e1 }, { data: cal, error: e2 }] = await Promise.all([
      user.from("sops").select("id").limit(1),
      user.rpc("fin_public_calendar", { p_from: today(), p_to: today() }),
    ]);
    await user.auth.signOut();
    if (e1 || e2) return { status: "fail", detail: `signed in, but reading data failed: ${(e1 || e2)!.message}` };
    return { status: "ok", detail: `signing in works; SOPs and opening days readable (${cal && cal[0] && cal[0].is_open ? "open" : "closed"} today)` };
  }));

  // 5. Photo storage (menu photos): upload, read back, delete
  checks.push(await timed("photos", async () => {
    const path = `system-check/${to.toISOString().replace(/[:.]/g, "-")}.png`;
    const up = await sb.storage.from("menu-photos").upload(path, PNG, { contentType: "image/png", upsert: true });
    if (up.error) return { status: "fail", detail: `upload failed: ${up.error.message}` };
    try {
      const { data } = sb.storage.from("menu-photos").getPublicUrl(path);
      const got = await fetch(data.publicUrl, { signal: AbortSignal.timeout(10000) });
      if (!got.ok) return { status: "fail", detail: `uploaded, but reading it back gave HTTP ${got.status}` };
      await got.arrayBuffer();
      return { status: "ok", detail: "upload, read back and delete work" };
    } finally {
      await sb.storage.from("menu-photos").remove([path]);
    }
  }));

  // 6. The account functions (make users, reset passwords) answer and refuse strangers
  checks.push(await timed("functions", async () => {
    const out: string[] = []; let worst: Status = "ok";
    for (const fn of ["admin-users", "fin-admin-users"]) {
      const r = await fetch(`${url}/functions/v1/${fn}`, { method: "POST", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json" }, body: "{}" });
      await r.text();
      if (r.status === 401 || r.status === 403) out.push(`${fn} ok`);
      else if (r.status >= 500 || r.status === 404) { worst = "fail"; out.push(`${fn} HTTP ${r.status}`); }
      else { if (worst === "ok") worst = "warn"; out.push(`${fn} HTTP ${r.status}`); }
    }
    return { status: worst, detail: out.join(", ") };
  }));

  // 7. Weather service (Finance calendar and dashboard)
  checks.push(await timed("weather", async () => {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${BAARN.lat}&longitude=${BAARN.lon}&daily=temperature_2m_max&timezone=Europe%2FAmsterdam&forecast_days=1`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { status: "warn", detail: `weather service answers HTTP ${r.status}; the calendar shows no weather` };
    await r.json();
    return { status: "ok", detail: "weather service answers" };
  }));

  // 8. Events and the calendar agree: every confirmed event in the next 60 days has its day open
  checks.push(await timed("calendar_sync", async () => {
    const d0 = today(); const d1 = new Date(Date.now() + 60 * 864e5).toLocaleDateString("sv-SE");
    const [{ data: evs, error: e1 }, { data: rest }] = await Promise.all([
      sb.from("events").select("title, event_date").eq("status", "confirmed").gte("event_date", d0).lte("event_date", d1),
      sb.from("fin_restaurants").select("id").order("created_at").limit(1).maybeSingle(),
    ]);
    if (e1) throw new Error(e1.message);
    if (!evs || !evs.length) return { status: "ok", detail: "no confirmed events in the next 60 days" };
    const { data: cl } = await sb.from("fin_closures").select("day, is_open").eq("restaurant_id", rest?.id).in("day", evs.map((e: any) => e.event_date));
    const openDays = new Set((cl || []).filter((c: any) => c.is_open).map((c: any) => c.day));
    const wrong = evs.filter((e: any) => !openDays.has(e.event_date));
    return wrong.length
      ? { status: "warn", detail: `not open in the calendar: ${wrong.map((e: any) => `${e.title} (${e.event_date})`).join(", ")}` }
      : { status: "ok", detail: `${evs.length} confirmed event(s), all open in the calendar` };
  }));

  const gaps = inputs?.gaps || [];
  const status: Status = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") || gaps.length ? "warn" : "ok";
  const row = { trigger, status, checks, changes: inputs?.changes || [], gaps, window_from: from.toISOString(), window_to: to.toISOString() };
  const { data: saved, error } = await sb.from("system_checks").insert(row).select("id, run_at").single();
  if (error) checks.push({ key: "database", status: "fail", detail: `result could not be saved: ${error.message}` });
  await sb.from("system_checks").delete().lt("run_at", new Date(Date.now() - 180 * 864e5).toISOString());
  return json({ ok: true, data: { id: saved?.id, run_at: saved?.run_at, ...row, status: error ? "fail" : status } });
});
