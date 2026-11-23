import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { tower } from '../src/games/tower';
import { BLOCK_POINTS, createLevel, drop, goalFor, height, speedFor, step, type State } from '../src/games/tower/rules';
import { mountGame } from './support/mount';

const DT = 1 / 240;

/** Roughly normal noise in [-1.5, 1.5] × sd. */
const noise = (r: Rng, sd: number) => (r.next() + r.next() + r.next() - 1.5) * sd * 2;

/**
 * Play like a person whose timing is off by about `sd` seconds: drop as the slider passes the spot
 * above the tower, shifted by that error.
 */
function autopilot(d: Difficulty, seed: number, sd: number) {
  const s = createLevel(d, new Rng(seed));
  const hand = new Rng(seed * 7 + 1);
  let err = noise(hand, sd);
  for (let t = 0; t < 600 && !s.done; t += DT) {
    const target = s.blocks.at(-1)!.x + s.v * err;
    const before = s.x;
    step(s, DT);
    // Crossed the aim point this step (moving either way).
    if ((before - target) * (s.x - target) <= 0 && Math.sign(s.x - before) === Math.sign(s.v)) {
      drop(s);
      err = noise(hand, sd);
    }
  }
  return { s, win: height(s) >= s.goal };
}

const SEEDS = [1, 2, 3, 4, 5, 6];

describe('tower rules', () => {
  it('deals the same tower from the same seed', () => {
    const a = createLevel(5, new Rng(9));
    const b = createLevel(5, new Rng(9));
    expect(a.blocks).toEqual(b.blocks);
    expect(createLevel(5, new Rng(10)).blocks).not.toEqual(a.blocks);
  });

  it('gets harder: a taller goal, a narrower base and a faster slider', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(1));
      const hi = createLevel(d, new Rng(1));
      expect(hi.goal).toBeGreaterThan(lo.goal);
      expect(hi.baseW).toBeLessThan(lo.baseW);
      expect(speedFor(d)).toBeGreaterThan(speedFor((d - 1) as Difficulty));
      expect(hi.tol).toBeLessThan(lo.tol);
    }
  });

  it('keeps the full width on a perfect drop and slices the overhang otherwise', () => {
    const s = createLevel(1, new Rng(3));
    const base = s.blocks[0];
    s.x = base.x + 2;
    expect(drop(s)?.kind).toBe('perfect');
    expect(s.blocks[1]).toMatchObject({ x: base.x, w: base.w });
    s.x = base.x + 30;
    const r = drop(s)!;
    expect(r.kind).toBe('cut');
    expect(r.cut).toBeCloseTo(30);
    expect(s.blocks[2].w).toBeCloseTo(base.w - 30);
    expect(s.chunks.length).toBe(1);
    expect(s.score).toBe(BLOCK_POINTS * 2 + 10);
  });

  it('grows the block back after a streak of perfects', () => {
    const s = createLevel(2, new Rng(4));
    s.x = s.blocks[0].x + 20;
    drop(s);
    const w = s.w;
    for (let i = 0; i < 3; i++) {
      s.x = s.blocks.at(-1)!.x;
      drop(s);
    }
    expect(s.w).toBeGreaterThan(w);
  });

  it('ends the run when a block misses the tower', () => {
    const s = createLevel(3, new Rng(5));
    const t = s.blocks[0];
    s.x = t.x + t.w + 5;
    const r = drop(s)!;
    expect(r.over).toBe(true);
    expect(s.done).toBe(true);
    expect(drop(s)).toBeNull();
  });

  it('is cleared at every level by a steady hand, and three stars need a sharp one', () => {
    for (const d of LEVELS) {
      const decent = SEEDS.map((k) => autopilot(d, k * 11 + d, 0.03));
      const sharp = SEEDS.map((k) => autopilot(d, k * 11 + d, 0.012));
      const sloppy = SEEDS.map((k) => autopilot(d, k * 11 + d, 0.06));
      const stars = (r: { s: State; win: boolean }) => starsFor(tower, d, r.win, r.s.score);
      expect(decent.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(5);
      expect(
        sharp.every((r) => r.win),
        `level ${d}`,
      ).toBe(true);
      expect(sharp.filter((r) => stars(r) === 3).length, `level ${d}`).toBeGreaterThanOrEqual(4);
      expect(decent.filter((r) => stars(r) === 3).length, `level ${d}`).toBeLessThanOrEqual(2);
      expect(sloppy.filter((r) => stars(r) === 3).length, `level ${d}`).toBe(0);
      for (const r of decent.filter((x) => x.win)) expect(r.s.score).toBeGreaterThanOrEqual(goalFor(d) * BLOCK_POINTS);
    }
  });
});

describe('tower game', () => {
  const space = (m: ReturnType<typeof mountGame>) => {
    m.inst.onKey?.(new KeyboardEvent('keydown', { key: ' ' }));
    m.inst.onKey?.(new KeyboardEvent('keyup', { key: ' ' }));
  };

  it('mounts, reports, and builds to the flag with Space', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(tower, d, 3);
      expect(m.status).toContain(`0/${goalFor(d)}`);
      m.run(3);
      expect(m.outcome).toBe('');
      // A twin of the level, stepped in lockstep, tells when the slider sits right above the tower.
      const twin = createLevel(d, new Rng(3));
      for (let i = 0; i < 180; i++) step(twin, 1 / 60);
      for (let f = 0; f < 60 * 120 && !m.outcome; f++) {
        m.inst.frame?.(1 / 60);
        step(twin, 1 / 60);
        if (Math.abs(twin.x - twin.blocks.at(-1)!.x) < twin.tol * 0.6) {
          space(m);
          drop(twin);
        }
      }
      expect(m.outcome).toBe('win');
      expect(m.score).toBe(twin.score);
      expect(m.score).toBeGreaterThanOrEqual(tower.stars(d)[1]);
      expect(m.status).toContain(`${goalFor(d)}/${goalFor(d)}`);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is lost when a block misses the tower', () => {
    const m = mountGame(tower, 4, 8);
    for (let i = 0; i < 40 && !m.outcome; i++) {
      m.run(0.37);
      space(m);
    }
    expect(m.outcome).toBe('lose');
    m.inst.destroy?.();
    m.root.remove();
  });
});
