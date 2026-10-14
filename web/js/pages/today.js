// Daily closing: the green path. Covers -> revenue -> purchases -> hours -> done.
// Target: about two minutes at closing time. Every change saves itself as a draft,
// so stopping halfway loses nothing. All amounts excluding VAT.
import { state, perm, app, esc, fmt, toast, toastError, todayIso, addDaysIso, $, $$, nameOf, parseAmount, round2, vatLabel, confirmDialog } from '../core.js';
import { t } from '../i18n.js';
import { sb, check, getDay, ensureDay, ensureWeather, remove } from '../data.js';
import { isOpen, closureNote } from '../calc.js';

const STEPS = ['covers', 'revenue', 'purchases', 'hours', 'done'];
const LS_VAT = 'wtfin_vatmode';
let s; // page state

function vatMode() { try { return localStorage.getItem(LS_VAT) || 'ex'; } catch { return 'ex'; } }
function setVatMode(m) { try { localStorage.setItem(LS_VAT, m); } catch { /* private mode */ } }

export async function renderToday(args = []) {
  const today = todayIso();
  let date = /^\d{4}-\d{2}-\d{2}$/.test(args[0] || '') ? args[0] : today;
  if (!perm.reports() && (date > today || date < addDaysIso(today, -1))) date = today;
  app().className = 'app narrow';
  app().innerHTML = `<div class="card empty"><span class="spinner"></span></div>`;
  const data = await getDay(state.rest.id, date);
  const d = data.day;
  s = {
    date, today,
    day: d,
    covers: d ? d.covers : null,
    expected: d ? d.expected_covers : null,
    revenue: Object.fromEntries(data.revenue.map((r) => [r.stream_id, Number(r.amount_ex)])),
    purchases: data.purchases,
    hours: Object.fromEntries(data.hours.map((h) => [h.staff_id, Number(h.hours)])),
    lastStep: d ? d.last_step : 0,
    step: 0,
    pending: {}, timers: {}, saving: 0,
    add: { supplierId: null, categoryId: null, amount: '', vat: null, note: '' },
  };
  // Pick up where it was left: first step that is not done yet
  if (d && d.status === 'complete') s.step = 4;
  else s.step = Math.min(STEPS.findIndex((k, i) => !stepDone(i)), 4);
  if (s.step < 0) s.step = 4;
  draw();
}

// ------------------------------------------------------------------ status per step
function stepDone(i) {
  switch (STEPS[i]) {
    case 'covers': return s.covers != null;
    case 'revenue': return Object.values(s.revenue).some((v) => v != null);
    case 'purchases': return s.purchases.length > 0 || s.lastStep > 2;
    case 'hours': return Object.values(s.hours).some((v) => v > 0);
    case 'done': return !!(s.day && s.day.status === 'complete');
    default: return false;
  }
}

// ------------------------------------------------------------------ saving (debounced, flushed on every step change)
function schedule(key, fn, wait = 600) {
  s.pending[key] = fn;
  clearTimeout(s.timers[key]);
  s.timers[key] = setTimeout(() => run(key), wait);
  showSave('saving');
}
async function run(key) {
  const fn = s.pending[key];
  if (!fn) return;
  delete s.pending[key];
  clearTimeout(s.timers[key]);
  s.saving++;
  showSave('saving');
  try { await fn(); showSave('saved'); }
  catch (e) { toastError(e); showSave('error'); }
  finally { s.saving--; }
}
async function flush() { await Promise.all(Object.keys(s.pending).map(run)); }
function showSave(st) {
  const el = $('#save-state');
  if (!el) return;
  el.textContent = st === 'saving' ? t('saving') : st === 'saved' ? t('saved_draft') : st === 'error' ? t('save_failed') : '';
}
let dayPromise = null;
async function day() {
  if (s.day) return s.day;
  if (!dayPromise) dayPromise = ensureDay(state.rest, s.date).finally(() => { dayPromise = null; });
  s.day = await dayPromise;
  return s.day;
}
async function patchDay(patch) {
  const d = await day();
  s.day = check(await sb.from('fin_days').update(patch).eq('id', d.id).select().single());
}

