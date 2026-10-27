import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeMovie,
  publicationProblems,
  csvRecords,
  CREW_JOBS,
} from "../src/movies/normalize.ts";
import { MOVIE_ROLES } from "../src/movies/types.ts";
import type {
  MovieInput,
  SourceCredit,
  MovieDataset,
} from "../src/movies/types.ts";
import { MovieConnectionEngine } from "../src/movies/engine.ts";
import { openStore, saveRecord } from "../scripts/movies/store.ts";
import { TmdbClient } from "../scripts/movies/tmdb-client.ts";
const credit = (
  id: number,
  job?: string,
  extra: object = {},
): SourceCredit => ({
  id,
  name: `Person ${id}`,
  credit_id: `credit-${id}-${job ?? "cast"}`,
  ...(job ? { job, department: "test" } : {}),
  ...extra,
});
function input(
  id = 1,
  cast: SourceCredit[] = [credit(1)],
  crew: SourceCredit[] = [
    credit(2, "Director"),
    credit(3, "Writer"),
    credit(4, "Original Music Composer"),
    credit(5, "Director of Photography"),
  ],
): MovieInput {
  return {
    metadata: {
      id,
      title: "The Example",
      original_title: "The Example",
      release_date: "2001-01-01",
      status: "Released",
      genres: [],
      production_countries: [],
    },
    credits: { cast, crew },
    source: "synthetic-test-fixture",
    sourceVersion: "1",
    importedAt: "2026-10-21T00:00:00Z",
    payloadSha256: `hash-${id}`,
  };
}
function dataset(
  a = normalizeMovie(input(1)),
  b = normalizeMovie(input(2)),
): MovieDataset {
  return {
    schemaVersion: 1,
    category: "movies",
    datasetId: "test-v1",
    policyVersion: "test",
    eligibleRoles: MOVIE_ROLES,
    entities: Object.fromEntries(
      [...a.people, ...b.people].map((p) => [p.id, p]),
    ),
    movies: [a.movie, b.movie],
  };
}
test("Movies maps precisely five connector types and excludes unrelated jobs", () => {
  assert.deepEqual(MOVIE_ROLES, [
    "actor",
    "director",
    "writer",
    "composer",
    "cinematographer",
  ]);
  const r = normalizeMovie(
    input(
      1,
      [credit(1)],
      [
        ...[
          "Producer",
          "Executive Producer",
          "Editor",
          "Music",
          "Songs",
          "Sound",
          "Characters",
          "Story",
          "Co-Director",
        ].map((job, i) => credit(100 + i, job)),
        credit(2, "Director"),
        credit(3, "Original Music Composer"),
        credit(4, "Director of Photography"),
      ],
    ),
  );
  assert.deepEqual(
    r.movie.credits.director.map((c) => c.entityId),
    ["tmdb:person:2"],
  );
  assert.deepEqual(
    r.movie.credits.composer.map((c) => c.entityId),
    ["tmdb:person:3"],
  );
  assert.deepEqual(
    r.movie.credits.cinematographer.map((c) => c.entityId),
    ["tmdb:person:4"],
  );
  assert.equal(r.movie.credits.writer.length, 0);
  assert.equal(Object.keys(CREW_JOBS).length, 9);
});
for (const job of [
  "Writer",
  "Screenplay",
  "Teleplay",
  "Novel",
  "Book",
  "Short Story",
])
  test(`writer job ${job} is eligible with original metadata`, () => {
    const c = credit(33, job),
      r = normalizeMovie(input(1, [], [c]));
    assert.deepEqual(r.movie.credits.writer[0]?.sourceCredits, [c]);
    const b = normalizeMovie(input(2, [], [credit(33, "Screenplay")]));
    assert.equal(
      new MovieConnectionEngine(dataset(r, b)).sharedConnectors(
        r.movie.id,
        b.movie.id,
      )[0]?.entityId,
      "tmdb:person:33",
    );
  });
