import { REQUEST_ID } from '../shared/request-id';
import { UiLinks } from '../shared/ui-links.service';
import { Component, OnInit, OnDestroy, inject, signal, effect } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { readCategory, CATEGORY_LABELS, type Category, type OpeningMode } from '../core/models';
import { firstValueFrom, Subscription } from 'rxjs';
import { AccountService } from '../core/account.service';
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
  private readonly account = inject(AccountService);
  readonly categories = CATEGORY_LABELS;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly copied = signal(false);
  readonly opening = signal(false);
  readonly category = signal<Category>('movies');
  readonly invited = signal(false);
  readonly checkingIdentity = signal(false);
  private routeSubscription?: Subscription;
  private inviteVersion = 0;
  private operation = 0;
  private destroyed = false;
  private leaving?: Promise<boolean>;
  private left = false;
  private departure?: { roomId: string; id: string };
  get bothConnected(): boolean {
    const room = this.game.room();
    return !!room?.guestId && (!room.lobbyPresence ||
      (room.lobbyPresence[room.hostId]?.connected === true && room.lobbyPresence[room.guestId]?.connected === true));
  }
  connected(id: string): boolean {
    const room = this.game.room();
    return !room?.lobbyPresence || room.lobbyPresence[id]?.connected === true;
  }
  chooseCategory(category: Category): void {
    this.category.set(category);
    if (category === 'games') this.form.controls.openingMode.setValue('standard');
  }
  readonly form = new FormGroup({
    openingMode: new FormControl<OpeningMode>('standard', { nonNullable: true }),
    name: new FormControl(this.account.isAccount() ? this.account.name() : localStorage.getItem('last-link-name') ?? '', {
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
    this.game.room.set(null);
    this.game.match.set(null);
    this.game.error.set('');
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.opening.set(true);
      void this.game.watch('room', id).catch((e) => this.error.set(e.message));
      return;
    }
    this.routeSubscription = this.route.queryParamMap.subscribe((params) => {
      const version = ++this.inviteVersion;
      this.operation++;
      this.game.stop();
      this.game.room.set(null);
      this.game.match.set(null);
      this.category.set(readCategory(params.get('category')));
      this.invited.set(params.has('code'));
      this.form.controls.code.setValue((params.get('code') ?? '').trim().toUpperCase());
      this.form.controls.code.markAsUntouched();
      this.error.set('');
      this.busy.set(false);
      this.checkingIdentity.set(false);
      if (this.invited()) void this.prepareInvite(version);
    });
  }
  private async prepareInvite(version: number): Promise<void> {
    if (!this.form.controls.code.value || this.form.controls.code.invalid) {
      this.error.set('This invitation is incomplete or invalid. Ask your friend for a new link.');
      return;
    }
    if (!this.config.configured) return;
    this.checkingIdentity.set(true);
    try {
      await this.account.initialize();
      if (this.destroyed || version !== this.inviteVersion) return;
      if (this.account.isAccount()) {
        this.form.controls.name.setValue(this.account.name());
        this.checkingIdentity.set(false);
        if (this.form.controls.name.valid) await this.act('join');
      }
    } catch {
      if (!this.destroyed && version === this.inviteVersion)
        this.error.set('Your session could not be restored. Try joining again.');
    } finally {
      if (!this.destroyed && version === this.inviteVersion) this.checkingIdentity.set(false);
    }
  }
  async act(action: 'create' | 'join'): Promise<void> {
    if (this.invited()) action = 'join';
    this.form.markAllAsTouched();
    if (
      this.form.controls.name.invalid ||
      (action === 'join' && (!this.form.controls.code.value || this.form.controls.code.invalid)) ||
      this.busy() || this.checkingIdentity() || !this.config.configured
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
    const operation = ++this.operation;
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
      if (this.destroyed || operation !== this.operation) return;
      if (!response.ok || !response.room) throw Error(response.reason ?? 'room_not_found');
      this.pending = undefined;
      localStorage.setItem('last-link-name', payload.name);
      if (response.room) await this.router.navigate([this.links.to('/rooms'), response.room.id]);
    } catch (e) {
      if (this.destroyed || operation !== this.operation) return;
      const reason = (e as Error).message;
      if (reason === 'lobby_seat_expired' || reason === 'room_closed') this.pending = undefined;
      const messages: Record<string, string> = {
        room_not_found: 'This invitation is invalid or has expired. Ask your friend for a new link.',
        room_full: 'Both seats are taken. Ask your friend to invite you to another room.',
        room_not_joinable: 'This room is no longer accepting players. Ask your friend for a new invitation.',
        room_not_waiting: 'This room has already started. Ask your friend for a new invitation.',
        room_closed: 'The host left, so this waiting room has closed. Ask your friend for a new invitation.',
        lobby_seat_expired: 'Your disconnected seat expired. Join again if a seat is available.',
      };
      this.error.set(messages[reason] ?? reason);
    } finally {
      if (!this.destroyed && operation === this.operation) this.busy.set(false);
    }
  }
  async start(): Promise<void> {
    const room = this.game.room();
    if (!room || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await this.game.send('start', { roomId: room.id });
      if (!response.ok) throw Error(response.reason === 'players_reconnecting'
        ? 'Both players need to be connected before the match can start.'
        : response.reason === 'room_closed' ? 'The waiting room has closed.' : 'The match could not start. Wait for your rival and try again.');
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
  async leave(): Promise<void> {
    if (await this.canLeave()) await this.router.navigateByUrl(this.links.to('/rooms'));
  }
  canLeave(): Promise<boolean> {
    const room = this.game.room();
    if (this.left || !this.route.snapshot.paramMap.get('id') || !room || room.matchId || !['waiting','ready'].includes(room.status))
      return Promise.resolve(true);
    if (this.leaving) return this.leaving;
    this.leaving = (async () => {
      this.busy.set(true);
      this.error.set('');
      try {
        if (this.departure?.roomId !== room.id) this.departure = { roomId: room.id, id: this.requestId() };
        const response = await this.game.send('leave', { roomId: room.id }, this.departure.id);
        if (!response.ok && response.reason !== 'room_closed' && response.reason !== 'lobby_seat_expired')
          throw Error(response.reason === 'room_started' ? 'The match has started. Opening your match…' : 'Could not leave the lobby. Try again.');
        this.left = true;
        if (localStorage.getItem('last-link-resume') === room.id) localStorage.removeItem('last-link-resume');
        return true;
      } catch (error) {
        this.error.set((error as Error).message);
        return false;
      } finally {
        this.busy.set(false);
        this.leaving = undefined;
      }
    })();
    return this.leaving;
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.inviteVersion++;
    this.operation++;
    this.routeSubscription?.unsubscribe();
    this.game.stop();
  }
}
