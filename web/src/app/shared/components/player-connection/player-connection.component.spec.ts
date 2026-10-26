import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlayerConnection } from './player-connection.component';

@Component({
  imports: [PlayerConnection],
  template: `
    <app-player-connection
      [connecting]="connecting()"
      [connected]="connected()"
      [error]="error()"
      (retryRequested)="retry()"
    />
  `,
})
class TestHost {
  readonly connecting = signal(false);
  readonly connected = signal(false);
  readonly error = signal<string | null>(null);

  retryCount = 0;

  retry(): void {
    this.retryCount += 1;
    this.connecting.set(true);
    this.error.set(null);
  }
}

describe('PlayerConnection', () => {
  let fixture: ComponentFixture<TestHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHost],
    });

    fixture = TestBed.createComponent(TestHost);
  });

  function page(): HTMLElement {
    return fixture.nativeElement;
  }

  it('shows progress and hides retry while connecting', () => {
    fixture.componentInstance.connecting.set(true);
    fixture.detectChanges();

    expect(
      page().querySelector('[role="status"]')?.textContent,
    ).toContain('Connecting your player');

    expect(page().querySelector('button')).toBeNull();
  });

  it('updates the display when the parent becomes connected', () => {
    fixture.componentInstance.connecting.set(true);
    fixture.detectChanges();

    fixture.componentInstance.connecting.set(false);
    fixture.componentInstance.connected.set(true);
    fixture.detectChanges();

    expect(
      page().querySelector('[role="status"]')?.textContent,
    ).toContain('Your player is connected');

    expect(page().querySelector('button')).toBeNull();
  });

  it('passes a retry request to the parent after a failure', () => {
    fixture.componentInstance.error.set('Please try again.');
    fixture.detectChanges();

    expect(
      page().querySelector('[role="alert"]')?.textContent,
    ).toContain('Please try again.');

    const button = page().querySelector<HTMLButtonElement>('button');

    if (!button) {
      throw new Error('Retry button was not rendered.');
    }

    expect(button.textContent).toContain('Try again');

    button.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.retryCount).toBe(1);
    expect(page().querySelector('[role="alert"]')).toBeNull();

    expect(
      page().querySelector('[role="status"]')?.textContent,
    ).toContain('Connecting your player');

    expect(page().querySelector('button')).toBeNull();
  });
});