// Shared helpers: app state, formatting, DOM, toast, modal, forms. Same patterns as WASTE log.
import { t, lang, setLang, LANGS } from './i18n.js';
import { setLanguage, loadMeta } from './data.js';

const LS_REST = 'wtfin_rest';
export const state = {
  me: null,            // fin_app_users row (+ email, rank)
  rank: 0,             // 1 staff, 2 manager, 3 org admin, 4 super admin
  restaurants: [],
  rest: null,          // current restaurant row
  meta: null,          // settings of the current restaurant
};
export function savedRestId() { try { return localStorage.getItem(LS_REST); } catch { return null; } }
export function saveRestId(id) { try { localStorage.setItem(LS_REST, id); } catch { /* private mode */ } }

export async function refreshMeta() {
  state.meta = await loadMeta(state.rest.id, state.rank);
}

// In employee view a manager gets the screens of staff (rank 1); data access itself is unchanged
const viewRank = () => (state.rank >= 2 && employeeView.on() ? 1 : state.rank);
export const perm = {
  reports: () => viewRank() >= 2,
  settings: () => viewRank() >= 2,
  admin: () => viewRank() >= 3,
  super: () => viewRank() >= 4,
  realManager: () => state.rank >= 2,
};
// ------------------------------------------------------------------ employee view
// A manager can look at the app exactly as staff see it. Only the screens change; on this device only.
const EMP_KEY = 'wtFinanceEmployeeView';
export const employeeView = {
  on() { try { return localStorage.getItem(EMP_KEY) === '1'; } catch { return false; } },
  set(v) { try { if (v) localStorage.setItem(EMP_KEY, '1'); else localStorage.removeItem(EMP_KEY); } catch { /* private mode */ } },
};

// Banner while a manager looks at the employee view
export function renderEmployeeBanner(isRealManager, backHash, t) {
  let bar = document.getElementById('emp-bar');
  const show = isRealManager && employeeView.on();
  if (!show) { if (bar) bar.remove(); document.body.classList.remove('emp-view'); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'emp-bar'; bar.className = 'emp-bar'; document.querySelector('main').before(bar); }
  document.body.classList.add('emp-view');
  bar.innerHTML = `<span>&#128065; ${t('emp_view_on')}</span><button type="button" class="btn-sm" id="emp-off">${t('emp_view_off')}</button>`;
  bar.querySelector('#emp-off').onclick = () => {
    employeeView.set(false);
    if (location.hash === backHash) window.dispatchEvent(new Event('wt:lang')); else location.hash = backHash;
  };
}


// ------------------------------------------------------------------ formatting
const locale = () => (lang() === 'en' ? 'en-GB' : 'nl-NL');
function toDate(s) {
  if (!s) return null;
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s;
  let str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) str += 'T12:00:00';
  str = str.replace(' ', 'T');
  if (/T\d{2}:\d{2}.*[+-]\d{2}$/.test(str)) str += ':00';
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}
export const fmt = {
  num(n, d = 0) { return n == null || Number.isNaN(n) ? '–' : new Intl.NumberFormat(locale(), { maximumFractionDigits: d }).format(n); },
  money(n, d = 0) {
    if (n == null || Number.isNaN(n)) return '–';
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
  },
  money2(n) { return fmt.money(n, 2); },
  pct(n, d = 1) { return n == null || !Number.isFinite(n) ? '–' : `${new Intl.NumberFormat(locale(), { maximumFractionDigits: d, minimumFractionDigits: d }).format(n * 100)}%`; },
  date(s) { const d = toDate(s); return d ? new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(d) : '–'; },
  dayLong(s) { const d = toDate(s); return d ? new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(d) : '–'; },
  dayShort(s) { const d = toDate(s); return d ? new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(d) : '–'; },
  month(y, m) { return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 15)); },
  monthName(m) { const s = new Intl.DateTimeFormat(locale(), { month: 'long' }).format(new Date(2026, m - 1, 15)); return s.charAt(0).toUpperCase() + s.slice(1); },
  monthShort(m) { return new Intl.DateTimeFormat(locale(), { month: 'short' }).format(new Date(2026, m - 1, 15)); },
  weekdayShort(isoWd) { return new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(2026, 0, 4 + isoWd)); }, // 2026-01-05 is a Monday
  weekdayLong(isoWd) { return new Intl.DateTimeFormat(locale(), { weekday: 'long' }).format(new Date(2026, 0, 4 + isoWd)); },
  dateTime(s) { const d = toDate(s); return d ? new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d) : '–'; },
};
export const todayIso = () => new Date().toLocaleDateString('sv-SE');
export const addDaysIso = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
export const nameOf = (row) => (row ? (lang() === 'nl' ? row.name_nl || row.name_en : row.name_en || row.name_nl) || row.name || '' : '');
// Parse what people type: "12,50", "1.234,50", "1234.5", "€ 12"
export function parseAmount(v) {
  if (v == null) return null;
  let s = String(v).replace(/[€\s]/g, '');
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const vatLabel = (rate) => `${fmt.num(Number(rate) * 100, 0)}%`;

// ------------------------------------------------------------------ DOM
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const app = () => document.getElementById('app');

let toastTimer;
export function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, type === 'error' ? 4500 : 2600);
}
export function toastError(e) { console.warn(e); toast(e && e.message ? (e.message === 'no_access' ? t('no_access') : e.message) : t('error'), 'error'); }

