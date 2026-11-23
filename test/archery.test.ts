import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { archery } from '../src/games/archery';
import {
  aimPath,
  arrowsFor,
  BOW,
  createLevel,
  current,
  goalFor,
  GROUND,
  MAX_ANGLE,
  MIN_ANGLE,
  previewFor,
  ringScore,
  shoot,
  step,
  targetY,
  type State,
  type StepEvents,
} from '../src/games/archery/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Fly the arrow in flight until it comes to rest. */
function fly(s: State, dt = DT): StepEvents {
  for (let t = 0; t < 20; t += dt) {
    const ev = step(s, dt);
    if (ev.landed) return ev;
  }
  throw new Error('arrow never landed');
}

/** How well a shot lands: its points, then closeness to the centre of the current target. */
function rate(s: State, angle: number, power: number, windScale: number): number {
  const c = structuredClone(s);
  c.winds = c.winds.map((w) => w * windScale);
  c.angle = angle;
  c.power = power;
  const t = c.targets[current(c)];
  shoot(c);
  const ev = fly(c, 1 / 30);
  return ev.points ? ev.points * 100 - Math.abs(ev.y - targetY(c, t)) : -Math.hypot(ev.x - t.x, ev.y - targetY(c, t));
}

/** Search a grid of aims on copies of the state, then refine around the best one. */
function bestAim(s: State, windScale = 1): [number, number] {
  let best: [number, number] = [s.angle, s.power];
  let top = -Infinity;
  const tryAim = (a: number, p: number) => {
    if (a < MIN_ANGLE || a > MAX_ANGLE || p < 0 || p > 1) return;
    const v = rate(s, a, p, windScale);
    if (v > top) [top, best] = [v, [a, p]];
  };
  for (let i = 0; i <= 16; i++) for (let j = 0; j <= 10; j++) tryAim(MIN_ANGLE + ((MAX_ANGLE - MIN_ANGLE) * i) / 16, j / 10);
  for (const span of [0.04, 0.015, 0.005]) {
    const [a0, p0] = best;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) tryAim(a0 + i * span, p0 + j * span);
  }
  return best;
}

const noise = (r: Rng, sd: number) => (r.next() + r.next() + r.next() - 1.5) * sd * 2;

/** Shoot every arrow: aim from a wind guess that's off by `windErr` (fraction), with aim noise `sd`. */
function autopilot(d: Difficulty, seed: number, sd: number, windErr: number) {
  const s = createLevel(d, new Rng(seed));
  const hand = new Rng(seed * 31 + 7);
  for (;;) {
    // A beat of waiting before each shot, so moving targets aren't always caught at the same spot.
    for (let i = hand.int(0, 30); i > 0; i--) step(s, DT);
    const [a, p] = bestAim(s, 1 + noise(hand, windErr));
    s.angle = a + noise(hand, sd);
    s.power = Math.max(0, Math.min(1, p + noise(hand, sd)));
    shoot(s);
    const ev = fly(s);
    if (ev.cleared || ev.over) return { s, win: ev.cleared };
    while (s.phase !== 'aim') step(s, DT);
  }
}

const SEEDS = [1, 2, 3, 4, 5];