for (const role of MOVIE_ROLES)
  test(`${role} creates a movie connection`, () => {
    const full = dataset(),
      trim = structuredClone(full);
    for (const m of trim.movies)
      for (const other of MOVIE_ROLES)
        if (other !== role) m.credits[other] = [];
    const e = new MovieConnectionEngine(trim),
      shared = e.sharedConnectors(trim.movies[0]!.id, trim.movies[1]!.id);
    assert.equal(shared.length, 1);
    assert.deepEqual(shared[0]?.types, [role]);
  });
test("credited voice cast is actor; explicitly uncredited cast is excluded", () => {
  const r = normalizeMovie(
    input(
      1,
      [
        credit(99, undefined, { character: "Hero (voice)" }),
        credit(100, undefined, { character: "Man (uncredited)" }),
      ],
      [],
    ),
  );
  assert.equal(r.movie.credits.actor.length, 1);
  assert.equal(r.movie.credits.actor[0]?.entityId, "tmdb:person:99");
  assert.ok(r.warnings.includes("uncredited_cast_excluded"));
  assert.equal(r.movie.coverage.director.status, "not_observed");
  assert.equal(r.movie.coverage.director.complete, false);
});
test("one actual person across different roles shares one three-use allowance", () => {
  const a = normalizeMovie(input(1, [credit(1)], [credit(1, "Director")])),
    b = normalizeMovie(input(2, [credit(1)], [credit(1, "Writer")]));
  const e = new MovieConnectionEngine(dataset(a, b)),
    v = e.applyMove(e.createMatch(a.movie.id), b.movie.id);
  assert.equal(v.ok, true);
  assert.equal(v.connectors.length, 1);
  assert.deepEqual(v.state.usage, { "tmdb:person:1": 1 });
  assert.deepEqual(v.connectors[0]?.fromTypes, ["actor", "director"]);
  assert.deepEqual(v.connectors[0]?.toTypes, ["actor", "writer"]);
  const cross = new MovieConnectionEngine(
    dataset(
      normalizeMovie(input(1, [], [credit(1, "Director")])),
      normalizeMovie(input(2, [credit(1)], [])),
    ),
  );
  assert.equal(
    cross.sharedConnectors("tmdb:movie:1", "tmdb:movie:2").length,
    1,
  );
});
test("matching names never merge people; duplicate credit records never multiply uses", () => {
  const a = normalizeMovie(
    input(
      1,
      [
        credit(1, undefined, { name: "Alex Smith" }),
        credit(1, undefined, { name: "Alex Smith" }),
      ],
      [],
    ),
  );
  const b = normalizeMovie(
    input(2, [credit(2, undefined, { name: "Alex Smith" })], []),
  );
  assert.equal(a.movie.credits.actor.length, 1);
  assert.equal(a.movie.credits.actor[0]?.sourceCredits.length, 1);
  assert.equal(
    new MovieConnectionEngine(dataset(a, b)).sharedConnectors(
      a.movie.id,
      b.movie.id,
    ).length,
    0,
  );
});
test("malformed and conflicting person identities are quarantined without guesses", () => {
  const r = normalizeMovie(
    input(
      1,
      [
        credit(1, undefined, { credit_id: "collision" }),
        credit(2, undefined, { credit_id: "collision" }),
        credit(0),
      ],
      [],
    ),
  );
  assert.ok(r.errors.includes("ambiguous_credit_identity"));
  assert.ok(r.errors.includes("invalid_person_identity"));
  assert.ok(publicationProblems(r).length);
  assert.throws(
    () => normalizeMovie({ ...input(), metadata: { id: "name-only" } }),
    /invalid_movie_identity/,
  );
});
test("all shared people are consumed, and ANY exhausted person blocks the whole answer", () => {
  const e = new MovieConnectionEngine(dataset()),
    s = e.createMatch("tmdb:movie:1");
  const v = e.applyMove(s, "tmdb:movie:2");
  assert.equal(v.ok, true);
  assert.equal(Object.keys(v.state.usage).length, 5);
  const exhausted = { ...s, usage: { "tmdb:person:1": 3, "tmdb:person:4": 1 } },
    bad = e.applyMove(exhausted, "tmdb:movie:2");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, "exhausted_connector");
  assert.equal(bad.state, exhausted);
  assert.deepEqual(exhausted.history, ["tmdb:movie:1"]);
  assert.equal(exhausted.usage["tmdb:person:4"], 1);
});
test("no repeats, version mixing, forged state or cross-category answers", () => {
  const e = new MovieConnectionEngine(dataset()),
    s = e.createMatch("tmdb:movie:1");
  for (const [state, target, reason] of [
    [s, s.currentGameId, "repeated_game"],
    [{ ...s, datasetId: "new" }, "tmdb:movie:2", "dataset_mismatch"],
    [{ ...s, version: 1 }, "tmdb:movie:2", "invalid_state"],
    [s, "portal", "unknown_game"],
  ] as const) {
    const r = e.validateMove(state, target);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, reason);
  }
});
test("CSV parser preserves quoted JSON, embedded commas, quotes and newlines", () => {
  const rows = [
    ...csvRecords(
      'id,title,cast\r\n1,"A, B","[{""id"":1}]"\r\n2,"Two\nLines",[]\r\n',
    ),
  ];
  assert.equal(rows[0]?.["title"], "A, B");
  assert.equal(rows[0]?.["cast"], '[{"id":1}]');
  assert.equal(rows[1]?.["title"], "Two\nLines");
  assert.throws(() => [...csvRecords('a,b\n"unfinished')], /unterminated/);
});
test("incremental research store resumes by hash; imported validation never publishes implicitly", () => {
  const dir = mkdtempSync(join(tmpdir(), "last-link-movies-"));
  const db = openStore(join(dir, "test.sqlite"));
  try {
    assert.equal(saveRecord(db, input()).skipped, false);
    assert.equal(saveRecord(db, input()).skipped, true);
    assert.equal(
      db.prepare("select count(*) n from imported_movies").get()?.["n"],
      1,
    );
    assert.equal(
      db.prepare("select count(*) n from publications").get()?.["n"],
      0,
    );
    assert.equal(
      saveRecord(db, { ...input(), payloadSha256: "changed" }).skipped,
      false,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("TMDB client honors 429, caches success and never persists the bearer token", async () => {
  const db = openStore(":memory:"),
    delays: number[] = [],
    token = "private-fixture-token";
  let calls = 0;
  const api = new TmdbClient(
    db,
    token,
    async (_u, o) => {
      assert.equal(o.headers["Authorization"], `Bearer ${token}`);
      calls++;
      return {
        ok: calls > 1,
        status: calls === 1 ? 429 : 200,
        headers: { get: () => "1" },
        json: async () => ({ id: 1 }),
      };
    },
    async (ms) => {
      delays.push(ms);
    },
  );
  try {
    assert.deepEqual(await api.get("/movie/1"), { id: 1 });
    assert.deepEqual(await api.get("/movie/1"), { id: 1 });
    assert.equal(calls, 2);
    assert.ok(delays.includes(1000));
    assert.ok(
      !JSON.stringify(db.prepare("select * from request_cache").all()).includes(
        token,
      ),
    );
  } finally {
    db.close();
  }
});
test("shipped publication has thousands of real source IDs and stable independent titles", () => {
  const root = new URL("../", import.meta.url),
    d = JSON.parse(
      readFileSync(
        new URL(
          "data/movies/published/movies-tmdb-2017-v1/catalogue.json",
          root,
        ),
        "utf8",
      ),
    ) as MovieDataset;
  assert.equal(d.movies.length, 3505);
  assert.equal(new Set(d.movies.map((m) => m.id)).size, 3505);
  for (const m of d.movies) {
    assert.ok(
      m.credits.actor.length &&
        m.credits.director.length &&
        m.credits.writer.length,
    );
    assert.ok(m.credits.composer.length || m.credits.cinematographer.length);
    for (const role of MOVIE_ROLES)
      for (const c of m.credits[role]) assert.ok(d.entities[c.entityId]);
  }
  const e = new MovieConnectionEngine(d),
    components = e.connectedComponents();
  assert.equal(components[0]?.length, 3479);
  assert.equal(
    d.movies.filter((m) => m.title === "The Avengers").length >= 1,
    true,
  );
});
