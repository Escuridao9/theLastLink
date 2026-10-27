import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { MovieConnectionEngine } from "../src/movies/engine.ts";
import { ConnectionEngine } from "../src/engine.ts";
import type {
  MovieDataset,
  MovieMatchState,
  MovieConnector,
  MovieRole,
} from "../src/movies/types.ts";
import { MOVIE_ROLES } from "../src/movies/types.ts";
import type { Dataset, MatchState } from "../src/types.ts";
const root = new URL("../", import.meta.url),
  db = new PGlite();
const full = JSON.parse(
  readFileSync(
    new URL("data/movies/published/movies-tmdb-2017-v1/catalogue.json", root),
    "utf8",
  ),
) as MovieDataset;
// Real source-backed films plus clearly marked synthetic fixtures for rare edge cases.
const data: MovieDataset = {
  ...full,
  datasetId: "movies-sql-test-v1",
  movies: full.movies.slice(0, 35),
  entities: { ...full.entities },
};
for (let i = 0; i < 8; i++) {
  const template = structuredClone(full.movies[0]!);
  template.id = `tmdb:movie:${900000 + i}`;
  template.title = `Synthetic rule fixture ${i}`;
  for (const role of MOVIE_ROLES) template.credits[role] = [];
  const role: MOVIE_ROLES_TYPE = MOVIE_ROLES[i % 5]!;
  template.credits[role] = [
    {
      entityId: "tmdb:person:9990001",
      sourceCredits: [
        { id: 9990001, name: "Synthetic Person", credit_id: `fixture-${i}` },
      ],
    },
  ];
  if (i === 0)
    template.credits.director = structuredClone(template.credits[role]);
  data.movies.push(template);
}
type MOVIE_ROLES_TYPE = MovieRole;
data.entities["tmdb:person:9990001"] = {
  id: "tmdb:person:9990001",
  name: "Synthetic Person",
  aliases: [],
  externalIds: { tmdb: 9990001 },
};
// The user's critical actor-at-three / composer-at-one example, on the SQL path.
data.entities["tmdb:person:9990002"] = {
  id: "tmdb:person:9990002",
  name: "Synthetic Composer",
  aliases: [],
  externalIds: { tmdb: 9990002 },
};
for (const id of [990101, 990102]) {
  const m = structuredClone(full.movies[0]!);
  m.id = `tmdb:movie:${id}`;
  m.title = `Synthetic critical example ${id}`;
  for (const role of MOVIE_ROLES) m.credits[role] = [];
  m.credits.actor = [
    {
      entityId: "tmdb:person:9990001",
      sourceCredits: [
        { id: 9990001, name: "Synthetic Actor", credit_id: `actor-${id}` },
      ],
    },
  ];
  m.credits.composer = [
    {
      entityId: "tmdb:person:9990002",
      sourceCredits: [
        {
          id: 9990002,
          name: "Synthetic Composer",
          credit_id: `composer-${id}`,
          job: "Original Music Composer",
        },
      ],
    },
  ];
  data.movies.push(m);
}
const engine = new MovieConnectionEngine(data);
const games = JSON.parse(
    readFileSync(new URL("data/playable/catalogue-v1.json", root), "utf8"),
  ) as Dataset,
  gameEngine = new ConnectionEngine(games);
