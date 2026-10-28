import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { ConnectionEngine } from '../src/engine.ts';
import type { Dataset } from '../src/types.ts';
import { FootballConnectionEngine } from '../src/football/engine.ts';
import { footballFixture } from './football-fixtures.ts';

// Actual PL/pgSQL, permissions and RLS. PGlite serializes transactions; the
// owner-run --rematch smoke test covers hosted Realtime and separate clients.
const db = new PGlite(),
  root = new URL('../', import.meta.url);
const football = footballFixture();
const footballEngine = new FootballConnectionEngine(football);
const games: Dataset = JSON.parse(
  readFileSync(new URL('data/playable/catalogue-v1.json', root), 'utf8'),
);
const gamesEngine = new ConnectionEngine(games);
type Category = 'games' | 'movies' | 'football';
type Match = {
  id: string;
  roomId: string;
  category: Category;
  catalogueId: string;
  status: string;
  deadline: string;
  endedAt: string | null;
  winnerId: string | null;
  endReason: string | null;
  revision: number;
  activePlayer: string;
  state: {
    datasetId: string;
    category: Category;
    currentGameId: string;
    history: string[];
    usage: Record<string, number>;
    version: number;
  };
  room: {
    id: string;
    code: string;
    hostId: string;
    guestId: string;
    matchId: string;
    openingMode: string;
    openingPoolId: string | null;
    players: { id: string }[];
  };
  turns: { acceptedAt: string }[];
  rematch?: {
    available: boolean;
    requestedBy: string[];
    expiresAt: Record<string, string>;
    nextMatchId: string | null;
    nextStatus: string | null;
  };
};
type Reply = {
  ok: boolean;
  duplicate: boolean;
  reason?: string;
  match?: Match;
  room?: Match['room'];
};
async function command(
  uid: string,
  action: string,
  payload: object,
  id = randomUUID(),
): Promise<Reply> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    return (
      await tx.query<{ value: Reply }>('select public.game_command($1,$2::jsonb,$3) value', [
        action,
        JSON.stringify(payload),
        id,
      ])
    ).rows[0]!.value;
  });
}
async function identity() {
  const id = randomUUID();
  await db.query('insert into auth.users values($1)', [id]);
  return id;
}
function answer(m: Match) {
  if (m.category === 'games') return gamesEngine.availableMoves(m.state as never)[0]!;
  if (m.category === 'football') return footballEngine.availableMoves(m.state as never)[0]!;
  return ['tmdb:movie:1', 'tmdb:movie:2', 'tmdb:movie:3'].find(
    (id) => !m.state.history.includes(id),
  )!;
}
async function fresh(category: Category = 'football', familiar = true) {
  const host = await identity(),
    guest = await identity();
  const r = (
    await command(host, 'create', {
      name: 'Host',
      category,
      openingMode: familiar && category !== 'games' ? 'familiar' : 'standard',
    })
  ).room!;
  await command(guest, 'join', { name: 'Guest', code: r.code });
  return (await command(host, 'start', { roomId: r.id })).match!;
}
async function finished(category: Category = 'football', familiar = true) {
  let m = await fresh(category, familiar);
  m = (
    await command(m.activePlayer, 'submit', {
      matchId: m.id,
      entryId: answer(m),
      expectedVersion: 0,
    })
  ).match!;
  assert.ok(Object.keys(m.state.usage).length > 0);
  return (await command(m.activePlayer, 'concede', { matchId: m.id })).match!;
}
async function snapshot(m: Match, uid = m.room.hostId) {
  return (await command(uid, 'snapshot', { matchId: m.id })).match!;
}
async function acceptBoth(m: Match) {
  await command(m.room.hostId, 'rematch', { matchId: m.id });
  const accepted = await command(m.room.guestId, 'rematch', { matchId: m.id });
  return (
    await command(m.room.hostId, 'snapshot', { matchId: accepted.match!.rematch!.nextMatchId })
  ).match!;
}
function resultData(m: Match) {
  return {
    id: m.id,
    state: m.state,
    turns: m.turns,
    status: m.status,
    deadline: m.deadline,
    endedAt: m.endedAt,
    winnerId: m.winnerId,
    endReason: m.endReason,
    catalogueId: m.catalogueId,
  };
}
async function pool(id: string, catalogue: string, ids: string[]) {
  await db.query(
    "insert into public.opening_pools(id,catalogue_id,mode,label,selection_notes,manifest_sha256) values($1,$2,'familiar','Familiar favourites','Synthetic tests only','test')",
    [id, catalogue],
  );
  for (const entry of ids)
    await db.query('insert into public.opening_pool_entries values($1,$2,$3)', [
      id,
      catalogue,
      entry,
    ]);
  await db.query('update public.opening_pools set published=true where id=$1', [id]);
}
let existing: Match, originalCore: string;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  for (const name of [
    '20261027140000_game.sql',
    '20261027140200_movies.sql',
    '20261028100000_football_and_familiar_starts.sql',
  ])
    await db.exec(readFileSync(new URL('supabase/migrations/' + name, root), 'utf8'));
  await db.exec(readFileSync(new URL('supabase/seed.sql', root), 'utf8'));
  await db.query(
    "insert into public.catalogues(id,category_id,sha256,snapshot) values($1,'football','synthetic',$2),('movies-rematch-test','movies','synthetic','{}')",
    [football.datasetId, JSON.stringify(football)],
  );
  for (const club of football.clubs) {
    await db.query('insert into public.entries values($1,$2,$3,null,$4,true)', [
      football.datasetId,
      club.id,
      club.title,
      JSON.stringify(club.externalIds),
    ]);
    for (const role of ['player', 'manager'] as const)
      for (const c of club.credits[role]) {
        const p = football.entities[c.entityId]!;
        await db.query(
          'insert into public.connector_entities values($1,$2,$3) on conflict do nothing',
          [p.id, p.name, JSON.stringify(p.externalIds)],
        );
        await db.query('insert into public.entry_credits values($1,$2,$3,$4,$5)', [
          football.datasetId,
          club.id,
          p.id,
          role,
          JSON.stringify({ personName: p.name, sourceCredits: c.sourceCredits }),
        ]);
      }
  }
  await db.query(
    "insert into public.connector_entities values('tmdb:person:123','Synthetic actor','{}')",
  );
  for (const n of [1, 2, 3]) {
    await db.query(
      "insert into public.entries values('movies-rematch-test',$1,$2,null,'{}',true)",
      ['tmdb:movie:' + n, 'Synthetic movie ' + n],
    );
    await db.query(
      "insert into public.entry_credits values('movies-rematch-test',$1,'tmdb:person:123','actor','{}')",
      ['tmdb:movie:' + n],
    );
  }
  await db.query('update public.catalogues set published=true where not published');
  await pool('football-rematch-test-pool', football.datasetId, [
    'wikidata:club:Q101',
    'wikidata:club:Q102',
  ]);
  await pool('movies-rematch-test-pool', 'movies-rematch-test', ['tmdb:movie:1', 'tmdb:movie:2']);
  existing = await finished('games', false);
  originalCore = (
    await db.query<{ prosrc: string }>(
      "select prosrc from pg_proc where oid='public.game_command(text,jsonb,uuid)'::regprocedure",
    )
  ).rows[0]!.prosrc;
  await db.exec(
    readFileSync(new URL('supabase/migrations/20261028120000_rematches.sql', root), 'utf8'),
  );
});
after(async () => {
  await db.close();
});

