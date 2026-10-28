-- Football and optional familiar starting pools. Existing catalogue versions and matches remain frozen.
begin;
insert into public.categories values('football','Football',array['player','manager']);
alter table public.entry_credits drop constraint entry_credits_role_check;
alter table public.entry_credits add constraint entry_credits_role_check
 check(role in ('developer','composer','voiceActor','character','actor','director','writer','cinematographer','player','manager'));

create table public.opening_pools (
 id text primary key,
 catalogue_id text not null references public.catalogues,
 mode text not null check(mode='familiar'),
 label text not null,
 selection_notes text not null,
 manifest_sha256 text not null,
 published boolean not null default false,
 unique(id,catalogue_id)
);
create table public.opening_pool_entries (
 pool_id text not null,
 catalogue_id text not null,
 entry_id text not null,
 primary key(pool_id,entry_id),
 foreign key(pool_id,catalogue_id) references public.opening_pools(id,catalogue_id),
 foreign key(catalogue_id,entry_id) references public.entries(catalogue_id,id)
);
alter table public.game_rooms add column opening_pool_id text references public.opening_pools;
alter table public.game_rooms add constraint opening_pool_supported_category
 check(opening_pool_id is null or category_id in ('movies','football'));

create function game_private.freeze_opening_pool() returns trigger language plpgsql set search_path='' as $$
declare pid text;
begin
 if TG_TABLE_NAME='opening_pools' then
  if TG_OP<>'INSERT' and old.published then raise exception 'published_opening_pool_immutable'; end if;
 else
  pid:=case when TG_OP='DELETE' then old.pool_id else new.pool_id end;
  if exists(select 1 from public.opening_pools where id=pid and published) then
   raise exception 'published_opening_pool_immutable';
  end if;
  if TG_OP='UPDATE' and old.pool_id<>new.pool_id and exists(select 1 from public.opening_pools where id=old.pool_id and published) then
   raise exception 'published_opening_pool_immutable';
  end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger freeze_opening_pools before update or delete on public.opening_pools
 for each row execute function game_private.freeze_opening_pool();
create trigger freeze_opening_pool_entries before insert or update or delete on public.opening_pool_entries
 for each row execute function game_private.freeze_opening_pool();

alter table public.opening_pools enable row level security;
alter table public.opening_pool_entries enable row level security;
revoke all on public.opening_pools,public.opening_pool_entries from public,anon,authenticated;
grant select on public.opening_pools,public.opening_pool_entries to anon,authenticated;
grant all on public.opening_pools,public.opening_pool_entries to service_role;
create policy published_opening_pools_read on public.opening_pools for select to anon,authenticated using (
 published and exists(select 1 from public.catalogues c where c.id=catalogue_id and c.published)
);
create policy published_opening_pool_entries_read on public.opening_pool_entries for select to anon,authenticated using (
 exists(select 1 from public.opening_pools p join public.catalogues c on c.id=p.catalogue_id
   where p.id=pool_id and p.published and c.published)
);

create or replace function game_private.check_credit_category() returns trigger language plpgsql set search_path='' as $$
declare category text;
begin
 select c.category_id into category from public.catalogues c join public.categories cat on cat.id=c.category_id
   where c.id=new.catalogue_id and new.role=any(cat.eligible_roles);
 if category is null then raise exception 'credit_role_wrong_category'; end if;
 if category='movies' and new.entity_id !~ '^tmdb:person:[1-9][0-9]*$' then raise exception 'movie_person_identity_required'; end if;
 if category='football' and new.entity_id !~ '^wikidata:Q[1-9][0-9]*$' then raise exception 'football_person_identity_required'; end if;
 return new;
end $$;

create or replace function game_private.has_opening(cid text, eid text) returns boolean
 language sql stable set search_path='' as $$
 select case when (select category_id from public.catalogues where id=cid) in ('movies','football') then
   exists(select 1 from public.entry_credits a join public.entry_credits b
     on b.catalogue_id=a.catalogue_id and b.entity_id=a.entity_id and b.entry_id<>a.entry_id
     where a.catalogue_id=cid and a.entry_id=eid)
 else exists(select 1 from public.catalogue_edges where catalogue_id=cid and (from_id=eid or to_id=eid)) end
$$;

create or replace function game_private.shared_connectors(cid text, source_id text, target_id text) returns jsonb
 language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 if (select category_id from public.catalogues where id=cid) in ('movies','football') then
   -- The same person can qualify in different eligible roles at each endpoint.
   -- GROUP BY identity before counting: one person is always one shared allowance.
   select jsonb_agg(jsonb_build_object('entityId',x.entity_id,'name',x.person_name,
       'fromTypes',x.from_types,'toTypes',x.to_types,'types',x.all_types) order by x.entity_id) into result
   from (
     select a.entity_id,min(coalesce(a.provenance->>'personName',p.name)) person_name,
       array_agg(distinct a.role order by a.role) from_types,
       array_agg(distinct b.role order by b.role) to_types,
       array(select distinct unnest(array_agg(a.role)||array_agg(b.role)) order by 1) all_types
     from public.entry_credits a join public.entry_credits b
       on b.catalogue_id=a.catalogue_id and b.entity_id=a.entity_id
     join public.connector_entities p on p.id=a.entity_id
     where a.catalogue_id=cid and a.entry_id=source_id and b.entry_id=target_id
     group by a.entity_id
   ) x;
 else
   select connectors into result from public.catalogue_edges where catalogue_id=cid
     and from_id=least(source_id,target_id) and to_id=greatest(source_id,target_id);
 end if;
 return result;
