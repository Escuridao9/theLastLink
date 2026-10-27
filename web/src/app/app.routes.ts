import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'The Last Link — One life. Make it count.',
    loadComponent: () => import('./pages/home/home.component').then((module) => module.Home),
  },
  {
    path: 'play',
    pathMatch: 'full',
    title: 'Choose your category — The Last Link',
    loadComponent: () =>
      import('./pages/category-selection/category-selection.component').then(
        (module) => module.CategorySelection,
      ),
  },
  {
    path: 'play/:categoryId',
    title: 'Set up your room — The Last Link',
    loadComponent: () =>
      import('./pages/room-setup/room-setup.component').then((module) => module.RoomSetup),
  },
  {
    path: 'rooms/:roomId',
    title: 'Your lobby — The Last Link',
    loadComponent: () => import('./pages/lobby/lobby.component').then((module) => module.Lobby),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