// ------------------------------------------------------------------ page
function draw() {
  const isToday = s.date === s.today;
  const yesterday = addDaysIso(s.today, -1);
  const closed = !isOpen(s.date, state.meta);
  const note = closureNote(s.date, state.meta);
  app().innerHTML = `
    <div class="page-head"><div><h1>${t('today_title')}</h1>
      <div class="muted small">${esc(fmt.dayLong(s.date))}${isToday ? ` · ${t('today')}` : ''}</div></div></div>
    <div class="date-chips">
      <button type="button" class="chip ${isToday ? 'on' : ''}" data-date="${s.today}">${t('today')}</button>
      <button type="button" class="chip ${s.date === yesterday ? 'on' : ''}" data-date="${yesterday}">${t('yesterday')}</button>
      ${perm.reports() ? `<input type="date" id="pick-date" value="${s.date}" max="${s.today}" style="width:auto">` : ''}
    </div>
    ${closed ? `<div class="note" style="margin:-4px 0 14px">${t('closed_day_note')}${note ? ` (${esc(note)})` : ''}</div>` : ''}
    <div class="path-bar">${STEPS.map((k, i) => `<button type="button" class="path-seg ${i === s.step ? 'current' : stepDone(i) ? 'done' : ''}" data-step="${i}">
      <span>${i + 1}. ${t('step_' + k)}</span></button>`).join('')}</div>
    <div class="path-label">${t('step_of', { n: s.step + 1, k: t('step_' + STEPS[s.step]) })}</div>
    <section class="card path-step" id="step"></section>
    <div class="save-state" id="save-state"></div>`;
  $$('[data-date]').forEach((b) => (b.onclick = async () => { await flush(); location.hash = `#/today/${b.dataset.date}`; }));
  const pick = $('#pick-date');
  if (pick) pick.onchange = async () => { if (pick.value) { await flush(); location.hash = `#/today/${pick.value}`; } };
  $$('[data-step]').forEach((b) => (b.onclick = () => go(Number(b.dataset.step))));
  drawStep();
}

async function go(i) {
  await flush();
  if (i > s.step && s.lastStep < i && s.day) { s.lastStep = i; patchDay({ last_step: i }).catch(toastError); }
  else if (i > s.step) s.lastStep = Math.max(s.lastStep, i);
  s.step = i;
  draw();
  window.scrollTo(0, 0);
}

function navButtons(nextLabel, { back = true, skip = false } = {}) {
  return `<div class="path-nav ${back && s.step > 0 ? '' : 'single'}">
    ${back && s.step > 0 ? `<button type="button" class="btn-xl" id="back">${t('back')}</button>` : ''}
    <button type="button" class="btn-primary btn-xl" id="next">${esc(nextLabel || t('next'))}</button></div>
    ${skip ? `<div style="text-align:center;margin-top:10px"><button type="button" class="link-btn" id="skip">${t('nothing_came_in')}</button></div>` : ''}`;
}
function bindNav(onNext) {
  const back = $('#back'); if (back) back.onclick = () => go(s.step - 1);
  $('#next').onclick = onNext || (() => go(s.step + 1));
  const skip = $('#skip'); if (skip) skip.onclick = () => go(s.step + 1);
}

function drawStep() {
  ({ covers: stepCovers, revenue: stepRevenue, purchases: stepPurchases, hours: stepHours, done: stepDoneView })[STEPS[s.step]]();
}

// ------------------------------------------------------------------ 1. covers
function stepCovers() {
  const el = $('#step');
  el.innerHTML = `<h2>${t('covers_q')}</h2><p class="lead">${t('covers_lead')}</p>
    <div class="stepper"><button type="button" id="minus" aria-label="-1">&minus;</button>
      <input class="big-num" id="covers" inputmode="numeric" pattern="[0-9]*" value="${s.covers ?? ''}" placeholder="0" autocomplete="off">
      <button type="button" id="plus" aria-label="+1">+</button></div>
    <details class="more" style="margin-top:16px" ${s.expected != null ? 'open' : ''}><summary>${t('expected_covers')}</summary>
      <div class="field"><input id="expected" inputmode="numeric" value="${s.expected ?? ''}" placeholder="${t('expected_hint')}"></div></details>
    ${navButtons()}`;
  const inp = $('#covers');
  const save = () => schedule('covers', () => patchDay({ covers: s.covers, expected_covers: s.expected }));
  const set = (v) => { s.covers = v; inp.value = v ?? ''; save(); };
  inp.oninput = () => { const n = parseInt(inp.value.replace(/\D/g, ''), 10); s.covers = Number.isNaN(n) ? null : n; save(); };
  $('#minus').onclick = () => set(Math.max(0, (s.covers || 0) - 1));
  $('#plus').onclick = () => set((s.covers || 0) + 1);
  $('#expected').oninput = (e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); s.expected = Number.isNaN(n) ? null : n; save(); };
  bindNav(() => {
    if (s.covers == null) { toastError(new Error(t('covers_needed'))); inp.focus(); return; }
    go(1);
  });
  if (s.covers == null) inp.focus();
}

