import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './app.routes';
import { App } from './app.component';
import { BackendService } from './core/backend.service';
import { CatalogueService } from './core/catalogue.service';
import { ConfigService } from './core/config.service';
import { MatchService } from './core/match.service';
import { ResumeService, type SessionReturn } from './core/resume.service';
import type { CommandResponse, Dataset, Match, Room } from './core/models';
import { ReviewCatalogueService, ReviewMatchService } from './design-review/review-services';
import { MatchComponent } from './pages/match.component';
import { ResultsComponent } from './pages/results.component';
import { RoomsComponent } from './pages/rooms.component';
import { GameSearchComponent } from './shared/game-search.component';
import { REQUEST_ID } from './shared/request-id';
import { TurnClockComponent } from './shared/turn-clock.component';

// Synthetic protocol state is confined to this spec. These tests do not call Supabase.
const receiptId = '00000000-0000-4000-8000-000000000001';
const dataset: Dataset = {
  datasetId: 'games-test-v1', category: 'games',
  games: [
    { id: 'seed', category: 'games', title: 'Starting title', releaseYear: 2000, credits: {} },
    { id: 'answer', category: 'games', title: 'Test answer', releaseYear: 2001, credits: {} },
  ],
  entities: { person: { id: 'person', name: 'Test composer' } },
};
const success = (): CommandResponse => ({ ok: true, duplicate: false, serverTime: new Date().toISOString() });
const config = {
  configured: true, issue: signal(''),
  value: { supabaseUrl: 'https://example.invalid', supabasePublishableKey: 'sb_publishable_synthetic', catalogueId: dataset.datasetId, transport: 'edge' },
};
function room(): Room {
  return {
    id: 'room-one', code: 'ABCDEF123456', category: 'games', hostId: 'host',
    guestId: 'guest', status: 'ready', matchId: null, revision: 2,
    players: [{ id: 'host', name: 'Diogo' }, { id: 'guest', name: 'Alex' }],
  };
}
function match(version = 0, id = 'match-one'): Match {
  return {
    id, roomId: 'room-one', catalogueId: dataset.datasetId, category: 'games',
    status: 'active', activePlayer: version % 2 ? 'guest' : 'host',
    deadline: new Date(Date.now() + 20000).toISOString(), revision: version,
    winnerId: null, endReason: null, endedAt: null,
    state: { datasetId: dataset.datasetId, category: 'games', currentGameId: 'seed', history: ['seed'], usage: {}, version },
    room: { ...room(), status: 'playing', matchId: id },
    turns: [{ index: 0, playerId: null, entryId: 'seed', connectors: [], acceptedAt: new Date().toISOString() }],
  };
}
function game(initial: Match | null = null) {
  return {
    room: signal<Room | null>(initial?.room ?? null), match: signal<Match | null>(initial),
    backend: { playerId: signal('host') }, connection: signal('Live'),
    clockOffset: signal(0), error: signal(''),
    send: vi.fn<(...args: unknown[]) => Promise<CommandResponse>>(async () => success()),
    watch: vi.fn(async (_kind: 'room' | 'match', _id: string) => {}), stop: vi.fn(),
  };
}
function catalogue() {
  return { load: vi.fn(() => of(dataset)), loadCategory: vi.fn(() => of(dataset)), details: vi.fn((_data: Dataset, entry: Dataset['games'][number]) => of(entry)) };
}
function classFixture(initial: Match | null = match()) {
  const state = game(initial);
  const router = { url: '/match/match-one', navigate: vi.fn(async () => true) };
  TestBed.configureTestingModule({ providers: [
    { provide: Router, useValue: router },
    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'match-one']]), queryParamMap: new Map() } } },
    { provide: ConfigService, useValue: config },
    { provide: MatchService, useValue: state },
    { provide: CatalogueService, useValue: catalogue() },
    { provide: REQUEST_ID, useValue: () => receiptId },
  ] });
  return { state, router };
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Answer selection and retries', () => {
  it('clears a selected answer when the authoritative turn changes', () => {
    const { state } = classFixture();
    const component = TestBed.runInInjectionContext(() => new MatchComponent());
    TestBed.tick();
    component.selected.set(dataset.games[1]);
    state.match.set(match(1));
    TestBed.tick();
    expect(component.selected()).toBeNull();
    component.ngOnDestroy();
  });

  it('clears selection for a different match even when both have the same version', () => {
    const { state } = classFixture();
    const component = TestBed.runInInjectionContext(() => new MatchComponent());
    TestBed.tick();
    component.selected.set(dataset.games[1]);
    state.match.set(match(0, 'match-two'));
    TestBed.tick();
    expect(component.selected()).toBeNull();
    component.ngOnDestroy();
  });

  it('preserves the selected title during a same-turn refresh', () => {
    const { state } = classFixture();
    const component = TestBed.runInInjectionContext(() => new MatchComponent());
    TestBed.tick();
    component.selected.set(dataset.games[1]);
    state.match.set({ ...state.match()!, revision: 10 });
    TestBed.tick();
    expect(component.selected()).toBe(dataset.games[1]);
    component.ngOnDestroy();
  });

  it('reuses the receipt after a lost response and clears selection after acceptance', async () => {
    const { state } = classFixture();
    const component = TestBed.runInInjectionContext(() => new MatchComponent());
    TestBed.tick();
    component.selected.set(dataset.games[1]);
    state.send.mockRejectedValueOnce(new Error('Response lost'));
    await component.submit();
    expect(component.selected()).toBe(dataset.games[1]);
    expect(component.error()).toContain('Retry the same answer');
    await component.submit();
    expect(state.send.mock.calls).toHaveLength(2);
    expect(state.send.mock.calls[1]).toEqual(state.send.mock.calls[0]);
    expect(component.selected()).toBeNull();
    expect(sessionStorage.getItem('last-link-pending:match-one')).toBeNull();
    component.ngOnDestroy();
  });

  it('shows rejection while preserving the server deadline, counters, and selected title', async () => {
    const { state } = classFixture();
    const original = state.match()!;
    const component = TestBed.runInInjectionContext(() => new MatchComponent());
    TestBed.tick();
    component.selected.set(dataset.games[1]);
    state.send.mockResolvedValueOnce({ ...success(), ok: false, reason: 'exhausted_connector' });
    await component.submit();
    expect(component.error()).toContain('3/3');
    expect(component.selected()).toBe(dataset.games[1]);
    expect(state.match()).toBe(original);
    expect(state.match()?.deadline).toBe(original.deadline);
    expect(state.match()?.state.usage).toEqual({});
    component.ngOnDestroy();
  });

  it('ignores keyboard and pointer selection while the search is disabled', () => {
    const search = new GameSearchComponent();
    search.games = dataset.games;
    search.disabled = true;
    search.text.set('Test');
    search.open.set(true);
    const selected = vi.fn();
    search.selected.subscribe(selected);
    search.choose(dataset.games[1]);
    search.key({ key: 'Enter', preventDefault() {} } as KeyboardEvent);
    expect(selected).not.toHaveBeenCalled();
    expect(search.query.value).toBe('');
  });

  it('invalidates an autocomplete selection when the user types another query', () => {
    const search = new GameSearchComponent();
    search.games = dataset.games;
    const selected = vi.fn();
    search.selected.subscribe(selected);
    search.ngOnInit();
    search.choose(dataset.games[1]);
    expect(selected).toHaveBeenLastCalledWith(dataset.games[1]);
    search.query.setValue('Different title');
    expect(selected).toHaveBeenLastCalledWith(null);
    search.ngOnDestroy();
  });
});

