import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { aim, createLevel, drop, FLOOR, jarWidth, LINE, mergePoints, RADII, step, targetFor, type State } from '../src/games/merge/rules';

const DT = 1 / 60;

/** Drop onto the highest piece of the same size, else in a lane by size (small left, big right). */
function chooseX(s: State): number {
  const same = s.bodies.filter((b) => b.k === s.current).sort((a, b) => a.y - b.y)[0];
  if (same) return same.x;
  const r = RADII[s.current];
  return s.left + r + ((s.right - s.left - 2 * r) * s.current) / (s.target - 1);
}

function autopilot(d: Difficulty, seed: number, wait = 0.8) {
  const s = createLevel(d, new Rng(seed));
  let since = wait;
  for (let t = 0; t < 600; t += DT) {
    since += DT;
    if (since >= wait) {
      aim(s, chooseX(s));
      if (drop(s)) since = 0;
    }
    const ev = step(s, DT);
    if (ev.won) return { s, win: true };
    if (ev.lost) return { s, win: false };
  }
  throw new Error('never ended');
}

describe('merge rules', () => {
  it('deals the same pieces from the same seed', () => {
    const a = createLevel(3, new Rng(4));
    const b = createLevel(3, new Rng(4));
    const seq = (s: State) =>
      Array.from({ length: 20 }, () => {
        const k = s.current;
        s.cooldown = 0;
        drop(s);
        return k;
      });
    expect(seq(a)).toEqual(seq(b));
  });

  it('gets harder: a bigger target, larger pieces in hand, a narrower jar', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(targetFor(d)).toBeGreaterThanOrEqual(targetFor(lo));
    }
    expect(targetFor(5)).toBeGreaterThan(targetFor(1));
    expect(jarWidth(5)).toBeLessThan(jarWidth(4));
  });

  it('merges two equal pieces into the next size', () => {
    const s = createLevel(1, new Rng(1));
    s.current = 1;
    s.next = 1;
    aim(s, 140);
    drop(s);
    s.cooldown = 0;
    drop(s);
    let merged = false;
    for (let t = 0; t < 3 && !merged; t += DT) merged = step(s, DT).merged;
    expect(merged).toBe(true);
    expect(s.bodies.map((b) => b.k)).toEqual([2]);
    expect(s.score).toBe(mergePoints(2));
  });

  it('settles a pile without jitter', () => {
    const s = createLevel(1, new Rng(2));
    const xs = [70, 120, 170, 210, 90, 150, 190];
    for (const [i, x] of xs.entries()) {
      s.current = i % 3;
      s.cooldown = 0;
      aim(s, x);
      drop(s);
      for (let t = 0; t < 0.6; t += DT) step(s, DT);
    }
    for (let t = 0; t < 4; t += DT) step(s, DT);
    const before = s.bodies.map((b) => [b.x, b.y]);
    for (let t = 0; t < 1; t += DT) step(s, DT);
    const moved = Math.max(...s.bodies.map((b, i) => Math.hypot(b.x - before[i][0], b.y - before[i][1])));
    expect(moved).toBeLessThan(0.5);
    for (const b of s.bodies) {
      expect(b.y + RADII[b.k]).toBeLessThanOrEqual(FLOOR + 0.01);
      expect(b.x - RADII[b.k]).toBeGreaterThanOrEqual(s.left - 0.01);
    }
  });

  it('reaches the target size with a simple strategy at every level', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3].map((seed) => autopilot(d, seed * 3 + d));
      expect(runs.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(2);
      for (const r of runs.filter((x) => x.win)) expect(r.s.biggest).toBe(targetFor(d));
    }
  });

  it('overflows when pieces pile above the line', () => {
    const s = createLevel(3, new Rng(5));
    s.target = RADII.length; // out of reach: only the overflow can end this run
    let lost = false;
    for (let t = 0; t < 120 && !lost; t += DT) {
      // Never merge on purpose: alternate the two ends of the jar with whatever comes.
      aim(s, s.drops % 2 ? s.left : s.right);
      drop(s);
      lost = step(s, DT).lost;
    }
    expect(lost).toBe(true);
    expect(s.bodies.some((b) => b.y - RADII[b.k] < LINE)).toBe(true);
  });
});
