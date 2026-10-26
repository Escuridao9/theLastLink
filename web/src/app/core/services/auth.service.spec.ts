import { TestBed } from '@angular/core/testing';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;

const testUser: User = {
  id: 'test-user',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-26T00:00:00.000Z',
};

const testSession: Session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  user: testUser,
};

describe('AuthService', () => {
  let service: AuthService;
  let listener: AuthListener | undefined;

  const unsubscribe = vi.fn();
  const signOut = vi.fn(async () => ({ error: null as Error | null }));

  function emitAuthChange(
    event: AuthChangeEvent,
    session: Session | null,
  ): void {
    if (!listener) {
      throw new Error('The authentication listener was not registered.');
    }

    listener(event, session);
  }

  beforeEach(() => {
    listener = undefined;
    unsubscribe.mockClear();
    signOut.mockReset();
    signOut.mockResolvedValue({ error: null });

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        {
          provide: SupabaseService,
          useValue: {
            client: {
              auth: {
                onAuthStateChange(callback: AuthListener) {
                  listener = callback;
                  return { data: { subscription: { unsubscribe } } };
                },
                signOut,
              },
            },
          },
        },
      ],
    });

    service = TestBed.inject(AuthService);
  });

  it('starts with authentication unresolved', () => {
    expect(service.isReady()).toBe(false);
    expect(service.user()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('restores the user from the initial session event', () => {
    emitAuthChange('INITIAL_SESSION', testSession);

    expect(service.isReady()).toBe(true);
    expect(service.user()).toEqual(testUser);
    expect(service.isAuthenticated()).toBe(true);
  });

  it('finishes initialization when no session exists', () => {
    emitAuthChange('INITIAL_SESSION', null);

    expect(service.isReady()).toBe(true);
    expect(service.user()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('updates the user when Supabase emits sign-in and sign-out events', () => {
    emitAuthChange('SIGNED_IN', testSession);
    expect(service.user()).toEqual(testUser);
    expect(service.isAuthenticated()).toBe(true);

    emitAuthChange('SIGNED_OUT', null);
    expect(service.user()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.isReady()).toBe(true);
  });

  it('requests sign-out for the current session', async () => {
    emitAuthChange('INITIAL_SESSION', testSession);

    await service.signOut();

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('preserves the current user and reports a failed sign-out', async () => {
    emitAuthChange('INITIAL_SESSION', testSession);
    const error = new Error('Sign-out failed.');
    signOut.mockResolvedValueOnce({ error });

    await expect(service.signOut()).rejects.toBe(error);
    expect(service.user()).toEqual(testUser);
    expect(service.isAuthenticated()).toBe(true);
  });

  it('unsubscribes when Angular destroys the service', () => {
    TestBed.resetTestingModule();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});