describe('Room, result, and timer behavior', () => {
  it('submits the chosen category, player name, and command receipt to the match service', async () => {
    const { state, router } = classFixture(null);
    const component = TestBed.runInInjectionContext(() => new RoomsComponent());
    component.chooseCategory('games');
    component.form.controls.name.setValue('Diogo');
    state.send.mockResolvedValueOnce({ ...success(), room: room() });
    await component.act('create');
    expect(state.send).toHaveBeenCalledWith('create', { name: 'Diogo', category: 'games' }, receiptId);
    expect(router.navigate).toHaveBeenCalledWith(['/rooms', 'room-one']);
    component.ngOnDestroy();
  });

  it('starts the supplied room and navigates to the returned match', async () => {
    const { state, router } = classFixture(null);
    state.room.set(room());
    const component = TestBed.runInInjectionContext(() => new RoomsComponent());
    state.send.mockResolvedValueOnce({ ...success(), match: match() });
    await component.start();
    expect(state.send).toHaveBeenCalledWith('start', { roomId: 'room-one' });
    expect(router.navigate).toHaveBeenCalledWith(['/match', 'match-one']);
    component.ngOnDestroy();
  });

  it('derives victory, defeat, history, and usage from the supplied authoritative result', () => {
    const finished: Match = {
      ...match(), status: 'finished', winnerId: 'host', endReason: 'timeout', endedAt: new Date().toISOString(),
      state: { ...match().state, usage: { person: 3 } },
    };
    const { state } = classFixture(finished);
    const component = TestBed.runInInjectionContext(() => new ResultsComponent());
    TestBed.tick();
    expect(component.won).toBe(true);
    expect(component.winner).toBe('Diogo');
    expect(component.title('seed')).toBe('Starting title (2000)');
    expect(component.usage).toEqual([{ id: 'person', name: 'Test composer', count: 3 }]);
    state.match.set({ ...finished, winnerId: 'guest' });
    TestBed.tick();
    expect(component.won).toBe(false);
    expect(component.winner).toBe('Alex');
    component.ngOnDestroy();
  });

  it('displays the server deadline as twenty seconds and emits expiry once', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T18:00:00Z'));
    const clock = new TurnClockComponent();
    const elapsed = vi.fn();
    clock.elapsed.subscribe(elapsed);
    clock.deadline = new Date(Date.now() + 20000).toISOString();
    clock.ngOnInit();
    expect(clock.seconds).toBe(20);
    expect(clock.progress).toBe(100);
    vi.advanceTimersByTime(5000);
    expect(clock.seconds).toBe(15);
    expect(clock.progress).toBe(75);
    vi.advanceTimersByTime(16000);
    expect(clock.seconds).toBe(0);
    expect(elapsed).toHaveBeenCalledTimes(1);
    clock.ngOnDestroy();
    vi.advanceTimersByTime(20000);
    expect(elapsed).toHaveBeenCalledTimes(1);
  });
});

