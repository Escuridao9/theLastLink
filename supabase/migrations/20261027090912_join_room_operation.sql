create function public.join_room(
  p_user_id uuid,
  p_code text,
  p_category_id text,
  p_display_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_room public.rooms%rowtype;
  saved_player public.room_players%rowtype;
  normalized_code text := upper(btrim(p_code));
  player_name text := btrim(p_display_name);
begin
  if p_user_id is null
    or normalized_code is null
    or normalized_code !~ '^[A-Z0-9]{6}$'
    or p_category_id is null
    or p_category_id not in ('games', 'movies')
    or player_name is null
    or char_length(player_name) not between 2 and 24
  then
    raise exception 'Invalid join details.'
      using errcode = '22023';
  end if;

  select * into saved_room
  from public.rooms
  where code = normalized_code
    and category_id = p_category_id
  for update;

  if not found then
    raise exception 'No room in this category matches that code.'
      using errcode = 'LL001';
  end if;

  if saved_room.status <> 'lobby' then
    raise exception 'This room is no longer accepting players.'
      using errcode = 'LL002';
  end if;

  select * into saved_player
  from public.room_players
  where room_id = saved_room.id
    and user_id = p_user_id;

  if not found then
    if exists (
      select 1
      from public.room_players
      where room_id = saved_room.id
        and seat = 2
    ) then
      raise exception 'This room is full.'
        using errcode = 'LL003';
    end if;

    insert into public.room_players (
      room_id, user_id, seat, display_name
    )
    values (
      saved_room.id, p_user_id, 2, player_name
    )
    returning * into saved_player;
  end if;

  return jsonb_build_object(
    'id', saved_room.id,
    'code', saved_room.code,
    'categoryId', saved_room.category_id,
    'displayName', saved_player.display_name,
    'seat', saved_player.seat
  );
end;
$$;

revoke all on function public.join_room(uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.join_room(uuid, text, text, text)
  to service_role;