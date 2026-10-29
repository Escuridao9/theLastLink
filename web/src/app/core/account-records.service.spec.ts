import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountRecordsService } from './account-records.service';
import { AccountOperationsService } from './account-operations.service';
import { AccountService } from './account.service';
import { BackendService } from './backend.service';

const identity = {
  id: 'own-id',
  is_anonymous: false,
  email: 'player@example.invalid',
  email_confirmed_at: '2026-10-29',
};
function setup() {
  const user = signal<typeof identity | null>({ ...identity });
  const auth = {
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'user-jwt', user: { ...identity } } },
      error: null,
    })),
  };
  const invoke = vi.fn(async (_name: string, _options: unknown) => ({
    data: { ok: true },
    error: null as null | { context: Response },
  }));
  const clear = vi.fn(async (_id: string) => {
    user.set(null);
  });
  const clearVerification = vi.fn();
  const backend = {
    user,
    initialize: vi.fn(async () => {}),
    config: {
      value: {
        supabaseUrl: 'https://example.supabase.co',
        supabasePublishableKey: 'sb_publishable_example',
      },
    },
    client: { auth, functions: { invoke } },
    clearLocalAccount: clear,
    withAuth: async <T>(action: () => Promise<T>) => action(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: BackendService, useValue: backend },
      { provide: AccountService, useValue: { isAccount: () => !!user(), clearVerification } },
    ],
  });
  return {
    user,
    auth,
    invoke,
    clear,
    clearVerification,
    records: TestBed.inject(AccountRecordsService),
    operations: TestBed.inject(AccountOperationsService),
    http: TestBed.inject(HttpTestingController),
  };
}
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  TestBed.resetTestingModule();
});

it('loads typed private history using the current JWT and only the public project key', async () => {
  const f = setup();
  const value = firstValueFrom(
    f.records.overview('movies', { at: '2026-10-28T12:00:00Z', id: 'cursor' }),
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const request = f.http.expectOne('https://example.supabase.co/rest/v1/rpc/account_overview');
  expect(request.request.headers.get('Authorization')).toBe('Bearer user-jwt');
  expect(request.request.headers.get('apikey')).toBe('sb_publishable_example');
  expect(request.request.body).toEqual({
    p_category: 'movies',
    p_before_at: '2026-10-28T12:00:00Z',
    p_before_id: 'cursor',
    p_limit: 20,
  });
  expect(request.request.body.player_id).toBeUndefined();
  request.flush({
    statistics: { played: 0, wins: 0, losses: 0, winRate: 0 },
    categories: [],
    history: [],
  });
  expect((await value).history).toEqual([]);
});
it('a session change while preparing a request cannot load another identity history', async () => {
  const f = setup();
  f.auth.getSession.mockImplementationOnce(async () => {
    f.user.set({ ...identity, id: 'another-id' });
    return { data: { session: { access_token: 'user-jwt', user: { ...identity } } }, error: null };
  });
  await expect(firstValueFrom(f.records.overview())).rejects.toThrow('session changed');
  f.http.expectNone('https://example.supabase.co/rest/v1/rpc/account_overview');
});
it('password confirmation is checked before sending any account mutation', async () => {
  const f = setup();
  await expect(
    f.operations.changePassword('old password', 'new password', 'different'),
  ).rejects.toThrow('do not match');
  expect(f.invoke).not.toHaveBeenCalled();
  expect(f.clear).not.toHaveBeenCalled();
});
it('successful password changes notify the page before clearing only the original local session', async () => {
  const f = setup();
  const notified = vi.fn(() => expect(f.clear).not.toHaveBeenCalled());
  await f.operations.changePassword('old password', 'new password', 'new password', notified);
  expect(f.invoke).toHaveBeenCalledWith('account-api', {
    body: {
      action: 'change_password',
      currentPassword: 'old password',
      password: 'new password',
      confirm: 'new password',
    },
  });
  expect(notified).toHaveBeenCalledOnce();
  expect(f.clear).toHaveBeenCalledWith('own-id');
});
it('incorrect current passwords keep the account signed in and show an actionable error', async () => {
  const f = setup();
  f.invoke.mockResolvedValueOnce({
    data: { ok: false },
    error: {
      context: new Response(JSON.stringify({ error: 'current_password_incorrect' }), {
        status: 403,
      }),
    },
  });
  await expect(f.operations.deleteAccount('wrong password')).rejects.toThrow(
    'current password is incorrect',
  );
  expect(f.clear).not.toHaveBeenCalled();
  expect(f.user()?.id).toBe('own-id');
});
it('an identity change during an account operation never clears the newly signed-in account', async () => {
  const f = setup();
  f.invoke.mockImplementationOnce(async () => {
    f.user.set({ ...identity, id: 'another-id' });
    return { data: { ok: true }, error: null };
  });
  await expect(f.operations.deleteAccount('old password')).rejects.toThrow('account changed');
  expect(f.clear).not.toHaveBeenCalled();
  expect(f.user()?.id).toBe('another-id');
});
