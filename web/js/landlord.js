// Room hire for the landlord (Mette): per month, which events used her rooms and what the room hire was.
// Usually the restaurant invoices the guest and Mette invoices the restaurant for this ("via ons");
// sometimes Mette invoices the guest herself ("door Mette"): then it is not our revenue.
// The rooms and the landlord's name come from the Team app (Settings, Rooms).
import { sb, check } from './data.js';
import { state, esc, fmt } from './core.js';
import { lang } from './i18n.js';
import { TEAM_URL } from './team.js';

const L = (nl, en) => (lang() === 'nl' ? nl : en);
const r2 = (n) => Math.round(Number(n) * 100) / 100;

export async function landlordCard(from, to) {
  let rows; let rooms = { rooms: [], landlord: 'Mette te Velde' };
  try {
    [rows] = await Promise.all([
      sb.rpc('fin_event_money', { p_rest: state.rest.id, p_from: from, p_to: to }).then(check),
      sb.from('team_settings').select('value').eq('key', 'rooms').maybeSingle().then((r) => { if (r.data && r.data.value) rooms = { landlord: 'Mette te Velde', ...r.data.value }; }, () => null),
    ]);
  } catch { return ''; } // not a manager, or not set up yet
  const ownerOf = (x) => x.owner || ((rooms.rooms || []).find((r) => r.id === x.room_id) || {}).owner || (/restaurant/i.test(x.label || '') ? 'restaurant' : 'landlord');
  const lines = [];
  for (const e of rows || []) {
    const pl = Array.isArray(e.price_lines) ? e.price_lines : [];
    const own = pl.filter((x) => x && x.room_id && ownerOf(x) === 'landlord');
    if (own.length) own.forEach((x) => { const total = r2((x.qty == null || x.qty === '' ? 1 : Number(x.qty)) * Number(x.price || 0)); lines.push({ e, label: x.label || L('Zaalhuur', 'Room hire'), total, ex: r2(total / (1 + Number(x.vat || 0.21))), byHer: !!x.billed_by_landlord }); });
    else if (!pl.length && Number(e.room_hire) > 0) { const total = e.prices_incl_vat === false ? r2(Number(e.room_hire) * 1.21) : Number(e.room_hire); lines.push({ e, label: L('Zaalhuur', 'Room hire'), total, ex: r2(total / 1.21), byHer: false }); }
  }
  const via = lines.filter((x) => !x.byHer); const her = lines.filter((x) => x.byHer);
  const sum = (a, k) => r2(a.reduce((s, x) => s + x[k], 0));
  const name = esc(rooms.landlord || 'Mette te Velde');
  const row = (x) => `<li><div class="evl-top"><a href="${TEAM_URL}#/events/${x.e.id}" target="_blank" rel="noopener">${esc(x.e.title)}</a><span class="evl-amt">${fmt.money2(x.total)}</span></div>
    <div class="evl-sub">${esc(fmt.dayShort(x.e.event_date))} · ${esc(x.label)}${x.e.status === 'option' ? ` · <span class="badge amber">${L('optie', 'option')}</span>` : ''}</div></li>`;
  return `<div class="card" id="landlord-card" style="margin-top:16px"><h2>${L(`Zaalhuur voor ${name}`, `Room hire for ${name}`)}</h2>
    ${!lines.length ? `<p class="small muted">${L(`Deze maand geen events in ruimtes van ${name}.`, `No events in rooms of ${name} this month.`)}</p>` : `
    ${via.length ? `<h3 style="font-size:.95rem;margin:4px 0">${L(`Via ons gefactureerd: ${name} factureert ons`, `Invoiced by us: ${name} invoices us`)}</h3><ul class="ev-list">${via.map(row).join('')}</ul>
      <div class="kv-line"><strong>${L('Totaal', 'Total')} ${fmt.money2(sum(via, 'total'))}</strong> <span class="small muted">${L('incl. btw', 'incl. VAT')} · ${fmt.money2(sum(via, 'ex'))} ${L('excl.', 'excl.')}</span></div>` : ''}
    ${her.length ? `<h3 style="font-size:.95rem;margin:14px 0 4px">${L(`${name} factureert zelf aan de gast (niet onze omzet)`, `${name} invoices the guest herself (not our revenue)`)}</h3><ul class="ev-list">${her.map(row).join('')}</ul>` : ''}`}
    <p class="tiny muted" style="margin-top:8px">${L('Ruimtes, prijzen en verhuurder pas je aan in de Team-app onder Instellingen, Ruimtes. Haar factuur aan ons verwerk je als inkoopfactuur (straks in Moneybird).', 'Rooms, prices and landlord are set in the Team app under Settings, Rooms. Her invoice to us is a purchase invoice (soon in Moneybird).')}</p></div>`;
}
