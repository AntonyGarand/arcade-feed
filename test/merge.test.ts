import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { _setLocaleForTests } from '../src/core/i18n';
import { kindsAt } from '../src/core/variety';
import { merge } from '../src/games/merge';
import {
  aim,
  BLAST,
  CHAIN_TIERS,
  createLevel,
  drop,
  FLOOR,
  floorOf,
  grant,
  jarWidth,
  KINDS,
  LINE,
  mergePoints,
  RADII,
  RISE_S,
  step,
  targetFor,
  type KindId,
  type PieceType,
  type State,
} from '../src/games/merge/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * Drop onto the highest piece of the same size, else in a lane by size (small left, big right).
 * Wildcards go on the biggest fruit, bombs on a rock or the small fruit, rocks against the left wall.
 */
function chooseX(s: State): number {
  const fruit = s.bodies.filter((b) => b.type === 'fruit');
  if (s.currentType === 'wild') {
    const big = fruit.sort((a, b) => b.k - a.k || a.y - b.y)[0];
    if (big) return big.x;
  }
  if (s.currentType === 'bomb') {
    const rock = s.bodies.filter((b) => b.type === 'rock').sort((a, b) => a.y - b.y)[0];
    const small = fruit.filter((b) => b.k <= 1).sort((a, b) => a.y - b.y)[0];
    const at = rock ?? small;
    if (at) return at.x;
  }
  if (s.currentType === 'rock') return s.left;
  const same = fruit.filter((b) => b.k === s.current).sort((a, b) => a.y - b.y)[0];
  if (same) return same.x;
  const r = RADII[s.current];
  return s.left + r + ((s.right - s.left - 2 * r) * s.current) / (s.target - 1);
}

function autopilot(d: Difficulty, seed: number, kind?: KindId, wait = 0.8) {
  const s = createLevel(d, new Rng(seed), kind);
  let since = wait;
  const powers: string[] = [];
  for (let t = 0; t < 600; t += DT) {
    since += DT;
    if (since >= wait) {
      aim(s, chooseX(s));
      if (drop(s)) since = 0;
    }
    const ev = step(s, DT);
    if (ev.power) powers.push(ev.power);
    if (ev.won) return { s, win: true, powers };
    if (ev.lost) return { s, win: false, powers };
  }
  throw new Error('never ended');
}

/** Put a piece straight into the jar at (x, y). */
function place(s: State, k: number, type: PieceType, x: number, y = FLOOR - RADII[k]) {
  s.bodies.push({ x, y, px: x, py: y, k, type, age: 2 });
}

/** Run the physics for `t` seconds, collecting what happened. */
function settle(s: State, t: number) {
  const out = { merged: 0, blasts: 0, crumbled: 0, powers: [] as string[] };
  for (let x = 0; x < t; x += DT) {
    const ev = step(s, DT);
    out.merged += ev.merged ? 1 : 0;
    out.blasts += ev.blasts.length;
    out.crumbled += ev.crumbled.length;
    if (ev.power) out.powers.push(ev.power);
  }
  return out;
}

