import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_AUDIO_CONTEXT, TurnAudioService } from './turn-audio.service';

function audioDevice() {
  const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    state: 'suspended', currentTime: 10, destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(), disconnect: vi.fn(),
    })),
    createOscillator: vi.fn(() => {
      const oscillator = {
        type: '', frequency: { setValueAtTime: vi.fn() }, onended: null,
        connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
  };
  const factory = vi.fn(() => context as unknown as AudioContext);
  TestBed.configureTestingModule({ providers: [{ provide: TURN_AUDIO_CONTEXT, useValue: factory }] });
  return { context, factory, oscillators, service: TestBed.inject(TurnAudioService) };
}

beforeEach(() => localStorage.clear());
afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

describe('Optional turn audio', () => {
  it('uses a distinct three-note rematch cue and deduplicates request snapshots separately from turns', () => {
    const { service, context } = audioDevice();
    document.dispatchEvent(new Event('pointerdown'));
    service.notifyRematch('match:guest:request-one');
    service.notifyRematch('match:guest:request-one');
    expect(context.createOscillator).toHaveBeenCalledTimes(3);
    service.notifyTurn('match:guest:request-one');
    expect(context.createOscillator).toHaveBeenCalledTimes(5);
    service.notifyRematch('match:guest:request-two');
    expect(context.createOscillator).toHaveBeenCalledTimes(8);
  });
  it('shares the existing mute preference with rematch notifications', () => {
    const { service, context } = audioDevice();
    document.dispatchEvent(new Event('pointerdown'));
    service.toggle();
    service.notifyRematch('request-one');
    service.toggle();
    service.notifyRematch('request-one');
    expect(context.createOscillator).not.toHaveBeenCalled();
    service.notifyRematch('request-two');
    expect(context.createOscillator).toHaveBeenCalledTimes(3);
  });
  it('creates no audio context until a pointer or keyboard interaction', () => {
    const { service, factory, context } = audioDevice();
    service.notifyTurn('match:0');
    expect(factory).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('pointerdown'));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it('plays one two-note cue per distinct own turn, including a new match at version zero', () => {
    const { service, context, oscillators } = audioDevice();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    service.notifyTurn('match:0');
    service.notifyTurn('match:0');
    expect(context.createOscillator).toHaveBeenCalledTimes(2);
    service.notifyTurn('match:2');
    service.notifyTurn('rematch:0');
    expect(context.createOscillator).toHaveBeenCalledTimes(6);
    expect(oscillators.every((oscillator) => oscillator.start.mock.calls.length === 1 && oscillator.stop.mock.calls.length === 1)).toBe(true);
  });

  it('does not replay a turn when navigating back to a match or refreshing its snapshot', () => {
    const { service, context } = audioDevice();
    document.dispatchEvent(new Event('pointerdown'));
    service.notifyTurn('match:4');
    service.notifyTurn('match:6');
    service.notifyTurn('match:4');
    expect(context.createOscillator).toHaveBeenCalledTimes(4);
  });

  it('persists mute and skips muted turns without replaying them when unmuted', () => {
    const { service, context } = audioDevice();
    document.dispatchEvent(new Event('pointerdown'));
    service.toggle();
    expect(service.enabled()).toBe(false);
    expect(localStorage.getItem('last-link-turn-sounds')).toBe('off');
    service.notifyTurn('match:0');
    expect(context.createOscillator).not.toHaveBeenCalled();
    service.toggle();
    expect(localStorage.getItem('last-link-turn-sounds')).toBe('on');
    service.notifyTurn('match:0');
    expect(context.createOscillator).not.toHaveBeenCalled();
    service.notifyTurn('match:2');
    expect(context.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('restores a muted preference without opening the audio device', () => {
    localStorage.setItem('last-link-turn-sounds', 'off');
    const { service, factory } = audioDevice();
    expect(service.enabled()).toBe(false);
    document.dispatchEvent(new Event('pointerdown'));
    service.notifyTurn('match:0');
    expect(factory).not.toHaveBeenCalled();
  });

  it('does not queue an old cue while browser audio is blocked', async () => {
    const { service, context } = audioDevice();
    context.resume.mockImplementation(async () => { throw Error('Audio blocked'); });
    document.dispatchEvent(new Event('pointerdown'));
    service.notifyTurn('match:0');
    await Promise.resolve();
    context.state = 'running';
    service.notifyTurn('match:0');
    expect(context.createOscillator).not.toHaveBeenCalled();
    service.notifyTurn('match:2');
    expect(context.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('tolerates unsupported audio and storage failures', () => {
    TestBed.configureTestingModule({ providers: [{ provide: TURN_AUDIO_CONTEXT, useValue: () => undefined }] });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('Storage disabled'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Storage disabled'); });
    const service = TestBed.inject(TurnAudioService);
    expect(service.enabled()).toBe(true);
    expect(() => {
      document.dispatchEvent(new Event('pointerdown'));
      service.notifyTurn('match:0');
      service.toggle();
      service.toggle();
    }).not.toThrow();
  });

  it('isolates an audio output failure from notification handling', () => {
    const { service, context } = audioDevice();
    document.dispatchEvent(new Event('pointerdown'));
    context.createOscillator.mockImplementation(() => { throw Error('Device lost'); });
    expect(() => service.notifyTurn('match:0')).not.toThrow();
  });

  it('removes interaction listeners and closes its device during cleanup', () => {
    const { service, factory, context } = audioDevice();
    document.dispatchEvent(new Event('pointerdown'));
    service.ngOnDestroy();
    document.dispatchEvent(new Event('pointerdown'));
    service.notifyTurn('match:0');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.createOscillator).not.toHaveBeenCalled();
  });
});
