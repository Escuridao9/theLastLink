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

  async signOut(): Promise<void> {
    const { error } = await this.supabase.client.auth.signOut({
      scope: 'local',
    });

    if (error) {
      throw error;
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }
}