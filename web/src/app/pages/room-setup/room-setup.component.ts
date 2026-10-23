import { Component, computed, input } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CATEGORY_OPTIONS } from '../../core/config/categories';

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

  readonly displayName = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.minLength(2),
      Validators.maxLength(24),
    ],
  });

  readonly createRoomForm = new FormGroup({
    displayName: this.displayName,
  });

  normalizeDisplayName(): void {
    this.displayName.setValue(this.displayName.value.trim());
  }
}