describe('Routed player journey', () => {
  function fixture() {
    const state = game();
    const serverRoom = room();
    let serverMatch: Match | null = null;
    state.watch.mockImplementation(async (kind) => {
      state.room.set(serverRoom);
      state.match.set(kind === 'match' ? serverMatch : null);
    });
    state.send.mockImplementation(async (action) => {
      if (action === 'create') return { ...success(), room: serverRoom };
      if (action === 'start') { serverMatch = match(); return { ...success(), match: serverMatch }; }
      return success();
    });
    TestBed.configureTestingModule({ providers: [
      provideRouter(routes),
      { provide: ConfigService, useValue: config },
      { provide: CatalogueService, useValue: catalogue() },
      { provide: MatchService, useValue: state },
      { provide: REQUEST_ID, useValue: () => receiptId },
    ] });
    return {
      state,
      finish() {
        serverMatch = { ...serverMatch!, status: 'finished', winnerId: 'host', endReason: 'timeout', endedAt: new Date().toISOString() };
        state.match.set(serverMatch);
      },
    };
  }

  it('navigates Home to Category, Room, Lobby, Match, and Result with normal routes', async () => {
    const { state, finish } = fixture();
    const harness = await RouterTestingHarness.create('/');
    expect(harness.routeNativeElement?.querySelector('#home-title')?.textContent).toContain('Your brain');
    await harness.navigateByUrl('/play');
    expect(harness.routeNativeElement?.querySelector<HTMLButtonElement>('.ll-choice-music button')?.disabled).toBe(true);
    const setup = await harness.navigateByUrl('/rooms?category=games', RoomsComponent);
    expect(setup.category()).toBe('games');
    setup.form.controls.name.setValue('Diogo');
    await setup.act('create');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/rooms/room-one');
    expect(state.watch).toHaveBeenCalledWith('room', 'room-one');
    const lobby = harness.routeDebugElement!.componentInstance as RoomsComponent;
    await lobby.start();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/match/match-one');
    expect(state.watch).toHaveBeenCalledWith('match', 'match-one');
    expect(harness.routeNativeElement?.textContent).toContain('Starting title');
    finish();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/results/match-one');
    expect(harness.routeDebugElement!.componentInstance).toBeInstanceOf(ResultsComponent);
    expect((harness.routeDebugElement!.componentInstance as ResultsComponent).winner).toBe('Diogo');
  });

  it('retains Games category links from the existing URL format', async () => {
    fixture();
    const harness = await RouterTestingHarness.create('/play/games');
    expect(TestBed.inject(Router).url).toBe('/rooms?category=games');
    expect((harness.routeDebugElement!.componentInstance as RoomsComponent).category()).toBe('games');
  });

  it('shows a contextual return only on overview pages and removes the permanent Resume link', async () => {
    fixture();
    const resume = { target: signal<SessionReturn | null>({
      kind: 'match', id: 'match-one', label: 'Rejoin match', category: 'Games',
    }), setVisible: vi.fn() };
    TestBed.overrideProvider(ResumeService, { useValue: resume });
    const shell = TestBed.createComponent(App);
    shell.detectChanges();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/rooms?category=games');
    await shell.whenStable();
    const setupElement = shell.nativeElement.querySelector('app-rooms');
    expect(setupElement).not.toBeNull();
    const state = TestBed.inject(MatchService);
    await state.send('start', { roomId: 'room-one' });
    await router.navigateByUrl('/match/match-one');
    await shell.whenStable();
    shell.detectChanges();
    expect(shell.nativeElement.querySelector('.site-header a[href="/match/match-one"]')).toBeNull();
    expect(shell.nativeElement.querySelector('.session-return')).toBeNull();
    await router.navigateByUrl('/');
    await shell.whenStable();
    shell.detectChanges();
    expect(shell.nativeElement.querySelector('.session-return a')?.textContent).toContain('Rejoin match');
    expect(resume.setVisible).toHaveBeenLastCalledWith(true);
    resume.target.set(null);
    shell.detectChanges();
    expect(shell.nativeElement.querySelector('.session-return')).toBeNull();
    expect(shell.nativeElement.querySelector('.wordmark-name')?.textContent).toContain('The Last Link');
    shell.checkNoChanges();
  });

  it('opens a Movies catalogue directly and displays published titles', async () => {
    fixture();
    const harness = await RouterTestingHarness.create('/catalogue?category=movies');
    expect(TestBed.inject(CatalogueService).loadCategory).toHaveBeenCalledWith('movies');
    expect(harness.routeNativeElement?.textContent).toContain('Test answer');
  });
});

