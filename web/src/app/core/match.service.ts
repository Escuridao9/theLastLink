import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { BackendService } from './backend.service';
import { ResumeService } from './resume.service';
import type { CommandResponse, Match, Room } from './models';

@Injectable({ providedIn: 'root' })
export class MatchService implements OnDestroy {
  readonly backend = inject(BackendService);
  private readonly resume = inject(ResumeService);
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
  private lobbyId?: string;
  private readonly clientId = crypto.randomUUID();
  private readonly onPageHide = () => {
    if (this.lobbyId) void this.backend.command('lobby_disconnect', {
      roomId: this.lobbyId, clientId: this.clientId,
    }).catch(() => { /* The server lease expires if the browser cannot send this. */ });
  };
  private readonly onPageShow = () => { void this.refresh?.(); };
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
    const response = await this.backend.command(action,
      ['create','join','room','start','leave'].includes(action) ? { ...payload, clientId: this.clientId } : payload,
      requestId);
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
    this.resume.remember(response, this.clockOffset());
    if (action === 'leave' && response.ok) this.resume.forgetRoom(String(payload['roomId']));
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
        const response = await this.send(
          kind === 'room' ? 'room' : 'snapshot',
          kind === 'room' ? { roomId: id } : { matchId: id },
        );
        if (generation === this.generation && (response.reason === 'room_closed' || response.reason === 'lobby_seat_expired')) {
          this.unavailable(response.reason);
        }
      } catch (error) {
        if (generation === this.generation) {
          if (/room_not_found|match_not_found/.test((error as Error).message)) {
            this.unavailable('not_found');
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
    if (kind === 'room') {
      this.lobbyId = id;
      window.addEventListener('pagehide', this.onPageHide);
      window.addEventListener('pageshow', this.onPageShow);
    }
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
      if (kind === 'room' || !document.hidden) void refresh();
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
    this.lobbyId = undefined;
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
  }
  private unavailable(reason: string): void {
    const id = this.lobbyId;
    if (id) this.resume.forgetRoom(id);
    this.stop();
    this.room.set(null);
    this.match.set(null);
    this.connection.set('Unavailable');
    this.error.set(reason === 'room_closed'
      ? 'The host left the lobby, so this waiting room has closed. Create or join another room.'
      : reason === 'lobby_seat_expired'
        ? 'Your lobby seat expired while you were disconnected. Use the invitation to join again if a seat is available.'
        : 'This room or detailed result is unavailable. Unused room details expire after 24 hours. Registered players can find saved summaries in Account.');
    if (id && localStorage.getItem('last-link-resume') === id) localStorage.removeItem('last-link-resume');
  }
  ngOnDestroy(): void {
    this.stop();
    this.unsubscribeIdentity();
  }
}
