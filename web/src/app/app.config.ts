import {
  ApplicationConfig,
  inject,
  Injector,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withHashLocation,
  withInMemoryScrolling,
} from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { ConfigService } from './core/config.service';
import { BackendService } from './core/backend.service';
import { isDesignReviewUrl } from './core/auth-navigation';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideAppInitializer(() => {
      const config = inject(ConfigService);
      const injector = inject(Injector);
      return config.load().then(() => {
        if (config.configured && !isDesignReviewUrl(window.location.href))
          return injector.get(BackendService).restoreIfPresent();
        return undefined;
      });
    }),
    provideRouter(
      routes,
      withHashLocation(),
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled',
      }),
    ),
  ],
};
