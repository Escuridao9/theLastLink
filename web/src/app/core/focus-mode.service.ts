import { Injectable, OnDestroy, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/** Text inputs match :focus-visible even after mouse clicks, so track Tab explicitly. */
@Injectable({ providedIn: 'root' })
export class FocusModeService implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Tab') this.document.documentElement.dataset['focusMode'] = 'keyboard';
  };
  private readonly pointer = () => {
    this.document.documentElement.dataset['focusMode'] = 'pointer';
  };
  constructor() {
    this.pointer();
    this.document.addEventListener('keydown', this.keyboard, true);
    this.document.addEventListener('pointerdown', this.pointer, true);
  }
  ngOnDestroy(): void {
    this.document.removeEventListener('keydown', this.keyboard, true);
    this.document.removeEventListener('pointerdown', this.pointer, true);
    delete this.document.documentElement.dataset['focusMode'];
  }
}
