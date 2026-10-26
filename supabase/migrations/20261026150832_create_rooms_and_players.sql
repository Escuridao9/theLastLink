create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category_id text not null,
  status text not null default 'lobby',
  host_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint rooms_code_valid
    check (code ~ '^[A-Z0-9]{6}$'),

  constraint rooms_category_valid
    check (category_id in ('games', 'movies')),

  constraint rooms_status_valid
    check (status in ('lobby', 'playing', 'finished', 'closed'))
);

create table public.room_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seat smallint not null,
  display_name text not null,
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),

  primary key (room_id, user_id),

  constraint room_players_seat_unique
    unique (room_id, seat),

  constraint room_players_seat_valid
    check (seat in (1, 2)),

  constraint room_players_name_valid check (
    char_length(display_name) between 2 and 24
    and display_name = btrim(display_name)
  )
);

create index rooms_host_user_id_idx
  on public.rooms(host_user_id);

create index room_players_user_id_idx
  on public.room_players(user_id);

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;

revoke all on table public.rooms, public.room_players
  from public, anon, authenticated;

grant select on table public.rooms, public.room_players
  to authenticated;

grant select, insert, update, delete
  on table public.rooms, public.room_players
  to service_role;

create function private.current_player_room_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.room_id
  from public.room_players as membership
  where membership.user_id = (select auth.uid());
$$;

revoke all on function private.current_player_room_ids()
  from public, anon, authenticated;

grant execute on function private.current_player_room_ids()
  to authenticated;

create policy rooms_read_members
on public.rooms
for select
to authenticated
using (id in (select private.current_player_room_ids()));

create policy room_players_read_members
on public.room_players
for select
to authenticated
using (room_id in (select private.current_player_room_ids()));

alter publication supabase_realtime
  add table public.rooms, public.room_players;