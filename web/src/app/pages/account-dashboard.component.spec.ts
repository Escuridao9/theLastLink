import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountDashboardComponent } from './account-dashboard.component';
import { AccountRecordsService, type AccountOverview } from '../core/account-records.service';
import { AccountOperationsService } from '../core/account-operations.service';
import { AccountService } from '../core/account.service';
import { ReviewAccountService } from '../design-review/review-account.service';
import { UiLinks } from '../shared/ui-links.service';
const data: AccountOverview = {
  statistics: { played: 1, wins: 1, losses: 0, winRate: 100 },
  categories: [{ category: 'movies', played: 1, wins: 1, losses: 0, winRate: 100 }],
  history: [
    {
      id: 'saved-match',
      opponent: 'Alex',
      category: 'movies',
      finishedAt: '2026-10-29T12:00:00Z',
      outcome: 'win',
      moves: 12,
      endReason: 'timeout',
      detailsAvailable: false,
    },
  ],
};
function setup(stream = of(data)) {
  const account = new ReviewAccountService();
  account.showAccount();
  const overview = vi.fn(() => stream);
  const changePassword = vi.fn(
    async (_current: string, _password: string, _confirm: string, done?: () => void) => {
      done?.();
    },
  );
  const deleteAccount = vi.fn(async (_password: string, done?: () => void) => {
    done?.();
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AccountService, useValue: account },
      { provide: AccountRecordsService, useValue: { overview, refreshToken: signal(0) } },
      { provide: AccountOperationsService, useValue: { changePassword, deleteAccount } },
    ],
  });
  const fixture = TestBed.createComponent(AccountDashboardComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    page: fixture.nativeElement as HTMLElement,
    account,
    overview,
    changePassword,
    deleteAccount,
  };
}
afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

it.each([false, true])(
  'preserves invitation and category query parameters in the empty-history return link (preview=%s)',
  (preview) => {
    const f = setup(of({ ...data, history: [] }));
    vi.spyOn(TestBed.inject(UiLinks), 'reviewing', 'get').mockReturnValue(preview);
    f.fixture.componentRef.setInput('returnTo', '/rooms?code=ABCDEF123456&category=football');
    f.fixture.detectChanges();
    expect(f.page.querySelector('a.text-button')?.getAttribute('href')).toBe(
      `${preview ? '/design-review' : ''}/rooms?code=ABCDEF123456&category=football`,
    );
  },
);

