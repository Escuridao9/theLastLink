import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogueService } from './core/catalogue.service';
import { MatchService } from './core/match.service';
import { TurnAudioService } from './core/turn-audio.service';
import type { Category, CommandResponse, ConnectorType, Dataset, Match, Turn } from './core/models';
import { HomeComponent } from './pages/home.component';
import { MatchComponent } from './pages/match.component';
import { REQUEST_ID } from './shared/request-id';

// Synthetic protocol fixtures stay in tests; production uses the real match service.
function example(category: Category = 'movies', activePlayer = 'host') {
  const role: ConnectorType = category === 'movies' ? 'actor' : category === 'football' ? 'player' : 'composer';
  const dataset: Dataset = {
    datasetId: 'test-catalogue', category,
    games: ['Opening', 'Previous', 'Current', 'Next'].map((title, index) => ({
      id: `entry-${index}`, title, category, credits: {},
    })),
    entities: { person: { id: 'person', name: 'Shared person' } },
  };
  const turns: Turn[] = dataset.games.slice(0, 3).map((entry, index) => ({
    index, entryId: entry.id, playerId: index === 0 ? null : index === 1 ? 'host' : 'guest',
    connectors: index ? [{ entityId: 'person', name: 'Shared person', types: [role] }] : [],
    acceptedAt: new Date().toISOString(),
  }));
  const match: Match = {
    id: 'match-one', roomId: 'room-one', catalogueId: dataset.datasetId, category,
    status: 'active', activePlayer, deadline: new Date(Date.now() + 20000).toISOString(),
    revision: 2, winnerId: null, endReason: null, endedAt: null,
    state: { datasetId: dataset.datasetId, category, version: 2, currentGameId: 'entry-2', history: ['entry-0', 'entry-1', 'entry-2'], usage: { person: 2 } },
    room: {
      id: 'room-one', code: 'ABCDEF123456', category, hostId: 'host', guestId: 'guest',
      status: 'playing', matchId: 'match-one', revision: 2,
      players: [{ id: 'host', name: 'Diogo' }, { id: 'guest', name: 'Alex' }],
    },
    turns,
  };
  return { dataset, match };
}

async function render(category: Category = 'movies', viewer = 'host', activePlayer = 'host') {
  const { dataset, match } = example(category, activePlayer);
  const state = {
    match: signal<Match | null>(match), backend: { playerId: signal(viewer) },
    connection: signal('Live'), error: signal(''), clockOffset: signal(0),
    watch: vi.fn(async () => {}), stop: vi.fn(),
    send: vi.fn<(...args: unknown[]) => Promise<CommandResponse>>(async () => ({
      ok: false, reason: 'no_shared_connector', duplicate: false, serverTime: new Date().toISOString(),
    })),
  };
  const audio = { enabled: signal(true), notifyTurn: vi.fn(), toggle: vi.fn(() => audio.enabled.update((on) => !on)) };
  await TestBed.configureTestingModule({
    imports: [MatchComponent], providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', match.id]]) } } },
      { provide: MatchService, useValue: state },
      { provide: CatalogueService, useValue: { load: () => of(dataset) } },
      { provide: TurnAudioService, useValue: audio },
      { provide: REQUEST_ID, useValue: () => 'test-receipt' },
    ],
  }).compileComponents();
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(MatchComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, state, dataset, match, audio, element: fixture.nativeElement as HTMLElement };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

