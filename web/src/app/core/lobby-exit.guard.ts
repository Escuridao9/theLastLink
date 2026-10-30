import { CanDeactivateFn } from '@angular/router';

export const leaveWaitingLobby: CanDeactivateFn<{ canLeave: () => Promise<boolean> }> =
  (component) => component.canLeave();
