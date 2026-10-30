import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './app.routes';
import { CatalogueService } from './core/catalogue.service';
import { ConfigService } from './core/config.service';
import { MatchService } from './core/match.service';
import { FOOTBALL_VERSION, type Dataset, type Match, type Room } from './core/models';
import { RoomsComponent } from './pages/rooms.component';
import { REQUEST_ID } from './shared/request-id';
import { GameSearchComponent } from './shared/game-search.component';

const dataset: Dataset = {
  datasetId: FOOTBALL_VERSION,
  category: 'football',
  entities: {},
  games: [
    {
      id: 'wikidata:club:Q18656',
      category: 'football',
      title: 'Manchester United',
      aliases: ['Man Utd'],
      countries: ['United Kingdom'],
      credits: {},
    },
    {
      id: 'wikidata:club:Q8682',
      category: 'football',
      title: 'Real Madrid',
      countries: ['Spain'],
      credits: {},
    },
  ],
};
const config = {
  configured: true,
  issue: signal(''),
  value: {
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_publishable_test',
    catalogueId: 'games-test-v1',
    transport: 'edge',
  },
};
const opener = {
  mode: 'familiar',
  label: 'Familiar favourites',
  pool_id: 'football-familiar-test',
  entries: 27,
} as const;
const room: Room = {
  id: 'football-room',
  code: 'FOOTBALL2026',
  category: 'football',
  openingMode: 'familiar',
  openingPoolId: opener.pool_id,
  hostId: 'host',
  guestId: 'guest',
  status: 'ready',
  matchId: null,
  revision: 1,
  players: [
    { id: 'host', name: 'Diogo' },
    { id: 'guest', name: 'Alex' },
  ],
};
const result = () => ({ ok: true, duplicate: false, serverTime: new Date().toISOString() });
const active = (): Match => ({
  id: 'football-match',
  roomId: room.id,
  catalogueId: FOOTBALL_VERSION,
  category: 'football',
  status: 'active',
  activePlayer: 'host',
  deadline: new Date(Date.now() + 20000).toISOString(),
  revision: 1,
  winnerId: null,
  endReason: null,
  endedAt: null,
  room: { ...room, status: 'playing', matchId: 'football-match' },
  state: {
    datasetId: FOOTBALL_VERSION,
    category: 'football',
    currentGameId: dataset.games[0]!.id,
    history: [dataset.games[0]!.id],
    usage: {},
    version: 0,
  },
  turns: [
    {
      index: 0,
      playerId: null,
      entryId: dataset.games[0]!.id,
      connectors: [],
      acceptedAt: new Date().toISOString(),
    },
  ],
});

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('Football published HTTP data', () => {
  function fixture(configured = true) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { ...config, configured } },
      ],
    });
    return {
      service: TestBed.inject(CatalogueService),
      http: TestBed.inject(HttpTestingController),
    };
  }
  it('loads the published Football category, public pool options and separate person-role details', async () => {
    const { service, http } = fixture();
    const pending = firstValueFrom(service.loadCategory('football'));
    const request = http.expectOne((r) => r.url.endsWith('/rest/v1/catalogues'));
    expect(request.request.params.get('category_id')).toBe('eq.football');
    request.flush([{ snapshot: dataset }]);
    const data = await pending;
    expect(data.games).toHaveLength(2);
    const pool = firstValueFrom(service.openingOptions(data.datasetId));
    const poolRequest = http.expectOne(
      config.value.supabaseUrl + '/rest/v1/rpc/opening_pool_options',
    );
    expect(poolRequest.request.body).toEqual({ p_catalogue_id: FOOTBALL_VERSION });
    expect(poolRequest.request.headers.get('apikey')).toBe(config.value.supabasePublishableKey);
    poolRequest.flush([opener]);
    expect(await pool).toEqual([opener]);
    const details = firstValueFrom(service.details(data, data.games[0]!));
    http.expectOne(config.value.supabaseUrl + '/rest/v1/rpc/entry_credit_details').flush([
      { entityId: 'wikidata:Q1001', name: 'Synthetic person', role: 'player', sourceCredits: [] },
      { entityId: 'wikidata:Q1001', name: 'Synthetic person', role: 'manager', sourceCredits: [] },
    ]);
    const club = await details;
    expect(Object.keys(club.people!)).toEqual(['wikidata:Q1001']);
    expect(Object.keys(club.credits)).toEqual(['player', 'manager']);
    http.verify();
  });
  it('loads relative Football assets for a static preview, without backend calls', async () => {
    const { service, http } = fixture(false);
    const request = firstValueFrom(service.load(FOOTBALL_VERSION));
    http.expectOne('football-index-v1.json').flush(dataset);
    const data = await request;
    const details = firstValueFrom(service.details(data, { ...data.games[0]!, detailShard: 0 }));
    http
      .expectOne(`football/${FOOTBALL_VERSION}/credits-0.json`)
      .flush({ [data.games[0]!.id]: data.games[0] });
    expect((await details).title).toBe('Manchester United');
    const pools = firstValueFrom(service.openingOptions(FOOTBALL_VERSION));
    http.expectOne('opening-pools-v1.json').flush({ [FOOTBALL_VERSION]: [opener] });
    expect(await pools).toEqual([opener]);
    http.verify();
  });
});

