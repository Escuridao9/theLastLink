import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountService } from '../core/account.service';
import { ConfigService } from '../core/config.service';
import { ReviewAccountService } from '../design-review/review-account.service';
import { EmailConfirmationNoticeComponent } from './email-confirmation-notice.component';
import { UiLinks } from './ui-links.service';

async function setup(configured = true) {
  const account = new ReviewAccountService();
  await account.register('Diogo', 'diogo@example.invalid', 'Example password');
  const resend = vi.spyOn(account, 'resend');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AccountService, useValue: account },
      { provide: ConfigService, useValue: { configured, issue: signal('') } },
    ],
  });
  const fixture = TestBed.createComponent(EmailConfirmationNoticeComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    page: fixture.nativeElement as HTMLElement,
    account,
    resend,
  };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

it('shows a link-only confirmation notice and a normal login path', async () => {
  const f = await setup();
  expect(f.page.textContent).toContain('Check your inbox');
  expect(f.page.textContent).toContain('diogo@example.invalid');
  expect(f.page.textContent).toContain('You can leave this page');
  expect(f.page.querySelector('input')).toBeNull();
  expect(f.page.textContent).not.toContain('six-digit');
  expect(f.page.querySelector('a')?.getAttribute('href')).toBe('/account?mode=login');
});
it('resends a confirmation and announces success or a retryable failure', async () => {
  const f = await setup();
  await f.component.resend();
  f.fixture.detectChanges();
  expect(f.resend).toHaveBeenCalledTimes(1);
  expect(f.page.textContent).toContain('Confirmation requested');
  f.resend.mockRejectedValueOnce(Error('Too many attempts. Wait a little before trying again.'));
  await f.component.resend();
  f.fixture.detectChanges();
  expect(f.page.querySelector('[role="alert"]')?.textContent).toContain('Too many attempts');
  expect(f.page.textContent).not.toContain('Confirmation requested');
});
it('dismisses the pending notice and hides it after confirmation', async () => {
  const f = await setup();
  f.component.dismiss();
  f.fixture.detectChanges();
  expect(f.page.querySelector('section')).toBeNull();
  await f.account.register('Diogo', 'diogo@example.invalid', 'Example password');
  f.account.confirmEmail();
  f.fixture.detectChanges();
  expect(f.page.querySelector('section')).toBeNull();
});
it('blocks resend while busy or unconfigured and does not dismiss an in-flight notice', async () => {
  const f = await setup(false);
  await f.component.resend();
  expect(f.resend).not.toHaveBeenCalled();
  f.account.busy.set(true);
  f.component.dismiss();
  expect(f.account.verification()).not.toBeNull();
});
it('keeps preview login links inside the isolated preview', async () => {
  const f = await setup();
  vi.spyOn(TestBed.inject(UiLinks), 'reviewing', 'get').mockReturnValue(true);
  f.account.verification.set({ ...f.account.verification()! });
  f.fixture.detectChanges();
  expect(f.page.querySelector('a')?.getAttribute('href')).toBe('/design-review/account?mode=login');
});
it('prevents repeated resend clicks before the Auth busy state has updated', async () => {
  const f = await setup();
  let complete!: () => void;
  f.resend.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = f.component.resend();
  await f.component.resend();
  f.component.dismiss();
  f.fixture.detectChanges();
  expect(f.resend).toHaveBeenCalledTimes(1);
  expect(f.account.verification()).not.toBeNull();
  expect(f.page.textContent).toContain('Sending…');
  complete();
  await pending;
  f.fixture.detectChanges();
  expect(f.page.textContent).toContain('Resend email');
});
it('ignores a late resend error after its notice has been destroyed', async () => {
  const f = await setup();
  let reject!: (reason: Error) => void;
  f.resend.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const pending = f.component.resend();
  f.fixture.destroy();
  reject(Error('Late error'));
  await pending;
  expect(f.component.error()).toBe('');
});
