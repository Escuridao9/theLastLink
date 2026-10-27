begin;
set local plpgsql.check_asserts = on;

insert into auth.users (id, aud, role, is_anonymous)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', true
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', true
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'authenticated', 'authenticated', true
  );

do $$
begin
  assert not has_function_privilege(
    'authenticated',
    'public.join_room(uuid,text,text,text)',
    'EXECUTE'
  ), 'Browser users must not call the privileged join operation.';

  assert not has_function_privilege(
    'anon',
    'public.join_room(uuid,text,text,text)',
    'EXECUTE'
  ), 'Signed-out visitors must not call the join operation.';

  assert has_function_privilege(
    'service_role',
    'public.join_room(uuid,text,text,text)',
    'EXECUTE'
  ), 'The backend must be allowed to join rooms.';
end;
$$;

set local role service_role;

do $$
declare
  host_id constant uuid := '11111111-1111-4111-8111-111111111111';
  guest_id constant uuid := '22222222-2222-4222-8222-222222222222';
  outsider_id constant uuid := '33333333-3333-4333-8333-333333333333';
  games_room_id uuid := gen_random_uuid();
  movies_room_id uuid := gen_random_uuid();
  games_code text;
  movies_code text;
  room_state text;
  result jsonb;
  retried_result jsonb;
begin
  loop
    games_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.rooms where code = games_code);
  end loop;

  loop
    movies_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when movies_code <> games_code
      and not exists (select 1 from public.rooms where code = movies_code);
  end loop;

  perform public.create_room(
    games_room_id, host_id, 'games', 'Diogo', games_code
  );

  begin
    perform public.join_room(guest_id, movies_code, 'movies', 'Marta');
    raise exception 'A missing room was accepted.';
  exception when sqlstate 'LL001' then null;
  end;

  begin
    perform public.join_room(guest_id, games_code, 'movies', 'Marta');
    raise exception 'A room from another category was accepted.';
  exception when sqlstate 'LL001' then null;
  end;

  begin
    perform public.join_room(guest_id, 'bad!', 'games', 'Marta');
    raise exception 'An invalid code was accepted.';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.join_room(guest_id, games_code, 'games', 'A');
    raise exception 'An invalid player name was accepted.';
  exception when invalid_parameter_value then null;
  end;

  foreach room_state in array array['playing', 'finished', 'closed']
  loop
    update public.rooms set status = room_state where id = games_room_id;

    begin
      perform public.join_room(guest_id, games_code, 'games', 'Marta');
      raise exception 'A non-lobby room was accepted: %', room_state;
    exception when sqlstate 'LL002' then null;
    end;
  end loop;

  assert (
    select count(*) from public.room_players where room_id = games_room_id
  ) = 1, 'A rejected request added a player.';

  update public.rooms set status = 'lobby' where id = games_room_id;

  result := public.join_room(
    guest_id, '  ' || lower(games_code) || '  ', 'games', '  Marta  '
  );

  assert result->>'id' = games_room_id::text,
    'The response identifies the wrong room.';
  assert result->>'code' = games_code,
    'The room code was not normalized.';
  assert result->>'categoryId' = 'games',
    'The response identifies the wrong category.';
  assert result->>'displayName' = 'Marta',
    'The player name was not normalized.';
  assert (result->>'seat')::integer = 2,
    'The guest did not receive seat two.';

  assert exists (
    select 1 from public.room_players
    where room_id = games_room_id and user_id = guest_id
      and seat = 2 and not is_ready
  ), 'Guest membership is missing or unexpectedly ready.';

  retried_result := public.join_room(
    guest_id, games_code, 'games', 'Another name'
  );

  assert retried_result = result,
    'A retry changed the existing membership.';
  assert (
    select count(*) from public.room_players where room_id = games_room_id
  ) = 2, 'A retry changed the number of players.';

  result := public.join_room(host_id, games_code, 'games', 'Another name');

  assert (result->>'seat')::integer = 1
    and result->>'displayName' = 'Diogo',
    'The host received a second seat or a different name.';

  begin
    perform public.join_room(outsider_id, games_code, 'games', 'Alex');
    raise exception 'A third player joined a full room.';
  exception when sqlstate 'LL003' then null;
  end;

  assert not exists (
    select 1 from public.room_players
    where room_id = games_room_id and user_id = outsider_id
  ), 'The rejected third player has a membership.';

  perform public.create_room(
    movies_room_id, host_id, 'movies', 'Diogo', movies_code
  );
  result := public.join_room(guest_id, movies_code, 'movies', 'Marta');

  assert result->>'categoryId' = 'movies'
    and (result->>'seat')::integer = 2,
    'Joining a Movies room failed.';
end;
$$;

rollback;

select 'Room joining checks passed; fixtures rolled back.' as result;