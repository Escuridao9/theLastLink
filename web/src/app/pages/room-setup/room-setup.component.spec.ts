import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  withComponentInputBinding,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { RoomSetup } from './room-setup.component';

describe('Room setup routing', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
      ],
    });
  });

  it('updates the room category when the URL changes', async () => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/play/games', RoomSetup);

    expect(
      harness.routeNativeElement?.querySelector('h1')?.textContent,
    ).toContain('Games');

    await harness.navigateByUrl('/play/movies', RoomSetup);

    expect(
      harness.routeNativeElement?.querySelector('h1')?.textContent,
    ).toContain('Movies');
  });

  it.each(['music', 'books'])(
    'shows an unavailable state for %s',
    async (categoryId) => {
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl(`/play/${categoryId}`, RoomSetup);

      expect(
        harness.routeNativeElement?.querySelector('h1')?.textContent,
      ).toContain("isn't open.");
    },
  );

  it('continues from a category choice to its room setup', async () => {
    const harness = await RouterTestingHarness.create('/play');

    harness.routeNativeElement
      ?.querySelector<HTMLInputElement>('#category-games')
      ?.click();

    harness.detectChanges();

    const continueLink = harness.routeNativeElement
      ?.querySelector<HTMLAnchorElement>('a.continue-button');

    expect(continueLink?.getAttribute('href')).toBe('/play/games');

    continueLink?.click();

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/play/games');

    expect(
      harness.routeNativeElement?.querySelector('h1')?.textContent,
    ).toContain('Games');
  });
});