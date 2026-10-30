import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountComponent } from './account.component';
import { AccountService } from '../core/account.service';
import { ConfigService } from '../core/config.service';
import { ReviewAccountService } from '../design-review/review-account.service';
import { HomeComponent } from './home.component';

@Component({ template: '<p>Next screen</p>' })
class DestinationComponent {}
async function fixture(url = '/account', configured = true) {
  const account = new ReviewAccountService();
  const login = vi.spyOn(account, 'login');
  const register = vi.spyOn(account, 'register');
  const logout = vi.spyOn(account, 'logout');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', pathMatch: 'full', component: HomeComponent },
        { path: 'account', component: AccountComponent },
        { path: 'play', component: DestinationComponent },
        { path: 'rooms', component: DestinationComponent },
      ]),
      { provide: AccountService, useValue: account },
      { provide: ConfigService, useValue: { configured, issue: signal('') } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const component = await harness.navigateByUrl(url, AccountComponent);
  return { account, login, register, logout, harness, component, router: TestBed.inject(Router) };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('Account page forms and routing', () => {
  it('offers password recovery from login, validates email and shows neutral confirmation', async () => {
    const f = await fixture();
    const link = f.harness.routeNativeElement!.querySelector('.account-recovery-link') as HTMLAnchorElement;
    expect(link.textContent).toContain('Forgot password?'); link.click(); await f.harness.fixture.whenStable();
    const page = f.harness.routeDebugElement!.componentInstance as AccountComponent;
    const reset = vi.spyOn(f.account,'requestPasswordReset');
    await page.requestReset(); expect(reset).not.toHaveBeenCalled();
    page.recoveryForm.controls.email.setValue('diogo@example.invalid'); await page.requestReset(); f.harness.detectChanges();
    expect(reset).toHaveBeenCalledWith('diogo@example.invalid');
    expect(f.harness.routeNativeElement!.textContent).toContain('If an account exists');
    expect(f.harness.routeNativeElement!.querySelector('input[type="password"]')).toBeNull();
  });
  it('requires a verified recovery state and matching new passwords without asking for the old one', async () => {
    const f = await fixture('/account?mode=reset');
    expect(f.harness.routeNativeElement!.querySelector('#reset-password')).toBeNull();
    f.account.showRecovery(); f.harness.detectChanges();
    const reset = vi.spyOn(f.account,'resetPassword');
    expect(f.harness.routeNativeElement!.querySelector('input[autocomplete="current-password"]')).toBeNull();
    f.component.resetForm.setValue({password:'A new password 123!',confirm:'different'});
    await f.component.resetPassword(); expect(reset).not.toHaveBeenCalled();
    f.component.resetForm.controls.confirm.setValue('A new password 123!'); await f.component.resetPassword();
    f.harness.detectChanges(); expect(reset).toHaveBeenCalledExactlyOnceWith('A new password 123!');
    expect(f.component.resetForm.controls.password.value).toBe('');
    expect(f.harness.routeNativeElement!.textContent).toContain('Your password has been updated');
    expect(f.router.url).toBe('/account');
  });
  it('prevents duplicate recovery requests and shows a retryable email error', async () => {
    const f = await fixture('/account?mode=forgot');
    f.component.recoveryForm.controls.email.setValue('diogo@example.invalid');
    let fail!:(error:Error)=>void;
    const reset=vi.spyOn(f.account,'requestPasswordReset').mockImplementationOnce(()=>new Promise((_done,reject)=>{fail=reject;}));
    const first=f.component.requestReset(); await f.component.requestReset(); expect(reset).toHaveBeenCalledOnce();
    fail(Error('Try again later.')); await first; f.harness.detectChanges();
    expect(f.component.recoveryBusy()).toBe(false);
    expect(f.harness.routeNativeElement!.querySelector('[role="alert"]')?.textContent).toContain('Try again later');
  });
  it('shows associated input labels and browser password-manager autocomplete attributes', async () => {
    const f = await fixture();
    const page = f.harness.routeNativeElement!;
    expect(page.querySelector('label[for="login-email"]')?.textContent).toContain('EMAIL');
    expect(page.querySelector('#login-email')?.getAttribute('autocomplete')).toBe('email');
    expect(page.querySelector('#login-password')?.getAttribute('autocomplete')).toBe(
      'current-password',
    );
    expect(page.textContent).not.toContain('123456');
  });
  it('marks invalid login fields without sending an Auth request', async () => {
    const f = await fixture();
    await f.component.login();
    f.harness.detectChanges();
    expect(f.login).not.toHaveBeenCalled();
    expect(f.component.loginForm.controls.email.touched).toBe(true);
    expect(
      f.harness.routeNativeElement?.querySelector('#login-email')?.getAttribute('aria-invalid'),
    ).toBe('true');
  });
  it('returns to the original internal room invitation after login', async () => {
    const destination = '/rooms?code=ABCDEF123456&category=games';
    const f = await fixture('/account?returnTo=' + encodeURIComponent(destination));
    f.component.loginForm.setValue({ email: 'diogo@example.invalid', password: 'A test password' });
    await f.component.login();
    expect(f.login).toHaveBeenCalledWith('diogo@example.invalid', 'A test password');
    expect(f.router.url).toBe(destination);
  });
  it('never follows an external return destination', async () => {
    const f = await fixture('/account?returnTo=' + encodeURIComponent('//evil.invalid'));
    f.component.loginForm.setValue({ email: 'diogo@example.invalid', password: 'A test password' });
    await f.component.login();
    expect(f.router.url).toBe('/play');
  });
  it('announces a failed login and leaves the form available for a retry', async () => {
    const f = await fixture();
    f.login.mockRejectedValueOnce(Error('Email or password is incorrect.'));
    f.component.loginForm.setValue({ email: 'diogo@example.invalid', password: 'A test password' });
    await f.component.login();
    f.harness.detectChanges();
    expect(f.harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain(
      'Email or password is incorrect',
    );
    expect(f.router.url).toBe('/account');
  });
  it('requires a valid email, player name, strong password and matching confirmation for signup', async () => {
    const f = await fixture('/account?mode=signup');
    f.component.signupForm.setValue({
      name: 'Diogo',
      email: 'diogo@example.invalid',
      password: 'long password',
      confirm: 'different password',
    });
    await f.component.register();
    expect(f.register).not.toHaveBeenCalled();
    expect(f.component.signupForm.hasError('passwordsMatch')).toBe(true);
    f.component.signupForm.controls.confirm.setValue('long password');
    await f.component.register();
    expect(f.register).toHaveBeenCalledWith('Diogo', 'diogo@example.invalid', 'long password');
    f.harness.detectChanges();
    expect(f.router.url).toBe('/');
    expect(f.harness.routeNativeElement?.textContent).toContain('Check your inbox');
    expect(f.harness.routeNativeElement?.textContent).toContain('diogo@example.invalid');
    expect(f.harness.routeNativeElement?.querySelector('#email-code')).toBeNull();
  });
  it('requires both passwords before a guest registration and opens the account directly after verification', async () => {
    const f = await fixture('/account?mode=signup');
    f.account.showGuest();
    TestBed.tick();
    f.harness.detectChanges();
    expect(f.harness.routeNativeElement?.querySelector('#signup-password')).not.toBeNull();
    expect(f.harness.routeNativeElement?.querySelector('#signup-confirm')).not.toBeNull();
    f.component.signupForm.patchValue({ name: 'Diogo', email: 'diogo@example.invalid' });
    await f.component.register();
    expect(f.register).not.toHaveBeenCalled();
    f.component.signupForm.patchValue({
      password: 'A test password',
      confirm: 'Different password',
    });
    await f.component.register();
    expect(f.register).not.toHaveBeenCalled();
    f.component.signupForm.controls.confirm.setValue('A test password');
    await f.component.register();
    expect(f.register).toHaveBeenCalledWith('Diogo', 'diogo@example.invalid', 'A test password');
    expect(f.component.signupForm.controls.password.value).toBe('');
    expect(f.component.signupForm.controls.confirm.value).toBe('');
    expect(f.router.url).toBe('/');
    f.account.confirmEmail();
    await f.harness.navigateByUrl('/account');
    f.harness.detectChanges();
    expect(f.harness.routeNativeElement?.querySelector('#finish-password')).toBeNull();
    expect(f.account.isAccount()).toBe(true);
    expect(f.harness.routeNativeElement?.textContent).toContain('LOGGED IN');
    expect(f.account.user()?.id).toBe('design-review-account');
  });
  it('blocks duplicate submissions while a request is running', async () => {
    const f = await fixture();
    f.account.busy.set(true);
    f.harness.detectChanges();
    f.component.loginForm.setValue({ email: 'diogo@example.invalid', password: 'A test password' });
    await f.component.login();
    expect(f.login).not.toHaveBeenCalled();
    expect(
      f.harness.routeNativeElement
        ?.querySelector('button[type="submit"]')
        ?.hasAttribute('disabled'),
    ).toBe(true);
  });
  it('keeps login available while an email is pending and removes the manual code form', async () => {
    const f = await fixture();
    await f.account.register('Diogo', 'pending@example.invalid', 'A test password');
    f.harness.detectChanges();
    expect(f.harness.routeNativeElement?.querySelector('#login-email')).not.toBeNull();
    expect(f.harness.routeNativeElement?.querySelector('#email-code')).toBeNull();
    expect(f.harness.routeNativeElement?.textContent).not.toContain('six-digit');
  });
  it('does not redirect a visitor who leaves while the signup request is pending', async () => {
    const f = await fixture('/account?mode=signup');
    let complete!: () => void;
    f.register.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    f.component.signupForm.setValue({
      name: 'Diogo',
      email: 'diogo@example.invalid',
      password: 'long password',
      confirm: 'long password',
    });
    const pending = f.component.register();
    await f.router.navigateByUrl('/play');
    complete();
    await pending;
    expect(f.router.url).toBe('/play');
    expect(f.component.signupForm.controls.password.value).toBe('');
  });
  it('shows the other-browser fallback as a notice with a usable login form', async () => {
    const f = await fixture();
    f.account.showBrowserFallback();
    f.harness.detectChanges();
    expect(f.harness.routeNativeElement?.querySelector('[role="alert"]')).toBeNull();
    expect(f.harness.routeNativeElement?.querySelector('.account-message')?.textContent).toContain(
      'Automatic sign-in',
    );
    expect(f.harness.routeNativeElement?.querySelector('#login-email')).not.toBeNull();
    expect(f.harness.routeNativeElement?.querySelector('#email-code')).toBeNull();
  });
  it('keeps signup and login disabled when Supabase is not configured', async () => {
    const f = await fixture('/account', false);
    f.component.loginForm.setValue({ email: 'diogo@example.invalid', password: 'A test password' });
    await f.component.login();
    expect(f.login).not.toHaveBeenCalled();
    expect(f.harness.routeNativeElement?.textContent).toContain('Accounts are unavailable');
  });
  it('clears passwords when leaving the account screen', async () => {
    const f = await fixture();
    f.component.loginForm.controls.password.setValue('private password');
    await f.router.navigateByUrl('/play');
    expect(f.component.loginForm.controls.password.value).toBe('');
  });
  it('shows account details and signs out through the account service', async () => {
    const f = await fixture();
    f.account.showAccount();
    f.harness.detectChanges();
    expect(f.harness.routeNativeElement?.textContent).toContain('diogo@example.invalid');
    await f.component.logout();
    expect(f.logout).toHaveBeenCalledTimes(1);
    expect(f.account.user()).toBeNull();
  });
});
