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
  readonly recovering = signal(false);
  async requestPasswordReset(email: string): Promise<void> {
    if (email === 'error@example.invalid') throw Error('Could not reach the sign-in service. Check your connection and try again.');
  }
  showRecovery(): void {
    this.showAccount();
    this.recovering.set(true);
  }
  async resetPassword(password: string): Promise<void> {
    if (!this.recovering()) throw Error('Open a valid password recovery link first.');
    if (password.length < 8 || password.length > 128) throw Error('Use a password with 8–128 characters.');
    this.recovering.set(false);
  }
  readonly isGuest = computed(() => !!this.user()?.is_anonymous);
  readonly isAccount = computed(() => !!this.user()?.email && !this.isGuest());
  readonly name = computed(() => this.user()?.user_metadata?.['display_name'] ?? 'Diogo');
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
  async register(name: string, email: string, _password: string): Promise<void> {
    this.pendingName = name;
    this.verification.set({
      email,
      type: this.isGuest() ? 'email_change' : 'signup',
      userId: this.user()?.id ?? null,
    });
  }
  confirmEmail(): void {
    const pending = this.verification();
    if (!pending) throw Error('Request a confirmation email first.');
    this.user.set({
      ...this.example(pending.email),
      id: pending.userId ?? 'design-review-account',
    });
    this.clearVerification();
  }
  showPendingConfirmation(): void {
    this.showLogin();
    this.verification.set({ email: 'diogo@example.invalid', type: 'signup', userId: null });
  }
  showBrowserFallback(): void {
    this.showLogin();
    this.redirectIssue.set('');
    this.redirectNotice.set(
      'Automatic sign-in could not finish in this browser. Log in with your email and password to continue.',
    );
  }
  async updateName(name: string): Promise<void> {
    const user = this.user();
    if (!user || !this.isAccount())
      throw Error('Log in to a confirmed account before changing your name.');
    const displayName = name.trim();
    if (displayName.length < 2 || displayName.length > 24)
      throw Error('Use a name with 2–24 characters.');
    this.user.set({ ...user, user_metadata: { ...user.user_metadata, display_name: displayName } });
  }
  async resend(): Promise<void> {
    /* The example does not send an email. */
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
    this.recovering.set(false);
    this.user.set(null);
    this.clearVerification();
    this.redirectIssue.set('');
    this.redirectNotice.set('');
  }
  showAccount(): void {
    this.showLogin();
    this.user.set(this.example('diogo@example.invalid', 'Diogo'));
  }
}
