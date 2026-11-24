import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { tower } from '../src/games/tower';
import { _setLocaleForTests } from '../src/core/i18n';
import { kindsAt } from '../src/core/variety';
import {
  BLOCK_POINTS,
  createLevel,
  GOLD_POINTS,
  drop,
  goalFor,
  height,
  KINDS,
  landX,
  POWER_FLOORS,
  SLIP,
  speedFor,
  step,
  STREAK_TIERS,
  tolerance,
  type KindId,
  W,
  type State,
} from '../src/games/tower/rules';
import { mountGame } from './support/mount';

const DT = 1 / 240;

/** Roughly normal noise in [-1.5, 1.5] × sd. */
const noise = (r: Rng, sd: number) => (r.next() + r.next() + r.next() - 1.5) * sd * 2;

/**
 * Play like a person whose timing is off by about `sd` seconds: drop as the slider passes the spot
 * above the tower, shifted by that error.
 */
function autopilot(d: Difficulty, seed: number, sd: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const hand = new Rng(seed * 7 + 1);
  let err = noise(hand, sd);
  /** Where the sliding block's left edge should land: centred on the block below. */
  const aim = () => {
    const t = s.blocks.at(-1)!;
    return t.x + t.w / 2 - s.w / 2;
  };
  for (let t = 0; t < 600 && !s.done; t += DT) {
    const target = aim() + s.v * err;
    const before = landX(s);
    step(s, DT);
    const after = landX(s);
    // Crossed the aim point this step (moving either way).
    if ((before - target) * (after - target) <= 0 && Math.sign(after - before) === Math.sign(s.v)) {
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
      // At Easy a steady hand is nearly as sharp as a sharp one; above it, three stars need a sharp one.
      expect(decent.filter((r) => stars(r) === 3).length, `level ${d}`).toBeLessThanOrEqual(d === 1 ? 5 : 2);
      expect(sloppy.filter((r) => stars(r) === 3).length, `level ${d}`).toBe(0);
      for (const r of decent.filter((x) => x.win)) expect(r.s.score).toBeGreaterThanOrEqual(goalFor(d) * BLOCK_POINTS);
    }
  });
});

