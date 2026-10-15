create table if not exists public.smokelog_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('cigarette', 'joint')),
  "timestamp" timestamptz not null
);

alter table public.smokelog_events
  drop constraint if exists smokelog_events_type_check;

alter table public.smokelog_events
  add constraint smokelog_events_type_check
  check (type in ('cigarette', 'joint', 'half-cigarette', 'puzzetta', 'puff'));

alter table public.smokelog_events enable row level security;

grant select, insert, update, delete on public.smokelog_events to authenticated;

drop policy if exists "Users can access only their own SmokeLog events"
  on public.smokelog_events;

create policy "Users can access only their own SmokeLog events"
  on public.smokelog_events
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.replace_smokelog_events(p_events jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.smokelog_events
  where user_id = (select auth.uid());

  insert into public.smokelog_events (id, user_id, type, "timestamp")
  select event.id, (select auth.uid()), event.type, event."timestamp"
  from jsonb_to_recordset(p_events) as event(
    id uuid,
    type text,
    "timestamp" timestamptz
  );
end;
$$;

revoke all on function public.replace_smokelog_events(jsonb) from public;
grant execute on function public.replace_smokelog_events(jsonb) to authenticated;

create table if not exists public.smokelog_purchases (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('cigarette-pack', 'weed', 'terea-pack', 'puff-cartridge')),
  amount numeric(10, 2) not null check (amount > 0),
  "timestamp" timestamptz not null
);

alter table public.smokelog_purchases
  drop constraint if exists smokelog_purchases_type_check;

alter table public.smokelog_purchases
  add constraint smokelog_purchases_type_check
  check (type in ('cigarette-pack', 'weed', 'terea-pack', 'puff-cartridge', 'tobacco-pack'));

alter table public.smokelog_purchases enable row level security;

grant select, insert, update, delete on public.smokelog_purchases to authenticated;

drop policy if exists "Users can access only their own SmokeLog purchases"
  on public.smokelog_purchases;

create policy "Users can access only their own SmokeLog purchases"
  on public.smokelog_purchases
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.replace_smokelog_data(p_events jsonb, p_purchases jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.smokelog_events
  where user_id = (select auth.uid());

  delete from public.smokelog_purchases
  where user_id = (select auth.uid());

  insert into public.smokelog_events (id, user_id, type, "timestamp")
  select event.id, (select auth.uid()), event.type, event."timestamp"
  from jsonb_to_recordset(p_events) as event(
    id uuid,
    type text,
    "timestamp" timestamptz
  );

  insert into public.smokelog_purchases (id, user_id, type, amount, "timestamp")
  select purchase.id, (select auth.uid()), purchase.type, purchase.amount, purchase."timestamp"
  from jsonb_to_recordset(p_purchases) as purchase(
    id uuid,
    type text,
    amount numeric(10, 2),
    "timestamp" timestamptz
  );
end;
$$;

revoke all on function public.replace_smokelog_data(jsonb, jsonb) from public;
grant execute on function public.replace_smokelog_data(jsonb, jsonb) to authenticated;
