import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, defer, from, switchMap } from 'rxjs';
import { BackendService } from './backend.service';
import type { Category } from './models';

export interface AccountStatistics {
  played: number;
  wins: number;
  losses: number;
  winRate: number;
}
export interface MatchSummary {
  id: string;
  opponent: string;
  category: Category;
  finishedAt: string;
  outcome: 'win' | 'loss';
  moves: number;
  endReason: 'timeout' | 'conceded';
  detailsAvailable: boolean;
}
export interface AccountOverview {
  statistics: AccountStatistics;
  categories: (AccountStatistics & { category: Category })[];
  history: MatchSummary[];
}
export interface HistoryCursor {
  at: string;
  id: string;
}

@Injectable({ providedIn: 'root' })
export class AccountRecordsService {
  readonly refreshToken = signal(0);
  private readonly http = inject(HttpClient);
  private readonly backend = inject(BackendService);
  overview(category: Category | null = null, before?: HistoryCursor): Observable<AccountOverview> {
    return defer(() => from(this.credentials())).pipe(
      switchMap(({ url, headers }) =>
        this.http.post<AccountOverview>(
          url + '/rest/v1/rpc/account_overview',
          {
            p_category: category,
            p_before_at: before?.at ?? null,
            p_before_id: before?.id ?? null,
            p_limit: 20,
          },
          { headers },
        ),
      ),
    );
  }
  private async credentials() {
    await this.backend.initialize();
    const user = this.backend.user();
    if (!user || user.is_anonymous || !user.email_confirmed_at)
      throw Error('Log in to view your results.');
    const { data, error } = await this.backend.client.auth.getSession();
    if (
      error ||
      !data.session?.access_token ||
      data.session.user.id !== user.id ||
      this.backend.user()?.id !== user.id
    )
      throw Error('Your session changed. Log in again to view your results.');
    const config = this.backend.config.value;
    return {
      url: config.supabaseUrl.replace(/\/$/, ''),
      headers: new HttpHeaders({
        apikey: config.supabasePublishableKey,
        Authorization: 'Bearer ' + data.session.access_token,
      }),
    };
  }
}
