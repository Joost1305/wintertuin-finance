// Settings: staff and rates, revenue streams, purchase categories, suppliers, VAT, opening hours,
// closed days, targets, fixed costs, restaurant, users and audit log.
// Managers manage the daily lists; org admins also targets, fixed costs, restaurant and users.
import { state, perm, app, esc, fmt, toast, toastError, todayIso, $, $$, nameOf, openModal, confirmDialog, formHtml, readForm, round2, refreshMeta, employeeView } from '../core.js';
import { t } from '../i18n.js';
import { sb, check, list, insert, update, remove, adminUsers, setPassword } from '../data.js';
import { seasonOf } from '../calc.js';
import { renderVat } from './vat.js';

const SECTIONS = [
  { id: 'staff', label: 'set_staff', show: perm.settings },
  { id: 'streams', label: 'set_streams', show: perm.settings },
  { id: 'categories', label: 'set_categories', show: perm.settings },
  { id: 'suppliers', label: 'set_suppliers', show: perm.settings },
  { id: 'vatreport', label: 'set_vat_report', show: perm.reports },
  { id: 'vat', label: 'set_vat', show: perm.settings },
  { id: 'hours', label: 'set_hours', show: perm.settings },
  { id: 'closures', label: 'set_closures', show: perm.settings },
  { id: 'targets', label: 'set_targets', show: perm.settings },
  { id: 'fixed', label: 'set_fixed', show: perm.settings },
  { id: 'restaurant', label: 'set_restaurant', show: perm.admin },
  { id: 'users', label: 'set_users', show: perm.admin },
  { id: 'audit', label: 'set_audit', show: perm.admin },
  { id: 'password', label: 'set_password', show: perm.settings },
];

export async function renderSettings(args = []) {
  const sections = SECTIONS.filter((x) => x.show());
  const wanted = args[0];
  const narrow = window.matchMedia('(max-width: 820px)').matches;
  const current = sections.find((x) => x.id === wanted) || (narrow ? null : sections[0]);
  app().innerHTML = `<div class="page-head"><h1>${t('nav_settings')}</h1>
      <div class="page-actions"><button type="button" class="btn-sm" id="emp-on" title="${t('emp_view_hint')}">&#128065; ${t('emp_view')}</button></div></div>
    <div class="settings ${current ? 'has-section' : 'menu-only'}">
      <nav class="settings-nav">${sections.map((x) => `<a href="#/settings/${x.id}" class="${current && x.id === current.id ? 'active' : ''}">${t(x.label)}</a>`).join('')}</nav>
      <div class="settings-main">${current ? `<a class="settings-back" href="#/settings">&#8249; ${t('nav_settings')}</a><div id="sec"></div>` : ''}</div>
    </div>`;
  $('#emp-on').onclick = () => { employeeView.set(true); location.hash = '#/today'; };
  if (!current) return;
  const fn = { vatreport: (el) => renderVat(args.slice(1), el), staff, streams, categories, suppliers, vat, hours, closures, targets, fixed, restaurant, users, audit, password }[current.id];
  try { await fn($('#sec')); } catch (e) { toastError(e); }
}

const rest = () => state.rest;
const base = () => ({ restaurant_id: rest().id, organization_id: rest().organization_id });
const pctOpts = () => state.meta.vat.map((v) => ({ value: String(Number(v.rate)), label: v.label }));
const yesNo = (b) => (b ? '&#10003;' : '–');
async function reload(el, fn) { await refreshMeta(); await fn(el); }

// Generic list with add / edit / delete in a modal
function crud(el, { title, sub, rows, columns, fields, toRow, fromRow, table, onSaved, canEdit = true, canDelete = true, addLabel }) {
  el.innerHTML = `<div class="card"><div class="split"><div><h2 style="margin:0">${title}</h2>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>
      ${canEdit ? `<button type="button" class="btn-primary btn-sm" id="add">+ ${addLabel || t('add')}</button>` : ''}</div>
    <div class="table-wrap" style="margin-top:12px"><table class="stack"><thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join('')}${canEdit ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td data-label="${esc(c.label)}">${c.html(r)}</td>`).join('')}
      ${canEdit ? `<td class="actions"><button type="button" class="btn-sm" data-edit="${r.id}">${t('edit')}</button>
        ${canDelete ? `<button type="button" class="btn-sm btn-ghost btn-danger" data-del="${r.id}">${t('delete')}</button>` : ''}</td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${columns.length + 1}" class="empty">${t('nothing_yet')}</td></tr>`}</tbody></table></div></div>`;
  const open = (row) => {
    const vals = row ? (fromRow ? fromRow(row) : row) : {};
    openModal(`<h2>${row ? t('edit') : addLabel || t('add')}</h2><form id="f">${formHtml(fields, vals)}
      <div class="modal-actions"><button type="button" data-close>${t('cancel')}</button><button class="btn-primary" type="submit">${t('save')}</button></div></form>`,
    (card, close) => {
      card.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const v = readForm(card, fields);
        try {
          const payload = toRow ? toRow(v, row) : v;
          let saved;
          if (row) saved = await update(table, row.id, payload);
          else saved = await insert(table, { ...base(), ...payload });
          if (onSaved) await onSaved(saved, v, row);
          close(); toast(t('saved'));
          await refreshMeta();
          renderSettings(location.hash.replace(/^#\/settings\/?/, '').split('/'));
        } catch (err) { toastError(err); }
      };
    });
  };
  const add = $('#add', el); if (add) add.onclick = () => open(null);
  $$('[data-edit]', el).forEach((b) => (b.onclick = () => open(rows.find((r) => r.id === b.dataset.edit))));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(t('confirm_delete'), t('delete')))) return;
    try { await remove(table, b.dataset.del); toast(t('deleted')); await refreshMeta(); renderSettings(location.hash.replace(/^#\/settings\/?/, '').split('/')); }
    catch (err) { toastError(new Error(/foreign key|violates/i.test(err.message) ? t('in_use_deactivate') : err.message)); }
  }));
}

