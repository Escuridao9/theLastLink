import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  ValidatorFn,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AccountService } from '../core/account.service';
import { ConfigService } from '../core/config.service';
import { accountReturnPath } from '../core/auth-navigation';
import { UiLinks } from '../shared/ui-links.service';
import { AccountDashboardComponent } from './account-dashboard.component';

const passwordRules = [Validators.required, Validators.minLength(8), Validators.maxLength(128)];
const emailControl = () =>
  new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email, Validators.maxLength(254)],
  });
const passwordsMatch: ValidatorFn = (form) =>
  form.get('password')?.value === form.get('confirm')?.value ? null : { passwordsMatch: true };

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, AccountDashboardComponent],
  templateUrl: './account.component.html',
  styleUrl: './account.component.css',
})
export class AccountComponent implements OnInit, OnDestroy {
  readonly account = inject(AccountService);
  readonly config = inject(ConfigService);
  readonly links = inject(UiLinks);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly mode = signal<'login' | 'signup'>('login');
  readonly returnTo = signal('/play');
  readonly error = signal('');
  readonly message = signal('');
  readonly showPassword = signal(false);
  readonly loginForm = new FormGroup({
    email: emailControl(),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(128)],
    }),
  });
  readonly signupForm = new FormGroup(
    {
      name: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(24),
          Validators.pattern(/\S.*\S/),
        ],
      }),
      email: emailControl(),
      password: new FormControl('', { nonNullable: true, validators: passwordRules }),
      confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: passwordsMatch },
  );
  readonly codeForm = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{6}$/)],
    }),
  });
  private querySubscription?: Subscription;
  private destroyed = false;
  ngOnInit(): void {
    this.signupForm.controls.name.setValue(localStorage.getItem('last-link-name') ?? '');
    this.querySubscription = this.route.queryParamMap.subscribe((params) => {
      this.mode.set(params.get('mode') === 'signup' ? 'signup' : 'login');
      this.returnTo.set(
        accountReturnPath(
          params.get('returnTo') ?? sessionStorage.getItem('last-link-account-return'),
        ),
      );
      this.error.set('');
      this.message.set('');
      this.showPassword.set(false);
      this.clearPasswords();
    });
    void this.account.initialize();
  }
  async login(): Promise<void> {
    this.loginForm.markAllAsTouched();
    if (this.loginForm.invalid || this.account.busy() || !this.config.configured) return;
    await this.perform(async () => {
      const value = this.loginForm.getRawValue();
      await this.account.login(value.email, value.password);
      this.clearPasswords();
      if (!this.destroyed) await this.continue();
    });
  }
  async register(): Promise<void> {
    this.signupForm.markAllAsTouched();
    if (this.signupForm.invalid || this.account.busy() || !this.config.configured) return;
    sessionStorage.setItem('last-link-account-return', this.returnTo());
    await this.perform(async () => {
      const value = this.signupForm.getRawValue();
      await this.account.register(value.name, value.email, value.password);
      this.clearPasswords();
    });
  }
  async verify(): Promise<void> {
    this.codeForm.markAllAsTouched();
    if (this.codeForm.invalid || this.account.busy()) return;
    await this.perform(async () => {
      await this.account.verifyEmail(this.codeForm.controls.code.value);
      this.codeForm.reset();
      this.message.set('Email confirmed. You’re in.');
    });
  }
  async resend(): Promise<void> {
    if (this.account.busy()) return;
    await this.perform(async () => {
      await this.account.resend();
      this.message.set('Confirmation requested. Check your inbox and spam folder.');
    });
  }
  async logout(): Promise<void> {
    if (this.account.busy()) return;
    await this.perform(async () => {
      await this.account.logout();
      this.mode.set('login');
      this.clearPasswords();
      this.message.set('You’re logged out.');
    });
  }
  settingsComplete(event: { message: string; email: string }): void {
    this.mode.set('login');
    this.message.set(event.message);
    this.error.set('');
    this.clearPasswords();
    this.loginForm.controls.email.setValue(event.email);
  }
  async continue(): Promise<void> {
    if (this.destroyed) return;
    sessionStorage.removeItem('last-link-account-return');
    await this.router.navigateByUrl(this.links.to(this.returnTo()));
  }
  differentEmail(): void {
    if (this.account.busy()) return;
    this.account.clearVerification();
    this.message.set('');
    this.error.set('');
    this.mode.set('signup');
  }
  private async perform(action: () => Promise<void>): Promise<void> {
    this.error.set('');
    this.message.set('');
    try {
      await action();
    } catch (error) {
      if (!this.destroyed)
        this.error.set(error instanceof Error ? error.message : 'Please try again.');
    }
  }
  private clearPasswords(): void {
    this.loginForm.controls.password.reset();
    this.signupForm.controls.password.reset();
    this.signupForm.controls.confirm.reset();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.querySubscription?.unsubscribe();
    this.clearPasswords();
    this.codeForm.reset();
  }
}
