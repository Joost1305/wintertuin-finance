-- Order of the top menu per restaurant, set by admins in Settings (applied together with the Team app's migration 009).
alter table public.fin_restaurants add column if not exists nav_order jsonb;
