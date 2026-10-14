-- Events from the team app, seen from Finance (dashboard card and the daily closing).
-- Managers get money (expected revenue, deposits); staff only see what is on (title, time, guests).
-- The system check (supabase/functions/system-check) and its tables are in the team app repo:
-- supabase/migrations/006_system_check.sql.
create or replace function public.fin_events_overview(p_rest uuid, p_from date, p_to date)
returns table(id uuid, title text, event_date date, start_time time, status text, guests integer,
              expected_revenue numeric, prices_incl_vat boolean, deposit numeric, deposit_due date, deposit_paid boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_rank int := public.fin_rank(p_rest);
begin
  if v_rank < 1 then raise exception 'Not allowed'; end if;
  return query
  select e.id, e.title, e.event_date, e.start_time, e.status,
         coalesce(e.guests_final, e.guests_guaranteed, e.guests_expected),
         case when v_rank >= 2 then nullif(greatest(
           coalesce(e.price_per_person * coalesce(e.guests_final, e.guests_guaranteed, e.guests_expected), 0) + coalesce(e.room_hire, 0),
           coalesce(e.min_spend, 0)), 0) end,
         e.prices_incl_vat,
         case when v_rank >= 2 then e.deposit end,
         case when v_rank >= 2 then e.deposit_due end,
         case when v_rank >= 2 then e.deposit_paid end
    from events e
   where e.event_date between p_from and p_to and e.status in ('option', 'confirmed', 'done')
     and (v_rank >= 2 or e.status <> 'option')
   order by e.event_date, e.start_time nulls last;
end $$;
revoke execute on function public.fin_events_overview(uuid, date, date) from public, anon;
grant execute on function public.fin_events_overview(uuid, date, date) to authenticated;

create or replace function public.fin_open_deposits(p_rest uuid)
returns table(id uuid, title text, event_date date, deposit numeric, deposit_due date)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.fin_rank(p_rest) < 2 then raise exception 'Not allowed'; end if;
  return query
  select e.id, e.title, e.event_date, e.deposit, e.deposit_due from events e
   where e.status in ('option', 'confirmed') and coalesce(e.deposit, 0) > 0 and not e.deposit_paid
   order by coalesce(e.deposit_due, e.event_date);
end $$;
revoke execute on function public.fin_open_deposits(uuid) from public, anon;
grant execute on function public.fin_open_deposits(uuid) to authenticated;
