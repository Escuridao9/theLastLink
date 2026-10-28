import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeFootball } from '../src/football/normalize.ts';
import { FootballConnectionEngine } from '../src/football/engine.ts';
import type { FootballDataset } from '../src/football/types.ts';
import { career, observation, footballFixture } from './football-fixtures.ts';
const cid = (n: number) => `wikidata:club:Q${n}`;
const person = 'wikidata:Q1001';

test('Football normalizer preserves canonical people, historical spells, dates and reference provenance', () => {
  const row = career('Q1001', 'Q101', {
    start: '2012-01-01T00:00:00Z',
    startPrecision: '9',
    end: '2018-06-01T00:00:00Z',
    endPrecision: '10',
    reference: 'http://www.wikidata.org/reference/abc123',
  });
  const normalized = normalizeFootball(
    observation([row, row, { ...row, reference: 'http://www.wikidata.org/reference/def456' }]),
    'test-v1',
  );
  const credit = normalized.dataset.clubs[0]!.credits.player[0]!;
  assert.equal(credit.entityId, person);
  assert.equal(credit.sourceCredits.length, 1);
  assert.deepEqual(credit.sourceCredits[0]!.references, ['abc123', 'def456']);
  assert.equal(credit.sourceCredits[0]!.start, '2012');
  assert.equal(credit.sourceCredits[0]!.end, '2018-06');
  assert.equal(credit.sourceCredits[0]!.appearances, 12);
  assert.equal(normalized.audit.acceptedClaims, 1);
  assert.equal(normalized.audit.complete, false);
  assert.equal(
    normalized.dataset.entities[person]!.sourceUrl,
    'https://www.wikidata.org/wiki/Q1001',
  );
});

test('unconfirmed humans, unknown or zero appearances and ineligible team-role claims are quarantined', () => {
  const cases = [
    [{ humanConfirmed: false }, 'unverified_human_identity'],
    [{}, 'unknown_senior_appearances'],
    [{ appearances: '0' }, 'zero_or_invalid_appearances'],
    [{ occupationRoot: 'Q5' }, 'unverified_football_player_role'],
    [{ role: 'http://www.wikidata.org/entity/Q9999' }, 'unsupported_player_role_qualifier'],
    [{ club: 'http://www.wikidata.org/entity/Q9999' }, 'invalid_or_out_of_scope_identity'],
    [{ rank: 'deprecated' }, 'deprecated_claim'],
    [{ start: '2027-01-01T00:00:00Z', startPrecision: '9' }, 'future_appointment'],
    [{ start: '2018-01-01T00:00:00Z', end: '2012-01-01T00:00:00Z' }, 'conflicting_career_dates'],
  ] as const;
  for (const [extra, reason] of cases) {
    const row = { ...career(), ...extra };
    if (reason === 'unknown_senior_appearances') delete row.appearances;
    const result = normalizeFootball(observation([row]), 'test-v1');
    assert.equal(result.audit.playerCredits, 0, reason);
    assert.equal(result.quarantine[0]!.reason, reason);
  }
});

test('only head-manager appointments qualify; caretaker qualifies, broad coach and director do not', () => {
  const manager = career('Q1001', 'Q101', {
    property: 'P286',
    occupationRoot: 'Q628099',
    role: 'http://www.wikidata.org/entity/Q1050607',
  });
  assert.equal(normalizeFootball(observation([manager]), 'test-v1').audit.managerCredits, 1);
  for (const row of [
    { ...manager, property: 'P6087' },
    { ...manager, role: 'http://www.wikidata.org/entity/Q9999' },
  ]) {
    const result = normalizeFootball(observation([row]), 'test-v1');
    assert.equal(result.audit.managerCredits, 0);
    assert.equal(result.quarantine.length, 1);
  }
});

test('a person connects different roles with one shared allowance and same names never merge', () => {
  const engine = new FootballConnectionEngine(footballFixture());
  assert.deepEqual(engine.sharedConnectors(cid(101), cid(102)), [
    {
      entityId: person,
      types: ['manager', 'player'],
      fromTypes: ['manager', 'player'],
      toTypes: ['manager'],
    },
  ]);
  assert.equal(engine.sharedConnectors(cid(101), cid(106)).length, 0);
  const next = engine.applyMove(engine.createMatch(cid(101)), cid(102));
  assert.equal(next.ok, true);
  assert.deepEqual(next.state.usage, { [person]: 1 });
});

