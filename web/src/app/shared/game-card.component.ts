import { Component, Input, Output, EventEmitter } from '@angular/core';
import type { Game } from '../core/models';
@Component({
  selector: 'app-game-card',
  standalone: true,
  templateUrl: './game-card.component.html',
})
export class GameCardComponent {
  @Input() selected = false;
  @Input({ required: true }) game!: Game;
  @Output() inspect = new EventEmitter<Game>();
  get credits(): number {
    return Object.values(this.game.credits).reduce((n, records) => n + (records?.length ?? 0), 0);
  }
}
