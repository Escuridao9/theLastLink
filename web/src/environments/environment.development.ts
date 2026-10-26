import { supabaseConfig } from './supabase.config';

export const environment = {
  production: false,
  supabase: supabaseConfig,
} as const;