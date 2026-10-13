// Browser smoke test: runs the real app against test/mock-supabase.js.
// Usage: python3 -m http.server 8765 -d web &  then  node test/ui-test.cjs [outdir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8765/';
const OUT = process.argv[2] || 'test/shots';
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
fs.mkdirSync(OUT, { recursive: true });

async function session(browser, role, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript((r) => { window.__MOCK_ROLE = r; }, role);
  await page.route('**/vendor/supabase.js', (r) => r.fulfill({ contentType: 'application/javascript', body: MOCK }));
  await page.route(/open-meteo\.com/, (r) => {
    const u = new URL(r.request().url()); const s = u.searchParams.get('start_date'); const e = u.searchParams.get('end_date');
    const time = []; for (let d = new Date(s + 'T12:00:00'); d.toLocaleDateString('sv-SE') <= e; d.setDate(d.getDate() + 1)) time.push(d.toLocaleDateString('sv-SE'));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ daily: { time, temperature_2m_max: time.map(() => 14.2), temperature_2m_min: time.map(() => 6.1),
      precipitation_sum: time.map((_, i) => (i % 3 ? 0 : 2.4)), sunshine_duration: time.map(() => 14400), weather_code: time.map((_, i) => [0, 3, 61][i % 3]) } }) });
  });
  return { ctx, page, errors };
}
const step = async (name, fn) => { process.stdout.write(`- ${name} ... `); await fn(); console.log('ok'); };

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  try {
    // ---------------- org admin on a phone: login and the full green path
    const A = await session(browser, 'org_admin', { width: 390, height: 844 });
    const p = A.page;
    await step('login page renders', async () => { await p.goto(BASE); await p.waitForSelector('#login-form'); await p.screenshot({ path: `${OUT}/01-login.png` }); });
    await step('wrong password shows error', async () => {
      await p.fill('[name=email]', 'tester@example.test'); await p.fill('[name=password]', 'nope'); await p.click('button[type=submit]');
      await p.waitForSelector('.toast.error'); });
    await step('login lands on Today, step 1', async () => {
      await p.fill('[name=password]', 'test'); await p.click('button[type=submit]');
      await p.waitForSelector('#covers'); await p.screenshot({ path: `${OUT}/02-covers.png` }); });
    await step('next without covers is refused', async () => { await p.click('#next'); await p.waitForSelector('.toast.error'); if (!(await p.$('#covers'))) throw new Error('left step 1'); });
    await step('covers 42 and next', async () => { await p.fill('#covers', '41'); await p.click('#plus'); await p.waitForTimeout(800); await p.click('#next'); await p.waitForSelector('[data-stream]'); });
    await step('revenue excl and incl VAT', async () => {
      const inputs = await p.$$('[data-stream]');
      await inputs[2].fill('1000');          // lunch, excl
      await p.click('[data-mode=inc]');      // switch to incl VAT
      const again = await p.$$('[data-stream]');
      const shownLunch = await again[2].inputValue();
      if (shownLunch !== '1090') throw new Error('lunch incl VAT shows ' + shownLunch);
      await again[6].fill('605');            // alcoholic incl 21% => 500 excl
      await p.waitForTimeout(900);
      const total = await p.textContent('#rev-total');
      if (!/1[.,]500/.test(total)) throw new Error('total ' + total);
      await p.click('[data-mode=ex]');
      await p.screenshot({ path: `${OUT}/03-revenue.png`, fullPage: true });
      await p.click('#next'); await p.waitForSelector('#p-add'); });
    await step('purchases: supplier preselects category, add two deliveries', async () => {
      await p.click('[data-sup]'); // first supplier, default category Food
      const on = await p.textContent('.add-box .chip.on'); if (!/Food/.test(on)) throw new Error('category not preselected: ' + on);
      await p.fill('#p-amount', '300'); await p.click('#p-add'); await p.waitForSelector('.purchase-list li');
      await p.click('[data-sup=none]'); await p.click('.add-box .chip >> text=Cleaning'); await p.fill('#p-amount', '60,50'); await p.click('#p-add');
      await p.waitForFunction(() => document.querySelectorAll('.purchase-list li').length === 2);
      await p.screenshot({ path: `${OUT}/04-purchases.png`, fullPage: true });
      await p.click('#next'); await p.waitForSelector('[data-staff]'); });
    await step('hours: no rates visible, fill two people', async () => {
      const html = await p.content(); if (/€\s?20|20,00/.test(await p.textContent('#step'))) throw new Error('rate visible');
      await p.fill('[data-staff] >> nth=0', '6'); // Joost (partner) is listed under partners; first input is team member Sam
      await p.fill('[data-staff] >> nth=1', '8');
      await p.waitForTimeout(900);
      await p.screenshot({ path: `${OUT}/05-hours.png`, fullPage: true });
      await p.click('#next'); await p.waitForSelector('#close-day'); });
    await step('close the day', async () => { await p.click('#close-day'); await p.waitForSelector('.done-check'); await p.screenshot({ path: `${OUT}/06-done.png`, fullPage: true }); });
    await step('data saved as expected', async () => {
      const r = await p.evaluate(() => { const db = window.__mockdb; const today = new Date().toLocaleDateString('sv-SE'); const d = db.fin_days.find((x) => x.day === today);
        return { status: d.status, covers: d.covers, rev: db.fin_day_revenue.filter((x) => x.day_id === d.id).map((x) => x.amount_ex).sort(), pur: db.fin_purchases.filter((x) => x.day_id === d.id).map((x) => x.amount_ex).sort(), hrs: db.fin_hours.filter((x) => x.day_id === d.id).length }; });
      if (r.status !== 'complete' || r.covers !== 42 || JSON.stringify(r.rev) !== '[1000,500]' || JSON.stringify(r.pur) !== '[300,60.5]' || r.hrs !== 2) throw new Error(JSON.stringify(r)); });
    await step('stop halfway keeps a draft', async () => {
      await p.click('.chip >> text=Yesterday'); await p.waitForSelector('#covers');
      await p.fill('#covers', '12'); await p.waitForTimeout(900);
      await p.goto(BASE + '#/today'); await p.goto(BASE + '#/today/' + await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('sv-SE'); }));
      await p.waitForSelector('[data-stream]'); // resumes at step 2
      const st = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return window.__mockdb.fin_days.find((x) => x.day === d.toLocaleDateString('sv-SE')).status; });
      if (st !== 'draft') throw new Error(st); });
    await A.ctx.close();
    if (A.errors.length) { failed = true; console.log('ERRORS (phone):', A.errors); }

    // ---------------- org admin on a laptop: reports and settings
    const B = await session(browser, 'org_admin', { width: 1280, height: 900 });
    const q = B.page;
    await q.goto(BASE); await q.fill('[name=email]', 'a@b.c'); await q.fill('[name=password]', 'test'); await q.click('button[type=submit]'); await q.waitForSelector('#covers');
    await step('calendar shows colours and weather', async () => {
      await q.goto(BASE + '#/calendar'); await q.waitForSelector('.cal-grid');
      if (!(await q.$('.cal-day.complete'))) throw new Error('no green day'); if (!(await q.$('.cal-day.closed'))) throw new Error('no closed day');
      await q.screenshot({ path: `${OUT}/07-calendar.png`, fullPage: true }); });
    await step('month report with inventory count', async () => {
      await q.goto(BASE + '#/month'); await q.waitForSelector('#inv-form');
      await q.fill('[name=food_begin]', '1000'); await q.fill('[name=food_end]', '800'); await q.click('#inv-form button[type=submit]');
      await q.waitForTimeout(500); await q.waitForSelector('#inv-form');
      await q.screenshot({ path: `${OUT}/08-month.png`, fullPage: true }); });
    await step('dashboard with charts', async () => {
      await q.goto(BASE + '#/dashboard'); await q.waitForSelector('#c-rev'); await q.waitForTimeout(600);
      await q.screenshot({ path: `${OUT}/09-dashboard.png`, fullPage: true }); });
    for (const sec of ['staff', 'streams', 'categories', 'suppliers', 'vat', 'hours', 'closures', 'targets', 'fixed', 'restaurant', 'users', 'audit']) {
      await step(`settings: ${sec}`, async () => { await q.goto(BASE + '#/settings/' + sec); await q.waitForSelector('#sec .card'); });
    }
    await step('settings: add supplier via modal', async () => {
      await q.goto(BASE + '#/settings/suppliers'); await q.waitForSelector('#add'); await q.click('#add');
      await q.fill('.modal [name=name]', 'Groenteboer Baarn'); await q.click('.modal button[type=submit]'); await q.waitForSelector('text=Groenteboer Baarn');
      await q.screenshot({ path: `${OUT}/10-settings.png`, fullPage: true }); });
    await step('settings: staff rate saved', async () => {
      await q.goto(BASE + '#/settings/staff'); await q.waitForSelector('[data-edit]'); await q.click('[data-edit] >> nth=1');
      await q.fill('.modal [name=hourly_rate]', '25'); await q.click('.modal button[type=submit]'); await q.waitForSelector('text=€25.00'); });
    await step('settings: add user shows password once', async () => {
      await q.goto(BASE + '#/settings/users'); await q.waitForSelector('#add'); await q.click('#add');
      await q.fill('.modal [name=email]', 'new@example.test'); await q.fill('.modal [name=full_name]', 'New Person'); await q.click('.modal button[type=submit]');
      await q.waitForSelector('.pw-card code'); await q.screenshot({ path: `${OUT}/11-user.png` }); });
    await step('switch to Dutch', async () => {
      await q.goto(BASE + '#/dashboard'); await q.waitForSelector('#lang-toggle [data-lang=nl]'); await q.click('#lang-toggle [data-lang=nl]');
      await q.waitForSelector('text=Instellingen'); await q.waitForSelector('#c-rev'); await q.screenshot({ path: `${OUT}/12-dashboard-nl.png` }); });
    await B.ctx.close();
    if (B.errors.length) { failed = true; console.log('ERRORS (laptop):', B.errors); }

    // ---------------- staff: only Today
    const C = await session(browser, 'staff', { width: 390, height: 844 });
    const s = C.page;
    await s.goto(BASE); await s.fill('[name=email]', 'a@b.c'); await s.fill('[name=password]', 'test'); await s.click('button[type=submit]'); await s.waitForSelector('#covers');
    await step('staff sees only Today in the menu', async () => {
      const links = await s.$$eval('#nav a', (as) => as.map((a) => a.getAttribute('href')));
      if (links.join(',') !== '#/today,#/logout') throw new Error(links.join(',')); });
    await step('staff cannot open dashboard or pick old dates', async () => {
      await s.goto(BASE + '#/dashboard'); await s.waitForSelector('#covers');
      if (await s.$('#pick-date')) throw new Error('date picker visible for staff');
      await s.goto(BASE + '#/today/2020-01-01'); await s.waitForSelector('#covers');
      const sub = await s.textContent('.page-head .muted'); if (/2020/.test(sub)) throw new Error('old date opened'); });
    await C.ctx.close();
    if (C.errors.length) { failed = true; console.log('ERRORS (staff):', C.errors); }
  } catch (e) { failed = true; console.log('\nFAILED:', e.message); }
  await browser.close();
  console.log(failed ? 'RESULT: FAIL' : 'RESULT: ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
