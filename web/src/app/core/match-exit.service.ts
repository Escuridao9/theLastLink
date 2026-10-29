import { Injectable, OnDestroy, effect, inject, signal, untracked } from '@angular/core';
import { MatchService } from './match.service';
import { REQUEST_ID } from '../shared/request-id';

/** Scoped to one match view. Closing a browser never sends a concession. */
@Injectable()
export class MatchExitService implements OnDestroy {
  private readonly game = inject(MatchService);
  private readonly requestId = inject(REQUEST_ID);
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly navigationApproved = signal(false);
  private pending?: { promise: Promise<boolean>; resolve: (leave: boolean) => void };
  private receipt?: { matchId: string; id: string };
  private destroyed = false;
  private readonly beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.activeMatch()) return;
    event.preventDefault();
    event.returnValue = 'true'; // Legacy support; the browser chooses the warning text.
  };
  private readonly stateEffect = effect((cleanup) => {
    const active = this.activeMatch();
    if (active) {
      window.addEventListener('beforeunload', this.beforeUnload);
      cleanup(() => window.removeEventListener('beforeunload', this.beforeUnload));
    }
    const busy = this.busy();
    // A natural result or identity change cancels an unanswered leave request.
    if (!active && !busy) untracked(() => this.resolve(false));
  });

  private activeMatch() {
    const match = this.game.match();
    const player = this.game.backend.playerId();
    return match?.status === 'active' && match.room.players.some((p) => p.id === player)
      ? match : null;
  }

  confirmNavigation(): boolean | Promise<boolean> {
    if (!this.activeMatch()) return true;
    if (!this.pending) {
      let resolve!: (leave: boolean) => void;
      const promise = new Promise<boolean>((done) => { resolve = done; });
      this.pending = { promise, resolve };
      this.error.set('');
      this.open.set(true);
    }
    return this.pending.promise;
  }

  stay(): void {
    if (!this.busy()) this.resolve(false);
  }

  async forfeit(): Promise<void> {
    const match = this.activeMatch();
    if (this.busy() || !this.pending || this.destroyed) return;
    if (!match) { this.resolve(false); return; }
    const player = this.game.backend.playerId();
    if (this.receipt?.matchId !== match.id)
      this.receipt = { matchId: match.id, id: this.requestId() };
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await this.game.send('concede', { matchId: match.id }, this.receipt.id);
      if (this.destroyed) return;
      if (player !== this.game.backend.playerId() || this.game.match()?.id !== match.id) {
        this.resolve(false);
        return;
      }
      if (response.match?.id !== match.id || response.match.status !== 'finished') {
        this.error.set('The server has not confirmed that the match ended. Stay here or retry.');
        return;
      }
      this.navigationApproved.set(true);
      this.resolve(true);
    } catch {
      if (!this.destroyed)
        this.error.set('Could not confirm the forfeit. The timer is still running. Retry to safely check the outcome.');
    } finally {
      this.busy.set(false);
    }
  }

  private resolve(leave: boolean): void {
    const pending = this.pending;
    this.pending = undefined;
    this.open.set(false);
    pending?.resolve(leave);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stateEffect.destroy();
    this.resolve(false);
  }
}