test('rematch migration preserves existing results and the entire original gameplay command body', async () => {
  assert.deepEqual(resultData(await snapshot(existing)), resultData(existing));
  assert.equal((await snapshot(existing)).rematch!.available, true);
  const core = (
    await db.query<{ prosrc: string }>(
      "select prosrc from pg_proc where oid='game_private.core_game_command(text,jsonb,uuid)'::regprocedure",
    )
  ).rows[0]!.prosrc;
  assert.equal(core, originalCore);
});

test('a rematch needs both identities; forged readiness fields and one-sided cancellation cannot control the rival', async () => {
  const m = await finished();
  const requested = (
    await command(m.room.guestId, 'rematch', {
      matchId: m.id,
      playerId: m.room.hostId,
      requestedBy: m.room.players.map((p) => p.id),
      deadline: '2099-01-01',
    })
  ).match!;
  assert.deepEqual(requested.rematch!.requestedBy, [m.room.guestId]);
  assert.equal(requested.rematch!.nextMatchId, null);
  assert.deepEqual(resultData(requested), resultData(m));
  assert.ok(requested.revision > m.revision);
  const cancelledOther = (
    await command(m.room.hostId, 'cancel_rematch', { matchId: m.id, playerId: m.room.guestId })
  ).match!;
  assert.deepEqual(cancelledOther.rematch!.requestedBy, [m.room.guestId]);
  const cancelledSelf = (await command(m.room.guestId, 'cancel_rematch', { matchId: m.id })).match!;
  assert.deepEqual(cancelledSelf.rematch!.requestedBy, []);
  assert.equal(cancelledSelf.rematch!.nextMatchId, null);
});

