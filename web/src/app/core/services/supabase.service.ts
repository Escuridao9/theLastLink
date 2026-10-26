import { Injectable } from '@angular/core';
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  readonly client: SupabaseClient = createClient(
    environment.supabase.url,
    environment.supabase.publishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    },
  );
}