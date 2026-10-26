import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorHandler, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { CategorySelection } from './category-selection.component';

describe('Category player connection', () => {
  let fixture: ComponentFixture<CategorySelection>;

  const connected = signal(false);
  const ensureSession = vi.fn<() => Promise<void>>();
  const handleError = vi.fn();

  beforeEach(() => {
    connected.set(false);

    ensureSession.mockReset();
    ensureSession.mockImplementation(async () => {
      connected.set(true);
    });

    handleError.mockClear();

    TestBed.configureTestingModule({
      imports: [CategorySelection],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: connected,
            ensureSession,
          },
        },
        {
          provide: ErrorHandler,
          useValue: { handleError },
        },
      ],
    });

    fixture = TestBed.createComponent(CategorySelection);
  });

  function page(): HTMLElement {
    return fixture.nativeElement;
  }

  function chooseGames(): void {
    const input = page().querySelector<HTMLInputElement>('#category-games');

    if (!input) {
      throw new Error('Games option was not rendered.');
    }

    input.click();
    fixture.detectChanges();
  }

  it('waits for a player session before enabling Continue', async () => {
    let finish = () => {};

    ensureSession.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            connected.set(true);
            resolve();
          };
        }),
    );

    fixture.detectChanges();
    chooseGames();

    expect(
      page().querySelector<HTMLButtonElement>('button.continue-button')
        ?.disabled,
    ).toBe(true);

    expect(
      page().querySelector('.player-status')?.textContent,
    ).toContain('Connecting your player');

    finish();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      page().querySelector('a.continue-button')?.getAttribute('href'),
    ).toBe('/play/games');
  });

  it('shows an error and retries without losing the category choice', async () => {
    const error = new Error('Offline.');
    ensureSession.mockRejectedValueOnce(error);

    fixture.detectChanges();
    chooseGames();

    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      page().querySelector('[role="alert"]')?.textContent,
    ).toContain('Please try again');

    expect(handleError).toHaveBeenCalledWith(error);

    page()
      .querySelector<HTMLButtonElement>('.connection-retry')
      ?.click();

    await fixture.whenStable();
    fixture.detectChanges();

    expect(ensureSession).toHaveBeenCalledTimes(2);
    expect(page().querySelector('[role="alert"]')).toBeNull();

    expect(
      page().querySelector('a.continue-button')?.getAttribute('href'),
    ).toBe('/play/games');
  });
});