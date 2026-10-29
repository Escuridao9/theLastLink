import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendService } from './backend.service';
import { ResumeService } from './resume.service';
import type { CommandResponse, Match, Room } from './models';

const room = (): Room => ({
  id: 'room-one', code: 'ABCDEF123456', hostId: 'host', guestId: null,
  category: 'movies', status: 'waiting', matchId: null, revision: 1,
  players: [{ id: 'host', name: 'Diogo' }],
});
const match = (): Match => ({
  id: 'match-one', roomId: 'room-one', category: 'movies', catalogueId: 'test',
  status: 'active', activePlayer: 'host', deadline: new Date(Date.now() + 20000).toISOString(),
  revision: 2, winnerId: null, endReason: null, endedAt: null,
  state: { datasetId: 'test', category: 'movies', currentGameId: 'seed', history: ['seed'], usage: {}, version: 0 },
  room: { ...room(), status: 'playing', matchId: 'match-one', revision: 2 }, turns: [],
});
const reply = (value: Partial<CommandResponse>): CommandResponse => ({
  ok: true, duplicate: false, serverTime: new Date().toISOString(), ...value,
});
function setup(id = 'host') {
  const backend = { playerId: signal(id), config: { configured: true },
    command: vi.fn<(...args: unknown[]) => Promise<CommandResponse>>() };
  TestBed.configureTestingModule({ providers: [{ provide: BackendService, useValue: backend }] });
  const service = TestBed.inject(ResumeService);
  TestBed.tick();
  return { service, backend };
}
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T19:00:00Z'));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Contextual session return', () => {
  it('saves an authorized lobby and uses a lobby-specific label', () => {
    const { service } = setup();
    service.remember(reply({ room: room() }));
    expect(service.target()).toMatchObject({ kind: 'room', id: 'room-one', label: 'Return to lobby' });
    expect(JSON.parse(localStorage.getItem('last-link-return:host')!)).toEqual({ kind: 'room', id: 'room-one' });
  });
  it('validates a saved match with the server before presenting it after a reload', async () => {
    localStorage.setItem('last-link-resume', 'match-one');
    const { service, backend } = setup();
    backend.command.mockResolvedValue(reply({ match: match() }));
    expect(service.target()).toBeNull();
    service.setVisible(true);
    await Promise.resolve();
    expect(backend.command).toHaveBeenCalledWith('snapshot', { matchId: 'match-one' });
    expect(service.target()?.label).toBe('Rejoin match');
  });
  it('removes a finished session and ignores a late older active snapshot', () => {
    const { service } = setup();
    const active = match();
    service.remember(reply({ match: active }));
    service.remember(reply({ match: { ...active, status: 'finished', revision: 3,
      room: { ...active.room, status: 'finished', revision: 3 } } }));
    expect(service.target()).toBeNull();
    expect(localStorage.getItem('last-link-return:host')).toBeNull();
    service.remember(reply({ match: active }));
    expect(service.target()).toBeNull();
  });
  it('hides an active shortcut when its server deadline passes, including clock skew', async () => {
    const { service, backend } = setup();
    const active = match();
    active.deadline = new Date(Date.now() + 120000).toISOString();
    service.remember(reply({ match: active }), 100000);
    backend.command.mockImplementation(async () => reply({ match: {
      ...active, status: 'finished', revision: 3,
      room: { ...active.room, status: 'finished', revision: 3 },
    } }));
    service.setVisible(true);
    await vi.advanceTimersByTimeAsync(21000);
    expect(service.target()).toBeNull();
  });
  it('clears an expired or deleted saved room without keeping a broken shortcut', async () => {
    const { service, backend } = setup();
    service.remember(reply({ room: room() }));
    backend.command.mockRejectedValue(Error('room_not_found'));
    service.setVisible(true);
    await Promise.resolve();
    expect(service.target()).toBeNull();
    expect(localStorage.getItem('last-link-return:host')).toBeNull();
  });
  it('does not create an identity or call the server for a fresh visitor', async () => {
    const { service, backend } = setup('');
    localStorage.setItem('last-link-resume', 'match-one');
    service.setVisible(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(backend.command).not.toHaveBeenCalled();
    expect(service.target()).toBeNull();
  });
  it('drops responses from another identity and does not reveal its shortcut', async () => {
    const { service, backend } = setup();
    service.remember(reply({ room: room() }));
    let resolve!: (response: CommandResponse) => void;
    backend.command.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    service.setVisible(true);
    backend.playerId.set('another-player');
    TestBed.tick();
    resolve(reply({ room: room() }));
    await Promise.resolve();
    expect(service.target()).toBeNull();
    expect(localStorage.getItem('last-link-return:another-player')).toBeNull();
  });
  it('never saves local preview IDs or rooms that do not include this player', () => {
    const { service } = setup();
    service.remember(reply({ room: { ...room(), id: 'design-review-movies-room' } }));
    service.remember(reply({ room: { ...room(), players: [{ id: 'other', name: 'Alex' }] } }));
    expect(service.target()).toBeNull();
    expect(localStorage.getItem('last-link-return:host')).toBeNull();
  });
  it('pauses return polling when leaving the overview and removes its listeners on cleanup', async () => {
    const { service, backend } = setup();
    service.remember(reply({ room: room() }));
    backend.command.mockImplementation(async () => reply({ room: room() }));
    service.setVisible(true);
    await vi.advanceTimersByTimeAsync(5000);
    service.setVisible(false);
    const count = backend.command.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(backend.command).toHaveBeenCalledTimes(count);
    service.ngOnDestroy();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(backend.command).toHaveBeenCalledTimes(count);
  });
});
