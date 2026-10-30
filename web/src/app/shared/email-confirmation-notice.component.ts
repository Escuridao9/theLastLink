import { Component, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountService } from '../core/account.service';
import { ConfigService } from '../core/config.service';
import { UiLinks } from './ui-links.service';

@Component({
  selector: 'app-email-confirmation-notice',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './email-confirmation-notice.component.html',
  styleUrl: './email-confirmation-notice.component.css',
})
export class EmailConfirmationNoticeComponent implements OnDestroy {
  readonly account = inject(AccountService);
  readonly config = inject(ConfigService);
  readonly links = inject(UiLinks);
  readonly error = signal('');
  readonly message = signal('');
  readonly sending = signal(false);
  private destroyed = false;

  async resend(): Promise<void> {
    const pending = this.account.verification();
    if (!pending || this.sending() || this.account.busy() || !this.config.configured) return;
    this.sending.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await this.account.resend();
      if (!this.destroyed && this.account.verification() === pending)
        this.message.set('Confirmation requested. Check your inbox and spam folder.');
    } catch (error) {
      if (!this.destroyed && this.account.verification() === pending)
        this.error.set(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      if (!this.destroyed) this.sending.set(false);
    }
  }
  dismiss(): void {
    if (this.sending() || this.account.busy()) return;
    this.account.clearVerification();
    this.error.set('');
    this.message.set('');
  }
  ngOnDestroy(): void {
    this.destroyed = true;
  }
}
