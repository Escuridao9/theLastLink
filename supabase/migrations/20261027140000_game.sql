-- THE LAST LINK: authoritative, single-round Sudden Death. All writes go through game_command.
create schema if not exists game_private;
revoke all on schema game_private from public, anon, authenticated;

create table public.categories (
  id text primary key, name text not null, eligible_roles text[] not null
);
insert into public.categories values ('games', 'Games', array['developer','composer','voiceActor','character']);
create table public.catalogues (
  id text primary key, category_id text not null references public.categories,
  published boolean not null default false, sha256 text not null,
  snapshot jsonb not null, created_at timestamptz not null default now()
);
create table public.entries (
  catalogue_id text not null references public.catalogues, id text not null,
  title text not null, release_year integer, external_ids jsonb not null default '{}',
  seed_eligible boolean not null default false,
  primary key(catalogue_id,id)
);
create table public.connector_entities (
  id text primary key, name text not null, external_ids jsonb not null default '{}'
);
create table public.entry_credits (
  catalogue_id text not null, entry_id text not null,
  entity_id text not null references public.connector_entities,
  role text not null check(role in ('developer','composer','voiceActor','character')),
  provenance jsonb not null, primary key(catalogue_id,entry_id,entity_id,role),
  foreign key(catalogue_id,entry_id) references public.entries
);
-- Exact edges compiled by the unchanged TypeScript engine from the reviewed snapshot.
create table public.catalogue_edges (
  catalogue_id text not null, from_id text not null, to_id text not null,
  connectors jsonb not null check(jsonb_array_length(connectors)>0),
  primary key(catalogue_id,from_id,to_id), check(from_id<to_id),
  foreign key(catalogue_id,from_id) references public.entries,
  foreign key(catalogue_id,to_id) references public.entries
);
create table public.players (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check(char_length(display_name) between 2 and 24)
);
create table public.game_rooms (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  host_id uuid not null references public.players, guest_id uuid references public.players,
  status text not null default 'waiting' check(status in ('waiting','ready','playing','finished')),
  match_id uuid, revision integer not null default 0, created_at timestamptz not null default now(),
  check(host_id is distinct from guest_id)
);
create table public.matches (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.game_rooms,
  catalogue_id text not null references public.catalogues,
  category_id text not null default 'games' references public.categories,
  status text not null default 'active' check(status in ('active','finished')),
  active_player uuid not null references public.players,
  deadline timestamptz not null, state jsonb not null,
  revision integer not null default 0, winner_id uuid references public.players,
  end_reason text check(end_reason in ('timeout','conceded')), ended_at timestamptz,
  created_at timestamptz not null default now(),
  check((status='active' and winner_id is null and ended_at is null) or
        (status='finished' and winner_id is not null and ended_at is not null))
);
alter table public.game_rooms add constraint rooms_match_fk foreign key(match_id) references public.matches;
create table public.match_participants (
  match_id uuid not null references public.matches, player_id uuid not null references public.players,
  seat integer not null check(seat in (0,1)), primary key(match_id,player_id), unique(match_id,seat)
);
create table public.turn_history (
  match_id uuid not null references public.matches, move_index integer not null,
  player_id uuid references public.players, entry_id text not null,
  connectors jsonb not null, accepted_at timestamptz not null,
  primary key(match_id,move_index), unique(match_id,entry_id)
);
create table public.connector_usage (
  match_id uuid not null references public.matches,
  entity_id text not null references public.connector_entities,
  uses integer not null check(uses between 1 and 3), primary key(match_id,entity_id)
);
create table game_private.command_receipts (
  player_id uuid not null references public.players, request_id uuid not null,
  fingerprint text not null, response jsonb not null, created_at timestamptz not null default now(),
  primary key(player_id,request_id)
);
create index matches_due on public.matches(deadline) where status='active';
create index rooms_host on public.game_rooms(host_id);
create index rooms_guest on public.game_rooms(guest_id);
create index participants_player on public.match_participants(player_id,match_id);

-- Published rule data is immutable, including credits and compiled intersections.
create function game_private.freeze_catalogue() returns trigger language plpgsql
set search_path = '' as $$
declare cid text;
begin
  if TG_TABLE_NAME='catalogues' then
    if TG_OP <> 'INSERT' and old.published then raise exception 'published_catalogue_immutable'; end if;
  else
    cid := case when TG_OP='DELETE' then old.catalogue_id else new.catalogue_id end;
    if exists(select 1 from public.catalogues where id=cid and published) then
      raise exception 'published_catalogue_immutable';
    end if;
    if TG_OP='UPDATE' and old.catalogue_id<>new.catalogue_id and
       exists(select 1 from public.catalogues where id=old.catalogue_id and published) then
      raise exception 'published_catalogue_immutable';
    end if;
  end if;
  if TG_OP='DELETE' then return old; else return new; end if;
