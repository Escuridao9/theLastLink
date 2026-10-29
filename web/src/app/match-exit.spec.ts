import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './app.routes';
import { CatalogueService } from './core/catalogue.service';
import { ConfigService } from './core/config.service';
import { MatchExitService } from './core/match-exit.service';
import { MatchService } from './core/match.service';
import type { CommandResponse, Dataset, Match } from './core/models';
import { MatchComponent } from './pages/match.component';
import { REQUEST_ID } from './shared/request-id';

const dataset: Dataset = {
  datasetId: 'exit-test', category: 'games', entities: {},
  games: [{ id: 'seed', title: 'Starting title', category: 'games', credits: {} }],
};
function active(): Match {
  return {
    id: 'match-one', roomId: 'room-one', category: 'games', catalogueId: dataset.datasetId,
    status: 'active', activePlayer: 'host', deadline: new Date(Date.now() + 20000).toISOString(),
    revision: 1, winnerId: null, endedAt: null, endReason: null,
    state: { datasetId: dataset.datasetId, category: 'games', currentGameId: 'seed', history: ['seed'], usage: {}, version: 0 },
    room: { id: 'room-one', code: 'ABCDEF123456', category: 'games', status: 'playing',
      matchId: 'match-one', hostId: 'host', guestId: 'guest', revision: 1,
      players: [{ id: 'host', name: 'Diogo' }, { id: 'guest', name: 'Alex' }] },
    turns: [{ index: 0, playerId: null, entryId: 'seed', acceptedAt: new Date().toISOString(), connectors: [] }],
  };
}
function finished(match: Match, reason: 'conceded' | 'timeout' = 'conceded'): Match {
  return { ...match, status: 'finished', endReason: reason, winnerId: 'guest',
    revision: match.revision + 1, endedAt: new Date().toISOString(), room: { ...match.room, status: 'finished' } };
}
function reply(match: Match): CommandResponse {
  return { ok: true, duplicate: false, serverTime: new Date().toISOString(), match };
}
function fixture() {
  const state = {
    match: signal<Match | null>(active()), room: signal(active().room),
    backend: { playerId: signal('host') }, connection: signal('Live'), error: signal(''), clockOffset: signal(0),
    watch: vi.fn(async () => {}), stop: vi.fn(),
    send: vi.fn<(action: string, payload: object, receipt?: string) => Promise<CommandResponse>>(),
  };
  state.send.mockImplementation(async () => {
    const result = finished(state.match()!);
    state.match.set(result);
    return reply(result);
  });
  TestBed.configureTestingModule({ providers: [
    MatchExitService, provideRouter(routes), provideLocationMocks(),
    { provide: MatchService, useValue: state },
    { provide: REQUEST_ID, useValue: vi.fn(() => 'stable-concession-receipt') },
    { provide: ConfigService, useValue: { configured: true, issue: signal(''), value: {} } },
    { provide: CatalogueService, useValue: {
      load: () => of(dataset), loadCategory: () => of(dataset),
      details: (_data: Dataset, entry: Dataset['games'][number]) => of(entry),
    } },
  ] });
  return { state, exit: TestBed.inject(MatchExitService) };
}
// jsdom has no native dialog methods; focus trapping and Escape are also checked in a real browser.
const nativeShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const nativeClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
    value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => {
  TestBed.resetTestingModule(); vi.restoreAllMocks(); localStorage.clear();
  for (const [name, original] of [['showModal', nativeShowModal], ['close', nativeClose]] as const) {
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

describe('Active match departure policy', () => {
  it('asks during either player’s turn, and staying preserves state and deadline', async () => {
    const { state, exit } = fixture();
    for (const player of ['host', 'guest']) {
      state.match.update((m) => ({ ...m!, activePlayer: player }));
      const before = structuredClone(state.match());
      const navigation = exit.confirmNavigation();
      expect(exit.open()).toBe(true);
      expect(exit.confirmNavigation()).toBe(navigation);
      expect(state.send).not.toHaveBeenCalled();
      exit.stay();
      expect(await navigation).toBe(false);
      expect(state.match()).toEqual(before);
    }
  });

  it('requests the generic browser warning only for an active participant, without conceding', () => {
    const { state, exit } = fixture();
    TestBed.tick();
    const warning = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(warning()).toBe(true);
    state.match.update((m) => ({ ...m!, activePlayer: 'guest' }));
    TestBed.tick();
    expect(warning()).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
    state.match.set(finished(state.match()!));
    TestBed.tick();
    expect(warning()).toBe(false);
    state.match.set(active());
    state.backend.playerId.set('stranger');
    TestBed.tick();
    expect(warning()).toBe(false);
    expect(exit.confirmNavigation()).toBe(true);
    state.backend.playerId.set('host');
    TestBed.tick();
    exit.ngOnDestroy();
    expect(warning()).toBe(false);
  });

  it('waits for the server before allowing navigation and ignores double confirmation', async () => {
    const { state, exit } = fixture();
    const original = structuredClone(state.match()!);
    let complete!: (response: CommandResponse) => void;
    state.send.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const navigation = exit.confirmNavigation();
    const operation = exit.forfeit();
    await exit.forfeit();
    expect(exit.busy()).toBe(true);
    expect(exit.open()).toBe(true);
    expect(exit.navigationApproved()).toBe(false);
    expect(state.match()).toEqual(original);
    expect(state.send).toHaveBeenCalledExactlyOnceWith('concede', { matchId: 'match-one' }, 'stable-concession-receipt');
    exit.stay();
    expect(exit.open()).toBe(true);
    const result = finished(original);
    state.match.set(result);
    complete(reply(result));
    await operation;
    expect(await navigation).toBe(true);
    expect(exit.navigationApproved()).toBe(true);
    expect(exit.open()).toBe(false);
  });

  it('retries a lost response with the same receipt, including after choosing to stay', async () => {
    const { state, exit } = fixture();
    state.send.mockRejectedValueOnce(Error('Response lost'));
    const cancelled = exit.confirmNavigation();
    await exit.forfeit();
    expect(exit.error()).toContain('Retry');
    expect(exit.open()).toBe(true);
    expect(exit.navigationApproved()).toBe(false);
    exit.stay();
    expect(await cancelled).toBe(false);
    const retry = exit.confirmNavigation();
    await exit.forfeit();
    expect(await retry).toBe(true);
    expect(state.send.mock.calls.map((call) => call[2])).toEqual(['stable-concession-receipt', 'stable-concession-receipt']);
  });

  it('keeps the warning open if a response does not confirm a finished match', async () => {
    const { state, exit } = fixture();
    state.send.mockResolvedValue(reply(active()));
    const navigation = exit.confirmNavigation();
    await exit.forfeit();
    expect(exit.error()).toContain('not confirmed');
    expect(exit.open()).toBe(true);
    exit.stay();
    expect(await navigation).toBe(false);
  });

  it('cancels an unanswered departure when the authoritative timeout arrives', async () => {
    const { state, exit } = fixture();
    const navigation = exit.confirmNavigation();
    state.match.set(finished(state.match()!, 'timeout'));
    TestBed.tick();
    expect(await navigation).toBe(false);
    expect(exit.open()).toBe(false);
    expect(state.send).not.toHaveBeenCalled();
    expect(exit.confirmNavigation()).toBe(true);
  });

  it('releases an unanswered guard and ignores a late response after destruction', async () => {
    const { state, exit } = fixture();
    let complete!: (response: CommandResponse) => void;
    state.send.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const navigation = exit.confirmNavigation();
    const request = exit.forfeit();
    exit.ngOnDestroy();
    expect(await navigation).toBe(false);
    complete(reply(finished(active())));
    await request;
    expect(exit.navigationApproved()).toBe(false);
  });

  it('does not authorize navigation for a response from the previous identity', async () => {
    const { state, exit } = fixture();
    let complete!: (response: CommandResponse) => void;
    state.send.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const navigation = exit.confirmNavigation();
    const request = exit.forfeit();
    state.backend.playerId.set('another-user');
    state.match.set(null);
    complete(reply(finished(active())));
    await request;
    expect(await navigation).toBe(false);
    expect(exit.navigationApproved()).toBe(false);
  });
});

describe('Routed leave confirmation', () => {
  async function routed() {
    const { state } = fixture();
    const harness = await RouterTestingHarness.create('/match/match-one');
    const component = harness.routeDebugElement!.componentInstance as MatchComponent;
    return { state, harness, component, router: TestBed.inject(Router) };
  }
  async function waitForDialog(harness: RouterTestingHarness, component: MatchComponent) {
    await vi.waitFor(() => expect(component.exit.open()).toBe(true));
    harness.detectChanges();
    return harness.routeNativeElement!.querySelector('dialog')!;
  }

  it('blocks catalogue navigation, and Escape keeps the player in the match', async () => {
    const { state, harness, component, router } = await routed();
    const navigation = router.navigateByUrl('/catalogue');
    const dialog = await waitForDialog(harness, component);
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('opponent will win');
    expect(dialog.querySelector('[autofocus]')?.textContent).toBe('Stay in match');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await navigation).toBe(false);
    expect(router.url).toBe('/match/match-one');
    expect(state.send).not.toHaveBeenCalled();
  });

  it('opens the requested page only after a confirmed concession, without result navigation taking over', async () => {
    const { state, harness, component, router } = await routed();
    const navigation = router.navigateByUrl('/catalogue');
    await waitForDialog(harness, component);
    await component.exit.forfeit();
    expect(await navigation).toBe(true);
    await harness.fixture.whenStable();
    expect(router.url).toBe('/catalogue');
    expect(state.match()?.endReason).toBe('conceded');
    await harness.navigateByUrl('/results/match-one');
    expect(harness.routeNativeElement?.textContent).toContain('You forfeited the match.');
  });

  it('protects browser Back and restores the match URL when the player stays', async () => {
    fixture();
    const harness = await RouterTestingHarness.create('/');
    await harness.navigateByUrl('/match/match-one');
    const component = harness.routeDebugElement!.componentInstance as MatchComponent;
    // The harness navigates explicitly; the real app installs this listener at bootstrap.
    TestBed.inject(Router).setUpLocationChangeListener();
    TestBed.inject(Location).back();
    await waitForDialog(harness, component);
    component.exit.stay();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/match/match-one');
    expect(TestBed.inject(Location).path()).toBe('/match/match-one');
  });

  it('dismisses the dialog and opens the normal results when a timeout arrives', async () => {
    const { state, harness, component, router } = await routed();
    const navigation = router.navigateByUrl('/credits');
    await waitForDialog(harness, component);
    state.match.set(finished(state.match()!, 'timeout'));
    harness.detectChanges();
    await navigation;
    await harness.fixture.whenStable();
    expect(router.url).toBe('/results/match-one');
    expect(component.exit.open()).toBe(false);
    expect(state.send).not.toHaveBeenCalled();
  });
});