type M = {
  id: string;
  category: "games" | "movies";
  catalogueId: string;
  status: string;
  activePlayer: string;
  deadline: string;
  state: MovieMatchState | MatchState;
  room: { id: string; category: string; players: { id: string }[] };
  turns: { acceptedAt: string; connectors: MovieConnector[] }[];
};
type Reply = {
  ok: boolean;
  reason?: string;
  match?: M;
  room?: { id: string; code: string; category: string };
  connectors?: MovieConnector[];
  duplicate: boolean;
};
async function command(
  uid: string,
  action: string,
  payload: object,
  requestId = randomUUID(),
): Promise<Reply> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    return (
      await tx.query<{ reply: Reply }>(
        "select public.game_command($1,$2::jsonb,$3) reply",
        [action, JSON.stringify(payload), requestId],
      )
    ).rows[0]!.reply;
  });
}
async function importMovies(d: MovieDataset): Promise<void> {
  await db.query(
    "insert into public.catalogues(id,category_id,sha256,snapshot) values($1,'movies','synthetic-test-hash',$2)",
    [d.datasetId, JSON.stringify(d)],
  );
  for (const m of d.movies) {
    await db.query("insert into public.entries values($1,$2,$3,$4,$5,$6)", [
      d.datasetId,
      m.id,
      m.title,
      m.releaseYear,
      JSON.stringify(m.externalIds),
      true,
    ]);
    for (const role of MOVIE_ROLES)
      for (const c of m.credits[role]) {
        const p = d.entities[c.entityId]!;
        await db.query(
          "insert into public.connector_entities values($1,$2,$3) on conflict do nothing",
          [p.id, p.name, JSON.stringify(p.externalIds)],
        );
        await db.query(
          "insert into public.entry_credits values($1,$2,$3,$4,$5)",
          [
            d.datasetId,
            m.id,
            c.entityId,
            role,
            JSON.stringify({
              personName: p.name,
              sourceCredits: c.sourceCredits,
            }),
          ],
        );
      }
  }
  await db.query("update public.catalogues set published=true where id=$1", [
    d.datasetId,
  ]);
}
async function fresh(category: "games" | "movies" = "movies"): Promise<M> {
  const host = randomUUID(),
    guest = randomUUID();
  await db.query("insert into auth.users values($1),($2)", [host, guest]);
  const room = (await command(host, "create", { name: "Host", category }))
    .room!;
  assert.equal(room.category ?? "games", category);
  const joined = (
    await command(guest, "join", {
      name: "Guest",
      code: room.code,
      category: category === "movies" ? "games" : "movies",
    })
  ).room!;
  assert.equal(
    joined.category ?? "games",
    category,
    "joining cannot switch the host category",
  );
  return (await command(host, "start", { roomId: room.id })).match!;
}
async function setState(m: M, state: MovieMatchState | MatchState): Promise<M> {
  await db.query(
    "update public.matches set state=$2,deadline=clock_timestamp()+interval '20 seconds' where id=$1",
    [m.id, JSON.stringify(state)],
  );
  await db.query("delete from public.connector_usage where match_id=$1", [
    m.id,
  ]);
  for (const [id, n] of Object.entries(state.usage))
    await db.query("insert into public.connector_usage values($1,$2,$3)", [
      m.id,
      id,
      n,
    ]);
  await db.query("delete from public.turn_history where match_id=$1", [m.id]);
  for (const [index, id] of state.history.entries())
    await db.query(
      "insert into public.turn_history values($1,$2,null,$3,'[]',clock_timestamp())",
      [m.id, index, id],
    );
  return (await command(m.activePlayer, "snapshot", { matchId: m.id })).match!;
}
before(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(
    readFileSync(
      new URL("supabase/migrations/20261027140000_game.sql", root),
      "utf8",
    ),
  );
  await db.exec(readFileSync(new URL("supabase/seed.sql", root), "utf8"));
  // An existing Games room/match exists before the additive upgrade.
  const old = await fresh("games");
  await db.query(
    "update public.matches set deadline=clock_timestamp()+interval '1 hour' where id=$1",
    [old.id],
  );
  await db.exec(
    readFileSync(
      new URL("supabase/migrations/20261027140200_movies.sql", root),
      "utf8",
    ),
  );
  const row = await db.query<{ category_id: string; state: MatchState }>(
    "select category_id,state from public.matches where id=$1",
    [old.id],
  );
  assert.equal(row.rows[0]!.category_id, "games");
  assert.deepEqual(row.rows[0]!.state, old.state);
  await importMovies(data);
});
after(async () => {
  await db.close();
});

