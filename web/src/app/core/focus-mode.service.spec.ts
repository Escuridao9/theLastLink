import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it } from 'vitest';
import { FocusModeService } from './focus-mode.service';

afterEach(() => TestBed.resetTestingModule());
it('reserves the text-field focus ring for Tab and removes its listeners on destruction', () => {
  TestBed.inject(FocusModeService);
  expect(document.documentElement.dataset['focusMode']).toBe('pointer');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  expect(document.documentElement.dataset['focusMode']).toBe('keyboard');
  document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(document.documentElement.dataset['focusMode']).toBe('pointer');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  expect(document.documentElement.dataset['focusMode']).toBe('pointer');
  TestBed.resetTestingModule();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  expect(document.documentElement.dataset['focusMode']).toBeUndefined();
});
