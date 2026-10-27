import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiLinks } from '../shared/ui-links.service';
@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './categories.component.html',
})
export class CategoriesComponent {
  readonly links = inject(UiLinks);
}