test("upgrade preserves a pre-existing Games match and serves independent categories", async () => {
  for (const category of ["games", "movies"] as const) {
    const m = await fresh(category);
    assert.equal(m.category, category);
    assert.equal(m.state.category, category);
    assert.equal(m.room.category, category);
  }
});
test("server indexed intersections equal the movie engine, including different endpoint roles", async () => {
  for (const from of data.movies)
    for (const to of data.movies)
      if (from.id < to.id) {
        const r = await db.query<{ shared: MovieConnector[] | null }>(
          "select game_private.shared_connectors($1,$2,$3) shared",
          [data.datasetId, from.id, to.id],
        );
        const actual = (r.rows[0]!.shared ?? []).map(({ name, ...c }) => c);
        assert.deepEqual(actual, engine.sharedConnectors(from.id, to.id));
      }
});
for (const role of MOVIE_ROLES)
  test(`server accepts ${role}, consumes a person once and gives exactly 20 seconds`, async () => {
    let m = await fresh(),
      index = MOVIE_ROLES.indexOf(role);
    m = await setState(m, engine.createMatch(`tmdb:movie:${900000 + index}`));
    const r = await command(m.activePlayer, "submit", {
      matchId: m.id,
      entryId: `tmdb:movie:${900000 + ((index + 1) % 5)}`,
      expectedVersion: 0,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.match!.state.usage, { "tmdb:person:9990001": 1 });
    assert.notEqual(r.match!.activePlayer, m.activePlayer);
    assert.equal(
      Date.parse(r.match!.deadline) -
        Date.parse(r.match!.turns.at(-1)!.acceptedAt),
      20000,
    );
    assert.ok(r.connectors?.[0]?.fromTypes.includes(role));
  });
test("server rejects a move when ANY shared person is exhausted even if others remain", async () => {
  let m = await fresh();
  const edge = { from: "tmdb:movie:990101", to: "tmdb:movie:990102" };
  const usage = { "tmdb:person:9990001": 3, "tmdb:person:9990002": 1 };
  m = await setState(m, { ...engine.createMatch(edge.from), usage });
  const r = await command(m.activePlayer, "submit", {
    matchId: m.id,
    entryId: edge.to,
    expectedVersion: 0,
  });
  assert.equal(r.reason, "exhausted_connector");
  assert.deepEqual(r.match!.state, m.state);
  assert.equal(r.match!.deadline, m.deadline);
});
test("server consumes ALL shared people and rejects repeated, stale, duplicate and cross-category moves safely", async () => {
  let m = await fresh();
  m = await setState(m, engine.createMatch(data.movies[0]!.id));
  const target = engine.availableMoves(m.state as MovieMatchState)[0]!,
    expected = engine.applyMove(m.state as MovieMatchState, target),
    id = randomUUID();
  const payload = { matchId: m.id, entryId: target, expectedVersion: 0 };
  const first = await command(m.activePlayer, "submit", payload, id),
    again = await command(m.activePlayer, "submit", payload, id);
  assert.equal(first.ok, true);
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.match, first.match);
  assert.deepEqual(first.match!.state, expected.state);
  for (const [entryId, version, reason] of [
    [games.games[0]!.id, 1, "unknown_game"],
    [target, 1, "repeated_game"],
    [data.movies[2]!.id, 0, "stale_version"],
  ] as const) {
    const r = await command(first.match!.activePlayer, "submit", {
      matchId: m.id,
      entryId,
      expectedVersion: version,
    });
    assert.equal(r.reason, reason);
    assert.deepEqual(r.match!.state, first.match!.state);
    assert.equal(r.match!.deadline, first.match!.deadline);
  }
});
test("Games intersections and complete legal chains remain unchanged under the upgraded server", async () => {
  for (let trial = 0; trial < 10; trial++) {
    let m = await fresh("games");
    for (let n = 0; n < 40; n++) {
      const moves = gameEngine.availableMoves(m.state as MatchState);
      if (!moves.length) break;
      const target = moves[(trial + n) % moves.length]!,
        expected = gameEngine.applyMove(m.state as MatchState, target);
      const r = await command(m.activePlayer, "submit", {
        matchId: m.id,
        entryId: target,
        expectedVersion: m.state.version,
      });
      assert.equal(r.ok, true);
      assert.deepEqual(r.match!.state, expected.state);
      m = r.match!;
    }
  }
});
test("Movies expire server-side with no extra life or state mutation", async () => {
  const m = await fresh();
  await db.query(
    "update public.matches set deadline=clock_timestamp()-interval '1 second' where id=$1",
    [m.id],
  );
  await db.exec("select public.expire_due_matches()");
  const r = await command(m.activePlayer, "snapshot", { matchId: m.id });
  assert.equal(r.match!.status, "finished");
  assert.deepEqual(r.match!.state, m.state);
});
test("published versions stay frozen; a newer catalogue never changes an active match", async () => {
  const m = await fresh();
  await assert.rejects(
    db.query("delete from public.entry_credits where catalogue_id=$1", [
      data.datasetId,
    ]),
    /published_catalogue_immutable/,
  );
  const newer = { ...data, datasetId: "movies-sql-test-v2" };
  await importMovies(newer);
  await db.query(
    "update public.catalogues set created_at=created_at where id='not-a-catalogue'",
  );
  const current = await command(m.activePlayer, "snapshot", { matchId: m.id });
  assert.equal(current.match!.catalogueId, data.datasetId);
  assert.equal((await fresh()).catalogueId, newer.datasetId);
});
test("category integrity, RLS and person IDs block invalid or unprivileged imports", async () => {
  await db.query(
    "insert into public.catalogues values('draft','movies',false,'x','{}',clock_timestamp())",
  );
  await db.query(
    "insert into public.entries values('draft','draft-film','Draft',2000,'{}',false)",
  );
  await assert.rejects(
    db.query(
      "insert into public.entry_credits values('draft','draft-film','tmdb:person:9990001','character','{}')",
    ),
    /credit_role_wrong_category/,
  );
  await db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    assert.equal(
      (await tx.query("select id from public.catalogues where id='draft'")).rows
        .length,
      0,
    );
    await assert.rejects(
      tx.exec("insert into public.categories values('music','Music','{}')"),
      /permission denied/,
    );
  });
});
