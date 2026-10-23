import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'The Last Link — One life. Make it count.',
    loadComponent: () =>
      import('./pages/home/home.component').then((module) => module.Home),
  },
  {
    path: 'play',
    title: 'Choose your category — The Last Link',
    loadComponent: () =>
      import('./pages/category-selection/category-selection.component').then(
        (module) => module.CategorySelection,
      ),
  },
  {
    path: '**',
    redirectTo: '',
  },
];