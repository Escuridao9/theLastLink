import { UiLinks } from '../shared/ui-links.service';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  readonly links = inject(UiLinks);
}
