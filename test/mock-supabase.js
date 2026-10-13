// In-memory stand-in for the Supabase client, used only by the browser smoke test (test/ui-test.cjs).
// It mimics the parts of supabase-js the app uses and the database triggers that fill
// organization_id, VAT amounts and completion stamps. Security is NOT mocked: that is tested in SQL.
(function () {
  const uid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
  const ORG = uid(); const REST = uid(); const ME = uid();
  const role = window.__MOCK_ROLE || 'org_admin';
  const db = {
    fin_organizations: [{ id: ORG, name: 'Wintertuin' }],
    fin_restaurants: [{ id: REST, organization_id: ORG, name: 'Wintertuin', city: 'Baarn', latitude: 52.2128, longitude: 5.2911, investment_amount: 105000, investment_start: null }],
    fin_app_users: [{ id: uid(), user_id: ME, organization_id: ORG, restaurant_id: null, role, full_name: 'Tester', language: 'en', active: true }],
    fin_vat_rates: [[0, '0%'], [0.09, '9%'], [0.21, '21%']].map(([rate, label], i) => ({ id: uid(), organization_id: ORG, restaurant_id: REST, label, rate, sort_order: i })),
    fin_revenue_streams: [['bakery_takeaway', 'Bakery takeaway', 'Bakkerij afhaal', 0.09, 'food'], ['bakery_wholesale', 'Bakery wholesale', 'Bakkerij groothandel', 0.09, 'food'],
      ['lunch', 'Lunch', 'Lunch', 0.09, 'food'], ['early_dinner', 'Early dinner', 'Vroeg diner', 0.09, 'food'], ['dinner_events', 'Dinner / events', 'Diner / events', 0.09, 'food'],
      ['bev_nonalc', 'Drinks, non-alcoholic', 'Dranken, alcoholvrij', 0.09, 'beverage'], ['bev_alc', 'Drinks, alcoholic', 'Dranken, alcoholisch', 0.21, 'beverage'],
      ['shop_food', 'Shop, food', 'Winkel, food', 0.09, 'food'], ['shop_nonfood', 'Shop, non-food', 'Winkel, non-food', 0.21, 'other'], ['other', 'Other', 'Overig', 0.21, 'other']]
      .map(([code, en, nl, vat, g], i) => ({ id: uid(), organization_id: ORG, restaurant_id: REST, code, name_en: en, name_nl: nl, vat_rate: vat, kpi_group: g, sort_order: i * 10, active: true })),
    fin_purchase_categories: [['food', 'Food', 'Food', 'food', 0.09], ['misc', 'Miscellaneous', 'Diversen', 'food', 0.09], ['bev_nonalc', 'Drinks, non-alcoholic', 'Dranken, alcoholvrij', 'beverage', 0.09],
      ['bev_alc', 'Drinks, alcoholic', 'Dranken, alcoholisch', 'beverage', 0.21], ['non_food', 'Non-food', 'Non-food', 'non_food', 0.21], ['cleaning', 'Cleaning', 'Schoonmaak', 'cleaning', 0.21],
      ['small_inventory', 'Small inventory', 'Klein inventaris', 'small_inventory', 0.21]]
      .map(([code, en, nl, kind, vat], i) => ({ id: uid(), organization_id: ORG, restaurant_id: REST, code, name_en: en, name_nl: nl, kind, vat_rate: vat, sort_order: i * 10, active: true })),
    fin_suppliers: [],
    fin_staff: [['Joost', true], ['Jane', true], ['Carel', true], ['Kees', true], ['Sam', false]].map(([name, p], i) => ({ id: uid(), organization_id: ORG, restaurant_id: REST, name, is_partner: p, sort_order: i, active: true })),
    fin_staff_rates: [], fin_opening_hours: [], fin_closures: [], fin_targets: [], fin_fixed_costs: [],
    fin_days: [], fin_day_revenue: [], fin_purchases: [], fin_hours: [], fin_inventory_counts: [], fin_weather: [], fin_audit_log: [],
  };
  db.fin_suppliers.push({ id: uid(), organization_id: ORG, restaurant_id: REST, name: 'Bakker Groothandel', category_id: db.fin_purchase_categories[0].id, sort_order: 0, active: true });
  db.fin_staff_rates.push({ id: uid(), organization_id: ORG, restaurant_id: REST, staff_id: db.fin_staff[4].id, hourly_rate: 20, valid_from: '2000-01-01' });
  db.fin_staff_rates.push({ id: uid(), organization_id: ORG, restaurant_id: REST, staff_id: db.fin_staff[0].id, hourly_rate: 30, valid_from: '2000-01-01' });
  for (const season of ['summer', 'winter']) for (let wd = 1; wd <= 7; wd++) db.fin_opening_hours.push({ id: uid(), organization_id: ORG, restaurant_id: REST, season, weekday: wd, is_open: wd >= 5, open_time: wd >= 5 ? '08:00:00' : null, close_time: wd >= 5 ? '22:00:00' : null });
  for (const [m, v] of [['food_cost', 0.3], ['beverage_cost', 0.22], ['labor', 0.3], ['prime_cost', 0.6], ['nonfood_budget', 1500]]) db.fin_targets.push({ id: uid(), organization_id: ORG, restaurant_id: REST, metric: m, season: 'all', value: v });
  for (const [n, a] of [['Rent', 1666.67], ['Energy', 0], ['Insurance', 0]]) db.fin_fixed_costs.push({ id: uid(), organization_id: ORG, restaurant_id: REST, name: n, amount_month: a, sort_order: 0, active: true });
  // a few days of history in the current month
  const iso = (d) => d.toLocaleDateString('sv-SE');
  for (let back = 9; back >= 2; back--) {
    const d = new Date(); d.setDate(d.getDate() - back);
    if (Math.random() < 0.3) continue;
    const day = { id: uid(), organization_id: ORG, restaurant_id: REST, day: iso(d), status: back === 3 ? 'draft' : 'complete', covers: 30 + back, last_step: 4 };
    db.fin_days.push(day);
    db.fin_day_revenue.push({ id: uid(), organization_id: ORG, restaurant_id: REST, day_id: day.id, stream_id: db.fin_revenue_streams[2].id, amount_ex: 900 + back * 10, vat_rate: 0.09 });
    db.fin_day_revenue.push({ id: uid(), organization_id: ORG, restaurant_id: REST, day_id: day.id, stream_id: db.fin_revenue_streams[6].id, amount_ex: 300, vat_rate: 0.21 });
    db.fin_purchases.push({ id: uid(), organization_id: ORG, restaurant_id: REST, day_id: day.id, category_id: db.fin_purchase_categories[0].id, supplier_id: db.fin_suppliers[0].id, amount_ex: 280, vat_rate: 0.09 });
    db.fin_hours.push({ id: uid(), organization_id: ORG, restaurant_id: REST, day_id: day.id, staff_id: db.fin_staff[4].id, hours: 8 });
  }
  window.__mockdb = db;

  function triggers(table, row, old) {
    if (row.restaurant_id && !row.organization_id) row.organization_id = ORG;
    if (['fin_day_revenue', 'fin_purchases', 'fin_hours'].includes(table)) { const d = db.fin_days.find((x) => x.id === row.day_id); if (!d) throw new Error('Unknown day'); row.restaurant_id = d.restaurant_id; row.organization_id = d.organization_id; }
    if (row.amount_ex != null && row.vat_rate != null) row.vat_amount = Math.round(row.amount_ex * row.vat_rate * 100) / 100;
    if (table === 'fin_days') { row.status = row.status || 'draft'; row.last_step = row.last_step || 0; if (row.status === 'complete' && (!old || old.status !== 'complete')) row.completed_at = new Date().toISOString(); }
    return row;
  }
  const NOT_NULL = { fin_day_revenue: ['vat_rate'], fin_purchases: ['category_id', 'amount_ex', 'vat_rate'], fin_hours: ['hours', 'staff_id'] };

  class Q {
    constructor(table) { this.t = table; this.f = []; this.ord = []; this.op = 'select'; this.lim = null; this.one = null; }
    select() { if (this.op === 'select') this.op = 'select'; this.ret = true; return this; }
    eq(k, v) { this.f.push((r) => String(r[k]) === String(v)); return this; }
    gte(k, v) { this.f.push((r) => r[k] >= v); return this; }
    lte(k, v) { this.f.push((r) => r[k] <= v); return this; }
    or(s) {
      const groups = [...s.matchAll(/and\(([^)]*)\)/g)].map((m) => m[1].split(',').map((c) => c.split('.eq.')));
      this.f.push((r) => groups.some((g) => g.every(([k, v]) => String(r[k]) === v))); return this;
    }
    order(k, o) { this.ord.push([k, !(o && o.ascending === false)]); return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    single() { this.one = 'single'; return this; }
    insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
    update(p) { this.op = 'update'; this.patch = p; return this; }
    upsert(rows, o) { this.op = 'upsert'; this.rows = [].concat(rows); this.conflict = (o && o.onConflict ? o.onConflict : 'id').split(','); return this; }
    delete() { this.op = 'delete'; return this; }
    run() {
      const tbl = db[this.t] || (db[this.t] = []);
      const match = (r) => this.f.every((fn) => fn(r));
      let out = [];
      const check = (r) => { for (const k of NOT_NULL[this.t] || []) if (r[k] == null) throw new Error(`null value in column "${k}"`); };
      if (this.op === 'select') out = tbl.filter(match);
      if (this.op === 'insert') for (const r of this.rows) { const row = triggers(this.t, { id: uid(), created_at: new Date().toISOString(), ...r }); check(row); tbl.push(row); out.push(row); }
      if (this.op === 'update') for (const r of tbl.filter(match)) { const old = { ...r }; Object.assign(r, this.patch); triggers(this.t, r, old); out.push(r); }
      if (this.op === 'upsert') for (const r of this.rows) {
        const hit = tbl.find((x) => this.conflict.every((k) => String(x[k]) === String(r[k])));
        if (hit) { const old = { ...hit }; Object.assign(hit, r); triggers(this.t, hit, old); out.push(hit); }
        else { const row = triggers(this.t, { id: uid(), ...r }); check(row); tbl.push(row); out.push(row); }
      }
      if (this.op === 'delete') { for (let i = tbl.length - 1; i >= 0; i--) if (match(tbl[i])) tbl.splice(i, 1); }
      for (const [k, asc] of [...this.ord].reverse()) out.sort((a, b) => ((a[k] ?? '') > (b[k] ?? '') ? 1 : (a[k] ?? '') < (b[k] ?? '') ? -1 : 0) * (asc ? 1 : -1));
      if (this.lim) out = out.slice(0, this.lim);
      out = JSON.parse(JSON.stringify(out));
      if (this.one === 'single') { if (out.length !== 1) return { data: null, error: { message: 'Expected one row', code: 'PGRST116' } }; return { data: out[0], error: null }; }
      if (this.one === 'maybe') return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }
    then(res, rej) { let r; try { r = this.run(); } catch (e) { r = { data: null, error: { message: e.message } }; } return Promise.resolve(r).then(res, rej); }
  }

  function reportDays({ p_rest, p_from, p_to }) {
    if (role === 'staff') return { data: null, error: { message: 'Not allowed', code: '42501' } };
    const days = db.fin_days.filter((d) => d.restaurant_id === p_rest && d.day >= p_from && d.day <= p_to).sort((a, b) => (a.day > b.day ? 1 : -1));
    return { data: days.map((d) => {
      const rev = db.fin_day_revenue.filter((r) => r.day_id === d.id); const pur = db.fin_purchases.filter((p) => p.day_id === d.id); const hrs = db.fin_hours.filter((h) => h.day_id === d.id);
      const g = (id) => db.fin_revenue_streams.find((s) => s.id === id).kpi_group; const k = (id) => db.fin_purchase_categories.find((c) => c.id === id).kind;
      const sum = (arr, f) => arr.filter(f).reduce((a, x) => a + Number(x.amount_ex), 0);
      const rate = (sid) => { const r = db.fin_staff_rates.filter((x) => x.staff_id === sid && x.valid_from <= d.day).sort((a, b) => (a.valid_from > b.valid_from ? -1 : 1))[0]; return r ? Number(r.hourly_rate) : 0; };
      const partner = (sid) => db.fin_staff.find((s) => s.id === sid).is_partner;
      const bySup = {}; for (const p of pur) { const key = p.supplier_id || 'none'; bySup[key] = (bySup[key] || 0) + Number(p.amount_ex); }
      return { day: d.day, status: d.status, covers: d.covers, expected_covers: d.expected_covers,
        rev_food: sum(rev, (r) => g(r.stream_id) === 'food'), rev_beverage: sum(rev, (r) => g(r.stream_id) === 'beverage'), rev_other: sum(rev, (r) => g(r.stream_id) === 'other'),
        rev_vat: rev.reduce((a, r) => a + Number(r.vat_amount || 0), 0), revenue_by_stream: Object.fromEntries(rev.map((r) => [r.stream_id, Number(r.amount_ex)])),
        pur_food: sum(pur, (p) => k(p.category_id) === 'food'), pur_beverage: sum(pur, (p) => k(p.category_id) === 'beverage'), pur_non_food: sum(pur, (p) => k(p.category_id) === 'non_food'),
        pur_cleaning: sum(pur, (p) => k(p.category_id) === 'cleaning'), pur_small_inventory: sum(pur, (p) => k(p.category_id) === 'small_inventory'),
        pur_vat: pur.reduce((a, p) => a + Number(p.vat_amount || 0), 0), purchases_by_supplier: bySup,
        hours_staff: hrs.filter((h) => !partner(h.staff_id)).reduce((a, h) => a + Number(h.hours), 0), hours_partner: hrs.filter((h) => partner(h.staff_id)).reduce((a, h) => a + Number(h.hours), 0),
        labor_staff: hrs.filter((h) => !partner(h.staff_id)).reduce((a, h) => a + h.hours * rate(h.staff_id), 0), labor_partner: hrs.filter((h) => partner(h.staff_id)).reduce((a, h) => a + h.hours * rate(h.staff_id), 0) };
    }), error: null };
  }

  const SKEY = 'mock-session';
  // Like supabase-js: a reset link in the address signs you in and the hash gets cleared
  if (/access_token=/.test(location.hash)) { localStorage.setItem('mock-session', '1'); setTimeout(() => { location.hash = ''; }, 50); }
  const client = {
    from: (t) => new Q(t),
    rpc: async (name, args) => (name === 'fin_report_days' ? reportDays(args) : { data: null, error: null }),
    functions: { invoke: async (name, { body }) => {
      if (body.action === 'list') return { data: { users: db.fin_app_users.map((u) => ({ ...u, email: u.full_name.toLowerCase() + '@example.test', last_sign_in_at: null })) }, error: null };
      if (body.action === 'create') { db.fin_app_users.push({ id: uid(), user_id: uid(), organization_id: ORG, role: body.role, full_name: body.full_name, language: body.language, active: true }); return { data: { ok: true, email: body.email, password: 'Abc123xyz9' }, error: null }; }
      return { data: { ok: true, password: 'Abc123xyz9' }, error: null };
    } },
    auth: {
      getSession: async () => ({ data: { session: localStorage.getItem(SKEY) ? { user: { id: ME, email: 'tester@example.test' } } : null } }),
      signInWithPassword: async ({ email, password }) => { if (password !== 'test') return { data: null, error: { message: 'Invalid login credentials' } }; localStorage.setItem(SKEY, '1'); return { data: {}, error: null }; },
      signOut: async () => { localStorage.removeItem(SKEY); return { error: null }; },
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
    },
  };
  window.supabase = { createClient: () => client };
})();
