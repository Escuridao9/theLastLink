import { UiLinks } from '../shared/ui-links.service';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmailConfirmationNoticeComponent } from '../shared/email-confirmation-notice.component';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, EmailConfirmationNoticeComponent],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  readonly links = inject(UiLinks);
}
