import { Component, computed, input } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CATEGORY_OPTIONS } from '../../core/config/categories';
import { createPlayerNameControl } from '../../core/forms/player-name.control';

@Component({
  selector: 'app-room-setup',
  imports: [RouterLink, ReactiveFormsModule],
  templateUrl: './room-setup.component.html',
  styleUrl: './room-setup.component.css',
})
export class RoomSetup {
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

  normalizePlayerName(control: FormControl<string>): void {
    control.setValue(control.value.trim());
  }

  normalizeRoomCode(): void {
    this.roomCode.setValue(this.roomCode.value.trim().toUpperCase());
  }
}