import { REQUEST_ID } from '../shared/request-id';
import { UiLinks } from '../shared/ui-links.service';
import { Component, OnInit, OnDestroy, inject, signal, effect } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatchService } from '../core/match.service';
import { CatalogueService } from '../core/catalogue.service';
import { CATEGORY_LABELS, ROLE_LABELS } from '../core/models';
import type { Dataset, Game, SharedConnector } from '../core/models';
import { GameSearchComponent } from '../shared/game-search.component';
import { TurnClockComponent } from '../shared/turn-clock.component';
@Component({
  selector: 'app-match',
  standalone: true,
  imports: [RouterLink, GameSearchComponent, TurnClockComponent],
  templateUrl: './match.component.html',
})
export class MatchComponent implements OnInit, OnDestroy {
  readonly links = inject(UiLinks);
  private readonly requestId = inject(REQUEST_ID);
  readonly game = inject(MatchService);
  readonly categories = CATEGORY_LABELS;
  readonly labels = ROLE_LABELS;
  private readonly catalogue = inject(CatalogueService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly dataset = signal<Dataset | null>(null);
  readonly selected = signal<Game | null>(null);
  readonly busy = signal(false);
  readonly feedback = signal('');
  readonly error = signal('');
  readonly responseConnectors = signal<SharedConnector[]>([]);
  private subscription?: Subscription;
  private catalogueId = '';
  private selectionTurn = '';
  private pending?: { payload: Record<string, unknown>; id: string };
  private readonly reaction = effect(() => {
    const match = this.game.match();
    if (!match) return;
    const turn = `${match.id}:${match.state.version}`;
    if (turn !== this.selectionTurn) {
      this.selectionTurn = turn;
      this.selected.set(null);
    }
    localStorage.setItem('last-link-resume', match.id);
    if (match.status === 'finished') {
      void this.router.navigate([this.links.to('/results'), match.id], { replaceUrl: true });
      return;
    }
    if (this.catalogueId !== match.catalogueId) {
      this.catalogueId = match.catalogueId;
      this.subscription?.unsubscribe();
      this.subscription = this.catalogue.load(match.catalogueId).subscribe({
        next: (d) => this.dataset.set(d),
        error: () =>
          this.error.set('The match catalogue could not be loaded. Refresh to try again.'),
      });
    }
  });
  get myTurn(): boolean {
    return this.game.match()?.activePlayer === this.game.backend.playerId();
  }
  get current(): Game | undefined {
    return this.dataset()?.games.find((g) => g.id === this.game.match()?.state.currentGameId);
  }
  get usage(): { id: string; name: string; count: number }[] {
    return Object.entries(this.game.match()?.state.usage ?? {})
      .map(([id, count]) => ({ id, name: this.connector(id), count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  title(id: string): string {
    const entry = this.dataset()?.games.find((g) => g.id === id);
    return entry ? `${entry.title}${entry.releaseYear ? ' (' + entry.releaseYear + ')' : ''}` : id;
  }
  player(id: string | null): string {
    return id
      ? (this.game.match()?.room.players.find((p) => p.id === id)?.name ?? 'Player')
      : 'Starting entry';
  }
  roleText(roles: readonly (keyof typeof ROLE_LABELS)[] | undefined): string {
    return roles?.map((role) => this.labels[role]).join(' / ') ?? '';
  }
  connector(id: string): string {
    return (
      this.dataset()?.entities[id]?.name ??
      this.responseConnectors().find((c) => c.entityId === id)?.name ??
      this.game
        .match()
        ?.turns.flatMap((t) => t.connectors)
        .find((c) => c.entityId === id)?.name ??
      id
    );
  }
  ngOnInit(): void {
    void this.game
      .watch('match', this.route.snapshot.paramMap.get('id')!)
      .catch((e) => this.error.set(e.message));
  }
  async submit(): Promise<void> {
    const match = this.game.match(),
      selected = this.selected();
    if (!match || !selected || !this.myTurn || this.busy()) return;
    const payload = {
      matchId: match.id,
      entryId: selected.id,
      expectedVersion: match.state.version,
    };
    const key = `last-link-pending:${match.id}`;
    try {
      this.pending = JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined;
    } catch {
      this.pending = undefined;
    }
    if (!this.pending || JSON.stringify(this.pending.payload) !== JSON.stringify(payload))
      this.pending = { payload, id: this.requestId() };
    sessionStorage.setItem(key, JSON.stringify(this.pending));
    this.busy.set(true);
    this.error.set('');
    this.feedback.set('');
    this.responseConnectors.set([]);
    try {
      const response = await this.game.send('submit', payload, this.pending.id);
      sessionStorage.removeItem(key);
      this.pending = undefined;
      if (response.ok) {
        this.selected.set(null);
        this.responseConnectors.set(response.connectors ?? []);
        this.feedback.set('Connection accepted. The pressure is on your opponent.');
      } else {
        const messages: Record<string, string> = {
          exhausted_connector:
            'An eligible shared connector is already at 3/3. Every shared connector must have capacity.',
          no_shared_connector:
            'These entries share no eligible connector in this catalogue. Try again — the timer is still running.',
          repeated_game: 'That title has already been played. Choose a new one.',
          stale_version: 'The turn has changed. The latest state is shown.',
          not_your_turn: 'It is your opponent’s turn.',
          unknown_game: 'Choose a title from this match’s catalogue.',
          match_finished: 'The match has ended.',
        };
        this.error.set(messages[response.reason ?? ''] ?? 'The answer was rejected.');
        this.responseConnectors.set(response.connectors ?? []);
      }
    } catch (e) {
      this.error.set(`${(e as Error).message} Retry the same answer to safely check its outcome.`);
    } finally {
      this.busy.set(false);
    }
  }
  async elapsed(): Promise<void> {
    const match = this.game.match();
    if (match?.status === 'active') {
      try {
        await this.game.send('expire', { matchId: match.id });
      } catch {
        /* Cron is authoritative; reconnect polling will refresh. */
      }
    }
  }
  ngOnDestroy(): void {
    this.reaction.destroy();
    this.subscription?.unsubscribe();
    this.game.stop();
  }
}
