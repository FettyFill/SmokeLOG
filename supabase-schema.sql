begin;

create table if not exists public.smokelog_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  "timestamp" timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.smokelog_events
  add column if not exists updated_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.smokelog_events
  drop constraint if exists smokelog_events_type_check;

update public.smokelog_events
set updated_at = "timestamp"
where updated_at is null;

alter table public.smokelog_events
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.smokelog_events enable row level security;

alter table public.smokelog_events
  drop constraint if exists smokelog_events_type_length_check;

alter table public.smokelog_events
  add constraint smokelog_events_type_length_check
  check (length(trim(type)) between 1 and 80);

create index if not exists smokelog_events_user_timestamp_idx
  on public.smokelog_events (user_id, "timestamp" desc);

create index if not exists smokelog_events_user_updated_idx
  on public.smokelog_events (user_id, updated_at desc);

grant select, insert, update, delete on public.smokelog_events to authenticated;

drop policy if exists "Users can access only their own SmokeLog events"
  on public.smokelog_events;

create policy "Users can access only their own SmokeLog events"
  on public.smokelog_events
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.smokelog_purchases (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('cigarette-pack', 'weed', 'terea-pack', 'puff-cartridge', 'tobacco-pack')),
  amount numeric(10, 2) not null check (amount > 0),
  "timestamp" timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.smokelog_purchases
  add column if not exists updated_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.smokelog_purchases
  drop constraint if exists smokelog_purchases_type_check;

alter table public.smokelog_purchases
  add constraint smokelog_purchases_type_check
  check (type in ('cigarette-pack', 'weed', 'terea-pack', 'puff-cartridge', 'tobacco-pack'));

update public.smokelog_purchases
set updated_at = "timestamp"
where updated_at is null;

alter table public.smokelog_purchases
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.smokelog_purchases enable row level security;

create index if not exists smokelog_purchases_user_timestamp_idx
  on public.smokelog_purchases (user_id, "timestamp" desc);

create index if not exists smokelog_purchases_user_updated_idx
  on public.smokelog_purchases (user_id, updated_at desc);

grant select, insert, update, delete on public.smokelog_purchases to authenticated;

drop policy if exists "Users can access only their own SmokeLog purchases"
  on public.smokelog_purchases;

