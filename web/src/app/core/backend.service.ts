import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import type { SupabaseClient, User, Subscription } from '@supabase/supabase-js';
import { ConfigService } from './config.service';
import type { CommandResponse } from './models';
import { readAuthRedirect, isDesignReviewUrl } from './auth-navigation';

@Injectable({ providedIn: 'root' })
export class BackendService implements OnDestroy {
  readonly config = inject(ConfigService);
  readonly playerId = signal('');
  readonly user = signal<User | null>(null);
  readonly authBusy = signal(false);
  readonly authReady = signal(false);
  readonly authIssue = signal('');
  readonly authNotice = signal('');
  private instance?: SupabaseClient;
  private factory?: typeof import('@supabase/supabase-js').createClient;
  private clientLoading?: Promise<void>;
  private signingIn?: Promise<void>;
  private restoring?: Promise<void>;
  private authOperation?: Promise<unknown>;
  private authSubscription?: Subscription;
  private knownIdentity: string | null | undefined;
  private restoreFailed = false;
  private restoreError?: Error;
  private authRevision = 0;
  private activityTimer?: ReturnType<typeof setInterval>;
  private activityEnabled = false;
  private readonly onActivityVisible = () => {
    if (!document.hidden) void this.pingActivity();
  };
  private readonly identityListeners = new Set<() => void>();
  get client(): SupabaseClient {
    if (!this.config.configured)
      throw Error(
        'Multiplayer needs a configured Supabase project. You can explore the published catalogue now.',
      );
    if (this.instance) return this.instance;
    if (!this.factory) throw Error('The sign-in service is still starting. Please try again.');
    this.instance = this.factory(
      this.config.value.supabaseUrl,
      this.config.value.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
          storageKey: 'last-link-auth',
        },
      },
    );
    const { data } = this.instance.auth.onAuthStateChange((_event, session) => {
      // Keep this callback synchronous: calling Auth methods here can deadlock.
      this.acceptAuthUser(session?.user ?? null);
    });
    this.authSubscription = data.subscription;
    return this.instance;
  }
  /** Cold public visits do not need to download Auth or create an identity. */
  restoreIfPresent(): Promise<void> {
    if (
      this.config.configured &&
      (localStorage.getItem('last-link-auth') || readAuthRedirect(window.location.href))
    )
      return this.initialize();
    this.authReady.set(true);
    return Promise.resolve();
  }
  private async loadClient(): Promise<void> {
    if (this.factory) return;
    this.clientLoading ??= import('@supabase/supabase-js')
      .then((module) => {
        this.factory = module.createClient;
      })
      .catch((error) => {
        this.clientLoading = undefined;
        throw error;
      });
    await this.clientLoading;
  }
  initialize(): Promise<void> {
    if (this.restoring) return this.restoring;
    this.restoring = (async () => {
      if (!this.config.configured) {
        this.authReady.set(true);
        return;
      }
      try {
        const redirect = readAuthRedirect(window.location.href);
        if (redirect) history.replaceState(history.state, '', redirect.cleanUrl);
        await this.loadClient();
        if (redirect) {
          // Remove the one-time code before the router or any view can expose it.
          if (redirect.failed || !redirect.code) {
            this.authIssue.set(
              'This confirmation link could not be completed. Try logging in or request a new email.',
            );
          } else {
            const { error } = await this.client.auth.exchangeCodeForSession(redirect.code);
            if (error)
              this.authIssue.set(
                'This confirmation link could not restore your session. Open it in the browser that requested it, or try logging in.',
              );
            else this.authNotice.set('Email confirmed. Your account is ready for the next step.');
          }
        }
        const auth = this.client.auth;
        const revision = this.authRevision;
        const { data, error } = await auth.getSession();
        if (error) throw error;
        if (revision === this.authRevision) this.acceptAuthUser(data.session?.user ?? null);
        if (this.restoreFailed) this.authIssue.set('');
        this.restoreFailed = false;
        this.restoreError = undefined;
      } catch (error) {
        this.restoreFailed = true;
        this.restoreError =
          error instanceof Error ? error : Error('Your session could not be restored.');
        this.authIssue.set('Your saved session could not be restored. Log in again to continue.');
      } finally {
        this.authReady.set(true);
      }
    })();
    void this.restoring.finally(() => {
      if (this.restoreFailed) this.restoring = undefined;
    });
    return this.restoring;
  }
  private acceptAuthUser(user: User | null): void {
    this.authRevision++;
    const previous = this.knownIdentity;
    const next = user?.id ?? null;
    this.knownIdentity = next;
    if (previous !== undefined && previous !== next) {
      const resume = localStorage.getItem('last-link-resume');
      if (previous && resume) localStorage.setItem('last-link-resume:' + previous, resume);
      if (previous) {
        localStorage.removeItem('last-link-resume');
        localStorage.removeItem('last-link-name');
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith('last-link-pending:')) sessionStorage.removeItem(key);
        }
      }
      const saved = next ? localStorage.getItem('last-link-resume:' + next) : null;
      if (saved) localStorage.setItem('last-link-resume', saved);
      // Initial guest sign-in must not cancel the watch that requested it.
      if (previous) for (const notify of this.identityListeners) notify();
    }
    this.user.set(user);
    this.playerId.set(next ?? '');
    if (next && previous !== next && this.activityEnabled) void this.pingActivity();
    const name = user?.user_metadata?.['display_name'];
    if (typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 24)
      localStorage.setItem('last-link-name', name.trim());
  }
  onIdentityChange(listener: () => void): () => void {
    this.identityListeners.add(listener);
    return () => this.identityListeners.delete(listener);
  }
  async withAuth<T>(action: () => Promise<T>): Promise<T> {
    await this.initialize();
    if (this.authOperation) throw Error('Another account request is still running.');
    const guestSignIn = this.signingIn;
    this.authBusy.set(true);
    this.authIssue.set('');
    this.authNotice.set('');
    const operation = Promise.resolve().then(async () => {
      if (guestSignIn) await guestSignIn;
      return action();
    });
    this.authOperation = operation;
    try {
      const result = await operation;
      this.restoreFailed = false;
      return result;
    } finally {
      this.authOperation = undefined;
      this.authBusy.set(false);
    }
  }
  async identity(): Promise<void> {
    await this.initialize();
    if (this.authOperation) await this.authOperation;
    if (this.restoreFailed)
      throw this.restoreError ?? Error('Restore your session before joining a room.');
    if (this.playerId()) return;
    if (this.signingIn) return this.signingIn;
    this.signingIn = (async () => {
      const revision = this.authRevision;
      const response = await this.client.auth.signInAnonymously();
      if (response.error || !response.data.user)
        throw response.error ?? Error('Anonymous sign-in failed.');
      if (revision === this.authRevision) this.acceptAuthUser(response.data.user);
      else if (this.playerId() !== response.data.user.id)
        throw Error('Your account changed while the guest session was starting. Please try again.');
    })();
    try {
      await this.signingIn;
    } finally {
      this.signingIn = undefined;
    }
  }
  ngOnDestroy(): void {
    if (this.activityTimer) clearInterval(this.activityTimer);
    document.removeEventListener('visibilitychange', this.onActivityVisible);
    this.authSubscription?.unsubscribe();
    this.identityListeners.clear();
  }
  enableActivityTracking(): void {
    if (this.activityEnabled) return;
    this.activityEnabled = true;
    this.activityTimer = setInterval(() => {
      void this.pingActivity();
    }, 60000);
    document.addEventListener('visibilitychange', this.onActivityVisible);
  }
  private async pingActivity(): Promise<void> {
    if (
      !this.user() ||
      !this.instance ||
      document.hidden ||
      isDesignReviewUrl(window.location.href)
    )
      return;
    try {
      await this.instance.rpc('account_heartbeat');
    } catch {
      /* The next visible heartbeat retries. */
    }
  }
  async clearLocalAccount(expectedId: string): Promise<void> {
    if (this.user()?.id !== expectedId) throw Error('Your account changed.');
    try {
      await this.client.auth.signOut({ scope: 'local' });
    } finally {
      if (this.user()?.id === expectedId) {
        localStorage.removeItem('last-link-auth');
        this.acceptAuthUser(null);
      }
      localStorage.removeItem('last-link-resume:' + expectedId);
    }
  }
  async command(
    action: string,
    payload: Record<string, unknown>,
    requestId: string = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    await this.identity();
    if (this.config.value.transport === 'rpc') {
      const { data, error } = await this.client.rpc('game_command', {
        p_action: action,
        p_payload: payload,
        p_request_id: requestId,
      });
      if (error) throw Error(error.message);
      return data as CommandResponse;
    }
    const { data, error } = await this.client.functions.invoke<CommandResponse>('match-api', {
      body: { action, payload, requestId },
    });
    if (error) {
      let message = error.message;
      if ('context' in error && error.context instanceof Response) {
        try {
          message = (await error.context.json()).error ?? message;
        } catch {
          /* Keep transport error. */
        }
      }
      throw Error(message);
    }
    if (!data) throw Error('The server returned an empty response.');
    return data;
  }
}
