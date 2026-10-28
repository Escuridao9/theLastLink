import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'design-review',
    title: 'Interactive design preview — The Last Link',
    loadChildren: () => import('./design-review/review.routes').then((m) => m.REVIEW_ROUTES),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'The Last Link — One life. Make it count.',
    loadComponent: () => import('./pages/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'play',
    title: 'Choose your arena — The Last Link',
    loadComponent: () => import('./pages/categories.component').then((m) => m.CategoriesComponent),
  },
  {
    path: 'play/:categoryId',
    redirectTo: ({ params }) =>
      inject(Router).createUrlTree(['/rooms'], {
        queryParams: { category: params['categoryId'] === 'games' ? 'games' : 'movies' },
      }),
  },
  {
    path: 'catalogue',
    title: 'Movies & Games catalogue — The Last Link',
    loadComponent: () => import('./pages/catalogue.component').then((m) => m.CatalogueComponent),
  },
  {
    path: 'rooms',
    title: 'Private rooms — The Last Link',
    loadComponent: () => import('./pages/rooms.component').then((m) => m.RoomsComponent),
  },
  {
    path: 'rooms/:id',
    title: 'Your room — The Last Link',
    loadComponent: () => import('./pages/rooms.component').then((m) => m.RoomsComponent),
  },
  {
    path: 'match/:id',
    title: 'Sudden Death — The Last Link',
    loadComponent: () => import('./pages/match.component').then((m) => m.MatchComponent),
  },
  {
    path: 'results/:id',
    title: 'Match result — The Last Link',
    loadComponent: () => import('./pages/results.component').then((m) => m.ResultsComponent),
  },
  {
    path: 'account',
    title: 'Your account — The Last Link',
    loadComponent: () => import('./pages/account.component').then((m) => m.AccountComponent),
  },
  {
    path: 'credits',
    title: 'Data & credits — The Last Link',
    loadComponent: () => import('./pages/credits.component').then((m) => m.CreditsComponent),
  },
  { path: '**', redirectTo: '' },
];
