// Month report: the Excel month tab. Totals, inventory counts, COGS and all cost percentages.
import { state, perm, app, esc, fmt, toast, toastError, todayIso, $, nameOf, parseAmount, printHeader, printPage } from '../core.js';
import { t } from '../i18n.js';
import { sb, check, reportDays, ensureWeather } from '../data.js';
import { sumDays, monthKpis, targetFor, traffic, monthSeason } from '../calc.js';
import { weatherIcon } from '../weather.js';
import { exportMonth } from '../export.js';

let cur;
let lastData = null; // data of the shown month, for the Excel export
const pad = (n) => String(n).padStart(2, '0');

export async function renderMonth(args = []) {
  const now = todayIso();
  const m = /^(\d{4})-(\d{2})$/.exec(args[0] || '');
  cur = m ? { y: Number(m[1]), m: Number(m[2]) } : { y: Number(now.slice(0, 4)), m: Number(now.slice(5, 7)) };
  app().innerHTML = `<div id="ph"></div>
    <div class="page-head"><div><h1>${t('nav_month')}</h1><div class="muted small">${t('all_excl_vat')}</div></div>
      <div class="page-actions no-print">
        <div class="month-nav"><button type="button" class="btn-sm" id="prev">&#8249;</button><strong>${esc(fmt.month(cur.y, cur.m))}</strong>
        <button type="button" class="btn-sm" id="next">&#8250;</button></div>
        <button type="button" class="btn-sm" id="print">&#128424; ${t('print')}</button>
        <button type="button" class="btn-sm" id="xlsx">&#11015; ${t('export_xlsx')}</button></div></div>
    <div id="body"><div class="card empty"><span class="spinner"></span></div></div>`;
  $('#ph').innerHTML = printHeader(t('nav_month'), fmt.month(cur.y, cur.m));
  const shift = (n) => { let y = cur.y; let mm = cur.m + n; if (mm < 1) { mm = 12; y--; } if (mm > 12) { mm = 1; y++; } location.hash = `#/month/${y}-${pad(mm)}`; };
  $('#prev').onclick = () => shift(-1);
  $('#next').onclick = () => shift(1);
  $('#print').onclick = printPage;
  $('#xlsx').onclick = () => { if (lastData) exportMonth(lastData); };
  await load();
}

async function loadInventory(y, m) {
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const rows = check(await sb.from('fin_inventory_counts').select('*').eq('restaurant_id', state.rest.id)
    .or(`and(year.eq.${y},month.eq.${m}),and(year.eq.${prev.y},month.eq.${prev.m})`));
  return {
    cur: rows.find((r) => r.year === y && r.month === m) || null,
    prev: rows.find((r) => r.year === prev.y && r.month === prev.m) || null,
  };
}

async function load() {
  const first = `${cur.y}-${pad(cur.m)}-01`;
  const last = `${cur.y}-${pad(cur.m)}-${pad(new Date(cur.y, cur.m, 0).getDate())}`;
  try {
    const [rows, inv, weather] = await Promise.all([
      reportDays(state.rest.id, first, last), loadInventory(cur.y, cur.m), ensureWeather(state.rest, first, last),
    ]);
    draw(rows, inv, weather);
  } catch (e) { toastError(e); $('#body').innerHTML = ''; }
}

