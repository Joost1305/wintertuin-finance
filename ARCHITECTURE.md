# Wintertuin Finance, architecture

Daily figures and cost control for Wintertuin (Cantonspark, Baarn). Replaces
`WINTERTUIN_FINANCES.xlsx`. Staff enter the day in about two minutes at closing time by
following one green path; managers get a calendar, month reports and a dashboard.
Same build and feel as WASTE log: simple screen at the front, complexity at the back.

```
Phone / tablet / laptop ──► GitHub Pages (web/) ──► Supabase project "wintertuin-staff-app"
                                                     ├─ Auth          logins (shared with the staff app, access is separate)
                                                     ├─ Postgres      fin_* tables + Row Level Security + report function
                                                     └─ Edge Function fin-admin-users   create users, reset passwords
Open-Meteo (free, no key) ──► weather per day, stored in fin_weather
GitHub Actions: deploy web/ on push · daily keepalive ping (fin_ping)
```

## Where things are

| Path | What |
|---|---|
| `web/index.html`, `web/css/app.css` | Shell and styles (WASTE log base + finance additions) |
| `web/js/config.js` | Supabase URL, public key, build marker (shown in the browser console) |
| `web/js/app.js` | Router (hash based) and top bar |
| `web/js/core.js` | State, formatting, modal, forms, language switch |
| `web/js/data.js` | Every Supabase call, plus the weather fetch |
| `web/js/calc.js` | All business logic of the Excel: COGS, cost %, YTD, traffic lights, seasons, opening days, break-even |
| `web/js/i18n.js` | English and Dutch texts |
| `web/js/pages/today.js` | The green path (daily closing) |
| `web/js/pages/calendar.js`, `month.js`, `dashboard.js`, `settings.js` | Manager screens |
| `web/vendor/` | supabase-js and Chart.js, vendored (no CDN, no build step) |
| `supabase/migrations/` | Database: schema, security, starting data, function grants |
| `supabase/functions/fin-admin-users/` | User management (service role, re-checks permissions) |
| `test/` | Excel parity test, browser smoke test with an in-memory Supabase |
| `.github/workflows/` | Pages deploy and daily keepalive |

## Living next to the staff app

Both apps use the same Supabase project, because the free plan allows only two projects.
The finance app never touches the staff app tables.

- **Own tables:** everything is `public.fin_*`. A prefix instead of a separate schema, so no
  extra API settings are needed in Supabase.
- **Own access:** a login only works here with an active row in `fin_app_users`. A staff app
  user does not get finance access automatically.
- **One login:** both apps use the default Supabase session key on the same domain, so signing in to
  one signs you in to the other, and signing out of one signs you out of both. A signed-in user without
  finance access sees a "no access" screen with a link to the team app (they stay signed in).
- **Known side effect:** the staff app has a trigger (`on_auth_user_created`) that gives every
  new login a staff profile. A finance-only user created here can therefore also sign in to
  the staff app as staff. Left as is on purpose (no changes to the staff app). To close it, the
  staff app trigger can skip users with `raw_user_meta_data->>'app' = 'finance'`.

## Data model

Every table has `organization_id` and `restaurant_id` (multi-tenant ready, Wintertuin is the
only restaurant for now). Triggers fill both from the restaurant or the day, so the app cannot
send a wrong one.

| Group | Tables |
|---|---|
| Access | `fin_organizations`, `fin_restaurants`, `fin_app_users` (role, language, active) |
| People | `fin_staff` (team and partners), `fin_staff_rates` (hourly rate with `valid_from`) |
| Settings | `fin_revenue_streams` (VAT + counts as food / beverage / other), `fin_purchase_categories` (counts as food / beverage / non_food / cleaning / small_inventory), `fin_suppliers`, `fin_vat_rates`, `fin_opening_hours` (summer / winter per weekday), `fin_closures` (closed days and extra open days), `fin_targets` (all year, optional summer / winter), `fin_fixed_costs` |
| Daily | `fin_days` (status draft / complete, covers, expected covers), `fin_day_revenue`, `fin_purchases`, `fin_hours` |
| Monthly | `fin_inventory_counts` (food and beverage, begin and end) |
| Context | `fin_weather` (Open-Meteo, Baarn) |
| Prepared for later | `fin_pos_imports`, `fin_item_sales` (sales per dish), `fin_integrations` (POS, reservations, WASTE log, AI) |
| Control | `fin_audit_log` (every insert, update and delete, by trigger) |

All amounts are stored **excluding VAT**. Each revenue and purchase line stores its own VAT
rate; `vat_amount` is a generated column, so a VAT overview per month or quarter is one query.

## Roles and security

| Role | Can do |
|---|---|
| Staff | Green path for today and yesterday. No money reports, no dashboard, no targets, no rates |
| Manager | Everything staff can, all dates, calendar, month report, dashboard, stock counts, settings lists, hourly rates |
| Org admin | Plus targets, fixed costs, restaurant settings, users, audit log |
| Super admin | Everything, all organizations |

