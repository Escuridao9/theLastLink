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
import { RouterLink } from '@angular/router';
import { CATEGORY_OPTIONS } from '../../core/config/categories';
import { createPlayerNameControl } from '../../core/forms/player-name.control';
import type {
  CreatedRoom,
  CreateRoomRequest,
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorHandler = inject(ErrorHandler);

  private pendingCreation: CreateRoomRequest | null = null;

  readonly creatingRoom = signal(false);
  readonly creationError = signal<string | null>(null);
  readonly createdRoom = signal<CreatedRoom | null>(null);

  readonly categoryId = input.required<string>();

  readonly category = computed(() => {
    const categoryId = this.categoryId();

    return CATEGORY_OPTIONS.find(
      (option) =>
        option.id === categoryId && option.selectable,
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
      this.createdRoom.set(null);
      this.creationError.set(null);
    });
  }

  async createRoom(): Promise<void> {
    if (this.creatingRoom() || this.createdRoom()) {
      return;
    }

    this.normalizePlayerName(this.displayName);
    this.createRoomForm.markAllAsTouched();

    const categoryId = this.category()?.id;

    if (
      this.createRoomForm.invalid
      || (categoryId !== 'games' && categoryId !== 'movies')
    ) {
      return;
    }

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

  normalizePlayerName(
    control: FormControl<string>,
  ): void {
    control.setValue(control.value.trim());
  }

  normalizeRoomCode(): void {
    this.roomCode.setValue(
      this.roomCode.value.trim().toUpperCase(),
    );
  }
}