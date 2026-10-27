import { Injectable, inject, signal } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { BackendService } from './backend.service';
import type { CommandResponse, Match, Room } from './models';

@Injectable({ providedIn: 'root' })
export class MatchService {
  readonly backend = inject(BackendService);
  readonly room = signal<Room | null>(null);
  readonly match = signal<Match | null>(null);
  readonly connection = signal('Connecting');
  readonly error = signal('');
  readonly clockOffset = signal(0);
  private channel?: RealtimeChannel;
  private poll?: ReturnType<typeof setInterval>;
  private generation = 0;
  private sequence = 0;
  private clockSequence = 0;
  private refresh?: () => Promise<void>;
  private readonly onVisible = () => {
    if (!document.hidden) void this.refresh?.();
  };
  private readonly onOnline = () => {
    void this.refresh?.();
  };

  async send(
    action: string,
    payload: Record<string, unknown>,
    requestId: string = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    const started = Date.now(),
      sequence = ++this.sequence,
      generation = this.generation;
    const response = await this.backend.command(action, payload, requestId);
    if (generation !== this.generation) return response;
    if (sequence >= this.clockSequence) {
      this.clockOffset.set(Date.parse(response.serverTime) - (started + Date.now()) / 2);
      this.clockSequence = sequence;
    }
    const room = response.room ?? response.match?.room;
    if (
      room &&
      (!this.room() || this.room()!.id !== room.id || room.revision >= this.room()!.revision)
    )
      this.room.set(room);
    const match = response.match;
    if (
      match &&
      (!this.match() || this.match()!.id !== match.id || match.revision >= this.match()!.revision)
    )
      this.match.set(match);
    this.error.set('');
    return response;
  }
  async watch(kind: 'room' | 'match', id: string): Promise<void> {
    this.stop();
    this.room.set(null);
    this.match.set(null);
    this.connection.set('Connecting');
    const generation = this.generation;
    await this.backend.identity();
    if (generation !== this.generation) return;
    const refresh = async () => {
      if (generation !== this.generation) return;
      try {
        await this.send(
          kind === 'room' ? 'room' : 'snapshot',
          kind === 'room' ? { roomId: id } : { matchId: id },
        );
      } catch (error) {
        if (generation === this.generation) {
          this.error.set((error as Error).message);
          this.connection.set('Reconnecting');
        }
      }
    };
    this.refresh = refresh;
    this.channel = this.backend.client
      .channel(`last-link:${kind}:${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: kind === 'room' ? 'game_rooms' : 'matches',
          filter: `id=eq.${id}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe((status) => {
        if (generation !== this.generation) return;
        this.connection.set(status === 'SUBSCRIBED' ? 'Live' : 'Reconnecting');
        if (status === 'SUBSCRIBED') void refresh(); // Close the fetch/subscribe race.
      });
    this.poll = setInterval(() => {
      void refresh();
    }, 4000);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
    await refresh();
  }
  stop(): void {
    this.generation++;
    if (this.poll) clearInterval(this.poll);
    if (this.channel) void this.backend.client.removeChannel(this.channel);
    this.poll = undefined;
    this.channel = undefined;
    this.refresh = undefined;
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
  }
}
