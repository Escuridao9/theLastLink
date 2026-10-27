import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionEngine } from "../src/engine.ts";
import { runChain } from "../src/simulation.ts";
import { fixture, game } from "./fixtures.ts";
import type { MatchState } from "../src/types.ts";
import { catalogueReadiness } from "../src/readiness.ts";

test("valid move consumes every shared relationship across all four types", () => {
  const credits = { developer: ["studio"], composer: ["composer"], voiceActor: ["voice"], character: ["hero"] };
  const e = new ConnectionEngine(fixture([game("a", credits), game("b", credits)]));
  const state = e.createMatch("a");
  const result = e.applyMove(state, "b");
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.usage, { composer: 1, hero: 1, studio: 1, voice: 1 });
  assert.equal(result.connectors.length, 4);
  assert.deepEqual(state.usage, {});
  assert.deepEqual(state.history, ["a"]);
});

test("three uses are shared between alternating players; the fourth is rejected", () => {
  const e = new ConnectionEngine(fixture(["a", "b", "c", "d", "e"].map(id => game(id, { developer: ["studio"] }))));
  let state = e.createMatch("a");
  for (const id of ["b", "c", "d"]) {
    const result = e.applyMove(state, id);
    assert.equal(result.ok, true);
    state = result.state;
  }
  assert.equal(state.usage.studio, 3);
  const result = e.applyMove(state, "e");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "exhausted_connector");
  assert.equal(result.state, state);
});

test("an unused shared composer cannot bypass an exhausted shared developer", () => {
  const e = new ConnectionEngine(fixture([
    game("a", { developer: ["studio"] }), game("b", { developer: ["studio"] }),
    game("c", { developer: ["studio"] }),
    game("d", { developer: ["studio"], composer: ["music"] }),
    game("e", { developer: ["studio"], composer: ["music"] }),
  ]));
  const state = e.replay(["a", "b", "c", "d"]);
  const before = JSON.stringify(state);
  const result = e.applyMove(state, "e");
  assert.equal(result.ok, false);
  assert.equal(result.connectors.length, 2);
  if (!result.ok) assert.deepEqual(result.exhausted, ["studio"]);
  assert.equal(JSON.stringify(state), before);
  assert.equal(result.state.usage.music, undefined);
});

test("a third simultaneous use is accepted and all counters then become three", () => {
  const e = new ConnectionEngine(fixture(["a", "b", "c", "d"].map(id => game(id, {
    developer: ["studio"], composer: ["music"], character: ["hero"],
  }))));
  const state = e.replay(["a", "b", "c", "d"]);
  assert.deepEqual(state.usage, { hero: 3, music: 3, studio: 3 });
});

test("all exhausted connectors are returned and rejection is atomic", () => {
  const e = new ConnectionEngine(fixture(["a", "b", "c", "d", "e"].map(id => game(id, {
    developer: ["studio"], composer: ["music"],
  }))));
  const state = e.replay(["a", "b", "c", "d"]);
  const result = e.applyMove(state, "e");
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.exhausted, ["music", "studio"]);
  assert.equal(result.state, state);
});

test("seed and every earlier entry are prohibited repeats", () => {
  const e = new ConnectionEngine(fixture([game("a", { developer: ["s"] }), game("b", { developer: ["s"] })]));
  const state = e.replay(["a", "b"]);
  for (const id of ["a", "b"]) {
    const result = e.applyMove(state, id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "repeated_game");
    assert.equal(result.state, state);
  }
});

test("no shared connector and unknown game are separate rejections", () => {
  const e = new ConnectionEngine(fixture([game("a", { composer: ["x"] }), game("b", { composer: ["y"] })]));
  const state = e.createMatch("a");
  for (const [id, reason] of [["b", "no_shared_connector"], ["unknown", "unknown_game"]]) {
    const result = e.applyMove(state, id!);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, reason);
    assert.deepEqual(state.usage, {});
  }
});

test("duplicate source statements consume one use, not two", () => {
  const e = new ConnectionEngine(fixture([game("a", { developer: ["x", "x"] }), game("b", { developer: ["x", "x"] })]));
  const result = e.applyMove(e.createMatch("a"), "b");
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.usage, { x: 1 });
});