// ------------------------------------------------------------------ 2. revenue
function stepRevenue() {
  const el = $('#step');
  const streams = state.meta.streams.filter((x) => x.active || s.revenue[x.id] != null);
  const mode = vatMode();
  const shown = (st) => {
    const v = s.revenue[st.id];
    if (v == null) return '';
    return String(round2(mode === 'inc' ? v * (1 + Number(st.vat_rate)) : v)).replace('.', ',');
  };
  el.innerHTML = `<div class="split"><h2>${t('revenue_q')}</h2>
      <div class="vat-mode" role="group"><button type="button" data-mode="ex" class="${mode === 'ex' ? 'on' : ''}">${t('excl_vat')}</button>
      <button type="button" data-mode="inc" class="${mode === 'inc' ? 'on' : ''}">${t('incl_vat')}</button></div></div>
    <p class="lead">${mode === 'ex' ? t('revenue_lead_ex') : t('revenue_lead_inc')}</p>
    <div class="money-list">${streams.map((st) => `<div class="money-row"><div class="name">${esc(nameOf(st))}<span class="tiny">${vatLabel(st.vat_rate)}</span></div>
      <div class="money-in"><input data-stream="${st.id}" inputmode="decimal" value="${shown(st)}" placeholder="0" autocomplete="off"></div></div>`).join('')}</div>
    <div class="total-line"><span>${t('total_excl')}</span><span id="rev-total"></span></div>
    ${navButtons()}`;
  const total = () => { $('#rev-total').textContent = fmt.money2(Object.values(s.revenue).reduce((a, b) => a + (b || 0), 0)); };
  total();
  $$('[data-mode]', el).forEach((b) => (b.onclick = () => { setVatMode(b.dataset.mode); stepRevenue(); }));
  $$('[data-stream]', el).forEach((inp) => (inp.oninput = () => {
    const st = streams.find((x) => x.id === inp.dataset.stream);
    const v = parseAmount(inp.value);
    const ex = v == null ? null : round2(vatMode() === 'inc' ? v / (1 + Number(st.vat_rate)) : v);
    if (ex == null) delete s.revenue[st.id]; else s.revenue[st.id] = ex;
    total();
    schedule('rev:' + st.id, async () => {
      const d = await day();
      if (ex == null) check(await sb.from('fin_day_revenue').delete().eq('day_id', d.id).eq('stream_id', st.id));
      else check(await sb.from('fin_day_revenue').upsert({ day_id: d.id, stream_id: st.id, amount_ex: ex, vat_rate: st.vat_rate,
        organization_id: state.rest.organization_id, restaurant_id: state.rest.id }, { onConflict: 'day_id,stream_id' }));
    });
  }));
  bindNav();
  const first = $('[data-stream]', el); if (first && !Object.keys(s.revenue).length) first.focus();
}