create policy "Users can access only their own SmokeLog purchases"
  on public.smokelog_purchases
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.smokelog_categories (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 28),
  color text not null check (color in ('blue', 'mint', 'violet', 'amber', 'cyan', 'coral', 'pink', 'slate')),
  position integer not null check (position >= 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

alter table public.smokelog_categories enable row level security;

alter table public.smokelog_categories
  drop constraint if exists smokelog_categories_id_format_check;

alter table public.smokelog_categories
  add constraint smokelog_categories_id_format_check
  check (id ~ '^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$');

create index if not exists smokelog_categories_user_position_idx
  on public.smokelog_categories (user_id, position);

create index if not exists smokelog_categories_user_updated_idx
  on public.smokelog_categories (user_id, updated_at desc);

grant select, insert, update, delete on public.smokelog_categories to authenticated;

drop policy if exists "Users can access only their own SmokeLog categories"
  on public.smokelog_categories;

create policy "Users can access only their own SmokeLog categories"
  on public.smokelog_categories
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('smokelog-avatars', 'smokelog-avatars', false, 307200, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can view their own SmokeLOG avatar objects" on storage.objects;
create policy "Users can view their own SmokeLOG avatar objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'smokelog-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can upload their own SmokeLOG avatar objects" on storage.objects;
create policy "Users can upload their own SmokeLOG avatar objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'smokelog-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can update their own SmokeLOG avatar objects" on storage.objects;
create policy "Users can update their own SmokeLOG avatar objects"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'smokelog-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'smokelog-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own SmokeLOG avatar objects" on storage.objects;
create policy "Users can delete their own SmokeLOG avatar objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'smokelog-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop function if exists public.replace_smokelog_events(jsonb);
drop function if exists public.replace_smokelog_data(jsonb, jsonb);

create or replace function public.merge_smokelog_data(
  p_events jsonb,
  p_purchases jsonb,
  p_categories jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text, 0));

  insert into public.smokelog_events (id, user_id, type, "timestamp", updated_at, deleted_at)
  select event.id, (select auth.uid()), event.type, event."timestamp",
    coalesce(event.updated_at, event."timestamp"), event.deleted_at
  from jsonb_to_recordset(coalesce(p_events, '[]'::jsonb)) as event(
    id uuid,
    type text,
    "timestamp" timestamptz,
    updated_at timestamptz,
    deleted_at timestamptz
  )
  on conflict (id) do update
  set type = excluded.type,
      "timestamp" = excluded."timestamp",
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  where public.smokelog_events.user_id = (select auth.uid())
    and excluded.updated_at >= public.smokelog_events.updated_at;

  insert into public.smokelog_purchases (id, user_id, type, amount, "timestamp", updated_at, deleted_at)
  select purchase.id, (select auth.uid()), purchase.type, purchase.amount, purchase."timestamp",
    coalesce(purchase.updated_at, purchase."timestamp"), purchase.deleted_at
  from jsonb_to_recordset(coalesce(p_purchases, '[]'::jsonb)) as purchase(
    id uuid,
    type text,
    amount numeric(10, 2),
    "timestamp" timestamptz,
    updated_at timestamptz,
    deleted_at timestamptz
  )
  on conflict (id) do update
  set type = excluded.type,
      amount = excluded.amount,
      "timestamp" = excluded."timestamp",
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  where public.smokelog_purchases.user_id = (select auth.uid())
    and excluded.updated_at >= public.smokelog_purchases.updated_at;

  insert into public.smokelog_categories (id, user_id, name, color, position, is_active, updated_at, deleted_at)
  select category.id, (select auth.uid()), category.name, category.color, category.position,
    category.is_active, coalesce(category.updated_at, now()), category.deleted_at
  from jsonb_to_recordset(coalesce(p_categories, '[]'::jsonb)) as category(
    id text,
    name text,
    color text,
    position integer,
    is_active boolean,
    updated_at timestamptz,
    deleted_at timestamptz
  )
  on conflict (user_id, id) do update
  set name = excluded.name,
      color = excluded.color,
      position = excluded.position,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  where excluded.updated_at >= public.smokelog_categories.updated_at;
end;
$$;

revoke all on function public.merge_smokelog_data(jsonb, jsonb, jsonb) from public;
grant execute on function public.merge_smokelog_data(jsonb, jsonb, jsonb) to authenticated;

commit;

-- Incremental download: server-assigned revisions, independent of device clocks.
begin;
create sequence if not exists public.smokelog_sync_revision_seq;
alter table public.smokelog_events add column if not exists sync_revision bigint not null default 0;
alter table public.smokelog_purchases add column if not exists sync_revision bigint not null default 0;
alter table public.smokelog_categories add column if not exists sync_revision bigint not null default 0;

create or replace function public.stamp_smokelog_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize revisions per user through commit, so a cursor cannot skip a
  -- lower revision belonging to a transaction that has not committed yet.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  new.sync_revision := nextval('public.smokelog_sync_revision_seq'::regclass);
  return new;
end;
$$;
revoke all on function public.stamp_smokelog_revision() from public;

drop trigger if exists smokelog_revision on public.smokelog_events;
create trigger smokelog_revision before insert or update on public.smokelog_events
  for each row execute function public.stamp_smokelog_revision();
drop trigger if exists smokelog_revision on public.smokelog_purchases;
create trigger smokelog_revision before insert or update on public.smokelog_purchases
  for each row execute function public.stamp_smokelog_revision();
drop trigger if exists smokelog_revision on public.smokelog_categories;
create trigger smokelog_revision before insert or update on public.smokelog_categories
  for each row execute function public.stamp_smokelog_revision();

update public.smokelog_events set sync_revision = 0 where sync_revision = 0;
update public.smokelog_purchases set sync_revision = 0 where sync_revision = 0;
update public.smokelog_categories set sync_revision = 0 where sync_revision = 0;
create index if not exists smokelog_events_sync_idx on public.smokelog_events(user_id, sync_revision);
create index if not exists smokelog_purchases_sync_idx on public.smokelog_purchases(user_id, sync_revision);
create index if not exists smokelog_categories_sync_idx on public.smokelog_categories(user_id, sync_revision);

create or replace function public.smokelog_changes(p_after bigint default 0, p_limit integer default 500)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  if p_after is null or p_limit is null or p_after < 0 or p_limit < 1 or p_limit > 500 then raise exception 'Invalid cursor or page size'; end if;
  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text, 0));
  with changes as (
    select 'events' as kind, e.sync_revision as revision, to_jsonb(e) - 'user_id' as record
      from public.smokelog_events e where e.user_id = (select auth.uid()) and e.sync_revision > p_after
    union all
    select 'purchases', p.sync_revision, to_jsonb(p) - 'user_id'
      from public.smokelog_purchases p where p.user_id = (select auth.uid()) and p.sync_revision > p_after
    union all
    select 'categories', c.sync_revision, to_jsonb(c) - 'user_id'
      from public.smokelog_categories c where c.user_id = (select auth.uid()) and c.sync_revision > p_after
  ), batch as (select * from changes order by revision limit p_limit + 1),
  page as (select * from batch order by revision limit p_limit)
  select jsonb_build_object(
    'changes', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'record', record) order by revision) from page), '[]'::jsonb),
    'cursor', coalesce((select max(revision) from page), p_after)::text,
    'has_more', (select count(*) > p_limit from batch)
  ) into result;
  return result;
