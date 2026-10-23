import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type CategoryId = 'games' | 'movies' | 'music';

interface CategoryOption {
  readonly id: CategoryId;
  readonly name: string;
  readonly mark: string;
  readonly description: string;
  readonly connectors: string;
  readonly selectable: boolean;
}

@Component({
  selector: 'app-category-selection',
  imports: [RouterLink],
  templateUrl: './category-selection.component.html',
  styleUrl: './category-selection.component.css',
})
export class CategorySelection {
  readonly categories: ReadonlyArray<CategoryOption> = [
    {
      id: 'games',
      name: 'Games',
      mark: 'GG.',
      description: 'Know who made it. Know where to go next.',
      connectors: 'Developers · Composers · Voice actors · Characters',
      selectable: true,
    },
    {
      id: 'movies',
      name: 'Movies',
      mark: 'CUT!',
      description: 'Your questionable film knowledge has a purpose.',
      connectors: 'Actors · Directors · Writers · Composers · Cinematographers',
      selectable: true,
    },
    {
      id: 'music',
      name: 'Music',
      mark: '33⅓',
      description: 'Find the people behind the track.',
      connectors: 'Performers · Songwriters · Producers',
      selectable: false,
    },
  ];

  readonly selectedCategory = signal<CategoryOption | null>(null);
}