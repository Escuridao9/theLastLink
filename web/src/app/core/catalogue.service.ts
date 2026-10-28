import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, shareReplay, of } from 'rxjs';
import { ConfigService } from './config.service';
import {
  MOVIES_VERSION,
  FOOTBALL_VERSION,
  CATEGORY_LABELS,
  type Category,
  type Dataset,
  type Game,
  type ConnectorType,
  type Entity,
} from './models';
interface Snapshot {
  datasetId: string;
  category?: Category;
  games?: Game[];
  movies?: Game[];
  entities?: Record<string, Entity>;
  sourceDate?: string;
}
export interface OpeningOption { mode: 'familiar'; label: string; pool_id: string; entries: number }
@Injectable({ providedIn: 'root' })
export class CatalogueService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);
  private readonly requests = new Map<string, Observable<Dataset>>();
  load(id = this.config.value.catalogueId): Observable<Dataset> {
    const cached = this.requests.get(id);
    if (cached) return cached;
    const c = this.config.value;
    const request = this.config.configured
      ? this.http
          .get<{ snapshot: Snapshot }[]>(`${c.supabaseUrl}/rest/v1/catalogues`, {
            headers: { apikey: c.supabasePublishableKey },
            params: { id: `eq.${id}`, published: 'eq.true', select: 'snapshot' },
          })
          .pipe(
            map((rows) => {
              if (!rows[0])
                throw Error(
                  'This catalogue version is not published on your server. Apply the matching catalogue migrations if needed.',
                );
              return rows[0].snapshot;
            }),
          )
      : this.http.get<Snapshot>(
          id === MOVIES_VERSION ? 'movies-index-v1.json' : id === FOOTBALL_VERSION ? 'football-index-v1.json' : 'catalogue-v1.json',
        );
    const shared = request.pipe(
      map((d) => {
        if (d.datasetId !== id) throw Error('The requested catalogue version is unavailable.');
        return this.view(d);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.requests.set(id, shared);
    return shared;
  }
  loadCategory(category: Category): Observable<Dataset> {
    if (category === 'games') return this.load();
    if (!this.config.configured)
      return this.http.get<Snapshot>(category === 'football' ? 'football-index-v1.json' : 'movies-index-v1.json').pipe(map((d) => this.view(d)));
    const c = this.config.value;
    return this.http
      .get<{ snapshot: Snapshot }[]>(`${c.supabaseUrl}/rest/v1/catalogues`, {
        headers: { apikey: c.supabasePublishableKey },
        params: {
          category_id: `eq.${category}`,
          published: 'eq.true',
          select: 'snapshot',
          order: 'created_at.desc,id.desc',
          limit: '1',
        },
      })
      .pipe(
        map((rows) => {
          if (!rows[0])
            throw Error(
              `The ${CATEGORY_LABELS[category]} catalogue is not available on this server yet. Please choose another arena.`,
            );
          return this.view(rows[0].snapshot);
        }),
      );
  }
  openingOptions(catalogueId: string): Observable<OpeningOption[]> {
    if (!this.config.configured)
      return this.http.get<Record<string, OpeningOption[]>>('opening-pools-v1.json')
        .pipe(map(pools => pools[catalogueId] ?? []));
    const c = this.config.value;
    return this.http.post<OpeningOption[]>(`${c.supabaseUrl}/rest/v1/rpc/opening_pool_options`,
      { p_catalogue_id: catalogueId }, { headers: { apikey: c.supabasePublishableKey } });
  }
  details(data: Dataset, entry: Game): Observable<Game> {
    if (entry.category === 'games') return of(entry);
    if (!this.config.configured)
      return this.http
        .get<Record<string, Game>>(`${entry.category === 'football' ? 'football' : 'movies'}/${data.datasetId}/credits-${entry.detailShard}.json`)
        .pipe(
          map((shard) => {
            const result = shard[entry.id];
            if (!result) throw Error('Entry detail is unavailable.');
            return result;
          }),
        );
    const c = this.config.value;
    return this.http
      .post<{ entityId: string; role: ConnectorType; name: string; sourceCredits: unknown[] }[]>(
        `${c.supabaseUrl}/rest/v1/rpc/${entry.category === 'football' ? 'entry_credit_details' : 'movie_credit_details'}`,
        { p_catalogue_id: data.datasetId, p_entry_id: entry.id },
        { headers: { apikey: c.supabasePublishableKey } },
      )
      .pipe(
        map((rows) => {
          const result: Game = { ...entry, credits: {}, people: {} };
          for (const row of rows) {
            (result.credits[row.role] ??= []).push({
              entityId: row.entityId,
              sourceCredits: row.sourceCredits as never,
            });
            result.people![row.entityId] = { id: row.entityId, name: row.name };
          }
          return result;
        }),
      );
  }
  private view(d: Snapshot): Dataset {
    return {
      datasetId: d.datasetId,
      category: d.category ?? 'games',
      games: d.movies ?? d.games ?? [],
      entities: d.entities ?? {},
      ...(d.sourceDate ? { sourceDate: d.sourceDate } : {}),
    };
  }
}
