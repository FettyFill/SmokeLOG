create table if not exists public.smokelog_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('cigarette', 'joint')),
  "timestamp" timestamptz not null
);

alter table public.smokelog_events enable row level security;

grant select, insert, update, delete on public.smokelog_events to authenticated;

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
