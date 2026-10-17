// Links into the Wintertuin Team app (the BEO of an event). On a phone or tablet in the same window (a separate
// named tab froze or showed a stale copy on iOS); on a computer in the reused 'wintertuin-team' tab.
export const TEAM_URL = 'https://joost1305.github.io/wintertuin-staff-app/';
export const teamEventUrl = (id) => `${TEAM_URL}#/events/${id}`;
const touch = () => window.matchMedia('(pointer: coarse)').matches || window.navigator.standalone || !window.matchMedia('(display-mode: browser)').matches;
export const teamTarget = () => (touch() ? '' : 'target="wintertuin-team"');
