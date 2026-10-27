import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { routes } from '../../app.routes';
import type { LobbyRoom } from '../../core/models/room';
import { AuthService } from '../../core/services/auth.service';
import { LobbyService } from '../../core/services/lobby.service';
import { Lobby } from './lobby.component';

const room: LobbyRoom = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  code: 'AB7K2Q',
  categoryId: 'games',
  status: 'lobby',
  createdAt: '2026-10-27T09:30:00Z',
  players: [
    {
      userId: 'host',
      seat: 1,
      displayName: 'Diogo',
      isReady: false,
    },
    {
      userId: 'guest',
      seat: 2,
      displayName: 'Marta',
      isReady: false,
    },
  ],
};

describe('Lobby', () => {
  const load = vi.fn<LobbyService['load']>();
  const watch = vi.fn<LobbyService['watch']>();
  const stop = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();

    load.mockResolvedValue(room);
    watch.mockReturnValue(stop);

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        {
          provide: LobbyService,
          useValue: { load, watch },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal({ id: 'host' }),
          },
        },
      ],
    });
  });

  it('loads a direct room URL and displays both players', async () => {
    const harness = await RouterTestingHarness.create(
      `/rooms/${room.id}`,
    );

    await harness.fixture.whenStable();
    harness.detectChanges();

    const text = harness.routeNativeElement?.textContent;

    expect(text).toContain('AB7K2Q');
    expect(text).toContain('Diogo');
    expect(text).toContain('Marta');
    expect(text).toContain('YOU');
    expect(load).toHaveBeenCalledWith(room.id);
  });

  it('updates the second seat when a database event arrives', async () => {
    load.mockResolvedValueOnce({
      ...room,
      players: [room.players[0]],
    });

    const harness = await RouterTestingHarness.create(
      `/rooms/${room.id}`,
    );

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent)
      .toContain('Your rival?');

    watch.mock.calls[0][1]();

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent)
      .toContain('Marta');

    expect(harness.routeNativeElement?.textContent)
      .toContain('Both players have joined.');
  });

  it('shows a loading state and ignores a late result for another room', async () => {
    let finish = (_room: LobbyRoom) => {};

    load.mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const harness = await RouterTestingHarness.create(
      `/rooms/${room.id}`,
    );

    expect(harness.routeNativeElement?.textContent)
      .toContain('Finding your room');

    const other = {
      ...room,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      code: 'NEW123',
    };

    load.mockResolvedValueOnce(other);

    await harness.navigateByUrl(`/rooms/${other.id}`, Lobby);
    await harness.fixture.whenStable();

    finish(room);

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent)
      .toContain('NEW123');

    expect(harness.routeNativeElement?.textContent)
      .not.toContain('AB7K2Q');
  });

  it('ignores an older refresh that finishes after a newer one', async () => {
    const harness = await RouterTestingHarness.create(
      `/rooms/${room.id}`,
    );

    await harness.fixture.whenStable();

    let finish = (_room: LobbyRoom) => {};

    load.mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );

    load.mockResolvedValueOnce({
      ...room,
      code: 'NEW123',
    });

    watch.mock.calls[0][1]();
    watch.mock.calls[0][1]();

    await harness.fixture.whenStable();

    finish(room);

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent)
      .toContain('NEW123');
  });

  it('closes its Realtime subscription when navigating away', async () => {
    const harness = await RouterTestingHarness.create(
      `/rooms/${room.id}`,
    );

    await harness.fixture.whenStable();
    await harness.navigateByUrl('/');

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('shows an error and reconnects when retried', async () => {
    load.mockRejectedValueOnce(
      new Error('Room unavailable.'),
    );

    const harness = await RouterTestingHarness.create(
      `/rooms/${room.id}`,
    );

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(
      harness.routeNativeElement
        ?.querySelector('[role="alert"]')?.textContent,
    ).toContain('Room unavailable.');

    harness.routeNativeElement
      ?.querySelector<HTMLButtonElement>('button')?.click();

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent)
      .toContain('Diogo');

    expect(watch).toHaveBeenCalledTimes(1);
  });
});