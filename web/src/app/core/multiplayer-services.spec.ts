import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendService } from './backend.service';
import { CatalogueService } from './catalogue.service';
import { ConfigService } from './config.service';
import { MatchService } from './match.service';
import { MOVIES_VERSION } from './models';
import type { AppConfiguration, CommandResponse, Match } from './models';

// All Auth and Realtime responses below are test doubles. No live service is used.
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const configuration: AppConfiguration = {
  supabaseUrl: 'https://example.supabase.co',
  supabasePublishableKey: 'sb_publishable_synthetic_test',
  catalogueId: 'games-reviewed-2026-10-21-v1',
  transport: 'edge',
};
const receiptId = '00000000-0000-4000-8000-000000000001';
const success: CommandResponse = {
  ok: true,
  duplicate: false,
  serverTime: '2026-10-27T18:00:00.000Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Public configuration', () => {
  function fixture() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      service: TestBed.inject(ConfigService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('loads public settings through a relative HTTP asset URL', async () => {
    const { service, http } = fixture();
    const pending = service.load();
    http.expectOne('config.json').flush(configuration);
    await pending;
    expect(service.configured).toBe(true);
    expect(service.value.transport).toBe('edge');
    expect(service.issue()).toBe('');
    http.verify();
  });

  it('refuses a private key even when the configuration request succeeds', async () => {
    const { service, http } = fixture();
    const pending = service.load();
    http.expectOne('config.json').flush({
      ...configuration,
      supabasePublishableKey: 'sb_secret_synthetic_test',
    });
    await pending;
    expect(service.configured).toBe(false);
    expect(service.value.supabasePublishableKey).toBe('');
    expect(service.issue()).toMatch(/secret key/i);
    http.verify();
  });

  it('reports a failed configuration request without inventing multiplayer state', async () => {
    const { service, http } = fixture();
    const pending = service.load();
    http.expectOne('config.json').flush('unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    });
    await pending;
    expect(service.configured).toBe(false);
    expect(service.issue()).not.toBe('');
    http.verify();
  });
});

describe('Authenticated match transport', () => {
  function fixture() {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: 'player-one' } } },
      error: null,
    });
    const signInAnonymously = vi.fn().mockResolvedValue({
      data: { user: { id: 'new-player' } },
      error: null,
    });
    const invoke = vi.fn().mockResolvedValue({ data: success, error: null });
    const rpc = vi.fn();
    const onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
    const client = {
      auth: { getSession, signInAnonymously, onAuthStateChange },
      functions: { invoke },
      rpc,
    };
    vi.mocked(createClient).mockReturnValue(client as unknown as ReturnType<typeof createClient>);
    TestBed.configureTestingModule({
      providers: [{ provide: ConfigService, useValue: { configured: true, value: configuration } }],
    });
    return { service: TestBed.inject(BackendService), getSession, signInAnonymously, invoke, rpc };
  }

  it('restores the session and preserves the command receipt ID when invoking match-api', async () => {
    const { service, getSession, signInAnonymously, invoke, rpc } = fixture();
    await service.command('snapshot', { matchId: 'match-one' }, receiptId);
    expect(service.playerId()).toBe('player-one');
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('match-api', {
      body: { action: 'snapshot', payload: { matchId: 'match-one' }, requestId: receiptId },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shares one anonymous sign-in between concurrent commands', async () => {
    const { service, getSession, signInAnonymously, invoke } = fixture();
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const signingIn = deferred<{ data: { user: { id: string } }; error: null }>();
    signInAnonymously.mockReturnValue(signingIn.promise);
    const first = service.command('room', { roomId: 'room-one' }, receiptId);
    const second = service.command('snapshot', { matchId: 'match-one' }, receiptId);
    await vi.waitFor(() => expect(signInAnonymously).toHaveBeenCalledTimes(1));
    signingIn.resolve({ data: { user: { id: 'new-player' } }, error: null });
    await Promise.all([first, second]);
    expect(service.playerId()).toBe('new-player');
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('exposes an API error instead of treating it as an accepted answer', async () => {
    const { service, invoke } = fixture();
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'HTTP error',
        context: new Response(JSON.stringify({ error: 'authentication_required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    });
    await expect(service.command('submit', {}, receiptId)).rejects.toThrow(
      'authentication_required',
    );
  });

  it('allows a later attempt after session restoration fails', async () => {
    const { service, getSession, invoke } = fixture();
    getSession.mockRejectedValueOnce(new Error('Connection interrupted'));
    await expect(service.command('snapshot', {}, receiptId)).rejects.toThrow(
      'Connection interrupted',
    );
    expect(invoke).not.toHaveBeenCalled();
    await expect(service.command('snapshot', {}, receiptId)).resolves.toEqual(success);
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('tracks visible activity without creating identities for cold visits', async () => {
    vi.useFakeTimers();
    const { service, getSession, signInAnonymously, rpc } = fixture();
    service.enableActivityTracking();
    await vi.advanceTimersByTimeAsync(60000);
    expect(getSession).not.toHaveBeenCalled();
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    await service.initialize();
    expect(rpc).toHaveBeenCalledWith('account_heartbeat');
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    rpc.mockClear();
    await vi.advanceTimersByTimeAsync(120000);
    expect(rpc).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rpc).toHaveBeenCalledOnce();
    service.ngOnDestroy();
    await vi.advanceTimersByTimeAsync(120000);
    expect(rpc).toHaveBeenCalledOnce();
  });
});

describe('Published catalogue HTTP requests', () => {
  function fixture(configured = true) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { configured, value: configuration } },
      ],
    });
    return {
      service: TestBed.inject(CatalogueService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('pins the requested publication and retains all five Movie credit roles', async () => {
    const { service, http } = fixture();
    const entry = {
      id: 'tmdb:movie:1',
      category: 'movies' as const,
      title: 'Test title',
      credits: {},
    };
    const pending = firstValueFrom(service.load('movies-fixture-v1'));
    const request = http.expectOne((r) => r.url.endsWith('/rest/v1/catalogues'));
    expect(request.request.params.get('id')).toBe('eq.movies-fixture-v1');
    expect(request.request.params.get('published')).toBe('eq.true');
    expect(request.request.headers.get('apikey')).toBe(configuration.supabasePublishableKey);
    request.flush([
      { snapshot: { datasetId: 'movies-fixture-v1', category: 'movies', movies: [entry] } },
    ]);
    const catalogue = await pending;
    const detail = firstValueFrom(service.details(catalogue, entry));
    const detailsRequest = http.expectOne(
      configuration.supabaseUrl + '/rest/v1/rpc/movie_credit_details',
    );
    expect(detailsRequest.request.body).toEqual({
      p_catalogue_id: catalogue.datasetId,
      p_entry_id: entry.id,
    });
    const roles = ['actor', 'director', 'writer', 'composer', 'cinematographer'] as const;
    detailsRequest.flush(
      roles.map((role) => ({
        entityId: 'tmdb:person:1',
        name: 'Test person',
        role,
        sourceCredits: [{ job: role }],
      })),
    );
    const result = await detail;
    expect(Object.keys(result.credits)).toEqual([...roles]);
    expect(Object.keys(result.people ?? {})).toEqual(['tmdb:person:1']);
    http.verify();
  });

  it('reports an HTTP failure and permits another subscription to retry', async () => {
    const { service, http } = fixture();
    const request$ = service.load();
    const failed = firstValueFrom(request$);
    const rejected = expect(failed).rejects.toThrow();
    http
      .expectOne((r) => r.url.endsWith('/rest/v1/catalogues'))
      .flush('unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
      });
    await rejected;
    const retried = firstValueFrom(request$);
    http
      .expectOne((r) => r.url.endsWith('/rest/v1/catalogues'))
      .flush([
        {
          snapshot: { datasetId: configuration.catalogueId, category: 'games', games: [] },
        },
      ]);
    expect((await retried).datasetId).toBe(configuration.catalogueId);
    http.verify();
  });

  it('uses relative published-data assets when multiplayer is unconfigured', async () => {
    const { service, http } = fixture(false);
    const entry = {
      id: 'tmdb:movie:1',
      category: 'movies' as const,
      title: 'Test title',
      credits: {},
      detailShard: 7,
    };
    const pending = firstValueFrom(service.load(MOVIES_VERSION));
    http.expectOne('movies-index-v1.json').flush({
      datasetId: MOVIES_VERSION,
      category: 'movies',
      movies: [entry],
    });
    const catalogue = await pending;
    const detail = firstValueFrom(service.details(catalogue, entry));
    http.expectOne(`movies/${MOVIES_VERSION}/credits-7.json`).flush({ [entry.id]: entry });
    expect((await detail).id).toBe(entry.id);
    http.verify();
  });
});

describe('Authoritative match synchronization', () => {
  it('heartbeats a lobby per tab, survives backgrounding, and treats page close as a best-effort disconnect', async () => {
    vi.useFakeTimers();
    const channel={on:vi.fn(()=>channel),subscribe:vi.fn(()=>channel)};
    const room={id:'room-one',hostId:'player-one',status:'waiting',revision:1,players:[{id:'player-one',name:'Diogo'}]};
    const command=vi.fn().mockResolvedValue({...success,room});
    TestBed.configureTestingModule({providers:[{provide:BackendService,useValue:{
      onIdentityChange:()=>()=>{},playerId:signal('player-one'),identity:async()=>{},command,
      client:{channel:()=>channel,removeChannel:vi.fn().mockResolvedValue('ok')},
    }}]});
    const service=TestBed.inject(MatchService); await service.watch('room','room-one');
    const key=command.mock.calls[0][1].clientId; expect(key).toMatch(/^[a-f0-9-]{36}$/);
    vi.spyOn(document,'hidden','get').mockReturnValue(true); await vi.advanceTimersByTimeAsync(4000);
    expect(command).toHaveBeenLastCalledWith('room',{roomId:'room-one',clientId:key},expect.any(String));
    window.dispatchEvent(new Event('pagehide')); expect(command).toHaveBeenLastCalledWith('lobby_disconnect',{roomId:'room-one',clientId:key});
    await Promise.resolve();
    command.mockResolvedValueOnce({...success,ok:false,reason:'lobby_seat_expired'});
    window.dispatchEvent(new Event('pageshow')); await vi.advanceTimersByTimeAsync(0);
    expect(service.connection()).toBe('Unavailable'); expect(service.room()).toBeNull();
    expect(service.error()).toContain('seat expired');
    const count=command.mock.calls.length; window.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(8000);
    expect(command).toHaveBeenCalledTimes(count);
  });
  function snapshot(revision: number): Match {
    return {
      id: 'match-one',
      roomId: 'room-one',
      catalogueId: configuration.catalogueId,
      category: 'games',
      status: 'active',
      activePlayer: 'player-one',
      deadline: '2026-10-27T18:00:20.000Z',
      revision,
      winnerId: null,
      endReason: null,
      endedAt: null,
      turns: [],
      state: {
        datasetId: configuration.catalogueId,
        category: 'games',
        currentGameId: 'game-one',
        history: ['game-one'],
        usage: {},
        version: revision,
      },
      room: {
        id: 'room-one',
        code: 'ABCDEF123456',
        hostId: 'player-one',
        guestId: 'player-two',
        category: 'games',
        status: 'playing',
        matchId: 'match-one',
        revision,
        players: [],
      },
    };
  }

  it('rejects older revisions and responses that arrive after stop', async () => {
    const pending: ReturnType<typeof deferred<CommandResponse>>[] = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: BackendService,
          useValue: {
            onIdentityChange: () => () => {},
            playerId: signal('player-one'),
            command: () => {
              const result = deferred<CommandResponse>();
              pending.push(result);
              return result.promise;
            },
          },
        },
      ],
    });
    const service = TestBed.inject(MatchService);
    const first = service.send('snapshot', {}, receiptId);
    const second = service.send('snapshot', {}, receiptId);
    pending[1].resolve({ ...success, match: snapshot(2) });
    await second;
    pending[0].resolve({ ...success, match: snapshot(1) });
    await first;
    expect(service.match()?.revision).toBe(2);
    const stopped = service.send('snapshot', {}, receiptId);
    service.stop();
    pending[2].resolve({ ...success, match: snapshot(3) });
    await stopped;
    expect(service.match()?.revision).toBe(2);
  });

  it('refreshes after Realtime updates and releases its channel, polling, and listeners', async () => {
    vi.useFakeTimers();
    let updated!: () => void;
    let statusChanged!: (status: string) => void;
    const channel = {
      on: vi.fn((_event: string, _filter: unknown, callback: () => void) => {
        updated = callback;
        return channel;
      }),
      subscribe: vi.fn((callback: (status: string) => void) => {
        statusChanged = callback;
        return channel;
      }),
    };
    const removeChannel = vi.fn().mockResolvedValue('ok');
    const openChannel = vi.fn(() => channel);
    const command = vi.fn().mockResolvedValue({ ...success, match: snapshot(1) });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: BackendService,
          useValue: {
            onIdentityChange: () => () => {},
            playerId: signal('player-one'),
            identity: async () => {},
            command,
            client: { channel: openChannel, removeChannel },
          },
        },
      ],
    });
    const service = TestBed.inject(MatchService);
    await service.watch('match', 'match-one');
    expect(openChannel).toHaveBeenCalledWith('last-link:match:match-one', {
      config: { postgres_changes_options: { wait: true, timeout: 10000 } },
    });
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'matches',
        filter: 'id=eq.match-one',
      },
      expect.any(Function),
    );
    statusChanged('SUBSCRIBED');
    expect(service.connection()).toBe('Live');
    updated();
    await vi.advanceTimersByTimeAsync(4000);
    expect(command.mock.calls.length).toBeGreaterThanOrEqual(4);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const callsWhileHidden = command.mock.calls.length;
    await vi.advanceTimersByTimeAsync(8000);
    expect(command).toHaveBeenCalledTimes(callsWhileHidden);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(command).toHaveBeenCalledTimes(callsWhileHidden + 1);
    command.mockRejectedValueOnce(Error('match_not_found'));
    localStorage.setItem('last-link-resume', 'match-one');
    updated();
    await Promise.resolve();
    await Promise.resolve();
    expect(service.connection()).toBe('Unavailable');
    expect(service.match()).toBeNull();
    expect(service.room()).toBeNull();
    expect(service.error()).toMatch(/24 hours/);
    expect(localStorage.getItem('last-link-resume')).toBeNull();
    const callsBeforeStop = command.mock.calls.length;
    service.stop();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    updated();
    await vi.advanceTimersByTimeAsync(8000);
    expect(command).toHaveBeenCalledTimes(callsBeforeStop);
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
