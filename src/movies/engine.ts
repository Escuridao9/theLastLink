import { MOVIE_ROLES } from "./types.ts";
import type {
  MovieDataset,
  MovieRole,
  MovieConnector,
  MovieMatchState,
} from "./types.ts";
import type { RejectionReason } from "../types.ts";

export type MovieValidation =
  | { ok: true; connectors: MovieConnector[] }
  | {
      ok: false;
      reason: RejectionReason;
      connectors: MovieConnector[];
      exhausted: string[];
    };
/** Indexed by person, not an O(n²) film-pair matrix. No source calls during a move. */
export class MovieConnectionEngine {
  readonly datasetId: string;
  readonly roles = new Map<string, Map<string, MovieRole[]>>();
  readonly filmsByPerson = new Map<string, Set<string>>();
  private readonly people: Set<string>;
  constructor(dataset: MovieDataset) {
    if (
      dataset.schemaVersion !== 1 ||
      dataset.category !== "movies" ||
      !dataset.datasetId
    )
      throw Error("invalid_movie_dataset");
    this.datasetId = dataset.datasetId;
    this.people = new Set(Object.keys(dataset.entities));
    for (const movie of dataset.movies) {
      if (movie.category !== "movies" || !movie.id || this.roles.has(movie.id))
        throw Error("duplicate_or_wrong_movie");
      const map = new Map<string, MovieRole[]>();
      for (const role of MOVIE_ROLES) {
        if (!Array.isArray(movie.credits[role]))
          throw Error("missing_movie_role");
        for (const c of movie.credits[role]) {
          if (
            !this.people.has(c.entityId) ||
            !/^tmdb:person:[1-9]\d*$/.test(c.entityId)
          )
            throw Error("unknown_person");
          const roles = map.get(c.entityId) ?? [];
          if (!roles.includes(role)) roles.push(role);
          map.set(c.entityId, roles);
          if (!this.filmsByPerson.has(c.entityId))
            this.filmsByPerson.set(c.entityId, new Set());
          this.filmsByPerson.get(c.entityId)!.add(movie.id);
        }
      }
      this.roles.set(movie.id, map);
    }
  }
  gameIds(): string[] {
    return [...this.roles.keys()];
  }
  sharedConnectors(from: string, to: string): MovieConnector[] {
    const a = this.roles.get(from),
      b = this.roles.get(to);
    if (!a || !b) throw Error("unknown_movie");
    return [...a]
      .filter(([id]) => b.has(id))
      .map(([entityId, fromTypes]) => ({
        entityId,
        types: [...new Set([...fromTypes, ...b.get(entityId)!])].sort(),
        fromTypes: [...fromTypes].sort(),
        toTypes: [...b.get(entityId)!].sort(),
      }))
      .sort((a, b) => a.entityId.localeCompare(b.entityId));
  }
  neighbors(id: string): string[] {
    const roles = this.roles.get(id);
    if (!roles) throw Error("unknown_movie");
    const neighbors = new Set<string>();
    for (const person of roles.keys())
      for (const film of this.filmsByPerson.get(person)!)
        if (film !== id) neighbors.add(film);
    return [...neighbors];
  }
  createMatch(id: string): MovieMatchState {
    if (!this.roles.has(id)) throw Error("unknown_movie");
    return {
      datasetId: this.datasetId,
      category: "movies",
      currentGameId: id,
      history: [id],
      usage: {},
      version: 0,
    };
  }
  private validState(s: MovieMatchState): boolean {
    return (
      s.category === "movies" &&
      Array.isArray(s.history) &&
      s.history.length > 0 &&
      s.currentGameId === s.history.at(-1) &&
      s.version === s.history.length - 1 &&
      new Set(s.history).size === s.history.length &&
      s.history.every((id) => this.roles.has(id)) &&
      s.usage !== null &&
      typeof s.usage === "object" &&
      Object.entries(s.usage).every(
        ([id, n]) =>
          this.people.has(id) && Number.isInteger(n) && n >= 0 && n <= 3,
      )
    );
  }
  validateMove(
    s: MovieMatchState,
    target: string,
    version = s.version,
  ): MovieValidation {
    const reject = (
      reason: RejectionReason,
      connectors: MovieConnector[] = [],
      exhausted: string[] = [],
    ): MovieValidation => ({ ok: false, reason, connectors, exhausted });
    if (s.datasetId !== this.datasetId) return reject("dataset_mismatch");
    if (!this.validState(s)) return reject("invalid_state");
    if (version !== s.version) return reject("stale_version");
    if (!this.roles.has(target)) return reject("unknown_game");
    if (s.history.includes(target)) return reject("repeated_game");
    const connectors = this.sharedConnectors(s.currentGameId, target);
    if (!connectors.length) return reject("no_shared_connector");
    const exhausted = connectors
      .filter((c) => (s.usage[c.entityId] ?? 0) >= 3)
      .map((c) => c.entityId);
    return exhausted.length
      ? reject("exhausted_connector", connectors, exhausted)
      : { ok: true, connectors };
  }
  applyMove(s: MovieMatchState, target: string, version = s.version) {
    const v = this.validateMove(s, target, version);
    if (!v.ok) return { ...v, state: s };
    const usage = { ...s.usage };
    for (const c of v.connectors)
      usage[c.entityId] = (usage[c.entityId] ?? 0) + 1;
    return {
      ...v,
      state: {
        ...s,
        currentGameId: target,
        history: [...s.history, target],
        usage,
        version: s.version + 1,
      },
    };
  }
  availableMoves(s: MovieMatchState): string[] {
    if (s.datasetId !== this.datasetId || !this.validState(s))
      throw Error("invalid_match");
    const played = new Set(s.history);
    return this.neighbors(s.currentGameId).filter(
      (id) =>
        !played.has(id) &&
        this.sharedConnectors(s.currentGameId, id).every(
          (c) => (s.usage[c.entityId] ?? 0) < 3,
        ),
    );
  }
  replay(history: readonly string[]): MovieMatchState {
    if (!history.length) throw Error("missing_seed");
    let state = this.createMatch(history[0]!);
    for (const id of history.slice(1)) {
      const result = this.applyMove(state, id);
      if (!result.ok) throw Error(`illegal_recorded_move:${result.reason}`);
      state = result.state;
    }
    return state;
  }
  connectedComponents(): string[][] {
    const remaining = new Set(this.gameIds()),
      out: string[][] = [],
      visitedPeople = new Set<string>();
    while (remaining.size) {
      const queue = [remaining.values().next().value!];
      remaining.delete(queue[0]!);
      for (let i = 0; i < queue.length; i++)
        for (const person of this.roles.get(queue[i]!)!.keys()) {
          if (visitedPeople.has(person)) continue;
          visitedPeople.add(person);
          for (const id of this.filmsByPerson.get(person)!)
            if (remaining.delete(id)) queue.push(id);
        }
      out.push(queue);
    }
    return out.sort(
      (a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!),
    );
  }
}
