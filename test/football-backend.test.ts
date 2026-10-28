import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { footballFixture } from './football-fixtures.ts';
import { FootballConnectionEngine } from '../src/football/engine.ts';
import {
  FOOTBALL_ROLES,
  type FootballDataset,
  type FootballMatchState,
} from '../src/football/types.ts';

// Actual migrations and RLS in PostgreSQL. Multi-connection Realtime/locking and pg_cron
// require the separate owner-run live test; PGlite cannot demonstrate them.
const db = new PGlite(),
  root = new URL('../', import.meta.url);
const data = footballFixture(),
  engine = new FootballConnectionEngine(data);
const cid = (n: number) => `wikidata:club:Q${n}`;
type Room = {
  id: string;
  code: string;
  category: string;
  openingMode: string;
  openingPoolId: string | null;
  players: { id: string }[];
};
type Match = {
  id: string;
  catalogueId: string;
  category: string;
  deadline: string;
  activePlayer: string;
  state: FootballMatchState;
  room: Room;
  turns: { acceptedAt: string }[];
};
type Reply = {
  ok: boolean;
  duplicate: boolean;
  reason?: string;
  room?: Room;
  match?: Match;
  connectors?: unknown[];
  exhausted?: string[];
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
async function room(category = 'football', mode = 'standard') {
  const host = await identity(),
    guest = await identity();
  const result = await command(host, 'create', { name: 'Host', category, openingMode: mode });
  return { host, guest, room: result.room! };
}
async function start(mode = 'standard') {
  const f = await room('football', mode);
  await command(f.guest, 'join', { name: 'Guest', code: f.room.code });
  return (await command(f.host, 'start', { roomId: f.room.id })).match!;
}
async function importFootball(d: FootballDataset) {
  await db.query(
    "insert into public.catalogues(id,category_id,sha256,snapshot) values($1,'football','synthetic-test-only',$2)",
    [d.datasetId, JSON.stringify({ datasetId: d.datasetId, category: 'football', games: [] })],
  );
  for (const club of d.clubs) {
    await db.query('insert into public.entries values($1,$2,$3,null,$4,true)', [
      d.datasetId,
      club.id,
      club.title,
      JSON.stringify(club.externalIds),
    ]);
    for (const role of FOOTBALL_ROLES)
      for (const c of club.credits[role]) {
        const person = d.entities[c.entityId]!;
        await db.query(
          'insert into public.connector_entities values($1,$2,$3) on conflict do nothing',
          [person.id, person.name, JSON.stringify(person.externalIds)],
        );
        await db.query('insert into public.entry_credits values($1,$2,$3,$4,$5)', [
          d.datasetId,
          club.id,
          c.entityId,
          role,
          JSON.stringify({ personName: person.name, sourceCredits: c.sourceCredits }),
        ]);
      }
  }
  await db.query('update public.catalogues set published=true where id=$1', [d.datasetId]);
}
async function pool(id: string, catalogueId: string, entries: string[], published = true) {
  await db.query(
    "insert into public.opening_pools(id,catalogue_id,mode,label,selection_notes,manifest_sha256) values($1,$2,'familiar','Familiar favourites','Synthetic test only','test')",
    [id, catalogueId],
  );
  for (const entry of entries)
    await db.query('insert into public.opening_pool_entries values($1,$2,$3)', [
      id,
      catalogueId,
      entry,
    ]);
  if (published) await db.query('update public.opening_pools set published=true where id=$1', [id]);
}
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
  await importFootball(data);
  await pool('football-fixture-pool', data.datasetId, [cid(101)]);
  await pool('football-draft-hidden', data.datasetId, [cid(102)], false);
});
after(async () => {
  await db.close();
});

test('Football SQL intersections match the person engine across every pair and role direction', async () => {
  for (const from of data.clubs)
    for (const to of data.clubs) {
      const result = (
        await db.query<{ value: any }>('select game_private.shared_connectors($1,$2,$3) value', [
          data.datasetId,
          from.id,
          to.id,
        ])
      ).rows[0]!.value;
      assert.deepEqual(
        (result ?? []).map(({ name, ...c }: any) => c),
        engine.sharedConnectors(from.id, to.id),
      );
    }
});

test('familiar choice is host-owned, survives joining and only limits the first club', async () => {
  const f = await room('football', 'familiar');
  assert.equal(f.room.openingMode, 'familiar');
  assert.equal(f.room.openingPoolId, 'football-fixture-pool');
  const joined = (
    await command(f.guest, 'join', {
      name: 'Guest',
      code: f.room.code,
      category: 'movies',
      openingMode: 'standard',
    })
  ).room!;
  assert.equal(joined.category, 'football');
  assert.equal(joined.openingMode, 'familiar');
  await assert.rejects(command(f.guest, 'start', { roomId: f.room.id }), /host_only/);
  const m = (await command(f.host, 'start', { roomId: f.room.id, entryId: cid(106) })).match!;
  assert.equal(m.state.currentGameId, cid(101));
  assert.deepEqual(m.state.usage, {});
  assert.equal(Date.parse(m.deadline) - Date.parse(m.turns[0]!.acceptedAt), 20000);
  const requestId = randomUUID(),
    payload = { matchId: m.id, entryId: cid(102), expectedVersion: 0 };
  const accepted = await command(m.activePlayer, 'submit', payload, requestId);
  assert.equal(accepted.ok, true);
  assert.equal(
    accepted.match!.state.currentGameId,
    cid(102),
    'answer outside opening pool is legal',
  );
  assert.deepEqual(accepted.match!.state, engine.applyMove(m.state, cid(102)).state);
  assert.equal(
    Date.parse(accepted.match!.deadline) - Date.parse(accepted.match!.turns.at(-1)!.acceptedAt),
    20000,
  );
  const retry = await command(m.activePlayer, 'submit', payload, requestId);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.match!.state, accepted.match!.state);
});

