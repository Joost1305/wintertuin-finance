// Browser smoke test: runs the real app against test/mock-supabase.js.
// Usage: python3 -m http.server 8765 -d web &  then  node test/ui-test.cjs [outdir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8765/';
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
    await step('hours: pre-filled from clock-ins, no rates visible, fill two people', async () => {
      if (/€\s?20|20,00/.test(await p.textContent('#step'))) throw new Error('rate visible');
      if ((await p.inputValue('[data-staff] >> nth=0')) !== '7,5') throw new Error('not prefilled: ' + await p.inputValue('[data-staff] >> nth=0'));
      if (!(await p.$('text=clocked 7.6 h'))) throw new Error('no hint');
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
      // missing only where people worked (Fri/Sat in the mock); open Sundays without anyone working are quiet
      const miss = await q.$$eval('.cal-day.missing[data-day]', (b) => b.map((x) => new Date(x.dataset.day + 'T12:00:00').getDay()));
      if (miss.some((wd) => wd !== 5 && wd !== 6)) throw new Error('missing on a day nobody worked: ' + miss);
      await q.screenshot({ path: `${OUT}/07-calendar.png`, fullPage: true }); });
    await step('calendar: add and remove a day note', async () => {
      const b = await q.$('[data-note]'); const d = await b.getAttribute('data-note');
      await b.click(); await q.fill('.modal [name=v]', 'Themed evening'); await q.click('.modal button[type=submit]');
      await q.waitForSelector('.cal-day .n >> text=Themed evening');
      if (!/#\/calendar/.test(q.url())) throw new Error('note button opened the day');
      await q.click(`[data-note="${d}"]`); await q.click('#nclear'); await q.waitForTimeout(400);
      if (await q.$('.cal-day .n >> text=Themed evening')) throw new Error('note not removed'); });
    await step('calendar: close and reopen a day with one click', async () => {
      const b = await q.$('.cal-toggle.is-open'); const d = await b.getAttribute('data-toggle');
      await b.click(); await q.waitForSelector(`.cal-toggle.is-closed[data-toggle="${d}"]`);
      if (!/#\/calendar/.test(q.url())) throw new Error('toggle opened the day');
      await q.click(`.cal-toggle[data-toggle="${d}"]`); await q.waitForSelector(`.cal-toggle.is-open[data-toggle="${d}"]`);
      const links = await q.$$eval('.settings-nav a', (a) => a.map((x) => x.getAttribute('href'))).catch(() => []);
      if (links.includes('#/settings/closures')) throw new Error('closures still in settings'); });
    await step('VAT page per quarter with export', async () => {
      await q.goto(BASE + '#/vat'); await q.waitForSelector('#body .kpi');
      if (!/#\/settings\/vatreport/.test(q.url())) throw new Error('VAT not under Settings: ' + q.url());
      if ((await q.$$eval('#nav a', (as) => as.map((a) => a.textContent))).some((x) => /^VAT$/.test(x.trim()))) throw new Error('VAT still in menu');
      await q.screenshot({ path: `${OUT}/13-vat.png`, fullPage: true });
      const [dl] = await Promise.all([q.waitForEvent('download'), q.click('#xlsx')]); if (!dl.suggestedFilename().endsWith('.xlsx')) throw new Error('no xlsx'); });
    await step('month report with inventory count', async () => {
      await q.goto(BASE + '#/month'); await q.waitForSelector('#inv-form');
      await q.fill('[name=food_begin]', '1000'); await q.fill('[name=food_end]', '800'); await q.click('#inv-form button[type=submit]');
      await q.waitForTimeout(500); await q.waitForSelector('#inv-form');
      await q.waitForSelector('#compare table');
      const [dl] = await Promise.all([q.waitForEvent('download'), q.click('#xlsx')]); if (!dl.suggestedFilename().endsWith('.xlsx')) throw new Error('no xlsx');
      await q.screenshot({ path: `${OUT}/08-month.png`, fullPage: true }); });
    await step('calendar: events from the team app link to their BEO, the automatic note is replaced', async () => {
      await q.goto(BASE + '#/calendar'); await q.waitForSelector('.cal-grid');
      const href = await q.getAttribute('.cal-ev.ev-confirmed', 'href'); if (!/wintertuin-staff-app\/#\/events\/ev1$/.test(href)) throw new Error('link ' + href);
      if (!(await q.$('.cal-ev.ev-option'))) throw new Error('option not shown'); });
    await step('dashboard: every KPI tile has an (i) explaining the sum with real figures', async () => {
      await q.goto(BASE + '#/dashboard'); await q.waitForSelector('#c-rev');
      const n = (await q.$$('.grid-kpi [data-info]')).length; if (n !== 8) throw new Error('info buttons: ' + n);
      await q.click('[data-info=food]'); await q.waitForSelector('.info-pop');
      const txt = await q.textContent('.info-pop');
      if (!/opening stock \+ purchases/.test(txt) || !/÷/.test(txt) || !/so far/.test(txt)) throw new Error('food info: ' + txt);
      await q.click('.modal [data-close]');
      await q.click('[data-info=labor]'); await q.waitForSelector('.info-pop'); if (!/hourly rate/.test(await q.textContent('.info-pop'))) throw new Error('labor info');
      await q.click('.modal [data-close]'); });
    await step('dashboard with charts, planned labor and Excel export', async () => {
      await q.goto(BASE + '#/dashboard'); await q.waitForSelector('#c-rev'); await q.waitForSelector('#planned-labor .kpi'); await q.waitForTimeout(600);
      if (!(await q.$('text=planned hours belong to people'))) throw new Error('no unlinked note');
      const [dl] = await Promise.all([q.waitForEvent('download'), q.click('#xlsx')]); if (!dl.suggestedFilename().endsWith('.xlsx')) throw new Error(dl.suggestedFilename());
      await q.screenshot({ path: `${OUT}/09-dashboard.png`, fullPage: true }); });
    await step('dashboard: events ahead with expected revenue and overdue deposit', async () => {
      await q.goto(BASE + '#/dashboard'); await q.waitForSelector('#events-card table');
      const txt = await q.textContent('#events-card'); if (!/Wedding Jansen/.test(txt) || !/Company dinner/.test(txt) || !/was due/.test(txt)) throw new Error(txt);
      if (!(await q.$('#events-card a[target=wintertuin-team]'))) throw new Error('no link to team app'); });
    await step('settings: import team app accounts', async () => {
      await q.goto(BASE + '#/settings/staff'); await q.waitForSelector('#import-team'); await q.click('#import-team'); await q.click('#cf-ok'); await q.waitForTimeout(500);
      const lisa = await q.evaluate(() => window.__mockdb.fin_staff.find((s) => s.user_id === 'p-lisa')); if (!lisa) throw new Error('not imported'); });
    await step('top bar: app switch next to the brand, no Password for managers', async () => {
      if (!(await q.isVisible('#app-switch'))) throw new Error('no switch');
      const links = await q.$$eval('#nav a', (as) => as.map((a) => a.getAttribute('href'))); if (links.includes('#/password')) throw new Error('password in menu'); });
    for (const sec of ['vatreport', 'staff', 'streams', 'categories', 'suppliers', 'vat', 'hours', 'targets', 'fixed', 'restaurant', 'users', 'audit', 'system', 'password']) {
      await step(`settings: ${sec}`, async () => { await q.goto(BASE + '#/settings/' + sec); await q.waitForSelector('#sec .card'); });
    }
    await step('settings: add supplier via modal', async () => {
      await q.goto(BASE + '#/settings/suppliers'); await q.waitForSelector('#add'); await q.click('#add');
      await q.fill('.modal [name=name]', 'Groenteboer Baarn'); await q.click('.modal button[type=submit]'); await q.waitForSelector('text=Groenteboer Baarn');
      await q.screenshot({ path: `${OUT}/10-settings.png`, fullPage: true }); });
    await step('suppliers: order link, account manager and hidden login', async () => {
      await q.click('[data-edit] >> nth=0'); await q.waitForSelector('.modal [name=order_url]');
      await q.fill('.modal [name=order_url]', 'shop.bidfood.nl'); await q.fill('.modal [name=customer_number]', 'K-12345');
      await q.fill('.modal [name=username]', 'keuken@wintertuin.nl'); await q.fill('.modal [name=password]', 'S3cret!pw');
      await q.fill('.modal [name=contact_name]', 'Petra Jansen'); await q.fill('.modal [name=contact_phone]', '06 12 34 56 78'); await q.fill('.modal [name=contact_email]', 'petra@bidfood.nl');
      await q.click('.modal button[type=submit]'); await q.waitForSelector('text=Petra Jansen');
      const href = await q.getAttribute('a:has-text("Order online")', 'href'); if (href !== 'https://shop.bidfood.nl') throw new Error(href);
      if (await q.$('text=S3cret!pw')) throw new Error('password visible before Show');
      await q.click('[data-show]'); await q.waitForSelector('text=S3cret!pw');
      if (!(await q.$('a[href="tel:0612345678"]'))) throw new Error('no tel link');
      const audit = await q.evaluate(() => JSON.stringify(window.__mockdb.fin_audit_log || [])); if (/S3cret/.test(audit)) throw new Error('password in audit');
      await q.screenshot({ path: `${OUT}/10b-suppliers.png`, fullPage: true }); });
    await step('suppliers: javascript: links are refused', async () => {
      await q.click('[data-edit] >> nth=0'); await q.fill('.modal [name=website]', 'javascript:alert(1)'); await q.click('.modal button[type=submit]');
      await q.waitForSelector('.toast.error'); await q.click('.modal [data-close]'); });
    await step('manager deletes a day, everything for that day is gone', async () => {
      const day = await q.evaluate(() => window.__mockdb.fin_days[0].day);
      await q.goto(BASE + '#/today/' + day); await q.waitForSelector('[data-step]');
      await q.click('[data-step="4"]'); await q.waitForSelector('#del-day'); await q.click('#del-day'); await q.click('#cf-ok'); await q.waitForTimeout(400);
      const left = await q.evaluate((d) => window.__mockdb.fin_days.some((x) => x.day === d), day); if (left) throw new Error('day still there');
      await q.waitForSelector('#covers'); });
    await step('settings: staff rate saved', async () => {
      await q.goto(BASE + '#/settings/staff'); await q.waitForSelector('[data-edit]'); await q.click('[data-edit] >> nth=1');
      await q.fill('.modal [name=hourly_rate]', '25'); await q.click('.modal button[type=submit]'); await q.waitForSelector('text=€25.00'); });
    await step('settings: targets show one column, seasons on request', async () => {
      await q.goto(BASE + '#/settings/targets'); await q.waitForSelector('#tgt');
      if (await q.isVisible('#tgt th.sea')) throw new Error('summer/winter shown while empty');
      await q.click('#tgt-seasons'); await q.waitForSelector('#tgt th.sea', { state: 'visible' });
      await q.fill('[data-m=labor][data-s=winter]', '35'); await q.click('#save-t'); await q.waitForTimeout(800);
      await q.waitForSelector('#tgt.show-seasons'); if ((await q.inputValue('[data-m=labor][data-s=winter]')) !== '35') throw new Error('winter not saved');
      await q.click('#tgt-seasons'); await q.click('#save-t'); await q.waitForTimeout(800);
      await q.waitForSelector('#tgt:not(.show-seasons)'); if (await q.isVisible('#tgt th.sea')) throw new Error('seasons not cleared'); });
    await step('settings: top menu order by number, applied to the menu, reset', async () => {
      await q.goto(BASE + '#/settings/navorder'); await q.waitForSelector('#save-nav');
      await q.fill('[data-nav=dashboard]', '1'); await q.click('#save-nav'); await q.waitForTimeout(400);
      const first = await q.$eval('#nav a', (a) => a.getAttribute('href')); if (first !== '#/dashboard') throw new Error('first is ' + first);
      await q.goto(BASE + '#/home'); await q.waitForSelector('#c-rev'); if (!/#\/dashboard$/.test(q.url())) throw new Error('start page is ' + q.url());
      await q.goto(BASE + '#/settings/navorder'); await q.waitForSelector('#save-nav');
      await q.click('#reset-nav'); await q.click('#save-nav'); await q.waitForTimeout(400);
      if ((await q.$eval('#nav a', (a) => a.getAttribute('href'))) !== '#/today') throw new Error('reset'); });
    await step('settings: add user shows password once', async () => {
      await q.goto(BASE + '#/settings/users'); await q.waitForSelector('#add'); await q.click('#add');
      await q.fill('.modal [name=email]', 'new@example.test'); await q.fill('.modal [name=full_name]', 'New Person'); await q.click('.modal button[type=submit]');
      await q.waitForSelector('.pw-card code'); await q.screenshot({ path: `${OUT}/11-user.png` }); });
    await step('employee view: manager sees the staff screens, then goes back', async () => {
      await q.goto(BASE + '#/settings'); await q.waitForSelector('#emp-on'); await q.click('#emp-on');
      await q.waitForSelector('#emp-bar'); await q.waitForTimeout(300);
      const links = await q.$$eval('#nav a', (as) => as.map((a) => a.getAttribute('href')));
      if (links.includes('#/settings')) throw new Error('settings still in menu');
      if (!links.includes('#/password')) throw new Error('no staff password link');
      if (links.includes('#/dashboard')) throw new Error('dashboard visible'); if (await q.$('#pick-date')) throw new Error('date picker visible');
      await q.screenshot({ path: `${OUT}/14-employee-view.png`, fullPage: true });
      await q.click('#emp-off'); await q.waitForSelector('#emp-on');
      if (await q.$('#emp-bar')) throw new Error('banner stayed'); });
    await step('settings: system check shows checks, gaps, changes; run now adds a green check', async () => {
      await q.goto(BASE + '#/settings/system'); await q.waitForSelector('.sc-list');
      const txt = await q.textContent('#sec'); if (!/Works, but worth a look/.test(txt) || !/Daily closing missing/.test(txt) || !/Wedding Jansen/.test(txt)) throw new Error(txt.slice(0, 300));
      await q.screenshot({ path: `${OUT}/19-system-check.png`, fullPage: true });
      await q.click('#sc-run'); await q.waitForSelector('text=Everything works'); });
    await step('switch to Dutch', async () => {
      await q.goto(BASE + '#/dashboard'); await q.waitForSelector('#lang-toggle [data-lang=nl]'); await q.click('#lang-toggle [data-lang=nl]');
      await q.waitForSelector('text=Instellingen'); await q.waitForSelector('#c-rev'); await q.screenshot({ path: `${OUT}/12-dashboard-nl.png` }); });
    await B.ctx.close();
    if (B.errors.length) { failed = true; console.log('ERRORS (laptop):', B.errors); }

    // ---------------- password reset link must show the new-password screen and stay there
    const R = await session(browser, 'org_admin', { width: 390, height: 844 });
    await step('reset link opens "choose a new password" and stays', async () => {
      await R.page.goto(BASE + '#access_token=abc&refresh_token=x&type=recovery');
      await R.page.waitForSelector('#pw-form'); await R.page.waitForTimeout(1200);
      if (!(await R.page.$('#pw-form'))) throw new Error('skipped the password screen');
      await R.page.fill('[name=pw]', 'nieuwwachtwoord1'); await R.page.fill('[name=pw2]', 'nieuwwachtwoord1'); await R.page.click('#pw-form button[type=submit]');
      await R.page.waitForSelector('#covers'); });
    await step('admins find their password under Settings', async () => {
      await R.page.goto(BASE + '#/settings/password'); await R.page.waitForSelector('#pw'); });
    await R.ctx.close();
    if (R.errors.length) { failed = true; console.log('ERRORS (reset):', R.errors); }

    // ---------------- staff: only Today
    const C = await session(browser, 'staff', { width: 390, height: 844 });
    const s = C.page;
    await s.goto(BASE); await s.fill('[name=email]', 'a@b.c'); await s.fill('[name=password]', 'test'); await s.click('button[type=submit]'); await s.waitForSelector('#covers');
    await step('staff sees only Today in the menu', async () => {
      const links = await s.$$eval('#nav a', (as) => as.map((a) => a.getAttribute('href')));
      if (links.filter((l) => l.startsWith('#')).join(',') !== '#/today,#/password,#/logout') throw new Error(links.join(',')); });
    await step('staff cannot open dashboard or pick old dates', async () => {
      await s.goto(BASE + '#/dashboard'); await s.waitForSelector('#covers');
      if (await s.$('#pick-date')) throw new Error('date picker visible for staff');
      await s.goto(BASE + '#/today/2020-01-01'); await s.waitForSelector('#covers');
      const sub = await s.textContent('.page-head .muted'); if (/2020/.test(sub)) throw new Error('old date opened'); });
    await step('staff sees the event of today without money', async () => {
      await s.goto(BASE + '#/today'); await s.waitForSelector('.event-today');
      const txt = await s.textContent('.event-today'); if (!/Wedding Jansen/.test(txt) || /€/.test(txt)) throw new Error(txt); });
    await step('staff has no Delete this day button', async () => {
      await s.fill('#covers', '12'); await s.waitForTimeout(900); await s.click('[data-step="4"]'); await s.waitForSelector('.sum-grid');
      if (await s.$('#del-day')) throw new Error('delete visible for staff'); });
    await C.ctx.close();
    if (C.errors.length) { failed = true; console.log('ERRORS (staff):', C.errors); }
  } catch (e) { failed = true; console.log('\nFAILED:', e.message); }
  await browser.close();
  console.log(failed ? 'RESULT: FAIL' : 'RESULT: ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