// ------------------------------------------------------------------ 3. purchases
function stepPurchases() {
  const el = $('#step');
  const m = state.meta;
  const cats = m.categories.filter((c) => c.active);
  const sups = m.suppliers.filter((x) => x.active);
  const a = s.add;
  const cat = cats.find((c) => c.id === a.categoryId);
  const mode = vatMode();
  const supName = (id) => (m.suppliers.find((x) => x.id === id) || {}).name || t('no_supplier');
  const catName = (id) => nameOf(m.categories.find((x) => x.id === id));
  const sum = s.purchases.reduce((x, p) => x + Number(p.amount_ex), 0);
  el.innerHTML = `<h2>${t('purchases_q')}</h2><p class="lead">${t('purchases_lead')}</p>
    ${s.purchases.length ? `<ul class="purchase-list">${s.purchases.map((p) => `<li><div><strong>${esc(supName(p.supplier_id))}</strong>
      <div class="small muted">${esc(catName(p.category_id))} · ${vatLabel(p.vat_rate)}${p.note ? ` · ${esc(p.note)}` : ''}</div></div>
      <div style="display:flex;gap:8px;align-items:center"><span class="amt">${fmt.money2(Number(p.amount_ex))}</span>
      <button type="button" class="btn-sm btn-ghost btn-danger" data-del="${p.id}" aria-label="${t('delete')}">&times;</button></div></li>`).join('')}</ul>
      <div class="total-line" style="margin-bottom:16px"><span>${t('total_excl')}</span><span>${fmt.money2(sum)}</span></div>` : ''}
    <div class="add-box">
      <div class="subhead" style="margin-top:0">${t('supplier')}</div>
      <div class="tiles">${sups.map((x) => `<button type="button" class="tile ${a.supplierId === x.id ? 'on' : ''}" data-sup="${x.id}">${esc(x.name)}</button>`).join('')}
        <button type="button" class="tile ${a.supplierId === 'none' ? 'on' : ''}" data-sup="none">${t('other_supplier')}</button></div>
      ${!sups.length ? `<div class="small muted" style="margin-top:6px">${t('no_suppliers_yet')}</div>` : ''}
      <div class="subhead">${t('category')}</div>
      <div class="chips">${cats.map((c) => `<button type="button" class="chip ${a.categoryId === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(nameOf(c))}</button>`).join('')}</div>
      <div class="field-row" style="margin-top:14px">
        <div><label>${mode === 'inc' ? t('amount_inc') : t('amount_ex')}</label><div class="money-in"><input id="p-amount" inputmode="decimal" value="${esc(a.amount)}" placeholder="0" autocomplete="off"></div></div>
        <div><label>${t('vat')}</label><select id="p-vat">${m.vat.map((v) => `<option value="${v.rate}" ${Number(a.vat ?? (cat ? cat.vat_rate : 0.09)) === Number(v.rate) ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
      </div>
      <div class="field" style="margin-top:10px"><input id="p-note" value="${esc(a.note)}" placeholder="${t('note_optional')}"></div>
      <div class="split"><div class="vat-mode" role="group"><button type="button" data-mode="ex" class="${mode === 'ex' ? 'on' : ''}">${t('excl_vat')}</button>
        <button type="button" data-mode="inc" class="${mode === 'inc' ? 'on' : ''}">${t('incl_vat')}</button></div>
        <button type="button" class="btn-primary" id="p-add">+ ${t('add_delivery')}</button></div>
    </div>
    ${navButtons(null, { skip: !s.purchases.length })}`;
  $$('[data-sup]', el).forEach((b) => (b.onclick = () => {
    a.supplierId = b.dataset.sup === 'none' ? 'none' : b.dataset.sup;
    const sup = sups.find((x) => x.id === a.supplierId);
    if (sup && sup.category_id) { a.categoryId = sup.category_id; a.vat = null; }
    keepInputs(); stepPurchases(); $('#p-amount').focus();
  }));
  $$('[data-cat]', el).forEach((b) => (b.onclick = () => { a.categoryId = b.dataset.cat; a.vat = null; keepInputs(); stepPurchases(); }));
  $$('[data-mode]', el).forEach((b) => (b.onclick = () => { keepInputs(); setVatMode(b.dataset.mode); stepPurchases(); }));
  $('#p-vat').onchange = (e) => { a.vat = Number(e.target.value); };
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(t('confirm_delete_delivery'), t('delete')))) return;
    try { await remove('fin_purchases', b.dataset.del); s.purchases = s.purchases.filter((p) => p.id !== b.dataset.del); stepPurchases(); }
    catch (e) { toastError(e); }
  }));
  $('#p-add').onclick = addPurchase;
  bindNav();
}
function keepInputs() {
  const amt = $('#p-amount'); const note = $('#p-note');
  if (amt) s.add.amount = amt.value;
  if (note) s.add.note = note.value;
}
async function addPurchase() {
  keepInputs();
  const a = s.add;
  const v = parseAmount(a.amount);
  if (!a.categoryId) return toastError(new Error(t('pick_category')));
  if (v == null || v === 0) { $('#p-amount').focus(); return toastError(new Error(t('fill_amount'))); }
  const vat = Number($('#p-vat').value);
  const ex = round2(vatMode() === 'inc' ? v / (1 + vat) : v);
  const btn = $('#p-add'); btn.disabled = true;
  try {
    const d = await day();
    const row = check(await sb.from('fin_purchases').insert({
      day_id: d.id, category_id: a.categoryId, supplier_id: a.supplierId && a.supplierId !== 'none' ? a.supplierId : null,
      amount_ex: ex, vat_rate: vat, note: a.note || null, organization_id: state.rest.organization_id, restaurant_id: state.rest.id,
    }).select().single());
    s.purchases.push(row);
    s.add = { supplierId: null, categoryId: null, amount: '', vat: null, note: '' };
    toast(t('delivery_added'));
    stepPurchases();
  } catch (e) { toastError(e); btn.disabled = false; }
}

