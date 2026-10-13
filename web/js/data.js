// Data layer: every call to Supabase goes through here.
// Security does not live here: Row Level Security and database functions enforce every rule.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Own storage key: the staff app runs on the same domain and the same Supabase project.
// A separate key keeps the two logins apart, so signing in here never signs you in there.
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wtfin-auth' },
});

export class ApiError extends Error {
  constructor(status, message) { super(message || `Error ${status}`); this.status = status; }
}

export function check(res) {
  if (res.error) {
    const e = res.error;
    const status = e.code === '42501' ? 403 : (res.status || 400);
    throw new ApiError(status, e.message || 'Request failed');
  }
  return res.data;
}

// ------------------------------------------------------------------ auth
export async function signIn(email, password) {
  check(await sb.auth.signInWithPassword({ email, password }));
}
export async function signOut() { await sb.auth.signOut(); }
export async function forgotPassword(email) {
  const redirectTo = `${location.origin}${location.pathname}`;
  check(await sb.auth.resetPasswordForEmail(email, { redirectTo }));
}
export async function setPassword(password) { check(await sb.auth.updateUser({ password })); }

// Who am I in the finance app? No active fin_app_users row = no access.
export async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new ApiError(401, 'Not signed in');
  const rows = check(await sb.from('fin_app_users')
    .select('id, role, full_name, language, organization_id, restaurant_id, active')
    .eq('user_id', session.user.id).eq('active', true));
  if (!rows.length) { await sb.auth.signOut(); throw new ApiError(403, 'no_access'); }
  const rank = { staff: 1, manager: 2, org_admin: 3, super_admin: 4 };
  rows.sort((a, b) => rank[b.role] - rank[a.role]);
  return { ...rows[0], user_id: session.user.id, email: session.user.email, rows };
}
export async function setLanguage(l) { check(await sb.rpc('fin_set_language', { p_lang: l })); }

// ------------------------------------------------------------------ generic table helpers
export async function list(table, { rest, order = 'sort_order', select = '*', eq = {}, gte, lte } = {}) {
  let q = sb.from(table).select(select);
  if (rest) q = q.eq('restaurant_id', rest);
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  if (gte) q = q.gte(gte[0], gte[1]);
  if (lte) q = q.lte(lte[0], lte[1]);
  if (order) for (const o of String(order).split(',')) q = q.order(o.trim());
  return check(await q);
}
export async function insert(table, row) { return check(await sb.from(table).insert(row).select().single()); }
export async function update(table, id, patch) { return check(await sb.from(table).update(patch).eq('id', id).select().single()); }
export async function remove(table, id) { check(await sb.from(table).delete().eq('id', id)); }
export async function upsert(table, row, onConflict) {
  return check(await sb.from(table).upsert(row, { onConflict }).select().single());
}

// ------------------------------------------------------------------ meta for one restaurant
export async function loadRestaurants() {
  return check(await sb.from('fin_restaurants').select('*').order('name'));
}

export async function loadMeta(restId, rank) {
  const [streams, categories, suppliers, staff, hours, closures, vat] = await Promise.all([
    list('fin_revenue_streams', { rest: restId }),
    list('fin_purchase_categories', { rest: restId }),
    list('fin_suppliers', { rest: restId, order: 'sort_order,name' }),
    list('fin_staff', { rest: restId, order: 'sort_order,name' }),
    list('fin_opening_hours', { rest: restId, order: 'season,weekday' }),
    list('fin_closures', { rest: restId, order: 'day' }),
    list('fin_vat_rates', { rest: restId }),
  ]);
  const meta = { streams, categories, suppliers, staff, openingHours: hours, closures, vat };
  if (rank >= 2) {
    const [targets, fixed, rates] = await Promise.all([
      list('fin_targets', { rest: restId, order: 'metric' }),
      list('fin_fixed_costs', { rest: restId }),
      list('fin_staff_rates', { rest: restId, order: 'valid_from' }),
    ]);
    Object.assign(meta, { targets, fixed, rates });
  }
  return meta;
}

