import { UiLinks } from './shared/ui-links.service';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Router, NavigationEnd, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { Subscription } from 'rxjs';
import { ConfigService } from './core/config.service';
import { AccountLinkComponent } from './shared/account-link.component';
import { TurnAudioService } from './core/turn-audio.service';
import { ResumeService } from './core/resume.service';
import { FocusModeService } from './core/focus-mode.service';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AccountLinkComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class App implements OnDestroy {
  readonly title = 'The Last Link';
  readonly tagline = 'One life. Make it count.';
  readonly links = inject(UiLinks);
  readonly config = inject(ConfigService);
  readonly resume = inject(ResumeService);
  private readonly router = inject(Router);
  private readonly navigation: Subscription;
  readonly showSessionReturn = signal(false);
  // Listen for a user gesture before the first match needs to play a turn cue.
  private readonly turnAudio = inject(TurnAudioService);
  private readonly focusMode = inject(FocusModeService);
  constructor() {
    this.updateSessionReturn(this.router.url);
    this.navigation = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.updateSessionReturn(event.urlAfterRedirects);
    });
  }
  skipToContent(event: Event): void {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
    document.getElementById('main-content')?.scrollIntoView();
  }
  private updateSessionReturn(url: string): void {
    const path = url.split(/[?#]/)[0];
    this.showSessionReturn.set(path === '/' || path === '/play');
    this.resume.setVisible(this.showSessionReturn());
  }
  ngOnDestroy(): void {
    this.navigation.unsubscribe();
    this.resume.setVisible(false);
  }
}
