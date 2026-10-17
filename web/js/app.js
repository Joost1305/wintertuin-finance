// App shell and router (hash based, no build step). Same structure as WASTE log.
import { state, perm, $, esc, app, toastError, renderLangToggle, savedRestId, saveRestId, refreshMeta, closeModal , employeeView, renderEmployeeBanner } from './core.js';
import { t, setLang } from './i18n.js';
import { sb, loadMe, loadRestaurants, signOut } from './data.js';
import { BUILD } from './config.js';
import { renderLogin } from './pages/login.js';
import { renderSetPassword } from './pages/set-password.js';
import { renderToday } from './pages/today.js';
import { renderCalendar } from './pages/calendar.js';
import { renderMonth } from './pages/month.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderSettings } from './pages/settings.js';
import { orderPaths } from './nav.js';

console.log(`Wintertuin Finance, build ${BUILD}`);
// One tab per app: the switch button in the other app targets this name and reuses this tab
try { window.name = 'wintertuin-finance'; } catch { /* ignore */ }

const RANK = { staff: 1, manager: 2, org_admin: 3, super_admin: 4 };
window.addEventListener('nav-order-changed', () => renderShell());

const routes = [
  { path: 'today', render: renderToday, nav: 'nav_today', show: () => true },
  { path: 'calendar', render: renderCalendar, nav: 'nav_calendar', show: perm.reports },
  { path: 'month', render: renderMonth, nav: 'nav_month', show: perm.reports },
  { path: 'dashboard', render: renderDashboard, nav: 'nav_dashboard', show: perm.reports },
  { path: 'vat', render: (args) => { location.replace(`#/settings/vatreport${args[0] ? `/${args[0]}` : ''}`); }, nav: null, show: perm.reports },
  { path: 'settings', render: renderSettings, nav: 'nav_settings', show: perm.settings },
  { path: 'password', render: () => renderSetPassword(() => { location.hash = `#/${homePath()}`; }), nav: null, show: () => true },
];
// Start page: the first item of the top menu in the order set under Settings (Today when nothing is set)
const homePath = () => {
  if (!state.me) return 'today';
  const visible = routes.filter((r) => r.nav && r.show()).map((r) => r.path);
  return orderPaths(visible, state.rest && state.rest.nav_order)[0] || 'today';
};

async function ensureSession() {
  if (state.me) return true;
  try {
    const me = await loadMe();
    state.me = me;
    state.rank = RANK[me.role] || 0;
    setLang(me.language || 'en');
    state.restaurants = await loadRestaurants();
    if (!state.restaurants.length) throw new Error(t('no_restaurant'));
    const saved = savedRestId();
    state.rest = state.restaurants.find((r) => r.id === saved) || state.restaurants[0];
    await refreshMeta();
    return true;
  } catch (e) {
    state.me = null;
    if (e.message === 'no_access') { state.noAccess = true; return false; }
    if (e.status !== 401) toastError(e);
    return false;
  }
}

function renderNoAccess() {
  $('#topbar').hidden = true;
  app().innerHTML = `<div class="card" style="max-width:460px;margin:10vh auto;text-align:center"><img src="img/icon.svg" width="48" height="48" alt="">
    <h1 style="margin-top:10px">${t('no_access_title')}</h1><p class="muted">${t('no_access')}</p>
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><a class="btn btn-primary" href="https://joost1305.github.io/wintertuin-staff-app/">${t('to_staff_app')}</a>
    <a class="btn" href="#/logout">${t('nav_logout')}</a></div></div>`;
}

