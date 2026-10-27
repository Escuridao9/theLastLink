import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ConnectionEngine } from "../src/engine.ts";
import { MovieConnectionEngine } from "../src/movies/engine.ts";
import {
  REVIEW_STATE,
  REVIEW_TURNS,
} from "../web/src/app/design-review/fixture.ts";
import { GAMES_REVIEW } from "../web/src/app/design-review/games-fixture.ts";

test("both visual match histories and every preview receipt replay through the unchanged engines", () => {
  const games = JSON.parse(
    readFileSync(
      new URL("../web/public/catalogue-v1.json", import.meta.url),
      "utf8",
    ),
  );
  const movies = JSON.parse(
    readFileSync(
      new URL(
        "../data/movies/published/movies-tmdb-2017-v1/catalogue.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const receipts = JSON.parse(
    readFileSync(
      new URL(
        "../web/public/design-review/move-receipts.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const [category, data, engine, fixture] of [
    ["games", games, new ConnectionEngine(games), GAMES_REVIEW],
    [
      "movies",
      movies,
      new MovieConnectionEngine(movies),
      { state: REVIEW_STATE, turns: REVIEW_TURNS },
    ],
  ] as const) {
    let state = engine.createMatch(fixture.state.history[0]!) as any;
    for (const turn of fixture.turns.slice(1)) {
      const result = engine.applyMove(state as never, turn.entryId);
      assert.equal(result.ok, true, `${category} turn ${turn.index}`);
      state = result.state;
      assert.deepEqual(
        result.connectors,
        turn.connectors.map(({ name, ...rest }: any) => rest),
      );
    }
    assert.deepEqual(state, fixture.state);
    const entries = data.games ?? data.movies;
    assert.equal(Object.keys(receipts[category].moves).length, entries.length);
    assert.equal(receipts[category].version, state.version);
    for (const entry of entries) {
      const expected: any = engine.applyMove(state as never, entry.id);
      const actual = receipts[category].moves[entry.id];
      assert.equal(actual.ok, expected.ok, entry.id);
      if (expected.ok) assert.deepEqual(actual.state, expected.state);
      else {
        assert.equal(actual.reason, expected.reason);
        assert.deepEqual(actual.exhausted, expected.exhausted);
      }
      assert.deepEqual(
        actual.connectors.map(({ name, ...rest }: any) => rest),
        expected.connectors,
      );
      for (const connector of actual.connectors)
        assert.equal(connector.name, data.entities[connector.entityId].name);
    }
  }
});
