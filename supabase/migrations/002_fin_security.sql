-- Wintertuin Finance: triggers, row level security, RPC functions

-- ---------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------

-- Child rows of a day inherit organization and restaurant from the day,
-- and VAT rate defaults to the stream or category rate.
create or replace function public.fin_child_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select organization_id, restaurant_id into d from fin_days where id = new.day_id;
  if not found then raise exception 'Unknown day'; end if;
  new.organization_id := d.organization_id;
  new.restaurant_id := d.restaurant_id;
  -- Only revenue and purchases have a VAT rate; nested IFs so fin_hours never touches the field
  if tg_table_name = 'fin_day_revenue' then
    if new.vat_rate is null then select vat_rate into new.vat_rate from fin_revenue_streams where id = new.stream_id; end if;
  elsif tg_table_name = 'fin_purchases' then
    if new.vat_rate is null then select vat_rate into new.vat_rate from fin_purchase_categories where id = new.category_id; end if;
  end if;
  return new;
end $$;

create trigger fin_day_revenue_defaults before insert or update on public.fin_day_revenue
  for each row execute function public.fin_child_defaults();
create trigger fin_purchases_defaults before insert or update on public.fin_purchases
  for each row execute function public.fin_child_defaults();
create trigger fin_hours_defaults before insert or update on public.fin_hours
  for each row execute function public.fin_child_defaults();

-- Days: organization follows restaurant; track who changed what
create or replace function public.fin_days_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select organization_id into new.organization_id from fin_restaurants where id = new.restaurant_id;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status <> 'complete') then
    new.completed_at := now();
    new.completed_by := auth.uid();
  end if;
  return new;
end $$;
create trigger fin_days_touch before insert or update on public.fin_days
  for each row execute function public.fin_days_touch();

-- Restaurant scoped settings rows: organization always follows restaurant
create or replace function public.fin_set_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select organization_id into new.organization_id from fin_restaurants where id = new.restaurant_id;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['fin_vat_rates','fin_revenue_streams','fin_purchase_categories','fin_suppliers',
    'fin_staff','fin_staff_rates','fin_opening_hours','fin_closures','fin_targets','fin_fixed_costs',
    'fin_inventory_counts','fin_weather','fin_pos_imports','fin_item_sales','fin_integrations']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fin_set_org()', t || '_org', t);
  end loop;
end $$;

-- Audit log
create or replace function public.fin_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  src jsonb := coalesce(n, o);
begin
  insert into fin_audit_log (organization_id, restaurant_id, user_id, table_name, row_id, action, old_data, new_data)
  values ((src->>'organization_id')::uuid, nullif(src->>'restaurant_id','')::uuid, auth.uid(),
          tg_table_name, src->>'id', tg_op, o, n);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['fin_days','fin_day_revenue','fin_purchases','fin_hours','fin_inventory_counts',
    'fin_staff','fin_staff_rates','fin_targets','fin_fixed_costs','fin_revenue_streams','fin_purchase_categories',
    'fin_suppliers','fin_opening_hours','fin_closures','fin_app_users','fin_restaurants','fin_vat_rates']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.fin_audit()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fin_organizations','fin_restaurants','fin_app_users','fin_vat_rates','fin_revenue_streams',
    'fin_purchase_categories','fin_suppliers','fin_staff','fin_staff_rates','fin_opening_hours','fin_closures',
    'fin_targets','fin_fixed_costs','fin_days','fin_day_revenue','fin_purchases','fin_hours','fin_inventory_counts',
    'fin_weather','fin_pos_imports','fin_item_sales','fin_integrations','fin_audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Generic restaurant scoped tables: (table, read rank, write rank)
-- 1 = staff, 2 = manager, 3 = org admin
do $$
declare
  r record;
