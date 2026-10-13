// App shell and router (hash based, no build step). Same structure as WASTE log.
import { state, perm, $, esc, app, toastError, renderLangToggle, savedRestId, saveRestId, refreshMeta, closeModal } from './core.js';
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

console.log(`Wintertuin Finance, build ${BUILD}`);

const RANK = { staff: 1, manager: 2, org_admin: 3, super_admin: 4 };
const routes = [
  { path: 'today', render: renderToday, nav: 'nav_today', show: () => true },
  { path: 'calendar', render: renderCalendar, nav: 'nav_calendar', show: perm.reports },
  { path: 'month', render: renderMonth, nav: 'nav_month', show: perm.reports },
  { path: 'dashboard', render: renderDashboard, nav: 'nav_dashboard', show: perm.reports },
  { path: 'settings', render: renderSettings, nav: 'nav_settings', show: perm.settings },
  { path: 'password', render: () => renderSetPassword(() => { location.hash = `#/${homePath()}`; }), nav: null, show: () => true },
];
const homePath = () => 'today';

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
    if (e.status !== 401) toastError(e);
    state.me = null;
    return false;
  }
}

function renderShell() {
  const top = $('#topbar');
  if (!state.me) { top.hidden = true; return; }
  top.hidden = false;
  const current = location.hash.replace(/^#\//, '').split('/')[0] || homePath();
  const nav = $('#nav');
  nav.innerHTML = routes.filter((r) => r.nav && r.show()).map((r) =>
    `<a href="#/${r.path}" class="${current === r.path ? 'active' : ''}">${t(r.nav)}</a>`).join('') +
    `<a href="#/password" class="${current === 'password' ? 'active' : ''}">${t('nav_password')}</a><a href="#/logout">${t('nav_logout')}</a>`;
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
    await signOut().catch(() => {});
    state.me = null; state.meta = null;
    location.hash = '#/login';
    return;
  }
  if (path === 'login') {
    state.me = null;
    renderShell();
    return renderLogin(async () => { if (await ensureSession()) location.hash = `#/${homePath()}`; });
  }
  if (!(await ensureSession())) { location.hash = '#/login'; return; }
  const r = routes.find((x) => x.path === path && x.show());
  if (!r) { location.hash = `#/${homePath()}`; return; }
  renderShell();
  app().className = 'app';
  window.scrollTo(0, 0);
  try { await r.render(rest); } catch (e) { toastError(e); }
}

window.addEventListener('hashchange', route);
window.addEventListener('wt:lang', () => route());
if (!authLink && !/^#\/(login|today|calendar|month|dashboard|settings|password)/.test(location.hash)) {
  history.replaceState(null, '', `${location.pathname}${location.search}#/today`);
}
route();