describe('merge rules', () => {
  it('deals the same kind and pieces from the same seed', () => {
    const a = createLevel(3, new Rng(4));
    const b = createLevel(3, new Rng(4));
    expect(a.kind).toBe(b.kind);
    const seq = (s: State) =>
      Array.from({ length: 20 }, () => {
        const k = `${s.currentType}${s.current}`;
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
    const s = createLevel(1, new Rng(1), 'classic');
    s.current = s.next = 1;
    s.currentType = s.nextType = 'fruit';
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
    const s = createLevel(1, new Rng(2), 'classic');
    const xs = [70, 120, 170, 210, 90, 150, 190];
    for (const [i, x] of xs.entries()) {
      s.current = i % 3;
      s.currentType = 'fruit';
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
      for (const r of runs.filter((x) => x.win)) expect(r.s.biggest).toBeGreaterThanOrEqual(targetFor(d));
    }
  });

  it('overflows when pieces pile above the line', () => {
    const s = createLevel(3, new Rng(5), 'classic');
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

describe('merge kinds and special pieces', () => {
  it('deals several kinds across seeds, each only from its level up', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    for (let seed = 0; seed < 30; seed++) expect(['classic', 'bombs', 'rainbow']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('every kind allowed at a level can be cleared by the simple strategy', () => {
    for (const d of [2, 3, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const runs = [1, 2, 3, 4].map((seed) => autopilot(d, seed * 7 + d, id));
        expect(runs.filter((r) => r.win).length, `${id} ${d}`).toBeGreaterThanOrEqual(3);
        // Comparable scores: every kind's clears land around the star goals.
        for (const r of runs.filter((x) => x.win)) expect(r.s.score, `${id} ${d}`).toBeGreaterThanOrEqual(merge.stars(d)[0] * 0.6);
      }
  });

  it('deals special pieces by kind', () => {
    const types = (k: KindId) => {
      const out = new Set<string>();
      for (let seed = 0; seed < 4; seed++) {
        const s = createLevel(3, new Rng(seed), k);
        for (let i = 0; i < 60; i++) {
          out.add(s.currentType);
          s.cooldown = 0;
          drop(s);
        }
      }
      return out;
    };
    expect(types('rocks').has('rock')).toBe(true);
    expect(types('bombs').has('bomb')).toBe(true);
    expect(types('rainbow').has('wild')).toBe(true);
    expect(types('classic').has('bomb')).toBe(false);
    expect(types('classic').has('rock')).toBe(false);
    expect(createLevel(2, new Rng(1), 'rocks').bodies.filter((b) => b.type === 'rock').length).toBe(2);
    expect(createLevel(2, new Rng(1), 'narrow').right - createLevel(2, new Rng(1), 'narrow').left).toBeLessThan(jarWidth(2));
  });

  it('a wildcard merges with any fruit and grows it a size', () => {
    const s = createLevel(2, new Rng(3), 'classic');
    place(s, 3, 'fruit', 140);
    place(s, 1, 'wild', 140, FLOOR - 2 * RADII[3] - RADII[1] - 1);
    settle(s, 1);
    expect(s.bodies.map((b) => `${b.type}${b.k}`)).toEqual(['fruit4']);
    expect(s.score).toBe(mergePoints(4));
  });

  it('rocks never merge, and crumble next to a merge', () => {
    const s = createLevel(2, new Rng(3), 'classic');
    place(s, 2, 'rock', 80);
    place(s, 2, 'rock', 80 + 2 * RADII[2]);
    settle(s, 1);
    expect(s.bodies.length).toBe(2);
    place(s, 1, 'fruit', 80 + 3 * RADII[2] + RADII[1]);
    place(s, 1, 'fruit', 80 + 3 * RADII[2] + RADII[1], FLOOR - 3 * RADII[1] - 1);
    const out = settle(s, 1);
    expect(out.merged).toBeGreaterThan(0);
    expect(out.crumbled).toBeGreaterThan(0);
    expect(s.bodies.filter((b) => b.type === 'rock').length).toBeLessThan(2);
  });

  it('a bomb clears the small fruit and rocks around it, never the big fruit', () => {
    const s = createLevel(2, new Rng(3), 'classic');
    place(s, 0, 'fruit', 100);
    place(s, 2, 'rock', 140);
    place(s, 5, 'fruit', 140 + RADII[2] + RADII[5]);
    place(s, 1, 'bomb', 120, FLOOR - 60);
    const out = settle(s, 1);
    expect(out.blasts).toBe(1);
    expect(s.bodies.map((b) => `${b.type}${b.k}`)).toEqual(['fruit5']);
    expect(BLAST).toBeGreaterThan(RADII[2] * 2);
  });

  it('a rising floor climbs over time and sinks back with a big merge', () => {
    const s = createLevel(3, new Rng(3), 'rising');
    settle(s, RISE_S * 3 + 0.1);
    const lift = FLOOR - floorOf(s);
    expect(lift).toBeGreaterThan(0);
    place(s, 3, 'fruit', 100, floorOf(s) - RADII[3]);
    place(s, 3, 'fruit', 100 + 2 * RADII[3], floorOf(s) - RADII[3]);
    settle(s, 0.5);
    expect(FLOOR - floorOf(s)).toBeLessThan(lift);
    expect(createLevel(3, new Rng(3), 'classic').lift).toBe(0);
  });

  it('a chain of quick merges hands over a wildcard, then tidies the jar, then grows the small fruit', () => {
    const s = createLevel(4, new Rng(3), 'classic');
    const powers: string[] = [];
    /** Pairs of small fruit, far apart, merging one after another. */
    const pairs = (n: number) => {
      for (let k = 0; k < n; k++) {
        const x = s.left + RADII[0] + k * (4 * RADII[0] + 4);
        place(s, 0, 'fruit', x);
        place(s, 0, 'fruit', x + 2 * RADII[0]);
        powers.push(...settle(s, 0.2).powers);
      }
    };
    pairs(CHAIN_TIERS[0]);
    expect(powers).toEqual(['wild']);
    expect(s.nextType).toBe('wild');
    // The chain goes on: a rock is in the jar when the tidy-up comes.
    s.bodies = [];
    place(s, 2, 'rock', s.right - RADII[2]);
    pairs(CHAIN_TIERS[1] - CHAIN_TIERS[0]);
    expect(powers).toEqual(['wild', 'tidy']);
    expect(s.bodies.length).toBe(0); // the rock and the small fruit popped
    s.bodies = [];
    pairs(CHAIN_TIERS[2] - CHAIN_TIERS[1]);
    expect(powers).toEqual(['wild', 'tidy', 'grow']);
    expect(s.bodies.every((b) => b.k === 2)).toBe(true);
    // A pause ends the chain.
    settle(s, 1.5);
    expect(s.chain).toBe(0);
    grant(s, 'wild');
    expect(s.nextType).toBe('wild');
  });
});

describe('merge game', () => {
  it('names its kind on the start gate (in both languages) and plays until the jar overflows', () => {
    for (const locale of ['en', 'fr'] as const) {
      _setLocaleForTests(locale);
      for (let seed = 0; seed < 30; seed++) {
        const m = mountGame(merge, 4, seed);
        expect(m.variant?.id).toBe(createLevel(4, new Rng(seed)).kind);
        expect(m.variant!.name.length).toBeLessThanOrEqual(18);
        expect(m.variant!.blurb!.length, m.variant!.blurb).toBeLessThanOrEqual(60);
        m.inst.destroy?.();
        m.root.remove();
      }
    }
    _setLocaleForTests('en');
    const m = mountGame(merge, 2, 5);
    for (let i = 0; i < 400 && !m.outcome; i++) {
      m.inst.onKey?.(new KeyboardEvent('keydown', { key: ' ' }));
      m.run(0.5);
    }
    expect(m.outcome).not.toBe('');
    m.inst.destroy?.();
    m.root.remove();
  });
});
