import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { RoomSetup } from './room-setup.component';

describe('Room setup', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding())],
    });
  });

  it('updates the room category when the URL changes', async () => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/play/games', RoomSetup);

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Games');

    await harness.navigateByUrl('/play/movies', RoomSetup);

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Movies');
  });

  it.each(['music', 'books'])('shows an unavailable state for %s', async (categoryId) => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl(`/play/${categoryId}`, RoomSetup);

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain("isn't open.");
  });

  it('continues from a category choice to its room setup', async () => {
    const harness = await RouterTestingHarness.create('/play');

    harness.routeNativeElement?.querySelector<HTMLInputElement>('#category-games')?.click();

    harness.detectChanges();

    const continueLink =
      harness.routeNativeElement?.querySelector<HTMLAnchorElement>('a.continue-button');

    expect(continueLink?.getAttribute('href')).toBe('/play/games');

    continueLink?.click();

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/play/games');

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Games');
  });

  function enterPlayerName(harness: RouterTestingHarness, name: string): void {
    const nameInput =
      harness.routeNativeElement?.querySelector<HTMLInputElement>('#create-player-name');

    if (!nameInput) {
      throw new Error('The player-name input was not rendered.');
    }

    nameInput.value = name;
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameInput.dispatchEvent(new Event('blur'));
    harness.detectChanges();
  }

  it('shows required feedback after leaving a blank name', async () => {
    const harness = await RouterTestingHarness.create('/play/games');

    const error = harness.routeNativeElement?.querySelector('#create-name-error');

    expect(error?.textContent?.trim()).toBe('');

    enterPlayerName(harness, '   ');

    expect(error?.textContent?.trim()).toBe('Enter your player name.');
  });

  it('trims the name and clears feedback after a valid correction', async () => {
    const harness = await RouterTestingHarness.create('/play/games');

    enterPlayerName(harness, ' x ');

    expect(
      harness.routeNativeElement?.querySelector('#create-name-error')?.textContent?.trim(),
    ).toBe('Use at least 2 characters.');

    enterPlayerName(harness, '  Diogo  ');

    const nameInput =
      harness.routeNativeElement?.querySelector<HTMLInputElement>('#create-player-name');

    expect(nameInput?.value).toBe('Diogo');
    expect(nameInput?.getAttribute('aria-invalid')).toBe('false');

    expect(
      harness.routeNativeElement?.querySelector('#create-name-error')?.textContent?.trim(),
    ).toBe('');
  });

  it('accepts 24 characters and rejects 25', async () => {
    const harness = await RouterTestingHarness.create('/play/games');

    enterPlayerName(harness, 'D'.repeat(24));

    expect(
      harness.routeNativeElement?.querySelector('#create-name-error')?.textContent?.trim(),
    ).toBe('');

    enterPlayerName(harness, 'D'.repeat(25));

    expect(
      harness.routeNativeElement?.querySelector('#create-name-error')?.textContent?.trim(),
    ).toBe('Use no more than 24 characters.');
  });
});
