import { REQUEST_ID } from '../shared/request-id';
import { UiLinks } from '../shared/ui-links.service';
import { Component, OnInit, OnDestroy, inject, signal, effect } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { readCategory, type Category, type OpeningMode } from '../core/models';
import { firstValueFrom } from 'rxjs';
import { CatalogueService } from '../core/catalogue.service';
import { ConfigService } from '../core/config.service';
import { buildInviteUrl } from '../../../../src/routing';
import { MatchService } from '../core/match.service';
@Component({
  selector: 'app-rooms',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './rooms.component.html',
})
export class RoomsComponent implements OnInit, OnDestroy {
  readonly links = inject(UiLinks);
  private readonly requestId = inject(REQUEST_ID);
  readonly config = inject(ConfigService);
  private readonly catalogue = inject(CatalogueService);
  readonly game = inject(MatchService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly copied = signal(false);
  readonly opening = signal(false);
  readonly category = signal<Category>('movies');
  chooseCategory(category: Category): void {
    this.category.set(category);
    if (category === 'games') this.form.controls.openingMode.setValue('standard');
  }
  readonly form = new FormGroup({
    openingMode: new FormControl<OpeningMode>('standard', { nonNullable: true }),
    name: new FormControl(localStorage.getItem('last-link-name') ?? '', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(24),
        Validators.pattern(/\S.*\S/),
      ],
    }),
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^[A-Za-z0-9]{12}$/)],
    }),
  });
  private pending?: { action: string; payload: Record<string, unknown>; id: string };
  constructor() {
    effect(() => {
      const room = this.game.room();
      if (room?.matchId) void this.router.navigate([this.links.to('/match'), room.matchId]);
    });
  }
  get invite(): string {
    return buildInviteUrl(
      document.baseURI,
      this.links.to('/rooms'),
      this.game.room()?.code ?? '',
      this.game.room()?.category ?? this.category(),
    );
  }
  ngOnInit(): void {
    this.category.set(readCategory(this.route.snapshot.queryParamMap.get('category')));
    const code = this.route.snapshot.queryParamMap.get('code');
    if (code) this.form.controls.code.setValue(code);
    this.game.room.set(null);
    this.game.match.set(null);
    this.game.error.set('');
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.opening.set(true);
      void this.game.watch('room', id).catch((e) => this.error.set(e.message));
    }
  }
  async act(action: 'create' | 'join'): Promise<void> {
    this.form.markAllAsTouched();
    if (
      this.form.controls.name.invalid ||
      (action === 'join' && (!this.form.controls.code.value || this.form.controls.code.invalid)) ||
      this.busy()
    )
      return;
    const payload = {
      name: this.form.controls.name.value.trim(),
      ...(action === 'create' ? { category: this.category() } : {}),
      ...(action === 'create' && this.category() !== 'games' && this.form.controls.openingMode.value === 'familiar'
        ? { openingMode: 'familiar' as const } : {}),
      ...(action === 'join' ? { code: this.form.controls.code.value.trim().toUpperCase() } : {}),
    };
    if (
      this.pending?.action !== action ||
      JSON.stringify(this.pending.payload) !== JSON.stringify(payload)
    )
      this.pending = { action, payload, id: this.requestId() };
    this.busy.set(true);
    this.error.set('');
    try {
      if (action === 'create' && this.category() !== 'games') {
        const data = await firstValueFrom(this.catalogue.loadCategory(this.category()));
        if (payload.openingMode === 'familiar') {
          const pools = await firstValueFrom(this.catalogue.openingOptions(data.datasetId));
          if (!pools.some(pool => pool.mode === 'familiar' && Number(pool.entries) > 0))
            throw Error('Familiar starters are not published for this catalogue yet. Choose Standard or ask the host to apply the catalogue update.');
        }
      }
      const response = await this.game.send(action, payload, this.pending.id);
      this.pending = undefined;
      localStorage.setItem('last-link-name', payload.name);
      if (response.room) await this.router.navigate([this.links.to('/rooms'), response.room.id]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
  async start(): Promise<void> {
    const room = this.game.room();
    if (!room || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await this.game.send('start', { roomId: room.id });
      if (response.match) await this.router.navigate([this.links.to('/match'), response.match.id]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.invite);
      this.copied.set(true);
    } catch {
      this.error.set('Copy the invite link shown below.');
    }
  }
  ngOnDestroy(): void {
    this.game.stop();
  }
}
