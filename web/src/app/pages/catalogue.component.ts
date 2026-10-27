import { UiLinks } from '../shared/ui-links.service';
import { Component, OnInit, OnDestroy, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CatalogueService } from '../core/catalogue.service';
import { GameCardComponent } from '../shared/game-card.component';
import {
  ROLE_LABELS,
  CATEGORY_ROLES,
  type Dataset,
  type Game,
  type Category,
  type ConnectorType,
  type Entity,
} from '../core/models';
import { searchEntries } from '../../../../src/entry-search';
@Component({
  selector: 'app-catalogue',
  standalone: true,
  imports: [FormsModule, DecimalPipe, GameCardComponent, RouterLink],
  templateUrl: './catalogue.component.html',
})
export class CatalogueComponent implements OnInit, OnDestroy {
  readonly links = inject(UiLinks);
  private readonly service = inject(CatalogueService);
  private readonly route = inject(ActivatedRoute);
  readonly dataset = signal<Dataset | null>(null);
  readonly error = signal('');
  readonly loading = signal(true);
  readonly selected = signal<Game | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');
  @ViewChild('detailPanel') private detailPanel?: ElementRef<HTMLElement>;
  readonly category = signal<Category>('movies');
  readonly activeRole = signal<ConnectorType>('director');
  readonly labels = ROLE_LABELS;
  query = '';
  limit = 36;
  genre = '';
  private subscription?: Subscription;
  private detailSubscription?: Subscription;
  private routeSubscription?: Subscription;
  get roles(): ConnectorType[] {
    return CATEGORY_ROLES[this.category()];
  }
  get filtered(): Game[] {
    return searchEntries(this.dataset()?.games ?? [], this.query, [], 100000).filter(
      (g) => !this.genre || g.genres?.includes(this.genre),
    );
  }
  get visible(): Game[] {
    return this.filtered.slice(0, this.limit);
  }
  get genres(): string[] {
    return [...new Set(this.dataset()?.games.flatMap((g) => g.genres ?? []) ?? [])].sort();
  }
  creditsFor(entry: Game, role: ConnectorType) {
    return [...(entry.credits[role] ?? [])].sort((a, b) => {
      const order = (credit: typeof a) =>
        Math.min(
          ...(credit.sourceCredits ?? []).map(
            (c) => (c as { order?: number }).order ?? Number.MAX_SAFE_INTEGER,
          ),
        );
      return (
        order(a) - order(b) ||
        (this.person(a.entityId)?.name ?? a.entityId).localeCompare(
          this.person(b.entityId)?.name ?? b.entityId,
        )
      );
    });
  }
  person(id: string): Entity | undefined {
    return this.selected()?.people?.[id] ?? this.dataset()?.entities[id];
  }
  source(id: string): string {
    return id.startsWith('tmdb:person:')
      ? 'https://www.themoviedb.org/person/' + id.split(':')[2]
      : (this.person(id)?.sourceUrl ??
          'https://www.wikidata.org/wiki/' + id.replace('wikidata:', ''));
  }
  jobs(credit: { sourceCredits?: { job?: string; character?: string }[] }): string {
    return [
      ...new Set(credit.sourceCredits?.map((c) => c.job ?? c.character).filter(Boolean) ?? []),
    ].join(' / ');
  }
  inspect(entry: Game): void {
    const d = this.dataset();
    if (!d) return;
    this.selected.set(entry);
    this.detailPanel?.nativeElement.focus({ preventScroll: window.innerWidth > 900 });
    this.detailError.set('');
    this.detailLoading.set(true);
    this.detailSubscription?.unsubscribe();
    this.detailSubscription = this.service.details(d, entry).subscribe({
      next: (full) => {
        this.selected.set(full);
        this.detailLoading.set(false);
      },
      error: () => {
        this.detailError.set('Credits could not be loaded. Select this title to retry.');
        this.detailLoading.set(false);
      },
    });
  }
  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.dataset.set(null);
    this.selected.set(null);
    this.detailSubscription?.unsubscribe();
    this.subscription?.unsubscribe();
    this.subscription = this.service.loadCategory(this.category()).subscribe({
      next: (data) => {
        this.dataset.set(data);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e.message ?? 'The catalogue could not be loaded.');
        this.loading.set(false);
      },
    });
  }
  ngOnInit(): void {
    this.routeSubscription = this.route.queryParamMap.subscribe((params) => {
      this.category.set(params.get('category') === 'games' ? 'games' : 'movies');
      this.activeRole.set(this.category() === 'movies' ? 'director' : 'developer');
      this.query = '';
      this.genre = '';
      this.limit = 36;
      this.load();
    });
  }
  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.detailSubscription?.unsubscribe();
    this.routeSubscription?.unsubscribe();
  }
}
