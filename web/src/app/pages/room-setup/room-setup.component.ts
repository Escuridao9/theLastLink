import {
  Component,
  computed,
  DestroyRef,
  effect,
  ErrorHandler,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CATEGORY_OPTIONS } from '../../core/config/categories';
import { createPlayerNameControl } from '../../core/forms/player-name.control';
import type {
  CreatedRoom,
  CreateRoomRequest,
  JoinRoomRequest,
} from '../../core/models/room';
import { RoomService } from '../../core/services/room.service';

@Component({
  selector: 'app-room-setup',
  imports: [RouterLink, ReactiveFormsModule],
  templateUrl: './room-setup.component.html',
  styleUrl: './room-setup.component.css',
})
export class RoomSetup {
  private readonly rooms = inject(RoomService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorHandler = inject(ErrorHandler);

  private pendingCreation: CreateRoomRequest | null = null;
  private pendingJoin: JoinRoomRequest | null = null;

  readonly creatingRoom = signal(false);
  readonly creationError = signal<string | null>(null);
  readonly createdRoom = signal<CreatedRoom | null>(null);

  readonly joiningRoom = signal(false);
  readonly joinError = signal<string | null>(null);
  readonly busy = computed(
    () => this.creatingRoom() || this.joiningRoom(),
  );

  readonly categoryId = input.required<string>();

  readonly category = computed(() => {
    const categoryId = this.categoryId();

    return CATEGORY_OPTIONS.find(
      (option) => option.id === categoryId && option.selectable,
    );
  });

  readonly displayName = createPlayerNameControl();

  readonly createRoomForm = new FormGroup({
    displayName: this.displayName,
  });

  readonly joinDisplayName = createPlayerNameControl();

  readonly roomCode = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.pattern(/^[A-Z0-9]{6}$/i),
    ],
  });

  readonly joinRoomForm = new FormGroup({
    displayName: this.joinDisplayName,
    roomCode: this.roomCode,
  });

  constructor() {
    effect(() => {
      this.categoryId();

      this.pendingCreation = null;
      this.pendingJoin = null;
      this.createdRoom.set(null);
      this.creationError.set(null);
      this.joinError.set(null);
    });
  }

  async createRoom(): Promise<void> {
    if (this.busy() || this.createdRoom()) return;

    this.normalizePlayerName(this.displayName);
    this.createRoomForm.markAllAsTouched();

    const categoryId = this.category()?.id;

    if (
      this.createRoomForm.invalid
      || (categoryId !== 'games' && categoryId !== 'movies')
    ) return;

    const displayName = this.displayName.value;

    if (
      !this.pendingCreation
      || this.pendingCreation.categoryId !== categoryId
      || this.pendingCreation.displayName !== displayName
    ) {
      this.pendingCreation = {
        roomId: crypto.randomUUID(),
        categoryId,
        displayName,
      };
    }

    const request = this.pendingCreation;

    this.creatingRoom.set(true);
    this.creationError.set(null);

    try {
      const room = await this.rooms.createRoom(request);

      if (
        !this.destroyRef.destroyed
        && this.pendingCreation === request
      ) {
        this.createdRoom.set(room);
        await this.router.navigate(['/rooms', room.id]);
      }
    } catch (error) {
      if (
        !this.destroyRef.destroyed
        && this.pendingCreation === request
      ) {
        this.creationError.set(
          error instanceof Error
            ? error.message
            : 'Please try creating your room again.',
        );

        this.errorHandler.handleError(error);
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.creatingRoom.set(false);
      }
    }
  }

  async joinRoom(): Promise<void> {
    if (this.busy()) return;

    this.normalizePlayerName(this.joinDisplayName);
    this.normalizeRoomCode();
    this.joinRoomForm.markAllAsTouched();

    const categoryId = this.category()?.id;

    if (
      this.joinRoomForm.invalid
      || (categoryId !== 'games' && categoryId !== 'movies')
    ) return;

    const request: JoinRoomRequest = {
      categoryId,
      roomCode: this.roomCode.value,
      displayName: this.joinDisplayName.value,
    };

    this.pendingJoin = request;
    this.joiningRoom.set(true);
    this.joinError.set(null);

    try {
      const room = await this.rooms.joinRoom(request);

      if (
        !this.destroyRef.destroyed
        && this.pendingJoin === request
      ) {
        await this.router.navigate(['/rooms', room.id]);
      }
    } catch (error) {
      if (
        !this.destroyRef.destroyed
        && this.pendingJoin === request
      ) {
        this.joinError.set(
          error instanceof Error
            ? error.message
            : 'Please try joining again.',
        );

        this.errorHandler.handleError(error);
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.joiningRoom.set(false);
      }
    }
  }

  normalizePlayerName(control: FormControl<string>): void {
    control.setValue(control.value.trim());
  }

  normalizeRoomCode(): void {
    this.roomCode.setValue(
      this.roomCode.value.trim().toUpperCase(),
    );
  }
}