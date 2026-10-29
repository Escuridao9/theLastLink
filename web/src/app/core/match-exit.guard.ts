import type { CanDeactivateFn } from '@angular/router';

export const confirmMatchExit: CanDeactivateFn<{
  canLeave: () => boolean | Promise<boolean>;
}> = (component) => component.canLeave();
