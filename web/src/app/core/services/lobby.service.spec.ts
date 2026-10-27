import { TestBed } from '@angular/core/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AuthService } from './auth.service';
import { LobbyService } from './lobby.service';
import { SupabaseService } from './supabase.service';

describe('LobbyService', () => {
  const roomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ensureSession = vi.fn();
  const maybeSingle = vi.fn();
  const eq = vi.fn();
  const select = vi.fn();
  const from = vi.fn();

  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };

  const removeChannel = vi.fn();
  let service: LobbyService;

  beforeEach(() => {
    vi.resetAllMocks();

    ensureSession.mockResolvedValue(undefined);
    maybeSingle.mockResolvedValue({
      data: { id: roomId, players: [] },
      error: null,
    });

    eq.mockReturnValue({ maybeSingle });
    select.mockReturnValue({ eq });
    from.mockReturnValue({ select });
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    removeChannel.mockResolvedValue('ok');

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: { ensureSession },
        },
        {
          provide: SupabaseService,
          useValue: {
            client: {
              from,
              channel: () => channel,
              removeChannel,
            },
          },
        },
      ],
    });

    service = TestBed.inject(LobbyService);
  });

  it('loads the member-visible room and its players', async () => {
    expect((await service.load(roomId)).id).toBe(roomId);
    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('rooms');
    expect(eq).toHaveBeenCalledWith('id', roomId);

    expect(select.mock.calls[0][0])
      .toContain('players:room_players');
  });

  it('rejects a room hidden by membership policies', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    await expect(service.load(roomId))
      .rejects.toThrow('current player session');
  });

  it('does not query the database when authentication fails', async () => {
    ensureSession.mockRejectedValueOnce(
      new Error('Offline.'),
    );

    await expect(service.load(roomId))
      .rejects.toThrow('Offline.');

    expect(from).not.toHaveBeenCalled();
  });

  it('rejects malformed room links before authentication', async () => {
    await expect(service.load('invalid'))
      .rejects.toThrow('room link is invalid');

    expect(ensureSession).not.toHaveBeenCalled();
  });

  it('refreshes after subscription and reconnect, and cleans up once', () => {
    const changed = vi.fn();
    const status = vi.fn();

    const stop = service.watch(roomId, changed, status);
    const subscribed =
      channel.subscribe.mock.calls[0][0];
    const inserted = channel.on.mock.calls[0][2];

    expect(
      channel.on.mock.calls.map((call) => call[1].filter),
    ).toEqual([
      `room_id=eq.${roomId}`,
      `room_id=eq.${roomId}`,
      `id=eq.${roomId}`,
    ]);

    subscribed('SUBSCRIBED');
    inserted();
    subscribed('CHANNEL_ERROR');
    subscribed('SUBSCRIBED');

    expect(changed).toHaveBeenCalledTimes(3);
    expect(status).toHaveBeenCalledWith('reconnecting');

    stop();
    stop();
    inserted();
    subscribed('SUBSCRIBED');

    expect(changed).toHaveBeenCalledTimes(3);
    expect(removeChannel)
      .toHaveBeenCalledExactlyOnceWith(channel);
  });
});