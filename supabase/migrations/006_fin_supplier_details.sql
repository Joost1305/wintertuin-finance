-- Supplier details: contact, online ordering, account manager, ordering and delivery days.
-- Website logins live in their own table that only managers can read, and that table is NOT audited,
-- so passwords never end up in fin_audit_log.
alter table public.fin_suppliers
  add column if not exists website text,
  add column if not exists order_url text,
  add column if not exists customer_number text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists order_days text,
  add column if not exists delivery_days text,
  add column if not exists min_order numeric(10,2),
  add column if not exists notes text;

create table if not exists public.fin_supplier_logins (
  supplier_id uuid primary key references public.fin_suppliers(id) on delete cascade,
  organization_id uuid not null references public.fin_organizations(id),
  restaurant_id uuid not null references public.fin_restaurants(id),
  username text,
  password text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.fin_supplier_logins enable row level security;
create policy fin_supplier_logins_select on public.fin_supplier_logins for select to authenticated using (public.fin_rank(restaurant_id) >= 2);
create policy fin_supplier_logins_insert on public.fin_supplier_logins for insert to authenticated with check (public.fin_rank(restaurant_id) >= 2);
create policy fin_supplier_logins_update on public.fin_supplier_logins for update to authenticated using (public.fin_rank(restaurant_id) >= 2) with check (public.fin_rank(restaurant_id) >= 2);
create policy fin_supplier_logins_delete on public.fin_supplier_logins for delete to authenticated using (public.fin_rank(restaurant_id) >= 2);
-- Restaurant and organization always follow the supplier, so a login can never be filed under another restaurant
create or replace function public.fin_supplier_login_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select restaurant_id, organization_id into new.restaurant_id, new.organization_id from fin_suppliers where id = new.supplier_id;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke execute on function public.fin_supplier_login_scope() from public, anon;
create trigger fin_supplier_logins_scope before insert or update on public.fin_supplier_logins for each row execute function public.fin_supplier_login_scope();
grant select, insert, update, delete on public.fin_supplier_logins to authenticated;
