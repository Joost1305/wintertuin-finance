-- Days on which someone actually worked: a shift in the team app roster or a clock-in.
-- The finance calendar only marks a day as missing when people worked, so the restaurant was really open.
-- Opening and closing single days is done with fin_set_day_open (team app migration 004), from both calendars.
create or replace function public.fin_worked_days(p_rest uuid, p_from date, p_to date)
returns table(day date, rostered integer, clocked integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.fin_rank(p_rest) < 2 then raise exception 'Not allowed'; end if;
  return query
  with s as (select shift_date d, count(distinct staff_id)::int n from shifts where shift_date between p_from and p_to group by 1),
       c as (select (check_in_at at time zone 'Europe/Amsterdam')::date d, count(distinct staff_id)::int n from checkins
             where check_in_at >= (p_from::timestamp at time zone 'Europe/Amsterdam') and check_in_at < ((p_to + 1)::timestamp at time zone 'Europe/Amsterdam') group by 1)
  select coalesce(s.d, c.d), coalesce(s.n, 0), coalesce(c.n, 0) from s full join c on c.d = s.d order by 1;
end $$;
revoke execute on function public.fin_worked_days(uuid, date, date) from public, anon;
grant execute on function public.fin_worked_days(uuid, date, date) to authenticated;
