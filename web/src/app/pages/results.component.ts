import { UiLinks } from '../shared/ui-links.service';
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalogue = inject(CatalogueService);
  readonly dataset = signal<Dataset | null>(null);
  private subscription?: Subscription;
  readonly error = signal('');
  private catalogueId = '';
  private readonly reaction = effect(() => {
    const match = this.game.match();
    if (!match) return;
    if (match.status === 'active') {
      void this.router.navigate([this.links.to('/match'), match.id], { replaceUrl: true });
      return;
    }
    if (match.catalogueId !== this.catalogueId) {
      this.catalogueId = match.catalogueId;
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
    void this.game
      .watch('match', this.route.snapshot.paramMap.get('id')!)
      .catch((e) => this.error.set(e.message));
  }
  ngOnDestroy(): void {
    this.reaction.destroy();
    this.subscription?.unsubscribe();
    this.game.stop();
  }
}
