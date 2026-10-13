# Wintertuin Finance

Daily figures and cost control for Wintertuin. Staff close the day in about two minutes;
managers see the calendar, month reports and a dashboard. Replaces `WINTERTUIN_FINANCES.xlsx`.

How it is built: see [ARCHITECTURE.md](ARCHITECTURE.md).

## Going live (once)

The database is already set up in the Supabase project `wintertuin-staff-app`.

1. Create a new repository on GitHub, for example `wintertuin-finance`.
2. Put all files from this folder in it (GitHub Desktop: clone, copy the files in, commit, push).
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. After the first push the app is at `https://joost1305.github.io/wintertuin-finance/`.
5. In Supabase: **Authentication → URL Configuration → Redirect URLs**, add that address,
   so the "forgot password" email brings people back to the finance app.

## First use

Sign in with your own account (you are super admin). Then, under **Settings**:

- **Staff and rates:** add the team and set hourly rates. Set a notional rate for the four partners.
- **Suppliers:** add your suppliers with their usual category.
- **Fixed costs:** fill in energy and insurance (rent is already there).
- **Users:** add the people who do the daily closing. If they already use the staff app, use the
  same email: they keep their password.

## Every day

Open the app, follow the green bar: covers, revenue, deliveries, hours, close the day.

## Twice a month

Managers: open **Month** and fill in the stock count (start and end of the month).
