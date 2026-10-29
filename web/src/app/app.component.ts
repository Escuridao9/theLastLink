import { UiLinks } from './shared/ui-links.service';
import { Component, afterEveryRender, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ConfigService } from './core/config.service';
import { AccountLinkComponent } from './shared/account-link.component';
import { TurnAudioService } from './core/turn-audio.service';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AccountLinkComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class App {
  readonly title = 'The Last Link';
  readonly tagline = 'One life. Make it count.';
  readonly links = inject(UiLinks);
  readonly config = inject(ConfigService);
  readonly resume = signal(this.readResume());
  // Listen for a user gesture before the first match needs to play a turn cue.
  private readonly turnAudio = inject(TurnAudioService);
  constructor() {
    // Routed match views update storage; refresh navigation after rendering.
    afterEveryRender(() => this.resume.set(this.readResume()));
  }
  skipToContent(event: Event): void {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
    document.getElementById('main-content')?.scrollIntoView();
  }
  private readResume(): string | null {
    const id = localStorage.getItem('last-link-resume');
    return id?.startsWith('design-review-') ? null : id;
  }
}
