import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AccountService } from '../core/account.service';
import { accountReturnPath } from '../core/auth-navigation';
@Component({
  selector: 'app-account-link',
  standalone: true,
  imports: [RouterLink],
  template: `<a class="nav-account" routerLink="/account" [queryParams]="{ returnTo: returnTo }">{{
    account.isAccount() ? 'Account' : 'Log in'
  }}</a>`,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
    .nav-account {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      min-width: 44px;
      color: var(--ll-lilac);
      font: inherit;
      white-space: nowrap;
      padding: 10px 0;
    }
  `,
})
export class AccountLinkComponent {
  readonly account = inject(AccountService);
  private readonly router = inject(Router);
  get returnTo(): string {
    return accountReturnPath(this.router.url);
  }
}
