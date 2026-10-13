-- Wintertuin Finance: starting data for Wintertuin (Cantonspark, Baarn)
do $$
declare
  v_org uuid;
  v_rest uuid;
  v_joost uuid;
  s text;
  wd int;
begin
  insert into fin_organizations (name) values ('Wintertuin') returning id into v_org;
  insert into fin_restaurants (organization_id, name, city, latitude, longitude, investment_amount)
  values (v_org, 'Wintertuin', 'Baarn', 52.2128, 5.2911, 105000) returning id into v_rest;

  -- Joost = super admin
  select id into v_joost from auth.users where email = 'mail@joostdevos.nl';
  if v_joost is not null then
    insert into fin_app_users (user_id, organization_id, role, full_name, language)
    values (v_joost, v_org, 'super_admin', 'Joost', 'en');
  end if;

  insert into fin_vat_rates (organization_id, restaurant_id, label, rate, sort_order) values
    (v_org, v_rest, '0%', 0, 1), (v_org, v_rest, '9%', 0.09, 2), (v_org, v_rest, '21%', 0.21, 3);

  insert into fin_revenue_streams (organization_id, restaurant_id, code, name_en, name_nl, vat_rate, kpi_group, sort_order) values
    (v_org, v_rest, 'bakery_takeaway',  'Bakery takeaway',          'Bakkerij afhaal',        0.09, 'food',     10),
    (v_org, v_rest, 'bakery_wholesale', 'Bakery wholesale',         'Bakkerij groothandel',   0.09, 'food',     20),
    (v_org, v_rest, 'lunch',            'Lunch',                    'Lunch',                  0.09, 'food',     30),
    (v_org, v_rest, 'early_dinner',     'Early dinner',             'Vroeg diner',            0.09, 'food',     40),
    (v_org, v_rest, 'dinner_events',    'Dinner / events',          'Diner / events',         0.09, 'food',     50),
    (v_org, v_rest, 'bev_nonalc',       'Drinks, non-alcoholic',    'Dranken, alcoholvrij',   0.09, 'beverage', 60),
    (v_org, v_rest, 'bev_alc',          'Drinks, alcoholic',        'Dranken, alcoholisch',   0.21, 'beverage', 70),
    (v_org, v_rest, 'shop_food',        'Shop, food',               'Winkel, food',           0.09, 'food',     80),
    (v_org, v_rest, 'shop_nonfood',     'Shop, non-food',           'Winkel, non-food',       0.21, 'other',    90),
    (v_org, v_rest, 'other',            'Other',                    'Overig',                 0.21, 'other',   100);

  insert into fin_purchase_categories (organization_id, restaurant_id, code, name_en, name_nl, kind, vat_rate, sort_order) values
    (v_org, v_rest, 'food',            'Food',                  'Food',                  'food',            0.09, 10),
    (v_org, v_rest, 'misc',            'Miscellaneous',         'Diversen',              'food',            0.09, 20),
    (v_org, v_rest, 'bev_nonalc',      'Drinks, non-alcoholic', 'Dranken, alcoholvrij',  'beverage',        0.09, 30),
    (v_org, v_rest, 'bev_alc',         'Drinks, alcoholic',     'Dranken, alcoholisch',  'beverage',        0.21, 40),
    (v_org, v_rest, 'non_food',        'Non-food',              'Non-food',              'non_food',        0.21, 50),
    (v_org, v_rest, 'cleaning',        'Cleaning',              'Schoonmaak',            'cleaning',        0.21, 60),
    (v_org, v_rest, 'small_inventory', 'Small inventory',       'Klein inventaris',      'small_inventory', 0.21, 70);

  -- Partners log hours at a notional rate (set the rate in Settings)
  insert into fin_staff (organization_id, restaurant_id, name, is_partner, sort_order) values
    (v_org, v_rest, 'Joost', true, 1), (v_org, v_rest, 'Jane', true, 2),
    (v_org, v_rest, 'Carel', true, 3), (v_org, v_rest, 'Kees', true, 4);
  update fin_staff set user_id = v_joost where restaurant_id = v_rest and name = 'Joost';

  -- Opening hours: Friday to Sunday open in both seasons, Monday to Thursday by appointment (closed by default)
  foreach s in array array['summer','winter'] loop
    for wd in 1..7 loop
      insert into fin_opening_hours (organization_id, restaurant_id, season, weekday, is_open, open_time, close_time)
      values (v_org, v_rest, s, wd, wd >= 5,
              case when wd >= 5 then time '08:00' end,
              case when wd >= 5 then time '22:00' end);
    end loop;
  end loop;

  insert into fin_targets (organization_id, restaurant_id, metric, season, value) values
    (v_org, v_rest, 'food_cost', 'all', 0.30),
    (v_org, v_rest, 'beverage_cost', 'all', 0.22),
    (v_org, v_rest, 'labor', 'all', 0.30),
    (v_org, v_rest, 'prime_cost', 'all', 0.60),
    (v_org, v_rest, 'nonfood_budget', 'all', 1500);

  insert into fin_fixed_costs (organization_id, restaurant_id, name, amount_month, sort_order) values
    (v_org, v_rest, 'Rent', 1666.67, 1),
    (v_org, v_rest, 'Energy', 0, 2),
    (v_org, v_rest, 'Insurance', 0, 3);
end $$;