test("same canonical person in two shared roles consumes one entity use", () => {
  const e = new ConnectionEngine(fixture(["a", "b"].map(id => game(id, { developer: ["person"], composer: ["person"] }))));
  const result = e.applyMove(e.createMatch("a"), "b");
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.usage, { person: 1 });
  assert.deepEqual(result.connectors, [{ entityId: "person", types: ["developer", "composer"] }]);
});

test("a composer in one game and voice actor in another do not create a same-role bridge", () => {
  const e = new ConnectionEngine(fixture([game("a", { composer: ["person"] }), game("b", { voiceActor: ["person"] })]));
  assert.deepEqual(e.sharedConnectors("a", "b"), []);
});

test("display names never merge different canonical identities", () => {
  const d = fixture([game("a", { character: ["hero-a"] }), game("b", { character: ["hero-b"] })]);
  d.entities["hero-a"]!.name = "Alex";
  d.entities["hero-b"]!.name = "Alex";
  assert.deepEqual(new ConnectionEngine(d).sharedConnectors("a", "b"), []);
});

test("available moves exclude repeats and counter-blocked neighbors", () => {
  const e = new ConnectionEngine(fixture([
    ...["a", "b", "c"].map(id => game(id, { developer: ["s"] })),
    game("d", { developer: ["s"], composer: ["m"] }), game("e", { developer: ["s"] }),
    game("f", { composer: ["m"] }),
  ]));
  const state = e.replay(["a", "b", "c", "d"]);
  assert.deepEqual(e.availableMoves(state), ["f"]);
  assert.equal(e.isDeadEnd(state), false);
  assert.equal(e.isDeadEnd(e.replay(["a", "b", "c", "d", "f"])), true);
});

test("a deliberate zero-reply trap is accepted", () => {
  const e = new ConnectionEngine(fixture([game("a", { developer: ["s"] }), game("b", { developer: ["s"] }), game("isolated")]));
  const result = e.applyMove(e.createMatch("a"), "b");
  assert.equal(result.ok, true);
  assert.equal(e.isDeadEnd(result.state), true);
});

test("structural components include isolates and shortest paths are symmetric", () => {
  const e = new ConnectionEngine(fixture([
    game("a", { developer: ["s"] }), game("b", { developer: ["s"], composer: ["m"] }),
    game("c", { composer: ["m"] }), game("d"),
  ]));
  assert.deepEqual(e.connectedComponents().map(c => c.length), [3, 1]);
  assert.deepEqual(e.shortestStaticPath("a", "c"), ["a", "b", "c"]);
  assert.equal(e.shortestStaticPath("a", "d"), null);
  assert.deepEqual(e.findLegalPath(e.createMatch("a"), "c").path, ["b", "c"]);
});

test("a static path can exist while the legal state has no path", () => {
  const e = new ConnectionEngine(fixture(["a", "b", "c", "d", "e"].map(id => game(id, { developer: ["s"] }))));
  const state = e.replay(["a", "b", "c", "d"]);
  assert.deepEqual(e.shortestStaticPath("d", "e"), ["d", "e"]);
  assert.deepEqual(e.findLegalPath(state, "e"), { path: null, exhaustedBudget: false, visitedStates: 1 });
});

test("bounded path search reports inconclusive rather than claiming impossible", () => {
  const e = new ConnectionEngine(fixture([game("a", { developer: ["s"] }), game("b", { developer: ["s"] })]));
  assert.equal(e.findLegalPath(e.createMatch("a"), "b", 0).exhaustedBudget, true);
  assert.equal(e.findLegalPath(e.createMatch("a"), "b", 8, 1).exhaustedBudget, true);
});

test("stale move version and changed catalogue cannot alter counters", () => {
  const e = new ConnectionEngine(fixture([game("a", { developer: ["s"] }), game("b", { developer: ["s"] })]));
  const state = e.createMatch("a");
  const stale = e.applyMove(state, "b", 99);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.reason, "stale_version");
  const wrong = e.applyMove({ ...state, datasetId: "other" }, "b");
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.reason, "dataset_mismatch");
  assert.deepEqual(state.usage, {});
});

