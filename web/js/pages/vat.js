// VAT overview per quarter: VAT on revenue (due) minus VAT on purchases (input VAT), per month and rate.
// Indicative, for the accountant; the official return is theirs.
import { state, app, esc, fmt, toastError, todayIso, $, printHeader } from '../core.js';
import { t } from '../i18n.js';
import { check, sb } from '../data.js';
import { exportVat } from '../export.js';

let q;
let lastRows = [];

export async function renderVat(args = [], el = app()) {
  const now = todayIso();
  const m = /^(\d{4})-Q([1-4])$/.exec(args[0] || '');
  q = m ? { y: Number(m[1]), q: Number(m[2]) } : { y: Number(now.slice(0, 4)), q: Math.floor((Number(now.slice(5, 7)) - 1) / 3) + 1 };
  const label = `Q${q.q} ${q.y}`;
  el.innerHTML = `<div id="ph"></div>
    <div class="page-head"><div><h2 style="margin:0">${t('set_vat_report')}</h2><div class="muted small">${t('vat_sub')}</div></div>
      <div class="page-actions no-print">
        <div class="month-nav"><button type="button" class="btn-sm" id="prev">&#8249;</button><strong>${label}</strong><button type="button" class="btn-sm" id="next">&#8250;</button></div>
        <button type="button" class="btn-sm" id="print">&#128424; ${t('print')}</button>
        <button type="button" class="btn-sm" id="xlsx">&#11015; ${t('export_xlsx')}</button></div></div>
    <div id="body"><div class="card empty"><span class="spinner"></span></div></div>`;
  $('#ph').innerHTML = printHeader(t('nav_vat'), label);
  const go = (n) => { let y = q.y; let qq = q.q + n; if (qq < 1) { qq = 4; y--; } if (qq > 4) { qq = 1; y++; } location.hash = `#/settings/vatreport/${y}-Q${qq}`; };
  $('#prev').onclick = () => go(-1);
  $('#next').onclick = () => go(1);
  $('#print').onclick = () => window.print();
  $('#xlsx').onclick = () => exportVat({ label: `${q.y}-Q${q.q}`, rows: lastRows });
  try { await load(); } catch (e) { toastError(e); $('#body').innerHTML = ''; }
}

async function load() {
  const m1 = (q.q - 1) * 3 + 1;
  const from = `${q.y}-${String(m1).padStart(2, '0')}-01`;
  const to = new Date(q.y, m1 + 2, 0).toLocaleDateString('sv-SE');
  const rows = check(await sb.rpc('fin_vat_summary', { p_rest: state.rest.id, p_from: from, p_to: to })) || [];
  lastRows = rows;
  const months = [0, 1, 2].map((i) => `${q.y}-${String(m1 + i).padStart(2, '0')}-01`);
  const rates = [...new Set(rows.map((r) => Number(r.vat_rate)))].sort((a, b) => b - a);
  const get = (month, kind, rate, key) => rows.filter((r) => r.month === month && r.kind === kind && (rate == null || Number(r.vat_rate) === rate))
    .reduce((a, r) => a + Number(r[key] || 0), 0);
  const section = (kind, title) => `<div class="card" style="margin-top:16px"><h2>${title}</h2><div class="table-wrap"><table class="num-table">
    <thead><tr><th>${t('month')}</th>${rates.map((r) => `<th>${fmt.pct(r, 0)} ${t('excl_vat')}</th><th>${fmt.pct(r, 0)} ${t('vat')}</th>`).join('')}<th>${t('total')} ${t('vat')}</th></tr></thead><tbody>
    ${months.map((mo) => `<tr><td>${esc(fmt.monthName(Number(mo.slice(5, 7))))}</td>${rates.map((r) => `<td>${fmt.money2(get(mo, kind, r, 'amount_ex'))}</td><td>${fmt.money2(get(mo, kind, r, 'vat_amount'))}</td>`).join('')}
      <td><strong>${fmt.money2(get(mo, kind, null, 'vat_amount'))}</strong></td></tr>`).join('')}
    <tr class="total"><td>${t('total')}</td>${rates.map((r) => `<td>${fmt.money2(months.reduce((a, mo) => a + get(mo, kind, r, 'amount_ex'), 0))}</td><td>${fmt.money2(months.reduce((a, mo) => a + get(mo, kind, r, 'vat_amount'), 0))}</td>`).join('')}
      <td>${fmt.money2(months.reduce((a, mo) => a + get(mo, kind, null, 'vat_amount'), 0))}</td></tr></tbody></table></div></div>`;
  const due = rows.filter((r) => r.kind === 'revenue').reduce((a, r) => a + Number(r.vat_amount), 0);
  const input = rows.filter((r) => r.kind === 'purchases').reduce((a, r) => a + Number(r.vat_amount), 0);
  const balance = due - input;
  $('#body').innerHTML = !rows.length ? `<div class="card empty">${t('no_data')}</div>` : `
    <div class="grid grid-kpi">
      <div class="card kpi"><div class="label">${t('vat_due_label')}</div><div class="value">${fmt.money2(due)}</div></div>
      <div class="card kpi"><div class="label">${t('vat_input_label')}</div><div class="value">${fmt.money2(input)}</div></div>
      <div class="card kpi"><div class="label">${balance >= 0 ? t('vat_to_pay') : t('vat_to_reclaim')}</div><div class="value ${balance >= 0 ? '' : 'txt-green'}">${fmt.money2(Math.abs(balance))}</div></div>
    </div>
    ${section('revenue', t('vat_due_label'))}
    ${section('purchases', t('vat_input_label'))}
    <div class="note">${t('vat_note')}</div>`;
}
