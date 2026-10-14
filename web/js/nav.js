// Order of the top menu, per restaurant. Admins set it under Settings (numbers 1, 2, 3 ...); the same for everyone.
// Items not in the saved order keep their default place after the ordered ones.
import { state } from './core.js';
import { update } from './data.js';

export const NAV_ITEMS = [['today', 'nav_today'], ['calendar', 'nav_calendar'], ['month', 'nav_month'], ['dashboard', 'nav_dashboard'], ['settings', 'nav_settings']];

export function orderPaths(paths, order) {
  const o = Array.isArray(order) ? order : [];
  const rank = (p) => { const i = o.indexOf(p); return i === -1 ? o.length + NAV_ITEMS.findIndex(([x]) => x === p) : i; };
  return [...paths].sort((a, b) => rank(a) - rank(b));
}

export async function saveNavOrder(order) {
  const saved = await update('fin_restaurants', state.rest.id, { nav_order: order });
  state.rest.nav_order = saved ? saved.nav_order : order;
  window.dispatchEvent(new Event('nav-order-changed'));
}
