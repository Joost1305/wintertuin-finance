// Calendar: one glance at which days are entered. Green complete, amber partly, red missing,
// grey closed (opening hours). Weather per day. Tap a day to open or correct it.
import { state, perm, app, esc, fmt, toast, toastError, todayIso, $, $$, printHeader, refreshMeta, openModal } from '../core.js';
import { isOpen } from '../calc.js';
import { t } from '../i18n.js';
import { sb, daysInRange, reportDays, ensureWeather } from '../data.js';
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
        <span><i class="missing"></i>${t('st_missing')}</span><span><i class="closed"></i>${t('st_closed_or_quiet')}</span></div>
      <div class="tiny muted" style="margin-top:6px">${t('cal_missing_rule')}${perm.settings() ? ` ${t('cal_toggle_hint')}` : ''}</div></div>
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
  const [days, report, weather, worked] = await Promise.all([
    daysInRange(state.rest.id, first, last),
    reportDays(state.rest.id, first, last),
    ensureWeather(state.rest, first, last),
    // Who worked (roster or clock-in in the team app). If that cannot be read, fall back to the opening hours.
    sb.rpc('fin_worked_days', { p_rest: state.rest.id, p_from: first, p_to: last })
      .then(({ data, error }) => (error ? null : new Set((data || []).map((r) => r.day)))).catch(() => null),
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
    const st = dayStatus(iso, byDay[iso], state.meta, today, worked);
    if (counts[st] != null) counts[st]++;
    const w = wByDay[iso];
    const rev = revByDay[iso];
    const note = closureNote(iso, state.meta);
    const cls = `${st === 'today' ? 'today' : st === 'quiet' ? 'closed quiet' : st}${iso === today ? ' today' : ''}`;
    const clickable = iso <= today;
    const openNow = isOpen(iso, state.meta);
    const toggle = perm.settings() ? `<button type="button" class="cal-toggle ${openNow ? 'is-open' : 'is-closed'}" data-toggle="${iso}"
      title="${t(openNow ? 'day_click_close' : 'day_click_open')}">${t(openNow ? 'open' : 'closed')}</button>
      <button type="button" class="cal-note-btn ${note ? 'has-note' : ''}" data-note="${iso}" title="${t(note ? 'day_note_edit' : 'day_note_add')}" aria-label="${t(note ? 'day_note_edit' : 'day_note_add')}">&#9998;</button>` : '';
    html += `<div class="cal-day ${cls}" ${clickable ? `data-day="${iso}" role="button" tabindex="0"` : 'aria-disabled="true"'} title="${esc(t('st_' + (st === 'today' ? 'open' : st)))}${note ? ` · ${esc(note)}` : ''}">
      <span class="d">${d}<span>${st === 'complete' ? '&#10003;' : ''}</span></span>
      <span class="w">${w ? `${weatherIcon(w.weather_code)} <span class="t">${fmt.num(Number(w.tmax), 0)}&deg;</span>` : ''}</span>
      ${note ? `<span class="n">${esc(note)}</span>` : ''}
      <span class="r">${rev ? fmt.money(rev) : ''}</span>${toggle ? `<span class="cal-tools">${toggle}</span>` : ''}</div>`;
  }
  $('#cal').innerHTML = `<div class="cal-grid">${html}</div>`;
  $$('[data-day]').forEach((b) => {
    b.onclick = () => { location.hash = `#/today/${b.dataset.day}`; };
    b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } };
  });
  // Managers: open or close a day with one click (same switch as in the team app roster)
  $$('[data-toggle]').forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const iso = b.dataset.toggle; const openNow = isOpen(iso, state.meta);
    b.disabled = true;
    try {
      const ex = (state.meta.closures || []).find((c) => c.day === iso);
      const { error } = await sb.rpc('fin_set_day_open', { p_day: iso, p_open: !openNow, p_note: ex ? ex.note : null });
      if (error) throw error;
      await refreshMeta();
      toast(t(openNow ? 'day_now_closed' : 'day_now_open', { d: fmt.dayShort(iso) }));
      draw();
    } catch (err) { toastError(err); b.disabled = false; }
  }));
  $$('[data-note]').forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const iso = b.dataset.note;
    const ex = (state.meta.closures || []).find((c) => c.day === iso);
    const v = await editDayNote(fmt.dayShort(iso), ex ? ex.note : '');
    if (v === null) return;
    try {
      const { error } = await sb.rpc('fin_set_day_open', { p_day: iso, p_open: isOpen(iso, state.meta), p_note: v || null });
      if (error) throw error;
      await refreshMeta(); toast(t('saved')); draw();
    } catch (err) { toastError(err); }
  }));
  const totalRev = Object.values(revByDay).reduce((a, b) => a + b, 0);
  const covers = report.reduce((a, r) => a + (Number(r.covers) || 0), 0);
  $('#cal-sum').innerHTML = `<div class="grid grid-kpi">
    <div class="kpi"><div class="label">${t('st_complete')}</div><div class="value txt-green">${counts.complete}</div></div>
    <div class="kpi"><div class="label">${t('st_draft')}</div><div class="value txt-amber">${counts.draft}</div></div>
    <div class="kpi"><div class="label">${t('st_missing')}</div><div class="value txt-red">${counts.missing}</div></div>
    <div class="kpi"><div class="label">${t('revenue_excl')}</div><div class="value">${fmt.money(totalRev)}</div></div>
    <div class="kpi"><div class="label">${t('step_covers')}</div><div class="value">${fmt.num(covers)}</div></div></div>`;
}

// Small popup to add, change or remove the note of one day (themed evening, private event, ...)
function editDayNote(dayLabel, current) {
  return new Promise((resolve) => {
    openModal(`<h2>${t('day_note_title', { d: esc(dayLabel) })}</h2><form id="nf">
      <div class="field"><input name="v" maxlength="60" value="${esc(current || '')}" placeholder="${t('day_note_ph')}"></div>
      <div class="tiny muted" style="margin:-6px 0 12px">${t('day_note_hint')}</div>
      <div class="modal-actions" style="justify-content:space-between">
        <div>${current ? `<button type="button" class="btn-ghost btn-danger" id="nclear">${t('day_note_clear')}</button>` : ''}</div>
        <div style="display:flex;gap:8px"><button type="button" id="ncancel">${t('cancel')}</button><button class="btn-primary" type="submit">${t('save')}</button></div></div></form>`,
    (card, close) => {
      const inp = card.querySelector('[name=v]'); inp.focus(); inp.select();
      card.querySelector('#nf').onsubmit = (e) => { e.preventDefault(); close(); resolve(inp.value.trim()); };
      card.querySelector('#ncancel').onclick = () => { close(); resolve(null); };
      const clr = card.querySelector('#nclear'); if (clr) clr.onclick = () => { close(); resolve(''); };
    });
  });
}
