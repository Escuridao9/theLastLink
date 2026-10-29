-- Private account history survives the 24-hour retention of room details.
begin;

create table game_private.account_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_active_at timestamptz not null default clock_timestamp()
);
revoke all on game_private.account_activity from public, anon, authenticated;
alter table game_private.account_activity enable row level security;
-- Give every existing identity a full grace period when this migration is applied.
insert into game_private.account_activity(user_id) select id from auth.users;

alter table public.game_rooms add column last_active_at timestamptz not null default clock_timestamp();
alter table public.rooms add column last_active_at timestamptz not null default clock_timestamp();
create index game_rooms_retention on public.game_rooms(last_active_at) where status <> 'playing';
create index legacy_rooms_retention on public.rooms(last_active_at) where status <> 'playing';

create function game_private.legacy_room_activity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not pg_try_advisory_xact_lock_shared(214126234,29) then
    raise exception 'account_busy_retry' using errcode='55P03';
  end if;
  if TG_TABLE_NAME='rooms' then
    new.last_active_at:=clock_timestamp();
    return new;
  end if;
  update public.rooms set last_active_at=clock_timestamp() where id=new.room_id;
  return new;
end $$;
create trigger legacy_room_recent before insert or update of status on public.rooms
  for each row execute function game_private.legacy_room_activity();
create trigger legacy_membership_recent after insert or update on public.room_players
  for each row execute function game_private.legacy_room_activity();

create table public.match_summaries (
  player_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null,
  opponent_id uuid references auth.users(id) on delete set null,
  opponent_name text not null,
  category_id text not null references public.categories(id),
  finished_at timestamptz not null,
  outcome text not null check(outcome in ('win','loss')),
  moves integer not null check(moves >= 0),
  end_reason text not null check(end_reason in ('timeout','conceded')),
  primary key(player_id,match_id)
);
create index match_summaries_recent on public.match_summaries(player_id,finished_at desc,match_id desc);
alter table public.match_summaries enable row level security;
revoke all on public.match_summaries from public, anon, authenticated;
grant select on public.match_summaries to authenticated;
create policy summaries_read_own on public.match_summaries for select to authenticated
  using(player_id=(select auth.uid()));