// ------------------------------------------------------------------ staff and hourly rates
async function staff(el) {
  const m = state.meta;
  const rateOf = (id) => { const today = todayIso(); const r = (m.rates || []).filter((x) => x.staff_id === id && x.valid_from <= today).pop(); return r ? Number(r.hourly_rate) : null; };
  // Team app accounts (same login system), to link people so their roster and clock-in hours flow into the daily closing
  const profiles = check(await sb.from('profiles').select('id, full_name, email, active').order('full_name')) || [];
  const profileName = (uid) => { const p = profiles.find((x) => x.id === uid); return p ? p.full_name : ''; };
  crud(el, {
    title: t('set_staff'), sub: t('set_staff_sub'), table: 'fin_staff', addLabel: t('add_person'),
    rows: m.staff,
    columns: [
      { label: t('name'), html: (r) => `<strong>${esc(r.name)}</strong>` },
      { label: t('type'), html: (r) => (r.is_partner ? `<span class="badge green">${t('partner')}</span>` : t('team_member')) },
      { label: t('hourly_rate'), html: (r) => { const v = rateOf(r.id); return v == null ? `<span class="muted">${t('not_set')}</span>` : fmt.money2(v); } },
      { label: t('team_app_account'), html: (r) => (r.user_id ? `&#128279; ${esc(profileName(r.user_id))}` : `<span class="muted">${t('not_linked')}</span>`) },
      { label: t('active'), html: (r) => yesNo(r.active) },
    ],
    fields: [
      { name: 'name', label: t('name'), required: true },
      { name: 'is_partner', label: t('is_partner'), type: 'checkbox' },
      { name: 'hourly_rate', label: t('hourly_rate_field'), type: 'number', hint: t('hourly_rate_hint') },
      { name: 'rate_from', label: t('rate_valid_from'), type: 'date', hint: t('rate_from_hint') },
      { name: 'user_id', label: t('team_app_account'), type: 'select', blank: true, blankLabel: t('not_linked'),
        options: profiles.map((p) => ({ value: p.id, label: `${p.full_name}${p.email ? ` (${p.email})` : ''}` })) },
      { name: 'sort_order', label: t('sort_order'), type: 'number' },
      { name: 'active', label: t('active'), type: 'checkbox' },
    ],
    fromRow: (r) => ({ ...r, hourly_rate: rateOf(r.id), rate_from: todayIso() }),
    toRow: (v, row) => ({ name: v.name, is_partner: !!v.is_partner, user_id: v.user_id || null, sort_order: v.sort_order || 0, active: row ? !!v.active : true }),
    onSaved: async (saved, v, row) => {
      if (v.hourly_rate == null) return;
      const old = row ? rateOf(row.id) : null;
      if (old != null && round2(old) === round2(v.hourly_rate)) return;
      const hasAny = (m.rates || []).some((x) => x.staff_id === saved.id);
      const from = hasAny ? (v.rate_from || todayIso()) : '2000-01-01'; // first rate covers everything before
      check(await sb.from('fin_staff_rates').upsert({ ...base(), staff_id: saved.id, hourly_rate: round2(v.hourly_rate), valid_from: from }, { onConflict: 'staff_id,valid_from' }));
    },
    canDelete: false,
  });
  // Import: link people with the same name, add the rest of the active team app accounts as new people
  const linked = new Set(m.staff.map((x) => x.user_id).filter(Boolean));
  const todo = profiles.filter((p) => p.active !== false && !linked.has(p.id));
  const box = document.createElement('div');
  box.className = 'card';
  box.innerHTML = `<div class="split"><div><h2 style="margin:0">${t('import_team_title')}</h2><div class="small muted">${t('import_team_sub')}</div></div>
    <button type="button" class="btn-sm" id="import-team" ${todo.length ? '' : 'disabled'}>${t('import_team_btn', { n: todo.length })}</button></div>`;
  el.appendChild(box);
  const btn = box.querySelector('#import-team');
  btn.onclick = async () => {
    if (!(await confirmDialog(t('import_team_confirm', { n: todo.length }), t('import_team_ok'), false))) return;
    btn.disabled = true;
    try {
      for (const p of todo) {
        const same = m.staff.find((x) => !x.user_id && x.name.trim().toLowerCase() === p.full_name.trim().toLowerCase());
        if (same) check(await sb.from('fin_staff').update({ user_id: p.id }).eq('id', same.id));
        else check(await sb.from('fin_staff').insert({ ...base(), name: p.full_name, user_id: p.id, is_partner: false, sort_order: 50, active: true }));
      }
      toast(t('saved')); await reload(el, staff);
    } catch (err) { toastError(err); btn.disabled = false; }
  };
}

