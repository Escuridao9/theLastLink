import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { AppConfiguration } from './models';
import { PREVIEW_CONFIGURATION, validatePublicConfiguration } from '../../../../src/configuration';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  value!: AppConfiguration;
  readonly issue = signal('');
  async load(): Promise<void> {
    try {
      this.value = validatePublicConfiguration(
        await firstValueFrom(this.http.get<unknown>('config.json')),
      );
    } catch (error) {
      this.value = { ...PREVIEW_CONFIGURATION };
      this.issue.set(
        error instanceof Error ? error.message : 'Public configuration could not be loaded.',
      );
    }
  }
  get configured(): boolean {
    return !!(this.value?.supabaseUrl && this.value.supabasePublishableKey);
  }
}
