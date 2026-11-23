import { afterEach, describe, expect, it, vi } from 'vitest';
import { update } from '../src/core/store';
import { canVibrate, haptic, sfx } from '../src/kits/sound/sound';

afterEach(() => {
  update({ sound: true, haptics: true });
  vi.unstubAllGlobals();
});

describe('sound kit', () => {
  it('is a silent no-op without Web Audio (tests, old browsers)', () => {
    expect(() => sfx('pop')).not.toThrow();
    expect(() => sfx('combo', { step: 9, pitch: -3, vol: 0.5 })).not.toThrow();
  });

  it('vibrates only when the device can and the setting is on', () => {
    const vibrate = vi.fn<(p: VibratePattern) => boolean>(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate });
    expect(canVibrate()).toBe(true);
    haptic(30);
    expect(vibrate).toHaveBeenCalledWith(30);
    update({ haptics: false });
    haptic(30);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does nothing on devices without vibration', () => {
    vi.stubGlobal('navigator', { ...navigator, vibrate: undefined });
    expect(canVibrate()).toBe(false);
    expect(() => haptic([20, 40, 20])).not.toThrow();
  });
});