begin
  for r in select * from (values
    ('fin_vat_rates', 1, 2),
    ('fin_revenue_streams', 1, 2),
    ('fin_purchase_categories', 1, 2),
    ('fin_suppliers', 1, 2),
    ('fin_staff', 1, 2),
    ('fin_staff_rates', 2, 2),
    ('fin_opening_hours', 1, 2),
    ('fin_closures', 1, 2),
    ('fin_targets', 2, 3),
    ('fin_fixed_costs', 2, 3),
    ('fin_inventory_counts', 2, 2),
    ('fin_weather', 1, 1),
    ('fin_pos_imports', 2, 2),
    ('fin_item_sales', 2, 2),
    ('fin_integrations', 3, 3)
  ) as v(tbl, rd, wr)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.fin_rank(restaurant_id) >= %s)', r.tbl || '_select', r.tbl, r.rd);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.fin_rank(restaurant_id) >= %s)', r.tbl || '_insert', r.tbl, r.wr);
    execute format('create policy %I on public.%I for update to authenticated using (public.fin_rank(restaurant_id) >= %s) with check (public.fin_rank(restaurant_id) >= %s)', r.tbl || '_update', r.tbl, r.wr, r.wr);
    execute format('create policy %I on public.%I for delete to authenticated using (public.fin_rank(restaurant_id) >= %s)', r.tbl || '_delete', r.tbl, r.wr);
  end loop;
end $$;

-- Organizations
create policy fin_organizations_select on public.fin_organizations for select to authenticated
  using (public.fin_org_rank(id) >= 1);
create policy fin_organizations_update on public.fin_organizations for update to authenticated
  using (public.fin_org_rank(id) >= 3) with check (public.fin_org_rank(id) >= 3);
create policy fin_organizations_insert on public.fin_organizations for insert to authenticated
  with check (public.fin_is_super());

-- Restaurants
create policy fin_restaurants_select on public.fin_restaurants for select to authenticated
  using (public.fin_rank(id) >= 1);
create policy fin_restaurants_update on public.fin_restaurants for update to authenticated
  using (public.fin_rank(id) >= 3) with check (public.fin_rank(id) >= 3);
create policy fin_restaurants_insert on public.fin_restaurants for insert to authenticated
  with check (public.fin_org_rank(organization_id) >= 3);

-- App users: everyone sees their own row; org admins manage their org.
-- Only a super admin can create or edit a super admin.
create policy fin_app_users_select on public.fin_app_users for select to authenticated
  using (user_id = auth.uid() or public.fin_org_rank(organization_id) >= 3);
create policy fin_app_users_insert on public.fin_app_users for insert to authenticated
  with check (public.fin_org_rank(organization_id) >= 3 and (role <> 'super_admin' or public.fin_is_super()));
create policy fin_app_users_update on public.fin_app_users for update to authenticated
  using (public.fin_org_rank(organization_id) >= 3 and (role <> 'super_admin' or public.fin_is_super()))
  with check (public.fin_org_rank(organization_id) >= 3 and (role <> 'super_admin' or public.fin_is_super()));
create policy fin_app_users_delete on public.fin_app_users for delete to authenticated
  using (public.fin_org_rank(organization_id) >= 3 and (role <> 'super_admin' or public.fin_is_super()));

-- Days: staff today and yesterday, managers everything
create policy fin_days_select on public.fin_days for select to authenticated
  using (public.fin_can_edit_date(restaurant_id, day));
create policy fin_days_insert on public.fin_days for insert to authenticated
  with check (public.fin_can_edit_date(restaurant_id, day));
create policy fin_days_update on public.fin_days for update to authenticated
  using (public.fin_can_edit_date(restaurant_id, day)) with check (public.fin_can_edit_date(restaurant_id, day));
create policy fin_days_delete on public.fin_days for delete to authenticated
  using (public.fin_rank(restaurant_id) >= 2);

-- Day children follow the day
create or replace function public.fin_can_edit_day(p_day_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select fin_can_edit_date(d.restaurant_id, d.day) from fin_days d where d.id = p_day_id), false)
$$;