describe('archery rules', () => {
  it('sets up the same range from the same seed', () => {
    const a = createLevel(4, new Rng(12));
    expect(createLevel(4, new Rng(12))).toEqual(a);
    expect(createLevel(4, new Rng(13)).targets).not.toEqual(a.targets);
  });

  it('gets harder: more targets, smaller faces, stronger wind and a shorter guide', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(2));
      const hi = createLevel(d, new Rng(2));
      expect(hi.targets.length).toBeGreaterThanOrEqual(lo.targets.length);
      expect(hi.targets[0].r).toBeLessThan(lo.targets[0].r);
      const strength = (s: State) => s.winds.reduce((a, w) => a + Math.abs(w), 0) / s.winds.length;
      expect(strength(hi)).toBeGreaterThan(strength(lo));
      expect(previewFor(d)).toBeLessThan(previewFor((d - 1) as Difficulty));
    }
    expect(createLevel(5, new Rng(2)).targets.some((t) => t.amp > 0)).toBe(true);
    expect(createLevel(1, new Rng(2)).targets.every((t) => t.amp === 0)).toBe(true);
  });

  it('scores rings from the centre out', () => {
    expect(ringScore(0, 20)).toBe(10);
    expect(ringScore(-5, 20)).toBe(8);
    expect(ringScore(19, 20)).toBe(2);
    expect(ringScore(21, 20)).toBe(0);
  });

  it('shows a guide from the bow and flies the arrow down into the ground', () => {
    const s = createLevel(1, new Rng(3));
    const path = aimPath(s);
    expect(path.length).toBeGreaterThan(5);
    expect(path[0].x).toBeGreaterThan(BOW.x);
    s.angle = MIN_ANGLE;
    s.power = 0;
    shoot(s);
    const ev = fly(s);
    expect(ev.points).toBe(0);
    expect(ev.y).toBe(GROUND);
    expect(s.shot).toBe(1);
  });

  it('is lost once the goal is out of reach', () => {
    const s = createLevel(2, new Rng(4));
    let ev: StepEvents | null = null;
    while (!ev?.over) {
      while (s.phase !== 'aim') step(s, DT);
      s.angle = MIN_ANGLE;
      s.power = 0;
      shoot(s);
      ev = fly(s);
      expect(ev.cleared).toBe(false);
    }
    expect(s.shot).toBeLessThan(arrowsFor(2));
    expect(s.phase).toBe('done');
  });

  it('is cleared at every level by a decent archer, and three stars need a sharp one', () => {
    for (const d of LEVELS) {
      const decent = SEEDS.map((k) => autopilot(d, k * 17 + d, 0.03, 0.5));
      const sharp = SEEDS.map((k) => autopilot(d, k * 17 + d, 0.01, 0.15));
      const stars = (r: { s: State; win: boolean }) => starsFor(archery, d, r.win, r.s.score);
      expect(decent.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(4);
      expect(
        sharp.every((r) => r.win),
        `level ${d}`,
      ).toBe(true);
      expect(sharp.filter((r) => stars(r) === 3).length, `level ${d}`).toBeGreaterThanOrEqual(3);
      expect(decent.filter((r) => stars(r) === 3).length, `level ${d}`).toBeLessThanOrEqual(1);
      for (const r of decent.filter((x) => x.win)) expect(r.s.score).toBeGreaterThanOrEqual(goalFor(d));
    }
  });
});

describe('archery game', () => {
  const key = (m: ReturnType<typeof mountGame>, k: string, type = 'keydown') => m.inst.onKey?.(new KeyboardEvent(type, { key: k }));

  it('mounts, aims with the arrows and shoots with Space', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(archery, d, 5);
      expect(m.status).toContain(`0/${goalFor(d)}`);
      m.run(2);
      expect(m.outcome).toBe('');
      expect(key(m, 'ArrowUp')).toBe(true);
      m.run(0.3);
      key(m, 'ArrowUp', 'keyup');
      expect(key(m, ' ')).toBe(true);
      m.run(5);
      expect(m.status).toContain(`arrow 2/${arrowsFor(d)}`);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('can be won from the keyboard', () => {
    const m = mountGame(archery, 1, 6);
    const twin = createLevel(1, new Rng(6));
    // Plan each shot on the twin, then dial it in with the keys, one frame at a time.
    while (!m.outcome) {
      const [a, p] = bestAim(twin);
      for (let f = 0; f < 600 && (Math.abs(twin.angle - a) > 0.004 || Math.abs(twin.power - p) > 0.004); f++) {
        const turn = Math.abs(twin.angle - a) > 0.004 ? Math.sign(a - twin.angle) : 0;
        const pull = Math.abs(twin.power - p) > 0.004 ? Math.sign(p - twin.power) : 0;
        for (const [k, on] of [
          ['ArrowUp', turn > 0],
          ['ArrowDown', turn < 0],
          ['ArrowRight', pull > 0],
          ['ArrowLeft', pull < 0],
        ] as const)
          key(m, k, on ? 'keydown' : 'keyup');
        twin.turn = turn;
        twin.pull = pull;
        m.inst.frame?.(1 / 600);
        step(twin, 1 / 600);
      }
      for (const k of ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft']) key(m, k, 'keyup');
      twin.turn = twin.pull = 0;
      key(m, ' ');
      shoot(twin);
      while (twin.phase !== 'aim' && twin.phase !== 'done') {
        m.inst.frame?.(DT);
        step(twin, DT);
      }
      expect(m.score).toBe(twin.score);
      if (twin.phase === 'done') break;
    }
    expect(m.outcome).toBe('win');
    expect(m.score).toBeGreaterThanOrEqual(goalFor(1));
  });
});