Rules live in the database, never in the app:

- `fin_rank(restaurant)` gives the user's rank; every policy uses it.
- `fin_can_edit_date()` lets staff touch only today and yesterday (Amsterdam time).
- Hourly rates are in their own table that staff cannot read. Labor cost is never stored per
  row; `fin_report_days()` multiplies hours by the rate valid on that day and only answers
  managers and up. So a rate change never rewrites history, and staff never see money.
- Only a super admin can create or change a super admin. Users are created through the
  `fin-admin-users` edge function, which re-checks the caller's role.
- Trigger functions cannot be called through the API; helper functions only by signed-in users.

Tested directly in SQL, simulating each role: staff see 0 rates, 0 targets, 0 audit rows, cannot
open the report, cannot create a day five days back, cannot promote themselves; an org admin
cannot demote the super admin; anonymous callers see nothing.

## How the Excel maps to the app

| Excel | App |
|---|---|
| Setup tab | Settings |
| Daily Entry row | One `fin_days` row plus its revenue, purchase and hours lines |
| Supplier columns + Misc | Purchase lines with category "counts as food" |
| Beverage column | Categories "counts as beverage" (non-alcoholic 9%, alcoholic 21%) |
| Non-food, Cleaning, Small Inv. | Their own categories, together the non-food budget (as in the Excel) |
| Labor Cost € | Hours × hourly rate, calculated in the report function |
| Food Rev. / Bev. Rev. | Revenue groups that count as food or beverage |
| Month tab, Inventory Counts | Month report, stock count box (begin defaults to last month's end) |
| Month tab, Monthly Summary | `calc.monthKpis()` |
| Cumulative tab | `calc.ytd()`: sums per month first, then divides, exactly like row 17 |
| Dashboard tab | Dashboard |
| Green / amber / red | On or under target, up to 15% over, more than 15% over |

`test/excel-parity.mjs` fills the real Excel with test data, recalculates it in LibreOffice and
compares: all 38 values (two months plus the cumulative tab) are identical.

**Additions on top of the Excel:** labor and prime cost shown with and without partner hours
(partners at a notional rate), break-even revenue per open day, investment payback, weather,
VAT per line, seasons, opening hours and closed days.

## Seasons and opening days

Seasons follow the clock change: summer from the last Sunday of March, winter from the last
Sunday of October (`calc.seasonOf`). Opening hours are set per season and weekday. A closed day
needs no entry and shows grey; `fin_closures` overrides single dates both ways (closed on a normal
day, or open on a day that is normally closed, such as a Wintertuin Verteld evening).

Calendar colours: green complete, amber partly entered, red open day in the past without a
complete entry, grey closed.

## The green path

1. Covers (big number, plus and minus, optional expected covers)
2. Revenue per group, excl. VAT; a switch lets staff type incl. VAT amounts as on the till receipt
3. Purchases: supplier button (preselects its category), category, amount, VAT; "nothing came in" skips
4. Hours per person, team and partners; no rates on screen
5. Check and close: the day turns green

Every input saves itself (debounced, flushed on every step change) as a draft. The day row is
only created on the first real input, so just opening a day leaves no trace. Reopening a day
continues at the first unfinished step.

## Weather

`data.ensureWeather()` fills missing days from Open-Meteo whenever the calendar or a month
report is opened, and when a day is closed. Recent days come from the forecast API, older days
(85+ days) from the archive API. Best effort: it never blocks anything.

## Integrations (prepared, not built)

- **POS:** `fin_pos_imports` holds each import (CSV, photo, or a POS push) with its raw payload;
  revenue per group goes into `fin_day_revenue` with `source`, dishes into `fin_item_sales`.
- **Reservations:** `fin_days.expected_covers`.
- **WASTE log:** `fin_integrations` (kind `waste_log`) for a later API link, bakery production vs sold vs waste.
- **AI photo reading:** `fin_purchases.photo_path` and `source = 'ai'`. Always a suggestion; the app works without a key.

## Phase plan

1. **Done:** login and roles, green path, calendar, month report, dashboard, settings, users, audit log, weather, keepalive.
2. Compare (vs last month and same month last year), VAT overview per month and quarter, Excel and CSV export, CSV import of revenue.
3. AI reading of Z-report and invoice photos (edge function, `ANTHROPIC_API_KEY` secret, photos in a private bucket).
4. POS integration, sales per dish, WASTE log link, forecasts with weather.

## Development

```bash
python3 -m http.server 8765 -d web          # open http://localhost:8765 (uses the live Supabase project)
node test/ui-test.cjs                       # browser smoke test against an in-memory Supabase (needs Playwright)
python3 test/excel-fill.py WINTERTUIN_FINANCES.xlsx && node test/excel-parity.mjs
```

Database changes: add a new numbered file in `supabase/migrations/` and apply it to the project.
After deploying, check the build marker in the browser console (`Wintertuin Finance, build …`)
to make sure the phone is not showing a cached version.
