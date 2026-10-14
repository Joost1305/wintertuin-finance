// Dashboard: the Excel Dashboard and Cumulative tabs. Year to date KPIs, monthly trend,
// targets, non-food budget and break-even.
// Chart rules (as in WASTE log): one measure per chart, recessive grid, tables next to charts.
import { state, app, esc, fmt, toastError, todayIso, addDaysIso, $, printHeader, printPage } from '../core.js';
import { t } from '../i18n.js';
import { sb, check, reportDays } from '../data.js';
import { sumDays, monthKpis, ytd, targetFor, traffic, openDaysInMonth, breakEvenPerDay, monthSeason, isOpen, closureNote } from '../calc.js';
import { exportYear } from '../export.js';

const charts = [];
let lastYear = null;
let year;
const pad = (n) => String(n).padStart(2, '0');
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export async function renderDashboard(args = []) {
  const now = todayIso();
  year = /^\d{4}$/.test(args[0] || '') ? Number(args[0]) : Number(now.slice(0, 4));
  app().innerHTML = `<div id="ph"></div>
    <div class="page-head"><div><h1>${t('nav_dashboard')}</h1><div class="muted small">${esc(state.rest.name)} · ${t('all_excl_vat')}</div></div>
      <div class="page-actions no-print">
        <div class="month-nav"><button type="button" class="btn-sm" id="prev">&#8249;</button><strong>${year}</strong>
        <button type="button" class="btn-sm" id="next">&#8250;</button></div>
        <button type="button" class="btn-sm" id="print">&#128424; ${t('print')}</button>
        <button type="button" class="btn-sm" id="xlsx">&#11015; ${t('export_xlsx')}</button></div></div>
    <div id="body"><div class="card empty"><span class="spinner"></span></div></div>`;
  $('#ph').innerHTML = printHeader(t('nav_dashboard'), String(year));
  $('#prev').onclick = () => { location.hash = `#/dashboard/${year - 1}`; };
  $('#next').onclick = () => { location.hash = `#/dashboard/${year + 1}`; };
  $('#print').onclick = printPage;
  $('#xlsx').onclick = () => { if (lastYear) exportYear(lastYear); };
  try { await load(); } catch (e) { toastError(e); $('#body').innerHTML = ''; }
}

// Month KPIs for a list of report rows and inventory counts (beginning stock falls back to last month's ending stock)
function monthsFrom(rows, invRows) {
  const byMonth = {};
  for (const r of rows) { const key = r.day.slice(0, 7); (byMonth[key] = byMonth[key] || []).push(r); }
  const inv = Object.fromEntries(invRows.map((r) => [`${r.year}-${pad(r.month)}`, r]));
  const prevKey = (key) => { let [y, m] = key.split('-').map(Number); m--; if (m < 1) { m = 12; y--; } return `${y}-${pad(m)}`; };
  const out = {};
  const keys = new Set([...Object.keys(byMonth), ...Object.keys(inv)]);
  for (const key of keys) {
    const c = inv[key] || {}; const p = inv[prevKey(key)] || {};
    const counts = {
      food_begin: c.food_begin != null ? c.food_begin : p.food_end, bev_begin: c.bev_begin != null ? c.bev_begin : p.bev_end,
      food_end: c.food_end, bev_end: c.bev_end,
    };
    const s = sumDays(byMonth[key] || []);
    out[key] = { key, s, k: monthKpis(s, counts) };
  }
  return out;
}

