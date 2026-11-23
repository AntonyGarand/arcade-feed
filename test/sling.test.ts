import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { sling } from '../src/games/sling';
import {
  createLevel,
  fire,
  GROUND,
  setAim,
  shotsFor,
  step,
  stoneOf,
  targetsFor,
  type State,
  type StepEvents,
} from '../src/games/sling/rules';
import { mountGame } from './support/mount';

const DT = 1 / 30;

/** Fling a stone and play until the world settles. Returns everything that happened. */
function play(s: State, angle: number, power: number) {
  setAim(s, angle, power);
  expect(fire(s)).toBe(true);
  const all: StepEvents[] = [];
  for (let t = 0; t < 20 && s.phase === 'flight'; t += DT) all.push(step(s, DT));
  expect(s.phase).not.toBe('flight');
  return all;
}

const blocks = (s: State) => s.bodies.filter((b) => b.mat === 'wood' || b.mat === 'stone');
const hp = (s: State) => blocks(s).reduce((a, b) => a + b.hp, 0);

/**
 * Brute-force aim: try a grid of angles and pulls on copies of the state, refine around the best few,
 * keep the shot that pops the most blobs (then scores most, then damages most).
 */
function bestShot(s: State): [number, number] {
  const rate = (a: number, p: number): [number, number, number] => {
    const c = structuredClone(s);
    play(c, a, p);
    return [(s.targets - c.targets) * 1000 + c.score - s.score + (hp(s) - hp(c)) * 5, a, p];
  };
  const tried: [number, number, number][] = [];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) tried.push(rate(-0.3 + (i * 1.6) / 15, 0.3 + j * 0.1));
  tried.sort((x, y) => y[0] - x[0]);
  for (const [, a0, p0] of tried.slice(0, 4))
    for (const da of [-0.04, -0.02, 0.02, 0.04]) for (const dp of [-0.05, 0, 0.05]) tried.push(rate(a0 + da, Math.min(1, p0 + dp)));
  tried.sort((x, y) => y[0] - x[0]);
  return [tried[0][1], tried[0][2]];
}

