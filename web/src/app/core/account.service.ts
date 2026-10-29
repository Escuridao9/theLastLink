import { Injectable, inject, computed, signal, OnDestroy } from '@angular/core';
import type { User } from '@supabase/supabase-js';
import { BackendService } from './backend.service';
import { authRedirectUrl } from './auth-navigation';

export interface AccountVerification {
  email: string;
  type: 'signup' | 'email_change';
  userId: string | null;
}
const verificationKey = 'last-link-account-verification';

export function accountError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'invalid_credentials') return 'Email or password is incorrect.';
  if (code === 'email_not_confirmed') return 'Confirm your email before logging in.';
  if (['otp_expired', 'flow_state_expired', 'flow_state_not_found'].includes(code))
    return 'That confirmation has expired or was already used. Request a new email.';
  if (code.includes('rate_limit') || code === 'over_request_rate_limit')
    return 'Too many attempts. Wait a little before trying again.';
  if (
    ['email_address_not_authorized', 'email_address_invalid', 'email_provider_disabled'].includes(
      code,
    )
  )
    return 'Email sign-up is not available for this address. Please contact the site owner.';
  if (code === 'email_exists' || code === 'user_already_exists')
    return 'This email could not be linked. Try logging in with it instead.';
  if (code === 'weak_password') return 'Choose a stronger password with at least 8 characters.';
  if (
    ['current_password_required', 'current_password_invalid', 'current_password_mismatch'].includes(
      code,
    )
  )
    return 'A registration is already in progress. Use the password you chose when requesting its confirmation email.';
  if (code === 'anonymous_provider_disabled' || code === 'manual_linking_disabled')
    return 'Guest account registration is unavailable. Please contact the site owner.';
  if (
    error instanceof TypeError ||
    (error instanceof Error && /fetch|network|connection/i.test(error.message))
  )
    return 'Could not reach the sign-in service. Check your connection and try again.';
  return 'The account request could not be completed. Please try again.';
}

@Injectable({ providedIn: 'root' })
export class AccountService implements OnDestroy {
  private readonly backend = inject(BackendService);
  readonly user = this.backend.user;
  readonly busy = this.backend.authBusy;
  readonly ready = this.backend.authReady;
  readonly redirectIssue = this.backend.authIssue;
  readonly redirectNotice = this.backend.authNotice;
  readonly isGuest = computed(() => !!this.user()?.is_anonymous);
  readonly isAccount = computed(() => !!this.user()?.email && !this.isGuest());
  readonly name = computed(() => {
    const name = this.user()?.user_metadata?.['display_name'];
    return typeof name === 'string' && name.trim() ? name.trim() : 'Player';
  });
  readonly verification = signal<AccountVerification | null>(this.readVerification());
  private readonly unsubscribeIdentity = this.backend.onIdentityChange(() =>
    this.clearVerification(),
  );
  constructor() {
    localStorage.removeItem('last-link-account-password-user');
  }
  initialize(): Promise<void> {
    return this.backend.initialize();
  }

  async login(email: string, password: string): Promise<void> {
    await this.backend.withAuth(async () => {
      const { data, error } = await this.backend.client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw Error(accountError(error));
      if (!data.user || !data.session) throw Error('A signed-in session could not be established.');
      this.requireIdentity(data.user.id);
      this.clearVerification();
    });
  }