describe('Isolated visual preview', () => {
  it('loads local assets without constructing a backend and restores the real resume ID', async () => {
    vi.useFakeTimers();
    const router = { url: '/design-review/match/design-review-movies-match' };
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: Router, useValue: router },
      { provide: ConfigService, useValue: config },
      { provide: BackendService, useFactory: () => { throw Error('Preview attempted to construct a live backend'); } },
      ReviewCatalogueService, ReviewMatchService,
    ] });
    const http = TestBed.inject(HttpTestingController);
    const loader = TestBed.inject(ReviewCatalogueService);
    const loaded = new Promise<Dataset>((resolve) => loader.loadCategory('movies').subscribe(resolve));
    http.expectOne('movies-index-v1.json').flush({ datasetId: 'movies-tmdb-2017-v1', category: 'movies', movies: [], entities: {} });
    expect((await loaded).category).toBe('movies');
    const preview = TestBed.inject(ReviewMatchService);
    localStorage.setItem('last-link-resume', 'real-match-id');
    await preview.watch('match', 'design-review-movies-match');
    expect(preview.match()?.state.version).toBe(8);
    localStorage.setItem('last-link-resume', 'design-review-movies-match');
    preview.stop();
    expect(localStorage.getItem('last-link-resume')).toBe('real-match-id');
    http.verify();
  });
});
