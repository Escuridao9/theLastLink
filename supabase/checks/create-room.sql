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
  );

do $$
begin
  assert not has_function_privilege(
    'authenticated',
    'public.create_room(uuid,uuid,text,text,text)',
    'EXECUTE'
  ), 'Browser users must not execute the privileged operation.';

  assert not has_function_privilege(
    'anon',
    'public.create_room(uuid,uuid,text,text,text)',
    'EXECUTE'
  ), 'Signed-out visitors must not execute the privileged operation.';
end;
$$;

set local role service_role;

do $$
declare
  result jsonb;
begin
  result := public.create_room(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'games',
    '  Diogo  ',
    'LLT201'
  );

  assert result->>'code' = 'LLT201',
    'The room code is incorrect.';

  assert result->>'displayName' = 'Diogo',
    'The name was not normalized.';

  assert (
    select count(*)
    from public.room_players
    where room_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = '11111111-1111-4111-8111-111111111111'
      and seat = 1
      and not is_ready
  ) = 1, 'Host membership is missing.';

  perform public.create_room(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'games',
    'Diogo',
    'LLT202'
  );

  assert (
    select count(*)
    from public.rooms
    where host_user_id = '11111111-1111-4111-8111-111111111111'
  ) = 1, 'A retry created another room.';

  begin
    perform public.create_room(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22222222-2222-4222-8222-222222222222',
      'games',
      'Diogo',
      'LLT203'
    );

    raise exception 'Another user reused the creation request.';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.create_room(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '22222222-2222-4222-8222-222222222222',
      'movies',
      'Marta',
      'LLT201'
    );

    raise exception 'A duplicate room code was accepted.';
  exception when unique_violation then null;
  end;

  assert not exists (
    select 1
    from public.rooms
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ), 'A failed creation left a room behind.';
end;
$$;

rollback;

select
  'Room creation checks passed; fixtures rolled back.'
  as result;