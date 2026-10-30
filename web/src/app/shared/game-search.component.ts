import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { searchEntries } from '../../../../src/entry-search';
import type { Game, Category } from '../core/models';
@Component({
  selector: 'app-game-search',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './game-search.component.html',
  styleUrl: './game-search.component.css',
})
export class GameSearchComponent implements OnInit, OnDestroy {
  @Input() category: Category = 'games';
  @Input() games: Game[] = [];
  @Input() played: readonly string[] = [];
  @Input() disabled = false;
  @Output() selected = new EventEmitter<Game | null>();
  readonly query = new FormControl('', { nonNullable: true });
  readonly text = signal('');
  readonly open = signal(false);
  active = 0;
  private subscription?: Subscription;
  get suggestions(): Game[] {
    const query = this.text().trim().toLocaleLowerCase();
    if (query.length < 2) return [];
    return searchEntries(this.games, query, this.played, 7);
  }
  ngOnInit(): void {
    this.subscription = this.query.valueChanges.subscribe((text) => {
      this.text.set(text);
      this.open.set(true);
      this.active = 0;
      this.selected.emit(null);
    });
  }
  choose(game: Game): void {
    if (this.disabled) return;
    this.query.setValue(`${game.title}${game.releaseYear ? ' (' + game.releaseYear + ')' : ''}`, {
      emitEvent: false,
    });
    this.text.set(game.title);
    this.open.set(false);
    this.selected.emit(game);
  }
  key(event: KeyboardEvent): void {
    if (this.disabled) return;
    const options = this.suggestions;
    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      this.open.set(true);
      this.active = (this.active + 1) % options.length;
    }
    if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      this.active = (this.active + options.length - 1) % options.length;
    }
    if (event.key === 'Enter' && this.open() && options[this.active]) {
      event.preventDefault();
      this.choose(options[this.active]);
    }
    if (event.key === 'Escape') {
      event.preventDefault(); // A native search input would otherwise clear the typed answer.
      this.open.set(false);
    }
    if (event.key === 'Tab') this.open.set(false);
  }
  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
