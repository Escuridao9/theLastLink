-- Mutual rematches reuse a room while preserving every completed round.
begin;

create table game_private.rematches (
  match_id uuid primary key references public.matches(id),
  host_ready_at timestamptz,
  guest_ready_at timestamptz,
  next_match_id uuid unique references public.matches(id),
  check (next_match_id is null or next_match_id <> match_id)
);
alter table game_private.rematches enable row level security;
revoke all on table game_private.rematches from public, anon, authenticated;

create function game_private.rematch_snapshot(mid uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  with moment as materialized (select clock_timestamp() as at)
  select jsonb_build_object(
    'available', m.status = 'finished' and r.status = 'finished'
      and r.match_id = m.id and r.guest_id is not null and rem.next_match_id is null,
    'requestedBy', coalesce(consent.people, '[]'::jsonb),
    'expiresAt', coalesce(consent.expiries, '{}'::jsonb),
    'nextMatchId', rem.next_match_id,
    'nextStatus', following.status
  )
  from public.matches m
  join public.game_rooms r on r.id = m.room_id
  left join game_private.rematches rem on rem.match_id = m.id
  left join public.matches following on following.id = rem.next_match_id
  left join lateral (
    select jsonb_agg(v.player_id order by v.player_id) as people,
      jsonb_object_agg(v.player_id, v.ready_at + interval '2 minutes') as expiries
    from (values (r.host_id, rem.host_ready_at), (r.guest_id, rem.guest_ready_at))
      as v(player_id, ready_at)
    where v.player_id is not null
      and v.ready_at > (select at from moment) - interval '2 minutes'
  ) consent on true
  where m.id = mid
$$;

create or replace function game_private.match_snapshot(mid uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object('id',m.id,'roomId',m.room_id,'catalogueId',m.catalogue_id,
    'category',m.category_id,'status',m.status,'activePlayer',m.active_player,'deadline',m.deadline,
    'state',m.state,'revision',m.revision,'winnerId',m.winner_id,'endReason',m.end_reason,
    'endedAt',m.ended_at,'room',game_private.room_snapshot(m.room_id),
    'rematch',game_private.rematch_snapshot(m.id),
    'turns',coalesce((select jsonb_agg(jsonb_build_object('index',t.move_index,
      'playerId',t.player_id,'entryId',t.entry_id,'connectors',t.connectors,'acceptedAt',t.accepted_at)
      order by t.move_index) from public.turn_history t where t.match_id=m.id),'[]'::jsonb))
  from public.matches m where m.id=mid
$$;

-- Move the existing implementation unchanged behind the same public RPC.
-- All existing command validation, locking, receipts and gameplay rules are retained.
alter function public.game_command(text,jsonb,uuid) set schema game_private;
alter function game_private.game_command(text,jsonb,uuid) rename to core_game_command;
revoke all on function game_private.core_game_command(text,jsonb,uuid)
  from public, anon, authenticated;

create function game_private.rematch_command(p_action text, p_payload jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  r public.game_rooms;
  rem game_private.rematches;
  receipt game_private.command_receipts;
  fingerprint text;
  result jsonb;
  response jsonb;
  moment timestamptz;
  seed_id text;
  first_player uuid;
  next_state jsonb;
  next_match public.matches;
begin
  if uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>4096 then raise exception 'invalid_request'; end if;
  if p_action not in ('rematch','cancel_rematch') then raise exception 'unknown_action'; end if;

  -- Use the same receipt namespace and advisory lock as all existing commands.
  perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
  fingerprint := md5(p_action||p_payload::text);
  select * into receipt from game_private.command_receipts
    where player_id=uid and request_id=p_request_id;
  if found then
    if receipt.fingerprint<>fingerprint then raise exception 'request_id_reused'; end if;
    return receipt.response||jsonb_build_object('duplicate',true,'serverTime',clock_timestamp());
  end if;

  -- Lock the source match first, as the gameplay command does when finishing a round.
  select * into m from public.matches where id=(p_payload->>'matchId')::uuid for update;
  if not found or not game_private.is_member(m.id,uid) then
    raise exception 'match_not_found' using errcode='42501';
  end if;
  if m.status<>'finished' then raise exception 'match_not_finished'; end if;
  select * into r from public.game_rooms where id=m.room_id for update;
  select * into rem from game_private.rematches where match_id=m.id;

  if rem.next_match_id is not null then
    -- Old links/retries cannot create a second successor or interrupt the current round.
    result := jsonb_build_object('ok',p_action='rematch','match',game_private.match_snapshot(m.id));
    if p_action='cancel_rematch' then result := result||jsonb_build_object('reason','rematch_started'); end if;
  else
    if r.match_id is distinct from m.id or r.status<>'finished' or r.guest_id is null
      or uid not in (r.host_id,r.guest_id)
      or not game_private.is_member(m.id,r.host_id)
      or not game_private.is_member(m.id,r.guest_id) then
      raise exception 'rematch_unavailable';
    end if;

    insert into game_private.rematches(match_id) values(m.id) on conflict do nothing;
    moment := clock_timestamp();
    update game_private.rematches set
      host_ready_at=case when host_ready_at>moment-interval '2 minutes' then host_ready_at end,
      guest_ready_at=case when guest_ready_at>moment-interval '2 minutes' then guest_ready_at end
      where match_id=m.id;
    if uid=r.host_id then
      update game_private.rematches set host_ready_at=case when p_action='rematch'
        then coalesce(host_ready_at,moment) end where match_id=m.id;
    else
      update game_private.rematches set guest_ready_at=case when p_action='rematch'
        then coalesce(guest_ready_at,moment) end where match_id=m.id;
    end if;
    select * into rem from game_private.rematches where match_id=m.id;

    if rem.host_ready_at is not null and rem.guest_ready_at is not null then
      -- Preserve the series' exact category, catalogue version and saved opening pool.
      if not exists(select 1 from public.catalogues where id=m.catalogue_id
          and category_id=m.category_id and published) then raise exception 'catalogue_not_imported'; end if;
      if r.opening_pool_id is not null and not exists(
        select 1 from public.opening_pools where id=r.opening_pool_id
          and catalogue_id=m.catalogue_id and published
      ) then raise exception 'familiar_pool_unavailable'; end if;

      select e.id into seed_id from public.entries e
        where e.catalogue_id=m.catalogue_id and e.seed_eligible
          and game_private.has_opening(m.catalogue_id,e.id)
          and (r.opening_pool_id is null or exists(select 1 from public.opening_pool_entries pe
            where pe.pool_id=r.opening_pool_id and pe.catalogue_id=m.catalogue_id and pe.entry_id=e.id))
        -- Avoid the previous opening whenever another eligible starter exists.
        order by (e.id=(m.state->'history'->>0)),random() limit 1;
      if seed_id is null then raise exception 'no_playable_seed'; end if;

      -- Expired consent never starts a match, even after slow catalogue validation.
      moment := clock_timestamp();
      if rem.host_ready_at>moment-interval '2 minutes'
        and rem.guest_ready_at>moment-interval '2 minutes' then
        first_player := case when random()<0.5 then r.host_id else r.guest_id end;
        next_state := jsonb_build_object('datasetId',m.catalogue_id,'category',m.category_id,
          'currentGameId',seed_id,'history',jsonb_build_array(seed_id),'usage','{}'::jsonb,'version',0);
        insert into public.matches(room_id,catalogue_id,category_id,active_player,deadline,state)
          values(r.id,m.catalogue_id,m.category_id,first_player,moment+interval '20 seconds',next_state)
          returning * into next_match;
        insert into public.match_participants values(next_match.id,r.host_id,0),(next_match.id,r.guest_id,1);
        insert into public.turn_history values(next_match.id,0,null,seed_id,'[]',moment);
        update game_private.rematches set next_match_id=next_match.id where match_id=m.id;
        update public.game_rooms set match_id=next_match.id,status='playing',revision=revision+1 where id=r.id;
      end if;
    end if;

    -- Signal both existing results subscribers without changing the completed game state.
    update public.matches set revision=revision+1 where id=m.id;
    result := jsonb_build_object('ok',true,'match',game_private.match_snapshot(m.id));
  end if;

  response := result||jsonb_build_object('duplicate',false,'serverTime',clock_timestamp());
  insert into game_private.command_receipts values(uid,p_request_id,fingerprint,response,clock_timestamp());
  return response;
end $$;

create function public.game_command(p_action text,p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_action in ('rematch','cancel_rematch') then
    return game_private.rematch_command(p_action,p_payload,p_request_id);
  end if;
  return game_private.core_game_command(p_action,p_payload,p_request_id);
end $$;

revoke all on function public.game_command(text,jsonb,uuid) from public,anon;
grant execute on function public.game_command(text,jsonb,uuid) to authenticated;
revoke all on function game_private.rematch_snapshot(uuid),game_private.rematch_command(text,jsonb,uuid)
  from public,anon,authenticated;

commit;
