import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { crossing } from '../src/games/crossing';
import {
  createLevel,
  hazard,
  homesFor,
  hop,
  HOP_S,
  itemX,
  LIVES,
  paceFor,
  riverFor,
  roadFor,
  route,
  SLOTS,
  START_ROW,
  step,
  SUBSTEPS,
  type State,
} from '../src/games/crossing/rules';
import { mountGame } from './support/mount';

const SUB = HOP_S / SUBSTEPS;
const KEYS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];

/** One hop slot: the action, then the solver's substeps. */
function slot(s: State, a: number) {
  if (a !== -1) hop(s, a as 0 | 1 | 2 | 3);
  let died = false;
  for (let j = 0; j < SUBSTEPS && !s.done; j++) died = step(s, SUB).died || died;
  return died;
}

/** Follow the solver's plan, hopping at most every `every` slots (1 = perfect reflexes). */
function autopilot(d: Difficulty, seed: number, every: number) {
  const s = createLevel(d, new Rng(seed));
  let deaths = 0;
  let won = false;
  while (!s.done) {
    const plan = route(s.lanes, s.filled, s.row, s.x, s.time, 30, every) ?? [-1];
    for (const a of plan) {
      if (a !== -1 && hop(s, a) === 'win') won = true;
      if (s.done) break;
      if (slot(s, -1)) deaths++;
    }
  }
  return { s, won, deaths };
}

describe('crossing rules', () => {
  it('deals the same lanes from the same seed, and other lanes from another', () => {
    expect(createLevel(3, new Rng(5)).lanes).toEqual(createLevel(3, new Rng(5)).lanes);
    expect(createLevel(3, new Rng(5)).lanes).not.toEqual(createLevel(3, new Rng(6)).lanes);
  });

  it('gets harder: more lanes, faster traffic, shorter logs, more homes', () => {
    const logs = (d: Difficulty) => {
      const lens = [1, 2, 3, 4].flatMap((seed) =>
        createLevel(d, new Rng(seed))
          .lanes.filter((l) => l.kind === 'river')
          .flatMap((l) => l.items.map((i) => i.len)),
      );
      return lens.reduce((a, b) => a + b, 0) / lens.length;
    };
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(riverFor(d) + roadFor(d)).toBeGreaterThanOrEqual(riverFor(lo) + roadFor(lo));
      expect(paceFor(d)).toBeGreaterThan(paceFor(lo));
      expect(homesFor(d)).toBeGreaterThanOrEqual(homesFor(lo));
      expect(logs(d)).toBeLessThan(logs(lo));
    }
    expect(riverFor(5) + roadFor(5)).toBeGreaterThan(riverFor(1) + roadFor(1));
    const lanes = createLevel(5, new Rng(1)).lanes;
    expect(lanes.filter((l) => l.kind === 'river' || l.kind === 'road').length).toBe(10);
  });

  it('keeps every home slot within reach of a player hopping every 0.3 s', () => {
    for (const d of LEVELS)
      for (let seed = 20; seed < 24; seed++) {
        const s = createLevel(d, new Rng(seed));
        for (let k = 0; k < SLOTS.length; k++) {
          const filled = SLOTS.map((_, j) => j !== k);
          expect(route(s.lanes, filled, START_ROW, 4, 0, 20, 2), `${d}/${seed}/${k}`).not.toBeNull();
        }
      }
  });

  it('carries the hopper on a log and drowns it in the water', () => {
    const s = createLevel(1, new Rng(3));
    const river = s.lanes.findIndex((l) => l.kind === 'river');
    expect(hazard(s.lanes, river, -2, 0)).toBe(true); // off the edge
    expect(hazard(s.lanes, START_ROW, 4, 0)).toBe(false);
    const lane = s.lanes[river];
    s.row = river;
    // Stand in the middle of the first log on screen.
    const mid = lane.items.map((i) => itemX(lane, i, 0) + i.len / 2 - 0.5).find((x) => x > 0 && x < 8)!;
    s.x = mid;
    const x0 = s.x;
    step(s, 0.1);
    expect(s.x).toBeCloseTo(x0 + lane.speed * 0.1);
    expect(s.lives).toBe(LIVES);
  });

  it('is cleared by the solver at every level, with stars matching the pace', () => {
    for (const d of LEVELS) {
      const [two, three] = crossing.stars(d);
      for (const seed of [1, 2, 3]) {
        const fast = autopilot(d, seed, 1);
        expect(fast.won, `fast ${d}/${seed}`).toBe(true);
        expect(fast.deaths).toBe(0);
        expect(fast.s.homes).toBe(homesFor(d));
        expect(fast.s.score, `fast ${d}/${seed}`).toBeGreaterThanOrEqual(three);
        const steady = autopilot(d, seed, 3);
        expect(steady.won, `steady ${d}/${seed}`).toBe(true);
        expect(steady.s.score, `steady ${d}/${seed}`).toBeGreaterThanOrEqual(two);
        expect(steady.s.score, `steady ${d}/${seed}`).toBeLessThan(three);
      }
    }
  });

  it('loses on running out of time, or out of lives by hopping blindly', () => {
    const idle = createLevel(2, new Rng(4));
    while (!idle.done) slot(idle, -1);
    expect(idle.lives).toBe(LIVES);
    expect(idle.homes).toBe(0);

    const reckless = createLevel(5, new Rng(4));
    while (!reckless.done) slot(reckless, 0);
    expect(reckless.lives).toBe(0);
    expect(reckless.time).toBeLessThan(reckless.limit);
  });
});

describe('crossing game', () => {
  it('mounts, counts down and reports score, lives and status', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(crossing, d, 9);
      expect(m.lives).toEqual([LIVES, LIVES]);
      expect(m.status).toContain(`0/${homesFor(d)}`);
      m.run(2);
      expect(m.outcome).toBe('');
      m.inst.onKey?.(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(m.score).toBeGreaterThan(0);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is won with the arrow keys following the solver', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(crossing, d, 11);
      const s = createLevel(d, new Rng(11)); // the same level, to plan on
      while (!s.done) {
        const plan = route(s.lanes, s.filled, s.row, s.x, s.time, 30, 2) ?? [-1];
        for (const a of plan) {
          if (a !== -1) {
            m.inst.onKey?.(new KeyboardEvent('keydown', { key: KEYS[a] }));
            m.inst.onKey?.(new KeyboardEvent('keyup', { key: KEYS[a] }));
          }
          slot(s, a);
          for (let j = 0; j < SUBSTEPS && !m.outcome; j++) m.inst.frame?.(SUB);
          if (s.done) break;
        }
      }
      expect(m.outcome).toBe('win');
      expect(m.score).toBe(s.score);
      expect(m.score).toBeGreaterThanOrEqual(crossing.stars(d)[0]);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is lost when the clock runs out', () => {
    const m = mountGame(crossing, 1, 3);
    m.run(60);
    expect(m.outcome).toBe('lose');
    m.inst.destroy?.();
    m.root.remove();
  });
});
