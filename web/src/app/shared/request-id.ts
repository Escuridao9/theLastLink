import { InjectionToken } from '@angular/core';

/** Production keeps cryptographic UUIDs. HTTP-only visual previews supply local IDs. */
export const REQUEST_ID = new InjectionToken<() => string>('command request ID', {
  providedIn: 'root',
  factory: () => () => crypto.randomUUID(),
});
