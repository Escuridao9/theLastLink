-- Run the complete file as postgres in the Supabase SQL Editor.
-- Fixtures and claim settings are rolled back at the end.

begin;
set local plpgsql.check_asserts = on;
set local request.jwt.claim.sub = '';

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

-- Backend writes must work.
set local role service_role;

insert into public.rooms (id, code, category_id, host_user_id)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'LLT101',
    'games',
    '11111111-1111-4111-8111-111111111111'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'LLT102',
    'movies',
    '33333333-3333-4333-8333-333333333333'
  );

insert into public.room_players
  (room_id, user_id, seat, display_name)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    1,
    'Diogo'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '22222222-2222-4222-8222-222222222222',
    2,
    'Marta'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '33333333-3333-4333-8333-333333333333',
    1,
    'Alex'
  );

-- Database constraints must reject invalid membership.
do $$
begin
  begin
    insert into public.room_players
      (room_id, user_id, seat, display_name)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333',
      3,
      'Alex'
    );

    raise exception 'A third seat was accepted.';
  exception when check_violation then null;
  end;

  begin
    insert into public.room_players
      (room_id, user_id, seat, display_name)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333',
      2,
      'Alex'
    );

    raise exception 'An occupied seat was accepted.';
  exception when unique_violation then null;
  end;

  begin
    insert into public.room_players
      (room_id, user_id, seat, display_name)
    values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '33333333-3333-4333-8333-333333333333',
      2,
      'Alex'
    );

    raise exception 'One user occupied two seats.';
  exception when unique_violation then null;
  end;
end;
$$;

-- The host sees only their room and both players.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}';

do $$
begin
  assert (select count(*) from public.rooms) = 1,
    'The host must see exactly one room.';

  assert (select code from public.rooms) = 'LLT101',
    'The host saw the wrong room.';

  assert (select count(*) from public.room_players) = 2,
    'The host must see both players.';

  begin
    update public.rooms set status = 'playing';

    raise exception 'A browser user changed room status.';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.room_players;

    raise exception 'A browser user deleted players.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- The second player sees the same room and both players.
set local request.jwt.claims =
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}';

do $$
begin
  assert (select code from public.rooms) = 'LLT101',
    'The second player cannot read their room.';

  assert (select count(*) from public.room_players) = 2,
    'The second player must see both players.';
end;
$$;

-- A different room's member cannot see the first room.
set local request.jwt.claims =
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":true}';

do $$
begin
  assert (select count(*) from public.rooms) = 1,
    'A player could read another room.';

  assert (select code from public.rooms) = 'LLT102',
    'A player saw the wrong room.';

  assert (select count(*) from public.room_players) = 1,
    'A player could read another room''s members.';
end;
$$;

-- Signed-out visitors have no room access.
set local role anon;
set local request.jwt.claims = '{}';

do $$
begin
  begin
    perform 1 from public.rooms;

    raise exception 'A signed-out visitor read rooms.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

-- Check every browser write grant, including TRUNCATE.
do $$
declare
  table_name text;
  operation text;
begin
  foreach table_name in array array['rooms', 'room_players'] loop
    foreach operation in array array[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'
    ] loop
      assert not has_table_privilege(
        'authenticated',
        'public.' || table_name,
        operation
      ), format(
        'Unexpected %s grant on %s.',
        operation,
        table_name
      );
    end loop;
  end loop;
end;
$$;

rollback;

select
  'Room schema and access checks passed; fixtures rolled back.'
  as result;