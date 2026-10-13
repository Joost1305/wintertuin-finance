-- Wintertuin Finance: who may call which function.
-- Trigger functions: nobody calls these directly
revoke execute on function public.fin_audit() from public, anon, authenticated;
revoke execute on function public.fin_child_defaults() from public, anon, authenticated;
revoke execute on function public.fin_days_touch() from public, anon, authenticated;
revoke execute on function public.fin_set_org() from public, anon, authenticated;
-- Helpers and RPCs: signed-in users only
revoke execute on function public.fin_is_super() from public, anon;
revoke execute on function public.fin_rank(uuid) from public, anon;
revoke execute on function public.fin_org_rank(uuid) from public, anon;
revoke execute on function public.fin_can_edit_date(uuid, date) from public, anon;
revoke execute on function public.fin_can_edit_day(uuid) from public, anon;
revoke execute on function public.fin_report_days(uuid, date, date) from public, anon;
revoke execute on function public.fin_set_language(text) from public, anon;
grant execute on function public.fin_is_super(), public.fin_rank(uuid), public.fin_org_rank(uuid),
  public.fin_can_edit_date(uuid, date), public.fin_can_edit_day(uuid),
  public.fin_report_days(uuid, date, date), public.fin_set_language(text) to authenticated;
