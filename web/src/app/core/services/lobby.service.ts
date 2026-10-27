import {
  ErrorHandler,
  inject,
  Injectable,
} from '@angular/core';
import type {
  LobbyRoom,
  RoomConnectionStatus,
} from '../models/room';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class LobbyService {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private readonly errors = inject(ErrorHandler);

  async load(roomId: string): Promise<LobbyRoom> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId)
    ) {
      throw new Error('This room link is invalid.');
    }

    await this.auth.ensureSession();

    const { data, error } = await this.supabase.client
      .from('rooms')
      .select(`
        id, code, categoryId:category_id, status, createdAt:created_at,
        players:room_players(
          userId:user_id, seat, displayName:display_name, isReady:is_ready
        )
      `)
      .eq('id', roomId)
      .maybeSingle<LobbyRoom>();

    if (error) {
      throw new Error(
        'We could not load the room. Check your connection and try again.',
      );
    }

    if (!data) {
      throw new Error(
        'This room is unavailable for your current player session.',
      );
    }

    return data;
  }

  watch(
    roomId: string,
    changed: () => void,
    connectionChanged: (status: RoomConnectionStatus) => void,
  ): () => void {
    let active = true;

    const notify = () => {
      if (active) changed();
    };

    const channel = this.supabase.client
      .channel(`room:${roomId}:${crypto.randomUUID()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'room_players',
        filter: `room_id=eq.${roomId}`,
      }, notify)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'room_players',
        filter: `room_id=eq.${roomId}`,
      }, notify)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`,
      }, notify)
      .subscribe((status) => {
        if (!active) return;

        if (status === 'SUBSCRIBED') {
          connectionChanged('live');
          notify();
        } else if (
          status === 'CHANNEL_ERROR'
          || status === 'TIMED_OUT'
          || status === 'CLOSED'
        ) {
          connectionChanged('reconnecting');
        }
      });

    return () => {
      if (!active) return;

      active = false;

      void this.supabase.client.removeChannel(channel)
        .catch((error) => this.errors.handleError(error));
    };
  }
}