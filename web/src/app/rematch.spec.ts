import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './app.routes';
import { ConfigService } from './core/config.service';
import { CatalogueService } from './core/catalogue.service';
import { MatchService } from './core/match.service';
import type { CommandResponse, Dataset, Match } from './core/models';
import { ResultsComponent } from './pages/results.component';
import { REQUEST_ID } from './shared/request-id';

// Server and transport doubles only. The real SQL path has separate PostgreSQL tests.
const dataset: Dataset = {
  datasetId: 'games-rematch-test',
  category: 'games',
  games: [
    { id: 'seed', category: 'games', title: 'Opening title', credits: {} },
    { id: 'answer', category: 'games', title: 'Another title', credits: {} },
  ],
  entities: { person: { id: 'person', name: 'Synthetic composer' } },
};
const reply = (): CommandResponse => ({
  ok: true,
  duplicate: false,
  serverTime: new Date().toISOString(),
});
function result(): Match {
  return {
    id: 'finished-one',
    roomId: 'same-room',
    category: 'games',
    catalogueId: dataset.datasetId,
    status: 'finished',
    activePlayer: 'guest',
    deadline: new Date(Date.now() - 10000).toISOString(),
    endedAt: new Date(Date.now() - 10000).toISOString(),
    winnerId: 'host',
    endReason: 'timeout',
    revision: 2,
    state: {
      datasetId: dataset.datasetId,
      category: 'games',
      currentGameId: 'answer',
      history: ['seed', 'answer'],
      usage: { person: 3 },
      version: 1,
    },
    turns: [
      {
        index: 0,
        entryId: 'seed',
        playerId: null,
        connectors: [],
        acceptedAt: new Date(Date.now() - 30000).toISOString(),
      },
      {
        index: 1,
        entryId: 'answer',
        playerId: 'host',
        connectors: [{ entityId: 'person', name: 'Synthetic composer', types: ['composer'] }],
        acceptedAt: new Date(Date.now() - 10000).toISOString(),
      },
    ],
    room: {
      id: 'same-room',
      code: 'REMATCH2026A',
      hostId: 'host',
      guestId: 'guest',
      category: 'games',
      status: 'finished',
      matchId: 'finished-one',
      revision: 3,
      players: [
        { id: 'host', name: 'Diogo' },
        { id: 'guest', name: 'Alex' },
      ],
    },
    rematch: {
      available: true,
      requestedBy: [],
      expiresAt: {},
      nextMatchId: null,
      nextStatus: null,
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

function fixture() {
  const rounds = new Map<string, Match>([['finished-one', result()]]);
  const state = {
    room: signal<Match['room'] | null>(null),
    match: signal<Match | null>(null),
    backend: { playerId: signal('host') },
    clockOffset: signal(0),
    connection: signal('Live'),
    error: signal(''),
    stop: vi.fn(),
    watch: vi.fn(async (_kind: string, id: string) => {
      const m = rounds.get(id)!;
      state.room.set(m.room);
      state.match.set(structuredClone(m));
    }),
    send: vi.fn<(...args: any[]) => Promise<CommandResponse>>(async (action, payload) => {
      const m = rounds.get(payload.matchId)!;
      const rematch = structuredClone(m.rematch!);
      rematch.requestedBy = rematch.requestedBy.filter((id) => id !== 'host');
      delete rematch.expiresAt['host'];
      if (action === 'rematch') {
        rematch.requestedBy.push('host');
        rematch.expiresAt['host'] = new Date(Date.now() + 120000).toISOString();
      }
      const updated = { ...m, revision: m.revision + 1, rematch };
      rounds.set(m.id, updated);
      publish(updated);
      return { ...reply(), match: rounds.get(m.id)! };
    }),
  };
  function publish(m: Match) {
    if (m.rematch?.requestedBy.includes('host') && m.rematch.requestedBy.includes('guest')) {
      const next: Match = {
        ...m,
        id: 'rematch-one',
        status: 'active',
        winnerId: null,
        endReason: null,
        endedAt: null,
        revision: 0,
        activePlayer: 'host',
        deadline: new Date(Date.now() + 20000).toISOString(),
        state: { ...m.state, currentGameId: 'seed', history: ['seed'], usage: {}, version: 0 },
        room: { ...m.room, status: 'playing', matchId: 'rematch-one' },
        turns: [
          {
            index: 0,
            entryId: 'seed',
            playerId: null,
            connectors: [],
            acceptedAt: new Date().toISOString(),
          },
        ],
        rematch: {
          available: false,
          requestedBy: [],
          expiresAt: {},
          nextMatchId: null,
          nextStatus: null,
        },
      };
      rounds.set(next.id, next);
      m = {
        ...m,
        room: next.room,
        rematch: { ...m.rematch, available: false, nextMatchId: next.id, nextStatus: 'active' },
      };
      rounds.set(m.id, m);
    }
    rounds.set(m.id, m);
    state.match.set(structuredClone(m));
    state.room.set(m.room);
  }
  let sequence = 0;
  const ids = vi.fn(() => `receipt-${++sequence}`);
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      {
        provide: ConfigService,
        useValue: {
          configured: true,
          issue: signal(''),
          value: {
            supabaseUrl: 'https://example.invalid',
            supabasePublishableKey: 'sb_publishable_test',
            catalogueId: dataset.datasetId,
            transport: 'edge',
          },
        },
      },
      {
        provide: CatalogueService,
        useValue: { load: vi.fn(() => of(dataset)), loadCategory: vi.fn(() => of(dataset)) },
      },
      { provide: MatchService, useValue: state },
      { provide: REQUEST_ID, useValue: ids },
    ],
  });
  return {
    state,
    rounds,
    ids,
    rival() {
      const m = rounds.get('finished-one')!;
      publish({
        ...m,
        revision: m.revision + 1,
        rematch: {
          ...m.rematch!,
          requestedBy: [...new Set([...m.rematch!.requestedBy, 'guest'])],
          expiresAt: {
            ...m.rematch!.expiresAt,
            guest: new Date(Date.now() + 120000).toISOString(),
          },
        },
      });
    },
  };
}

