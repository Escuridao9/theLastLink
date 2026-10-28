import { UiLinks } from '../shared/ui-links.service';
import { REQUEST_ID } from '../shared/request-id';
import { Component, OnInit, OnDestroy, inject, effect, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatchService } from '../core/match.service';
import { CatalogueService } from '../core/catalogue.service';
import { CATEGORY_LABELS, ROLE_LABELS } from '../core/models';
import type { Dataset, ConnectorType } from '../core/models';
@Component({
  selector: 'app-results',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './results.component.html',
})
export class ResultsComponent implements OnInit, OnDestroy {
  readonly links = inject(UiLinks);
  readonly game = inject(MatchService);
  readonly categories = CATEGORY_LABELS;
  private readonly requestId = inject(REQUEST_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalogue = inject(CatalogueService);
  readonly dataset = signal<Dataset | null>(null);
  private subscription?: Subscription;
  private routeSubscription?: Subscription;
  readonly error = signal('');
  readonly rematchBusy = signal(false);
  readonly rematchError = signal('');
  readonly rematchAction = signal<'rematch' | 'cancel_rematch' | null>(null);
  private pendingRematch?: { matchId: string; action: string; id: string };
  private rematchOperation = 0;
  private observedMatchId = '';
  private watchedId = '';
  private catalogueId = '';
  private readonly reaction = effect(() => {
    const match = this.game.match();
    if (!match) return;
    if (match.id !== this.observedMatchId) {
      this.observedMatchId = match.id;
      this.pendingRematch = undefined;
      this.rematchOperation++;
      this.rematchBusy.set(false);
      this.rematchError.set('');
    }
    if (match.status === 'active') {
      void this.router.navigate([this.links.to('/match'), match.id], { replaceUrl: true });
      return;
    }
    if (match.rematch?.nextMatchId && match.rematch.nextStatus === 'active') {
      localStorage.setItem('last-link-resume', match.rematch.nextMatchId);
      void this.router.navigate([this.links.to('/match'), match.rematch.nextMatchId], {
        replaceUrl: true,
      });
      return;
    }
    if (match.catalogueId !== this.catalogueId) {
      this.catalogueId = match.catalogueId;
      this.subscription?.unsubscribe();
      this.subscription = this.catalogue.load(match.catalogueId).subscribe({
        next: (d) => this.dataset.set(d),
        error: () => this.error.set('Titles could not be loaded.'),
      });
    }
  });
  get won(): boolean {
    return this.game.match()?.winnerId === this.game.backend.playerId();
  }
  get winner(): string {
    const m = this.game.match();
    return m?.room.players.find((p) => p.id === m.winnerId)?.name ?? 'Winner';
  }
  get rival(): string {
    return (
      this.game.match()?.room.players.find((p) => p.id !== this.game.backend.playerId())?.name ??
      'Your opponent'
    );
  }
  get canRematch(): boolean {
    const m = this.game.match();
    return (
      m?.status === 'finished' &&
      m.rematch?.available === true &&
      m.room.players.some((p) => p.id === this.game.backend.playerId())
    );
  }
  private ready(id: string): boolean {
    const r = this.game.match()?.rematch;
    return (
      !!r?.requestedBy.includes(id) &&
      Date.parse(r.expiresAt[id] ?? '') > Date.now() + this.game.clockOffset()
    );
  }
  get requested(): boolean {
    return this.ready(this.game.backend.playerId());
  }
  get rivalRequested(): boolean {
    const id = this.game
      .match()
      ?.room.players.find((p) => p.id !== this.game.backend.playerId())?.id;
    return !!id && this.ready(id);
  }
  async rematch(action: 'rematch' | 'cancel_rematch' = 'rematch'): Promise<void> {
    const m = this.game.match();
    if (
      !m ||
      !this.canRematch ||
      this.rematchBusy() ||
      (action === 'rematch' && this.requested) ||
      (action === 'cancel_rematch' && !this.requested)
    )
      return;
    if (this.pendingRematch?.matchId !== m.id || this.pendingRematch.action !== action)
      this.pendingRematch = { matchId: m.id, action, id: this.requestId() };
    const operation = ++this.rematchOperation;
    this.rematchBusy.set(true);
    this.rematchAction.set(action);
    this.rematchError.set('');
    try {
      const response = await this.game.send(action, { matchId: m.id }, this.pendingRematch.id);
      if (operation !== this.rematchOperation) return;
      if (!response.ok) throw Error(response.reason ?? 'rematch_unavailable');
      this.pendingRematch = undefined;
    } catch (e) {
      if (operation !== this.rematchOperation) return;
      const reason = (e as Error).message;
      const messages: Record<string, string> = {
        match_not_finished: 'This round is still in progress. Wait for the final result.',
        rematch_unavailable:
          'A rematch is unavailable for this round. Open the latest match or create another room.',
        rematch_started: 'Both players already agreed and the rematch has started.',
      };
      this.rematchError.set(
        messages[reason] ??
          'The request could not be confirmed. Try again; the same request will be retried safely.',
      );
    } finally {
      if (operation === this.rematchOperation) {
        this.rematchBusy.set(false);
        this.rematchAction.set(null);
      }
    }
  }
  title(id: string): string {
    const e = this.dataset()?.games.find((g) => g.id === id);
    return e ? `${e.title}${e.releaseYear ? ' (' + e.releaseYear + ')' : ''}` : id;
  }
  player(id: string | null): string {
    return this.game.match()?.room.players.find((p) => p.id === id)?.name ?? 'Starting title';
  }
  connector(id: string): string {
    return (
      this.dataset()?.entities[id]?.name ??
      this.game
        .match()
        ?.turns.flatMap((t) => t.connectors)
        .find((c) => c.entityId === id)?.name ??
      id
    );
  }
  roleText(roles: readonly ConnectorType[]): string {
    return roles.map((role) => ROLE_LABELS[role]).join(' / ');
  }
  get usage(): { id: string; name: string; count: number }[] {
    return Object.entries(this.game.match()?.state.usage ?? {})
      .map(([id, count]) => ({ id, count, name: this.connector(id) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  ngOnInit(): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.watchedId = id;
      this.error.set('');
      this.catalogueId = '';
      this.dataset.set(null);
      this.subscription?.unsubscribe();
      void this.game.watch('match', id).catch((e) => {
        if (this.watchedId === id) this.error.set(e.message);
      });
    });
  }
  ngOnDestroy(): void {
    this.watchedId = '';
    this.rematchOperation++;
    this.reaction.destroy();
    this.routeSubscription?.unsubscribe();
    this.subscription?.unsubscribe();
    this.game.stop();
  }
}
