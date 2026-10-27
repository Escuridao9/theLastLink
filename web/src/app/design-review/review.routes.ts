import { REQUEST_ID } from '../shared/request-id';
import { signal } from '@angular/core';
import { Routes } from '@angular/router';
import { ConfigService } from '../core/config.service';
import { MatchService } from '../core/match.service';
import { CatalogueService } from '../core/catalogue.service';
import { ReviewMatchService, ReviewCatalogueService } from './review-services';
import { PREVIEW_CONFIGURATION } from '../../../../src/configuration';
export const REVIEW_ROUTES: Routes = [
  {
    path: '',
    providers: [
      {
        provide: REQUEST_ID,
        useFactory: () => {
          let sequence = 0;
          return () => `design-review-request-${++sequence}`;
        },
      },
      { provide: MatchService, useClass: ReviewMatchService },
      { provide: CatalogueService, useClass: ReviewCatalogueService },
      {
        provide: ConfigService,
        useValue: { configured: true, value: PREVIEW_CONFIGURATION, issue: signal('') },
      },
    ],
    loadComponent: () => import('./design-review.component').then((m) => m.DesignReviewComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('../pages/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'play',
        loadComponent: () =>
          import('../pages/categories.component').then((m) => m.CategoriesComponent),
      },
      {
        path: 'catalogue',
        loadComponent: () =>
          import('../pages/catalogue.component').then((m) => m.CatalogueComponent),
      },
      {
        path: 'rooms',
        loadComponent: () => import('../pages/rooms.component').then((m) => m.RoomsComponent),
      },
      {
        path: 'rooms/:id',
        loadComponent: () => import('../pages/rooms.component').then((m) => m.RoomsComponent),
      },
      {
        path: 'match/:id',
        loadComponent: () => import('../pages/match.component').then((m) => m.MatchComponent),
      },
      {
        path: 'results/:id',
        loadComponent: () => import('../pages/results.component').then((m) => m.ResultsComponent),
      },
      {
        path: 'credits',
        loadComponent: () => import('../pages/credits.component').then((m) => m.CreditsComponent),
      },
    ],
  },
];
