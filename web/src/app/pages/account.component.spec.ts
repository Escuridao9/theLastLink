import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountComponent } from './account.component';
import { AccountService } from '../core/account.service';
import { ConfigService } from '../core/config.service';
import { ReviewAccountService } from '../design-review/review-account.service';

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
    expect(f.harness.routeNativeElement?.textContent).toContain('One last check');
  });
  it('does not collect a password until a guest email has been confirmed', async () => {
    const f = await fixture('/account?mode=signup');
    f.account.showGuest();
    TestBed.tick();
    f.harness.detectChanges();
    expect(f.harness.routeNativeElement?.querySelector('#signup-password')).toBeNull();
    f.component.signupForm.patchValue({ name: 'Diogo', email: 'diogo@example.invalid' });
    await f.component.register();
    expect(f.register).toHaveBeenCalledWith('Diogo', 'diogo@example.invalid', undefined);
    f.component.codeForm.controls.code.setValue('123456');
    await f.component.verify();
    f.harness.detectChanges();
    expect(f.harness.routeNativeElement?.querySelector('#finish-password')).not.toBeNull();
    f.component.finishForm.setValue({ password: 'A test password', confirm: 'A test password' });
    await f.component.finishPassword();
    expect(f.account.needsPassword()).toBe(false);
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