end;
$$;
revoke all on function public.smokelog_changes(bigint, integer) from public;
grant execute on function public.smokelog_changes(bigint, integer) to authenticated;
commit;


-- Apply after base.sql. Optimistic concurrency: a stale revision cannot overwrite data.
begin;
alter table public.smokelog_events add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.smokelog_purchases add column if not exists details jsonb not null default '{}'::jsonb;
create or replace function public.merge_smokelog_data_v2(p_events jsonb, p_purchases jsonb, p_categories jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare kind text; item jsonb; existing jsonb; normalized jsonb; event_batch jsonb := '[]'; purchase_batch jsonb := '[]'; category_batch jsonb := '[]'; stamp timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  foreach kind in array array['events','purchases','categories'] loop
    for item in select value from jsonb_array_elements(case kind when 'events' then p_events when 'purchases' then p_purchases else p_categories end) loop
      item := item || jsonb_build_object('deleted_at', (item->>'deleted_at')::timestamptz);
      if kind <> 'categories' then item := item || jsonb_build_object('timestamp', (item->>'timestamp')::timestamptz); end if;
      execute format('select to_jsonb(t) from public.%I t where user_id = $1 and id::text = $2', 'smokelog_' || kind)
        into existing using auth.uid(), item->>'id';
      -- An acknowledged request can be retried safely after losing its response.
      if existing is not null and (existing - 'user_id' - 'sync_revision' - 'updated_at' - 'details') @> (item - 'base_revision' - 'updated_at' - 'details')
        and (kind = 'categories' or coalesce(existing->'details','{}') = coalesce(item->'details','{}')) then continue; end if;
      if coalesce((existing->>'sync_revision')::bigint, 0) <> coalesce((item->>'base_revision')::bigint, 0) then
        raise exception using errcode = '40001', message = 'Conflitto: una voce è cambiata su un altro dispositivo. Esporta un backup e risolvi il conflitto prima di sincronizzare.';
      end if;
      stamp := greatest(clock_timestamp(), coalesce((existing->>'updated_at')::timestamptz + interval '1 millisecond', '-infinity'));
      normalized := (item - 'base_revision') || jsonb_build_object('updated_at', stamp);
      if kind = 'events' then event_batch := event_batch || jsonb_build_array(normalized);
      elsif kind = 'purchases' then purchase_batch := purchase_batch || jsonb_build_array(normalized);
      else category_batch := category_batch || jsonb_build_array(normalized); end if;
    end loop;
  end loop;
  perform public.merge_smokelog_data(event_batch, purchase_batch, category_batch);
  for item in select value from jsonb_array_elements(event_batch) loop
    update public.smokelog_events set details = coalesce(item->'details','{}') where user_id = auth.uid() and id = (item->>'id')::uuid;
  end loop;
  for item in select value from jsonb_array_elements(purchase_batch) loop
    update public.smokelog_purchases set details = coalesce(item->'details','{}') where user_id = auth.uid() and id = (item->>'id')::uuid;
  end loop;
end;
$$;
revoke all on function public.merge_smokelog_data_v2(jsonb,jsonb,jsonb) from public;
grant execute on function public.merge_smokelog_data_v2(jsonb,jsonb,jsonb) to authenticated;

create table if not exists public.smokelog_wellness (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000000),
  revision bigint not null default 1
);
alter table public.smokelog_wellness enable row level security;
drop policy if exists own_wellness on public.smokelog_wellness;
create policy own_wellness on public.smokelog_wellness for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.smokelog_wellness to authenticated;
create or replace function public.save_smokelog_wellness(p_revision bigint, p_payload jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare current_revision bigint; current_payload jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select revision, payload into current_revision, current_payload from public.smokelog_wellness where user_id = auth.uid();
  if current_payload = p_payload then return current_revision::text; end if;
  if coalesce(current_revision,0) <> p_revision then raise exception using errcode = '40001', message = 'Diario modificato su un altro dispositivo.'; end if;
  insert into public.smokelog_wellness(user_id,payload,revision) values(auth.uid(),p_payload,1)
    on conflict(user_id) do update set payload = excluded.payload, revision = public.smokelog_wellness.revision + 1 returning revision into current_revision;
  return current_revision::text;
end;
$$;
revoke all on function public.save_smokelog_wellness(bigint,jsonb) from public;
grant execute on function public.save_smokelog_wellness(bigint,jsonb) to authenticated;
commit;
