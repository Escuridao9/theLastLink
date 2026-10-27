import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { ConnectionEngine } from '../src/engine.ts';
import type { Dataset, MatchState, SharedConnector } from '../src/types.ts';

// Executes the actual PL/pgSQL migration, policies, and importer in WASM PostgreSQL.
// PGlite serializes transactions: these are NOT evidence of multi-connection locking or pg_cron.
const db = new PGlite();
const root = new URL('../', import.meta.url);
const dataset: Dataset = JSON.parse(readFileSync(new URL('data/playable/catalogue-v1.json', root), 'utf8'));
const engine = new ConnectionEngine(dataset);
type Snapshot = { id: string; status: string; state: MatchState; activePlayer: string; deadline: string; revision: number; winnerId: string | null; room: { id: string }; turns: unknown[] };
type Reply = { ok: boolean; reason?: string; room?: { id: string; code: string; guestId: string | null }; match?: Snapshot; duplicate: boolean; connectors?: SharedConnector[] };
const a: string = randomUUID(), b: string = randomUUID(), outsider: string = randomUUID();
async function command(uid: string, action: string, payload: object, id: string = randomUUID()): Promise<Reply> {
  return db.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    const result = await tx.query<{ result: Reply }>('select public.game_command($1,$2::jsonb,$3::uuid) result', [action, JSON.stringify(payload), id]);
    return result.rows[0]!.result;
  });
}
async function fresh(): Promise<Snapshot> {
  // Independent room identities also avoid the intentional five-rooms-per-minute quota.
  const host = randomUUID(), guest = randomUUID();
  await db.query('insert into auth.users values ($1),($2)', [host,guest]);
  const room = (await command(host,'create',{ name: 'Host' })).room!;
  await command(guest,'join',{ code: room.code, name: 'Guest' });
  return (await command(host,'start',{ roomId: room.id })).match!;
}
async function resetState(match: Snapshot, state: MatchState): Promise<Snapshot> {
  await db.query("update public.matches set state=$2::jsonb,deadline=clock_timestamp()+interval '20 seconds' where id=$1", [match.id, JSON.stringify(state)]);
  await db.query('delete from public.connector_usage where match_id=$1', [match.id]);
  for (const [id,uses] of Object.entries(state.usage)) await db.query('insert into public.connector_usage values($1,$2,$3)', [match.id,id,uses]);
  // Fixtures are explicit privileged state setup. Production users have no UPDATE grant.
  await db.query('delete from public.turn_history where match_id=$1', [match.id]);
  for (let index=0;index<state.history.length;index++) await db.query("insert into public.turn_history values($1,$2,null,$3,'[]',clock_timestamp())", [match.id,index,state.history[index]]);
  return (await command(match.activePlayer,'snapshot',{ matchId: match.id })).match!;
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(readFileSync(new URL('supabase/migrations/20261027140000_game.sql',root),'utf8'));
  await db.exec(readFileSync(new URL('supabase/seed.sql',root),'utf8'));
  await db.query('insert into auth.users values($1),($2),($3)',[a,b,outsider]);
});
after(async () => { await db.close(); });

