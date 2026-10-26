import { TestBed } from '@angular/core/testing';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  CreatedRoom,
  CreateRoomRequest,
} from '../models/room';
import { AuthService } from './auth.service';
import { RoomService } from './room.service';
import { SupabaseService } from './supabase.service';

const request: CreateRoomRequest = {
  roomId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  categoryId: 'games',
  displayName: 'Diogo',
};

const room: CreatedRoom = {
  id: request.roomId,
  code: 'AB7K2Q',
  categoryId: 'games',
  displayName: 'Diogo',
};

describe('RoomService', () => {
  const ensureSession = vi.fn<() => Promise<void>>();
  const invoke = vi.fn();

  let service: RoomService;

  beforeEach(() => {
    ensureSession.mockReset();
    ensureSession.mockResolvedValue(undefined);

    invoke.mockReset();
    invoke.mockResolvedValue({
      data: room,
      error: null,
    });

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
              functions: { invoke },
            },
          },
        },
      ],
    });

    service = TestBed.inject(RoomService);
  });

  it('sends the typed request after preparing a player session', async () => {
    expect(await service.createRoom(request)).toEqual(room);

    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      'create-room',
      { body: request },
    );
  });

  it('does not invoke the function when authentication fails', async () => {
    ensureSession.mockRejectedValueOnce(
      new Error('Offline.'),
    );

    await expect(
      service.createRoom(request),
    ).rejects.toThrow('Offline.');

    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a response for a different room', async () => {
    invoke.mockResolvedValueOnce({
      data: { ...room, id: 'wrong-room' },
      error: null,
    });

    await expect(
      service.createRoom(request),
    ).rejects.toThrow('unexpected room response');
  });

  it('shows the function validation message for a bad request', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(
        new Response(
          JSON.stringify({
            error: 'Choose Games or Movies.',
          }),
          { status: 400 },
        ),
      ),
    });

    await expect(
      service.createRoom(request),
    ).rejects.toThrow('Choose Games or Movies.');
  });

  it('shows a retry message for server failures', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(
        new Response(
          JSON.stringify({
            error: 'Internal database detail.',
          }),
          { status: 503 },
        ),
      ),
    });

    await expect(
      service.createRoom(request),
    ).rejects.toThrow(
      'We could not create your room. Please try again.',
    );
  });
});