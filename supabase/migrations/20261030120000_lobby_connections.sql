-- Lobby-only connection leases. Active turns, results and rematches are unchanged.
begin;

alter table public.game_rooms drop constraint game_rooms_status_check;
alter table public.game_rooms add constraint game_rooms_status_check
  check (status in ('waiting','ready','playing','finished','closed'));

create table game_private.lobby_connections (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  last_seen_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '30 seconds',
  disconnected_at timestamptz,
  primary key (room_id,user_id,client_id)
);
alter table game_private.lobby_connections enable row level security;
revoke all on game_private.lobby_connections from public,anon,authenticated;
create index lobby_connections_expiry on game_private.lobby_connections(expires_at);

-- Give existing lobbies a full grace period when the migration is applied.
insert into game_private.lobby_connections(room_id,user_id,client_id)
select r.id,u.id,u.id from public.game_rooms r
cross join lateral (values (r.host_id),(r.guest_id)) u(id)
where r.status in ('waiting','ready') and u.id is not null;

create function game_private.lobby_connected(rid uuid,uid uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from game_private.lobby_connections c
    where c.room_id=rid and c.user_id=uid and c.disconnected_at is null
      and c.last_seen_at>clock_timestamp()-interval '12 seconds'
      and c.expires_at>clock_timestamp())
$$;