// ------------------------------------------------------------------ revenue streams
async function streams(el) {
  const groups = [{ value: 'food', label: t('kpi_food') }, { value: 'beverage', label: t('kpi_beverage') }, { value: 'other', label: t('kpi_other') }];
  crud(el, {
    title: t('set_streams'), sub: t('set_streams_sub'), table: 'fin_revenue_streams',
    rows: state.meta.streams,
    columns: [
      { label: t('name'), html: (r) => `<strong>${esc(nameOf(r))}</strong>` },
      { label: t('vat'), html: (r) => fmt.pct(Number(r.vat_rate), 0) },
      { label: t('counts_as'), html: (r) => esc((groups.find((g) => g.value === r.kpi_group) || {}).label) },
      { label: t('active'), html: (r) => yesNo(r.active) },
    ],
    fields: [
      { name: 'name_en', label: t('name_en'), required: true }, { name: 'name_nl', label: t('name_nl'), required: true },
      { name: 'vat_rate', label: t('vat'), type: 'select', options: pctOpts() },
      { name: 'kpi_group', label: t('counts_as'), type: 'select', options: groups },
      { name: 'sort_order', label: t('sort_order'), type: 'number' }, { name: 'active', label: t('active'), type: 'checkbox' },
    ],
    fromRow: (r) => ({ ...r, vat_rate: String(Number(r.vat_rate)) }),
    toRow: (v, row) => ({ name_en: v.name_en, name_nl: v.name_nl, vat_rate: Number(v.vat_rate), kpi_group: v.kpi_group, sort_order: v.sort_order || 0, active: row ? !!v.active : true }),
  });
}

// ------------------------------------------------------------------ purchase categories
async function categories(el) {
  const kinds = ['food', 'beverage', 'non_food', 'cleaning', 'small_inventory'].map((k) => ({ value: k, label: t('kind_' + k) }));
  crud(el, {
    title: t('set_categories'), sub: t('set_categories_sub'), table: 'fin_purchase_categories',
    rows: state.meta.categories,
    columns: [
      { label: t('name'), html: (r) => `<strong>${esc(nameOf(r))}</strong>` },
      { label: t('counts_as'), html: (r) => esc(t('kind_' + r.kind)) },
      { label: t('vat'), html: (r) => fmt.pct(Number(r.vat_rate), 0) },
      { label: t('active'), html: (r) => yesNo(r.active) },
    ],
    fields: [
      { name: 'name_en', label: t('name_en'), required: true }, { name: 'name_nl', label: t('name_nl'), required: true },
      { name: 'kind', label: t('counts_as'), type: 'select', options: kinds },
      { name: 'vat_rate', label: t('default_vat'), type: 'select', options: pctOpts() },
      { name: 'sort_order', label: t('sort_order'), type: 'number' }, { name: 'active', label: t('active'), type: 'checkbox' },
    ],
    fromRow: (r) => ({ ...r, vat_rate: String(Number(r.vat_rate)) }),
    toRow: (v, row) => ({ name_en: v.name_en, name_nl: v.name_nl, kind: v.kind, vat_rate: Number(v.vat_rate), sort_order: v.sort_order || 0, active: row ? !!v.active : true }),
  });
}

// ------------------------------------------------------------------ suppliers
// Contact, online ordering and account manager are on the supplier. Website logins sit in
// fin_supplier_logins: only managers can read them and they are kept out of the change history.
const safeUrl = (u) => {
  if (!u) return null;
  const v = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
  return /^https?:\/\//i.test(v) ? v : null;
};
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const telHref = (p) => `tel:${String(p).replace(/[^\d+]/g, '')}`;
const extLink = (u, label) => { const h = safeUrl(u); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(label || hostOf(h))} &#8599;</a>` : ''; };

