// Business logic that mirrors WINTERTUIN_FINANCES.xlsx. Pure functions, no DOM, no database.
//
// Excel month tab                       here
//   Food COGS  = begin + food purch - end   monthKpis().foodCogs
//   Bev COGS   = begin + bev purch - end    monthKpis().bevCogs
//   Food cost % = food COGS / food revenue
//   Bev cost %  = bev COGS / bev revenue
//   Total cost of sales % = (food + bev COGS) / total revenue
//   Labor %     = labor / total revenue
//   Prime %     = (food + bev COGS + labor) / total revenue
//   Avg spend   = revenue / covers;  food cost per cover = food COGS / covers
// Traffic light: on or under target = green, up to 15% over = amber, more = red.

// ------------------------------------------------------------------ seasons
// Seasons follow the clock change: summer from the last Sunday of March,
// winter from the last Sunday of October.
function lastSunday(year, month) { // month 1-12
  const d = new Date(Date.UTC(year, month, 0)); // last day of month
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
export function seasonOf(iso) {
  const y = Number(iso.slice(0, 4));
  return iso >= lastSunday(y, 3) && iso < lastSunday(y, 10) ? 'summer' : 'winter';
}
export function seasonStart(iso) { // first day of the season this date is in
  const y = Number(iso.slice(0, 4));
  if (seasonOf(iso) === 'summer') return lastSunday(y, 3);
  return iso >= lastSunday(y, 10) ? lastSunday(y, 10) : lastSunday(y - 1, 10);
}
export const monthSeason = (y, m) => seasonOf(`${y}-${String(m).padStart(2, '0')}-15`);

// ------------------------------------------------------------------ opening days
export function isoWeekday(iso) { const d = new Date(iso + 'T12:00:00'); return ((d.getDay() + 6) % 7) + 1; }
export function isOpen(iso, meta) {
  const ex = (meta.closures || []).find((c) => c.day === iso);
  if (ex) return !!ex.is_open;
  const oh = (meta.openingHours || []).find((o) => o.season === seasonOf(iso) && o.weekday === isoWeekday(iso));
  return !!(oh && oh.is_open);
}
export function closureNote(iso, meta) {
  const ex = (meta.closures || []).find((c) => c.day === iso);
  return ex ? ex.note || '' : '';
}
// complete | draft | missing | closed | future | today
// worked: optional Set of days on which someone was rostered or clocked in (team app).
// With it, a past day is only "missing" when people worked; an open day without anyone working
// counts as quiet (not opened). Without it (roster not reachable) the opening hours decide.
export function dayStatus(iso, row, meta, today, worked) {
  if (row && row.status === 'complete') return 'complete';
  if (row && row.status === 'draft') return 'draft';
  const open = isOpen(iso, meta);
  if (iso > today) return open ? 'future' : 'closed';
  if (iso === today) return open || (worked && worked.has(iso)) ? 'today' : 'closed';
  if (worked) return worked.has(iso) ? 'missing' : open ? 'quiet' : 'closed';
  return open ? 'missing' : 'closed';
}
export function openDaysInMonth(y, m, meta) {
  let n = 0;
  const days = new Date(y, m, 0).getDate();
  for (let d = 1; d <= days; d++) if (isOpen(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, meta)) n++;
  return n;
}

// ------------------------------------------------------------------ aggregation
const KEYS = ['covers', 'rev_food', 'rev_beverage', 'rev_other', 'rev_vat', 'pur_food', 'pur_beverage', 'pur_non_food',
  'pur_cleaning', 'pur_small_inventory', 'pur_vat', 'hours_staff', 'hours_partner', 'labor_staff', 'labor_partner'];

export function sumDays(rows) {
  const s = Object.fromEntries(KEYS.map((k) => [k, 0]));
  s.byStream = {}; s.bySupplier = {}; s.days = 0; s.complete = 0;
  for (const r of rows) {
    s.days++; if (r.status === 'complete') s.complete++;
    for (const k of KEYS) s[k] += Number(r[k]) || 0;
    for (const [id, v] of Object.entries(r.revenue_by_stream || {})) s.byStream[id] = (s.byStream[id] || 0) + Number(v);
    for (const [id, v] of Object.entries(r.purchases_by_supplier || {})) s.bySupplier[id] = (s.bySupplier[id] || 0) + Number(v);
  }
  s.revenue = s.rev_food + s.rev_beverage + s.rev_other;
  s.purchases = s.pur_food + s.pur_beverage + s.pur_non_food + s.pur_cleaning + s.pur_small_inventory;
  s.nonfood = s.pur_non_food + s.pur_cleaning + s.pur_small_inventory; // same as the Excel budget line (J+K+L)
  return s;
}

const div = (a, b) => (b ? a / b : null);

// inv = { food_begin, bev_begin, food_end, bev_end } (blank counts as 0, as in the Excel)
export function monthKpis(s, inv = {}) {
  const n = (v) => Number(v) || 0;
  const foodCogs = n(inv.food_begin) + s.pur_food - n(inv.food_end);
  const bevCogs = n(inv.bev_begin) + s.pur_beverage - n(inv.bev_end);
  const laborAll = s.labor_staff + s.labor_partner;
  return {
    covers: s.covers,
    revenue: s.revenue,
    foodRevenue: s.rev_food,
    bevRevenue: s.rev_beverage,
    foodCogs, bevCogs,
    foodCostPct: div(foodCogs, s.rev_food),
    bevCostPct: div(bevCogs, s.rev_beverage),
    costOfSalesPct: div(foodCogs + bevCogs, s.revenue),
    laborAll, laborStaff: s.labor_staff, laborPartner: s.labor_partner,
    laborPct: div(laborAll, s.revenue),
    laborPctStaff: div(s.labor_staff, s.revenue),
    primeCost: foodCogs + bevCogs + laborAll,
    primePct: div(foodCogs + bevCogs + laborAll, s.revenue),
    primePctStaff: div(foodCogs + bevCogs + s.labor_staff, s.revenue),
    avgSpend: div(s.revenue, s.covers),
    foodCostPerCover: div(foodCogs, s.covers),
    nonfood: s.nonfood,
    hoursStaff: s.hours_staff, hoursPartner: s.hours_partner,
    hasInventory: inv.food_begin != null || inv.food_end != null || inv.bev_begin != null || inv.bev_end != null,
  };
}

// Year to date, the way the Excel Cumulative tab does it: sum the months, then divide.
export function ytd(months) {
  const z = { covers: 0, revenue: 0, foodRevenue: 0, bevRevenue: 0, foodCogs: 0, bevCogs: 0, laborAll: 0, laborStaff: 0, nonfood: 0 };
  for (const k of months) for (const key of Object.keys(z)) z[key] += k[key] || 0;
  return {
    ...z,
    foodCostPct: div(z.foodCogs, z.foodRevenue),
    bevCostPct: div(z.bevCogs, z.bevRevenue),
    costOfSalesPct: div(z.foodCogs + z.bevCogs, z.revenue),
    laborPct: div(z.laborAll, z.revenue),
    laborPctStaff: div(z.laborStaff, z.revenue),
    primePct: div(z.foodCogs + z.bevCogs + z.laborAll, z.revenue),
    primePctStaff: div(z.foodCogs + z.bevCogs + z.laborStaff, z.revenue),
    avgSpend: div(z.revenue, z.covers),
    foodCostPerCover: div(z.foodCogs, z.covers),
  };
}

// ------------------------------------------------------------------ targets
export function targetFor(meta, metric, season) {
  const list = (meta && meta.targets) || [];
  const s = season && list.find((x) => x.metric === metric && x.season === season);
  const a = list.find((x) => x.metric === metric && x.season === 'all');
  const hit = s || a;
  return hit ? Number(hit.value) : null;
}
export function traffic(actual, target) {
  if (actual == null || target == null || !Number.isFinite(actual)) return '';
  if (actual <= target) return 'green';
  if (actual <= target * 1.15) return 'amber';
  return 'red';
}

// Revenue needed on an open day to cover fixed costs, given the variable cost ratio
// (cost of sales + labor as a share of revenue).
export function breakEvenPerDay(fixedMonth, openDays, variableRatio) {
  if (!openDays || variableRatio == null || variableRatio >= 1) return null;
  return fixedMonth / openDays / (1 - variableRatio);
}
