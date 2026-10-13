// Checks that web/js/calc.js gives exactly the same numbers as WINTERTUIN_FINANCES.xlsx.
// 1. python3 test/excel-fill.py path/to/WINTERTUIN_FINANCES.xlsx   (fills test data, recalculates with LibreOffice)
// 2. node test/excel-parity.mjs
import fs from 'fs';
const { sumDays, monthKpis, ytd } = await import('../web/js/calc.js');
const dir = new URL('./out/', import.meta.url);
const inp = JSON.parse(fs.readFileSync(new URL('input.json', dir)));
const xl = JSON.parse(fs.readFileSync(new URL('excel_out.json', dir)));
const months = { January: [], February: [] };
for (const d of inp.days) {
  const m = d.row - 9 < 31 ? 'January' : 'February';
  months[m].push({ status: 'complete', covers: d.C, rev_food: d.N, rev_beverage: d.O, rev_other: 0, pur_food: d.D + d.E + d.F + d.G + d.H,
    pur_beverage: d.I, pur_non_food: d.J, pur_cleaning: d.K, pur_small_inventory: d.L, labor_staff: d.M, labor_partner: 0 });
}
let bad = 0; let n = 0; const ks = {};
const cmp = (label, a, b) => { n++; if (Math.abs((a ?? 0) - (b ?? 0)) > 1e-6) { bad++; console.log('DIFF', label, a, b); } };
for (const m of ['January', 'February']) {
  const i = inp.inv[m];
  ks[m] = monthKpis(sumDays(months[m]), { food_begin: i.F12, bev_begin: i.H12, food_end: i.F13, bev_end: i.H13 });
  for (const k of Object.keys(xl[m])) cmp(`${m}.${k}`, ks[m][k], xl[m][k]);
  cmp(`${m}.nonfood`, ks[m].nonfood, xl.nonfood[m]);
}
const Y = ytd([ks.January, ks.February]);
for (const k of Object.keys(xl.YTD)) cmp(`YTD.${k}`, Y[k], xl.YTD[k]);
console.log(`${n - bad}/${n} values identical to the Excel`);
process.exit(bad ? 1 : 0);