end $$;

create or replace function game_private.room_snapshot(rid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'code',r.code,'hostId',r.host_id,'guestId',r.guest_id,
   'category',r.category_id,'openingMode',case when r.opening_pool_id is null then 'standard' else 'familiar' end,
   'openingPoolId',r.opening_pool_id,'status',r.status,'matchId',r.match_id,'revision',r.revision,
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name)
       order by p.id) from public.players p where p.id=r.host_id or p.id=r.guest_id),'[]'::jsonb))
 from public.game_rooms r where r.id=rid
$$;
create or replace function public.game_command(p_action text, p_payload jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); rid uuid; mid uuid; r public.game_rooms; m public.matches;
  receipt game_private.command_receipts; fp text; result jsonb; response jsonb;
  cid text; seed_id text; first_player uuid; opponent uuid; target text; name text;
  shared jsonb; exhausted jsonb; c jsonb; counts jsonb; next_state jsonb;
  moment timestamptz; code_value text; reason text; expected integer; pool_id text; opening_mode text;
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
    if coalesce(p_payload->>'category','games') not in ('games','movies','football') then raise exception 'invalid_category'; end if;
    if not exists(select 1 from public.catalogues where published and category_id=coalesce(p_payload->>'category','games'))
      then raise exception 'catalogue_not_imported'; end if;
    opening_mode:=coalesce(p_payload->>'openingMode','standard');
    if opening_mode not in ('standard','familiar') then raise exception 'invalid_opening_mode'; end if;
    if opening_mode='familiar' then
      if coalesce(p_payload->>'category','games') not in ('movies','football') then raise exception 'opening_mode_not_supported'; end if;
      select op.id into pool_id from public.opening_pools op join public.catalogues cat on cat.id=op.catalogue_id
        where op.published and cat.published and op.mode='familiar' and cat.category_id=p_payload->>'category'
        order by cat.created_at desc,cat.id desc,op.id desc limit 1;
      if pool_id is null then raise exception 'familiar_pool_unavailable'; end if;
    end if;
    insert into public.game_rooms(code,host_id,category_id,opening_pool_id)
      values(code_value,uid,coalesce(p_payload->>'category','games'),pool_id) returning * into r;
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
        if r.opening_pool_id is not null then
          -- A familiar room pins a published pool and catalogue; clients never choose the title.
          select op.catalogue_id into cid from public.opening_pools op join public.catalogues cat on cat.id=op.catalogue_id
            where op.id=r.opening_pool_id and op.published and cat.published and cat.category_id=r.category_id;
          if cid is null then raise exception 'familiar_pool_unavailable'; end if;
        else
          select id into cid from public.catalogues where published and category_id=r.category_id order by created_at desc,id desc limit 1;
        end if;
        if cid is null then raise exception 'catalogue_not_imported'; end if;
        select e.id into seed_id from public.entries e where e.catalogue_id=cid and e.seed_eligible
          and game_private.has_opening(cid,e.id)
          and (r.opening_pool_id is null or exists(select 1 from public.opening_pool_entries pe
            where pe.pool_id=r.opening_pool_id and pe.catalogue_id=cid and pe.entry_id=e.id))
          order by random() limit 1;
        if seed_id is null then raise exception 'no_playable_seed'; end if;
        first_player:=case when random()<0.5 then r.host_id else r.guest_id end;
        moment:=clock_timestamp();
        next_state:=jsonb_build_object('datasetId',cid,'category',r.category_id,'currentGameId',seed_id,
          'history',jsonb_build_array(seed_id),'usage','{}'::jsonb,'version',0);
        insert into public.matches(room_id,catalogue_id,category_id,active_player,deadline,state)
          values(r.id,cid,r.category_id,first_player,moment+interval '20 seconds',next_state) returning * into m;
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
        shared:=game_private.shared_connectors(m.catalogue_id,m.state->>'currentGameId',target);
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

create function public.opening_pool_options(p_catalogue_id text)
returns table(mode text,label text,pool_id text,entries bigint)
language sql stable security invoker set search_path='' as $$
 select op.mode,op.label,op.id,count(pe.entry_id) from public.opening_pools op
 join public.opening_pool_entries pe on pe.pool_id=op.id
 join public.catalogues cat on cat.id=op.catalogue_id
 where op.catalogue_id=p_catalogue_id and op.published and cat.published
 group by op.mode,op.label,op.id
$$;
revoke all on function public.opening_pool_options(text) from public;
grant execute on function public.opening_pool_options(text) to anon,authenticated;

create function public.entry_credit_details(p_catalogue_id text,p_entry_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('entityId',c.entity_id,'role',c.role,
  'name',coalesce(c.provenance->>'personName',p.name),'sourceCredits',c.provenance->'sourceCredits') order by c.role,c.entity_id),'[]')
 from public.entry_credits c join public.connector_entities p on p.id=c.entity_id
 join public.catalogues cat on cat.id=c.catalogue_id
 where c.catalogue_id=p_catalogue_id and c.entry_id=p_entry_id and cat.category_id in ('movies','football') and cat.published
$$;
revoke all on function public.entry_credit_details(text,text) from public;
grant execute on function public.entry_credit_details(text,text) to anon,authenticated;
revoke all on function game_private.freeze_opening_pool() from public,anon,authenticated;
commit;