describe('Mutual rematch interface', () => {
  it('requests once, waits for the rival, then follows the server to a clean match in the same room', async () => {
    const f = fixture(),
      harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/results/finished-one', ResultsComponent);
    const original = structuredClone(f.rounds.get('finished-one')!.state);
    expect(f.state.send).not.toHaveBeenCalled();
    expect(component.canRematch).toBe(true);
    await component.rematch();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(f.state.send).toHaveBeenCalledWith('rematch', { matchId: 'finished-one' }, 'receipt-1');
    expect(TestBed.inject(Router).url).toBe('/results/finished-one');
    expect(harness.routeNativeElement?.textContent).toContain('Waiting for Alex');
    expect(
      harness.routeNativeElement?.querySelector<HTMLButtonElement>('.ll-rematch-panel .ll-action')
        ?.disabled,
    ).toBe(true);
    f.rival();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/match/rematch-one');
    expect(f.state.watch).toHaveBeenLastCalledWith('match', 'rematch-one');
    expect(f.state.match()!.state).toMatchObject({ history: ['seed'], usage: {}, version: 0 });
    expect(f.state.match()!.room.id).toBe('same-room');
    expect(f.rounds.get('finished-one')!.state).toEqual(original);
    expect(localStorage.getItem('last-link-resume')).toBe('rematch-one');
  });

  it('shows Accept rematch when the rival requests first', async () => {
    const f = fixture();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/results/finished-one', ResultsComponent);
    f.rival();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Alex wants a rematch');
    const button = harness.routeNativeElement?.querySelector<HTMLButtonElement>(
      '.ll-rematch-panel .ll-action',
    );
    expect(button?.textContent).toContain('Accept rematch');
    button?.click();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/match/rematch-one'));
  });

  it('cancels a pending request and restores the available button', async () => {
    const f = fixture(),
      harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/results/finished-one', ResultsComponent);
    await component.rematch();
    await harness.fixture.whenStable();
    await component.rematch('cancel_rematch');
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(f.state.send).toHaveBeenLastCalledWith(
      'cancel_rematch',
      { matchId: 'finished-one' },
      'receipt-2',
    );
    expect(component.requested).toBe(false);
    expect(f.rounds.size).toBe(1);
    expect(harness.routeNativeElement?.querySelector('.ll-rematch-cancel')).toBeNull();
    expect(
      harness.routeNativeElement?.querySelector<HTMLButtonElement>('.ll-rematch-panel .ll-action')
        ?.disabled,
    ).toBe(false);
  });

  it('shows a retryable error and preserves the request ID after a network failure', async () => {
    const f = fixture(),
      harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/results/finished-one', ResultsComponent);
    f.state.send.mockRejectedValueOnce(Error('Connection interrupted'));
    await component.rematch();
    harness.detectChanges();
    expect(component.rematchBusy()).toBe(false);
    expect(
      harness.routeNativeElement?.querySelector('.ll-rematch-panel [role=alert]'),
    ).not.toBeNull();
    await component.rematch();
    expect(f.state.send.mock.calls[0]![2]).toBe(f.state.send.mock.calls[1]![2]);
    expect(f.ids).toHaveBeenCalledTimes(1);
  });

  it('ignores expired readiness and disables rematch when the backend has not supplied the feature', async () => {
    const f = fixture();
    const m = f.rounds.get('finished-one')!;
    m.rematch!.requestedBy = ['host', 'guest'];
    m.rematch!.expiresAt = {
      host: new Date(Date.now() - 1000).toISOString(),
      guest: new Date(Date.now() - 1000).toISOString(),
    };
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/results/finished-one', ResultsComponent);
    expect(component.requested).toBe(false);
    expect(component.rivalRequested).toBe(false);
    const legacy = structuredClone(m);
    delete legacy.rematch;
    f.state.match.set(legacy);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain(
      'Rematches aren’t available on this server yet',
    );
    expect(
      harness.routeNativeElement?.querySelector<HTMLButtonElement>('.ll-rematch-panel .ll-action')
        ?.disabled,
    ).toBe(true);
  });

  it('keeps an old result readable and reloads another finished result when route parameters change', async () => {
    const f = fixture(),
      old = f.rounds.get('finished-one')!;
    const next: Match = {
      ...structuredClone(old),
      id: 'rematch-one',
      room: { ...old.room, matchId: 'rematch-one' },
    };
    old.rematch = {
      ...old.rematch!,
      available: false,
      nextMatchId: next.id,
      nextStatus: 'finished',
    };
    f.rounds.set(next.id, next);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/results/finished-one', ResultsComponent);
    expect(TestBed.inject(Router).url).toBe('/results/finished-one');
    expect(harness.routeNativeElement?.textContent).toContain('View rematch result');
    await harness.navigateByUrl('/results/rematch-one', ResultsComponent);
    expect(f.state.watch).toHaveBeenLastCalledWith('match', 'rematch-one');
    expect(f.state.match()!.id).toBe('rematch-one');
  });

  it('prevents duplicate clicks while sending and ignores a late error after navigating away', async () => {
    const f = fixture(),
      harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/results/finished-one', ResultsComponent);
    let fail!: (error: Error) => void;
    f.state.send.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const sending = component.rematch();
    await component.rematch();
    harness.detectChanges();
    expect(f.state.send).toHaveBeenCalledTimes(1);
    expect(component.rematchBusy()).toBe(true);
    await harness.navigateByUrl('/');
    fail(Error('Late connection error'));
    await sending;
    expect(component.rematchError()).toBe('');
    expect(TestBed.inject(Router).url).toBe('/');
  });
});
