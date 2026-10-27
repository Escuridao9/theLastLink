import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ConfigService } from './core/config.service';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './app.component';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: ConfigService, useValue: { issue: signal('') } }],
    }).compileComponents();
  });

  it('creates the application', () => {
    const fixture = TestBed.createComponent(App);

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the application branding', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;

    expect(
      element.querySelector('.wordmark-name')?.textContent,
    ).toContain('The Last Link');
  });
});