async function suppliers(el) {
  const cats = state.meta.categories.map((c) => ({ value: c.id, label: nameOf(c) }));
  const rows = state.meta.suppliers;
  const logins = Object.fromEntries((check(await sb.from('fin_supplier_logins').select('*').eq('restaurant_id', rest().id)) || []).map((l) => [l.supplier_id, l]));
  const line = (label, html) => (html ? `<div class="sup-line"><span class="muted">${label}</span><span>${html}</span></div>` : '');
  const card = (r) => {
    const lg = logins[r.id] || {};
    const order = safeUrl(r.order_url);
    const contact = [r.contact_name ? `<strong>${esc(r.contact_name)}</strong>` : '', r.contact_phone ? `<a href="${telHref(r.contact_phone)}">${esc(r.contact_phone)}</a>` : '',
      r.contact_email ? `<a href="mailto:${esc(r.contact_email)}">${esc(r.contact_email)}</a>` : ''].filter(Boolean).join('<br>');
    const general = [r.phone ? `<a href="${telHref(r.phone)}">${esc(r.phone)}</a>` : '', r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''].filter(Boolean).join('<br>');
    return `<div class="card sup-card ${r.active ? '' : 'inactive'}">
      <div class="split"><div><h3 style="margin:0">${esc(r.name)}</h3>
        <div class="small muted">${esc(nameOf(state.meta.categories.find((c) => c.id === r.category_id)) || t('no_default_category'))}${r.active ? '' : ` · ${t('inactive')}`}</div></div>
        <div class="actions"><button type="button" class="btn-sm" data-edit="${r.id}">${t('edit')}</button>
          <button type="button" class="btn-sm btn-ghost btn-danger" data-del="${r.id}">${t('delete')}</button></div></div>
      ${order || r.website ? `<div class="sup-links">${order ? `<a class="btn-primary btn-sm" href="${esc(order)}" target="_blank" rel="noopener noreferrer">&#128722; ${t('order_online')} &#8599;</a>` : ''}
        ${r.website ? extLink(r.website) : ''}</div>` : ''}
      ${line(t('customer_number'), r.customer_number ? `${esc(r.customer_number)} <button type="button" class="btn-link" data-copy="${esc(r.customer_number)}">${t('copy')}</button>` : '')}
      ${line(t('sup_login'), lg.username ? `${esc(lg.username)} <button type="button" class="btn-link" data-copy="${esc(lg.username)}">${t('copy')}</button>` : '')}
      ${line(t('sup_password'), lg.password ? `<span class="pw-mask" data-pw="${r.id}">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</span>
        <button type="button" class="btn-link" data-show="${r.id}">${t('show')}</button> <button type="button" class="btn-link" data-copypw="${r.id}">${t('copy')}</button>` : '')}
      ${line(t('account_manager'), contact)}
      ${line(t('sup_general_contact'), general)}
      ${line(t('order_days'), esc(r.order_days || ''))}
      ${line(t('delivery_days'), esc(r.delivery_days || ''))}
      ${line(t('min_order'), r.min_order != null ? fmt.money2(r.min_order) : '')}
      ${lg.notes ? line(t('sup_login_notes'), `<span class="pre">${esc(lg.notes)}</span>`) : ''}
      ${r.notes ? `<div class="small pre" style="margin-top:8px">${esc(r.notes)}</div>` : ''}
    </div>`;
  };
  el.innerHTML = `<div class="card"><div class="split"><div><h2 style="margin:0">${t('set_suppliers')}</h2><div class="small muted">${t('set_suppliers_sub')}</div></div>
      <button type="button" class="btn-primary btn-sm" id="add">+ ${t('add_supplier')}</button></div></div>
    ${rows.length ? `<div class="grid grid-2 sup-grid">${rows.map(card).join('')}</div>` : `<div class="card empty">${t('nothing_yet')}</div>`}`;

  const groups = [
    [null, [{ name: 'name', label: t('name'), required: true },
      { name: 'category_id', label: t('default_category'), type: 'select', options: cats, blank: true }]],
    [t('sup_ordering'), [{ name: 'order_url', label: t('order_url'), placeholder: 'https://' },
      { name: 'website', label: t('website'), placeholder: 'https://' },
      { name: 'customer_number', label: t('customer_number') },
      { name: 'order_days', label: t('order_days'), placeholder: t('order_days_ph') },
      { name: 'delivery_days', label: t('delivery_days'), placeholder: t('delivery_days_ph') },
      { name: 'min_order', label: t('min_order'), type: 'number' }]],
    [t('sup_login_head'), [{ type: 'help', label: t('sup_login_help') },
      { name: 'username', label: t('sup_login') }, { name: 'password', label: t('sup_password'), type: 'password' },
      { name: 'login_notes', label: t('sup_login_notes'), type: 'textarea' }]],
    [t('account_manager'), [{ name: 'contact_name', label: t('name') },
      { name: 'contact_phone', label: t('phone'), type: 'tel' }, { name: 'contact_email', label: t('email'), type: 'email' }]],
    [t('sup_general_contact'), [{ name: 'phone', label: t('phone'), type: 'tel' }, { name: 'email', label: t('email'), type: 'email' }]],
    [t('notes'), [{ name: 'notes', label: t('notes'), type: 'textarea' },
      { name: 'sort_order', label: t('sort_order'), type: 'number' }, { name: 'active', label: t('active'), type: 'checkbox' }]],
  ];
  const fields = groups.flatMap((g) => g[1]);
  const open = (row) => {
    const lg = row ? logins[row.id] || {} : {};
    const vals = row ? { ...row, username: lg.username, password: lg.password, login_notes: lg.notes } : { active: true };
    openModal(`<h2>${row ? esc(row.name) : t('add_supplier')}</h2><form id="f" autocomplete="off">
      ${groups.map(([head, fs]) => `${head ? `<h3 class="form-head">${head}</h3>` : ''}${formHtml(fs, vals)}`).join('')}
      <div class="modal-actions"><button type="button" data-close>${t('cancel')}</button><button class="btn-primary" type="submit">${t('save')}</button></div></form>`,
    (cardEl, close) => {
      const pw = cardEl.querySelector('[name=password]'); if (pw) pw.setAttribute('autocomplete', 'new-password');
      cardEl.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const v = readForm(cardEl, fields);
        for (const k of ['order_url', 'website']) if (v[k] && !safeUrl(v[k])) return toastError(new Error(t('bad_url')));
        const sup = { name: v.name, category_id: v.category_id || null, sort_order: v.sort_order || 0, active: row ? !!v.active : true,
          website: v.website ? safeUrl(v.website) : null, order_url: v.order_url ? safeUrl(v.order_url) : null, customer_number: v.customer_number,
          phone: v.phone, email: v.email, contact_name: v.contact_name, contact_phone: v.contact_phone, contact_email: v.contact_email,
          order_days: v.order_days, delivery_days: v.delivery_days, min_order: v.min_order, notes: v.notes };
        try {
          const saved = row ? await update('fin_suppliers', row.id, sup) : await insert('fin_suppliers', { ...base(), ...sup });
          const hasLogin = v.username || v.password || v.login_notes;
          if (hasLogin) check(await sb.from('fin_supplier_logins').upsert({ supplier_id: saved.id, restaurant_id: saved.restaurant_id,
            username: v.username, password: v.password, notes: v.login_notes }, { onConflict: 'supplier_id' }));
          else if (logins[saved.id]) check(await sb.from('fin_supplier_logins').delete().eq('supplier_id', saved.id));
          close(); toast(t('saved')); await reload(el, suppliers);
        } catch (err) { toastError(err); }
      };
    });
  };
  $('#add', el).onclick = () => open(null);
  $$('[data-edit]', el).forEach((b) => (b.onclick = () => open(rows.find((r) => r.id === b.dataset.edit))));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(t('confirm_delete'), t('delete')))) return;
    try { await remove('fin_suppliers', b.dataset.del); toast(t('deleted')); await reload(el, suppliers); }
    catch (err) { toastError(new Error(/foreign key|violates/i.test(err.message) ? t('in_use_deactivate') : err.message)); }
  }));
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch { toastError(new Error(t('copy_failed'))); } };
  $$('[data-copy]', el).forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  $$('[data-copypw]', el).forEach((b) => (b.onclick = () => copy(logins[b.dataset.copypw].password)));
  $$('[data-show]', el).forEach((b) => (b.onclick = () => {
    const m = $(`[data-pw="${b.dataset.show}"]`, el);
    const shown = m.dataset.shown === '1';
    m.textContent = shown ? '•'.repeat(8) : logins[b.dataset.show].password;
    m.dataset.shown = shown ? '0' : '1';
    b.textContent = shown ? t('show') : t('hide');
  }));
}