// ------------------------------------------------------------------ 4. hours
// Suggested hours per person from the team app: clocked hours first, otherwise planned (roster).
// Only people linked to a team app login (Settings, Staff and rates) get a suggestion.
async function loadSuggestions() {
  if (s.suggest) return s.suggest;
  try {
    const rows = check(await sb.rpc('fin_day_hours_suggestion', { p_rest: state.rest.id, p_day: s.date })) || [];
    s.suggest = Object.fromEntries(rows.map((r) => [r.staff_id, { planned: Number(r.planned) || 0, clocked: Number(r.clocked) || 0 }]));
  } catch { s.suggest = {}; }
  return s.suggest;
}
const quarter = (h) => Math.round(h * 4) / 4;
function suggestedValue(sg) { return sg ? (sg.clocked > 0 ? quarter(sg.clocked) : sg.planned > 0 ? quarter(sg.planned) : 0) : 0; }
function saveHour(id, v) {
  schedule('h:' + id, async () => {
    const d = await day();
    if (v == null) check(await sb.from('fin_hours').delete().eq('day_id', d.id).eq('staff_id', id));
    else check(await sb.from('fin_hours').upsert({ day_id: d.id, staff_id: id, hours: v,
      organization_id: state.rest.organization_id, restaurant_id: state.rest.id }, { onConflict: 'day_id,staff_id' }));
  });
}
function applySuggestions() {
  let n = 0;
  for (const [id, sg] of Object.entries(s.suggest || {})) {
    const v = suggestedValue(sg);
    if (v > 0 && s.hours[id] !== v) { s.hours[id] = v; saveHour(id, v); n++; }
  }
  return n;
}