describe('Football room settings and navigation', () => {
  function fixture() {
    let serverMatch: Match | null = null;
    const state = {
      room: signal<Room | null>(null),
      match: signal<Match | null>(null),
      backend: { playerId: signal('host') },
      clockOffset: signal(0),
      connection: signal('Live'),
      error: signal(''),
      stop: vi.fn(),
      send: vi.fn(async (action: string, _payload: object, _requestId?: string) => {
        if (action === 'create') return { ...result(), room };
        if (action === 'start') {
          serverMatch = active();
          return { ...result(), match: serverMatch };
        }
        return result();
      }),
      watch: vi.fn(async (kind: string) => {
        state.room.set(room);
        state.match.set(kind === 'match' ? serverMatch : null);
      }),
    };
    const catalogue = {
      loadCategory: vi.fn(() => of(dataset)),
      load: vi.fn(() => of(dataset)),
      openingOptions: vi.fn(() => of([opener])),
      details: vi.fn((_d: Dataset, g: Dataset['games'][number]) => of(g)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: ConfigService, useValue: config },
        { provide: MatchService, useValue: state },
        { provide: CatalogueService, useValue: catalogue },
        { provide: REQUEST_ID, useValue: () => 'test-receipt' },
      ],
    });
    return {
      state,
      catalogue,
      finish() {
        serverMatch = {
          ...serverMatch!,
          status: 'finished',
          winnerId: 'host',
          endReason: 'timeout',
          endedAt: new Date().toISOString(),
        };
        state.match.set(serverMatch);
      },
    };
  }

  it('keeps the Home category → Room → Lobby → Match → Result journey on Football', async () => {
    const { state, finish } = fixture();
    const harness = await RouterTestingHarness.create('/');
    expect(harness.routeNativeElement?.textContent).toContain('Football');
    harness.routeNativeElement!.querySelector<HTMLAnchorElement>('.ll-football')!.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/rooms?category=football');
    const setup = harness.routeDebugElement!.componentInstance as RoomsComponent;
    setup.form.controls.name.setValue('Diogo');
    setup.form.controls.openingMode.setValue('familiar');
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelectorAll('input[type=radio]')).toHaveLength(2);
    await setup.act('create');
    await harness.fixture.whenStable();
    expect(state.send).toHaveBeenCalledWith(
      'create',
      { name: 'Diogo', category: 'football', openingMode: 'familiar' },
      'test-receipt',
    );
    expect(TestBed.inject(Router).url).toBe('/rooms/football-room');
    expect(harness.routeNativeElement?.textContent).toContain('Familiar favourites');
    await (harness.routeDebugElement!.componentInstance as RoomsComponent).start();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/match/football-match');
    expect(harness.routeNativeElement?.textContent).toContain('Manchester United');
    expect(
      harness.routeNativeElement
        ?.querySelector('app-game-search input')
        ?.getAttribute('placeholder'),
    ).toMatch(/club/i);
    finish();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/results/football-match');
    expect(harness.routeNativeElement?.textContent).toContain('CLUBS PLAYED');
  });

  it('preserves default Standard payloads and resets the opening option when choosing Games', async () => {
    const { state, catalogue } = fixture();
    const harness = await RouterTestingHarness.create();
    const setup = await harness.navigateByUrl('/rooms?category=football', RoomsComponent);
    setup.form.controls.name.setValue('Diogo');
    await setup.act('create');
    expect(state.send).toHaveBeenCalledWith(
      'create',
      { name: 'Diogo', category: 'football' },
      'test-receipt',
    );
    expect(catalogue.openingOptions).not.toHaveBeenCalled();
    const next = await harness.navigateByUrl('/rooms?category=movies', RoomsComponent);
    next.form.controls.openingMode.setValue('familiar');
    next.chooseCategory('games');
    harness.detectChanges();
    expect(next.form.controls.openingMode.value).toBe('standard');
    expect(harness.routeNativeElement?.querySelector('fieldset.ll-opening-options')).toBeNull();
  });

  it('blocks familiar creation on missing pool or HTTP failure, with a visible error and retry state', async () => {
    const { state, catalogue } = fixture();
    const harness = await RouterTestingHarness.create();
    const setup = await harness.navigateByUrl('/rooms?category=football', RoomsComponent);
    setup.form.controls.name.setValue('Diogo');
    setup.form.controls.openingMode.setValue('familiar');
    catalogue.openingOptions.mockReturnValue(of([]));
    await setup.act('create');
    harness.detectChanges();
    expect(state.send).not.toHaveBeenCalled();
    expect(setup.busy()).toBe(false);
    expect(harness.routeNativeElement?.querySelector('[role=alert]')?.textContent).toMatch(
      /not published/i,
    );
    catalogue.openingOptions.mockReturnValue(throwError(() => Error('Connection interrupted')));
    await setup.act('create');
    expect(setup.error()).toBe('Connection interrupted');
    expect(state.send).not.toHaveBeenCalled();
    catalogue.openingOptions.mockReturnValue(of([opener]));
    await setup.act('create');
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it('searches aliases, excludes played clubs and supports Enter selection and Escape', () => {
    const search = new GameSearchComponent();
    search.category = 'football';
    search.games = dataset.games;
    const selected = vi.fn();
    search.selected.subscribe(selected);
    search.ngOnInit();
    search.query.setValue('Man Utd');
    expect(search.suggestions[0]!.title).toBe('Manchester United');
    search.key(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(selected).toHaveBeenLastCalledWith(dataset.games[0]);
    search.query.setValue('Madrid');
    search.key(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(search.open()).toBe(false);
    search.played = [dataset.games[0]!.id];
    search.query.setValue('Man Utd');
    expect(search.suggestions).toHaveLength(0);
    search.ngOnDestroy();
  });
});
