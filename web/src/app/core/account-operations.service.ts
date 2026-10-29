import { Injectable, inject } from '@angular/core';
import { BackendService } from './backend.service';
import { AccountService } from './account.service';

const messages: Record<string, string> = {
  current_password_incorrect: 'Your current password is incorrect.',
  current_password_mismatch: 'Your current password is incorrect.',
  current_password_invalid: 'Your current password is incorrect.',
  current_password_required: 'Enter your current password.',
  passwords_do_not_match: 'The new passwords do not match.',
  weak_password: 'Use a new password with 8–128 characters.',
  same_password: 'Choose a password different from your current one.',
  registered_account_required: 'Finish creating your account before changing these settings.',
  account_busy_retry: 'A game operation is finishing. Wait a moment, then try again.',
  account_changed: 'Your account changed. Check the signed-in account before trying again.',
  authentication_required: 'Log in again before changing your account.',
  reauthentication_needed: 'Log in again before changing your password.',
  rate_limit: 'Too many attempts. Wait before trying again.',
  server_not_configured: 'Account settings are unavailable. Please contact the site owner.',
};
@Injectable({ providedIn: 'root' })
export class AccountOperationsService {
  private readonly backend = inject(BackendService);
  private readonly account = inject(AccountService);
  changePassword(
    current: string,
    password: string,
    confirm: string,
    confirmed?: () => void,
  ): Promise<void> {
    if (password !== confirm) return Promise.reject(Error(messages['passwords_do_not_match']));
    return this.perform(
      { action: 'change_password', currentPassword: current, password, confirm },
      confirmed,
    );
  }
  deleteAccount(current: string, confirmed?: () => void): Promise<void> {
    return this.perform(
      { action: 'delete_account', currentPassword: current, confirmation: 'DELETE' },
      confirmed,
    );
  }
  private async perform(body: Record<string, string>, confirmed?: () => void): Promise<void> {
    await this.backend.withAuth(async () => {
      const id = this.backend.user()?.id;
      if (!id || !this.account.isAccount()) throw Error('Log in to manage your account.');
      const { data, error } = await this.backend.client.functions.invoke<{
        ok?: boolean;
        error?: string;
      }>('account-api', { body });
      let reason = data?.error;
      if (error && 'context' in error && error.context instanceof Response) {
        try {
          reason = (await error.context.json()).error;
        } catch {
          /* Keep a generic network error. */
        }
      }
      if (error || data?.ok !== true)
        throw Error(
          messages[reason ?? ''] ??
            'The account operation could not be confirmed. Check your connection and try again.',
        );
      // Never sign out another account if a different tab changed identity mid-request.
      if (this.backend.user()?.id !== id) throw Error(messages['account_changed']);
      confirmed?.();
      await this.backend.clearLocalAccount(id);
      this.account.clearVerification();
      localStorage.removeItem('last-link-account-password-user');
    });
  }
}
