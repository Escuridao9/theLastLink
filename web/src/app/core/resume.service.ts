import { Injectable, OnDestroy, effect, inject, signal } from '@angular/core';
import { BackendService } from './backend.service';
import { CATEGORY_LABELS, type Category, type CommandResponse } from './models';

interface SavedSession { kind: 'room' | 'match'; id: string; }
export interface SessionReturn extends SavedSession {
  label: 'Return to lobby' | 'Rejoin match';
  category: string;
  expiresAt?: number;
}

/** A local shortcut, validated through the same private server reads as the game. */
@Injectable({ providedIn: 'root' })
export class ResumeService implements OnDestroy {
  private readonly backend = inject(BackendService);
  readonly target = signal<SessionReturn | null>(null);
  private visible = false;
  private identity = '';
  private serial = 0;
  private refreshing = false;
  private destroyed = false;
  private timer?: ReturnType<typeof setInterval>;
  private ticks = 0;
  private readonly revisions = new Map<string, number>();
  private readonly identityEffect = effect(() => {
    const id = this.backend.playerId();
    if (id === this.identity) return;
    this.identity = id;
    this.serial++;
    this.revisions.clear();
    this.target.set(null);
    void this.refresh();
  });
  private readonly onVisible = () => { if (!document.hidden) void this.refresh(); };

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!visible) return;
    void this.refresh();
    this.timer = setInterval(() => {
      if (document.hidden) return;
      const target = this.target();
      if (target?.expiresAt && target.expiresAt <= Date.now()) this.target.set(null);
      if (++this.ticks % 4 === 0) void this.refresh();
    }, 1000);
  }

  constructor() {
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onVisible);
    window.addEventListener('online', this.onVisible);
  }

  private key(id: string): string { return `last-link-return:${id}`; }
  private read(id: string): SavedSession | null {
    try {
      const value = JSON.parse(localStorage.getItem(this.key(id)) ?? 'null');
      if (value && ['room', 'match'].includes(value.kind) && typeof value.id === 'string' &&
        /^[a-zA-Z0-9-]{1,100}$/.test(value.id) && !value.id.startsWith('design-review-')) return value;
      const legacy = localStorage.getItem('last-link-resume');
      return legacy && /^[a-zA-Z0-9-]{1,100}$/.test(legacy) && !legacy.startsWith('design-review-')
        ? { kind: 'match', id: legacy } : null;
    } catch { return null; }
  }
  private save(id: string, session: SavedSession): void {
    try { localStorage.setItem(this.key(id), JSON.stringify(session)); } catch { /* Optional shortcut. */ }
  }
  private clear(id: string): void {
    this.serial++;
    this.target.set(null);
    try {
      const saved = this.read(id);
      localStorage.removeItem(this.key(id));
      if (saved?.kind === 'match' && localStorage.getItem('last-link-resume') === saved.id)
        localStorage.removeItem('last-link-resume');
      if (saved?.kind === 'match' && localStorage.getItem(`last-link-resume:${id}`) === saved.id)
        localStorage.removeItem(`last-link-resume:${id}`);
    } catch { /* Optional shortcut. */ }
  }
  private category(category: Category): string {
    return category === 'football' ? 'Football Clubs' : CATEGORY_LABELS[category];
  }

  remember(response: CommandResponse, clockOffset = 0): void {
    if (this.destroyed) return;
    const id = this.backend.playerId();
    const match = response.match, room = response.room ?? match?.room;
    if (!id || !room || room.id.startsWith('design-review-') ||
      !room.players.some((player) => player.id === id)) return;
    const records = [[`room:${room.id}`, room.revision],
      ...(match ? [[`match:${match.id}`, match.revision]] : [])] as [string, number][];
    if (records.some(([key, revision]) => revision < (this.revisions.get(key) ?? -1))) return;
    for (const [key, revision] of records) this.revisions.set(key, revision);
    if (this.revisions.size > 100) this.revisions.delete(this.revisions.keys().next().value!);
    this.serial++;
    if (match?.status === 'active') {
      const candidate: SavedSession = { kind: 'match', id: match.id };
      this.save(id, candidate);
      const expiresAt = Date.parse(match.deadline) - clockOffset;
      this.target.set(expiresAt > Date.now()
        ? { ...candidate, label: 'Rejoin match', category: this.category(match.category), expiresAt }
        : null);
    } else if (match?.rematch?.nextStatus === 'active' && match.rematch.nextMatchId) {
      const nextId = match.rematch.nextMatchId;
      this.save(id, { kind: 'match', id: nextId });
      if (this.target()?.id !== nextId) this.target.set(null);
    } else if (match?.status === 'finished' || room.status === 'finished' || room.status === 'closed') {
      const saved = this.read(id);
      if (saved?.id === match?.id || saved?.id === room.id || saved?.id === room.matchId)
        this.clear(id);
    } else if (room.matchId) {
      this.save(id, { kind: 'match', id: room.matchId });
      if (this.target()?.id !== room.matchId) this.target.set(null);
    } else if (room.status === 'waiting' || room.status === 'ready') {
      const candidate: SavedSession = { kind: 'room', id: room.id };
      this.save(id, candidate);
      this.target.set({ ...candidate, label: 'Return to lobby', category: this.category(room.category) });
    }
  }
  forgetRoom(roomId: string): void {
    const id = this.backend.playerId();
    if (id && this.read(id)?.id === roomId) this.clear(id);
  }

  async refresh(): Promise<void> {
    const id = this.backend.playerId();
    if (this.destroyed || !this.visible || document.hidden || !id ||
      !this.backend.config?.configured || this.refreshing) return;
    const saved = this.read(id);
    if (!saved) { this.target.set(null); return; }
    const serial = this.serial, started = Date.now();
    this.refreshing = true;
    try {
      const response = await this.backend.command(saved.kind === 'room' ? 'room_status' : 'snapshot',
        saved.kind === 'room' ? { roomId: saved.id } : { matchId: saved.id });
      if (this.destroyed || serial !== this.serial || id !== this.backend.playerId()) return;
      if (response.reason === 'room_closed' || response.reason === 'lobby_seat_expired') {
        this.clear(id);
        return;
      }
      this.remember(response, Date.parse(response.serverTime) - (started + Date.now()) / 2);
    } catch (error) {
      if (!this.destroyed && serial === this.serial && id === this.backend.playerId()) {
        this.target.set(null);
        if (/room_not_found|match_not_found|not_a_member|not_room_member/.test((error as Error).message))
          this.clear(id);
      }
    } finally { this.refreshing = false; }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.serial++;
    if (this.timer) clearInterval(this.timer);
    this.identityEffect.destroy();
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onVisible);
    window.removeEventListener('online', this.onVisible);
  }
}
