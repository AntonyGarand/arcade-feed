import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { archery } from '../src/games/archery';
import {
  aimPath,
  arrowsFor,
  balloonY,
  BOW,
  createLevel,
  current,
  goalFor,
  GROUND,
  guided,
  KINDS,
  MAX_ANGLE,
  MIN_ANGLE,
  mult,
  previewFor,
  ringScore,
  shoot,
  step,
  STREAK_TIERS,
  targetY,
  wind,
  type KindId,
  type Reward,
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
  if (c.gust) c.gust.amp *= windScale;
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

/**
 * Shoot every arrow: aim from a wind guess that's off by `windErr` (fraction, halved while the streak's
 * wind guide shows it), with aim noise `sd`.
 */
function autopilot(d: Difficulty, seed: number, sd: number, windErr: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const hand = new Rng(seed * 31 + 7);
  for (;;) {
    // A beat of waiting before each shot, so moving targets aren't always caught at the same spot.
    for (let i = hand.int(0, 30); i > 0; i--) step(s, DT);
    const [a, p] = bestAim(s, 1 + noise(hand, guided(s) ? windErr / 2 : windErr));
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
    expect(createLevel(4, new Rng(12)).kind).toBe(a.kind);
    expect(createLevel(4, new Rng(13)).targets).not.toEqual(a.targets);
  });

  it('gets harder: more targets, smaller faces, stronger wind and a shorter guide', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(2), 'range');
      const hi = createLevel(d, new Rng(2), 'range');
      expect(hi.targets.length).toBeGreaterThanOrEqual(lo.targets.length);
      expect(hi.targets[0].r).toBeLessThan(lo.targets[0].r);
      const strength = (s: State) => s.winds.reduce((a, w) => a + Math.abs(w), 0) / s.winds.length;
      expect(strength(hi)).toBeGreaterThan(strength(lo));
      expect(previewFor(d)).toBeLessThan(previewFor((d - 1) as Difficulty));
    }
    expect(createLevel(5, new Rng(2), 'range').targets.some((t) => t.amp > 0)).toBe(true);
    expect(createLevel(1, new Rng(2), 'range').targets.every((t) => t.amp === 0)).toBe(true);
  });

  it('scores rings from the centre out', () => {
    expect(ringScore(0, 20)).toBe(10);
    expect(ringScore(-5, 20)).toBe(8);
    expect(ringScore(19, 20)).toBe(2);
    expect(ringScore(21, 20)).toBe(0);
  });

  it('shows a guide from the bow and flies the arrow down into the ground', () => {
    const s = createLevel(1, new Rng(3), 'range');
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
    const s = createLevel(2, new Rng(4), 'range');
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

  it('deals different kinds of range across seeds, each only from its level on', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(4);
    const easy = kindsAt(1, KINDS).map((k) => k.id as string);
    for (let seed = 0; seed < 40; seed++) expect(easy).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('gives each kind its twist', () => {
    const wall = createLevel(3, new Rng(5), 'wall');
    expect(wall.wall).not.toBeNull();
    for (const t of wall.targets) expect(t.y).toBeLessThanOrEqual(wall.wall!.top);
    const fair = createLevel(3, new Rng(5), 'balloons');
    expect(fair.balloons.length).toBeGreaterThanOrEqual(3);
    const gusty = createLevel(3, new Rng(5), 'gusty');
    expect(new Set(Array.from({ length: 30 }, (_, i) => wind(gusty, i * 0.2))).size).toBeGreaterThan(5);
    expect(createLevel(3, new Rng(5), 'carnival').targets.every((t) => t.amp > 0)).toBe(true);
    expect(createLevel(3, new Rng(5), 'range').targets.some((t) => t.amp === 0)).toBe(true);
  });

  it('stops a flat shot at the palisade', () => {
    const s = createLevel(2, new Rng(6), 'wall');
    s.angle = 0;
    s.power = 1;
    shoot(s);
    const ev = fly(s);
    expect(ev.blocked).toBe(true);
    expect(ev.points).toBe(0);
    expect(ev.x).toBeLessThanOrEqual(s.wall!.x + s.wall!.w);
  });

  it('pops a balloon in the way for bonus points, and the arrow flies on', () => {
    const s = createLevel(2, new Rng(7), 'balloons');
    const b = s.balloons[0];
    s.angle = 0.3;
    s.power = 0.8;
    // Find where this shot crosses the balloon's column, then park the balloon there.
    const twin = structuredClone(s);
    twin.balloons = [];
    shoot(twin);
    while (twin.ax < b.x) step(twin, 1 / 600);
    b.rise = 0;
    b.y0 = twin.ay;
    expect(balloonY(b, 3)).toBeCloseTo(twin.ay);
    shoot(s);
    const pops: number[] = [];
    let ev: StepEvents;
    do {
      ev = step(s, DT);
      for (const q of ev.pops) pops.push(q.points);
    } while (!ev.landed);
    expect(pops).toEqual([2]);
    expect(b.popped).toBe(true);
    expect(s.score).toBe(2 + ev.points);
    expect(ev.x).toBeGreaterThan(b.x);
  });

  it('a streak of good shots unlocks the wind guide, double points, then a bonus arrow', () => {
    const s = createLevel(1, new Rng(8), 'range');
    const arrows = s.arrows;
    const plain = aimPath(s).length;
    const unlocked: Reward[] = [];
    /** What the player has after each arrow: guide on, its length, points multiplier. */
    const after: [boolean, boolean, number][] = [];
    let last: StepEvents | null = null;
    while (s.phase !== 'done') {
      const [a, p] = bestAim(s);
      s.angle = a;
      s.power = p;
      shoot(s);
      last = fly(s);
      expect(last.ring).toBeGreaterThanOrEqual(6);
      if (last.unlocked) unlocked.push(last.unlocked);
      after.push([guided(s), aimPath(s).length > plain * 2, mult(s)]);
      while (s.phase === 'show') step(s, DT);
    }
    expect(unlocked).toEqual(['guide', 'double', 'extra']);
    expect(after.slice(0, 3)).toEqual([
      [false, false, 1],
      [true, true, 1],
      [true, true, 2],
    ]);
    expect(s.arrows).toBe(arrows + 1);
    expect(s.hits.length).toBe(arrows + 1);
    expect(last?.cleared).toBe(true);
    // Every arrow after the second milestone scores double.
    for (const h of s.hits.slice(STREAK_TIERS[1])) expect(h).toBeGreaterThanOrEqual(12);
  });

  it('a weak shot breaks the streak and its rewards', () => {
    const s = createLevel(1, new Rng(9), 'range');
    for (let i = 0; i < STREAK_TIERS[1]; i++) {
      const [a, p] = bestAim(s);
      s.angle = a;
      s.power = p;
      shoot(s);
      fly(s);
      while (s.phase === 'show') step(s, DT);
    }
    expect(mult(s)).toBe(2);
    s.angle = MIN_ANGLE;
    s.power = 0;
    shoot(s);
    expect(fly(s).streak).toBe(0);
    expect(guided(s)).toBe(false);
    expect(mult(s)).toBe(1);
  });

  it('every kind allowed at a level can be won by a sharp archer', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS))
        for (const k of [1, 2, 3]) {
          const r = autopilot(d, k * 17 + d, 0.01, 0.15, id);
          expect(r.s.kind).toBe(id);
          expect(r.win, `${id} level ${d} seed ${k}`).toBe(true);
        }
  });
});

describe('archery game', () => {
  const key = (m: ReturnType<typeof mountGame>, k: string, type = 'keydown') => m.inst.onKey?.(new KeyboardEvent(type, { key: k }));

  it('mounts, aims with the arrows and shoots with Space', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(archery, d, 5);
      expect(m.status).toContain(`0/${goalFor(d)}`);
      expect(m.variant?.name).toBeTruthy();
      expect(KINDS.map((k) => k.id as string)).toContain(m.variant?.id);
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
