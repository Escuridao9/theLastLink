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
import { EmailConfirmationNoticeComponent } from '../shared/email-confirmation-notice.component';

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
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AccountDashboardComponent,
    EmailConfirmationNoticeComponent,
  ],
  templateUrl: './account.component.html',
  styleUrl: './account.component.css',
})
export class AccountComponent implements OnInit, OnDestroy {
  readonly account = inject(AccountService);
  readonly config = inject(ConfigService);
  readonly links = inject(UiLinks);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly mode = signal<'login' | 'signup' | 'forgot' | 'reset'>('login');
  readonly recoveryBusy = signal(false);
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
  readonly recoveryForm = new FormGroup({ email: emailControl() });
  readonly resetForm = new FormGroup({
    password: new FormControl('', { nonNullable: true, validators: passwordRules }),
    confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  }, { validators: passwordsMatch });
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
  private querySubscription?: Subscription;
  private destroyed = false;
  ngOnInit(): void {
    this.signupForm.controls.name.setValue(localStorage.getItem('last-link-name') ?? '');
    this.querySubscription = this.route.queryParamMap.subscribe((params) => {
      const mode = params.get('mode');
      this.mode.set(mode === 'signup' || mode === 'forgot' || mode === 'reset' ? mode : 'login');
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
  async requestReset(): Promise<void> {
    this.recoveryForm.markAllAsTouched();
    if (this.recoveryForm.invalid || this.account.busy() || this.recoveryBusy() || !this.config.configured) return;
    this.recoveryBusy.set(true);
    await this.perform(async () => {
      await this.account.requestPasswordReset(this.recoveryForm.controls.email.value);
      if (!this.destroyed) this.message.set('If an account exists for this email, you’ll receive a password recovery link. Open the new link in this browser.');
    });
    this.recoveryBusy.set(false);
  }
  async resetPassword(): Promise<void> {
    this.resetForm.markAllAsTouched();
    if (this.resetForm.invalid || !this.account.recovering() || this.account.busy() || this.recoveryBusy() || !this.config.configured) return;
    this.recoveryBusy.set(true);
    await this.perform(async () => {
      await this.account.resetPassword(this.resetForm.controls.password.value);
      this.clearPasswords();
      if (!this.destroyed) {
        await this.router.navigateByUrl(this.links.to('/account'));
        this.message.set('Your password has been updated. You’re signed in and ready to play.');
      }
    });
    this.recoveryBusy.set(false);
  }
  async register(): Promise<void> {
    this.signupForm.markAllAsTouched();
    if (this.signupForm.invalid || this.account.busy() || !this.config.configured) return;
    sessionStorage.setItem('last-link-account-return', this.returnTo());
    await this.perform(async () => {
      const value = this.signupForm.getRawValue();
      await this.account.register(value.name, value.email, value.password);
      this.clearPasswords();
      if (this.destroyed) return;
      if (this.account.verification()) await this.router.navigateByUrl(this.links.to('/'));
      else await this.continue();
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
    this.resetForm.reset();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.querySubscription?.unsubscribe();
    this.clearPasswords();
  }
}
