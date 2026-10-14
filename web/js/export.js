// Excel exports (.xlsx), built in the browser with xlsx.js (no dependencies).
import { state, fmt } from './core.js';
import { t } from './i18n.js';
import { buildXlsx, downloadBlob } from './xlsx.js';

const money = (n) => (n == null || !Number.isFinite(Number(n)) ? null : { n: Number(n), fmt: 'money' });
const pct = (n) => (n == null || !Number.isFinite(n) ? null : { n, fmt: 'pct' });
const num = (n) => (n == null ? null : Number(n));
const fileName = (parts) => `${['wintertuin', ...parts].filter(Boolean).join('-').replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase()}.xlsx`;

// Month report: summary, per day, revenue per group, purchases per supplier
export function exportMonth({ y, m, k, s, rows, weather }) {
  const meta = state.meta;
  const wBy = Object.fromEntries((weather || []).map((w) => [w.day, w]));
  const summary = [[t('metric'), t('actual')],
    [t('step_covers'), num(k.covers)], [t('revenue_total'), money(k.revenue)], [t('rev_food'), money(k.foodRevenue)], [t('rev_bev'), money(k.bevRevenue)],
    [t('food_cogs'), money(k.foodCogs)], [t('bev_cogs'), money(k.bevCogs)], [t('food_cost_pct'), pct(k.foodCostPct)], [t('bev_cost_pct'), pct(k.bevCostPct)],
    [t('cost_of_sales_pct'), pct(k.costOfSalesPct)], [t('labor_total'), money(k.laborAll)], [t('labor_staff'), money(k.laborStaff)], [t('labor_partners'), money(k.laborPartner)],
    [t('labor_pct'), pct(k.laborPct)], [t('labor_pct_excl'), pct(k.laborPctStaff)], [t('prime_pct'), pct(k.primePct)], [t('prime_pct_excl'), pct(k.primePctStaff)],
    [t('avg_spend'), money(k.avgSpend)], [t('food_cost_cover'), money(k.foodCostPerCover)], [t('nonfood_budget'), money(k.nonfood)],
    [t('vat_on_revenue'), money(s.rev_vat)], [t('vat_on_purchases'), money(s.pur_vat)]];
  const perDay = [[t('date'), t('status'), t('step_covers'), t('rev_food'), t('rev_bev'), t('rev_other'), t('cat_food_all'), t('cat_beverage'), t('cat_nonfood_all'),
    t('hours'), t('labor_staff'), t('labor_partners'), t('weather') + ' °C', 'mm']]
    .concat(rows.map((r) => [{ date: r.day }, r.status, num(r.covers), money(r.rev_food), money(r.rev_beverage), money(r.rev_other), money(r.pur_food), money(r.pur_beverage),
      money(Number(r.pur_non_food) + Number(r.pur_cleaning) + Number(r.pur_small_inventory)), num(Number(r.hours_staff) + Number(r.hours_partner)),
      money(r.labor_staff), money(r.labor_partner), wBy[r.day] ? num(wBy[r.day].tmax) : null, wBy[r.day] ? num(wBy[r.day].precip_mm) : null]));
  const streams = [[t('stream'), t('vat'), t('excl_vat')]].concat(meta.streams.filter((x) => s.byStream[x.id] != null)
    .map((x) => [x.name_en, pct(Number(x.vat_rate)), money(s.byStream[x.id])]));
  const sups = [[t('supplier'), t('excl_vat')]].concat(Object.entries(s.bySupplier)
    .map(([id, v]) => [id === 'none' ? t('no_supplier') : (meta.suppliers.find((x) => x.id === id) || {}).name || '?', money(v)]));
  downloadBlob(buildXlsx([
    { name: t('month_summary'), rows: summary, widths: [36, 16] },
    { name: t('per_day'), rows: perDay, widths: [12, 10, 8, 12, 12, 12, 12, 12, 14, 8, 12, 12, 8, 6] },
    { name: t('revenue_by_stream'), rows: streams, widths: [28, 8, 14] },
    { name: t('purchases_title'), rows: sups, widths: [28, 14] },
  ]), fileName([state.rest.name, `${y}-${String(m).padStart(2, '0')}`]));
}

// Year: monthly trend (the Excel Cumulative tab) and non-food budget
export function exportYear({ year, yearMonths, Y }) {
  const head = [t('month'), t('step_covers'), t('revenue_excl'), t('food_cogs'), t('food_cost_pct'), t('bev_cogs'), t('bev_cost_pct'), t('cost_of_sales_pct'),
    t('labor_total'), t('labor_pct'), t('prime_pct'), t('avg_spend'), t('food_cost_cover'), t('nonfood_budget')];
  const row = (label, k) => [label, num(k.covers), money(k.revenue), money(k.foodCogs), pct(k.foodCostPct), money(k.bevCogs), pct(k.bevCostPct), pct(k.costOfSalesPct),
    money(k.laborAll), pct(k.laborPct), pct(k.primePct), money(k.avgSpend), money(k.foodCostPerCover), money(k.nonfood)];
  const rows = [head].concat(yearMonths.map((mm, i) => (mm ? row(fmt.monthName(i + 1), mm.k) : [fmt.monthName(i + 1)])), [row(t('total_ytd'), Y)]);
  downloadBlob(buildXlsx([{ name: String(year), rows, widths: [14, 8, 14, 14, 10, 14, 10, 10, 14, 10, 10, 12, 12, 14] }]), fileName([state.rest.name, String(year)]));
}

// VAT overview: one row per month, kind and rate
export function exportVat({ label, rows }) {
  const out = [[t('month'), t('vat_kind'), t('rate'), t('excl_vat'), t('vat')]]
    .concat(rows.map((r) => [{ date: r.month }, r.kind === 'revenue' ? t('vat_due_label') : t('vat_input_label'), pct(Number(r.vat_rate)), money(r.amount_ex), money(r.vat_amount)]));
  downloadBlob(buildXlsx([{ name: t('nav_vat'), rows: out, widths: [12, 18, 8, 14, 14] }]), fileName([state.rest.name, 'vat', label]));
}
