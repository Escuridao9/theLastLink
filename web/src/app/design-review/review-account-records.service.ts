// Route-scoped fixtures. These services never create a Supabase client or send requests.
import { inject, signal } from '@angular/core';
import { Observable, NEVER, of, throwError } from 'rxjs';
import { AccountService } from '../core/account.service';
import type { AccountOverview, HistoryCursor, MatchSummary } from '../core/account-records.service';
import type { Category } from '../core/models';
export class ReviewAccountRecordsService {
  readonly refreshToken = signal(0);
  scenario: 'history' | 'empty' | 'error' | 'loading' = 'history';
  overview(category: Category | null = null, before?: HistoryCursor): Observable<AccountOverview> {
    if (this.scenario === 'error') return throwError(() => Error('Example connection error'));
    if (this.scenario === 'loading') return NEVER;
    const history: MatchSummary[] =
      this.scenario === 'empty' || before
        ? []
        : [
            {
              id: 'design-review-movies-match',
              opponent: 'Alex',
              category: 'movies',
              finishedAt: '2026-10-29T12:42:00Z',
              outcome: 'win',
              moves: 18,
              endReason: 'timeout',
              detailsAvailable: true,
            },
            {
              id: 'design-review-football-match',
              opponent: 'Marta',
              category: 'football',
              finishedAt: '2026-10-29T11:36:00Z',
              outcome: 'loss',
              moves: 12,
              endReason: 'timeout',
              detailsAvailable: true,
            },
            {
              id: 'design-review-games-match',
              opponent: 'Rui',
              category: 'games',
              finishedAt: '2026-10-28T20:15:00Z',
              outcome: 'win',
              moves: 23,
              endReason: 'conceded',
              detailsAvailable: true,
            },
            {
              id: 'design-review-archived-one',
              opponent: 'Guest',
              category: 'movies',
              finishedAt: '2026-10-27T18:20:00Z',
              outcome: 'win',
              moves: 9,
              endReason: 'timeout',
              detailsAvailable: false,
            },
            {
              id: 'design-review-archived-two',
              opponent: 'Deleted player',
              category: 'football',
              finishedAt: '2026-10-26T21:05:00Z',
              outcome: 'loss',
              moves: 16,
              endReason: 'conceded',
              detailsAvailable: false,
            },
          ];
    const stats = (rows: MatchSummary[]) => ({
      played: rows.length,
      wins: rows.filter((row) => row.outcome === 'win').length,
      losses: rows.filter((row) => row.outcome === 'loss').length,
      winRate: rows.length
        ? Math.round((1000 * rows.filter((row) => row.outcome === 'win').length) / rows.length) / 10
        : 0,
    });
    return of({
      statistics: stats(history),
      categories: (['games', 'movies', 'football'] as const).map((key) => ({
        category: key,
        ...stats(history.filter((row) => row.category === key)),
      })),
      history: history.filter((row) => !category || row.category === category),
    });
  }
}
export class ReviewAccountOperationsService {
  private readonly account = inject(AccountService);
  private verify(current: string): void {
    if (current !== 'Preview123!') throw Error('Your current password is incorrect.');
  }
  async changePassword(
    current: string,
    password: string,
    confirm: string,
    confirmed?: () => void,
  ): Promise<void> {
    this.verify(current);
    if (password !== confirm) throw Error('The new passwords do not match.');
    confirmed?.();
    await this.account.logout();
  }
  async deleteAccount(current: string, confirmed?: () => void): Promise<void> {
    this.verify(current);
    confirmed?.();
    await this.account.logout();
  }
}