async function stepHours() {
  const el = $('#step');
  if (!s.suggest) {
    el.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
    await loadSuggestions();
    if (STEPS[s.step] !== 'hours') return; // moved on meanwhile
    // Nothing entered yet: fill in from the team app, staff only check and adjust
    if (!Object.keys(s.hours).length && applySuggestions()) s.prefilled = true;
  }
  const sug = s.suggest || {};
  const hasSuggestions = Object.values(sug).some((x) => x.planned > 0 || x.clocked > 0);
  const people = state.meta.staff.filter((p) => p.active || s.hours[p.id] != null);
  const team = people.filter((p) => !p.is_partner);
  const partners = people.filter((p) => p.is_partner);
  const hint = (p) => {
    const sg = sug[p.id];
    if (!sg || (!sg.planned && !sg.clocked)) return '';
    return `<span class="tiny muted">${[sg.clocked ? t('h_clocked', { h: fmt.num(sg.clocked, 2) }) : '', sg.planned ? t('h_planned', { h: fmt.num(sg.planned, 2) }) : ''].filter(Boolean).join(' · ')}</span>`;
  };
  const row = (p) => `<div class="hours-row ${s.hours[p.id] > 0 ? 'on' : ''}"><div class="name"><strong>${esc(p.name)}</strong>${hint(p) ? `<br>${hint(p)}` : ''}</div>
    <input data-staff="${p.id}" inputmode="decimal" value="${s.hours[p.id] != null ? String(s.hours[p.id]).replace('.', ',') : ''}" placeholder="0" autocomplete="off" aria-label="${t('hours')}"></div>`;
  const total = () => Object.values(s.hours).reduce((a, b) => a + (b || 0), 0);
  el.innerHTML = `<h2>${t('hours_q')}</h2><p class="lead">${t('hours_lead')}</p>
    ${s.prefilled ? `<div class="note" style="margin:0 0 10px">${t('hours_prefilled')}</div>` : ''}
    ${hasSuggestions && !s.prefilled ? `<div style="margin:0 0 10px"><button type="button" class="btn-sm" id="use-sug">&#8635; ${t('hours_use_suggestions')}</button></div>` : ''}
    ${team.length ? `<div class="subhead">${t('team')}</div>${team.map(row).join('')}` : `<div class="small muted">${t('no_staff_yet')}</div>`}
    ${partners.length ? `<div class="subhead">${t('partners')}</div>${partners.map(row).join('')}` : ''}
    <div class="total-line"><span>${t('total_hours')}</span><span id="h-total">${fmt.num(total(), 2)}</span></div>
    ${navButtons()}`;
  const use = $('#use-sug', el);
  if (use) use.onclick = () => { applySuggestions(); s.prefilled = true; stepHours(); };
  $$('[data-staff]', el).forEach((inp) => (inp.oninput = () => {
    const id = inp.dataset.staff;
    let v = parseAmount(inp.value);
    if (v != null && (v < 0 || v > 24)) { toastError(new Error(t('hours_range'))); return; }
    if (v === 0) v = null;
    if (v == null) delete s.hours[id]; else s.hours[id] = v;
    inp.closest('.hours-row').classList.toggle('on', v > 0);
    $('#h-total').textContent = fmt.num(total(), 2);
    saveHour(id, v);
  }));
  bindNav();
}

// ------------------------------------------------------------------ 5. done
function stepDoneView() {
  const el = $('#step');
  const complete = s.day && s.day.status === 'complete';
  const rev = Object.values(s.revenue).reduce((a, b) => a + (b || 0), 0);
  const pur = s.purchases.reduce((a, p) => a + Number(p.amount_ex), 0);
  const hrs = Object.values(s.hours).reduce((a, b) => a + (b || 0), 0);
  const box = (label, value, missing, step) => `<div class="${missing ? 'missing' : ''}"><div class="label">${label}</div>
    <div class="value">${value}</div>${missing ? `<button type="button" class="link-btn small" data-goto="${step}">${t('fill_in')}</button>` : ''}</div>`;
  el.innerHTML = complete ? `<div class="done-hero"><div class="done-check">&#10003;</div><h2>${t('day_closed')}</h2>
      <p class="lead">${t('day_closed_lead')}</p></div>` : `<h2>${t('check_title')}</h2><p class="lead">${t('check_lead')}</p>`;
  el.innerHTML += `<div class="sum-grid">
      ${box(t('step_covers'), s.covers ?? '–', s.covers == null, 0)}
      ${box(t('revenue_excl'), fmt.money2(rev), rev === 0, 1)}
      ${box(t('purchases_excl'), `${fmt.money2(pur)} <span class="small muted">(${s.purchases.length})</span>`, false, 2)}
      ${box(t('hours'), fmt.num(hrs, 2), hrs === 0, 3)}
    </div>
    ${complete ? `<div class="path-nav single"><button type="button" class="btn-xl" data-goto="0">${t('make_change')}</button></div>`
      : `<div class="path-nav"><button type="button" class="btn-xl" id="back">${t('back')}</button>
         <button type="button" class="btn-primary btn-xl" id="close-day">&#10003; ${t('close_day')}</button></div>`}
    ${s.day && perm.settings() ? `<div class="del-day"><button type="button" class="btn-ghost btn-danger btn-sm" id="del-day">&#128465; ${t('delete_day')}</button></div>` : ''}`;
  // Managers: wipe this day completely (covers, revenue, purchases, hours) and start over
  const del = $('#del-day');
  if (del) del.onclick = async () => {
    if (!(await confirmDialog(t('delete_day_confirm', { d: fmt.dayLong(s.date) }), t('delete_day')))) return;
    Object.values(s.timers).forEach(clearTimeout);
    s.pending = {};
    try { await remove('fin_days', s.day.id); toast(t('day_deleted')); renderToday([s.date]); } catch (e) { toastError(e); }
  };
  $$('[data-goto]', el).forEach((b) => (b.onclick = () => go(Number(b.dataset.goto))));
  const back = $('#back'); if (back) back.onclick = () => go(3);
  const btn = $('#close-day');
  if (btn) btn.onclick = async () => {
    if (s.covers == null) { toastError(new Error(t('covers_needed'))); return go(0); }
    if (rev === 0 && !(await confirmDialog(t('confirm_no_revenue'), t('close_day'), false))) return;
    btn.disabled = true;
    try {
      await flush();
      await patchDay({ status: 'complete', last_step: 4 });
      ensureWeather(state.rest, s.date, s.date);
      draw();
    } catch (e) { toastError(e); btn.disabled = false; }
  };
}