function renderShell() {
  const top = $('#topbar');
  if (!state.me) { top.hidden = true; renderEmployeeBanner(false); return; }
  top.hidden = false;
  const current = location.hash.replace(/^#\//, '').split('/')[0] || homePath();
  const nav = $('#nav');
  const visible = routes.filter((r) => r.nav && r.show());
  const sorted = orderPaths(visible.map((r) => r.path), state.rest && state.rest.nav_order).map((p) => visible.find((r) => r.path === p));
  nav.innerHTML = sorted.map((r) =>
    `<a href="#/${r.path}" class="${current === r.path ? 'active' : ''}">${t(r.nav)}</a>`).join('') +
    // Managers and admins change their password under Settings; staff (no Settings) keep it in the menu
    (perm.settings() ? '' : `<a href="#/password" class="${current === 'password' ? 'active' : ''}">${t('nav_password')}</a>`) +
    `<a href="#/logout">${t('nav_logout')}</a>`;
  // Switch to the other app: on a phone, tablet or as an app in the Dock (anything not a normal browser tab) in the same window (iOS freezes on, or jumps to a stale copy of,
  // a separate named tab and opens the start page of an old tab); on a computer in its own tab, reused each time
  const touch = window.matchMedia('(pointer: coarse)').matches || window.navigator.standalone || !window.matchMedia('(display-mode: browser)').matches;
  const appSw = $('#app-switch');
  if (appSw) { if (touch) appSw.removeAttribute('target'); else appSw.setAttribute('target', 'wintertuin-team'); }
  $('#app-switch-label').textContent = t('nav_staff_app');
  renderEmployeeBanner(perm.realManager(), '#/settings', t);
  nav.classList.remove('open');
  $('#menu-toggle').onclick = () => nav.classList.toggle('open');
  renderLangToggle($('#lang-toggle'));
  const sw = $('#rest-switch');
  if (state.restaurants.length > 1) {
    sw.hidden = false;
    sw.innerHTML = state.restaurants.map((r) => `<option value="${r.id}" ${r.id === state.rest.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    sw.onchange = async () => {
      state.rest = state.restaurants.find((r) => r.id === sw.value);
      saveRestId(state.rest.id);
      await refreshMeta();
      route();
    };
  } else sw.hidden = true;
}

// Arriving from a password-reset email: the link signs the person in; then they choose a password.
const authLink = (() => {
  const h = new URLSearchParams(String(window.__authHash || '').replace(/^#/, ''));
  if (h.get('error_description')) return { error: h.get('error_description') };
  return ['invite', 'recovery'].includes(h.get('type')) ? { type: h.get('type') } : null;
})();

let choosingPassword = false; // true while the reset-link screen is open
async function route() {
  closeModal(); // a popup never stays open on another page
  // The auth library clears the link from the address bar, which fires a page change.
  // Ignore it until the new password is saved, so nobody skips this screen.
  if (choosingPassword) return;
  if (authLink && !authLink.handled) {
    authLink.handled = true;
    if (authLink.error) { location.hash = '#/login'; setTimeout(() => toastError(new Error(authLink.error)), 300); return; }
    choosingPassword = true;
    await new Promise((r) => setTimeout(r, 400)); // let the auth library read the link
    const { data: { session } } = await sb.auth.getSession();
    if (session) return renderSetPassword(() => { choosingPassword = false; location.hash = `#/${homePath()}`; });
    choosingPassword = false;
    location.hash = '#/login'; return;
  }
  const [path, ...rest] = location.hash.replace(/^#\//, '').split('/');
  if (path === 'logout') {
    employeeView.set(false);
    await signOut().catch(() => {});
    state.me = null; state.meta = null; state.noAccess = false;
    location.hash = '#/login';
    return;
  }
  if (path === 'login') {
    // Already signed in (for example in the team app, same login): skip the form
    const { data: { session } } = await sb.auth.getSession();
    if (session && (await ensureSession())) { location.hash = `#/${homePath()}`; return; }
    if (session && state.noAccess) return renderNoAccess();
    state.me = null;
    renderShell();
    return renderLogin(async () => {
      if (await ensureSession()) location.hash = `#/${homePath()}`;
      else if (state.noAccess) renderNoAccess();
    });
  }
  state.noAccess = false;
  if (!(await ensureSession())) { if (state.noAccess) return renderNoAccess(); location.hash = '#/login'; return; }
  if (!path || path === 'home') { history.replaceState(null, '', `${location.pathname}${location.search}#/${homePath()}`); return route(); }
  const r = routes.find((x) => x.path === path && x.show());
  if (!r) { location.hash = `#/${homePath()}`; return; }
  renderShell();
  app().className = 'app';
  window.scrollTo(0, 0);
  try { await r.render(rest); } catch (e) { toastError(e); }
}

window.addEventListener('hashchange', route);
window.addEventListener('wt:lang', () => route());
// Signed out in the other Wintertuin app (same login): follow along
sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' && state.me) { state.me = null; location.hash = '#/login'; } });
if (!authLink && !/^#\/(login|home|today|calendar|month|dashboard|settings|password|vat)/.test(location.hash)) {
  // open the start page once we know who is signed in (it depends on the menu order)
  history.replaceState(null, '', `${location.pathname}${location.search}#/home`);
}
route();
