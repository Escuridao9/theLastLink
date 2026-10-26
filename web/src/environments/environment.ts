import { supabaseConfig } from './supabase.config';

export const environment = {
  production: true,
  supabase: supabaseConfig,
} as const;