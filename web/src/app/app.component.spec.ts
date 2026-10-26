import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './app.component';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
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