// ------------------------------------------------------------------ modal
export function closeModal() {
  const m = document.getElementById('modal');
  if (m && !m.hidden) { m.hidden = true; m.querySelector('.modal-card').innerHTML = ''; }
}
export function openModal(html, onMount) {
  const m = document.getElementById('modal');
  const card = m.querySelector('.modal-card');
  card.innerHTML = html;
  m.hidden = false;
  const close = () => { m.hidden = true; card.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  m.onclick = (e) => { if (e.target === m) close(); };
  card.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  if (onMount) onMount(card, close);
  const first = card.querySelector('input, select, textarea');
  if (first) first.focus();
  return close;
}

export function confirmDialog(message, okLabel, danger = true) {
  return new Promise((resolve) => {
    openModal(`<p>${esc(message)}</p><div class="modal-actions">
      <button data-close>${t('cancel')}</button><button class="btn-primary ${danger ? 'btn-danger' : ''}" id="cf-ok">${esc(okLabel || t('delete'))}</button></div>`,
    (card, close) => {
      card.querySelector('#cf-ok').onclick = () => { close(); resolve(true); };
      card.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => { close(); resolve(false); }));
    });
  });
}

// ------------------------------------------------------------------ forms
// fields: [{ name, label, type: text|number|email|date|select|checkbox|textarea|help, options:[{value,label}], step, required }]
export function formHtml(fields, values = {}) {
  return fields.map((f) => {
    const v = values[f.name];
    const req = f.required ? 'required' : '';
    if (f.type === 'help') return `<div class="note" style="margin:0 0 14px">${esc(f.label)}</div>`;
    if (f.type === 'checkbox') {
      return `<div class="field"><label class="check"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
    }
    if (f.type === 'select') {
      const opts = (f.blank ? `<option value="">${esc(f.blankLabel || t('none'))}</option>` : '') +
        f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
      return `<div class="field"><label>${esc(f.label)}</label><select name="${f.name}" ${req}>${opts}</select></div>`;
    }
    if (f.type === 'textarea') {
      return `<div class="field"><label>${esc(f.label)}</label><textarea name="${f.name}" rows="3" ${req}>${esc(v ?? '')}</textarea></div>`;
    }
    const type = f.type === 'number' ? 'text' : (f.type || 'text');
    return `<div class="field"><label>${esc(f.label)}</label><input type="${type}" name="${f.name}" value="${esc(v ?? '')}"
      ${f.type === 'number' ? 'inputmode="decimal"' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${req}>
      ${f.hint ? `<div class="tiny muted" style="margin-top:3px">${esc(f.hint)}</div>` : ''}</div>`;
  }).join('');
}

export function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'help') continue;
    const el = root.querySelector(`[name="${f.name}"]`);
    if (!el) continue;
    if (f.type === 'checkbox') { out[f.name] = el.checked; continue; }
    const raw = el.value.trim();
    if (f.type === 'number') out[f.name] = raw === '' ? null : parseAmount(raw);
    else out[f.name] = raw === '' ? null : raw;
  }
  return out;
}

// ------------------------------------------------------------------ language switch
export function renderLangToggle(el) {
  el.innerHTML = Object.keys(LANGS).map((l) =>
    `<button type="button" data-lang="${l}" class="${l === lang() ? 'on' : ''}" aria-pressed="${l === lang()}" title="${esc(LANGS[l])}">${l.toUpperCase()}</button>`).join('');
  el.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = async () => {
    const l = b.dataset.lang;
    if (l === lang()) return;
    setLang(l);
    if (state.me) { try { await setLanguage(l); state.me.language = l; } catch (e) { toastError(e); } }
    window.dispatchEvent(new Event('wt:lang'));
  }));
}

// ------------------------------------------------------------------ print
export function printHeader(title, selection) {
  const r = (state.rest && state.rest.name) || '';
  return `<div class="print-only print-head"><div><strong>Wintertuin Finance</strong> · ${esc(r)}</div>
    <div class="print-title">${esc(title)}</div>${selection ? `<div>${esc(selection)}</div>` : ''}
    <div class="small">${t('printed')}: ${fmt.dateTime(new Date().toISOString())}</div></div>`;
}
// Charts are printed as a still image next to the live canvas (only the image shows on paper). Safari often
// prints a resizing canvas blank, and fires its print events too early to swap things around safely.
function snapshotCharts() {
  if (!window.Chart) return;
  Object.values(window.Chart.instances || {}).forEach((c) => {
    try {
      const canvas = c.canvas; if (!canvas || !canvas.isConnected) return;
      let img = canvas.nextElementSibling;
      if (!img || !img.classList.contains('chart-print')) { img = document.createElement('img'); img.className = 'chart-print'; img.alt = ''; canvas.after(img); }
      img.src = c.toBase64Image();
    } catch { /* chart gone */ }
  });
}
// Used by every Print button: freeze the charts first, then open the print window.
export function printPage() { snapshotCharts(); setTimeout(() => window.print(), 60); }
window.addEventListener('beforeprint', snapshotCharts); // also when someone presses Cmd+P