// ------------------------------------------------------------------ VAT rates
async function vat(el) {
  crud(el, {
    title: t('set_vat'), sub: t('set_vat_sub'), table: 'fin_vat_rates',
    rows: state.meta.vat,
    columns: [{ label: t('name'), html: (r) => `<strong>${esc(r.label)}</strong>` }, { label: t('rate'), html: (r) => fmt.pct(Number(r.rate), 1) }],
    fields: [{ name: 'label', label: t('name'), required: true }, { name: 'rate', label: t('rate_pct'), type: 'number', required: true }, { name: 'sort_order', label: t('sort_order'), type: 'number' }],
    fromRow: (r) => ({ ...r, rate: round2(Number(r.rate) * 100) }),
    toRow: (v) => ({ label: v.label, rate: Number(v.rate) / 100, sort_order: v.sort_order || 0 }),
  });
}

// ------------------------------------------------------------------ opening hours
async function hours(el) {
  const oh = state.meta.openingHours;
  const today = todayIso();
  const block = (season) => `<div class="card"><h2>${t('season_' + season)} ${seasonOf(today) === season ? `<span class="badge green">${t('now')}</span>` : ''}</h2>
    <div class="small muted" style="margin:-6px 0 8px">${t('season_' + season + '_when')}</div>
    <table class="oh-table"><thead><tr><th>${t('day')}</th><th>${t('open')}</th><th>${t('from')}</th><th>${t('until')}</th></tr></thead><tbody>
    ${[1, 2, 3, 4, 5, 6, 7].map((wd) => { const r = oh.find((o) => o.season === season && o.weekday === wd) || {};
      return `<tr data-row="${r.id || ''}" data-season="${season}" data-wd="${wd}"><td>${esc(fmt.weekdayLong(wd))}</td>
        <td><input type="checkbox" name="open" ${r.is_open ? 'checked' : ''}></td>
        <td><input type="time" name="from" value="${(r.open_time || '').slice(0, 5)}"></td><td><input type="time" name="to" value="${(r.close_time || '').slice(0, 5)}"></td></tr>`; }).join('')}
    </tbody></table></div>`;
  el.innerHTML = `<div class="note" style="margin:0 0 14px">${t('hours_note')}</div>${block('summer')}${block('winter')}
    <div style="margin-top:14px"><button type="button" class="btn-primary" id="save-oh">${t('save')}</button></div>`;
  $('#save-oh', el).onclick = async () => {
    try {
      for (const tr of $$('tr[data-season]', el)) {
        const row = { ...base(), season: tr.dataset.season, weekday: Number(tr.dataset.wd), is_open: tr.querySelector('[name=open]').checked,
          open_time: tr.querySelector('[name=from]').value || null, close_time: tr.querySelector('[name=to]').value || null };
        check(await sb.from('fin_opening_hours').upsert(row, { onConflict: 'restaurant_id,season,weekday' }));
      }
      toast(t('saved')); await reload(el, hours);
    } catch (e) { toastError(e); }
  };
}

