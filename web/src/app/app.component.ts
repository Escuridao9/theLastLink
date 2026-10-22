import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class App {
  readonly title: string = 'The Last Link';
  readonly tagline: string = 'One life. Make it count.';

  skipToContent(event: Event): void {
    event.preventDefault();

    const main = document.getElementById('main-content');

    main?.focus();
    main?.scrollIntoView();
  }
}