create function game_private.touch_account(uid uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if uid is null or not exists(select 1 from auth.users where id=uid) then
    raise exception 'account_unavailable' using errcode='42501';
  end if;
  insert into game_private.account_activity(user_id) values(uid)
  on conflict(user_id) do update set last_active_at=excluded.last_active_at
    where game_private.account_activity.last_active_at < clock_timestamp()-interval '1 minute';
end $$;

create function game_private.save_match_summary(mid uuid) returns void
language sql security definer set search_path='' as $$
  insert into public.match_summaries(player_id,match_id,opponent_id,opponent_name,category_id,finished_at,outcome,moves,end_reason)
  select participant.player_id,m.id,opponent.player_id,p.display_name,m.category_id,m.ended_at,
    case when participant.player_id=m.winner_id then 'win' else 'loss' end,
    greatest(coalesce((m.state->>'version')::integer,0),0),m.end_reason
  from public.matches m
  join public.match_participants participant on participant.match_id=m.id
  join auth.users account on account.id=participant.player_id
    and account.is_anonymous is false and account.email_confirmed_at is not null
  join public.match_participants opponent on opponent.match_id=m.id and opponent.player_id<>participant.player_id
  join public.players p on p.id=opponent.player_id
  where m.id=mid and m.status='finished'
  on conflict(player_id,match_id) do nothing
$$;

create function game_private.save_finished_match() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='finished' and old.status is distinct from new.status then
    perform game_private.save_match_summary(new.id);
  end if;
  return new;
end $$;
create trigger match_account_summary after update of status on public.matches
  for each row execute function game_private.save_finished_match();

create function game_private.account_auth_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  if TG_OP='INSERT' or old.is_anonymous is distinct from new.is_anonymous
    or old.email_confirmed_at is distinct from new.email_confirmed_at
    or old.email_change is distinct from new.email_change
    or old.last_sign_in_at is distinct from new.last_sign_in_at then
    perform game_private.touch_account(new.id);
  end if;
  if TG_OP='UPDATE' and new.is_anonymous is false and new.email_confirmed_at is not null
    and (old.is_anonymous is distinct from new.is_anonymous or old.email_confirmed_at is distinct from new.email_confirmed_at) then
    for mid in select m.id from public.matches m join public.match_participants p on p.match_id=m.id
      where p.player_id=new.id and m.status='finished'
    loop perform game_private.save_match_summary(mid); end loop;
  end if;
  return new;
end $$;
create trigger last_link_auth_activity after insert or update on auth.users
  for each row execute function game_private.account_auth_activity();

-- Shared locks allow normal play in parallel. Rare maintenance uses a non-waiting
-- exclusive lock so it cannot race a start, answer, rematch or heartbeat.
alter function public.game_command(text,jsonb,uuid) set schema game_private;
alter function game_private.game_command(text,jsonb,uuid) rename to game_command_before_retention;
revoke all on function game_private.game_command_before_retention(text,jsonb,uuid) from public,anon,authenticated;
create function public.game_command(p_action text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare response jsonb; rid uuid;
begin
  perform pg_advisory_xact_lock_shared(214126234,29);
  perform game_private.touch_account(auth.uid());
  response:=game_private.game_command_before_retention(p_action,p_payload,p_request_id);
  rid:=coalesce(response->'room'->>'id',response->'match'->>'roomId')::uuid;
  update public.game_rooms set last_active_at=clock_timestamp()
    where id=rid and auth.uid() in (host_id,guest_id)
      and last_active_at<clock_timestamp()-interval '1 minute';
  return response;
end $$;
revoke all on function public.game_command(text,jsonb,uuid) from public,anon;
grant execute on function public.game_command(text,jsonb,uuid) to authenticated;

alter function public.expire_due_matches() set schema game_private;
alter function game_private.expire_due_matches() rename to expire_due_matches_before_retention;
revoke all on function game_private.expire_due_matches_before_retention() from public,anon,authenticated;
create function public.expire_due_matches() returns integer
language plpgsql security definer set search_path='' as $$
begin
  if not pg_try_advisory_xact_lock_shared(214126234,29) then return 0; end if;
  return game_private.expire_due_matches_before_retention();
end $$;
revoke all on function public.expire_due_matches() from public,anon,authenticated;

create function public.account_heartbeat() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock_shared(214126234,29);
  perform game_private.touch_account(auth.uid());
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.account_heartbeat() from public,anon;
grant execute on function public.account_heartbeat() to authenticated;

create function public.account_overview(p_category text default null,p_before_at timestamptz default null,
  p_before_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); statistics jsonb; groups jsonb; history jsonb;
begin
  perform pg_advisory_xact_lock_shared(214126234,29);
  perform game_private.touch_account(uid);
  if not exists(select 1 from auth.users where id=uid and is_anonymous is false and email_confirmed_at is not null) then
    raise exception 'registered_account_required' using errcode='42501';
  end if;
  if p_category is not null and p_category not in ('games','movies','football') then raise exception 'invalid_category'; end if;
  if p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null) then raise exception 'invalid_page'; end if;
  select jsonb_build_object('played',count(*),'wins',count(*) filter(where outcome='win'),
    'losses',count(*) filter(where outcome='loss'),
    'winRate',coalesce(round(100.0*count(*) filter(where outcome='win')/nullif(count(*),0),1),0))
    into statistics from public.match_summaries where player_id=uid;
  select coalesce(jsonb_agg(jsonb_build_object('category',category_id,'played',played,'wins',wins,
    'losses',played-wins,'winRate',round(100.0*wins/nullif(played,0),1)) order by category_id),'[]')
    into groups from (select category_id,count(*) played,count(*) filter(where outcome='win') wins
      from public.match_summaries where player_id=uid group by category_id) totals;
  select coalesce(jsonb_agg(jsonb_build_object('id',match_id,'opponent',opponent_name,'category',category_id,
    'finishedAt',finished_at,'outcome',outcome,'moves',moves,'endReason',end_reason,
    'detailsAvailable',exists(select 1 from public.matches m where m.id=page.match_id))
    order by finished_at desc,match_id desc),'[]') into history
    from (select * from public.match_summaries where player_id=uid
      and (p_category is null or category_id=p_category)
      and (p_before_at is null or (finished_at,match_id)<(p_before_at,p_before_id))
      order by finished_at desc,match_id desc limit p_limit+1) page;
  return jsonb_build_object('statistics',statistics,'categories',groups,'history',history);
end $$;
revoke all on function public.account_overview(text,timestamptz,uuid,integer) from public,anon;
grant execute on function public.account_overview(text,timestamptz,uuid,integer) to authenticated;

create function game_private.delete_room_details(rid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  select coalesce(array_agg(id),array[]::uuid[]) into ids from public.matches where room_id=rid;
  update public.game_rooms set match_id=null where id=rid;
  delete from game_private.rematches where match_id=any(ids) or next_match_id=any(ids);
  delete from game_private.command_receipts where response->'room'->>'id'=rid::text
    or response->'match'->>'roomId'=rid::text or response->'match'->'room'->>'id'=rid::text;
  delete from public.connector_usage where match_id=any(ids);
  delete from public.turn_history where match_id=any(ids);
  delete from public.match_participants where match_id=any(ids);
  delete from public.matches where room_id=rid;
  delete from public.game_rooms where id=rid;
end $$;

create function game_private.before_account_delete() returns trigger
language plpgsql security definer set search_path='' as $$
declare room record; active record; opponent uuid;
begin
  if not pg_try_advisory_xact_lock(214126234,29) then
    raise exception 'account_busy_retry' using errcode='55P03';
  end if;
  -- Deleting an account during play concedes its active rounds using the existing
  -- server finish function. Other registered players keep their result summary.
  for active in select m.id from public.matches m join public.match_participants p on p.match_id=m.id
    where p.player_id=old.id and m.status='active'
  loop
    select player_id into opponent from public.match_participants where match_id=active.id and player_id<>old.id;
    if opponent is null then raise exception 'account_has_incomplete_match'; end if;
    perform game_private.finish(active.id,opponent,'conceded',clock_timestamp());
  end loop;
  for room in select r.id from public.game_rooms r where old.id in (r.host_id,r.guest_id)
    or exists(select 1 from public.matches m join public.match_participants p on p.match_id=m.id
      where m.room_id=r.id and p.player_id=old.id)
  loop perform game_private.delete_room_details(room.id); end loop;
  delete from public.rooms r where r.host_user_id=old.id
    or exists(select 1 from public.room_players p where p.room_id=r.id and p.user_id=old.id);
  delete from game_private.command_receipts where player_id=old.id;
  update public.match_summaries set opponent_id=null,
    opponent_name=case when old.is_anonymous then 'Guest' else 'Deleted player' end where opponent_id=old.id;
  delete from public.match_summaries where player_id=old.id;
  delete from public.players where id=old.id;
  return old;
end $$;
create trigger last_link_before_account_delete before delete on auth.users
  for each row execute function game_private.before_account_delete();

create function public.delete_player_account(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_user_id is null then raise exception 'invalid_account'; end if;
  if not pg_try_advisory_xact_lock(214126234,29) then
    raise exception 'account_busy_retry' using errcode='55P03';
  end if;
  perform 1 from auth.users where id=p_user_id and is_anonymous is false for update nowait;
  if not found then raise exception 'registered_account_required'; end if;
  delete from auth.users where id=p_user_id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.delete_player_account(uuid) from public,anon,authenticated;
grant execute on function public.delete_player_account(uuid) to service_role;

create function public.cleanup_unused_data(p_dry_run boolean default true,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cutoff timestamptz:=clock_timestamp()-interval '24 hours'; item record;
  rooms_count integer:=0; legacy_count integer:=0; guests_count integer:=0; receipts_count integer:=0;
  expired_rooms uuid[]:=array[]::uuid[]; expired_legacy uuid[]:=array[]::uuid[];
  expired_guests uuid[]:=array[]::uuid[];
begin
  if p_dry_run is null or p_limit is null or p_limit not between 1 and 200 then raise exception 'invalid_cleanup_options'; end if;
  if not pg_try_advisory_xact_lock(214126234,29) then
    return jsonb_build_object('dryRun',p_dry_run,'busy',true,'rooms',0,'legacyRooms',0,'guests',0,'receipts',0);
  end if;
  for item in select r.id from public.game_rooms r where r.last_active_at<cutoff and r.status<>'playing'
    and not exists(select 1 from public.matches m where m.room_id=r.id and m.status='active')
    and not exists(select 1 from public.matches m join game_private.rematches rem on rem.match_id=m.id
      where m.room_id=r.id and greatest(rem.host_ready_at,rem.guest_ready_at)>clock_timestamp()-interval '2 minutes')
    order by r.last_active_at limit p_limit
  loop
    rooms_count:=rooms_count+1;
    expired_rooms:=array_append(expired_rooms,item.id);
    if not p_dry_run then perform game_private.delete_room_details(item.id); end if;
  end loop;
  for item in select r.id from public.rooms r where r.last_active_at<cutoff and r.status<>'playing'
    order by r.last_active_at limit p_limit
  loop
    legacy_count:=legacy_count+1;
    expired_legacy:=array_append(expired_legacy,item.id);
    if not p_dry_run then delete from public.rooms where id=item.id; end if;
  end loop;
  -- A refresh token is not user activity. A new sign-in or application heartbeat is.
  -- A pending email/identity conversion is preserved rather than guessing ownership.
  for item in select u.id from auth.users u left join game_private.account_activity a on a.user_id=u.id
    where u.is_anonymous is true and u.email_confirmed_at is null
      and nullif(u.email,'') is null and nullif(u.email_change,'') is null
      and greatest(u.created_at,coalesce(u.last_sign_in_at,u.created_at),coalesce(a.last_active_at,u.created_at))<cutoff
      and not exists(select 1 from auth.identities i where i.user_id=u.id)
      and not exists(select 1 from auth.sessions s where s.user_id=u.id and s.created_at>=cutoff)
      and not exists(select 1 from public.game_rooms r where u.id in(r.host_id,r.guest_id) and not(r.id=any(expired_rooms)))
      and not exists(select 1 from public.room_players p where p.user_id=u.id and not(p.room_id=any(expired_legacy)))
      and not exists(select 1 from public.rooms r where r.host_user_id=u.id and not(r.id=any(expired_legacy)))
      and not exists(select 1 from public.match_participants p join public.matches m on m.id=p.match_id
        where p.player_id=u.id and not(m.room_id=any(expired_rooms)))
    order by u.created_at limit p_limit for update of u skip locked
  loop
    guests_count:=guests_count+1;
    expired_guests:=array_append(expired_guests,item.id);
    if not p_dry_run then delete from auth.users where id=item.id and is_anonymous is true; end if;
  end loop;
  select count(*) into receipts_count from (select player_id,request_id from game_private.command_receipts c
    where c.created_at<cutoff
      and not(c.player_id=any(expired_guests))
      and not(coalesce(c.response->'room'->>'id','')=any(expired_rooms::text[])
        or coalesce(c.response->'match'->>'roomId','')=any(expired_rooms::text[])
        or coalesce(c.response->'match'->'room'->>'id','')=any(expired_rooms::text[]))
      and not exists(select 1 from public.match_participants p join public.matches m on m.id=p.match_id
        where p.player_id=c.player_id and m.status='active')
    order by created_at limit p_limit*20) stale;
  if not p_dry_run then
    delete from game_private.command_receipts c using (select player_id,request_id from game_private.command_receipts c
      where c.created_at<cutoff and not exists(select 1 from public.match_participants p join public.matches m on m.id=p.match_id
        where p.player_id=c.player_id and m.status='active') order by created_at limit p_limit*20) stale
      where c.player_id=stale.player_id and c.request_id=stale.request_id;
  end if;
  return jsonb_build_object('dryRun',p_dry_run,'busy',false,'rooms',rooms_count,'legacyRooms',legacy_count,
    'guests',guests_count,'receipts',receipts_count);
end $$;
revoke all on function public.cleanup_unused_data(boolean,integer) from public,anon,authenticated;
grant execute on function public.cleanup_unused_data(boolean,integer) to service_role;

-- Existing retained results become available immediately. Guests who register
-- later receive summaries of the detailed results that still exist at that time.
do $$ declare mid uuid; begin
  for mid in select id from public.matches where status='finished'
  loop perform game_private.save_match_summary(mid); end loop;
end $$;

revoke all on function game_private.legacy_room_activity(),game_private.touch_account(uuid),
  game_private.save_match_summary(uuid),game_private.save_finished_match(),game_private.account_auth_activity(),
  game_private.delete_room_details(uuid),game_private.before_account_delete() from public,anon,authenticated;
select pg_notify('pgrst','reload schema');
commit;