describe('sling rules', () => {
  it('deals the same forts from the same seed', () => {
    const a = createLevel(4, new Rng(42));
    const b = createLevel(4, new Rng(42));
    expect(a.bodies).toEqual(b.bodies);
    expect(createLevel(4, new Rng(43)).bodies).not.toEqual(a.bodies);
  });

  it('gets harder: more blobs and blocks, a boulder, then stone', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(5));
      expect(s.targets).toBe(targetsFor(d));
      expect(s.shots).toBe(shotsFor(d));
      expect(s.shots).toBeLessThanOrEqual(s.targets + 1);
      // The boulder: a rock standing between the sling and the forts.
      expect(
        s.bodies.some((b) => b.mat === 'ground' && b.x < 120 && b.y < GROUND),
        `boulder ${d}`,
      ).toBe(d >= 2);
      expect(s.bodies.some((b) => b.mat === 'stone') && d < 3, `stone ${d}`).toBe(false);
    }
    const avg = (d: Difficulty) => [1, 2, 3, 4].reduce((a, seed) => a + blocks(createLevel(d, new Rng(seed))).length, 0);
    for (const d of LEVELS.slice(1)) expect(avg(d)).toBeGreaterThan(avg((d - 1) as Difficulty));
    expect([1, 2, 3, 4].some((seed) => createLevel(5, new Rng(seed)).bodies.some((b) => b.mat === 'stone'))).toBe(true);
  });

  it('keeps every fort standing still, even when everything is woken', () => {
    for (const d of LEVELS)
      for (const seed of [1, 2, 3]) {
        const s = createLevel(d, new Rng(seed));
        const at = s.bodies.map((b) => [b.x, b.y]);
        for (let t = 0; t < 3; t += DT) step(s, DT);
        expect(s.bodies.map((b) => [b.x, b.y])).toEqual(at);
        for (const b of s.bodies) b.awake = b.inv > 0;
        s.phase = 'flight';
        for (let t = 0; t < 3; t += DT) step(s, DT);
        expect(s.targets, `${d}/${seed}`).toBe(targetsFor(d));
        expect(s.score).toBe(0);
        const moved = Math.max(...s.bodies.map((b, i) => Math.hypot(b.x - at[i][0], b.y - at[i][1])));
        expect(moved, `${d}/${seed}`).toBeLessThan(1.5);
      }
  });

  it('aims with the keys and fires one stone at a time', () => {
    const s = createLevel(2, new Rng(3));
    const a0 = s.angle;
    s.turn = 1;
    step(s, 0.25);
    expect(s.angle).toBeGreaterThan(a0);
    s.turn = 0;
    expect(fire(s)).toBe(true);
    expect(fire(s)).toBe(false);
    expect(stoneOf(s)?.vx).toBeGreaterThan(0);
    expect(s.used).toBe(1);
  });

  it('lets a stone into the dirt pop nothing, then crumbles it and readies the next', () => {
    const s = createLevel(3, new Rng(8));
    const evs = play(s, -0.5, 0);
    expect(s.targets).toBe(targetsFor(3));
    expect(evs.some((e) => e.ready)).toBe(true);
    expect(evs.flatMap((e) => e.crumbled)).toHaveLength(1);
    expect(s.bodies.some((b) => b.mat === 'shot')).toBe(false);
    expect(s.phase).toBe('aim');
  });

  it('pops a blob that is dropped, breaks wood and cracks stone first', () => {
    const s = createLevel(1, new Rng(1));
    const blob = s.bodies.find((b) => b.mat === 'blob')!;
    // Dropped from high up, in the open.
    blob.x = 110;
    blob.y = GROUND - 80;
    blob.awake = true;
    s.phase = 'flight';
    const evs: StepEvents[] = [];
    for (let t = 0; t < 1.5; t += DT) evs.push(step(s, DT));
    expect(evs.flatMap((e) => e.popped).length).toBeGreaterThanOrEqual(1);
    expect(s.targets).toBeLessThan(targetsFor(1));

    const w = createLevel(5, new Rng(2));
    const wood = w.bodies.find((b) => b.mat === 'wood')!;
    const stone = w.bodies.find((b) => b.mat === 'stone')!;
    for (const b of [wood, stone]) {
      b.awake = true;
      b.vy = 420; // slammed into what is below
    }
    w.phase = 'flight';
    const hits: StepEvents[] = [];
    for (let i = 0; i < 3; i++) hits.push(step(w, 1 / 120));
    expect(hits.some((e) => e.broken.some((h) => h.mat === 'wood'))).toBe(true);
    expect(hits.some((e) => e.cracked.some((h) => h.mat === 'stone'))).toBe(true);
  });

  it('can clear every level by aiming well, for several seeds', () => {
    for (const d of LEVELS) {
      let best = 0;
      for (const seed of [1, 2, 3]) {
        const s = createLevel(d, new Rng(seed));
        while (s.phase !== 'done') {
          const [a, p] = bestShot(s);
          play(s, a, p);
        }
        expect(s.targets, `level ${d} seed ${seed}`).toBe(0);
        expect(s.used).toBeLessThanOrEqual(s.shots);
        best = Math.max(best, starsFor(sling, d, true, s.score));
      }
      // Three stars are within reach of a clean run.
      expect(best, `level ${d}`).toBe(3);
    }
  }, 120_000);

  it('loses when the stones run out with blobs left', () => {
    const s = createLevel(1, new Rng(4));
    let over = false;
    for (let i = 0; i < s.shots; i++) over = play(s, -0.5, 0).some((e) => e.over);
    expect(over).toBe(true);
    expect(s.phase).toBe('done');
    expect(s.targets).toBe(targetsFor(1));
    expect(fire(s)).toBe(false);
  });
});

describe('sling game', () => {
  it('waits at every level until a stone is flung, then fires on Space', () => {
    for (const d of LEVELS) {
      const m = mountGame(sling, d, 9);
      m.run(3);
      expect(m.outcome).toBe('');
      expect(m.status).toContain(`${targetsFor(d)} grumps left`);
      m.inst.onKey?.(new KeyboardEvent('keydown', { key: ' ' }));
      expect(m.status).toContain(`${shotsFor(d) - 1} stones`);
      m.run(10);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('has star goals above the blobs alone', () => {
    for (const d of LEVELS) {
      const [two, three] = sling.stars(d);
      expect(three).toBeGreaterThan(two);
      expect(two).toBeGreaterThan(targetsFor(d) * 100);
    }
  });
});
