-- Wintertuin Finance: core schema
-- All objects use the fin_ prefix. Nothing outside fin_* is touched.

-- ---------------------------------------------------------------
-- Tenancy and access
-- ---------------------------------------------------------------
create table public.fin_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.fin_restaurants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  name text not null,
  city text,
  latitude numeric,
  longitude numeric,
  timezone text not null default 'Europe/Amsterdam',
  investment_amount numeric(12,2) not null default 0,
  investment_start date,
  created_at timestamptz not null default now()
);

create table public.fin_app_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid references public.fin_restaurants(id) on delete cascade, -- null = all restaurants of the org
  role text not null check (role in ('staff','manager','org_admin','super_admin')),
  full_name text,
  language text not null default 'en' check (language in ('en','nl')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, organization_id)
);
create index on public.fin_app_users (user_id);

-- ---------------------------------------------------------------
-- Helper functions (security definer, fixed search_path)
-- ---------------------------------------------------------------
create or replace function public.fin_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Amsterdam')::date
$$;

create or replace function public.fin_rank_of(p_role text)
returns int language sql immutable set search_path = public as $$
  select case p_role when 'staff' then 1 when 'manager' then 2 when 'org_admin' then 3 when 'super_admin' then 4 else 0 end
$$;

create or replace function public.fin_is_super()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fin_app_users where user_id = auth.uid() and active and role = 'super_admin')
$$;

-- Highest rank of the current user for a restaurant (0 = no access)
create or replace function public.fin_rank(p_rest uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(fin_rank_of(u.role)), 0)
  from fin_app_users u
  where u.user_id = auth.uid() and u.active
    and (
      u.role = 'super_admin'
      or (u.organization_id = (select r.organization_id from fin_restaurants r where r.id = p_rest)
          and (u.restaurant_id is null or u.restaurant_id = p_rest))
    )
$$;

-- Highest rank of the current user for an organization
create or replace function public.fin_org_rank(p_org uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(fin_rank_of(u.role)), 0)
  from fin_app_users u
  where u.user_id = auth.uid() and u.active
    and (u.role = 'super_admin' or u.organization_id = p_org)
$$;

-- Staff may edit today and yesterday; managers and up any date
create or replace function public.fin_can_edit_date(p_rest uuid, p_day date)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when fin_rank(p_rest) >= 2 then true
    when fin_rank(p_rest) = 1 then p_day between fin_today() - 1 and fin_today()
    else false end
$$;

-- ---------------------------------------------------------------
-- Settings tables
-- ---------------------------------------------------------------
create table public.fin_vat_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  label text not null,
  rate numeric(5,4) not null check (rate >= 0 and rate < 1),
  sort_order int not null default 0,
  unique (restaurant_id, rate)
);

create table public.fin_revenue_streams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  code text,
  name_en text not null,
  name_nl text not null,
  vat_rate numeric(5,4) not null default 0.09,
  kpi_group text not null default 'food' check (kpi_group in ('food','beverage','other')),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.fin_purchase_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  code text,
  name_en text not null,
  name_nl text not null,
  kind text not null check (kind in ('food','beverage','non_food','cleaning','small_inventory')),
  vat_rate numeric(5,4) not null default 0.21,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.fin_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  name text not null,
  category_id uuid references public.fin_purchase_categories(id) on delete set null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.fin_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  name text not null,
  is_partner boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Hourly rates: managers and up only. For partners this is the notional rate.
create table public.fin_staff_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  staff_id uuid not null references public.fin_staff(id) on delete cascade,
  hourly_rate numeric(8,2) not null check (hourly_rate >= 0),
  valid_from date not null default '2000-01-01',
  created_at timestamptz not null default now(),
  unique (staff_id, valid_from)
);

create table public.fin_opening_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  season text not null check (season in ('summer','winter')),
  weekday int not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  is_open boolean not null default false,
  open_time time,
  close_time time,
  unique (restaurant_id, season, weekday)
);

-- Exceptions: a closed day on a normal open day, or an extra open day
create table public.fin_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  day date not null,
  is_open boolean not null default false,
  note text,
  unique (restaurant_id, day)
);

