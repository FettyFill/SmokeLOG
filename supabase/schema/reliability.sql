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
