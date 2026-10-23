import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CATEGORY_OPTIONS } from '../../core/config/categories';

@Component({
  selector: 'app-room-setup',
  imports: [RouterLink],
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
}