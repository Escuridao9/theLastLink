import { CONNECTOR_TYPES } from "./types.ts";
import type { Dataset, Edge, Game, MatchState, MoveResult, SharedConnector, Validation } from "./types.ts";

const LIMIT = 3;

function reject(reason: Extract<Validation, { ok: false }>["reason"],
  connectors: SharedConnector[] = [], exhausted: string[] = []): Validation {
  return { ok: false, reason, connectors, exhausted };
}

/** Pure rule operations; no Angular, Node, networking, timers, or persistence dependency. */
export class ConnectionEngine {
  readonly datasetId: string;
  #games: Map<string, Game>;
  #entities: Set<string>;
  #edges: Map<string, Map<string, SharedConnector[]>>;

  constructor(dataset: Dataset) {
    if (dataset.schemaVersion !== 1 || !dataset.datasetId || !Array.isArray(dataset.games)) {
      throw new TypeError("Invalid dataset header");
    }
    this.datasetId = dataset.datasetId;
    // Own the snapshot, so callers cannot change rules by mutating their input later.
    const snapshot = structuredClone(dataset);
    this.#entities = new Set(Object.keys(snapshot.entities));
    this.#games = new Map();
    for (const game of snapshot.games) {
      if (game.category !== "games" || !game.id || this.#games.has(game.id)) {
        throw new TypeError("Every game must have a unique ID and category games");
      }
      for (const kind of CONNECTOR_TYPES) {
        if (!Array.isArray(game.credits?.[kind])) throw new TypeError(`Missing credit array: ${kind}`);
        for (const credit of game.credits[kind]) {
          if (!this.#entities.has(credit.entityId)) throw new TypeError(`Unknown connector: ${credit.entityId}`);
        }
      }
      this.#games.set(game.id, game);
    }
    this.#edges = new Map([...this.#games.keys()].map(id => [id, new Map()]));
    const games = [...this.#games.values()];
    for (let i = 0; i < games.length; i++) {
      for (let j = i + 1; j < games.length; j++) {
        const a = games[i]!;
        const b = games[j]!;
        const shared = this.#intersect(a, b);
        if (shared.length) {
          this.#edges.get(a.id)!.set(b.id, shared);
          this.#edges.get(b.id)!.set(a.id, shared);
        }
      }
    }
  }

  gameIds(): string[] { return [...this.#games.keys()]; }

  #intersect(a: Game, b: Game): SharedConnector[] {
    const shared = new Map<string, SharedConnector>();
    for (const kind of CONNECTOR_TYPES) {
      const right = new Set(b.credits[kind].map(c => c.entityId));
      for (const id of new Set(a.credits[kind].map(c => c.entityId))) {
        if (!right.has(id)) continue;
        if (!shared.has(id)) shared.set(id, { entityId: id, types: [] });
        shared.get(id)!.types.push(kind);
      }
    }
    return [...shared.values()].sort((a, b) => a.entityId.localeCompare(b.entityId));
  }

  /** All same-role intersections; one canonical entity is counted once per move. */
  sharedConnectors(from: string, to: string): SharedConnector[] {
    if (!this.#games.has(from) || !this.#games.has(to)) throw new RangeError("Unknown game");
    if (from === to) return this.#intersect(this.#games.get(from)!, this.#games.get(to)!);
    return structuredClone(this.#edges.get(from)!.get(to) ?? []);
  }

  createMatch(startGameId: string): MatchState {
    if (!this.#games.has(startGameId)) throw new RangeError("Unknown starting game");
    return { datasetId: this.datasetId, category: "games", currentGameId: startGameId,
      history: [startGameId], usage: {}, version: 0 };
  }

  #validState(state: MatchState): boolean {
    return state.category === "games" && Array.isArray(state.history) && state.history.length > 0 &&
      state.currentGameId === state.history.at(-1) && state.version === state.history.length - 1 &&
      new Set(state.history).size === state.history.length &&
      state.history.every(id => this.#games.has(id)) && state.usage !== null && typeof state.usage === "object" &&
      Object.entries(state.usage).every(([id, n]) => this.#entities.has(id) && Number.isInteger(n) && n >= 0 && n <= LIMIT);
  }

  validateMove(state: MatchState, submittedGameId: string, expectedVersion = state.version): Validation {
    if (state.datasetId !== this.datasetId) return reject("dataset_mismatch");
    if (!this.#validState(state)) return reject("invalid_state");
    if (expectedVersion !== state.version) return reject("stale_version");
    if (!this.#games.has(submittedGameId)) return reject("unknown_game");
    if (state.history.includes(submittedGameId)) return reject("repeated_game");
    const connectors = this.sharedConnectors(state.currentGameId, submittedGameId);
    if (!connectors.length) return reject("no_shared_connector");
    const exhausted = connectors.filter(c => (state.usage[c.entityId] ?? 0) >= LIMIT).map(c => c.entityId);
    if (exhausted.length) return reject("exhausted_connector", connectors, exhausted);
    return { ok: true, connectors };
  }

  /** Validate everything before returning a new state. Rejection preserves input identity. */
  applyMove(state: MatchState, submittedGameId: string, expectedVersion = state.version): MoveResult {
    const validation = this.validateMove(state, submittedGameId, expectedVersion);
    if (!validation.ok) return { ...validation, state };
    const usage = { ...state.usage };
    for (const c of validation.connectors) usage[c.entityId] = (usage[c.entityId] ?? 0) + 1;
    const next: MatchState = { ...state, currentGameId: submittedGameId,
      history: [...state.history, submittedGameId], usage, version: state.version + 1 };
    return { ok: true, state: next, connectors: validation.connectors };
  }

  availableMoves(state: MatchState): string[] {
    if (state.datasetId !== this.datasetId || !this.#validState(state)) throw new TypeError("Invalid match state");
    return [...this.#edges.get(state.currentGameId)!.keys()].filter(id => this.validateMove(state, id).ok);
  }

  isDeadEnd(state: MatchState): boolean { return this.availableMoves(state).length === 0; }

  graph(): Edge[] {
    const edges: Edge[] = [];
    for (const [from, neighbors] of this.#edges) {
      for (const [to, connectors] of neighbors) {
        if (from < to) edges.push({ from, to, connectors: structuredClone(connectors) });
      }
    }
    return edges;
  }

  connectedComponents(): string[][] {
    const remaining = new Set(this.gameIds());
    const components: string[][] = [];
    while (remaining.size) {
      const queue = [remaining.values().next().value!];
      remaining.delete(queue[0]!);
      for (let i = 0; i < queue.length; i++) {
        for (const neighbor of this.#edges.get(queue[i]!)!.keys()) {
          if (remaining.delete(neighbor)) queue.push(neighbor);
        }
      }
      components.push(queue);
    }
    return components.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
  }

  /** Structural path only. Use findLegalPath when existing usage/history matters. */
  shortestStaticPath(from: string, to: string): string[] | null {
    if (!this.#games.has(from) || !this.#games.has(to)) throw new RangeError("Unknown game");
    const queue = [[from]];
    const seen = new Set([from]);
    for (let i = 0; i < queue.length; i++) {
      const path = queue[i]!;
      const last = path.at(-1)!;
      if (last === to) return path;
      for (const next of this.#edges.get(last)!.keys()) {
        if (!seen.has(next)) { seen.add(next); queue.push([...path, next]); }
      }
    }
    return null;
  }

  /** Bounded BFS over full match states. Budget exhaustion is explicitly inconclusive. */
  findLegalPath(state: MatchState, target: string, maxDepth = 8, maxStates = 10000):
    { path: string[] | null; exhaustedBudget: boolean; visitedStates: number } {
    if (!this.#games.has(target)) throw new RangeError("Unknown target game");
    if (!Number.isInteger(maxDepth) || maxDepth < 0 || !Number.isInteger(maxStates) || maxStates < 1) {
      throw new RangeError("Invalid search budget");
    }
    if (state.datasetId !== this.datasetId || !this.#validState(state)) throw new TypeError("Invalid match state");
    const queue: { state: MatchState; path: string[] }[] = [{ state, path: [] }];
    let depthLimited = false;
    let queueLimited = false;
    for (let i = 0; i < queue.length; i++) {
      if (i >= maxStates) return { path: null, exhaustedBudget: true, visitedStates: i };
      const current = queue[i]!;
      if (current.state.currentGameId === target) {
        return { path: current.path, exhaustedBudget: false, visitedStates: i + 1 };
      }
      const moves = this.availableMoves(current.state);
      if (current.path.length >= maxDepth) { if (moves.length) depthLimited = true; continue; }
      for (const id of moves) {
        const next = this.applyMove(current.state, id);
        if (next.ok) {
          if (queue.length >= maxStates) { queueLimited = true; continue; }
          queue.push({ state: next.state, path: [...current.path, id] });
        }
      }
    }
    return { path: null, exhaustedBudget: depthLimited || queueLimited, visitedStates: queue.length };
  }

  /** Rebuild trusted state from game IDs instead of accepting client-provided usage. */
  replay(history: readonly string[]): MatchState {
    if (!history.length) throw new RangeError("History must include a seed");
    let state = this.createMatch(history[0]!);
    for (const id of history.slice(1)) {
      const result = this.applyMove(state, id);
      if (!result.ok) throw new RangeError(`Invalid recorded move: ${id}: ${result.reason}`);
      state = result.state;
    }
    return state;
  }
}
