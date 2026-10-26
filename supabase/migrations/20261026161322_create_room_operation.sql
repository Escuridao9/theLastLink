create function public.create_room(
  p_room_id uuid,
  p_host_user_id uuid,
  p_category_id text,
  p_display_name text,
  p_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_room public.rooms%rowtype;
  player_name text := btrim(p_display_name);
begin
  if p_room_id is null
    or p_host_user_id is null
    or p_category_id is null
    or p_category_id not in ('games', 'movies')
    or player_name is null
    or char_length(player_name) not between 2 and 24
  then
    raise exception 'Invalid room details.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_room_id::text, 0)
  );

  select * into saved_room
  from public.rooms
  where id = p_room_id;

  if found then
    if saved_room.host_user_id <> p_host_user_id
      or saved_room.category_id <> p_category_id
      or not exists (
        select 1
        from public.room_players
        where room_id = p_room_id
          and user_id = p_host_user_id
          and seat = 1
          and display_name = player_name
      )
    then
      raise exception
        'This request was already used for different room details.'
        using errcode = '22023';
    end if;
  else
    insert into public.rooms (
      id,
      code,
      category_id,
      host_user_id
    )
    values (
      p_room_id,
      p_code,
      p_category_id,
      p_host_user_id
    )
    returning * into saved_room;

    insert into public.room_players (
      room_id,
      user_id,
      seat,
      display_name
    )
    values (
      saved_room.id,
      p_host_user_id,
      1,
      player_name
    );
  end if;

  return jsonb_build_object(
    'id', saved_room.id,
    'code', saved_room.code,
    'categoryId', saved_room.category_id,
    'displayName', player_name
  );
end;
$$;

revoke all on function public.create_room(
  uuid, uuid, text, text, text
)
from public, anon, authenticated;

grant execute on function public.create_room(
  uuid, uuid, text, text, text
)
to service_role;