create table public.fin_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  metric text not null check (metric in ('food_cost','beverage_cost','labor','prime_cost','nonfood_budget')),
  season text not null default 'all' check (season in ('all','summer','winter')),
  value numeric(12,4) not null,
  unique (restaurant_id, metric, season)
);

create table public.fin_fixed_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  name text not null,
  amount_month numeric(12,2) not null default 0,
  sort_order int not null default 0,
  active boolean not null default true
);

-- ---------------------------------------------------------------
-- Daily data
-- ---------------------------------------------------------------
create table public.fin_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  day date not null,
  status text not null default 'draft' check (status in ('draft','complete')),
  covers int check (covers >= 0),
  expected_covers int check (expected_covers >= 0),
  note text,
  last_step int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  completed_by uuid,
  completed_at timestamptz,
  unique (restaurant_id, day)
);

create table public.fin_day_revenue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  day_id uuid not null references public.fin_days(id) on delete cascade,
  stream_id uuid not null references public.fin_revenue_streams(id),
  amount_ex numeric(12,2) not null default 0,
  vat_rate numeric(5,4) not null,
  vat_amount numeric(12,2) generated always as (round(amount_ex * vat_rate, 2)) stored,
  updated_at timestamptz not null default now(),
  unique (day_id, stream_id)
);

create table public.fin_purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  day_id uuid not null references public.fin_days(id) on delete cascade,
  category_id uuid not null references public.fin_purchase_categories(id),
  supplier_id uuid references public.fin_suppliers(id) on delete set null,
  amount_ex numeric(12,2) not null,
  vat_rate numeric(5,4) not null,
  vat_amount numeric(12,2) generated always as (round(amount_ex * vat_rate, 2)) stored,
  note text,
  photo_path text,           -- phase 3: invoice photo
  source text not null default 'manual' check (source in ('manual','ai','import')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.fin_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  day_id uuid not null references public.fin_days(id) on delete cascade,
  staff_id uuid not null references public.fin_staff(id),
  hours numeric(5,2) not null check (hours >= 0 and hours <= 24),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (day_id, staff_id)
);

create table public.fin_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  food_begin numeric(12,2),
  bev_begin numeric(12,2),
  food_end numeric(12,2),
  bev_end numeric(12,2),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, year, month)
);

-- ---------------------------------------------------------------
-- Context and prepared integration tables
-- ---------------------------------------------------------------
create table public.fin_weather (
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  day date not null,
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  tmax numeric(4,1),
  tmin numeric(4,1),
  precip_mm numeric(5,1),
  sunshine_h numeric(4,1),
  weather_code int,
  fetched_at timestamptz not null default now(),
  primary key (restaurant_id, day)
);

create table public.fin_pos_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  source text not null,              -- 'csv', 'zreport_photo', or a POS provider name
  file_name text,
  status text not null default 'pending',
  row_count int,
  payload jsonb,
  imported_by uuid default auth.uid(),
  imported_at timestamptz not null default now()
);

create table public.fin_item_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  day date not null,
  item_code text,
  item_name text not null,
  stream_id uuid references public.fin_revenue_streams(id) on delete set null,
  qty numeric(10,2) not null default 0,
  revenue_ex numeric(12,2),
  source text,
  import_id uuid references public.fin_pos_imports(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.fin_item_sales (restaurant_id, day);

create table public.fin_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.fin_organizations(id) on delete cascade,
  restaurant_id uuid not null references public.fin_restaurants(id) on delete cascade,
  kind text not null check (kind in ('pos','reservations','waste_log','ai')),
  provider text,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.fin_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid,
  restaurant_id uuid,
  user_id uuid,
  table_name text not null,
  row_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  at timestamptz not null default now()
);
create index on public.fin_audit_log (organization_id, at desc);

-- Indexes for foreign keys used in reports
create index on public.fin_day_revenue (day_id);
create index on public.fin_purchases (day_id);
create index on public.fin_hours (day_id);
create index on public.fin_staff_rates (staff_id, valid_from desc);