async function load() {
  const meta = state.meta;
  const today = todayIso();
  const [allRows, invRows] = await Promise.all([
    reportDays(state.rest.id, `${year}-01-01`, `${year}-12-31` > today ? today : `${year}-12-31`),
    check(await sb.from('fin_inventory_counts').select('*').eq('restaurant_id', state.rest.id)),
  ]);
  const months = monthsFrom(allRows, invRows);
  const yearMonths = Array.from({ length: 12 }, (_, i) => months[`${year}-${pad(i + 1)}`] || null);
  const Y = ytd(yearMonths.filter(Boolean).map((m) => m.k));
  const tg = (m) => targetFor(meta, m, null);

  // KPI tiles
  const tile = (label, value, tl, target) => `<div class="card kpi"><div class="label">${label}</div>
    <div class="value ${tl ? 'txt-' + tl : ''}">${tl ? `<span class="tl ${tl}"></span>` : ''}${value}</div>
    ${target != null ? `<div class="target">${t('target')} ${fmt.pct(target, 0)}</div>` : '<div class="target">&nbsp;</div>'}</div>`;
  const pctTile = (label, v, metric) => tile(label, fmt.pct(v), traffic(v, metric ? tg(metric) : null), metric ? tg(metric) : null);

  // Break-even
  const fixedMonth = (meta.fixed || []).filter((f) => f.active).reduce((a, f) => a + Number(f.amount_month), 0);
  const nowY = Number(today.slice(0, 4)); const nowM = Number(today.slice(5, 7));
  const openDays = openDaysInMonth(nowY, nowM, meta);
  const varRatio = Y.revenue > 0 ? (Y.costOfSalesPct || 0) + (Y.laborPctStaff || 0)
    : (tg('prime_cost') != null ? tg('prime_cost') : null);
  const be = breakEvenPerDay(fixedMonth, openDays, varRatio);
  const thisMonth = months[`${nowY}-${pad(nowM)}`];
  const daysWithRevenue = thisMonth ? allRows.filter((r) => r.day.startsWith(`${nowY}-${pad(nowM)}`) && (Number(r.rev_food) + Number(r.rev_beverage) + Number(r.rev_other)) > 0).length : 0;
  const avgDay = thisMonth && daysWithRevenue ? thisMonth.k.revenue / daysWithRevenue : null;

  const budget = tg('nonfood_budget');
  $('#body').innerHTML = `
    <div class="grid grid-kpi four">
      ${pctTile(t('ytd_food_cost'), Y.foodCostPct, 'food_cost')}
      ${pctTile(t('ytd_bev_cost'), Y.bevCostPct, 'beverage_cost')}
      ${pctTile(t('ytd_cost_of_sales'), Y.costOfSalesPct, null)}
      ${pctTile(t('ytd_prime'), Y.primePct, 'prime_cost')}
      ${pctTile(t('ytd_labor'), Y.laborPct, 'labor')}
      ${tile(t('ytd_revenue'), fmt.money(Y.revenue), '', null)}
      ${tile(t('ytd_covers'), fmt.num(Y.covers), '', null)}
      ${tile(t('ytd_avg_spend'), fmt.money2(Y.avgSpend), '', null)}
    </div>
    <div class="note">${t('labor_excl_partners_note', { l: fmt.pct(Y.laborPctStaff), p: fmt.pct(Y.primePctStaff) })}</div>
    <div class="card" style="margin-top:16px" id="events-card"><h2>${t('events_ahead')}</h2><div class="empty"><span class="spinner"></span></div></div>
    <div class="card" style="margin-top:16px" id="planned-labor"><h2>${t('planned_labor')}</h2><div class="empty"><span class="spinner"></span></div></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h2>${t('revenue_per_month')}</h2><div class="chart-box"><canvas id="c-rev"></canvas></div></div>
      <div class="card"><h2>${t('cost_pct_per_month')}</h2><div class="chart-box"><canvas id="c-pct"></canvas></div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>${t('monthly_trend')}</h2><div class="table-wrap"><table class="num-table">
      <thead><tr><th>${t('month')}</th><th>${t('step_covers')}</th><th>${t('revenue_excl')}</th><th>${t('food_cost_pct')}</th><th>${t('bev_cost_pct')}</th>
        <th>${t('cost_of_sales_pct')}</th><th>${t('labor_pct')}</th><th>${t('prime_pct')}</th><th>${t('avg_spend')}</th><th>${t('food_cost_cover')}</th></tr></thead><tbody>
      ${yearMonths.map((m, i) => { const season = monthSeason(year, i + 1); const st = (v, metric) => { const tl = metric ? traffic(v, targetFor(meta, metric, season)) : ''; return `<td class="${tl ? 'txt-' + tl : ''}">${fmt.pct(v)}</td>`; };
        return m ? `<tr><td><a href="#/month/${year}-${pad(i + 1)}">${esc(fmt.monthName(i + 1))}</a></td><td>${fmt.num(m.k.covers)}</td><td>${fmt.money(m.k.revenue)}</td>
          ${st(m.k.foodCostPct, 'food_cost')}${st(m.k.bevCostPct, 'beverage_cost')}${st(m.k.costOfSalesPct)}${st(m.k.laborPct, 'labor')}${st(m.k.primePct, 'prime_cost')}
          <td>${fmt.money2(m.k.avgSpend)}</td><td>${fmt.money2(m.k.foodCostPerCover)}</td></tr>`
          : `<tr><td class="muted">${esc(fmt.monthName(i + 1))}</td><td colspan="9" class="muted" style="text-align:left">–</td></tr>`; }).join('')}
      <tr class="total"><td>${t('total_ytd')}</td><td>${fmt.num(Y.covers)}</td><td>${fmt.money(Y.revenue)}</td><td>${fmt.pct(Y.foodCostPct)}</td><td>${fmt.pct(Y.bevCostPct)}</td>
        <td>${fmt.pct(Y.costOfSalesPct)}</td><td>${fmt.pct(Y.laborPct)}</td><td>${fmt.pct(Y.primePct)}</td><td>${fmt.money2(Y.avgSpend)}</td><td>${fmt.money2(Y.foodCostPerCover)}</td></tr>
      </tbody></table></div></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h2>${t('cost_mix')}</h2><table class="kv">
        <tr><td>${t('food_cogs')}</td><td>${fmt.money(Y.foodCogs)}</td></tr><tr><td>${t('bev_cogs')}</td><td>${fmt.money(Y.bevCogs)}</td></tr>
        <tr><td>${t('labor_total')}</td><td>${fmt.money(Y.laborAll)}</td></tr>
        <tr class="strong"><td>${t('gross_profit')}</td><td>${fmt.money(Y.revenue - Y.foodCogs - Y.bevCogs - Y.laborAll)}</td></tr></table></div>
      <div class="card"><h2>${t('actual_vs_target')}</h2><table class="num-table"><thead><tr><th>${t('metric')}</th><th>${t('actual')}</th><th>${t('target')}</th></tr></thead><tbody>
        ${[['food_cost_pct', Y.foodCostPct, 'food_cost'], ['bev_cost_pct', Y.bevCostPct, 'beverage_cost'], ['labor_pct', Y.laborPct, 'labor'], ['prime_pct', Y.primePct, 'prime_cost']]
          .map(([l, v, m]) => { const tl = traffic(v, tg(m)); return `<tr><td>${tl ? `<span class="tl ${tl}"></span>` : ''}${t(l)}</td><td class="${tl ? 'txt-' + tl : ''}">${fmt.pct(v)}</td><td>${fmt.pct(tg(m), 0)}</td></tr>`; }).join('')}
        </tbody></table></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h2>${t('break_even')}</h2>
        <div class="kpi" style="padding:0"><div class="value">${be == null ? '–' : fmt.money(be)}</div><div class="target">${t('break_even_sub')}</div></div>
        <table class="kv" style="margin-top:10px"><tr><td>${t('fixed_costs_month')}</td><td>${fmt.money(fixedMonth)}</td></tr>
          <tr><td>${t('open_days_month')}</td><td>${openDays}</td></tr>
          <tr><td>${t('variable_ratio')}</td><td>${fmt.pct(varRatio)}</td></tr>
          <tr><td>${t('avg_revenue_day')}</td><td class="${avgDay != null && be != null ? (avgDay >= be ? 'txt-green' : 'txt-red') : ''}">${avgDay == null ? '–' : fmt.money(avgDay)}</td></tr></table>
        <div class="note">${t('break_even_note')}</div></div>
      <div class="card"><h2>${t('nonfood_budget')}</h2><div class="table-wrap"><table class="num-table">
      <thead><tr><th>${t('month')}</th><th>${t('actual')}</th><th>${t('budget')}</th><th>${t('pct_of_budget')}</th></tr></thead><tbody>
      ${yearMonths.map((m, i) => { const v = m ? m.k.nonfood : 0; const b = targetFor(meta, 'nonfood_budget', monthSeason(year, i + 1)); const tl = m ? traffic(v, b) : '';
        return `<tr><td>${esc(fmt.monthName(i + 1))}</td><td class="${tl ? 'txt-' + tl : ''}">${m ? fmt.money(v) : '–'}</td><td>${fmt.money(b)}</td><td>${m && b ? fmt.pct(v / b, 0) : '–'}</td></tr>`; }).join('')}
      <tr class="total"><td>${t('total')}</td><td>${fmt.money(Y.nonfood)}</td><td>${fmt.money((budget || 0) * 12)}</td><td>${budget ? fmt.pct(Y.nonfood / (budget * 12), 0) : '–'}</td></tr>
      </tbody></table></div></div>
    </div>`;
  drawCharts(yearMonths);
  lastYear = { year, yearMonths, Y };
  plannedLabor(allRows);
  eventsAhead();
}

