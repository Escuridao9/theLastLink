import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConnectionEngine } from '../src/engine.ts';
import { MovieConnectionEngine } from '../src/movies/engine.ts';
import { FootballConnectionEngine } from '../src/football/engine.ts';

test('every fresh-round preview seed and answer receipt follows the published category engine', () => {
  const root = new URL('../', import.meta.url);
  const fixtures = JSON.parse(
    readFileSync(new URL('web/public/design-review/rematch-fixtures.json', root), 'utf8'),
  );
  const games = JSON.parse(readFileSync(new URL('data/playable/catalogue-v1.json', root), 'utf8'));
  const movies = JSON.parse(
    readFileSync(new URL('data/movies/published/movies-tmdb-2017-v1/catalogue.json', root), 'utf8'),
  );
  const football = JSON.parse(
    readFileSync(
      new URL('data/football/published/football-clubs-2026-10-28-v1/catalogue.json', root),
      'utf8',
    ),
  );
  for (const [category, data, engine] of [
    ['games', games, new ConnectionEngine(games)],
    ['movies', movies, new MovieConnectionEngine(movies)],
    ['football', football, new FootballConnectionEngine(football)],
  ] as const) {
    assert.equal(fixtures[category].length, 2);
    assert.notEqual(fixtures[category][0].state.history[0], fixtures[category][1].state.history[0]);
    for (const fixture of fixtures[category]) {
      assert.equal(fixture.state.version, 0);
      assert.equal(fixture.state.history.length, 1);
      assert.deepEqual(fixture.state.usage, {});
      assert.deepEqual(engine.replay(fixture.state.history), fixture.state);
      assert.ok(engine.availableMoves(fixture.state as never).length > 0);
      assert.equal(Object.keys(fixture.moves).length, engine.gameIds().length);
      for (const id of engine.gameIds()) {
        const expected = engine.applyMove(fixture.state as never, id),
          actual = fixture.moves[id];
        assert.equal(actual.ok, expected.ok, id);
        assert.deepEqual(actual.state, expected.state, id);
        if (!expected.ok) {
          assert.equal(actual.reason, expected.reason, id);
          assert.deepEqual(actual.exhausted, expected.exhausted, id);
        }
        assert.deepEqual(
          actual.connectors.map(({ name, ...c }: any) => c),
          expected.connectors,
          id,
        );
        for (const connector of actual.connectors)
          assert.equal(connector.name, data.entities[connector.entityId].name);
      }
      if (category !== 'games') {
        const pool = JSON.parse(
          readFileSync(new URL(`data/openers/${category}-familiar-v1.json`, root), 'utf8'),
        );
        assert.ok(pool.entries.some((e: { id: string }) => e.id === fixture.state.history[0]));
      }
    }
  }
});