test('duplicate requests and competing acceptance attempts create exactly one successor in the same room', async () => {
  const m = await finished(),
    key = randomUUID(),
    payload = { matchId: m.id };
  const first = await command(m.room.hostId, 'rematch', payload, key);
  const duplicate = await command(m.room.hostId, 'rematch', payload, key);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(first.match, duplicate.match);
  const accepted = await Promise.all([
    command(m.room.guestId, 'rematch', payload),
    command(m.room.guestId, 'rematch', payload),
  ]);
  assert.equal(accepted[0]!.match!.rematch!.nextMatchId, accepted[1]!.match!.rematch!.nextMatchId);
  assert.equal(
    (await db.query('select id from public.matches where room_id=$1', [m.roomId])).rows.length,
    2,
  );
  assert.equal(
    (await db.query('select id from public.game_rooms where id=$1', [m.roomId])).rows.length,
    1,
  );
  const previous = await snapshot(m);
  assert.deepEqual(resultData(previous), resultData(m));
  assert.equal(previous.rematch!.available, false);
  assert.equal(previous.rematch!.nextStatus, 'active');
  const afterCancel = await command(m.room.hostId, 'cancel_rematch', payload);
  assert.equal(afterCancel.reason, 'rematch_started');
});

test('fresh rounds retain Games, Movies, Football and familiar settings while resetting all gameplay state', async () => {
  for (const [category, familiar] of [
    ['games', false],
    ['movies', false],
    ['movies', true],
    ['football', false],
    ['football', true],
  ] as const) {
    const old = await finished(category, familiar),
      next = await acceptBoth(old);
    assert.notEqual(next.id, old.id);
    assert.equal(next.roomId, old.roomId);
    assert.equal(next.room.code, old.room.code);
    assert.equal(next.category, old.category);
    assert.equal(next.catalogueId, old.catalogueId);
    assert.equal(next.room.openingMode, old.room.openingMode);
    assert.equal(next.room.openingPoolId, old.room.openingPoolId);
    assert.deepEqual(next.room.players, old.room.players);
    assert.ok(next.room.players.some((p) => p.id === next.activePlayer));
    assert.equal(next.status, 'active');
    assert.equal(next.winnerId, null);
    assert.equal(next.endedAt, null);
    assert.deepEqual(next.state.usage, {});
    assert.equal(next.state.version, 0);
    assert.equal(next.state.history.length, 1);
    assert.equal(next.turns.length, 1);
    assert.notEqual(next.state.currentGameId, old.state.history[0]);
    assert.equal(Date.parse(next.deadline) - Date.parse(next.turns[0]!.acceptedAt), 20000);
    if (familiar)
      assert.equal(
        (
          await db.query(
            'select entry_id from public.opening_pool_entries where pool_id=$1 and entry_id=$2',
            [next.room.openingPoolId, next.state.currentGameId],
          )
        ).rows.length,
        1,
      );
    const valid = await command(next.activePlayer, 'submit', {
      matchId: next.id,
      entryId: answer(next),
      expectedVersion: 0,
    });
    assert.equal(valid.ok, true);
    assert.equal(valid.match!.state.version, 1);
    assert.ok(Object.keys(valid.match!.state.usage).length > 0);
  }
});

