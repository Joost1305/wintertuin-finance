// Calendar: one glance at which days are entered. Green complete, amber partly, red missing,
// grey closed (opening hours). Weather per day. Tap a day to open or correct it.
import { state, app, esc, fmt, todayIso, $, $$, printHeader } from '../core.js';
import { t } from '../i18n.js';
import { daysInRange, reportDays, ensureWeather } from '../data.js';
import { dayStatus, closureNote } from '../calc.js';
import { weatherIcon } from '../weather.js';

let cur;

export async function renderCalendar(args = []) {
  const now = todayIso();
  const m = /^(\d{4})-(\d{2})$/.exec(args[0] || '');
  cur = m ? { y: Number(m[1]), m: Number(m[2]) } : { y: Number(now.slice(0, 4)), m: Number(now.slice(5, 7)) };
  app().innerHTML = `<div id="ph"></div>
    <div class="page-head"><h1>${t('nav_calendar')}</h1>
      <div class="page-actions no-print"><button type="button" class="btn-sm" id="print">&#128424; ${t('print')}</button></div></div>
    <div class="card"><div class="cal-head">
      <button type="button" class="btn-sm" id="prev" aria-label="${t('prev_month')}">&#8249;</button>
      <h2>${esc(fmt.month(cur.y, cur.m))}</h2>
      <button type="button" class="btn-sm" id="next" aria-label="${t('next_month')}">&#8250;</button></div>
      <div id="cal"><div class="empty"><span class="spinner"></span></div></div>
      <div class="cal-legend"><span><i class="complete"></i>${t('st_complete')}</span><span><i class="draft"></i>${t('st_draft')}</span>
        <span><i class="missing"></i>${t('st_missing')}</span><span><i class="closed"></i>${t('st_closed')}</span></div></div>
    <div class="card" id="cal-sum"></div>`;
  $('#ph').innerHTML = printHeader(t('nav_calendar'), fmt.month(cur.y, cur.m));
  const shift = (n) => { let y = cur.y; let mm = cur.m + n; if (mm < 1) { mm = 12; y--; } if (mm > 12) { mm = 1; y++; } location.hash = `#/calendar/${y}-${String(mm).padStart(2, '0')}`; };
  $('#prev').onclick = () => shift(-1);
  $('#next').onclick = () => shift(1);
  $('#print').onclick = () => window.print();
  await draw();
}

async function draw() {
  const pad = (n) => String(n).padStart(2, '0');
  const first = `${cur.y}-${pad(cur.m)}-01`;
  const nDays = new Date(cur.y, cur.m, 0).getDate();
  const last = `${cur.y}-${pad(cur.m)}-${pad(nDays)}`;
  const today = todayIso();
  const [days, report, weather] = await Promise.all([
    daysInRange(state.rest.id, first, last),
    reportDays(state.rest.id, first, last),
    ensureWeather(state.rest, first, last),
  ]);
  const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
  const revByDay = Object.fromEntries(report.map((r) => [r.day, Number(r.rev_food) + Number(r.rev_beverage) + Number(r.rev_other)]));
  const wByDay = Object.fromEntries(weather.map((w) => [w.day, w]));
  const lead = (new Date(cur.y, cur.m - 1, 1).getDay() + 6) % 7;
  const counts = { complete: 0, draft: 0, missing: 0, closed: 0 };
  let html = [1, 2, 3, 4, 5, 6, 7].map((w) => `<div class="cal-wd">${esc(fmt.weekdayShort(w))}</div>`).join('');
  html += '<div class="cal-day blank"></div>'.repeat(lead);
  for (let d = 1; d <= nDays; d++) {
    const iso = `${cur.y}-${pad(cur.m)}-${pad(d)}`;
    const st = dayStatus(iso, byDay[iso], state.meta, today);
    if (counts[st] != null) counts[st]++;
    const w = wByDay[iso];
    const rev = revByDay[iso];
    const note = closureNote(iso, state.meta);
    const cls = `${st === 'today' ? 'today' : st}${iso === today ? ' today' : ''}`;
    const clickable = iso <= today;
    html += `<button type="button" class="cal-day ${cls}" ${clickable ? `data-day="${iso}"` : 'disabled'} title="${esc(t('st_' + (st === 'today' ? 'open' : st)))}${note ? ` · ${esc(note)}` : ''}">
      <span class="d">${d}<span>${st === 'complete' ? '&#10003;' : ''}</span></span>
      <span class="w">${w ? `${weatherIcon(w.weather_code)} <span class="t">${fmt.num(Number(w.tmax), 0)}&deg;</span>` : ''}</span>
      <span class="r">${rev ? fmt.money(rev) : ''}</span></button>`;
  }
  $('#cal').innerHTML = `<div class="cal-grid">${html}</div>`;
  $$('[data-day]').forEach((b) => (b.onclick = () => { location.hash = `#/today/${b.dataset.day}`; }));
  const totalRev = Object.values(revByDay).reduce((a, b) => a + b, 0);
  const covers = report.reduce((a, r) => a + (Number(r.covers) || 0), 0);
  $('#cal-sum').innerHTML = `<div class="grid grid-kpi">
    <div class="kpi"><div class="label">${t('st_complete')}</div><div class="value txt-green">${counts.complete}</div></div>
    <div class="kpi"><div class="label">${t('st_draft')}</div><div class="value txt-amber">${counts.draft}</div></div>
    <div class="kpi"><div class="label">${t('st_missing')}</div><div class="value txt-red">${counts.missing}</div></div>
    <div class="kpi"><div class="label">${t('revenue_excl')}</div><div class="value">${fmt.money(totalRev)}</div></div>
    <div class="kpi"><div class="label">${t('step_covers')}</div><div class="value">${fmt.num(covers)}</div></div></div>`;
}
