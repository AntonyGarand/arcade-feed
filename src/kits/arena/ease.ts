/** Easing curves for tweens: `t` from 0 to 1 (clamped), result from 0 to 1 (outBack overshoots a little). */

const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

export const outCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;

/** Overshoots past 1 then settles: pops, landings. */
export function outBack(t: number, k = 1.70158) {
  const x = clamp01(t) - 1;
  return 1 + (k + 1) * x ** 3 + k * x ** 2;
}

/** Move `from` towards `to`, frame-rate independent (`rate` per second, higher is snappier). */
export const approach = (from: number, to: number, rate: number, dt: number) => to + (from - to) * Math.exp(-rate * dt);
