import { inject, Injectable } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type {
  CreatedRoom,
  CreateRoomRequest,
  JoinedRoom,
  JoinRoomRequest,
} from '../models/room';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root',
})
export class RoomService {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);

  async createRoom(
    request: CreateRoomRequest,
  ): Promise<CreatedRoom> {
    await this.auth.ensureSession();

    const { data, error } =
      await this.supabase.client.functions.invoke<CreatedRoom>(
        'create-room',
        { body: request },
      );

    if (error) {
      if (
        error instanceof FunctionsHttpError
        && error.context.status === 400
      ) {
        const body: unknown =
          await error.context.json().catch(() => null);

        if (
          body
          && typeof body === 'object'
          && 'error' in body
          && typeof body.error === 'string'
        ) {
          throw new Error(body.error);
        }
      }

      throw new Error(
        'We could not create your room. Please try again.',
      );
    }

    if (
      !data
      || data.id !== request.roomId
      || data.categoryId !== request.categoryId
      || typeof data.code !== 'string'
      || !/^[A-Z0-9]{6}$/.test(data.code)
      || typeof data.displayName !== 'string'
    ) {
      throw new Error(
        'The server returned an unexpected room response. Please try again.',
      );
    }

    return data;
  }
  async joinRoom(request: JoinRoomRequest): Promise<JoinedRoom> {
  await this.auth.ensureSession();

  const { data, error } =
    await this.supabase.client.functions.invoke<JoinedRoom>(
      'join-room',
      { body: request },
    );

  if (error) {
    if (
      error instanceof FunctionsHttpError
      && [400, 404, 409].includes(error.context.status)
    ) {
      const body: unknown =
        await error.context.json().catch(() => null);

      if (
        body
        && typeof body === 'object'
        && 'error' in body
        && typeof body.error === 'string'
      ) {
        throw new Error(body.error);
      }
    }

    throw new Error(
      'We could not join your room. Please try again.',
    );
  }

  if (
    !data
    || typeof data.id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)
    || data.code !== request.roomCode.trim().toUpperCase()
    || data.categoryId !== request.categoryId
    || typeof data.displayName !== 'string'
    || (data.seat !== 1 && data.seat !== 2)
  ) {
    throw new Error(
      'The server returned an unexpected room response. Please try again.',
    );
  }

  return data;
}
}