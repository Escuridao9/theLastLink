import { Component, inject, OnDestroy } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatchService } from '../core/match.service';
import { ReviewMatchService } from './review-services';
import { AccountService } from '../core/account.service';
import { ReviewAccountService } from './review-account.service';
import { AccountRecordsService } from '../core/account-records.service';
import { ReviewAccountRecordsService } from './review-account-records.service';
@Component({
  selector: 'app-design-review',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './design-review.component.html',
  styleUrl: './design-review.component.css',
})
export class DesignReviewComponent implements OnDestroy {
  readonly preview = inject(MatchService) as unknown as ReviewMatchService;
  readonly router = inject(Router);
  readonly accounts = inject(AccountService) as unknown as ReviewAccountService;
  private readonly records = inject(
    AccountRecordsService,
  ) as unknown as ReviewAccountRecordsService;
  accountHistory(scenario: ReviewAccountRecordsService['scenario']): void {
    this.records.scenario = scenario;
    this.accounts.showAccount();
    this.records.refreshToken.update((value) => value + 1);
  }
  get onAccount(): boolean {
    return this.router.url.includes('/account');
  }
  get category(): string {
    return this.router.url.includes('football')
      ? 'football'
      : this.router.url.includes('games')
        ? 'games'
        : 'movies';
  }
  get onMatch(): boolean {
    return this.router.url.includes('/match/');
  }
  get onLobby(): boolean {
    return this.router.url.includes('/rooms/');
  }
  get onCatalogue(): boolean {
    return this.router.url.includes('/catalogue');
  }
  get onResult(): boolean {
    return this.router.url.includes('/results/');
  }
  get matchId(): string {
    return this.preview.match()?.id ?? 'design-review-' + this.category + '-match';
  }
  result(won: boolean): void {
    this.preview.finish(won);
  }
  ngOnDestroy(): void {
    this.preview.stop();
  }
}
