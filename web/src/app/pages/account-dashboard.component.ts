import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
  ElementRef,
  ViewChild,
  Injector,
  afterNextRender,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink, type UrlTree } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AccountService } from '../core/account.service';
import {
  AccountRecordsService,
  type AccountOverview,
  type MatchSummary,
} from '../core/account-records.service';
import { AccountOperationsService } from '../core/account-operations.service';
import { UiLinks } from '../shared/ui-links.service';
import type { Category } from '../core/models';

@Component({
  selector: 'app-account-dashboard',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink, ReactiveFormsModule],
  templateUrl: './account-dashboard.component.html',
  styleUrl: './account-dashboard.component.css',
})
export class AccountDashboardComponent implements OnDestroy {
  @Input() returnTo = '/play';
  @Output() sessionEnded = new EventEmitter<{ message: string; email: string }>();
  readonly account = inject(AccountService);
  readonly links = inject(UiLinks);
  private readonly router = inject(Router);
  private readonly records = inject(AccountRecordsService);
  private readonly operations = inject(AccountOperationsService);
  private readonly injector = inject(Injector);
  @ViewChild('nameInput') set nameInput(field: ElementRef<HTMLInputElement> | undefined) {
    field?.nativeElement.focus();
  }
  @ViewChild('nameButton') private nameButton?: ElementRef<HTMLButtonElement>;
  get returnUrl(): UrlTree {
    return this.router.parseUrl(this.links.to(this.returnTo));
  }
  readonly categories: { value: Category | null; label: string }[] = [
    { value: null, label: 'All arenas' },
    { value: 'movies', label: 'Movies' },
    { value: 'games', label: 'Games' },
    { value: 'football', label: 'Football clubs' },
  ];
  readonly category = signal<Category | null>(null);
  readonly overview = signal<AccountOverview | null>(null);
  readonly history = signal<MatchSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly hasMore = signal(false);
  readonly passwordOpen = signal(false);
  readonly deleteOpen = signal(false);
  readonly nameOpen = signal(false);
  readonly nameError = signal('');
  readonly nameMessage = signal('');
  readonly nameForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(24),
        Validators.pattern(/\S.*\S/),
      ],
    }),
  });
  readonly operation = signal<'name' | 'password' | 'delete' | null>(null);
  readonly settingsError = signal('');
  readonly stats = computed(() => {
    const data = this.overview();
    return (
      (this.category()
        ? data?.categories.find((row) => row.category === this.category())
        : data?.statistics) ?? { played: 0, wins: 0, losses: 0, winRate: 0 }
    );
  });
  readonly passwordForm = new FormGroup(
    {
      current: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(128)],
      }),
      password: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
      }),
      confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    {
      validators: (group) =>
        group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: true },
    },
  );
  readonly deleteForm = new FormGroup({
    current: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(128)],
    }),
    understood: new FormControl(false, {
      nonNullable: true,
      validators: [Validators.requiredTrue],
    }),
  });
  private subscription?: Subscription;
  private userId = '';
  private generation = 0;
  private destroyed = false;
  private readonly reaction = effect(() => {
    const user = this.account.user();
    this.category();
    this.records.refreshToken();
    untracked(() => {
      if (user?.id !== this.userId) {
        this.userId = user?.id ?? '';
        this.history.set([]);
        this.overview.set(null);
        this.resetSettings();
      }
      if (user && !user.is_anonymous && user.email_confirmed_at) this.load();
    });
  });
  refresh(): void {
    this.records.refreshToken.update((value) => value + 1);
  }
  load(more = false): void {
    this.subscription?.unsubscribe();
    const generation = ++this.generation;
    const id = this.userId;
    const last = more ? this.history().at(-1) : undefined;
    if (!more) this.history.set([]);
    this.loading.set(true);
    this.error.set('');
    this.subscription = this.records
      .overview(this.category(), last ? { at: last.finishedAt, id: last.id } : undefined)
      .subscribe({
        next: (data) => {
          if (this.generation !== generation || this.account.user()?.id !== id) return;
          this.overview.set(data);
          const rows = data.history.slice(0, 20);
          this.history.update((previous) => (more ? [...previous, ...rows] : rows));
          this.hasMore.set(data.history.length > 20);
          this.loading.set(false);
        },
        error: () => {
          if (this.generation !== generation || this.account.user()?.id !== id) return;
          this.loading.set(false);
          this.error.set('Your results could not be loaded. Check your connection and try again.');
        },
      });
  }
  label(category: Category): string {
    return this.categories.find((row) => row.value === category)?.label ?? category;
  }
  get nameUnchanged(): boolean {
    return this.nameForm.controls.name.value.trim() === this.account.name();
  }
  toggleName(): void {
    if (this.operation() || this.account.busy()) return;
    this.nameOpen.update((value) => !value);
    this.nameForm.reset({ name: this.nameOpen() ? this.account.name() : '' });
    this.nameError.set('');
    this.nameMessage.set('');
    this.passwordOpen.set(false);
    this.deleteOpen.set(false);
    this.settingsError.set('');
    this.passwordForm.reset();
    this.deleteForm.reset();
    if (!this.nameOpen()) this.focusNameButton();
  }
  async saveName(): Promise<void> {
    this.nameForm.markAllAsTouched();
    if (this.nameForm.invalid || this.nameUnchanged || this.operation() || this.account.busy())
      return;
    const id = this.userId;
    const name = this.nameForm.controls.name.value;
    this.operation.set('name');
    this.nameError.set('');
    this.nameMessage.set('');
    try {
      await this.account.updateName(name);
      if (this.destroyed || this.userId !== id) return;
      this.nameOpen.set(false);
      this.nameForm.reset();
      this.nameMessage.set('Your display name has been updated.');
      this.focusNameButton();
    } catch (error) {
      if (!this.destroyed && this.userId === id)
        this.nameError.set(
          error instanceof Error ? error.message : 'Your name could not be saved. Try again.',
        );
    } finally {
      if (!this.destroyed && this.userId === id) this.operation.set(null);
    }
  }
  private focusNameButton(): void {
    afterNextRender(
      () => {
        if (!this.destroyed) this.nameButton?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
  togglePassword(): void {
    this.nameOpen.set(false);
    this.nameForm.reset();
    this.nameError.set('');
    this.nameMessage.set('');
    this.passwordOpen.update((value) => !value);
    this.deleteOpen.set(false);
    this.settingsError.set('');
    this.passwordForm.reset();
    this.deleteForm.reset();
  }
  toggleDelete(): void {
    this.nameOpen.set(false);
    this.nameForm.reset();
    this.nameError.set('');
    this.nameMessage.set('');
    this.deleteOpen.update((value) => !value);
    this.passwordOpen.set(false);
    this.settingsError.set('');
    this.passwordForm.reset();
    this.deleteForm.reset();
  }
  async changePassword(): Promise<void> {
    this.passwordForm.markAllAsTouched();
    if (this.passwordForm.invalid || this.operation() || this.account.busy()) return;
    const value = this.passwordForm.getRawValue();
    const id = this.userId,
      email = this.account.user()?.email ?? '';
    this.operation.set('password');
    this.settingsError.set('');
    try {
      await this.operations.changePassword(value.current, value.password, value.confirm, () =>
        this.sessionEnded.emit({
          message: 'Password changed. Log in with your new password.',
          email,
        }),
      );
      this.passwordForm.reset();
    } catch (error) {
      if (this.userId === id) this.settingsError.set((error as Error).message);
      this.passwordForm.controls.current.reset();
    } finally {
      if (this.userId === id) this.operation.set(null);
    }
  }
  async deleteAccount(): Promise<void> {
    this.deleteForm.markAllAsTouched();
    if (this.deleteForm.invalid || this.operation() || this.account.busy()) return;
    const id = this.userId;
    this.operation.set('delete');
    this.settingsError.set('');
    try {
      await this.operations.deleteAccount(this.deleteForm.controls.current.value, () =>
        this.sessionEnded.emit({
          message: 'Your account and personal history have been deleted.',
          email: '',
        }),
      );
      this.deleteForm.reset();
    } catch (error) {
      if (this.userId === id) this.settingsError.set((error as Error).message);
      this.deleteForm.controls.current.reset();
    } finally {
      if (this.userId === id) this.operation.set(null);
    }
  }
  private resetSettings(): void {
    this.nameForm.reset();
    this.nameOpen.set(false);
    this.nameError.set('');
    this.nameMessage.set('');
    this.passwordForm.reset();
    this.deleteForm.reset();
    this.operation.set(null);
    this.passwordOpen.set(false);
    this.deleteOpen.set(false);
    this.settingsError.set('');
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.generation++;
    this.reaction.destroy();
    this.subscription?.unsubscribe();
    this.resetSettings();
  }
}