  async register(name: string, email: string, password: string): Promise<void> {
    await this.backend.withAuth(async () => {
      const displayName = name.trim();
      if (displayName.length < 2 || displayName.length > 24)
        throw Error('Use a name with 2–24 characters.');
      const address = email.trim();
      this.validatePassword(password);
      const user = this.user();
      const redirect = authRedirectUrl(document.baseURI);
      if (user?.is_anonymous) {
        // Set the first password and request email verification in one Auth call.
        // The UUID stays the same; Auth keeps the email unverified until confirmation.
        const { data, error } = await this.backend.client.auth.updateUser(
          {
            email: address,
            password,
            current_password: password,
            data: { display_name: displayName },
          },
          { emailRedirectTo: redirect },
        );
        let updated = data.user;
        if (error?.code === 'same_password') {
          // A lost response can leave the first request committed. Auth's
          // same-password response verifies the supplied password; never replace it.
          const current = await this.backend.client.auth.getUser();
          if (current.error) throw Error(accountError(current.error));
          this.requireIdentity(user.id);
          if (current.data.user?.id !== user.id || !current.data.user.is_anonymous)
            throw Error('Your account changed. Check the signed-in account before trying again.');
          const retry = await this.backend.client.auth.updateUser(
            { email: address, data: { display_name: displayName } },
            { emailRedirectTo: redirect },
          );
          if (retry.error) throw Error(accountError(retry.error));
          updated = retry.data.user;
        } else if (error) throw Error(accountError(error));
        if (!updated || updated.id !== user.id)
          throw Error('Your guest identity could not be preserved.');
        this.requireIdentity(user.id);
        if (!updated.email_confirmed_at)
          this.setVerification({ email: address, type: 'email_change', userId: user.id });
        else this.clearVerification();
        return;
      }
      if (user?.email) throw Error('You are already signed in.');
      const { data, error } = await this.backend.client.auth.signUp({
        email: address,
        password,
        options: { data: { display_name: displayName }, emailRedirectTo: redirect },
      });
      if (error) throw Error(accountError(error));
      if (data.session && data.user) {
        this.requireIdentity(data.user.id);
        this.clearVerification();
      } else {
        // This wording also covers Supabase's intentionally obfuscated existing-user response.
        this.setVerification({ email: address, type: 'signup', userId: null });
      }
    });
  }

  async verifyEmail(token: string): Promise<void> {
    await this.backend.withAuth(async () => {
      const pending = this.verification();
      if (!pending) throw Error('Request a confirmation email first.');
      if (pending.userId && this.user()?.id !== pending.userId)
        throw Error('Return to the guest session that requested this email.');
      const { data, error } = await this.backend.client.auth.verifyOtp({
        email: pending.email,
        token: token.trim(),
        type: pending.type,
      });
      if (error) throw Error(accountError(error));
      if (!data.user || !data.session) throw Error('Email confirmation did not return a session.');
      if (pending.userId && data.user.id !== pending.userId)
        throw Error('The confirmation belongs to a different player.');
      this.requireIdentity(data.user.id);
      this.clearVerification();
    });
  }

  async resend(): Promise<void> {
    await this.backend.withAuth(async () => {
      const pending = this.verification();
      if (!pending) throw Error('Request a confirmation email first.');
      const redirect = authRedirectUrl(document.baseURI);
      if (pending.type === 'email_change') {
        if (this.user()?.id !== pending.userId)
          throw Error('Return to the guest session that requested this email.');
        const { error } = await this.backend.client.auth.updateUser(
          { email: pending.email },
          { emailRedirectTo: redirect },
        );
        if (error) throw Error(accountError(error));
      } else {
        const { error } = await this.backend.client.auth.resend({
          type: 'signup',
          email: pending.email,
          options: { emailRedirectTo: redirect },
        });
        if (error) throw Error(accountError(error));
      }
    });
  }

  async logout(): Promise<void> {
    await this.backend.withAuth(async () => {
      if (!this.isAccount())
        throw Error(
          'Guest sessions cannot be recovered after logging out. Create an account first.',
        );
      const { error } = await this.backend.client.auth.signOut({ scope: 'local' });
      if (error) throw Error(accountError(error));
      if (this.user())
        throw Error('Your account changed while logging out. Check the current account.');
      this.clearVerification();
    });
  }
  clearVerification(): void {
    this.verification.set(null);
    sessionStorage.removeItem(verificationKey);
  }
  private setVerification(value: AccountVerification): void {
    this.verification.set(value);
    sessionStorage.setItem(verificationKey, JSON.stringify(value));
  }
  private readVerification(): AccountVerification | null {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(verificationKey) ?? 'null');
      if (!value || typeof value !== 'object') return null;
      const item = value as Partial<AccountVerification>;
      if (
        typeof item.email !== 'string' ||
        item.email.length > 254 ||
        !['signup', 'email_change'].includes(item.type ?? '')
      )
        return null;
      if (item.userId !== null && typeof item.userId !== 'string') return null;
      if (item.type === 'email_change' && !item.userId) return null;
      return item as AccountVerification;
    } catch {
      return null;
    }
  }
  private validatePassword(password: string): void {
    if (password.length < 8 || password.length > 128)
      throw Error('Use a password with 8–128 characters.');
  }
  private requireIdentity(id: string): void {
    if (this.backend.playerId() !== id)
      throw Error(
        'Your account changed during this request. Check the current account and try again.',
      );
  }
  ngOnDestroy(): void {
    this.unsubscribeIdentity();
  }
}
