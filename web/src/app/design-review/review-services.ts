import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, map, of, shareReplay, NEVER, throwError } from 'rxjs';
import type {
  Category,
  CommandResponse,
  Dataset,
  Game,
  Match,
  Room,
  SharedConnector,
} from '../core/models';
import { MOVIES_VERSION, FOOTBALL_VERSION, readCategory, type OpeningMode } from '../core/models';
import type { OpeningOption } from '../core/catalogue.service';
import { REVIEW_DATASET, REVIEW_STATE, REVIEW_TURNS } from './fixture';
import { GAMES_REVIEW } from './games-fixture';

const GAMES_ID = 'games-reviewed-2026-10-21-v1';
interface ReviewOpening {
  state: Match['state'];
  turns: Match['turns'];
  version: number;
  moves: Record<
    string,
    { ok: boolean; reason?: string; connectors: SharedConnector[]; state?: Match['state'] }
  >;
}
/** Local published assets only, even if the production app has a live configuration. */
@Injectable()
export class ReviewCatalogueService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly cache = new Map<string, Observable<Dataset>>();
  private readonly shards = new Map<string, Observable<Record<string, Game>>>();
  private get state(): string {
    return new URLSearchParams((this.router.url ?? '').split('?')[1]).get('state') ?? '';
  }
  load(id = GAMES_ID): Observable<Dataset> {
    if (!this.cache.has(id))
      this.cache.set(
        id,
        this.http
          .get<Dataset & { movies?: Game[] }>(
            id === MOVIES_VERSION
              ? 'movies-index-v1.json'
              : id === FOOTBALL_VERSION
                ? 'football-index-v1.json'
                : 'catalogue-v1.json',
          )
          .pipe(
            map((data) => ({
              ...data,
              category:
                id === MOVIES_VERSION
                  ? ('movies' as const)
                  : id === FOOTBALL_VERSION
                    ? ('football' as const)
                    : ('games' as const),
              games: data.movies ?? data.games,
              entities: {
                ...data.entities,
                ...(id === MOVIES_VERSION ? REVIEW_DATASET.entities : {}),
              },
            })),
            shareReplay({ bufferSize: 1, refCount: true }),
          ),
      );
    return this.cache.get(id)!;
  }
  loadCategory(category: Category): Observable<Dataset> {
    if (this.state === 'loading') return NEVER;
    if (this.state === 'error')
      return throwError(() =>
        Error('Example connection error. Your catalogue could not be reached.'),
      );
    return this.load(
      category === 'movies'
        ? MOVIES_VERSION
        : category === 'football'
          ? FOOTBALL_VERSION
          : GAMES_ID,
    ).pipe(map((data) => (this.state === 'empty' ? { ...data, games: [] } : data)));
  }
  openingOptions(id: string): Observable<OpeningOption[]> {
    return this.http
      .get<Record<string, OpeningOption[]>>('opening-pools-v1.json')
      .pipe(map((pools) => pools[id] ?? []));
  }
  details(data: Dataset, entry: Game): Observable<Game> {
    if (entry.category === 'games') return of(entry);
    const path = `${entry.category === 'football' ? 'football' : 'movies'}/${data.datasetId}/credits-${entry.detailShard}.json`;
    if (!this.shards.has(path))
      this.shards.set(
        path,
        this.http
          .get<Record<string, Game>>(path)
          .pipe(shareReplay({ bufferSize: 1, refCount: true })),
      );
    return this.shards.get(path)!.pipe(map((shard) => shard[entry.id]!));
  }
}

/** Scripted, isolated review state. Never authenticates or opens a Supabase channel.
 * Preview answer receipts are generated offline through the unchanged engines.
 * They cover the initial example turn; the review toolbar is the journey control. */