alter function game_private.room_snapshot(uuid) rename to room_snapshot_before_lobby;
create function game_private.room_snapshot(rid uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select game_private.room_snapshot_before_lobby(rid) || jsonb_build_object(
    'lobbyPresence',coalesce((select jsonb_object_agg(u.id::text,jsonb_build_object(
      'connected',game_private.lobby_connected(r.id,u.id),
      'expiresAt',(select max(c.expires_at) from game_private.lobby_connections c
        where c.room_id=r.id and c.user_id=u.id)))
      from (values(r.host_id),(r.guest_id)) u(id) where u.id is not null),'{}'::jsonb))
  from public.game_rooms r where r.id=rid
$$;

create function game_private.prune_lobby(rid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.game_rooms;
begin
  select * into r from public.game_rooms where id=rid for update;
  if not found or r.status not in ('waiting','ready') then return; end if;
  if not exists(select 1 from game_private.lobby_connections c
    where c.room_id=r.id and c.user_id=r.host_id and c.expires_at>clock_timestamp()) then
    update public.game_rooms set status='closed',revision=revision+1 where id=r.id;
    delete from game_private.lobby_connections where room_id=r.id;
  elsif r.guest_id is not null and not exists(select 1 from game_private.lobby_connections c
    where c.room_id=r.id and c.user_id=r.guest_id and c.expires_at>clock_timestamp()) then
    delete from game_private.lobby_connections where room_id=r.id and user_id=r.guest_id;
    update public.game_rooms set guest_id=null,status='waiting',revision=revision+1 where id=r.id;
  end if;
  delete from game_private.lobby_connections where room_id=rid and expires_at<=clock_timestamp();
end $$;

create function game_private.expire_waiting_lobbies() returns void
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
  for rid in select r.id from public.game_rooms r where r.status in ('waiting','ready')
    and (not exists(select 1 from game_private.lobby_connections c where c.room_id=r.id
        and c.user_id=r.host_id and c.expires_at>clock_timestamp())
      or (r.guest_id is not null and not exists(select 1 from game_private.lobby_connections c
        where c.room_id=r.id and c.user_id=r.guest_id and c.expires_at>clock_timestamp())))
    order by r.created_at limit 100 for update of r skip locked
  loop perform game_private.prune_lobby(rid); end loop;
end $$;

alter function public.game_command(text,jsonb,uuid) set schema game_private;
alter function game_private.game_command(text,jsonb,uuid) rename to game_command_before_lobby;
revoke all on function game_private.game_command_before_lobby(text,jsonb,uuid) from public,anon,authenticated;

create function public.game_command(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid; cid uuid; r public.game_rooms; response jsonb;
  receipt game_private.command_receipts; fp text;
begin
  perform pg_advisory_xact_lock_shared(214126234,29);
  perform game_private.touch_account(uid);
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>4096 then raise exception 'invalid_request'; end if;
  if p_action not in ('create','join','room','room_status','start','leave','lobby_disconnect') then
    return game_private.game_command_before_lobby(p_action,p_payload,p_request_id);
  end if;
  -- Old clients use their own identity as a temporary connection key until refreshed.
  cid:=coalesce((p_payload->>'clientId')::uuid,uid);
  if p_action='leave' then
    perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
    fp:=md5(p_action||p_payload::text);
    select * into receipt from game_private.command_receipts where player_id=uid and request_id=p_request_id;
    if found then
      if receipt.fingerprint<>fp then raise exception 'request_id_reused'; end if;
      return receipt.response||jsonb_build_object('duplicate',true,'serverTime',clock_timestamp());
    end if;
  end if;
  if p_action='join' then
    select * into r from public.game_rooms where code=upper(regexp_replace(coalesce(p_payload->>'code',''),'[^a-zA-Z0-9]','','g')) for update;
  elsif p_action<>'create' then
    select * into r from public.game_rooms where id=(p_payload->>'roomId')::uuid for update;
    if not found or (uid<>r.host_id and uid is distinct from r.guest_id) then
      raise exception 'room_not_found' using errcode='42501'; end if;
  end if;
  if r.id is not null then
    rid:=r.id;
    perform game_private.prune_lobby(rid);
    select * into r from public.game_rooms where id=rid;
    if r.status='closed' then
      return jsonb_build_object('ok',false,'reason','room_closed','duplicate',false,'serverTime',clock_timestamp());
    end if;
    if p_action<>'join' and uid<>r.host_id and uid is distinct from r.guest_id then
      return jsonb_build_object('ok',false,'reason','lobby_seat_expired','duplicate',false,'serverTime',clock_timestamp());
    end if;
    if p_action in ('leave','lobby_disconnect') then
      if r.status not in ('waiting','ready') then
        return jsonb_build_object('ok',false,'reason','room_started','duplicate',false,
          'match',game_private.match_snapshot(r.match_id),'serverTime',clock_timestamp());
      end if;
      if p_action='lobby_disconnect' then
        update game_private.lobby_connections set disconnected_at=clock_timestamp(),
          expires_at=clock_timestamp()+interval '30 seconds'
          where room_id=rid and user_id=uid and client_id=cid;
        return jsonb_build_object('ok',true,'duplicate',false,'serverTime',clock_timestamp());
      end if;
      delete from game_private.lobby_connections where room_id=rid and (uid=r.host_id or user_id=uid);
      if uid=r.host_id then
        update public.game_rooms set status='closed',revision=revision+1 where id=rid;
      else
        update public.game_rooms set guest_id=null,status='waiting',revision=revision+1 where id=rid;
      end if;
      response:=jsonb_build_object('ok',true,'duplicate',false,'serverTime',clock_timestamp());
      insert into game_private.command_receipts values(uid,p_request_id,fp,response,clock_timestamp());
      return response;
    end if;
  end if;
  if p_action in ('create','join') then
    response:=game_private.game_command_before_lobby(p_action,p_payload,p_request_id);
    rid:=(response->'room'->>'id')::uuid;
    select * into r from public.game_rooms where id=rid for update;
    if r.status='closed' or (r.id is not null and uid<>r.host_id and uid is distinct from r.guest_id) then
      return jsonb_build_object('ok',false,'reason',case when r.status='closed' then 'room_closed' else 'lobby_seat_expired' end,
        'duplicate',coalesce((response->>'duplicate')::boolean,false),'serverTime',clock_timestamp());
    end if;
  end if;
  if p_action in ('create','join','room','start') and r.id is not null and r.status in ('waiting','ready') and uid in (r.host_id,r.guest_id) then
    delete from game_private.lobby_connections where room_id=r.id and user_id=uid and expires_at<=clock_timestamp();
    if not exists(select 1 from game_private.lobby_connections where room_id=r.id and user_id=uid and client_id=cid)
      and (select count(*) from game_private.lobby_connections where room_id=r.id and user_id=uid)>=16 then
      raise exception 'too_many_lobby_tabs'; end if;
    insert into game_private.lobby_connections(room_id,user_id,client_id) values(r.id,uid,cid)
    on conflict(room_id,user_id,client_id) do update set last_seen_at=clock_timestamp(),
      expires_at=clock_timestamp()+interval '30 seconds',disconnected_at=null;
  end if;
  if p_action='start' and r.match_id is null and
    (not game_private.lobby_connected(r.id,r.host_id) or not game_private.lobby_connected(r.id,r.guest_id)) then
    return jsonb_build_object('ok',false,'reason','players_reconnecting','room',game_private.room_snapshot(r.id),
      'duplicate',false,'serverTime',clock_timestamp());
  end if;
  if response is null then response:=game_private.game_command_before_lobby(
    case when p_action='room_status' then 'room' else p_action end,p_payload,p_request_id); end if;
  if response ? 'room' then response:=jsonb_set(response,'{room}',game_private.room_snapshot(r.id)); end if;
  if p_action='start' and response ? 'match' then
    delete from game_private.lobby_connections where room_id=r.id;
  end if;
  return response;
end $$;
revoke all on function public.game_command(text,jsonb,uuid) from public,anon;
grant execute on function public.game_command(text,jsonb,uuid) to authenticated;

-- Reuse the existing once-per-second server job; no browser is needed for expiry.
create or replace function public.expire_due_matches() returns integer
language plpgsql security definer set search_path='' as $$
declare finished integer;
begin
  if not pg_try_advisory_xact_lock_shared(214126234,29) then return 0; end if;
  finished:=game_private.expire_due_matches_before_retention();
  perform game_private.expire_waiting_lobbies();
  return finished;
end $$;
revoke all on function public.expire_due_matches() from public,anon,authenticated;
revoke all on function game_private.lobby_connected(uuid,uuid),game_private.prune_lobby(uuid),
  game_private.expire_waiting_lobbies(),game_private.room_snapshot_before_lobby(uuid),
  game_private.room_snapshot(uuid) from public,anon,authenticated;
select pg_notify('pgrst','reload schema');
commit;