test('standard default is backwards compatible; unsupported and invalid modes fail clearly', async () => {
  const host = await identity();
  const r = (await command(host, 'create', { name: 'Host', category: 'games' })).room!;
  assert.equal(r.openingMode, 'standard');
  assert.equal(r.openingPoolId, null);
  await assert.rejects(
    command(host, 'create', { name: 'Host', category: 'games', openingMode: 'familiar' }),
    /opening_mode_not_supported/,
  );
  await assert.rejects(
    command(host, 'create', { name: 'Host', category: 'football', openingMode: 'forged' }),
    /invalid_opening_mode/,
  );
  await assert.rejects(
    command(host, 'create', { name: 'Host', category: 'music' }),
    /invalid_category/,
  );
});

test('three shared uses remain global; any exhausted person rejects the whole Football move without extra time', async () => {
  let m = await start('familiar');
  for (const id of [cid(102), cid(103), cid(104)]) {
    const r = await command(m.activePlayer, 'submit', {
      matchId: m.id,
      entryId: id,
      expectedVersion: m.state.version,
    });
    assert.equal(r.ok, true);
    m = r.match!;
  }
  assert.deepEqual(m.state.usage, { 'wikidata:Q1001': 3 });
  const denied = await command(m.activePlayer, 'submit', {
    matchId: m.id,
    entryId: cid(105),
    expectedVersion: m.state.version,
  });
  assert.equal(denied.reason, 'exhausted_connector');
  assert.equal(denied.connectors!.length, 2);
  assert.deepEqual(denied.exhausted, ['wikidata:Q1001']);
  assert.deepEqual(denied.match!.state, m.state);
  assert.equal(denied.match!.deadline, m.deadline);
  for (const [entryId, reason] of [
    [cid(101), 'repeated_game'],
    ['tmdb:movie:1', 'unknown_game'],
  ]) {
    const rejected = await command(m.activePlayer, 'submit', {
      matchId: m.id,
      entryId,
      expectedVersion: m.state.version,
    });
    assert.equal(rejected.reason, reason);
    assert.equal(rejected.match!.deadline, m.deadline);
  }
});

test('RLS exposes only published pool options and immutable source data; clients cannot write settings', async () => {
  await db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    assert.deepEqual(
      (await tx.query<{ id: string }>('select id from public.opening_pools')).rows.map((r) => r.id),
      ['football-fixture-pool'],
    );
    const options = (
      await tx.query<{ pool_id: string; entries: number }>(
        'select * from public.opening_pool_options($1)',
        [data.datasetId],
      )
    ).rows;
    assert.equal(options.length, 1);
    assert.equal(Number(options[0]!.entries), 1);
    assert.equal((await tx.query('select * from public.opening_pool_entries')).rows.length, 1);
    assert.equal(
      (
        await tx.query<{ value: unknown[] }>('select public.entry_credit_details($1,$2) value', [
          data.datasetId,
          cid(101),
        ])
      ).rows[0]!.value.length,
      3,
    );
  });
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.exec('update public.game_rooms set opening_pool_id=null');
    }),
    /permission denied/,
  );
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.exec('update public.opening_pools set published=true');
    }),
    /permission denied/,
  );
  await assert.rejects(
    db.query("update public.opening_pools set label='Changed' where id='football-fixture-pool'"),
    /published_opening_pool_immutable/,
  );
  await assert.rejects(
    db.query("delete from public.opening_pool_entries where pool_id='football-fixture-pool'"),
    /published_opening_pool_immutable/,
  );
  const m = await start();
  await assert.rejects(command(await identity(), 'snapshot', { matchId: m.id }), /match_not_found/);
});

test('familiar rooms pin their pool and catalogue across a later publication', async () => {
  const f = await room('football', 'familiar');
  const newer = structuredClone(data);
  newer.datasetId = 'football-synthetic-v2';
  await importFootball(newer);
  await pool('football-fixture-pool-v2', newer.datasetId, [cid(103)]);
  await command(f.guest, 'join', { name: 'Guest', code: f.room.code });
  const m = (await command(f.host, 'start', { roomId: f.room.id })).match!;
  assert.equal(m.catalogueId, data.datasetId);
  assert.equal(m.state.currentGameId, cid(101));
  const next = await start('familiar');
  assert.equal(next.catalogueId, newer.datasetId);
  assert.equal(next.state.currentGameId, cid(103));
});
