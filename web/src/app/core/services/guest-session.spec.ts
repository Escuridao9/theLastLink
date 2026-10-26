import { TestBed } from '@angular/core/testing';
import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

interface SessionResult {
  data: { session: Session | null };
  error: Error | null;
}

const session: Session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  user: {
    id: 'test-user',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-26T00:00:00.000Z',
  },
};

describe('Guest sessions', () => {
  let service: AuthService;

  const getSession = vi.fn<() => Promise<SessionResult>>();
  const signInAnonymously = vi.fn<() => Promise<SessionResult>>();

  beforeEach(() => {
    getSession.mockReset();
    getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    signInAnonymously.mockReset();
    signInAnonymously.mockResolvedValue({
      data: { session },
      error: null,
    });

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        {
          provide: SupabaseService,
          useValue: {
            client: {
              auth: {
                getSession,
                signInAnonymously,
                onAuthStateChange: () => ({
                  data: {
                    subscription: {
                      unsubscribe: vi.fn(),
                    },
                  },
                }),
              },
            },
          },
        },
      ],
    });

    service = TestBed.inject(AuthService);
  });

  it('reuses an existing session', async () => {
    getSession.mockResolvedValueOnce({
      data: { session },
      error: null,
    });

    await service.ensureSession();

    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('creates a guest session when no session exists', async () => {
    await service.ensureSession();

    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('shares an in-progress connection between callers', async () => {
    let finish = () => {};

    getSession.mockImplementationOnce(
      () =>
        new Promise<SessionResult>((resolve) => {
          finish = () =>
            resolve({
              data: { session: null },
              error: null,
            });
        }),
    );

    const first = service.ensureSession();
    const second = service.ensureSession();

    expect(first).toBe(second);

    finish();
    await Promise.all([first, second]);

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('reports session restoration errors without creating another user', async () => {
    const error = new Error('Session restoration failed.');

    getSession.mockResolvedValueOnce({
      data: { session: null },
      error,
    });

    await expect(service.ensureSession()).rejects.toBe(error);

    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('allows another attempt after guest sign-in fails', async () => {
    const error = new Error('Guest sign-in failed.');

    signInAnonymously.mockResolvedValueOnce({
      data: { session: null },
      error,
    });

    await expect(service.ensureSession()).rejects.toBe(error);
    await service.ensureSession();

    expect(signInAnonymously).toHaveBeenCalledTimes(2);
  });
});