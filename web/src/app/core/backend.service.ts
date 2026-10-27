import { Injectable, inject, signal } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from './config.service';
import type { CommandResponse } from './models';

@Injectable({ providedIn: 'root' })
export class BackendService {
  readonly config = inject(ConfigService);
  readonly playerId = signal('');
  private instance?: SupabaseClient;
  private signingIn?: Promise<void>;
  get client(): SupabaseClient {
    if (!this.config.configured)
      throw Error(
        'Multiplayer needs a configured Supabase project. You can explore the published catalogue now.',
      );
    return (this.instance ??= createClient(
      this.config.value.supabaseUrl,
      this.config.value.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'last-link-auth',
        },
      },
    ));
  }
  async identity(): Promise<void> {
    if (this.playerId()) return;
    if (this.signingIn) return this.signingIn;
    this.signingIn = (async () => {
      const {
        data: { session },
        error,
      } = await this.client.auth.getSession();
      if (error) throw error;
      if (session) {
        this.playerId.set(session.user.id);
        return;
      }
      const response = await this.client.auth.signInAnonymously();
      if (response.error || !response.data.user)
        throw response.error ?? Error('Anonymous sign-in failed.');
      this.playerId.set(response.data.user.id);
    })();
    try {
      await this.signingIn;
    } finally {
      this.signingIn = undefined;
    }
  }
  async command(
    action: string,
    payload: Record<string, unknown>,
    requestId: string = crypto.randomUUID(),
  ): Promise<CommandResponse> {
    await this.identity();
    if (this.config.value.transport === 'rpc') {
      const { data, error } = await this.client.rpc('game_command', {
        p_action: action,
        p_payload: payload,
        p_request_id: requestId,
      });
      if (error) throw Error(error.message);
      return data as CommandResponse;
    }
    const { data, error } = await this.client.functions.invoke<CommandResponse>('match-api', {
      body: { action, payload, requestId },
    });
    if (error) {
      let message = error.message;
      if ('context' in error && error.context instanceof Response) {
        try {
          message = (await error.context.json()).error ?? message;
        } catch {
          /* Keep transport error. */
        }
      }
      throw Error(message);
    }
    if (!data) throw Error('The server returned an empty response.');
    return data;
  }
}