@Injectable()
export class ReviewMatchService {
  private readonly http = inject(HttpClient);
  private rematchFixtures?: Promise<Record<Category, ReviewOpening[]>>;
  private readonly savedMatches = new Map<string, Match>();
  private rematchSequence = 0;
  private openings(): Promise<Record<Category, ReviewOpening[]>> {
    return (this.rematchFixtures ??= firstValueFrom(
      this.http.get<Record<Category, ReviewOpening[]>>('design-review/rematch-fixtures.json'),
    ));
  }
  private receipts?: Promise<
    Record<
      Category,
      {
        version: number;
        moves: Record<
          string,
          { ok: boolean; reason?: string; connectors: SharedConnector[]; state?: Match['state'] }
        >;
      }
    >
  >;
  readonly backend = { playerId: signal('preview-diogo') };
  readonly room = signal<Room | null>(null);
  readonly match = signal<Match | null>(null);
  readonly error = signal('');
  readonly connection = signal('Local example');
  readonly clockOffset = signal(0);
  readonly paused = signal(true);
  private readonly router = inject(Router);
  private timer?: ReturnType<typeof setInterval>;
  private previousResume: string | null = null;
  private generation = 0;
  private readonly rooms = new Map<string, Room>();
  private get category(): Category {
    return this.router.url.includes('football')
      ? 'football'
      : this.router.url.includes('games')
        ? 'games'
        : 'movies';
  }
  private get state(): string {
    return new URLSearchParams(this.router.url.split('?')[1]).get('state') ?? '';
  }
  makeRoom(category: Category, ready = false, openingMode: OpeningMode = 'standard'): Room {
    return {
      id: `design-review-${category}-room`,
      code: 'LASTLINK2026',
      category,
      openingMode,
      hostId: 'preview-diogo',
      guestId: ready ? 'preview-alex' : null,
      matchId: null,
      status: ready ? 'ready' : 'waiting',
      revision: 1,
      players: [
        { id: 'preview-diogo', name: 'Diogo' },
        ...(ready ? [{ id: 'preview-alex', name: 'Alex' }] : []),
      ],
    };
  }
  async watch(kind: 'room' | 'match', id: string): Promise<void> {
    const previous = this.match();
    this.stop();
    const generation = ++this.generation;
    this.error.set('');
    this.room.set(null);
    this.match.set(null);
    if (this.state === 'loading') return;
    if (this.state === 'error')
      throw Error('Example connection interrupted. Try returning to rooms.');
    if (kind === 'room') {
      const room = this.rooms.get(id) ?? this.makeRoom(this.category, this.state !== 'waiting');
      const name = localStorage.getItem('last-link-name');
      if (name) {
        const me = room.players.find((p) => p.id === 'preview-diogo');
        if (me) me.name = name;
      }
      this.room.set(room);
      this.rooms.set(room.id, room);
      return;
    }
    this.previousResume = localStorage.getItem('last-link-resume');
    if (previous?.id === id && this.router.url.includes('/results/')) {
      this.room.set(previous.room);
      this.match.set(previous);
      if (previous.status !== 'finished') this.finish(this.state !== 'defeat');
      return;
    }
    const saved = this.savedMatches.get(id);
    if (saved) {
      this.room.set(structuredClone(saved.room));
      this.match.set(structuredClone(saved));
      if (this.router.url.includes('/results/')) {
        if (saved.status !== 'finished') this.finish(this.state !== 'defeat');
      } else if (saved.status === 'active') {
        this.paused.set(true);
        this.freezeClock();
        this.timer = setInterval(() => {
          if (generation === this.generation) this.freezeClock();
        }, 80);
      }
      return;
    }
    const category: Category = id.includes('football')
      ? 'football'
      : id.includes('games')
        ? 'games'
        : 'movies';
    const savedRoom = this.rooms.get(`design-review-${category}-room`);
    const room = this.makeRoom(category, true, savedRoom?.openingMode ?? 'standard');
    room.status = 'playing';
    room.matchId = id;
    const fixture =
      category === 'games'
        ? GAMES_REVIEW
        : category === 'football'
          ? await firstValueFrom(
              this.http.get<{ state: Match['state']; turns: Match['turns'] }>(
                'design-review/football-fixture.json',
              ),
            )
          : { state: REVIEW_STATE, turns: REVIEW_TURNS };
    if (generation !== this.generation) return;
    this.room.set(room);
    this.match.set({
      id,
      roomId: room.id,
      category,
      catalogueId:
        category === 'games'
          ? GAMES_ID
          : category === 'football'
            ? FOOTBALL_VERSION
            : MOVIES_VERSION,
      status: 'active',
      activePlayer: 'preview-diogo',
      deadline: new Date(Date.now() + 20000).toISOString(),
      state: structuredClone(fixture.state) as Match['state'],
      turns: structuredClone(fixture.turns) as Match['turns'],
      revision: 8,
      winnerId: null,
      endReason: null,
      endedAt: null,
      room,
    });
    if (this.router.url.includes('/results/')) this.finish(this.state !== 'defeat');
    else {
      this.paused.set(true);
      this.freezeClock();
      this.timer = setInterval(() => {
        if (generation === this.generation) this.freezeClock();
      }, 80);
    }
  }
  private freezeClock(): void {
    if (this.paused() && this.match()?.status === 'active')
      this.clockOffset.set(
        Date.parse(this.match()!.deadline) -
          Date.now() -
          (this.pausedSeconds === 20 ? 20000 : 8600),
      );
  }
  get pausedSeconds(): number {
    return this.match()?.id.includes('-rematch-') && this.match()?.state.version === 0 ? 20 : 9;
  }
  waitForRival(): void {
    const room = this.room();
    if (room)
      this.room.set({ ...room, guestId: null, status: 'waiting', players: [room.players[0]!] });
  }
  addRival(): void {
    this.room.update((room) =>
      room
        ? {
            ...room,
            guestId: 'preview-alex',
            status: 'ready',
            players: [room.players[0]!, { id: 'preview-alex', name: 'Alex' }],
          }
        : room,
    );
  }
  changeTurn(): void {
    this.match.update((m) =>
      m
        ? {
            ...m,
            activePlayer: m.activePlayer === 'preview-diogo' ? 'preview-alex' : 'preview-diogo',
          }
        : m,
    );
  }
  toggleClock(): void {
    if (this.paused()) {
      this.match.update((m) =>
        m ? { ...m, deadline: new Date(Date.now() + 20000).toISOString() } : m,
      );
      this.clockOffset.set(0);
    }
    this.paused.update((v) => !v);
    this.freezeClock();
  }
  finish(won: boolean, reason: Match['endReason'] = 'timeout'): void {
    this.match.update((m) =>
      m
        ? {
            ...m,
            status: 'finished',
            winnerId: won ? 'preview-diogo' : 'preview-alex',
            endReason: reason,
            endedAt: new Date().toISOString(),
            room: { ...m.room, status: 'finished' },
            rematch: {
              ...(m.rematch ?? {
                requestedBy: [],
                expiresAt: {},
                nextMatchId: null,
                nextStatus: null,
              }),
              available: !m.rematch?.nextMatchId,
            },
          }
        : m,
    );
    this.clockOffset.set(0);
    const current = this.match();
    if (current) {
      this.savedMatches.set(current.id, structuredClone(current));
      for (const [id, previous] of this.savedMatches)
        if (previous.rematch?.nextMatchId === current.id)
          this.savedMatches.set(id, {
            ...previous,
            rematch: { ...previous.rematch, nextStatus: 'finished' },
          });
    }
  }
  private async completeRematch(source: Match): Promise<Match> {
    const consent = source.rematch!;
    if (
      !['preview-diogo', 'preview-alex'].every(
        (id) =>
          consent.requestedBy.includes(id) && Date.parse(consent.expiresAt[id] ?? '') > Date.now(),
      )
    )
      return source;
    const fixture = (await this.openings())[source.category].find(
      (f) => f.state.history[0] !== source.state.history[0],
    )!;
    const id = `design-review-${source.category}-rematch-${++this.rematchSequence}`;
    const moment = new Date().toISOString();
    const room: Room = {
      ...source.room,
      status: 'playing',
      matchId: id,
      revision: source.room.revision + 1,
    };
    const next: Match = {
      ...source,
      id,
      roomId: room.id,
      room,
      status: 'active',
      activePlayer: 'preview-diogo',
      deadline: new Date(Date.parse(moment) + 20000).toISOString(),
      revision: 0,
      winnerId: null,
      endReason: null,
      endedAt: null,
      state: structuredClone(fixture.state),
      turns: structuredClone(fixture.turns).map((t) => ({ ...t, acceptedAt: moment })),
      rematch: {
        available: false,
        requestedBy: [],
        expiresAt: {},
        nextMatchId: null,
        nextStatus: null,
      },
    };
    this.savedMatches.set(id, next);
    return {
      ...source,
      room,
      revision: source.revision + 1,
      rematch: { ...consent, available: false, nextMatchId: id, nextStatus: 'active' },
    };
  }
  async rivalRematch(): Promise<void> {
    const m = this.match();
    if (!m || m.status !== 'finished' || m.rematch?.nextMatchId) return;
    const rematch = m.rematch ?? {
      available: true,
      requestedBy: [],
      expiresAt: {},
      nextMatchId: null,
      nextStatus: null,
    };
    const source: Match = {
      ...m,
      revision: m.revision + 1,
      rematch: {
        ...rematch,
        requestedBy: [...new Set([...rematch.requestedBy, 'preview-alex'])],
        expiresAt: {
          ...rematch.expiresAt,
          'preview-alex': new Date(Date.now() + 120000).toISOString(),
        },
      },
    };
    const updated = await this.completeRematch(source);
    if (this.match()?.id !== source.id) return;
    this.savedMatches.set(updated.id, updated);
    this.match.set(updated);
  }
  async send(action: string, payload: Record<string, unknown>): Promise<CommandResponse> {
    const response: CommandResponse = {
      ok: true,
      duplicate: false,
      serverTime: new Date().toISOString(),
    };
    if (action === 'create' || action === 'join') {
      if (action === 'join' && String(payload['code']) !== 'LASTLINK2026')
        throw Error('Example room not found. In this preview, use LASTLINK2026.');
      const room = this.makeRoom(
        action === 'create' ? readCategory(payload['category']) : this.category,
        action === 'join',
        payload['openingMode'] === 'familiar' ? 'familiar' : 'standard',
      );
      room.players[0]!.name = String(payload['name']);
      if (action === 'join') {
        room.hostId = 'preview-alex';
        room.guestId = 'preview-diogo';
        room.players = [
          { id: 'preview-alex', name: 'Alex' },
          { id: 'preview-diogo', name: String(payload['name']) },
        ];
      }
      this.rooms.set(room.id, room);
      response.room = room; // The room watcher, not this command, opens the lobby.
    } else if (action === 'start') {
      const room = this.room();
      if (room) response.match = { id: `design-review-${room.category}-match` } as Match;
    } else if (action === 'rematch' || action === 'cancel_rematch') {
      const m = this.match();
      if (!m || m.status !== 'finished' || String(payload['matchId']) !== m.id)
        throw Error('match_not_finished');
      const rematch = m.rematch ?? {
        available: true,
        requestedBy: [],
        expiresAt: {},
        nextMatchId: null,
        nextStatus: null,
      };
      if (rematch.nextMatchId) return { ...response, match: m };
      const requestedBy = rematch.requestedBy.filter((id) => id !== 'preview-diogo');
      const expiresAt = { ...rematch.expiresAt };
      delete expiresAt['preview-diogo'];
      if (action === 'rematch') {
        requestedBy.push('preview-diogo');
        expiresAt['preview-diogo'] = new Date(Date.now() + 120000).toISOString();
      }
      const source: Match = {
        ...m,
        revision: m.revision + 1,
        rematch: { ...rematch, requestedBy, expiresAt },
      };
      const updated = await this.completeRematch(source);
      if (this.match()?.id === m.id) {
        this.savedMatches.set(updated.id, updated);
        this.match.set(updated);
      }
      return { ...response, match: updated };
    } else if (action === 'concede') {
      const current = this.match();
      if (!current || current.id !== payload['matchId']) throw Error('match_not_found');
      if (current.status === 'active') this.finish(false, 'conceded');
      return { ...response, match: this.match()! };
    } else if (action === 'expire') {
      if (!this.paused()) this.finish(this.match()?.activePlayer !== this.backend.playerId());
    } else if (action === 'submit') {
      const current = this.match();
      if (!current) throw Error('Open an example match first.');
      if (current.activePlayer !== 'preview-diogo')
        return { ...response, ok: false, reason: 'not_your_turn' };
      this.receipts ??= firstValueFrom(
        this.http.get<
          Record<
            Category,
            {
              version: number;
              moves: Record<
                string,
                {
                  ok: boolean;
                  reason?: string;
                  connectors: SharedConnector[];
                  state?: Match['state'];
                }
              >;
            }
          >
        >('design-review/move-receipts.json'),
      );
      const fixture = current.id.includes('-rematch-')
        ? (await this.openings())[current.category].find(
            (f) => f.state.history[0] === current.state.history[0],
          )!
        : (await this.receipts)[current.category];
      if (current.state.version !== fixture.version)
        throw Error(
          'This example covers one answer. Restart the sample match to try another, or use the result controls.',
        );
      const receipt = fixture.moves[String(payload['entryId'])];
      if (!receipt) return { ...response, ok: false, reason: 'unknown_game' };
      if (receipt.ok && receipt.state)
        this.match.set({
          ...current,
          state: structuredClone(receipt.state),
          activePlayer: 'preview-alex',
          deadline: new Date(Date.now() + 20000).toISOString(),
          revision: current.revision + 1,
          turns: [
            ...current.turns,
            {
              index: receipt.state.version,
              playerId: 'preview-diogo',
              entryId: String(payload['entryId']),
              connectors: receipt.connectors,
              acceptedAt: response.serverTime,
            },
          ],
        });
      const updated = this.match();
      if (updated) this.savedMatches.set(updated.id, structuredClone(updated));
      return { ...response, ...receipt };
    }
    return response;
  }
  stop(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const stored = localStorage.getItem('last-link-resume');
    if (stored?.startsWith('design-review-')) {
      if (this.previousResume && !this.previousResume.startsWith('design-review-'))
        localStorage.setItem('last-link-resume', this.previousResume);
      else localStorage.removeItem('last-link-resume');
    }
  }
}