end $$;
create trigger freeze_catalogues before update or delete on public.catalogues for each row execute function game_private.freeze_catalogue();
create trigger freeze_entries before insert or update or delete on public.entries for each row execute function game_private.freeze_catalogue();
create trigger freeze_credits before insert or update or delete on public.entry_credits for each row execute function game_private.freeze_catalogue();
create trigger freeze_edges before insert or update or delete on public.catalogue_edges for each row execute function game_private.freeze_catalogue();

create function game_private.is_member(mid uuid, uid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.match_participants where match_id=mid and player_id=uid)
$$;
-- This helper may be used by RLS, but cannot return a match or change it.
grant usage on schema game_private to authenticated;
grant execute on function game_private.is_member(uuid,uuid) to authenticated;

create function game_private.room_snapshot(rid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'code',r.code,'hostId',r.host_id,'guestId',r.guest_id,
   'status',r.status,'matchId',r.match_id,'revision',r.revision,
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name)
       order by p.id) from public.players p where p.id=r.host_id or p.id=r.guest_id),'[]'::jsonb))
 from public.game_rooms r where r.id=rid
$$;
create function game_private.match_snapshot(mid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',m.id,'roomId',m.room_id,'catalogueId',m.catalogue_id,
   'category','games','status',m.status,'activePlayer',m.active_player,'deadline',m.deadline,
   'state',m.state,'revision',m.revision,'winnerId',m.winner_id,'endReason',m.end_reason,
   'endedAt',m.ended_at,'room',game_private.room_snapshot(m.room_id),
   'turns',coalesce((select jsonb_agg(jsonb_build_object('index',t.move_index,
     'playerId',t.player_id,'entryId',t.entry_id,'connectors',t.connectors,'acceptedAt',t.accepted_at)
     order by t.move_index) from public.turn_history t where t.match_id=m.id),'[]'::jsonb))
 from public.matches m where m.id=mid