do $$
declare t text;
begin
  foreach t in array array['fin_day_revenue','fin_purchases','fin_hours']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.fin_can_edit_day(day_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.fin_can_edit_day(day_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.fin_can_edit_day(day_id)) with check (public.fin_can_edit_day(day_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.fin_can_edit_day(day_id))', t || '_delete', t);
  end loop;
end $$;

-- Audit log: org admins read, nobody writes directly
create policy fin_audit_log_select on public.fin_audit_log for select to authenticated
  using (public.fin_org_rank(organization_id) >= 3);

-- ---------------------------------------------------------------
-- RPC functions
-- ---------------------------------------------------------------

-- Change own language
create or replace function public.fin_set_language(p_lang text)
returns void language sql security definer set search_path = public as $$
  update fin_app_users set language = p_lang where user_id = auth.uid() and p_lang in ('en','nl');
$$;

-- Per day aggregates for reports. Managers and up only. Labor cost uses the
-- hourly rate valid on that date; staff never see rates or labor cost.
create or replace function public.fin_report_days(p_rest uuid, p_from date, p_to date)
returns table (
  day date, status text, covers int, expected_covers int,
  rev_food numeric, rev_beverage numeric, rev_other numeric, rev_vat numeric, revenue_by_stream jsonb,
  pur_food numeric, pur_beverage numeric, pur_non_food numeric, pur_cleaning numeric, pur_small_inventory numeric,
  pur_vat numeric, purchases_by_supplier jsonb,
  hours_staff numeric, hours_partner numeric, labor_staff numeric, labor_partner numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if fin_rank(p_rest) < 2 then raise exception 'Not allowed'; end if;
  return query
  with d as (
    select * from fin_days where restaurant_id = p_rest and fin_days.day between p_from and p_to
  ),
  rv as (
    select r.day_id,
      sum(case when s.kpi_group = 'food' then r.amount_ex else 0 end) food,
      sum(case when s.kpi_group = 'beverage' then r.amount_ex else 0 end) bev,
      sum(case when s.kpi_group = 'other' then r.amount_ex else 0 end) oth,
      sum(r.vat_amount) vat,
      jsonb_object_agg(r.stream_id::text, r.amount_ex) by_stream
    from fin_day_revenue r join fin_revenue_streams s on s.id = r.stream_id
    where r.day_id in (select id from d)
    group by r.day_id
  ),
  pu as (
    select p.day_id,
      sum(case when c.kind = 'food' then p.amount_ex else 0 end) food,
      sum(case when c.kind = 'beverage' then p.amount_ex else 0 end) bev,
      sum(case when c.kind = 'non_food' then p.amount_ex else 0 end) nonfood,
      sum(case when c.kind = 'cleaning' then p.amount_ex else 0 end) cleaning,
      sum(case when c.kind = 'small_inventory' then p.amount_ex else 0 end) smallinv,
      sum(p.vat_amount) vat
    from fin_purchases p join fin_purchase_categories c on c.id = p.category_id
    where p.day_id in (select id from d)
    group by p.day_id
  ),
  ps as (
    select x.day_id, jsonb_object_agg(x.k, x.amt) by_supplier from (
      select p.day_id, coalesce(p.supplier_id::text, 'none') k, sum(p.amount_ex) amt
      from fin_purchases p where p.day_id in (select id from d)
      group by p.day_id, coalesce(p.supplier_id::text, 'none')
    ) x group by x.day_id
  ),
  hr as (
    select h.day_id,
      sum(case when not st.is_partner then h.hours else 0 end) h_staff,
      sum(case when st.is_partner then h.hours else 0 end) h_partner,
      sum(case when not st.is_partner then h.hours * coalesce(rt.hourly_rate, 0) else 0 end) c_staff,
      sum(case when st.is_partner then h.hours * coalesce(rt.hourly_rate, 0) else 0 end) c_partner
    from fin_hours h
    join fin_staff st on st.id = h.staff_id
    join d on d.id = h.day_id
    left join lateral (
      select sr.hourly_rate from fin_staff_rates sr
      where sr.staff_id = h.staff_id and sr.valid_from <= d.day
      order by sr.valid_from desc limit 1
    ) rt on true
    group by h.day_id
  )
  select d.day, d.status, d.covers, d.expected_covers,
    coalesce(rv.food,0), coalesce(rv.bev,0), coalesce(rv.oth,0), coalesce(rv.vat,0), coalesce(rv.by_stream,'{}'::jsonb),
    coalesce(pu.food,0), coalesce(pu.bev,0), coalesce(pu.nonfood,0), coalesce(pu.cleaning,0), coalesce(pu.smallinv,0),
    coalesce(pu.vat,0), coalesce(ps.by_supplier,'{}'::jsonb),
    coalesce(hr.h_staff,0), coalesce(hr.h_partner,0), coalesce(hr.c_staff,0), coalesce(hr.c_partner,0)
  from d
  left join rv on rv.day_id = d.id
  left join pu on pu.day_id = d.id
  left join ps on ps.day_id = d.id
  left join hr on hr.day_id = d.id
  order by d.day;
end $$;

-- Lightweight ping for the keep-alive workflow (callable without login)
create or replace function public.fin_ping()
returns text language sql stable set search_path = public as $$ select 'ok'::text $$;
grant execute on function public.fin_ping() to anon;

revoke execute on function public.fin_report_days(uuid, date, date) from anon;
revoke execute on function public.fin_set_language(text) from anon;
