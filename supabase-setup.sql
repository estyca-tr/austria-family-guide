-- Run once in Supabase → SQL Editor (supabase.com, email signup — no Google Cloud)

create table if not exists trip_states (
  room_id text primary key,
  checks jsonb not null default '{}'::jsonb,
  shopping jsonb not null default '{}'::jsonb,
  custom jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0
);

alter table trip_states enable row level security;

drop policy if exists "trip_states_public" on trip_states;
create policy "trip_states_public" on trip_states
  for all using (true) with check (true);