// ------------------------------------------------------------------ closed days and exceptions
async function closures(el) {
  const rows = (await list('fin_closures', { rest: rest().id, order: 'day' })).reverse();
  crud(el, {
    title: t('set_closures'), sub: t('set_closures_sub'), table: 'fin_closures', addLabel: t('add_exception'),
    rows,
    columns: [
      { label: t('date'), html: (r) => `<strong>${esc(fmt.dayShort(r.day))} ${r.day.slice(0, 4)}</strong>` },
      { label: t('status'), html: (r) => (r.is_open ? `<span class="badge green">${t('extra_open')}</span>` : `<span class="badge">${t('closed')}</span>`) },
      { label: t('note'), html: (r) => esc(r.note || '') },
    ],
    fields: [
      { name: 'day', label: t('date'), type: 'date', required: true },
      { name: 'is_open', label: t('is_open_exception'), type: 'checkbox' },
      { name: 'note', label: t('note'), placeholder: t('closure_note_ph') },
    ],
    toRow: (v) => ({ day: v.day, is_open: !!v.is_open, note: v.note }),
  });
}

// ------------------------------------------------------------------ targets
async function targets(el) {
  const metrics = ['food_cost', 'beverage_cost', 'labor', 'prime_cost', 'nonfood_budget'];
  const seasons = ['all', 'summer', 'winter'];
  const list_ = state.meta.targets || [];
  const val = (m, s) => { const x = list_.find((r) => r.metric === m && r.season === s); return x ? Number(x.value) : null; };
  const show = (m, v) => (v == null ? '' : m === 'nonfood_budget' ? String(v) : String(round2(v * 100)));
  const can = perm.admin();
  el.innerHTML = `<div class="card"><h2>${t('set_targets')}</h2><p class="small muted" style="margin-top:-6px">${t('set_targets_sub')}</p>
    <div class="table-wrap"><table><thead><tr><th>${t('metric')}</th>${seasons.map((s) => `<th>${t('season_' + s)}</th>`).join('')}</tr></thead><tbody>
    ${metrics.map((m) => `<tr><td><strong>${t('target_' + m)}</strong><div class="tiny muted">${m === 'nonfood_budget' ? t('per_month_eur') : t('pct_of_revenue')}</div></td>
      ${seasons.map((s) => `<td><input data-m="${m}" data-s="${s}" inputmode="decimal" value="${show(m, val(m, s))}" ${can ? '' : 'disabled'}
        placeholder="${s === 'all' ? '' : t('same_as_year')}" style="max-width:120px"></td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    ${can ? `<button type="button" class="btn-primary" id="save-t" style="margin-top:12px">${t('save')}</button>` : `<div class="note">${t('admin_only')}</div>`}
    <div class="note">${t('traffic_note')}</div></div>`;
  const btn = $('#save-t', el);
  if (btn) btn.onclick = async () => {
    try {
      for (const inp of $$('[data-m]', el)) {
        const m = inp.dataset.m; const s = inp.dataset.s;
        const raw = inp.value.trim().replace(',', '.');
        const existing = list_.find((r) => r.metric === m && r.season === s);
        if (raw === '') { if (existing && s !== 'all') await remove('fin_targets', existing.id); continue; }
        const v = m === 'nonfood_budget' ? Number(raw) : Number(raw) / 100;
        if (!Number.isFinite(v)) continue;
        check(await sb.from('fin_targets').upsert({ ...base(), metric: m, season: s, value: v }, { onConflict: 'restaurant_id,metric,season' }));
      }
      toast(t('saved')); await reload(el, targets);
    } catch (e) { toastError(e); }
  };
}

// ------------------------------------------------------------------ fixed costs
async function fixed(el) {
  const rows = state.meta.fixed || [];
  const sum = rows.filter((r) => r.active).reduce((a, r) => a + Number(r.amount_month), 0);
  crud(el, {
    title: t('set_fixed'), sub: `${t('set_fixed_sub')} ${t('total')}: ${fmt.money2(sum)} ${t('per_month')} (${fmt.money(sum * 12)} ${t('per_year')}).`,
    table: 'fin_fixed_costs', canEdit: perm.admin(), addLabel: t('add_cost'),
    rows,
    columns: [
      { label: t('name'), html: (r) => `<strong>${esc(r.name)}</strong>` },
      { label: t('per_month'), html: (r) => fmt.money2(Number(r.amount_month)) },
      { label: t('per_year'), html: (r) => fmt.money(Number(r.amount_month) * 12) },
      { label: t('active'), html: (r) => yesNo(r.active) },
    ],
    fields: [
      { name: 'name', label: t('name'), required: true },
      { name: 'amount_month', label: t('amount_month'), type: 'number', required: true },
      { name: 'sort_order', label: t('sort_order'), type: 'number' }, { name: 'active', label: t('active'), type: 'checkbox' },
    ],
    toRow: (v, row) => ({ name: v.name, amount_month: v.amount_month || 0, sort_order: v.sort_order || 0, active: row ? !!v.active : true }),
  });
}

// ------------------------------------------------------------------ restaurant
async function restaurant(el) {
  const r = rest();
  const fields = [
    { name: 'name', label: t('name'), required: true },
    { name: 'city', label: t('city') },
    { name: 'latitude', label: t('latitude'), type: 'number', hint: t('coords_hint') },
    { name: 'longitude', label: t('longitude'), type: 'number' },
  ];
  el.innerHTML = `<div class="card"><h2>${t('set_restaurant')}</h2><form id="rf">${formHtml(fields, r)}<button class="btn-primary" type="submit">${t('save')}</button></form></div>`;
  $('#rf', el).onsubmit = async (e) => {
    e.preventDefault();
    const v = readForm(el, fields);
    try {
      const saved = await update('fin_restaurants', r.id, v);
      Object.assign(state.rest, saved);
      toast(t('saved'));
    } catch (err) { toastError(err); }
  };
}

// ------------------------------------------------------------------ users (edge function)
const ROLES = ['staff', 'manager', 'org_admin', 'super_admin'];
async function users(el) {
  const org = rest().organization_id;
  el.innerHTML = `<div class="card empty"><span class="spinner"></span></div>`;
  const res = await adminUsers({ action: 'list', organization_id: org });
  const roles = ROLES.filter((r) => r !== 'super_admin' || perm.super()).map((r) => ({ value: r, label: t('role_' + r) }));
  el.innerHTML = `<div class="card"><div class="split"><div><h2 style="margin:0">${t('set_users')}</h2><div class="small muted">${t('set_users_sub')}</div></div>
      <button type="button" class="btn-primary btn-sm" id="add">+ ${t('add_user')}</button></div>
    <div class="table-wrap" style="margin-top:12px"><table class="stack"><thead><tr><th>${t('name')}</th><th>${t('email')}</th><th>${t('role')}</th><th>${t('last_login')}</th><th>${t('active')}</th><th></th></tr></thead><tbody>
    ${res.users.map((u) => `<tr><td data-label="${t('name')}"><strong>${esc(u.full_name || '')}</strong></td><td data-label="${t('email')}">${esc(u.email)}</td>
      <td data-label="${t('role')}">${t('role_' + u.role)}</td><td data-label="${t('last_login')}">${u.last_sign_in_at ? fmt.dateTime(u.last_sign_in_at) : '–'}</td>
      <td data-label="${t('active')}">${yesNo(u.active)}</td>
      <td class="actions">${u.user_id === state.me.user_id || (u.role === 'super_admin' && !perm.super()) ? '' : `<button type="button" class="btn-sm" data-edit="${u.id}">${t('edit')}</button>
        <button type="button" class="btn-sm" data-reset="${u.id}">${t('reset_password')}</button>
        <button type="button" class="btn-sm btn-ghost btn-danger" data-remove="${u.id}">${t('remove_access')}</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="note">${t('users_note')}</div></div>`;
  const pwCard = (email, pw) => `<div class="pw-card"><div class="small">${t('pw_once')}</div>
    <div style="margin:6px 0">${esc(email)}<br><code>${esc(pw)}</code></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn-sm" id="copy">${t('copy')}</button>
    <a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(t('wa_text', { url: location.origin + location.pathname, e: email, p: pw }))}">${t('share_whatsapp')}</a></div></div>`;
  const bindCopy = (card, email, pw) => { const b = card.querySelector('#copy'); if (b) b.onclick = () => { navigator.clipboard.writeText(`${email}\n${pw}`); toast(t('copied')); }; };
  $('#add', el).onclick = () => {
    const fields = [
      { name: 'email', label: t('email'), type: 'email', required: true },
      { name: 'full_name', label: t('name'), required: true },
      { name: 'role', label: t('role'), type: 'select', options: roles },
      { name: 'language', label: t('language'), type: 'select', options: [{ value: 'en', label: 'English' }, { value: 'nl', label: 'Nederlands' }] },
      { type: 'help', label: t('add_user_help') },
    ];
    openModal(`<h2>${t('add_user')}</h2><form id="f">${formHtml(fields, { role: 'staff', language: 'nl' })}
      <div class="modal-actions"><button type="button" data-close>${t('cancel')}</button><button class="btn-primary" type="submit">${t('save')}</button></div></form><div id="out"></div>`,
    (card, close) => {
      card.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const v = readForm(card, fields);
        try {
          const r = await adminUsers({ action: 'create', organization_id: org, ...v });
          card.querySelector('#f').hidden = true;
          card.querySelector('#out').innerHTML = (r.password ? pwCard(r.email, r.password) : `<div class="pw-card">${t('existing_login_added', { e: esc(r.email) })}</div>`) +
            `<div class="modal-actions"><button type="button" class="btn-primary" id="done">${t('close')}</button></div>`;
          bindCopy(card, r.email, r.password);
          card.querySelector('#done').onclick = () => { close(); users(el); };
        } catch (err) { toastError(err); }
      };
    });
  };
  $$('[data-edit]', el).forEach((b) => (b.onclick = () => {
    const u = res.users.find((x) => x.id === b.dataset.edit);
    const fields = [
      { name: 'full_name', label: t('name'), required: true },
      { name: 'role', label: t('role'), type: 'select', options: roles },
      { name: 'language', label: t('language'), type: 'select', options: [{ value: 'en', label: 'English' }, { value: 'nl', label: 'Nederlands' }] },
      { name: 'active', label: t('active'), type: 'checkbox' },
    ];
    openModal(`<h2>${esc(u.email)}</h2><form id="f">${formHtml(fields, u)}
      <div class="modal-actions"><button type="button" data-close>${t('cancel')}</button><button class="btn-primary" type="submit">${t('save')}</button></div></form>`,
    (card, close) => {
      card.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        try { await adminUsers({ action: 'update', organization_id: org, id: u.id, ...readForm(card, fields) }); close(); toast(t('saved')); users(el); }
        catch (err) { toastError(err); }
      };
    });
  }));
  $$('[data-reset]', el).forEach((b) => (b.onclick = async () => {
    const u = res.users.find((x) => x.id === b.dataset.reset);
    if (!(await confirmDialog(t('confirm_reset', { e: u.email }), t('reset_password'), false))) return;
    try {
      const r = await adminUsers({ action: 'reset_password', organization_id: org, id: u.id });
      openModal(`<h2>${t('reset_password')}</h2>${pwCard(u.email, r.password)}<div class="modal-actions"><button type="button" class="btn-primary" data-close>${t('close')}</button></div>`,
        (card) => bindCopy(card, u.email, r.password));
    } catch (err) { toastError(err); }
  }));
  $$('[data-remove]', el).forEach((b) => (b.onclick = async () => {
    const u = res.users.find((x) => x.id === b.dataset.remove);
    if (!(await confirmDialog(t('confirm_remove', { e: u.email }), t('remove_access')))) return;
    try { await adminUsers({ action: 'remove', organization_id: org, id: u.id }); toast(t('saved')); users(el); }
    catch (err) { toastError(err); }
  }));
}

// ------------------------------------------------------------------ audit log
async function audit(el) {
  const rows = check(await sb.from('fin_audit_log').select('*').eq('organization_id', rest().organization_id).order('at', { ascending: false }).limit(200));
  let names = {};
  try { const res = await adminUsers({ action: 'list', organization_id: rest().organization_id }); names = Object.fromEntries(res.users.map((u) => [u.user_id, u.full_name || u.email])); } catch { /* names optional */ }
  const tableName = (n) => t('tbl_' + n.replace(/^fin_/, '')) || n;
  const summary = (r) => {
    const d = r.new_data || r.old_data || {};
    const keys = ['day', 'name', 'name_en', 'covers', 'amount_ex', 'hours', 'status', 'role', 'email', 'value', 'metric', 'hourly_rate'];
    return keys.filter((k) => d[k] != null).slice(0, 4).map((k) => `${k}: ${esc(String(d[k]))}`).join(' · ');
  };
  el.innerHTML = `<div class="card"><h2>${t('set_audit')}</h2><p class="small muted" style="margin-top:-6px">${t('set_audit_sub')}</p>
    <div class="table-wrap"><table class="stack"><thead><tr><th>${t('when')}</th><th>${t('who')}</th><th>${t('what')}</th><th>${t('action')}</th><th>${t('details')}</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td data-label="${t('when')}">${fmt.dateTime(r.at)}</td><td data-label="${t('who')}">${esc(names[r.user_id] || (r.user_id ? '…' : t('system')))}</td>
      <td data-label="${t('what')}">${esc(tableName(r.table_name))}</td><td data-label="${t('action')}">${esc(t('act_' + r.action.toLowerCase()))}</td>
      <td data-label="${t('details')}" class="small">${summary(r)}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">${t('nothing_yet')}</td></tr>`}
    </tbody></table></div></div>`;
}

// ------------------------------------------------------------------ own password (one login for both Wintertuin apps)
async function password(el) {
  el.innerHTML = `<div class="card" style="max-width:480px"><h2>${t('set_password')}</h2><p class="small muted" style="margin-top:-6px">${t('set_password_sub')}</p>
    <form id="pw"><div class="field"><label>${t('pw_new')}</label><input type="password" name="pw" autocomplete="new-password" minlength="8" required></div>
    <div class="field"><label>${t('pw_repeat')}</label><input type="password" name="pw2" autocomplete="new-password" minlength="8" required></div>
    <button class="btn-primary" type="submit">${t('save')}</button></form></div>`;
  $('#pw', el).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.pw.value.length < 8) return toastError(new Error(t('pw_short')));
    if (f.pw.value !== f.pw2.value) return toastError(new Error(t('pw_mismatch')));
    try { await setPassword(f.pw.value); f.reset(); toast(t('pw_saved')); } catch (err) { toastError(err); }
  };
}