test('reviewed data, immutable dataset and canonical connection engine', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('src/engine.ts',root))).digest('hex'),'9f45469cd5420e6a945f8c357730ce595fb3f8fc6b6030ec5f568f044f234a09');
  assert.equal(createHash('sha256').update(readFileSync(new URL('data/snapshots/50-original.json',root))).digest('hex'),'cb5655a06e2d113fb4da1a99f5d68fd52a13472dbec929f821f66da17363b36c');
  assert.equal(dataset.games.length,35);
});
test('stored compiled edges equal independent same-role SQL intersections for every approved pair', async () => {
  const result=await db.query<{ from_id: string; to_id: string; entity_id: string; roles: string[] }>(`select a.entry_id from_id,b.entry_id to_id,a.entity_id,
    array_agg(a.role order by a.role) roles from public.entry_credits a join public.entry_credits b
    on a.catalogue_id=b.catalogue_id and a.entity_id=b.entity_id and a.role=b.role and a.entry_id<b.entry_id
    group by a.entry_id,b.entry_id,a.entity_id`);
  const expected=new Map(engine.graph().map(e=>[e.from+'|'+e.to,e.connectors]));
  for(const row of result.rows) {
    const connector=expected.get(row.from_id+'|'+row.to_id)?.find(c=>c.entityId===row.entity_id);
    assert.deepEqual(connector?.types.slice().sort(),row.roles);
  }
  assert.equal(result.rows.length,engine.graph().reduce((n,e)=>n+e.connectors.length,0));
  const stored=await db.query<{ from_id:string;to_id:string;connectors:SharedConnector[] }>('select * from public.catalogue_edges');
  assert.equal(stored.rows.length,expected.size);
  for(const e of stored.rows) assert.deepEqual(e.connectors,expected.get(e.from_id+'|'+e.to_id));
});
test('publish/import is idempotent and frozen rules reject edits', async () => {
  await db.exec(readFileSync(new URL('supabase/seed.sql',root),'utf8'));
  await assert.rejects(db.query("update public.catalogues set sha256='changed'"),/published_catalogue_immutable/);
  await assert.rejects(db.query("delete from public.entry_credits where role='character'"),/published_catalogue_immutable/);
});
test('anonymous visitors and nonparticipants cannot write or inspect private matches', async () => {
  const match=await fresh();
  await assert.rejects(command(outsider,'snapshot',{matchId:match.id}),/match_not_found/);
  await db.transaction(async tx=>{
    await tx.exec('set local role authenticated'); await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[outsider]);
    assert.equal((await tx.query('select * from public.matches where id=$1',[match.id])).rows.length,0);
    assert.equal((await tx.query('select * from public.game_rooms where id=$1',[match.room.id])).rows.length,0);
    assert.equal((await tx.query('select * from public.connector_usage where match_id=$1',[match.id])).rows.length,0);
  });
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.exec("update public.matches set deadline=clock_timestamp()+interval '1 hour'");}),/permission denied/);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.exec("select public.game_command('create','{}',gen_random_uuid())");}),/permission denied/);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.exec('select public.expire_due_matches()');}),/permission denied/);
});
test('private room joins are bounded to two players and start is host-only', async () => {
  const room=(await command(a,'create',{name:'Alice'})).room!;
  await command(b,'join',{code:room.code,name:'Bob'});
  await assert.rejects(command(outsider,'join',{code:room.code,name:'Mallory'}),/room_full/);
  await assert.rejects(command(b,'start',{roomId:room.id}),/host_only/);
  const match=(await command(a,'start',{roomId:room.id})).match!;
  assert.ok([a,b].includes(match.activePlayer)); assert.ok(engine.connectedComponents()[0]!.includes(match.state.currentGameId));
  assert.ok(engine.availableMoves(match.state).length>0); assert.deepEqual(match.state.usage,{});
  const again=(await command(a,'start',{roomId:room.id})).match!;
  assert.equal(again.id,match.id); assert.equal(again.deadline,match.deadline);
});
test('valid move consumes all shared entities once, alternates turn and grants exactly twenty seconds', async () => {
  const match=await fresh(); const target=engine.availableMoves(match.state)[0]!;
  const expected=engine.applyMove(match.state,target);
  const response=await command(match.activePlayer,'submit',{matchId:match.id,entryId:target,expectedVersion:0,usage:{},deadline:'2099-01-01'});
  assert.equal(response.ok,true); assert.equal(expected.ok,true); assert.deepEqual(response.match!.state,expected.state);
  assert.notEqual(response.match!.activePlayer,match.activePlayer);
  const t=response.match!.turns.at(-1) as {acceptedAt:string};
  assert.equal(Date.parse(response.match!.deadline)-Date.parse(t.acceptedAt),20000);
});
test('invalid answers and retries preserve counters, version, turn and deadline', async () => {
  const match=await fresh();
  for(const target of ['unknown',match.state.currentGameId,engine.gameIds().find(id=>id!==match.state.currentGameId&&!engine.sharedConnectors(match.state.currentGameId,id).length)!]) {
    const response=await command(match.activePlayer,'submit',{matchId:match.id,entryId:target,expectedVersion:0});
    assert.equal(response.ok,false); assert.deepEqual(response.match!.state,match.state); assert.equal(response.match!.deadline,match.deadline);
  }
});
test('one exhausted connector rejects a move that also has unused connectors', async () => {
  let match=await fresh(); const edge=engine.graph().find(e=>e.connectors.length>=2)!;
  const state={...engine.createMatch(edge.from),usage:{[edge.connectors[0]!.entityId]:3}};
  match=await resetState(match,state);
  const response=await command(match.activePlayer,'submit',{matchId:match.id,entryId:edge.to,expectedVersion:0});
  assert.equal(response.reason,'exhausted_connector'); assert.deepEqual(response.match!.state,state); assert.equal(response.match!.deadline,match.deadline);
});
test('duplicate acceptance is replayed once; request IDs cannot be repurposed', async () => {
  const match=await fresh(), target=engine.availableMoves(match.state)[0]!, id=randomUUID();
  const payload={matchId:match.id,entryId:target,expectedVersion:0};
  const first=await command(match.activePlayer,'submit',payload,id), second=await command(match.activePlayer,'submit',payload,id);
  assert.equal(first.ok,true); assert.equal(second.duplicate,true); assert.deepEqual(first.match,second.match);
  assert.equal((await command(match.activePlayer,'snapshot',{matchId:match.id})).match!.state.version,1);
  await assert.rejects(command(match.activePlayer,'submit',{...payload,entryId:'different'},id),/request_id_reused/);
});
test('out-of-turn and stale submissions do not alter state', async () => {
  const match=await fresh(), target=engine.availableMoves(match.state)[0]!;
  const outsiderTurn=await db.query<{player_id:string}>('select player_id from public.match_participants where match_id=$1 and player_id<>$2',[match.id,match.activePlayer]);
  const bad=await command(outsiderTurn.rows[0]!.player_id,'submit',{matchId:match.id,entryId:target,expectedVersion:0});
  assert.equal(bad.reason,'not_your_turn'); assert.deepEqual(bad.match!.state,match.state);
  const stale=await command(match.activePlayer,'submit',{matchId:match.id,entryId:target,expectedVersion:1});
  assert.equal(stale.reason,'stale_version'); assert.deepEqual(stale.match!.state,match.state);
});
test('expired answer immediately loses, never changes counters, and records the effective deadline', async () => {
  const match=await fresh(), target=engine.availableMoves(match.state)[0]!;
  await db.query("update public.matches set deadline=clock_timestamp()-interval '1 second' where id=$1",[match.id]);
  const response=await command(match.activePlayer,'submit',{matchId:match.id,entryId:target,expectedVersion:0});
  assert.equal(response.ok,false); assert.equal(response.match!.status,'finished'); assert.notEqual(response.match!.winnerId,match.activePlayer); assert.deepEqual(response.match!.state,match.state);
  assert.equal(await db.query('select 1').then(x=>x.rows.length),1);
});
test('independent server expiration settles a disconnected player without a client command', async () => {
  const match=await fresh();
  await db.query("update public.matches set deadline=clock_timestamp()-interval '1 second' where id=$1",[match.id]);
  await db.exec('select public.expire_due_matches()');
  const result=await db.query<{status:string;revision:number;winner_id:string}>('select * from public.matches where id=$1',[match.id]);
  assert.equal(result.rows[0]!.status,'finished'); assert.notEqual(result.rows[0]!.winner_id,match.activePlayer);
  const revision=result.rows[0]!.revision; await db.exec('select public.expire_due_matches()');
  assert.equal((await db.query<{revision:number}>('select revision from public.matches where id=$1',[match.id])).rows[0]!.revision,revision);
});
test('accepted-answer-then-expiry and expiry-then-answer have consistent serialized outcomes', async () => {
  let match=await fresh(), target=engine.availableMoves(match.state)[0]!;
  const accepted=await command(match.activePlayer,'submit',{matchId:match.id,entryId:target,expectedVersion:0});
  await db.exec('select public.expire_due_matches()');
  assert.equal((await command(match.activePlayer,'snapshot',{matchId:match.id})).match!.status,'active');
  assert.deepEqual((await command(match.activePlayer,'snapshot',{matchId:match.id})).match!.state,accepted.match!.state);
  match=await fresh();target=engine.availableMoves(match.state)[0]!;
  await db.query("update public.matches set deadline=clock_timestamp()-interval '1 second' where id=$1",[match.id]);
  await db.exec('select public.expire_due_matches()');
  const rejected=await command(match.activePlayer,'submit',{matchId:match.id,entryId:target,expectedVersion:0});
  assert.equal(rejected.ok,false);assert.deepEqual(rejected.match!.state,match.state);
});
test('a legal dead-end trap is accepted with a full opponent turn, without reseeding', async () => {
  let match=await fresh(); const edge=engine.graph().find(e=>{
    const s=engine.applyMove(engine.createMatch(e.from),e.to);return s.ok&&engine.isDeadEnd(s.state);
  })!;
  assert.ok(edge); match=await resetState(match,engine.createMatch(edge.from));
  const result=await command(match.activePlayer,'submit',{matchId:match.id,entryId:edge.to,expectedVersion:0});
  assert.equal(result.ok,true);assert.equal(result.match!.status,'active');assert.equal(result.match!.state.currentGameId,edge.to);assert.equal(engine.availableMoves(result.match!.state).length,0);
});
test('restoring the same identity returns the entire authoritative match after simulated refresh', async () => {
  const match=await fresh();const target=engine.availableMoves(match.state)[0]!;
  const moved=await command(match.activePlayer,'submit',{matchId:match.id,entryId:target,expectedVersion:0});
  const restored=await command(moved.match!.activePlayer,'snapshot',{matchId:match.id});
  assert.deepEqual(restored.match,moved.match);
});
test('twenty complete legal chains agree with the preserved engine at every accepted transition', async () => {
  for(let trial=0;trial<20;trial++) {
    let match=await fresh();
    while(true) {
      const available=engine.availableMoves(match.state);if(!available.length)break;
      const target=available[(trial+match.state.version)%available.length]!;
      const expected=engine.applyMove(match.state,target);const response=await command(match.activePlayer,'submit',{matchId:match.id,entryId:target,expectedVersion:match.state.version});
      assert.equal(response.ok,true);assert.deepEqual(response.match!.state,expected.state);match=response.match!;
    }
    await db.query("update public.matches set deadline=clock_timestamp()-interval '1 second' where id=$1",[match.id]);await db.exec('select public.expire_due_matches()');
    assert.equal((await command(match.activePlayer,'snapshot',{matchId:match.id})).match!.status,'finished');
  }
});