it('shows personal statistics and saved summaries without broken links to expired details', () => {
  const f = setup();
  expect(f.page.textContent).toContain('vs Alex');
  expect(f.page.textContent).toContain('100');
  expect(f.page.textContent).toContain('Summary saved');
  expect(f.page.querySelector('a.result-link')).toBeNull();
  expect(f.page.querySelector('[aria-label="Your match statistics"]')).not.toBeNull();
});
it('distinguishes loading, request failure and genuinely empty history', () => {
  const loading = new Subject<AccountOverview>();
  const f = setup(loading);
  expect(f.page.querySelector('[role="status"]')?.textContent).toContain('Finding');
  expect(f.page.textContent).not.toContain('Your story starts');
  loading.error(Error('offline'));
  f.fixture.detectChanges();
  expect(f.page.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
  expect(f.page.textContent).not.toContain('Your story starts');
});
it('new passwords must match and all three inputs have password-manager labels', async () => {
  const f = setup();
  f.component.togglePassword();
  f.fixture.detectChanges();
  f.component.passwordForm.setValue({
    current: 'old password',
    password: 'new password',
    confirm: 'different',
  });
  await f.component.changePassword();
  f.fixture.detectChanges();
  expect(f.changePassword).not.toHaveBeenCalled();
  expect(f.page.textContent).toContain('do not match');
  expect(f.page.querySelector('#change-current')?.getAttribute('autocomplete')).toBe(
    'current-password',
  );
  expect(f.page.querySelector('#change-confirm')?.getAttribute('autocomplete')).toBe(
    'new-password',
  );
});
it('deletion requires the password and explicit acknowledgement before invoking the server', async () => {
  const f = setup();
  f.component.toggleDelete();
  f.fixture.detectChanges();
  f.component.deleteForm.controls.current.setValue('old password');
  await f.component.deleteAccount();
  expect(f.deleteAccount).not.toHaveBeenCalled();
  f.component.deleteForm.controls.understood.setValue(true);
  const done = vi.fn();
  f.component.sessionEnded.subscribe(done);
  await f.component.deleteAccount();
  expect(f.deleteAccount).toHaveBeenCalledOnce();
  expect(done).toHaveBeenCalledWith({
    message: 'Your account and personal history have been deleted.',
    email: '',
  });
});
it('cancelling sensitive settings and destroying the view clear all password inputs', () => {
  const f = setup();
  f.component.togglePassword();
  f.component.passwordForm.setValue({
    current: 'secret-old',
    password: 'secret-new',
    confirm: 'secret-new',
  });
  f.component.togglePassword();
  expect(f.component.passwordForm.controls.current.value).toBe('');
  f.component.toggleDelete();
  f.component.deleteForm.controls.current.setValue('secret-old');
  f.fixture.destroy();
  expect(f.component.deleteForm.controls.current.value).toBe('');
});
it('changing identity clears private history before the next request completes', () => {
  const f = setup();
  const loading = new Subject<AccountOverview>();
  f.overview.mockReturnValueOnce(loading);
  f.account.showLogin();
  f.fixture.detectChanges();
  expect(f.component.history()).toEqual([]);
  expect(f.component.overview()).toBeNull();
});

it('edits and saves the display name without changing saved history or statistics', async () => {
  const f = setup();
  const update = vi.spyOn(f.account, 'updateName');
  f.component.toggleName();
  f.fixture.detectChanges();
  expect(f.component.nameForm.controls.name.value).toBe('Diogo');
  expect(
    f.page.querySelector<HTMLButtonElement>('#name-settings button[type="submit"]')?.disabled,
  ).toBe(true);
  expect(f.page.querySelector('#profile-name')?.getAttribute('autocomplete')).toBe('nickname');
  f.component.nameForm.controls.name.setValue('Alex');
  await f.component.saveName();
  f.fixture.detectChanges();
  expect(update).toHaveBeenCalledExactlyOnceWith('Alex');
  expect(f.account.name()).toBe('Alex');
  expect(f.component.nameOpen()).toBe(false);
  expect(f.page.querySelector('.settings-notice')?.textContent).toContain('updated');
  expect(f.component.history()).toEqual(data.history);
  expect(f.component.stats()).toEqual(data.statistics);
});
it('validates changed names and lets the player cancel without saving', async () => {
  const f = setup();
  const update = vi.spyOn(f.account, 'updateName');
  f.component.toggleName();
  for (const name of [' ', 'x', 'x'.repeat(25)]) {
    f.component.nameForm.controls.name.setValue(name);
    await f.component.saveName();
  }
  expect(update).not.toHaveBeenCalled();
  f.component.nameForm.controls.name.setValue('Unsaved name');
  f.component.toggleName();
  expect(f.account.name()).toBe('Diogo');
  expect(f.component.nameForm.controls.name.value).toBe('');
  expect(f.component.nameOpen()).toBe(false);
});
it('keeps a failed name edit available for retry and prevents duplicate saves', async () => {
  const f = setup();
  let complete!: () => void;
  const update = vi.spyOn(f.account, 'updateName').mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  f.component.toggleName();
  f.component.nameForm.controls.name.setValue('Alex');
  const saving = f.component.saveName();
  await f.component.saveName();
  expect(update).toHaveBeenCalledTimes(1);
  complete();
  await saving;
  f.component.toggleName();
  f.component.nameForm.controls.name.setValue('Another name');
  update.mockRejectedValueOnce(Error('Connection unavailable. Try again.'));
  await f.component.saveName();
  f.fixture.detectChanges();
  expect(f.component.nameOpen()).toBe(true);
  expect(f.component.operation()).toBeNull();
  expect(f.page.querySelector('[role="alert"]')?.textContent).toContain('Connection unavailable');
  expect(f.component.nameForm.controls.name.value).toBe('Another name');
});
it('clears an unfinished name edit when the identity changes', () => {
  const f = setup();
  f.component.toggleName();
  f.component.nameForm.controls.name.setValue('Unsaved name');
  f.account.showLogin();
  f.fixture.detectChanges();
  expect(f.component.nameForm.controls.name.value).toBe('');
  expect(f.component.nameOpen()).toBe(false);
});