// Events from the team app: the next 60 days, expected revenue and deposits still to come in
const TEAM_EVENT = (id) => `https://joost1305.github.io/wintertuin-staff-app/#/events/${id}`;
async function eventsAhead() {
  const box = document.getElementById('events-card');
  if (!box) return;
  const today = todayIso();
  try {
    const [evs, deps] = await Promise.all([
      sb.rpc('fin_events_overview', { p_rest: state.rest.id, p_from: today, p_to: addDaysIso(today, 60) }).then(check),
      sb.rpc('fin_open_deposits', { p_rest: state.rest.id }).then(check),
    ]);
    const rows = evs || []; const open = deps || [];
    // Prices on a BEO can include VAT; for the excl. VAT total we take 9% (food). An estimate, said so on screen.
    const ex = (e) => (e.expected_revenue == null ? 0 : e.prices_incl_vat ? Number(e.expected_revenue) / 1.09 : Number(e.expected_revenue));
    const conf = rows.filter((e) => e.status === 'confirmed'); const opt = rows.filter((e) => e.status === 'option');
    const sum = (a) => a.reduce((x, e) => x + ex(e), 0);
    const link = (e) => `<a href="${TEAM_EVENT(e.id)}" target="wintertuin-team">${esc(e.title)}</a>`;
    box.innerHTML = `<h2>${t('events_ahead')}</h2>
      <div class="grid grid-kpi" style="margin-bottom:12px">
        <div class="kpi"><div class="label">${t('events_confirmed')}</div><div class="value">${conf.length}</div><div class="tiny muted">${fmt.money(sum(conf))} ${t('excl_vat_est')}</div></div>
        <div class="kpi"><div class="label">${t('events_options')}</div><div class="value">${opt.length}</div><div class="tiny muted">${fmt.money(sum(opt))} ${t('excl_vat_est')}</div></div>
        <div class="kpi"><div class="label">${t('deposits_open')}</div><div class="value ${open.some((d) => d.deposit_due && d.deposit_due < today) ? 'txt-red' : ''}">${fmt.money(open.reduce((a, d) => a + Number(d.deposit), 0))}</div><div class="tiny muted">${t('deposits_n', { n: open.length })}</div></div>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="num-table ev-tbl"><thead><tr><th>${t('date')}</th><th>${t('event')}</th><th>${t('status')}</th><th>${t('guests')}</th><th>${t('expected')}</th></tr></thead><tbody>
        ${rows.map((e) => `<tr><td>${esc(fmt.dayShort(e.event_date))}</td><td>${link(e)}</td><td><span class="badge ${e.status === 'confirmed' ? 'green' : 'amber'}">${t('evs_' + e.status)}</span></td>
          <td>${e.guests ?? '–'}</td><td>${e.expected_revenue != null ? `${fmt.money(e.expected_revenue)} <span class="tiny muted">${t(e.prices_incl_vat ? 'incl_vat_short' : 'excl_vat_short')}</span>` : '–'}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty small">${t('events_none')}</div>`}
      ${open.length ? `<h3 style="margin:16px 0 6px;font-size:.95rem">${t('deposits_open')}</h3><table class="kv">${open.map((d) => `<tr><td>${link(d)} <span class="tiny muted">${esc(fmt.dayShort(d.event_date))}</span></td>
        <td class="${d.deposit_due && d.deposit_due < today ? 'txt-red' : ''}">${fmt.money2(d.deposit)}${d.deposit_due ? ` · ${t(d.deposit_due < today ? 'deposit_overdue' : 'deposit_due_on', { d: fmt.dayShort(d.deposit_due) })}` : ''}</td></tr>`).join('')}</table>` : ''}
      <div class="tiny muted" style="margin-top:8px">${t('events_vat_note')}</div>`;
  } catch (e) { box.innerHTML = `<h2>${t('events_ahead')}</h2><div class="empty small">${t('events_unavailable')}</div>`; console.warn(e); }
}

function drawCharts(yearMonths) {
  while (charts.length) charts.pop().destroy();
  if (!window.Chart) return;
  const labels = yearMonths.map((_, i) => fmt.monthShort(i + 1));
  const grid = { color: css('--line') };
  const tick = { color: css('--ink-2') };
  charts.push(new Chart(document.getElementById('c-rev'), {
    type: 'bar',
    data: { labels, datasets: [{ label: t('revenue_excl'), data: yearMonths.map((m) => (m ? Math.round(m.k.revenue) : null)), backgroundColor: css('--primary'), borderRadius: 4 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmt.money(c.parsed.y) } } },
      scales: { x: { grid: { display: false }, ticks: tick }, y: { grid, ticks: { ...tick, callback: (v) => fmt.money(v) } } } },
  }));
  const pctLine = (label, key, color) => ({ label, data: yearMonths.map((m) => (m && m.k[key] != null ? Math.round(m.k[key] * 1000) / 10 : null)),
    borderColor: color, backgroundColor: color, tension: 0.25, spanGaps: true, pointRadius: 3 });
  charts.push(new Chart(document.getElementById('c-pct'), {
    type: 'line',
    data: { labels, datasets: [pctLine(t('food_cost_pct'), 'foodCostPct', css('--primary')), pctLine(t('bev_cost_pct'), 'bevCostPct', css('--accent')),
      pctLine(t('labor_pct'), 'laborPct', '#7B8F3A')] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, color: css('--ink-2') } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}%` } } },
      scales: { x: { grid: { display: false }, ticks: tick }, y: { grid, ticks: { ...tick, callback: (v) => `${v}%` }, beginAtZero: true } } },
  }));
}

