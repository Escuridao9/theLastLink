import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { AuthState } from '../models/auth-state';
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService implements OnDestroy {
  private readonly supabase = inject(SupabaseService);

  private readonly authState = signal<AuthState>({
    user: null,
    initialized: false,
  });

  private readonly unsubscribe: () => void;
  private pendingSession: Promise<void> | null = null;

  readonly user = computed(() => this.authState().user);
  readonly isReady = computed(() => this.authState().initialized);
  readonly isAuthenticated = computed(() => this.user() !== null);

  constructor() {
    const { data } = this.supabase.client.auth.onAuthStateChange(
      (_event, session) => {
        this.authState.set({
          user: session?.user ?? null,
          initialized: true,
        });
      },
    );

    this.unsubscribe = () => data.subscription.unsubscribe();
  }

  ensureSession(): Promise<void> {
    if (this.pendingSession) {
      return this.pendingSession;
    }

    this.pendingSession = this.restoreOrCreateSession().finally(() => {
      this.pendingSession = null;
    });

    return this.pendingSession;
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.client.auth.signOut({
      scope: 'local',
    });

    if (error) {
      throw error;
    }
  }

  private async restoreOrCreateSession(): Promise<void> {
    const { data, error } = await this.supabase.client.auth.getSession();

    if (error) {
      throw error;
    }

    if (data.session) {
      return;
    }

    const result = await this.supabase.client.auth.signInAnonymously();

    if (result.error) {
      throw result.error;
    }

    if (!result.data.session) {
      throw new Error('A player session could not be established.');
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }
}