$$;
create function game_private.finish(mid uuid, winning uuid, reason text, effective_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.matches set status='finished',winner_id=winning,end_reason=reason,
    ended_at=effective_at,revision=revision+1 where id=mid and status='active';
  update public.game_rooms set status='finished',revision=revision+1 where match_id=mid and status<>'finished';
end $$;

-- A server job invokes this even when no client exists. Locks are never waited on.
create function public.expire_due_matches() returns integer
language plpgsql security definer set search_path='' as $$
declare m public.matches; win uuid; n integer:=0;
begin
  for m in select * from public.matches where status='active' and deadline<=clock_timestamp()
    order by deadline limit 100 for update skip locked
  loop
    select player_id into win from public.match_participants where match_id=m.id and player_id<>m.active_player;
    perform game_private.finish(m.id,win,'timeout',m.deadline);
    n:=n+1;
  end loop;
  return n;
end $$;

create function public.game_command(p_action text, p_payload jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); rid uuid; mid uuid; r public.game_rooms; m public.matches;
  receipt game_private.command_receipts; fp text; result jsonb; response jsonb;
  cid text; seed_id text; first_player uuid; opponent uuid; target text; name text;
  shared jsonb; exhausted jsonb; c jsonb; counts jsonb; next_state jsonb;
  moment timestamptz; code_value text; reason text; expected integer;
begin
  if uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>4096 then raise exception 'invalid_request'; end if;
  -- A stable request ID cannot be repurposed. Advisory lock serializes identical retries.
  perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
  fp:=md5(p_action||p_payload::text);
  select * into receipt from game_private.command_receipts where player_id=uid and request_id=p_request_id;
  if found then
    if receipt.fingerprint<>fp then raise exception 'request_id_reused'; end if;
    return receipt.response||jsonb_build_object('duplicate',true,'serverTime',clock_timestamp());
  end if;
  name:=trim(coalesce(p_payload->>'name','Player'));
  if char_length(name)<2 or char_length(name)>24 then raise exception 'invalid_name'; end if;
  insert into public.players(id,display_name) values(uid,name) on conflict(id) do nothing;

  if p_action='create' then
    -- Serialize creation per identity to enforce a small free-plan room quota.
    perform pg_advisory_xact_lock(hashtextextended(uid::text,1));
    if (select count(*) from public.game_rooms where host_id=uid and created_at>clock_timestamp()-interval '1 minute')>=5
      then raise exception 'room_rate_limit'; end if;
    update public.players set display_name=name where id=uid;
    code_value:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    insert into public.game_rooms(code,host_id) values(code_value,uid) returning * into r;
    result:=jsonb_build_object('ok',true,'room',game_private.room_snapshot(r.id));
  elsif p_action='join' then
    code_value:=upper(regexp_replace(coalesce(p_payload->>'code',''),'[^a-zA-Z0-9]','','g'));
    select * into r from public.game_rooms where code=code_value for update;
    if not found then raise exception 'room_not_found'; end if;
    if uid=r.host_id or uid=r.guest_id then
      result:=jsonb_build_object('ok',true,'room',game_private.room_snapshot(r.id));
    elsif r.guest_id is not null or r.status<>'waiting' then raise exception 'room_full';
    else
      update public.players set display_name=name where id=uid;
      update public.game_rooms set guest_id=uid,status='ready',revision=revision+1 where id=r.id;
      result:=jsonb_build_object('ok',true,'room',game_private.room_snapshot(r.id));
    end if;
  elsif p_action in ('room','start') then
    rid:=(p_payload->>'roomId')::uuid;
    select * into r from public.game_rooms where id=rid for update;
    if not found or (uid<>r.host_id and uid is distinct from r.guest_id) then
      raise exception 'room_not_found' using errcode='42501'; end if;
    if p_action='room' then
      result:=jsonb_build_object('ok',true,'room',game_private.room_snapshot(r.id));
    else
      if uid<>r.host_id then raise exception 'host_only' using errcode='42501'; end if;
      if r.match_id is not null then
        result:=jsonb_build_object('ok',true,'match',game_private.match_snapshot(r.match_id));
      else
        if r.status<>'ready' or r.guest_id is null then raise exception 'need_two_players'; end if;
        select id into cid from public.catalogues where published and category_id='games' order by created_at desc,id desc limit 1;
        if cid is null then raise exception 'catalogue_not_imported'; end if;
        select e.id into seed_id from public.entries e where e.catalogue_id=cid and e.seed_eligible
          and exists(select 1 from public.catalogue_edges ce where ce.catalogue_id=cid and (ce.from_id=e.id or ce.to_id=e.id))
          order by random() limit 1;
        if seed_id is null then raise exception 'no_playable_seed'; end if;
        first_player:=case when random()<0.5 then r.host_id else r.guest_id end;
        moment:=clock_timestamp();
        next_state:=jsonb_build_object('datasetId',cid,'category','games','currentGameId',seed_id,
          'history',jsonb_build_array(seed_id),'usage','{}'::jsonb,'version',0);
        insert into public.matches(room_id,catalogue_id,active_player,deadline,state)
          values(r.id,cid,first_player,moment+interval '20 seconds',next_state) returning * into m;
        insert into public.match_participants values(m.id,r.host_id,0),(m.id,r.guest_id,1);
        insert into public.turn_history values(m.id,0,null,seed_id,'[]',moment);
        update public.game_rooms set match_id=m.id,status='playing',revision=revision+1 where id=r.id;
        result:=jsonb_build_object('ok',true,'match',game_private.match_snapshot(m.id));
      end if;
    end if;
  elsif p_action in ('snapshot','submit','expire','concede') then
    mid:=(p_payload->>'matchId')::uuid;
    select * into m from public.matches where id=mid for update;
    if not found or not game_private.is_member(mid,uid) then
      raise exception 'match_not_found' using errcode='42501'; end if;
    select player_id into opponent from public.match_participants where match_id=mid and player_id<>m.active_player;
    -- Linearization point: clock is sampled AFTER acquiring the authoritative match lock.
    moment:=clock_timestamp();
    if m.status='active' and moment>=m.deadline then
      perform game_private.finish(mid,opponent,'timeout',m.deadline);
      m.status:='finished';
    end if;
    if p_action in ('snapshot','expire') then
      result:=jsonb_build_object('ok',true,'match',game_private.match_snapshot(mid));
    elsif m.status<>'active' then
      result:=jsonb_build_object('ok',false,'reason','match_finished','match',game_private.match_snapshot(mid));
    elsif p_action='concede' then
      select player_id into opponent from public.match_participants where match_id=mid and player_id<>uid;
      perform game_private.finish(mid,opponent,'conceded',moment);
      result:=jsonb_build_object('ok',true,'match',game_private.match_snapshot(mid));
    else
      target:=p_payload->>'entryId'; expected:=(p_payload->>'expectedVersion')::integer;
      if uid<>m.active_player then reason:='not_your_turn';
      elsif expected is null or expected<>(m.state->>'version')::integer then reason:='stale_version';
      elsif not exists(select 1 from public.entries where catalogue_id=m.catalogue_id and id=target) then reason:='unknown_game';
      elsif (m.state->'history') ? target then reason:='repeated_game';
      else
        select connectors into shared from public.catalogue_edges where catalogue_id=m.catalogue_id
          and from_id=least(m.state->>'currentGameId',target) and to_id=greatest(m.state->>'currentGameId',target);
        if shared is null then reason:='no_shared_connector';
        else
          select coalesce(jsonb_agg(s.value->>'entityId'),'[]'::jsonb) into exhausted
            from jsonb_array_elements(shared) s join public.connector_usage u
              on u.match_id=mid and u.entity_id=s.value->>'entityId' where u.uses>=3;
          if jsonb_array_length(exhausted)>0 then reason:='exhausted_connector'; end if;
        end if;
      end if;
      if reason is not null then
        result:=jsonb_build_object('ok',false,'reason',reason,'exhausted',coalesce(exhausted,'[]'),
          'connectors',coalesce(shared,'[]'),'match',game_private.match_snapshot(mid));
      else
        -- Recheck at commit decision: validation work never grants extra time.
        moment:=clock_timestamp();
        if moment>=m.deadline then
          perform game_private.finish(mid,opponent,'timeout',m.deadline);
          result:=jsonb_build_object('ok',false,'reason','match_finished','match',game_private.match_snapshot(mid));
        else
          for c in select value from jsonb_array_elements(shared) loop
            insert into public.connector_usage values(mid,c->>'entityId',1)
              on conflict(match_id,entity_id) do update set uses=public.connector_usage.uses+1;
          end loop;
          select jsonb_object_agg(entity_id,uses) into counts from public.connector_usage where match_id=mid;
          next_state:=m.state||jsonb_build_object('currentGameId',target,'history',(m.state->'history')||jsonb_build_array(target),
            'usage',counts,'version',(m.state->>'version')::integer+1);
          update public.matches set state=next_state,active_player=opponent,deadline=moment+interval '20 seconds',revision=revision+1 where id=mid;
          insert into public.turn_history values(mid,(next_state->>'version')::integer,uid,target,shared,moment);
          result:=jsonb_build_object('ok',true,'connectors',shared,'match',game_private.match_snapshot(mid));
        end if;
      end if;
    end if;
  else raise exception 'unknown_action'; end if;
  response:=result||jsonb_build_object('duplicate',false,'serverTime',clock_timestamp());
  -- Read-only polling does not create unbounded receipts. Mutating operations are idempotent.
  if p_action not in ('room','snapshot','expire') then
    insert into game_private.command_receipts values(uid,p_request_id,fp,response,clock_timestamp());
  end if;
  return response;
end $$;

-- Least privilege. No public/anonymous EXECUTE on security-definer helpers.
revoke all on all functions in schema game_private from public, anon, authenticated;
grant execute on function game_private.is_member(uuid,uuid) to authenticated;
revoke all on function public.game_command(text,jsonb,uuid) from public, anon;
grant execute on function public.game_command(text,jsonb,uuid) to authenticated;
revoke all on function public.expire_due_matches() from public, anon, authenticated;

alter table public.categories enable row level security;
alter table public.catalogues enable row level security;
alter table public.entries enable row level security;
alter table public.connector_entities enable row level security;
alter table public.entry_credits enable row level security;
alter table public.catalogue_edges enable row level security;
alter table public.players enable row level security;
alter table public.game_rooms enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
alter table public.turn_history enable row level security;
alter table public.connector_usage enable row level security;
create policy public_categories on public.categories for select to anon,authenticated using(true);
create policy published_catalogues on public.catalogues for select to anon,authenticated using(published);
create policy published_entries on public.entries for select to anon,authenticated using(exists(select 1 from public.catalogues c where c.id=catalogue_id and c.published));
create policy published_entities on public.connector_entities for select to anon,authenticated using(true);
create policy published_credits on public.entry_credits for select to anon,authenticated using(exists(select 1 from public.catalogues c where c.id=catalogue_id and c.published));
create policy published_edges on public.catalogue_edges for select to anon,authenticated using(exists(select 1 from public.catalogues c where c.id=catalogue_id and c.published));
create policy own_player on public.players for select to authenticated using(id=(select auth.uid()));
create policy room_members on public.game_rooms for select to authenticated using(host_id=(select auth.uid()) or guest_id=(select auth.uid()));
create policy match_members on public.matches for select to authenticated using(game_private.is_member(id,(select auth.uid())));
create policy participant_members on public.match_participants for select to authenticated using(game_private.is_member(match_id,(select auth.uid())));
create policy history_members on public.turn_history for select to authenticated using(game_private.is_member(match_id,(select auth.uid())));
create policy usage_members on public.connector_usage for select to authenticated using(game_private.is_member(match_id,(select auth.uid())));
revoke all on public.categories,public.catalogues,public.entries,public.connector_entities,public.entry_credits,public.catalogue_edges,public.players,public.game_rooms,public.matches,public.match_participants,public.turn_history,public.connector_usage from anon,authenticated;
grant select on public.categories,public.catalogues,public.entries,public.connector_entities,public.entry_credits,public.catalogue_edges to anon,authenticated;
grant select on public.players,public.game_rooms,public.matches,public.match_participants,public.turn_history,public.connector_usage to authenticated;

-- RLS controls the rows delivered to each Realtime subscriber.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.game_rooms,public.matches;
  end if;
end $$;
