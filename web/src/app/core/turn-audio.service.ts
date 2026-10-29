import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, OnDestroy, inject, signal } from '@angular/core';

export const TURN_AUDIO_CONTEXT = new InjectionToken<() => AudioContext | undefined>(
  'Turn audio context',
  {
    providedIn: 'root',
    factory: () => () => typeof AudioContext === 'undefined' ? undefined : new AudioContext(),
  },
);

/** Optional local feedback. Sound never sends a command or changes a server deadline. */
@Injectable({ providedIn: 'root' })
export class TurnAudioService implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly createContext = inject(TURN_AUDIO_CONTEXT);
  private readonly preferenceKey = 'last-link-turn-sounds';
  readonly enabled = signal(this.readPreference());
  private context?: AudioContext;
  private readonly announcedTurns = new Set<string>();
  private destroyed = false;

  constructor() {
    this.document.addEventListener('pointerdown', this.unlock, { capture: true, passive: true });
    this.document.addEventListener('keydown', this.unlock, true);
  }

  private readPreference(): boolean {
    try {
      return localStorage.getItem(this.preferenceKey) !== 'off';
    } catch {
      return true;
    }
  }

  /** Browsers allow audio after an interaction; blocked audio must never block play. */
  private readonly unlock = (): void => {
    if (!this.enabled() || this.destroyed) return;
    try {
      this.context ??= this.createContext();
      if (this.context && this.context.state !== 'running') {
        void this.context.resume().catch(() => {});
      }
    } catch {
      // Unsupported or unavailable audio leaves the visual turn indicators working.
    }
  };

  toggle(): void {
    this.enabled.update((enabled) => !enabled);
    try {
      localStorage.setItem(this.preferenceKey, this.enabled() ? 'on' : 'off');
    } catch {
      // Private browser settings can disable persistent preferences.
    }
    if (this.enabled()) this.unlock();
  }

  notifyTurn(key: string): void {
    this.notify(`turn:${key}`, [[0, 659.25], [0.12, 880]]);
  }

  notifyRematch(key: string): void {
    this.notify(`rematch:${key}`, [[0, 523.25], [0.12, 659.25], [0.24, 783.99]]);
  }

  private notify(key: string, notes: number[][]): void {
    if (this.destroyed || this.announcedTurns.has(key)) return;
    this.announcedTurns.add(key);
    if (this.announcedTurns.size > 100) {
      this.announcedTurns.delete(this.announcedTurns.values().next().value!);
    }
    const context = this.context;
    if (!this.enabled() || context?.state !== 'running') return;
    try {
      // Quiet notes synthesized locally: no recording or external audio request.
      for (const [delay, frequency] of notes) {
        const start = context.currentTime + delay;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.065, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + 0.12);
      }
    } catch {
      // Audio output failures are deliberately isolated from match handling.
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.document.removeEventListener('pointerdown', this.unlock, true);
    this.document.removeEventListener('keydown', this.unlock, true);
    void this.context?.close().catch(() => {});
    this.announcedTurns.clear();
  }
}
