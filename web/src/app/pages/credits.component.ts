import { UiLinks } from '../shared/ui-links.service';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
@Component({
  selector: 'app-credits',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './credits.component.html',
})
export class CreditsComponent {
  readonly links = inject(UiLinks);
}
