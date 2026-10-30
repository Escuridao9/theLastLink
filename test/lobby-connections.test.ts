import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { ConnectionEngine } from '../src/engine.ts';
import type { Dataset } from '../src/types.ts';

// Runs the actual migration and RLS in embedded PostgreSQL. Hosted sockets/Cron
// scheduling remain owner-run checks; no waiting or fake production timers here.
const db = new PGlite();
const engine = new ConnectionEngine(JSON.parse(readFileSync(new URL('../data/playable/catalogue-v1.json',import.meta.url),'utf8')) as Dataset);
const sql = (name: string) => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
async function user() {
  const id = randomUUID();
  await db.query('insert into auth.users(id) values($1)', [id]);
  return id;
}
async function command(uid: string, action: string, payload: object, request = randomUUID()): Promise<any> {
  return db.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    return (await tx.query<{ value: unknown }>('select public.game_command($1,$2::jsonb,$3) value', [action, JSON.stringify(payload), request])).rows[0]!.value;
  });
}
async function fresh(join = true) {
  const host = await user(), guest = await user(), hostTab = randomUUID(), guestTab = randomUUID();
  const room = (await command(host, 'create', { name: 'Host', category: 'games', clientId: hostTab })).room;
  if (join) await command(guest, 'join', { name: 'Guest', code: room.code, clientId: guestTab });
  return { host, guest, hostTab, guestTab, room };
}
async function age(room: string, uid: string, seconds: number) {
  await db.query("update game_private.lobby_connections set last_seen_at=clock_timestamp()-$3*interval '1 second',expires_at=clock_timestamp()+(30-$3)*interval '1 second' where room_id=$1 and user_id=$2", [room, uid, seconds]);
}
let original: string;
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_change text default '',is_anonymous boolean default true,
      email_confirmed_at timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz default now());
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users on delete cascade,provider text);
    create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users on delete cascade);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
    create publication supabase_realtime;`);
  for (const migration of ['20261026150832_create_rooms_and_players.sql','20261027140000_game.sql',
    '20261027140200_movies.sql','20261028100000_football_and_familiar_starts.sql','20261028120000_rematches.sql',
    '20261029120000_account_history_and_retention.sql']) await db.exec(sql(migration));
  await db.exec(readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));
  original = (await db.query<{ body: string }>("select prosrc body from pg_proc where oid='public.game_command(text,jsonb,uuid)'::regprocedure")).rows[0]!.body;
  await db.exec(sql('20261030120000_lobby_connections.sql'));
});
after(async () => { await db.close(); });

test('lobby migration retains the existing gameplay command and starts a twenty-second round', async () => {
  const preserved = (await db.query<{ body: string }>("select prosrc body from pg_proc where oid='game_private.game_command_before_lobby(text,jsonb,uuid)'::regprocedure")).rows[0]!.body;
  assert.equal(preserved, original);
  const f = await fresh();
  const reply = await command(f.host, 'start', { roomId: f.room.id, clientId: f.hostTab });
  assert.equal(reply.ok, true);
  assert.equal(Date.parse(reply.match.deadline)-Date.parse(reply.match.turns[0].acceptedAt), 20000);
  assert.equal((await db.query('select * from game_private.lobby_connections where room_id=$1',[f.room.id])).rows.length, 0);
});
test('missing heartbeats show reconnecting and prevent a start before the grace period expires', async () => {
  const f = await fresh();
  await age(f.room.id,f.guest,15);
  const r = await command(f.host,'room',{ roomId:f.room.id,clientId:f.hostTab });
  assert.equal(r.room.guestId,f.guest);
  assert.equal(r.room.lobbyPresence[f.guest].connected,false);
  const start = await command(f.host,'start',{ roomId:f.room.id,clientId:f.hostTab,connected:true });
  assert.equal(start.ok,false); assert.equal(start.reason,'players_reconnecting');
  assert.equal((await db.query('select * from public.matches where room_id=$1',[f.room.id])).rows.length,0);
});
test('returning before expiry restores the same seat without changing either identity', async () => {
  const f = await fresh();
  await command(f.guest,'lobby_disconnect',{ roomId:f.room.id,clientId:f.guestTab });
  let r = await command(f.host,'room',{ roomId:f.room.id,clientId:f.hostTab });
  assert.equal(r.room.lobbyPresence[f.guest].connected,false);
  r = await command(f.guest,'room',{ roomId:f.room.id,clientId:randomUUID() }); // A refreshed tab gets a fresh key.
  assert.equal(r.room.guestId,f.guest); assert.equal(r.room.lobbyPresence[f.guest].connected,true);
  assert.equal(r.room.hostId,f.host);
});
test('the existing server expiry function releases an abandoned guest without client commands', async () => {
  const f = await fresh();
  await age(f.room.id,f.guest,31);
  await db.exec('select public.expire_due_matches()');
  const raw = (await db.query<{ guest_id: string|null; status:string }>('select guest_id,status from public.game_rooms where id=$1',[f.room.id])).rows[0]!;
  assert.equal(raw.guest_id,null); assert.equal(raw.status,'waiting');
  const next = await user();
  const joined = await command(next,'join',{ name:'New challenger',code:f.room.code,clientId:randomUUID() });
  assert.equal(joined.room.guestId,next);
  await assert.rejects(command(f.guest,'room',{ roomId:f.room.id,clientId:f.guestTab }),/room_not_found/);
});
test('an expired guest cannot revive its seat through a late heartbeat', async () => {
  const f = await fresh(); await age(f.room.id,f.guest,31);
  const r = await command(f.guest,'room',{ roomId:f.room.id,clientId:f.guestTab });
  assert.equal(r.ok,false); assert.equal(r.reason,'lobby_seat_expired');
  assert.equal((await command(f.host,'room',{ roomId:f.room.id,clientId:f.hostTab })).room.guestId,null);
});
test('closing one tab does not disconnect the same player in another connected tab', async () => {
  const f = await fresh(), second = randomUUID();
  await command(f.guest,'room',{ roomId:f.room.id,clientId:second });
  await command(f.guest,'lobby_disconnect',{ roomId:f.room.id,clientId:f.guestTab });
  const r = await command(f.host,'room',{ roomId:f.room.id,clientId:f.hostTab });
  assert.equal(r.room.lobbyPresence[f.guest].connected,true);
  assert.equal((await command(f.host,'start',{ roomId:f.room.id,clientId:f.hostTab })).ok,true);
});
test('leaving releases the guest immediately, is idempotent, and cannot change the opponent seat', async () => {
  const f = await fresh(), id = randomUUID(), payload = { roomId:f.room.id,clientId:f.guestTab,playerId:f.host };
  assert.equal((await command(f.guest,'leave',payload,id)).ok,true);
  assert.equal((await command(f.guest,'leave',payload,id)).duplicate,true);
  await assert.rejects(command(f.guest,'leave',{ ...payload,roomId:randomUUID() },id),/request_id_reused/);
  const r = (await command(f.host,'room',{ roomId:f.room.id,clientId:f.hostTab })).room;
  assert.equal(r.hostId,f.host); assert.equal(r.guestId,null); assert.equal(r.status,'waiting');
});
test('an explicit host departure closes the waiting room for both players', async () => {
  const f = await fresh();
  await command(f.host,'leave',{ roomId:f.room.id,clientId:f.hostTab });
  assert.equal((await command(f.guest,'room',{ roomId:f.room.id,clientId:f.guestTab })).reason,'room_closed');
  const outsider = await user();
  assert.equal((await command(outsider,'join',{ name:'New guest',code:f.room.code })).reason,'room_closed');
  assert.equal((await command(f.host,'start',{ roomId:f.room.id })).reason,'room_closed');
});
test('the server closes a lobby after its host has exhausted the grace period', async () => {
  const f = await fresh(); await age(f.room.id,f.host,31);
  await db.exec('select public.expire_due_matches()');
  assert.equal((await db.query<{ status:string }>('select status from public.game_rooms where id=$1',[f.room.id])).rows[0]!.status,'closed');
  assert.equal((await db.query('select * from game_private.lobby_connections where room_id=$1',[f.room.id])).rows.length,0);
});
test('late lobby departures cannot forfeit, remove participants or change an active match', async () => {
  const f = await fresh(); const m = (await command(f.host,'start',{ roomId:f.room.id })).match;
  for (const action of ['leave','lobby_disconnect']) {
    const r = await command(f.guest,action,{ roomId:f.room.id,clientId:f.guestTab });
    assert.equal(r.ok,false); assert.equal(r.reason,'room_started'); assert.equal(r.match.id,m.id);
    assert.deepEqual(r.match.state,m.state); assert.equal(r.match.deadline,m.deadline);
  }
  await db.exec('select public.expire_due_matches()');
  assert.equal((await command(f.host,'snapshot',{ matchId:m.id })).match.status,'active');
});
test('nonmembers and frontend roles cannot read or alter another player’s connection leases', async () => {
  const f = await fresh(), outsider = await user();
  for (const action of ['room','leave','lobby_disconnect','start'])
    await assert.rejects(command(outsider,action,{ roomId:f.room.id,clientId:f.hostTab }),/room_not_found/);
  for (const role of ['anon','authenticated']) {
    const permissions = (await db.query<{ table_access:boolean; helper:boolean; expiry:boolean }>(`select
      has_table_privilege($1,'game_private.lobby_connections','select,insert,update,delete') table_access,
      has_function_privilege($1,'game_private.prune_lobby(uuid)','execute') helper,
      has_function_privilege($1,'public.expire_due_matches()','execute') expiry`,[role])).rows[0]!;
    assert.deepEqual(permissions,{table_access:false,helper:false,expiry:false});
  }
});
test('overview checks do not renew a lobby lease or keep an absent player present', async () => {
  const f=await fresh(); await age(f.room.id,f.guest,20);
  const before=(await db.query('select last_seen_at,expires_at from game_private.lobby_connections where room_id=$1 and user_id=$2',[f.room.id,f.guest])).rows;
  const r=await command(f.guest,'room_status',{roomId:f.room.id});
  assert.equal(r.room.lobbyPresence[f.guest].connected,false);
  assert.deepEqual((await db.query('select last_seen_at,expires_at from game_private.lobby_connections where room_id=$1 and user_id=$2',[f.room.id,f.guest])).rows,before);
});
test('a replayed old join receipt cannot revive a released seat', async () => {
  const f=await fresh(false), id=randomUUID(), payload={name:'Guest',code:f.room.code,clientId:f.guestTab};
  await command(f.guest,'join',payload,id);
  await command(f.guest,'leave',{roomId:f.room.id,clientId:f.guestTab});
  const replay=await command(f.guest,'join',payload,id);
  assert.equal(replay.ok,false); assert.equal(replay.reason,'lobby_seat_expired');
  assert.equal((await db.query('select * from game_private.lobby_connections where room_id=$1 and user_id=$2',[f.room.id,f.guest])).rows.length,0);
  assert.equal((await command(f.guest,'join',payload)).room.guestId,f.guest);
});
test('invalid answers, every shared counter and mutual rematches still use the original authoritative rules', async () => {
  const f=await fresh(); let m=(await command(f.host,'start',{roomId:f.room.id})).match;
  const before=structuredClone(m);
  const invalid=await command(m.activePlayer,'submit',{matchId:m.id,entryId:m.state.currentGameId,expectedVersion:0});
  assert.equal(invalid.ok,false); assert.equal(invalid.reason,'repeated_game'); assert.equal(invalid.match.deadline,m.deadline);
  const target=engine.availableMoves(m.state)[0]!;
  const expected=engine.applyMove(m.state,target); assert.equal(expected.ok,true);
  m=(await command(m.activePlayer,'submit',{matchId:m.id,entryId:target,expectedVersion:0})).match;
  if (expected.ok) assert.deepEqual(m.state.usage,expected.state.usage);
  assert.equal(m.state.version,1); assert.equal(Date.parse(m.deadline)-Date.parse(m.turns[1].acceptedAt),20000);
  const finished=(await command(m.activePlayer,'concede',{matchId:m.id})).match;
  await command(f.host,'rematch',{matchId:m.id});
  const result=await command(f.guest,'rematch',{matchId:m.id});
  const next=(await command(f.host,'snapshot',{matchId:result.match.rematch.nextMatchId})).match;
  assert.notEqual(next.id,before.id); assert.equal(next.roomId,before.roomId);
  assert.deepEqual(next.state.usage,{}); assert.equal(next.state.version,0);
  assert.equal(Date.parse(next.deadline)-Date.parse(next.turns[0].acceptedAt),20000);
  assert.deepEqual((await command(f.host,'snapshot',{matchId:finished.id})).match.state,finished.state);
});