describe('Shared match feedback', () => {
  for (const category of ['games', 'movies', 'football'] as const) {
    for (const viewer of ['host', 'guest']) {
      it(`shows the server's last accepted connection to ${viewer} in ${category} without a local submission`, async () => {
        const { state, element } = await render(category, viewer);
        const connection = element.querySelector('.ll-last-connection')!;
        expect(connection.textContent).toContain('Previous');
        expect(connection.textContent).toContain('Current');
        expect(connection.textContent).toContain('Shared person');
        expect(connection.textContent).toContain('2/3');
        expect(state.send).not.toHaveBeenCalled();
      });
    }
  }

  it('keeps accepted connector boxes, usage and deadline while showing a rejected answer', async () => {
    const { fixture, state, element, dataset, match } = await render();
    const previous = element.querySelector('.ll-last-connection')!.innerHTML;
    fixture.componentInstance.selected.set(dataset.games[3]);
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('share no eligible connector');
    expect(element.querySelector('.ll-last-connection')!.innerHTML).toBe(previous);
    expect(state.match()).toBe(match);
    expect(state.match()!.deadline).toBe(match.deadline);
    expect(state.match()!.state.usage).toEqual({ person: 2 });
  });

  it('keeps the last accepted boxes during a network failure and same-turn refresh', async () => {
    const { fixture, state, element, dataset } = await render();
    const previous = element.querySelector('.ll-last-connection')!.innerHTML;
    state.send.mockRejectedValueOnce(Error('Network interrupted'));
    fixture.componentInstance.selected.set(dataset.games[3]);
    await fixture.componentInstance.submit();
    state.match.update((match) => ({ ...match!, revision: 3 }));
    fixture.detectChanges();
    expect(element.querySelector('.ll-last-connection')!.innerHTML).toBe(previous);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Retry the same answer');
    expect(fixture.componentInstance.selected()).toBe(dataset.games[3]);
  });

  it('updates the last link and clears old errors when the next accepted turn arrives remotely', async () => {
    const { fixture, state, element, match } = await render();
    fixture.componentInstance.error.set('Old rejection');
    state.match.set({
      ...match, activePlayer: 'guest', revision: 3,
      state: { ...match.state, currentGameId: 'entry-3', history: [...match.state.history, 'entry-3'], version: 3, usage: { person: 3 } },
      turns: [...match.turns, { ...match.turns[2], index: 3, entryId: 'entry-3', playerId: 'host' }],
    });
    fixture.detectChanges();
    expect(element.querySelector('.ll-link-path')?.textContent).toContain('Next');
    expect(element.querySelector('.ll-response-connectors')?.textContent).toContain('3/3');
    expect(element.querySelector('.ll-response-connectors .ll-credit-out')).not.toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector('.ll-answer-form')).toBeNull();
  });

  it('labels the active player and replaces the waiting player input with a clear message', async () => {
    const { fixture, state, element } = await render();
    expect(element.querySelector('.ll-turn-label')?.textContent).toContain('YOUR TURN');
    expect(element.querySelector('app-game-search')).not.toBeNull();
    state.match.update((match) => ({ ...match!, activePlayer: 'guest' }));
    fixture.detectChanges();
    expect(element.querySelector('.ll-turn-label')?.textContent).toContain('Alex’S TURN');
    expect(element.querySelector('app-game-search')).toBeNull();
    expect(element.querySelector('.ll-waiting-turn')?.textContent).toContain('Alex is thinking');
    expect(element.querySelector('.ll-rival.ll-on-clock strong')?.textContent).toContain('Alex');
    expect(element.querySelector('app-turn-clock')).not.toBeNull();
  });

  it('never notifies sound for an opponent turn or a finished match', async () => {
    const { fixture, state, audio, match } = await render('movies', 'host', 'guest');
    expect(audio.notifyTurn).not.toHaveBeenCalled();
    state.match.set({ ...match, activePlayer: 'host', status: 'finished', winnerId: 'guest' });
    fixture.detectChanges();
    expect(audio.notifyTurn).not.toHaveBeenCalled();
  });

  it('identifies own turn notifications by match and state version, including a rematch', async () => {
    const { fixture, state, audio, match } = await render();
    expect(audio.notifyTurn).toHaveBeenCalledWith('match-one:2');
    state.match.set({ ...match, id: 'rematch', state: { ...match.state, version: 0 } });
    fixture.detectChanges();
    expect(audio.notifyTurn).toHaveBeenCalledWith('rematch:0');
  });

  it('removes hearts and the Live label, but retains reconnect status and an accessible mute toggle', async () => {
    const { fixture, state, element, audio } = await render();
    expect(element.querySelector('.ll-player-life')).toBeNull();
    expect(element.querySelector('.ll-match-connection')).toBeNull();
    const toggle = element.querySelector<HTMLButtonElement>('.ll-sound-toggle')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    fixture.detectChanges();
    expect(audio.enabled()).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toContain('Sound off');
    state.connection.set('Reconnecting');
    fixture.detectChanges();
    expect(element.querySelector('.ll-match-connection')?.textContent).toBe('Reconnecting');
  });

  it('does not invent an accepted connection for the opening entry', async () => {
    const { fixture, state, element, match } = await render();
    state.match.set({ ...match, state: { ...match.state, version: 0, currentGameId: 'entry-0', history: ['entry-0'], usage: {} }, turns: [match.turns[0]] });
    fixture.detectChanges();
    expect(element.querySelector('.ll-last-connection')).toBeNull();
  });
});

it('explains the objective and shared rules on the homepage and names the Football Clubs card', async () => {
  await TestBed.configureTestingModule({ imports: [HomeComponent], providers: [provideRouter([])] }).compileComponents();
  const fixture = TestBed.createComponent(HomeComponent);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  expect(element.querySelector('.ll-intro')?.textContent).toContain('Make your opponent run out of time to win');
  expect(element.querySelector('.ll-football h3')?.textContent).toContain('Football Clubs');
  expect(element.querySelector('.ll-football .ll-category-foot')?.textContent).not.toContain('Worldwide');
  expect(element.querySelector('#how-to-play')?.textContent).toContain('Every shared connector counts');
  expect(element.querySelector('#how-to-play')?.textContent).toContain('No repeats');
});
