import { FOOTBALL_ROLES } from './types.ts';
import type {
  FootballDataset,
  FootballRole,
  FootballConnector,
  FootballMatchState,
} from './types.ts';
import type { RejectionReason } from '../types.ts';

export type FootballValidation =
  | { ok: true; connectors: FootballConnector[] }
  | {
      ok: false;
      reason: RejectionReason;
      connectors: FootballConnector[];
      exhausted: string[];
    };
/** Historical senior-club connections, indexed by canonical person. No live source calls. */
export class FootballConnectionEngine {
  readonly datasetId: string;
  readonly #roles = new Map<string, Map<string, FootballRole[]>>();
  readonly #clubsByPerson = new Map<string, Set<string>>();
  private readonly people: Set<string>;
  constructor(dataset: FootballDataset) {
    if (dataset.schemaVersion !== 1 || dataset.category !== 'football' || !dataset.datasetId)
      throw Error('invalid_football_dataset');
    this.datasetId = dataset.datasetId;
    this.people = new Set(Object.keys(dataset.entities));
    for (const club of dataset.clubs) {
      if (
        club.category !== 'football' ||
        !/^wikidata:club:Q[1-9]\d*$/.test(club.id) ||
        this.#roles.has(club.id)
      )
        throw Error('duplicate_or_wrong_club');
      const map = new Map<string, FootballRole[]>();
      for (const role of FOOTBALL_ROLES) {
        if (!Array.isArray(club.credits[role])) throw Error('missing_football_role');
        for (const c of club.credits[role]) {
          if (!this.people.has(c.entityId) || !/^wikidata:Q[1-9]\d*$/.test(c.entityId))
            throw Error('unknown_person');
          const roles = map.get(c.entityId) ?? [];
          if (!roles.includes(role)) roles.push(role);
          map.set(c.entityId, roles);
          if (!this.#clubsByPerson.has(c.entityId)) this.#clubsByPerson.set(c.entityId, new Set());
          this.#clubsByPerson.get(c.entityId)!.add(club.id);
        }
      }
      this.#roles.set(club.id, map);
    }
  }
  gameIds(): string[] {
    return [...this.#roles.keys()];
  }
  sharedConnectors(from: string, to: string): FootballConnector[] {
    const a = this.#roles.get(from),
      b = this.#roles.get(to);
    if (!a || !b) throw Error('unknown_club');
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
    const roles = this.#roles.get(id);
    if (!roles) throw Error('unknown_club');
    const neighbors = new Set<string>();
    for (const person of roles.keys())
      for (const film of this.#clubsByPerson.get(person)!) if (film !== id) neighbors.add(film);
    return [...neighbors];
  }
  createMatch(id: string): FootballMatchState {
    if (!this.#roles.has(id)) throw Error('unknown_club');
    return {
      datasetId: this.datasetId,
      category: 'football',
      currentGameId: id,
      history: [id],
      usage: {},
      version: 0,
    };
  }
  private validState(s: FootballMatchState): boolean {
    return (
      s.category === 'football' &&
      Array.isArray(s.history) &&
      s.history.length > 0 &&
      s.currentGameId === s.history.at(-1) &&
      s.version === s.history.length - 1 &&
      new Set(s.history).size === s.history.length &&
      s.history.every((id) => this.#roles.has(id)) &&
      s.usage !== null &&
      typeof s.usage === 'object' &&
      Object.entries(s.usage).every(
        ([id, n]) => this.people.has(id) && Number.isInteger(n) && n >= 0 && n <= 3,
      )
    );
  }
  validateMove(s: FootballMatchState, target: string, version = s.version): FootballValidation {
    const reject = (
      reason: RejectionReason,
      connectors: FootballConnector[] = [],
      exhausted: string[] = [],
    ): FootballValidation => ({ ok: false, reason, connectors, exhausted });
    if (s.datasetId !== this.datasetId) return reject('dataset_mismatch');
    if (!this.validState(s)) return reject('invalid_state');
    if (version !== s.version) return reject('stale_version');
    if (!this.#roles.has(target)) return reject('unknown_game');
    if (s.history.includes(target)) return reject('repeated_game');
    const connectors = this.sharedConnectors(s.currentGameId, target);
    if (!connectors.length) return reject('no_shared_connector');
    const exhausted = connectors
      .filter((c) => (s.usage[c.entityId] ?? 0) >= 3)
      .map((c) => c.entityId);
    return exhausted.length
      ? reject('exhausted_connector', connectors, exhausted)
      : { ok: true, connectors };
  }
  applyMove(s: FootballMatchState, target: string, version = s.version) {
    const v = this.validateMove(s, target, version);
    if (!v.ok) return { ...v, state: s };
    const usage = { ...s.usage };
    for (const c of v.connectors) usage[c.entityId] = (usage[c.entityId] ?? 0) + 1;
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
  availableMoves(s: FootballMatchState): string[] {
    if (s.datasetId !== this.datasetId || !this.validState(s)) throw Error('invalid_match');
    const played = new Set(s.history);
    return this.neighbors(s.currentGameId).filter(
      (id) =>
        !played.has(id) &&
        this.sharedConnectors(s.currentGameId, id).every((c) => (s.usage[c.entityId] ?? 0) < 3),
    );
  }
  replay(history: readonly string[]): FootballMatchState {
    if (!history.length) throw Error('missing_seed');
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
        for (const person of this.#roles.get(queue[i]!)!.keys()) {
          if (visitedPeople.has(person)) continue;
          visitedPeople.add(person);
          for (const id of this.#clubsByPerson.get(person)!)
            if (remaining.delete(id)) queue.push(id);
        }
      out.push(queue);
    }
    return out.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
  }
}
