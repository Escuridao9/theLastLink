import { Component, inject, OnDestroy } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatchService } from '../core/match.service';
import { ReviewMatchService } from './review-services';
import { AccountService } from '../core/account.service';
import { ReviewAccountService } from './review-account.service';
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
  get onAccount(): boolean {
    return this.router.url.includes('/account');
  }
  get category(): string {
    return this.router.url.includes('football') ? 'football' : this.router.url.includes('games') ? 'games' : 'movies';
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
  result(won: boolean): void {
    this.preview.finish(won);
  }
  ngOnDestroy(): void {
    this.preview.stop();
  }
}
