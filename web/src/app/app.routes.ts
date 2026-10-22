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
    path: '**',
    redirectTo: '',
  },
];