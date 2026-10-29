import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

/** Only navigation changes in the review environment. Production URLs stay identical. */
@Injectable({ providedIn: 'root' })
export class UiLinks {
  readonly previewAccount = signal(false);
  private readonly router = inject(Router);
  get reviewing(): boolean {
    const path = (this.router.url ?? '').split(/[?#]/)[0];
    return path === '/design-review' || path.startsWith('/design-review/');
  }
  to(path: string): string {
    return (this.reviewing ? '/design-review' : '') + (path === '/' ? '' : path) || '/';
  }
}