test("malformed state is rejected, including invalid counters and history", () => {
  const e = new ConnectionEngine(fixture([game("a", { developer: ["s"] }), game("b", { developer: ["s"] })]));
  const state = e.createMatch("a");
  const invalid: MatchState[] = [
    { ...state, usage: { s: 4 } }, { ...state, usage: { s: -1 } }, { ...state, usage: { s: NaN } },
    { ...state, usage: { ghost: 1 } }, { ...state, currentGameId: "b" }, { ...state, version: 3 },
    { ...state, history: [] }, { ...state, history: ["a", "a"], version: 1 },
  ];
  for (const bad of invalid) {
    const result = e.applyMove(bad, "b");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_state");
  }
});

test("dataset rejects cross-category entries and unknown connector IDs", () => {
  const d = fixture([game("a")]);
  assert.throws(() => new ConnectionEngine({ ...d, games: [{ ...d.games[0]!, category: "movies" } as never] }));
  const unknown = fixture([game("a", { composer: ["x"] })]);
  delete unknown.entities.x;
  assert.throws(() => new ConnectionEngine(unknown));
  assert.throws(() => new ConnectionEngine(fixture([game("a"), game("a")])));
});

test("engine owns its catalogue and shared connector outputs", () => {
  const d = fixture([game("a", { composer: ["x"] }), game("b", { composer: ["x"] })]);
  const e = new ConnectionEngine(d);
  d.games[0]!.credits.composer = [];
  const shared = e.sharedConnectors("a", "b");
  shared[0]!.types.length = 0;
  assert.deepEqual(e.sharedConnectors("a", "b"), [{ entityId: "x", types: ["composer"] }]);
});

test("replay rebuilds usage and rejects an invalid historical transition", () => {
  const e = new ConnectionEngine(fixture([game("a", { composer: ["x"] }), game("b", { composer: ["x"] }), game("c")]));
  assert.deepEqual(e.replay(["a", "b"]).usage, { x: 1 });
  assert.throws(() => e.replay(["a", "c"]));
  assert.throws(() => e.replay([]));
});

test("every simulation strategy enforces entity limits and replayable, unique histories", () => {
  const e = new ConnectionEngine(fixture([
    game("a", { developer: ["s"] }), game("b", { developer: ["s"], composer: ["m"] }),
    game("c", { developer: ["s"], composer: ["m"] }), game("d", { composer: ["m"], character: ["h"] }),
    game("e", { character: ["h"] }), game("f", { character: ["h"], developer: ["s"] }),
  ]));
  for (const strategy of ["random", "maximize", "trap", "mixed"] as const) {
    for (let seed = 1; seed <= 30; seed++) {
      const chain = runChain(e, "a", strategy, seed);
      assert.equal(new Set(chain.state.history).size, chain.state.history.length);
      assert.deepEqual(e.replay(chain.state.history), chain.state);
      assert.ok(Object.values(chain.state.usage).every(n => n >= 1 && n <= 3));
      assert.equal(e.isDeadEnd(chain.state), true);
    }
  }
});

test("missing one real shared credit can cause a false acceptance despite a correct engine", () => {
  const complete = fixture([
    ...["x", "y", "z"].map(id => game(id, { composer: ["music"] })),
    game("a", { composer: ["music"], developer: ["studio"] }),
    game("b", { composer: ["music"], developer: ["studio"] }),
  ]);
  const fullEngine = new ConnectionEngine(complete);
  const state = fullEngine.replay(["x", "y", "z", "a"]);
  assert.equal(state.usage.music, 3);
  assert.equal(fullEngine.validateMove(state, "b").ok, false);
  const incomplete = structuredClone(complete);
  incomplete.games.find(g => g.id === "b")!.credits.composer = [];
  const sparseEngine = new ConnectionEngine(incomplete);
  const sparseState = sparseEngine.replay(["x", "y", "z", "a"]);
  assert.equal(sparseEngine.validateMove(sparseState, "b").ok, true);
  assert.equal(catalogueReadiness(incomplete).ready, false);
  assert.deepEqual(catalogueReadiness(incomplete).eligibleGameIds, []);
});