function draw(rows, inv, weather) {
  const meta = state.meta;
  const season = monthSeason(cur.y, cur.m);
  const s = sumDays(rows);
  // Beginning stock: what was entered, otherwise last month's ending stock (as in practice)
  const counts = {
    food_begin: inv.cur && inv.cur.food_begin != null ? inv.cur.food_begin : inv.prev ? inv.prev.food_end : null,
    bev_begin: inv.cur && inv.cur.bev_begin != null ? inv.cur.bev_begin : inv.prev ? inv.prev.bev_end : null,
    food_end: inv.cur ? inv.cur.food_end : null,
    bev_end: inv.cur ? inv.cur.bev_end : null,
  };
  const k = monthKpis(s, counts);
  lastData = { y: cur.y, m: cur.m, k, s, rows, weather };
  const tg = (m) => targetFor(meta, m, season);
  const pctRow = (label, val, target, cls = '') => {
    const tl = traffic(val, target);
    return `<tr class="${cls}"><td>${tl ? `<span class="tl ${tl}"></span>` : ''}${label}${target != null ? ` <span class="small muted">(${t('target')} ${fmt.pct(target, 0)})</span>` : ''}</td>
      <td class="${tl ? 'txt-' + tl : ''}">${fmt.pct(val)}</td></tr>`;
  };
  const money = (label, val, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${fmt.money2(val)}</td></tr>`;
  const budget = tg('nonfood_budget');
  const btl = traffic(k.nonfood, budget);

  const streams = meta.streams.filter((x) => s.byStream[x.id] != null);
  const supRows = Object.entries(s.bySupplier).map(([id, v]) => ({ name: id === 'none' ? t('no_supplier') : (meta.suppliers.find((x) => x.id === id) || {}).name || '?', v }))
    .sort((a, b) => b.v - a.v);
  const wBy = Object.fromEntries(weather.map((w) => [w.day, w]));
  const rainDays = weather.filter((w) => Number(w.precip_mm) >= 1).length;
  const avgT = weather.length ? weather.reduce((a, w) => a + Number(w.tmax), 0) / weather.length : null;

  $('#body').innerHTML = `
    ${s.days === 0 ? `<div class="card empty">${t('no_data_month')}</div>` : ''}
    <div class="grid grid-2">
      <div class="card"><h2>${t('month_summary')}</h2>
        <table class="kv">
          <tr><td>${t('step_covers')}</td><td>${fmt.num(k.covers)}</td></tr>
          ${money(t('revenue_total'), k.revenue, 'strong')}
          ${money(t('rev_food'), k.foodRevenue, 'sub')}${money(t('rev_bev'), k.bevRevenue, 'sub')}
          ${s.rev_other ? money(t('rev_other'), s.rev_other, 'sub') : ''}
          ${money(t('food_cogs'), k.foodCogs)}
          ${money(t('bev_cogs'), k.bevCogs)}
          ${pctRow(t('food_cost_pct'), k.foodCostPct, tg('food_cost'))}
          ${pctRow(t('bev_cost_pct'), k.bevCostPct, tg('beverage_cost'))}
          ${pctRow(t('cost_of_sales_pct'), k.costOfSalesPct, null)}
          ${money(t('labor_total'), k.laborAll)}
          ${money(t('labor_staff'), k.laborStaff, 'sub')}${money(t('labor_partners'), k.laborPartner, 'sub')}
          ${pctRow(t('labor_pct'), k.laborPct, tg('labor'))}
          ${pctRow(t('labor_pct_excl'), k.laborPctStaff, tg('labor'), 'sub')}
          ${pctRow(t('prime_pct'), k.primePct, tg('prime_cost'), 'strong')}
          ${pctRow(t('prime_pct_excl'), k.primePctStaff, tg('prime_cost'), 'sub')}
          <tr><td>${t('avg_spend')}</td><td>${fmt.money2(k.avgSpend)}</td></tr>
          <tr><td>${t('food_cost_cover')}</td><td>${fmt.money2(k.foodCostPerCover)}</td></tr>
        </table>
        ${!k.hasInventory ? `<div class="note">${t('no_inventory_note')}</div>` : ''}
        <div class="note">${t('season_note', { s: t('season_' + season) })}</div>
      </div>
      <div>
        <div class="card inv-box"><h2>${t('inventory_title')}</h2><p class="small muted" style="margin-top:-6px">${t('inventory_lead')}</p>
          <form id="inv-form"><div class="field-row">
            ${['food_begin', 'bev_begin', 'food_end', 'bev_end'].map((f) => `<div class="field"><label>${t('inv_' + f)}</label>
              <div class="money-in"><input name="${f}" inputmode="decimal" value="${inv.cur && inv.cur[f] != null ? String(inv.cur[f]).replace('.', ',') : ''}"
                placeholder="${f.endsWith('begin') && counts[f] != null ? String(counts[f]).replace('.', ',') : ''}"></div>
              ${f.endsWith('begin') && inv.prev && (!inv.cur || inv.cur[f] == null) && counts[f] != null ? `<div class="hint">${t('inv_from_prev')}</div>` : ''}</div>`).join('')}
          </div><button type="submit" class="btn-primary">${t('save')}</button></form></div>
        <div class="card"><h2>${t('nonfood_budget')}</h2>
          <table class="kv">${money(t('cat_non_food'), s.pur_non_food, 'sub')}${money(t('cat_cleaning'), s.pur_cleaning, 'sub')}${money(t('cat_small_inventory'), s.pur_small_inventory, 'sub')}
          <tr class="strong"><td>${btl ? `<span class="tl ${btl}"></span>` : ''}${t('total')}</td><td class="${btl ? 'txt-' + btl : ''}">${fmt.money2(k.nonfood)}</td></tr>
          <tr><td>${t('budget')}</td><td>${fmt.money2(budget)}</td></tr>
          <tr><td>${t('pct_of_budget')}</td><td>${budget ? fmt.pct(k.nonfood / budget, 0) : '–'}</td></tr></table></div>
        <div class="card"><h2>${t('weather')}</h2>
          <table class="kv"><tr><td>${t('avg_tmax')}</td><td>${avgT == null ? '–' : `${fmt.num(avgT, 1)}&deg;C`}</td></tr>
          <tr><td>${t('rain_days')}</td><td>${rainDays}</td></tr></table></div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h2>${t('revenue_by_stream')}</h2><div class="table-wrap"><table class="num-table">
        <thead><tr><th>${t('stream')}</th><th>${t('vat')}</th><th>${t('excl_vat')}</th></tr></thead><tbody>
        ${streams.map((x) => `<tr><td>${esc(nameOf(x))}</td><td>${fmt.pct(Number(x.vat_rate), 0)}</td><td>${fmt.money2(s.byStream[x.id])}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">${t('no_data')}</td></tr>`}
        <tr class="total"><td>${t('total')}</td><td></td><td>${fmt.money2(s.revenue)}</td></tr>
        <tr><td class="muted">${t('vat_on_revenue')}</td><td></td><td class="muted">${fmt.money2(s.rev_vat)}</td></tr></tbody></table></div></div>
      <div class="card"><h2>${t('purchases_title')}</h2><div class="table-wrap"><table class="num-table">
        <thead><tr><th>${t('supplier')}</th><th>${t('excl_vat')}</th></tr></thead><tbody>
        ${supRows.map((r) => `<tr><td>${esc(r.name)}</td><td>${fmt.money2(r.v)}</td></tr>`).join('') || `<tr><td colspan="2" class="muted">${t('no_data')}</td></tr>`}
        <tr class="total"><td>${t('total')}</td><td>${fmt.money2(s.purchases)}</td></tr></tbody></table>
        <table class="kv" style="margin-top:12px">${money(t('cat_food_all'), s.pur_food, 'sub')}${money(t('cat_beverage'), s.pur_beverage, 'sub')}
          ${money(t('cat_nonfood_all'), s.nonfood, 'sub')}<tr class="sub"><td class="muted">${t('vat_on_purchases')}</td><td class="muted">${fmt.money2(s.pur_vat)}</td></tr></table></div></div>
    </div>
    <div class="card" style="margin-top:16px" id="compare"><h2>${t('compare_title')}</h2><div class="empty"><span class="spinner"></span></div></div>
    <div class="card" style="margin-top:16px"><h2>${t('per_day')}</h2><div class="table-wrap"><table class="num-table">
      <thead><tr><th>${t('date')}</th><th></th><th>${t('step_covers')}</th><th>${t('revenue_excl')}</th><th>${t('purchases_excl')}</th><th>${t('hours')}</th>${perm.reports() ? `<th>${t('labor_total')}</th>` : ''}</tr></thead><tbody>
      ${rows.map((r) => { const w = wBy[r.day]; const rev = Number(r.rev_food) + Number(r.rev_beverage) + Number(r.rev_other);
        const pur = Number(r.pur_food) + Number(r.pur_beverage) + Number(r.pur_non_food) + Number(r.pur_cleaning) + Number(r.pur_small_inventory);
        return `<tr><td><a href="#/today/${r.day}">${esc(fmt.dayShort(r.day))}</a> ${r.status === 'complete' ? '<span class="txt-green">&#10003;</span>' : `<span class="badge warn">${t('st_draft')}</span>`}</td>
          <td>${w ? `${weatherIcon(w.weather_code)} ${fmt.num(Number(w.tmax), 0)}&deg;` : ''}</td>
          <td>${r.covers ?? '–'}</td><td>${fmt.money2(rev)}</td><td>${fmt.money2(pur)}</td><td>${fmt.num(Number(r.hours_staff) + Number(r.hours_partner), 2)}</td>
          <td>${fmt.money2(Number(r.labor_staff) + Number(r.labor_partner))}</td></tr>`; }).join('') || `<tr><td colspan="7" class="muted">${t('no_data')}</td></tr>`}
      </tbody></table></div></div>`;

  compare(k);
  $('#inv-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const row = { restaurant_id: state.rest.id, organization_id: state.rest.organization_id, year: cur.y, month: cur.m, updated_at: new Date().toISOString() };
    for (const key of ['food_begin', 'bev_begin', 'food_end', 'bev_end']) {
      let v = parseAmount(f[key].value);
      // Empty beginning stock takes last month's ending stock
      if (v == null && key.endsWith('begin') && counts[key] != null) v = Number(counts[key]);
      row[key] = v;
    }
    try {
      check(await sb.from('fin_inventory_counts').upsert(row, { onConflict: 'restaurant_id,year,month' }));
      toast(t('saved'));
      load();
    } catch (err) { toastError(err); }
  };
}

// KPIs of any month, the same way as above (beginning stock falls back to last month's ending stock)
async function kpisFor(y, m) {
  const first = `${y}-${pad(m)}-01`;
  const lastDay = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
  const [rows, inv] = await Promise.all([reportDays(state.rest.id, first, lastDay), loadInventory(y, m)]);
  if (!rows.length) return null;
  const counts = {
    food_begin: inv.cur && inv.cur.food_begin != null ? inv.cur.food_begin : inv.prev ? inv.prev.food_end : null,
    bev_begin: inv.cur && inv.cur.bev_begin != null ? inv.cur.bev_begin : inv.prev ? inv.prev.bev_end : null,
    food_end: inv.cur ? inv.cur.food_end : null, bev_end: inv.cur ? inv.cur.bev_end : null,
  };
  return monthKpis(sumDays(rows), counts);
}

// This month next to last month and the same month last year
async function compare(k) {
  const box = document.getElementById('compare');
  if (!box) return;
  const pm = cur.m === 1 ? { y: cur.y - 1, m: 12 } : { y: cur.y, m: cur.m - 1 };
  const shown = { ...cur };
  try {
    const [prev, ly] = await Promise.all([kpisFor(pm.y, pm.m), kpisFor(cur.y - 1, cur.m)]);
    if (shown.y !== cur.y || shown.m !== cur.m) return; // user moved on
    const rowsDef = [
      ['revenue_total', 'revenue', 'money', true], ['step_covers', 'covers', 'num', true], ['avg_spend', 'avgSpend', 'money2', true],
      ['food_cost_pct', 'foodCostPct', 'pct', false], ['bev_cost_pct', 'bevCostPct', 'pct', false], ['labor_pct', 'laborPct', 'pct', false], ['prime_pct', 'primePct', 'pct', false],
    ];
    const show = (v, f) => (v == null ? '–' : f === 'money' ? fmt.money(v) : f === 'money2' ? fmt.money2(v) : f === 'pct' ? fmt.pct(v) : fmt.num(v));
    const delta = (a, b, f, upGood) => {
      if (a == null || b == null) return '';
      if (f === 'pct') { const d = (a - b) * 100; if (Math.abs(d) < 0.05) return ''; const good = upGood ? d > 0 : d < 0;
        return `<span class="small ${good ? 'txt-green' : 'txt-red'}">${d > 0 ? '+' : ''}${fmt.num(d, 1)} pt</span>`; }
      if (!b) return ''; const d = (a - b) / Math.abs(b); if (Math.abs(d) < 0.005) return ''; const good = upGood ? d > 0 : d < 0;
      return `<span class="small ${good ? 'txt-green' : 'txt-red'}">${d > 0 ? '+' : ''}${fmt.num(d * 100, 0)}%</span>`;
    };
    box.innerHTML = `<h2>${t('compare_title')}</h2><div class="table-wrap"><table class="num-table">
      <thead><tr><th>${t('metric')}</th><th>${esc(fmt.month(cur.y, cur.m))}</th><th>${esc(fmt.month(pm.y, pm.m))}</th><th>${esc(fmt.month(cur.y - 1, cur.m))}</th></tr></thead><tbody>
      ${rowsDef.map(([label, key, f, upGood]) => `<tr><td>${t(label)}</td><td><strong>${show(k[key], f)}</strong></td>
        <td>${show(prev && prev[key], f)} ${delta(k[key], prev && prev[key], f, upGood)}</td>
        <td>${show(ly && ly[key], f)} ${delta(k[key], ly && ly[key], f, upGood)}</td></tr>`).join('')}
      </tbody></table></div><div class="small muted" style="margin-top:6px">${t('compare_note')}</div>`;
  } catch (e) { box.innerHTML = `<h2>${t('compare_title')}</h2><div class="small muted">${esc(e.message)}</div>`; }
}