// ------------------------------------------------------------------ days
export async function getDay(restId, day) {
  const d = check(await sb.from('fin_days').select('*').eq('restaurant_id', restId).eq('day', day).maybeSingle());
  if (!d) return { day: null, revenue: [], purchases: [], hours: [] };
  const [revenue, purchases, hours] = await Promise.all([
    list('fin_day_revenue', { eq: { day_id: d.id }, order: null }),
    list('fin_purchases', { eq: { day_id: d.id }, order: 'created_at' }),
    list('fin_hours', { eq: { day_id: d.id }, order: null }),
  ]);
  return { day: d, revenue, purchases, hours };
}

// Creates the day row on the first real input (just opening a day leaves no trace)
export async function ensureDay(rest, day) {
  const existing = check(await sb.from('fin_days').select('*').eq('restaurant_id', rest.id).eq('day', day).maybeSingle());
  if (existing) return existing;
  return check(await sb.from('fin_days').upsert({ restaurant_id: rest.id, organization_id: rest.organization_id, day },
    { onConflict: 'restaurant_id,day' }).select().single());
}

export async function daysInRange(restId, from, to) {
  return check(await sb.from('fin_days').select('day, status, covers').eq('restaurant_id', restId)
    .gte('day', from).lte('day', to));
}

export async function reportDays(restId, from, to) {
  return check(await sb.rpc('fin_report_days', { p_rest: restId, p_from: from, p_to: to }));
}

// ------------------------------------------------------------------ users (edge function)
export async function adminUsers(body) {
  const { data, error } = await sb.functions.invoke('fin-admin-users', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch { /* keep default */ }
    throw new ApiError(400, msg);
  }
  return data;
}

// ------------------------------------------------------------------ weather (Open-Meteo, free, no key)
// Fills fin_weather for days that are missing. Best effort: never blocks anything.
export async function ensureWeather(rest, from, to) {
  try {
    if (!rest || rest.latitude == null) return [];
    const today = new Date().toLocaleDateString('sv-SE');
    if (to > today) to = today;
    if (from > to) return list('fin_weather', { rest: rest.id, gte: ['day', from], lte: ['day', to], order: 'day' });
    const have = await list('fin_weather', { rest: rest.id, gte: ['day', from], lte: ['day', to], order: 'day' });
    const haveSet = new Set(have.filter((w) => w.day !== today).map((w) => w.day));
    const missing = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (!haveSet.has(d)) missing.push(d);
    if (!missing.length) return have;
    const start = missing[0]; const end = missing[missing.length - 1];
    const ageDays = (Date.parse(today) - Date.parse(start)) / 864e5;
    const base = ageDays > 85 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const url = `${base}?latitude=${rest.latitude}&longitude=${rest.longitude}&start_date=${start}&end_date=${end}` +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration,weather_code&timezone=Europe%2FAmsterdam';
    const res = await fetch(url);
    if (!res.ok) return have;
    const j = await res.json();
    const dl = j.daily || {};
    const rows = (dl.time || []).map((day, i) => ({
      restaurant_id: rest.id, organization_id: rest.organization_id, day,
      tmax: dl.temperature_2m_max[i], tmin: dl.temperature_2m_min[i], precip_mm: dl.precipitation_sum[i],
      sunshine_h: dl.sunshine_duration[i] == null ? null : Math.round(dl.sunshine_duration[i] / 360) / 10,
      weather_code: dl.weather_code[i], fetched_at: new Date().toISOString(),
    })).filter((r) => missing.includes(r.day) && r.tmax != null);
    if (rows.length) await sb.from('fin_weather').upsert(rows, { onConflict: 'restaurant_id,day' });
    return list('fin_weather', { rest: rest.id, gte: ['day', from], lte: ['day', to], order: 'day' });
  } catch (e) { console.warn('weather', e); return []; }
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}