test('third use is accepted; any exhausted person rejects every shared connector atomically', () => {
  const engine = new FootballConnectionEngine(footballFixture());
  const state = engine.replay([cid(101), cid(102), cid(103), cid(104)]);
  assert.equal(state.usage[person], 3);
  const before = structuredClone(state),
    rejected = engine.applyMove(state, cid(105));
  assert.equal(rejected.ok, false);
  if (rejected.ok) throw Error('expected rejection');
  assert.equal(rejected.reason, 'exhausted_connector');
  assert.deepEqual(rejected.exhausted, [person]);
  assert.equal(rejected.connectors.length, 2);
  assert.equal(rejected.state, state);
  assert.deepEqual(state, before);
  assert.ok(!engine.availableMoves(state).includes(cid(105)));
  assert.throws(
    () => engine.replay([...state.history, cid(105)]),
    /illegal_recorded_move:exhausted_connector/,
  );
});

test('Football rejects repeats, version mixing, wrong categories and malformed counters', () => {
  const data = footballFixture(),
    engine = new FootballConnectionEngine(data),
    state = engine.createMatch(cid(101));
  for (const [s, target, version, reason] of [
    [state, cid(101), 0, 'repeated_game'],
    [state, cid(102), 1, 'stale_version'],
    [{ ...state, datasetId: 'other' }, cid(102), 0, 'dataset_mismatch'],
    [{ ...state, category: 'movies' }, cid(102), 0, 'invalid_state'],
    [{ ...state, usage: { [person]: 4 } }, cid(102), 0, 'invalid_state'],
    [state, 'tmdb:movie:1', 0, 'unknown_game'],
  ] as const) {
    const result = engine.validateMove(s as typeof state, target, version);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, reason);
  }
  data.clubs[0]!.credits.player.length = 0;
  assert.equal(engine.sharedConnectors(cid(101), cid(102)).length, 1, 'engine owns its index');
});

test('frozen Football publication and both familiar pools contain only real, playable canonical entries', () => {
  const base = new URL('../', import.meta.url);
  const bytes = readFileSync(
    new URL('data/football/published/football-clubs-2026-10-28-v1/catalogue.json', base),
  );
  const data: FootballDataset = JSON.parse(bytes.toString());
  const manifest = JSON.parse(
    readFileSync(
      new URL('data/football/published/football-clubs-2026-10-28-v1/manifest.json', base),
      'utf8',
    ),
  );
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.equal(data.clubs.length, 90);
  assert.equal(Object.keys(data.entities).length, 22974);
  assert.equal(
    data.clubs.reduce((n, c) => n + c.credits.player.length + c.credits.manager.length, 0),
    31286,
  );
  assert.equal(new Set(data.clubs.map((c) => c.region)).size, 6);
  assert.equal(data.sourceLicense, 'CC0-1.0');
  assert.equal(manifest.complete, false);
  const engine = new FootballConnectionEngine(data);
  assert.deepEqual(
    engine.connectedComponents().map((c) => c.length),
    [90],
  );
  for (const club of data.clubs) {
    assert.match(club.id, /^wikidata:club:Q\d+$/);
    assert.doesNotMatch(club.title, /national team|under.?\d+|reserves/i);
    for (const credit of club.credits.player)
      for (const evidence of credit.sourceCredits) assert.ok(evidence.appearances! > 0);
    for (const credit of club.credits.manager)
      for (const evidence of credit.sourceCredits) assert.equal(evidence.property, 'P286');
  }
  const footballPool = JSON.parse(
    readFileSync(new URL('data/openers/football-familiar-v1.json', base), 'utf8'),
  );
  assert.equal(footballPool.entries.length, 27);
  for (const entry of footballPool.entries)
    assert.ok(engine.availableMoves(engine.createMatch(entry.id)).length > 0);
  const moviesPool = JSON.parse(
    readFileSync(new URL('data/openers/movies-familiar-v1.json', base), 'utf8'),
  );
  assert.equal(moviesPool.entries.length, 55);
  const movies = JSON.parse(
    readFileSync(new URL('data/movies/published/movies-tmdb-2017-v1/catalogue.json', base), 'utf8'),
  );
  for (const entry of moviesPool.entries)
    assert.ok(
      movies.movies.some(
        (m: { id: string; title: string }) => m.id === entry.id && m.title === entry.title,
      ),
    );
});
