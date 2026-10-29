import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { BackendService } from './backend.service';
import type { CommandResponse, Match, Room } from './models';

@Injectable({ providedIn: 'root' })
export class MatchService implements OnDestroy {
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
  private readonly unsubscribeIdentity = this.backend.onIdentityChange(() => {
    this.stop();
    this.room.set(null);
    this.match.set(null);
    this.connection.set('Session changed');
    this.error.set('Your account changed. Open your room again with the correct account.');
  });
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
    this.error.set('');
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
          if (/room_not_found|match_not_found/.test((error as Error).message)) {
            this.stop();
            this.room.set(null);
            this.match.set(null);
            this.connection.set('Unavailable');
            this.error.set(
              'This room or detailed result is unavailable. Unused room details expire after 24 hours. Registered players can find saved summaries in Account.',
            );
            if (localStorage.getItem('last-link-resume') === id)
              localStorage.removeItem('last-link-resume');
            return;
          }
          this.error.set((error as Error).message);
          this.connection.set('Reconnecting');
        }
      }
    };
    this.refresh = refresh;
    this.channel = this.backend.client
      .channel(`last-link:${kind}:${id}`, {
        config: { postgres_changes_options: { wait: true, timeout: 10000 } },
      })
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
      if (!document.hidden) void refresh();
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
  ngOnDestroy(): void {
    this.stop();
    this.unsubscribeIdentity();
  }
}