describe('tower kinds', () => {
  it('deals the same kind and floors from the same seed, and several kinds across seeds', () => {
    const a = createLevel(4, new Rng(12));
    const b = createLevel(4, new Rng(12));
    expect(a.kind).toBe(b.kind);
    expect(a.traits).toEqual(b.traits);
    expect(a.winds).toEqual(b.winds);
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(new Set(Array.from({ length: 40 }, (_, k) => createLevel(1, new Rng(k)).kind))).toEqual(new Set(['classic', 'crane']));
  });

  it('every kind allowed at a level can be built by a sharp hand, and mostly by a steady one', () => {
    for (const d of [2, 3, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const sharp = SEEDS.map((k) => autopilot(d, k * 5 + d, 0.012, id));
        const decent = SEEDS.map((k) => autopilot(d, k * 5 + d, 0.03, id));
        expect(
          sharp.every((r) => r.win),
          `${id} ${d}`,
        ).toBe(true);
        expect(decent.filter((r) => r.win).length, `${id} ${d}`).toBeGreaterThanOrEqual(4);
        // Comparable scores: a sharp hand earns three stars on every kind.
        expect(sharp.filter((r) => r.s.score >= tower.stars(d)[1]).length, `${id} ${d}`).toBeGreaterThanOrEqual(4);
      }
  });

  it('deals special blocks by kind: icy and heavy only on their own levels', () => {
    const traits = (k: KindId) => new Set(SEEDS.flatMap((seed) => createLevel(4, new Rng(seed), k).traits));
    expect(traits('ice').has('ice')).toBe(true);
    expect(traits('heavy').has('heavy')).toBe(true);
    expect(traits('classic').has('gold')).toBe(true);
    expect(traits('classic').has('ice')).toBe(false);
    expect(createLevel(5, new Rng(1), 'windy').winds.some((w) => Math.abs(w) >= 0.5)).toBe(true);
    expect(createLevel(5, new Rng(1), 'classic').winds.every((w) => w === 0)).toBe(true);
  });

  it('icy blocks skid on, heavy ones pay double, golden ones pay a perfect', () => {
    const s = createLevel(3, new Rng(2), 'classic');
    s.trait = 'ice';
    s.x = 40;
    s.v = 100;
    expect(landX(s)).toBe(40 + SLIP);
    s.v = -100;
    expect(landX(s)).toBe(40 - SLIP);
    // A heavy block landing off-centre: two blocks' worth.
    const t = s.blocks[0];
    s.trait = 'heavy';
    s.x = t.x + 20;
    expect(drop(s)?.points).toBe(BLOCK_POINTS * 2);
    // A perfect on a golden block.
    s.blocks.at(-1)!.trait = 'gold';
    s.trait = 'plain';
    s.x = s.blocks.at(-1)!.x;
    const r = drop(s)!;
    expect(r.kind).toBe('perfect');
    expect(r.gold).toBe(true);
    expect(r.points).toBe(BLOCK_POINTS + 10 + GOLD_POINTS);
    expect(r.grew).toBe(true);
  });

  it('a long perfect streak rebuilds the block, then slows the crane, then turns on the magnet', () => {
    const s = createLevel(5, new Rng(3), 'classic');
    s.x = s.blocks[0].x + 30; // a sloppy first drop leaves room to grow back
    drop(s);
    const seen: { power: string; tier: number; grew: boolean; slow: number; tol: number }[] = [];
    let speed = 0;
    for (let i = 0; i < STREAK_TIERS[2]; i++) {
      const t = s.blocks.at(-1)!;
      s.trait = 'plain';
      s.x = t.x + (t.w - s.w) / 2;
      const w = s.w;
      const r = drop(s)!;
      expect(r.kind).toBe('perfect');
      step(s, 1 / 60);
      if (r.power) {
        seen.push({ power: r.power, tier: r.tier, grew: s.w > w, slow: s.slow, tol: tolerance(s) / s.tol });
        if (r.power === 'slow') speed = Math.abs(s.v);
      }
    }
    const powers = seen.map((x) => x.power);
    expect(seen.map((x) => x.tier)).toEqual([1, 2, 3]);
    expect(seen[0].grew).toBe(true);
    expect(seen[1].slow).toBe(POWER_FLOORS);
    expect(seen[2].tol).toBeGreaterThan(1.5);
    expect(powers).toEqual(['wide', 'slow', 'magnet']);
    expect(speed).toBeLessThan(speedFor(5));
    // A miss of the centre ends the streak, and its milestones start over.
    s.x = s.blocks.at(-1)!.x + 25;
    drop(s);
    expect(s.streak).toBe(0);
    expect(s.tier).toBe(0);
  });

  it('shrinking blocks melt while they slide; the crane swings fastest through the middle', () => {
    const s = createLevel(3, new Rng(4), 'shrink');
    const w = s.w;
    for (let i = 0; i < 60; i++) step(s, 1 / 60);
    expect(s.w).toBeLessThan(w);
    expect(s.w).toBeGreaterThan(w * 0.8);
    const c = createLevel(3, new Rng(4), 'crane');
    let edge = Infinity;
    let mid = 0;
    for (let i = 0; i < 600; i++) {
      step(c, 1 / 120);
      const centre = Math.abs(c.x + c.w / 2 - W / 2);
      if (centre < 10) mid = Math.max(mid, Math.abs(c.v));
      if (centre > (W - c.w) / 2 - 3) edge = Math.min(edge, Math.abs(c.v));
    }
    expect(mid).toBeGreaterThan(edge * 3);
  });
});

describe('tower game', () => {
  it('names its kind on the start gate, in both languages', () => {
    for (const locale of ['en', 'fr'] as const) {
      _setLocaleForTests(locale);
      for (let seed = 0; seed < 30; seed++) {
        const m = mountGame(tower, 4, seed);
        expect(m.variant?.id).toBe(createLevel(4, new Rng(seed)).kind);
        expect(m.variant!.name.length).toBeLessThanOrEqual(18);
        expect(m.variant!.blurb!.length, m.variant!.blurb).toBeLessThanOrEqual(60);
        m.inst.destroy?.();
        m.root.remove();
      }
    }
    _setLocaleForTests('en');
  });

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
      for (let t = 0; t < 3; t += 1 / 60) step(twin, 1 / 60); // the same frames as m.run(3)
      for (let f = 0; f < 60 * 120 && !m.outcome; f++) {
        m.inst.frame?.(1 / 60);
        step(twin, 1 / 60);
        const t = twin.blocks.at(-1)!;
        if (Math.abs(landX(twin) + twin.w / 2 - t.x - t.w / 2) < tolerance(twin) * 0.6) {
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
