import { ErrorHandler, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { RoomService } from '../../core/services/room.service';
import { RoomSetup } from './room-setup.component';

describe('Room setup', () => {
  const createRoom = vi.fn<RoomService['createRoom']>();
  beforeEach(() => {
    createRoom.mockReset();

    createRoom.mockImplementation(async (request) => ({
      id: request.roomId,
      code: 'AB7K2Q',
      categoryId: request.categoryId,
      displayName: request.displayName,
    }));

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        {
          provide: RoomService,
          useValue: { createRoom },
        },
        {
          provide: ErrorHandler,
          useValue: { handleError: vi.fn() },
        },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: signal(true),
            ensureSession: async () => undefined,
          },
        },
      ],
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

    await harness.fixture.whenStable();

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

  function enterTextField(harness: RouterTestingHarness, selector: string, value: string): void {
    const field = harness.routeNativeElement?.querySelector<HTMLInputElement>(selector);

    if (!field) {
      throw new Error(`Input was not rendered: ${selector}`);
    }

    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('blur'));
    harness.detectChanges();
  }

  function enterPlayerName(harness: RouterTestingHarness, name: string): void {
    enterTextField(harness, '#create-player-name', name);
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

  it('requires a room code after leaving a blank field', async () => {
    const harness = await RouterTestingHarness.create('/play/games');

    enterTextField(harness, '#join-room-code', '   ');

    expect(harness.routeNativeElement?.querySelector('#join-code-error')?.textContent?.trim()).toBe(
      'Enter a room code.',
    );
  });

  it('normalizes a pasted room code', async () => {
    const harness = await RouterTestingHarness.create('/play/games');

    enterTextField(harness, '#join-room-code', '  ab7k2q  ');

    const codeInput =
      harness.routeNativeElement?.querySelector<HTMLInputElement>('#join-room-code');

    expect(codeInput?.value).toBe('AB7K2Q');
    expect(codeInput?.getAttribute('aria-invalid')).toBe('false');

    expect(harness.routeNativeElement?.querySelector('#join-code-error')?.textContent?.trim()).toBe(
      '',
    );
  });

  it.each(['ABC12', 'ABC1234', 'ABC12!'])('rejects the invalid room code %s', async (code) => {
    const harness = await RouterTestingHarness.create('/play/games');

    enterTextField(harness, '#join-room-code', code);

    expect(harness.routeNativeElement?.querySelector('#join-code-error')?.textContent?.trim()).toBe(
      'Use 6 characters: A-Z or 0-9.',
    );
  });

  it('keeps the two player-name fields independent', async () => {
    const harness = await RouterTestingHarness.create('/play/games');

    enterPlayerName(harness, 'Diogo');
    enterTextField(harness, '#join-player-name', 'Rival');

    expect(
      harness.routeNativeElement?.querySelector<HTMLInputElement>('#create-player-name')?.value,
    ).toBe('Diogo');

    expect(
      harness.routeNativeElement?.querySelector<HTMLInputElement>('#join-player-name')?.value,
    ).toBe('Rival');
  });

  function submitCreate(harness: RouterTestingHarness): void {
    const form = harness.routeNativeElement?.querySelector('form');

    if (!form) {
      throw new Error('Create-room form was not rendered.');
    }

    form.dispatchEvent(
      new Event('submit', {
        bubbles: true,
        cancelable: true,
      }),
    );

    harness.detectChanges();
  }

  it('displays the room returned by the service', async () => {
    const harness = await RouterTestingHarness.create('/play/games');

    enterPlayerName(harness, '  Diogo  ');
    submitCreate(harness);

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(createRoom).toHaveBeenCalledWith({
      roomId: expect.any(String),
      categoryId: 'games',
      displayName: 'Diogo',
    });

    expect(harness.routeNativeElement?.querySelector('.created-room-code')?.textContent).toContain(
      'AB7K2Q',
    );

    expect(
      harness.routeNativeElement?.querySelector<HTMLInputElement>('#create-player-name')?.readOnly,
    ).toBe(true);
  });

  it('reuses the request ID after a failed attempt', async () => {
    createRoom.mockRejectedValueOnce(new Error('Please try again.'));

    const harness = await RouterTestingHarness.create('/play/games');

    enterPlayerName(harness, 'Diogo');
    submitCreate(harness);

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain(
      'Please try again.',
    );

    submitCreate(harness);
    await harness.fixture.whenStable();

    expect(createRoom.mock.calls[0][0].roomId).toBe(createRoom.mock.calls[1][0].roomId);
  });

  it('prevents duplicate submissions while creating', async () => {
    let finish = () => {};

    createRoom.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              id: request.roomId,
              code: 'AB7K2Q',
              categoryId: request.categoryId,
              displayName: request.displayName,
            });
        }),
    );

    const harness = await RouterTestingHarness.create('/play/games');

    enterPlayerName(harness, 'Diogo');

    submitCreate(harness);
    submitCreate(harness);

    expect(createRoom).toHaveBeenCalledTimes(1);

    const button =
      harness.routeNativeElement?.querySelector<HTMLButtonElement>('button[type="submit"]');

    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain('Creating');

    finish();
    await harness.fixture.whenStable();
  });

  it('discards a late result after the category changes', async () => {
    let finish = () => {};

    createRoom.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              id: request.roomId,
              code: 'AB7K2Q',
              categoryId: request.categoryId,
              displayName: request.displayName,
            });
        }),
    );

    const harness = await RouterTestingHarness.create('/play/games');

    enterPlayerName(harness, 'Diogo');
    submitCreate(harness);

    await harness.navigateByUrl('/play/movies', RoomSetup);

    finish();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector('.created-room-code')).toBeNull();
  });
});
