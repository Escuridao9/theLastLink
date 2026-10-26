import type { User } from '@supabase/supabase-js';

export interface AuthState {
  readonly user: User | null;
  readonly initialized: boolean;
}