test('expired consent cannot start a round; the player must agree again', async () => {
  const m = await finished();
  await command(m.room.hostId, 'rematch', { matchId: m.id });
  await db.query(
    "update game_private.rematches set host_ready_at=clock_timestamp()-interval '121 seconds' where match_id=$1",
    [m.id],
  );
  assert.deepEqual((await snapshot(m)).rematch!.requestedBy, []);
  const waiting = (await command(m.room.guestId, 'rematch', { matchId: m.id })).match!;
  assert.equal(waiting.rematch!.nextMatchId, null);
  assert.deepEqual(waiting.rematch!.requestedBy, [m.room.guestId]);
  assert.equal(
    (await db.query('select id from public.matches where room_id=$1', [m.roomId])).rows.length,
    1,
  );
  const renewed = (await command(m.room.hostId, 'rematch', { matchId: m.id })).match!;
  assert.ok(renewed.rematch!.nextMatchId);
  assert.equal(renewed.rematch!.nextStatus, 'active');
});

test('cancellation before the opponent accepts prevents a start until the first player renews consent', async () => {
  const m = await finished();
  await command(m.room.hostId, 'rematch', { matchId: m.id });
  await command(m.room.hostId, 'cancel_rematch', { matchId: m.id });
  const waiting = (await command(m.room.guestId, 'rematch', { matchId: m.id })).match!;
  assert.equal(waiting.rematch!.nextMatchId, null);
  assert.deepEqual(waiting.rematch!.requestedBy, [m.room.guestId]);
  assert.equal(
    (await db.query('select id from public.matches where room_id=$1', [m.roomId])).rows.length,
    1,
  );
  const renewed = (await command(m.room.hostId, 'rematch', { matchId: m.id })).match!;
  assert.ok(renewed.rematch!.nextMatchId);
});

test('active rounds, nonmembers and receipt reuse cannot authorize rematches or bypass private helpers', async () => {
  const m = await fresh(),
    outsider = await identity();
  await assert.rejects(command(m.room.hostId, 'rematch', { matchId: m.id }), /match_not_finished/);
  const key = randomUUID();
  const ended = (await command(m.activePlayer, 'concede', { matchId: m.id }, key)).match!;
  await assert.rejects(command(outsider, 'rematch', { matchId: m.id }), /match_not_found/);
  await assert.rejects(command(outsider, 'cancel_rematch', { matchId: m.id }), /match_not_found/);
  await assert.rejects(
    command(m.activePlayer, 'rematch', { matchId: m.id }, key),
    /request_id_reused/,
  );
  assert.deepEqual((await snapshot(ended)).rematch!.requestedBy, []);
  await db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    const privileges = (
      await tx.query<{ core: boolean; helper: boolean; data: boolean }>(`select
      has_function_privilege('authenticated','game_private.core_game_command(text,jsonb,uuid)','execute') core,
      has_function_privilege('authenticated','game_private.rematch_command(text,jsonb,uuid)','execute') helper,
      has_table_privilege('authenticated','game_private.rematches','select') data`)
    ).rows[0]!;
    assert.deepEqual(privileges, { core: false, helper: false, data: false });
  });
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.exec('delete from game_private.rematches');
    }),
    /permission denied/,
  );
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon');
      await tx.exec("select public.game_command('rematch','{}',gen_random_uuid())");
    }),
    /permission denied/,
  );
});

test('old round commands cannot fork a later rematch or change its counters', async () => {
  const first = await finished(),
    second = await acceptBoth(first);
  const ended = (await command(second.activePlayer, 'concede', { matchId: second.id })).match!;
  const third = await acceptBoth(ended);
  await command(first.room.hostId, 'rematch', { matchId: first.id });
  const late = await command(first.activePlayer, 'submit', {
    matchId: first.id,
    entryId: answer(first),
    expectedVersion: first.state.version,
  });
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'match_finished');
  assert.equal(
    (await db.query('select id from public.matches where room_id=$1', [first.roomId])).rows.length,
    3,
  );
  assert.deepEqual((await snapshot(third)).state, third.state);
});

test('a single-member familiar pool can restart without inventing a different eligible seed', async () => {
  await pool('zz-single-football-pool', football.datasetId, ['wikidata:club:Q101']);
  const first = await finished(),
    next = await acceptBoth(first);
  assert.equal(first.state.history[0], 'wikidata:club:Q101');
  assert.equal(next.state.currentGameId, 'wikidata:club:Q101');
  assert.deepEqual(next.state.usage, {});
});
