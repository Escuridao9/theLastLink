import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_OPTIONS,
  type CategoryOption,
} from '../../core/config/categories';

@Component({
  selector: 'app-category-selection',
  imports: [RouterLink],
  templateUrl: './category-selection.component.html',
  styleUrl: './category-selection.component.css',
})
export class CategorySelection {
  readonly categories = CATEGORY_OPTIONS;
  readonly selectedCategory = signal<CategoryOption | null>(null);
}