// Labor cost ahead: the roster in the team app x hourly rates, for the next 7 days.
// Projected labor % uses the average revenue per open day of the last 4 weeks.
async function plannedLabor(rows) {
  const box = document.getElementById('planned-labor');
  if (!box) return;
  const today = todayIso();
  const to = addDaysIso(today, 6);
  try {
    const plan = check(await sb.rpc('fin_planned_labor', { p_rest: state.rest.id, p_from: today, p_to: to })) || [];
    const since = addDaysIso(today, -28);
    const recent = rows.filter((r) => r.day >= since && r.day < today);
    const recentRev = recent.reduce((a, r) => a + Number(r.rev_food) + Number(r.rev_beverage) + Number(r.rev_other), 0);
    const recentOpen = recent.filter((r) => isOpen(r.day, state.meta)).length;
    const perDay = recentOpen ? recentRev / recentOpen : null;
    const openNext = plan.filter((d) => isOpen(d.day, state.meta)).length;
    const expected = perDay != null ? perDay * openNext : null;
    const sum = (k) => plan.reduce((a, d) => a + Number(d[k] || 0), 0);
    const cost = sum('cost_staff') + sum('cost_partner');
    const pct = expected ? cost / expected : null;
    const pctStaff = expected ? sum('cost_staff') / expected : null;
    const target = targetFor(state.meta, 'labor', null);
    const tl = traffic(pct, target);
    const unlinked = sum('hours_unlinked');
    box.innerHTML = `<div class="split"><h2 style="margin:0">${t('planned_labor')}</h2><span class="small muted">${esc(fmt.date(today))} – ${esc(fmt.date(to))}</span></div>
      <div class="grid grid-kpi four" style="margin-top:12px">
        <div class="kpi"><div class="label">${t('planned_hours')}</div><div class="value">${fmt.num(sum('hours_staff') + sum('hours_partner'), 1)}</div></div>
        <div class="kpi"><div class="label">${t('planned_cost')}</div><div class="value">${fmt.money(cost)}</div><div class="target">${t('of_which_partners', { v: fmt.money(sum('cost_partner')) })}</div></div>
        <div class="kpi"><div class="label">${t('expected_revenue')}</div><div class="value">${expected == null ? '–' : fmt.money(expected)}</div><div class="target">${t('expected_revenue_sub', { n: openNext })}</div></div>
        <div class="kpi"><div class="label">${t('projected_labor')}</div><div class="value ${tl ? 'txt-' + tl : ''}">${tl ? `<span class="tl ${tl}"></span>` : ''}${fmt.pct(pct)}</div>
          <div class="target">${target != null ? `${t('target')} ${fmt.pct(target, 0)} · ` : ''}${t('without_partners')} ${fmt.pct(pctStaff)}</div></div>
      </div>
      <div class="table-wrap" style="margin-top:12px"><table class="num-table"><thead><tr><th>${t('day')}</th><th>${t('hours')}</th><th>${t('labor_staff')}</th><th>${t('labor_partners')}</th></tr></thead><tbody>
      ${plan.map((d) => { const open = isOpen(d.day, state.meta); const note = closureNote(d.day, state.meta);
        return `<tr class="${open ? '' : 'muted'}"><td>${esc(fmt.dayShort(d.day))}${note ? ` <span class="badge warn">${esc(note)}</span>` : open ? '' : ` <span class="small muted">${t('closed')}</span>`}</td>
          <td>${fmt.num(Number(d.hours_staff) + Number(d.hours_partner) + Number(d.hours_unlinked), 1)}</td><td>${fmt.money(Number(d.cost_staff))}</td><td>${fmt.money(Number(d.cost_partner))}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${unlinked > 0 ? `<div class="note">${t('unlinked_hours_note', { h: fmt.num(unlinked, 1) })}</div>` : ''}
      ${perDay == null ? `<div class="note">${t('no_recent_revenue')}</div>` : ''}`;
  } catch (e) { box.innerHTML = `<h2>${t('planned_labor')}</h2><div class="small muted">${esc(e.message)}</div>`; }
}
