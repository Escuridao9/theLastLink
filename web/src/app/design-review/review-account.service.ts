// Route-scoped examples only. No Supabase client, network request, or real session.
import { computed, signal } from '@angular/core';
import type { User } from '@supabase/supabase-js';
import type { AccountVerification } from '../core/account.service';
export class ReviewAccountService {
  readonly user = signal<User | null>(null);
  readonly busy = signal(false);
  readonly ready = signal(true);
  readonly redirectIssue = signal('');
  readonly redirectNotice = signal('');
  readonly verification = signal<AccountVerification | null>(null);
  readonly isGuest = computed(() => !!this.user()?.is_anonymous);
  readonly isAccount = computed(() => !!this.user()?.email && !this.isGuest());
  readonly name = computed(() => this.user()?.user_metadata?.['display_name'] ?? 'Diogo');
  readonly needsPassword = signal(false);
  private pendingName = 'Diogo';
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  private example(email: string, name = this.pendingName): User {
    return {
      id: 'design-review-account',
      email,
      is_anonymous: false,
      email_confirmed_at: '2026-10-27T12:00:00Z',
      user_metadata: { display_name: name },
      app_metadata: {},
      aud: 'authenticated',
      created_at: '2026-10-27T12:00:00Z',
    };
  }
  async login(email: string, _password: string): Promise<void> {
    if (email === 'error@example.invalid') throw Error('Email or password is incorrect.');
    this.user.set(this.example(email, 'Diogo'));
    this.clearVerification();
  }
  async register(name: string, email: string, _password?: string): Promise<void> {
    this.pendingName = name;
    this.verification.set({
      email,
      type: this.isGuest() ? 'email_change' : 'signup',
      userId: this.user()?.id ?? null,
    });
  }
  async verifyEmail(code: string): Promise<void> {
    if (code !== '123456')
      throw Error('That confirmation has expired or was already used. Request a new email.');
    const pending = this.verification();
    if (!pending) throw Error('Request a confirmation email first.');
    this.needsPassword.set(pending.type === 'email_change');
    this.user.set(this.example(pending.email));
    this.clearVerification();
  }
  async resend(): Promise<void> {
    /* The example does not send an email. */
  }
  async finishPassword(_password: string): Promise<void> {
    this.needsPassword.set(false);
  }
  async logout(): Promise<void> {
    this.showLogin();
  }
  clearVerification(): void {
    this.verification.set(null);
  }
  showGuest(): void {
    this.showLogin();
    this.user.set({
      ...this.example(''),
      email: undefined,
      email_confirmed_at: undefined,
      is_anonymous: true,
    });
  }
  showLogin(): void {
    this.user.set(null);
    this.needsPassword.set(false);
    this.clearVerification();
  }
  showAccount(): void {
    this.showLogin();
    this.user.set(this.example('diogo@example.invalid', 'Diogo'));
  }
}
