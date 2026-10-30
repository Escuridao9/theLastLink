import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { BackendService } from './backend.service';
import { AccountService } from './account.service';
import { ConfigService } from './config.service';
import { MatchService } from './match.service';
import type { Match } from './models';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
const password = 'A test password 123!';
const configuration = {
  configured: true,
  value: {
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_publishable_synthetic_test',
    transport: 'edge',
  },
};
function person(id = 'account-one', guest = false): User {
  return {
    id,
    is_anonymous: guest,
    email: guest ? undefined : 'diogo@example.invalid',
    email_confirmed_at: guest ? undefined : '2026-10-27T12:00:00Z',
    user_metadata: { display_name: 'Diogo' },
    app_metadata: {},
    aud: 'authenticated',
    created_at: '2026-10-27T12:00:00Z',
  };
}
function fixture(initial: User | null = null) {
  let current = initial;
  const callbacks = new Set<(event: string, session: { user: User } | null) => void>();
  const unsubscribe = vi.fn();
  const session = (user: User | null) =>
    user ? { user, access_token: 'test-access-token', refresh_token: 'test-refresh-token' } : null;
  const emit = (user: User | null, event = user ? 'SIGNED_IN' : 'SIGNED_OUT') => {
    current = user;
    for (const callback of callbacks) callback(event, session(user));
  };
  const auth = {
    onAuthStateChange: vi.fn((callback: (event: string, value: { user: User } | null) => void) => {
      callbacks.add(callback);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              callbacks.delete(callback);
              unsubscribe();
            },
          },
        },
      };
    }),
    getSession: vi.fn(async () => ({ data: { session: session(current) }, error: null })),
    getUser: vi.fn(async () => ({
      data: { user: current },
      error: null as null | { code: string },
    })),
    signInAnonymously: vi.fn(async () => {
      const user = person('guest-one', true);
      emit(user);
      return { data: { user, session: session(user) }, error: null };
    }),
    signInWithPassword: vi.fn(async (_credentials: unknown) => {
      const user = person();
      emit(user);
      return { data: { user, session: session(user) }, error: null as null | { code: string } };
    }),
    signUp: vi.fn(async (_credentials: unknown) => ({
      data: { user: person(), session: null as ReturnType<typeof session> },
      error: null as null | { code: string },
    })),
    updateUser: vi.fn(
      async (
        attributes: {
          email?: string;
          password?: string;
          current_password?: string;
          data?: Record<string, unknown>;
        },
        _options?: unknown,
      ) => {
        const user = { ...current!, user_metadata: attributes.data ?? current!.user_metadata };
        if (attributes.email && !current!.is_anonymous) user.email = attributes.email;
        emit(user, 'USER_UPDATED');
        return { data: { user }, error: null as null | { code: string } };
      },
    ),
    verifyOtp: vi.fn(async (request: { email: string; token: string; type: string }) => {
      const user: User = { ...person(current?.id ?? 'account-one'), email: request.email };
      emit(user);
      return { data: { user, session: session(user) }, error: null as null | { code: string } };
    }),
    resend: vi.fn(async (_request: unknown) => ({ data: {}, error: null })),
    resetPasswordForEmail: vi.fn(async (_email: string, _options: unknown) => ({ data: {}, error: null as null | { code: string } })),
    signOut: vi.fn(async (_options: unknown) => {
      emit(null);
      return { error: null };
    }),
    exchangeCodeForSession: vi.fn(async (_code: string) => {
      const user = person();
      emit(user);
      return {
        data: { user, session: session(user) },
        error: null as null | { code?: string; name?: string },
      };
    }),
  };
  const client = {
    auth,
    functions: { invoke: vi.fn() },
    removeChannel: vi.fn().mockResolvedValue('ok'),
  };
  vi.mocked(createClient).mockReturnValue(client as unknown as ReturnType<typeof createClient>);
  TestBed.configureTestingModule({
    providers: [{ provide: ConfigService, useValue: configuration }],
  });
  return {
    account: TestBed.inject(AccountService),
    backend: TestBed.inject(BackendService),
    auth,
    client,
    emit,
    unsubscribe,
  };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('Real account service with an isolated Auth transport', () => {
  it('requests password recovery with a GitHub Pages safe callback and never creates a guest', async () => {
    const f = fixture();
    await f.account.requestPasswordReset('  diogo@example.invalid  ');
    expect(f.auth.resetPasswordForEmail).toHaveBeenCalledWith('diogo@example.invalid', {
      redirectTo: new URL('?auth=recovery', document.baseURI).href,
    });
    expect(f.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(f.backend.recoveryUserId()).toBe('');
  });
  it('updates a password only after a real recovery Auth event, preserving the identity', async () => {
    const f = fixture(person());
    await f.account.initialize();
    await expect(f.account.resetPassword(password)).rejects.toThrow('valid password recovery link');
    expect(f.auth.updateUser).not.toHaveBeenCalled();
    f.emit(person(), 'PASSWORD_RECOVERY');
    expect(f.account.recovering()).toBe(true);
    await f.account.resetPassword(password);
    expect(f.auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password });
    expect(f.backend.playerId()).toBe('account-one');
    expect(f.account.recovering()).toBe(false);
  });
  it('rejects weak passwords, keeps a recoverable error, and blocks late updates after identity changes', async () => {
    const f = fixture(person()); await f.account.initialize(); f.emit(person(),'PASSWORD_RECOVERY');
    await expect(f.account.resetPassword('short')).rejects.toThrow('8–128');
    f.auth.updateUser.mockResolvedValueOnce({ data:{user:person()},error:{code:'same_password'} });
    await expect(f.account.resetPassword(password)).rejects.toThrow('different password');
    expect(f.account.recovering()).toBe(true);
    f.emit(person('other-account'));
    expect(f.account.recovering()).toBe(false);
    await expect(f.account.resetPassword(password)).rejects.toThrow('valid password recovery link');
    expect(f.auth.updateUser).toHaveBeenCalledTimes(1);
  });
  it('does not treat a recovery URL or ordinary login as permission to reset a password', async () => {
    history.replaceState(null,'','/?auth=recovery&code=ordinary-login-code');
    const f = fixture(); await f.account.initialize();
    expect(f.account.recovering()).toBe(false);
    expect(f.account.redirectIssue()).toContain('did not establish a password recovery session');
    await expect(f.account.resetPassword(password)).rejects.toThrow('valid password recovery link');
    expect(location.search).toBe('');
    expect(location.hash).toBe('#/account?mode=reset');
  });
  it('opens the reset form for a verified recovery callback and scrubs its one-time code', async () => {
    history.replaceState(null,'','/?auth=recovery&code=recovery-code');
    const f = fixture();
    f.auth.exchangeCodeForSession.mockImplementation(async () => {
      const user = person(); f.emit(user,'PASSWORD_RECOVERY');
      return {data:{user,session:{user,access_token:'test-access-token',refresh_token:'test-refresh-token'}},error:null};
    });
    await f.account.initialize();
    expect(f.account.recovering()).toBe(true);
    expect(f.account.redirectNotice()).toContain('new password');
    expect(f.account.redirectNotice()).not.toContain('Email confirmed');
    expect(location.search).toBe(''); expect(location.hash).toBe('#/account?mode=reset');
  });
  it('provides recovery-specific guidance in a different browser instead of requiring a forgotten password', async () => {
    history.replaceState(null,'','/?auth=recovery&code=recovery-code');
    const f = fixture();
    f.auth.exchangeCodeForSession.mockResolvedValueOnce({data:{user:person(),session:null as never},error:{name:'AuthPKCECodeVerifierMissingError'}});
    await f.account.initialize();
    expect(f.account.redirectNotice()).toContain('Request a new recovery email here');
    expect(f.account.redirectNotice()).not.toContain('Log in with your email and password');
    expect(f.account.recovering()).toBe(false);
    expect(f.account.redirectIssue()).toBe('');
  });
  it('reports invalid recovery links separately and does not restore recovery privileges after a normal login', async () => {
    history.replaceState(null,'','/?auth=recovery&error=access_denied');
    const f = fixture(); await f.account.initialize();
    expect(f.account.redirectIssue()).toContain('password recovery link is invalid or expired');
    f.emit(person(),'PASSWORD_RECOVERY'); expect(f.account.recovering()).toBe(true);
    f.emit(person(),'SIGNED_IN'); expect(f.account.recovering()).toBe(false);
  });
  it('updates only the confirmed account display name, preserving its identity and match resume', async () => {
    const f = fixture(person());
    await f.account.initialize();
    localStorage.setItem('last-link-resume', 'existing-match');
    const changed = vi.fn();
    f.backend.onIdentityChange(changed);
    await f.account.updateName(' Alex ');
    expect(f.auth.updateUser).toHaveBeenCalledExactlyOnceWith({ data: { display_name: 'Alex' } });
    expect(f.account.name()).toBe('Alex');
    expect(f.backend.playerId()).toBe('account-one');
    expect(f.account.user()?.email).toBe('diogo@example.invalid');
    expect(localStorage.getItem('last-link-name')).toBe('Alex');
    expect(localStorage.getItem('last-link-resume')).toBe('existing-match');
    expect(changed).not.toHaveBeenCalled();
    expect(f.auth.signUp).not.toHaveBeenCalled();
  });
  it('rejects invalid display names before changing Auth metadata', async () => {
    const f = fixture(person());
    for (const name of ['', '   ', 'x', 'x'.repeat(25)])
      await expect(f.account.updateName(name)).rejects.toThrow('2–24');
    expect(f.auth.updateUser).not.toHaveBeenCalled();
    expect(f.account.name()).toBe('Diogo');
  });
  it.each([null, person('guest-one', true), { ...person(), email_confirmed_at: undefined }])(
    'requires a signed-in confirmed account for name edits (%j)',
    async (user) => {
      const f = fixture(user);
      await expect(f.account.updateName('Alex')).rejects.toThrow('confirmed account');
      expect(f.auth.updateUser).not.toHaveBeenCalled();
    },
  );
  it('preserves the previous name and unlocks the form after a failed metadata update', async () => {
    const f = fixture(person());
    f.auth.updateUser.mockResolvedValueOnce({
      data: { user: person() },
      error: { code: 'over_request_rate_limit' },
    });
    await expect(f.account.updateName('Alex')).rejects.toThrow('Too many attempts');
    expect(f.account.name()).toBe('Diogo');
    expect(f.account.busy()).toBe(false);
  });
  it('rejects a late profile response after another account signs in', async () => {
    const f = fixture(person());
    let complete!: (value: Awaited<ReturnType<typeof f.auth.updateUser>>) => void;
    f.auth.updateUser.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const saving = f.account.updateName('Alex');
    const rejected = expect(saving).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(f.auth.updateUser).toHaveBeenCalledOnce());
    f.emit(person('another-account'));
    complete({
      data: { user: { ...person(), user_metadata: { display_name: 'Alex' } } },
      error: null,
    });
    await rejected;
    expect(f.backend.playerId()).toBe('another-account');
    expect(f.account.name()).toBe('Diogo');
  });
  it.each([{ name: 'AuthPKCECodeVerifierMissingError' }, { code: 'bad_code_verifier' }])(
    'offers login without claiming confirmation when the browser verifier is unavailable (%j)',
    async (error) => {
      history.replaceState(null, '', '/theLastLink/?code=one-time-code');
      const f = fixture();
      f.auth.exchangeCodeForSession.mockResolvedValueOnce({
        data: { user: person(), session: null },
        error,
      });
      await f.account.initialize();
      expect(f.account.redirectIssue()).toBe('');
      expect(f.account.redirectNotice()).toContain('Automatic sign-in could not finish');
      expect(f.account.redirectNotice()).not.toContain('Email confirmed');
      expect(f.account.isAccount()).toBe(false);
      expect(f.account.ready()).toBe(true);
      expect(f.auth.signInAnonymously).not.toHaveBeenCalled();
      expect(location.search).toBe('');
      expect(location.hash).toBe('#/account');
      await f.account.login('diogo@example.invalid', password);
      expect(f.account.isAccount()).toBe(true);
      expect(f.account.redirectNotice()).toBe('');
    },
  );
  it('restores an account without creating a guest and keeps the existing SDK storage key', async () => {
    const f = fixture(person());
    await f.account.initialize();
    expect(f.account.isAccount()).toBe(true);
    expect(f.backend.playerId()).toBe('account-one');
    expect(f.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledWith(
      configuration.value.supabaseUrl,
      configuration.value.supabasePublishableKey,
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
  });
  it('does not create a guest merely because a logged-out visitor opens the account page', async () => {
    const f = fixture();
    await f.account.initialize();
    expect(f.account.user()).toBeNull();
    expect(f.auth.signInAnonymously).not.toHaveBeenCalled();
  });
  it('keeps the SDK out of a fresh public visit until an account operation needs it', async () => {
    vi.mocked(createClient).mockClear();
    const f = fixture();
    await f.backend.restoreIfPresent();
    expect(f.auth.getSession).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(f.account.ready()).toBe(true);
    await f.account.initialize();
    expect(f.auth.getSession).toHaveBeenCalledTimes(1);
  });
  it('signs in through the same Auth client used by match-api and prefills the player name', async () => {
    const f = fixture();
    await f.account.login(' diogo@example.invalid ', password);
    expect(f.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'diogo@example.invalid',
      password,
    });
    expect(f.backend.playerId()).toBe('account-one');
    expect(localStorage.getItem('last-link-name')).toBe('Diogo');
    expect(f.account.busy()).toBe(false);
  });
  it('shows a clear credential error and clears busy state after a failed login', async () => {
    const f = fixture();
    f.auth.signInWithPassword.mockResolvedValue({
      data: { user: person(), session: null },
      error: { code: 'invalid_credentials' },
    });
    await expect(f.account.login('diogo@example.invalid', password)).rejects.toThrow(
      'Email or password is incorrect',
    );
    expect(f.account.user()).toBeNull();
    expect(f.account.busy()).toBe(false);
  });
  it('registers a new visitor with email confirmation and never creates an anonymous identity', async () => {
    const f = fixture();
    await f.account.register(' Diogo ', 'diogo@example.invalid', password);
    expect(f.auth.signUp).toHaveBeenCalledWith({
      email: 'diogo@example.invalid',
      password,
      options: {
        data: { display_name: 'Diogo' },
        emailRedirectTo: new URL(document.baseURI).origin + '/',
      },
    });
    expect(f.account.verification()).toEqual({
      email: 'diogo@example.invalid',
      type: 'signup',
      userId: null,
    });
    expect(f.account.isAccount()).toBe(false);
    expect(f.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(password);
  });
  it('keeps pending verification across a page reload without storing the password', async () => {
    const f = fixture();
    await f.account.register('Diogo', 'diogo@example.invalid', password);
    TestBed.resetTestingModule();
    const restored = fixture();
    expect(restored.account.verification()?.email).toBe('diogo@example.invalid');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(password);
  });
  it('verifies a new account with the signup OTP type', async () => {
    const f = fixture();
    await f.account.register('Diogo', 'diogo@example.invalid', password);
    await f.account.verifyEmail('123456');
    expect(f.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'diogo@example.invalid',
      token: '123456',
      type: 'signup',
    });
    expect(f.account.isAccount()).toBe(true);
    expect(f.account.verification()).toBeNull();
  });
  it('sets the guest email and password together, preserves its UUID and finishes on email verification', async () => {
    const f = fixture(person('guest-one', true));
    await f.account.initialize();
    localStorage.setItem('last-link-resume', 'existing-match');
    const changed = vi.fn();
    f.backend.onIdentityChange(changed);
    await f.account.register('Diogo', 'diogo@example.invalid', password);
    expect(f.auth.signUp).not.toHaveBeenCalled();
    expect(f.auth.updateUser).toHaveBeenCalledWith(
      {
        email: 'diogo@example.invalid',
        password,
        current_password: password,
        data: { display_name: 'Diogo' },
      },
      expect.objectContaining({ emailRedirectTo: expect.any(String) }),
    );
    expect(f.account.verification()?.type).toBe('email_change');
    expect(f.account.isGuest()).toBe(true);
    expect(f.auth.updateUser).toHaveBeenCalledTimes(1);
    await f.account.verifyEmail('123456');
    expect(f.account.isAccount()).toBe(true);
    expect(f.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(f.backend.playerId()).toBe('guest-one');
    expect(changed).not.toHaveBeenCalled();
    expect(localStorage.getItem('last-link-resume')).toBe('existing-match');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(password);
    expect(localStorage.getItem('last-link-account-password-user')).toBeNull();
  });
  it('clears pending guest verification when a different identity signs in', async () => {
    const f = fixture(person('guest-one', true));
    await f.account.register('Diogo', 'diogo@example.invalid', password);
    f.emit(person('another-account'));
    expect(f.account.verification()).toBeNull();
    expect(sessionStorage.getItem('last-link-account-verification')).toBeNull();
    await expect(f.account.verifyEmail('123456')).rejects.toThrow(
      'Request a confirmation email first',
    );
    expect(f.auth.verifyOtp).not.toHaveBeenCalled();
  });
  it('validates a guest password before requesting any email or Auth mutation', async () => {
    const f = fixture(person('guest-one', true));
    for (const value of ['', 'short', 'x'.repeat(129)]) {
      await expect(f.account.register('Diogo', 'diogo@example.invalid', value)).rejects.toThrow(
        '8–128',
      );
    }
    expect(f.auth.updateUser).not.toHaveBeenCalled();
    expect(f.auth.signUp).not.toHaveBeenCalled();
    expect(f.account.verification()).toBeNull();
    expect(f.account.busy()).toBe(false);
  });
  it('resumes an already-committed guest signup after Auth verifies the same password', async () => {
    const f = fixture(person('guest-one', true));
    f.auth.updateUser.mockResolvedValueOnce({
      data: { user: person('guest-one', true) },
      error: { code: 'same_password' },
    });
    await f.account.register('Diogo', 'diogo@example.invalid', password);
    expect(f.auth.getUser).toHaveBeenCalledOnce();
    expect(f.auth.updateUser).toHaveBeenCalledTimes(2);
    expect(f.auth.updateUser).toHaveBeenLastCalledWith(
      { email: 'diogo@example.invalid', data: { display_name: 'Diogo' } },
      expect.objectContaining({ emailRedirectTo: expect.any(String) }),
    );
    expect(f.account.verification()?.userId).toBe('guest-one');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(password);
  });
  it('never drops a rejected password and retries with an email-only mutation', async () => {
    const f = fixture(person('guest-one', true));
    f.auth.updateUser.mockResolvedValueOnce({
      data: { user: person('guest-one', true) },
      error: { code: 'current_password_mismatch' },
    });
    await expect(f.account.register('Diogo', 'diogo@example.invalid', password)).rejects.toThrow(
      'registration is already in progress',
    );
    expect(f.auth.updateUser).toHaveBeenCalledOnce();
    expect(f.auth.getUser).not.toHaveBeenCalled();
    expect(f.account.verification()).toBeNull();
  });
  it('does not retry guest signup after the server reports that it is already a registered account', async () => {
    const f = fixture(person('guest-one', true));
    f.auth.updateUser.mockResolvedValueOnce({
      data: { user: person('guest-one', true) },
      error: { code: 'same_password' },
    });
    f.auth.getUser.mockResolvedValueOnce({ data: { user: person('guest-one') }, error: null });
    await expect(f.account.register('Diogo', 'diogo@example.invalid', password)).rejects.toThrow(
      'account changed',
    );
    expect(f.auth.updateUser).toHaveBeenCalledOnce();
  });
  it('restores guest verification after a reload without saving a password or requiring another password step', async () => {
    const f = fixture(person('guest-one', true));
    await f.account.register('Diogo', 'diogo@example.invalid', password);
    const pending = sessionStorage.getItem('last-link-account-verification');
    TestBed.resetTestingModule();
    const restored = fixture(person('guest-one', true));
    expect(sessionStorage.getItem('last-link-account-verification')).toBe(pending);
    await restored.account.verifyEmail('123456');
    expect(restored.account.isAccount()).toBe(true);
    expect(restored.backend.playerId()).toBe('guest-one');
    expect(restored.auth.updateUser).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(password);
  });
  it('locks account operations while an already-started guest sign-in finishes', async () => {
    const f = fixture();
    let finishGuest!: (value: Awaited<ReturnType<typeof f.auth.signInAnonymously>>) => void;
    f.auth.signInAnonymously.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishGuest = resolve;
        }),
    );
    const joining = f.backend.identity();
    await vi.waitFor(() => expect(f.auth.signInAnonymously).toHaveBeenCalledTimes(1));
    const login = f.account.login('diogo@example.invalid', password);
    await vi.waitFor(() => expect(f.account.busy()).toBe(true));
    await expect(f.account.register('Diogo', 'other@example.invalid', password)).rejects.toThrow(
      'Another account request',
    );
    expect(f.auth.signInWithPassword).not.toHaveBeenCalled();
    const guest = person('guest-one', true);
    f.emit(guest);
    finishGuest({
      data: {
        user: guest,
        session: {
          user: guest,
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
        },
      },
      error: null,
    });
    await joining;
    await login;
    expect(f.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(f.auth.signUp).not.toHaveBeenCalled();
    expect(f.backend.playerId()).toBe('account-one');
    expect(f.account.busy()).toBe(false);
  });
  it('never retries an email update for another identity after a same-password response', async () => {
    const f = fixture(person('guest-one', true));
    f.auth.updateUser.mockResolvedValueOnce({
      data: { user: person('guest-one', true) },
      error: { code: 'same_password' },
    });
    let finishVerification!: (value: Awaited<ReturnType<typeof f.auth.getUser>>) => void;
    f.auth.getUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishVerification = resolve;
        }),
    );
    const finishing = f.account.register('Diogo', 'diogo@example.invalid', password);
    const rejected = expect(finishing).rejects.toThrow('Your account changed');
    await vi.waitFor(() => expect(f.auth.getUser).toHaveBeenCalledTimes(1));
    f.emit(person('another-account'));
    finishVerification({ data: { user: person('guest-one') }, error: null });
    await rejected;
    expect(f.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(f.backend.playerId()).toBe('another-account');
    expect(f.account.busy()).toBe(false);
  });
  it('does not let a late guest response replace a newer signed-in account', async () => {
    const f = fixture();
    let finishGuest!: (value: Awaited<ReturnType<typeof f.auth.signInAnonymously>>) => void;
    f.auth.signInAnonymously.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishGuest = resolve;
        }),
    );
    const joining = f.backend.identity();
    const rejected = expect(joining).rejects.toThrow('Your account changed');
    await vi.waitFor(() => expect(f.auth.signInAnonymously).toHaveBeenCalledTimes(1));
    f.emit(person('new-account'));
    const guest = person('guest-one', true);
    finishGuest({
      data: {
        user: guest,
        session: {
          user: guest,
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
        },
      },
      error: null,
    });
    await rejected;
    expect(f.backend.playerId()).toBe('new-account');
    expect(f.account.isAccount()).toBe(true);
  });
  it('resends the correct confirmation flow for new accounts and guests', async () => {
    const f = fixture();
    await f.account.register('Diogo', 'diogo@example.invalid', password);
    await f.account.resend();
    expect(f.auth.resend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'signup', email: 'diogo@example.invalid' }),
    );
    f.emit(person('guest-one', true));
    await f.account.register('Diogo', 'guest@example.invalid', password);
    await f.account.resend();
    expect(f.auth.updateUser).toHaveBeenLastCalledWith(
      { email: 'guest@example.invalid' },
      expect.any(Object),
    );
  });
  it('keeps the verification form usable after an expired code', async () => {
    const f = fixture();
    await f.account.register('Diogo', 'diogo@example.invalid', password);
    f.auth.verifyOtp.mockResolvedValue({
      data: { user: person(), session: null },
      error: { code: 'otp_expired' },
    });
    await expect(f.account.verifyEmail('123456')).rejects.toThrow('expired or was already used');
    expect(f.account.verification()).not.toBeNull();
    expect(f.account.busy()).toBe(false);
  });
  it('remembers resume IDs per identity and clears pending answer state on logout', async () => {
    const f = fixture(person());
    await f.account.initialize();
    localStorage.setItem('last-link-resume', 'match-for-account');
    sessionStorage.setItem('last-link-pending:private-match', 'private receipt');
    await f.account.logout();
    expect(f.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(f.backend.playerId()).toBe('');
    expect(localStorage.getItem('last-link-resume')).toBeNull();
    expect(sessionStorage.getItem('last-link-pending:private-match')).toBeNull();
    await f.account.login('diogo@example.invalid', password);
    expect(localStorage.getItem('last-link-resume')).toBe('match-for-account');
  });
  it('does not expose an irreversible logout button action for an anonymous identity', async () => {
    const f = fixture(person('guest-one', true));
    await expect(f.account.logout()).rejects.toThrow('Create an account first');
    expect(f.auth.signOut).not.toHaveBeenCalled();
  });
  it('consumes a PKCE callback before routing and does not expose its code in the URL', async () => {
    history.replaceState(null, '', '/theLastLink/?code=one-time-code');
    const f = fixture();
    await f.account.initialize();
    expect(f.auth.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code');
    expect(location.pathname + location.search + location.hash).toBe('/theLastLink/#/account');
    expect(f.account.redirectNotice()).toContain('Email confirmed');
    expect(f.account.isAccount()).toBe(true);
  });
  it('reports an invalid callback without stopping the application or exposing provider error details', async () => {
    history.replaceState(null, '', '/?code=expired-code');
    const f = fixture();
    f.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: person(), session: null },
      error: { code: 'flow_state_not_found' },
    });
    await f.account.initialize();
    expect(f.account.ready()).toBe(true);
    expect(f.account.redirectIssue()).toContain('expired or was already used');
    expect(f.account.redirectNotice()).toBe('');
    expect(location.search).toBe('');
  });
  it('does not let an old session restoration overwrite a newer Auth event', async () => {
    const f = fixture();
    let finish!: (value: Awaited<ReturnType<typeof f.auth.getSession>>) => void;
    f.auth.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const restoring = f.account.initialize();
    await vi.waitFor(() => expect(f.auth.getSession).toHaveBeenCalledTimes(1));
    f.emit(person('new-account'));
    finish({
      data: {
        session: {
          user: person('old-account'),
          access_token: 'old-test-token',
          refresh_token: 'old-test-refresh',
        },
      },
      error: null,
    });
    await restoring;
    expect(f.backend.playerId()).toBe('new-account');
  });
  it('unsubscribes from Auth when the application is destroyed', async () => {
    const f = fixture();
    await f.account.initialize();
    TestBed.resetTestingModule();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  });
  it('clears a live match and rejects its late response when a different account signs in', async () => {
    const f = fixture(person('guest-one', true));
    await f.account.initialize();
    const game = TestBed.inject(MatchService);
    const match = {
      id: 'private-match',
      revision: 1,
      room: { id: 'private-room', revision: 1 },
      state: { version: 1 },
    } as unknown as Match;
    game.match.set(match);
    let finish!: (value: unknown) => void;
    f.client.functions.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = game.send('snapshot', { matchId: 'private-match' });
    await vi.waitFor(() => expect(f.client.functions.invoke).toHaveBeenCalled());
    f.emit(person('different-account'));
    expect(game.match()).toBeNull();
    expect(game.room()).toBeNull();
    finish({
      data: { ok: true, duplicate: false, serverTime: new Date().toISOString(), match },
      error: null,
    });
    await pending;
    expect(game.match()).toBeNull();
    expect(game.error()).toContain('account changed');
  });
});
