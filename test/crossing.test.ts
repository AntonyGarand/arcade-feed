import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { crossing } from '../src/games/crossing';
import {
  createLevel,
  grant,
  sunk,
  KINDS,
  STREAK_WINDOW,
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
  type KindId,
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

/**
 * Follow the solver's plan, hopping at most every `every` slots (1 = perfect reflexes). A streak
 * reward (frozen traffic) changes the world, so it plans again right after one.
 */
function autopilot(d: Difficulty, seed: number, every: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  let deaths = 0;
  let won = false;
  const rewards: string[] = [];
  while (!s.done) {
    const plan = route(s.lanes, s.filled, s.row, s.x, s.clock, 30, every, s.freeze) ?? [-1];
    for (const a of plan) {
      if (a !== -1 && hop(s, a) === 'win') won = true;
      if (s.done) break;
      if (slot(s, -1)) deaths++;
      if (s.reward && a !== -1) {
        rewards.push(s.reward);
        break;
      }
    }
  }
  return { s, won, deaths, rewards };
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

  it('deals the same kind from the same seed, and different kinds across seeds', () => {
    expect(createLevel(4, new Rng(8)).kind).toBe(createLevel(4, new Rng(8)).kind);
    const seen = new Set<string>();
    for (let seed = 0; seed < 24; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    const easy = kindsAt(1, KINDS).map((k) => k.id);
    for (let seed = 0; seed < 8; seed++) expect(easy).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('fills the lanes by kind: trains, turtles, rush hour, flood', () => {
    const types = (kind: KindId) =>
      new Set(createLevel(4, new Rng(3), kind).lanes.flatMap((l) => l.items.map((i) => (l.rail ? 'rail' : i.type))));
    expect(types('railway').has('rail')).toBe(true);
    expect(types('turtles').has('turtle')).toBe(true);
    expect(types('classic').has('turtle')).toBe(false);
    const roads = (kind: KindId) => createLevel(3, new Rng(3), kind).lanes.filter((l) => l.kind === 'road').length;
    expect(roads('rush')).toBe(5);
    expect(roads('flood')).toBeLessThan(roads('classic'));
  });

  it('diving turtles and crocodile jaws drown the hopper; their backs carry it', () => {
    const s = createLevel(4, new Rng(2), 'turtles');
    const row = s.lanes.findIndex((l) => l.items.some((i) => i.dive != null));
    const lane = s.lanes[row];
    const group = lane.items.find((i) => i.dive != null)!;
    // A moment it's on screen and up, and one it's on screen and under.
    const on = (t: number) => itemX(lane, group, t) + group.len / 2 - 0.5;
    const times = Array.from({ length: 1200 }, (_, k) => k * 0.05).filter((t) => on(t) > 0.5 && on(t) < 7.5);
    const up = times.find((t) => sunk(group, t) === 0)!;
    const under = times.find((t) => sunk(group, t) === 1)!;
    expect(hazard(s.lanes, row, on(up), up)).toBe(false);
    expect(hazard(s.lanes, row, on(under), under)).toBe(true);

    const croc = { kind: 'river' as const, speed: 1, period: 20, items: [{ x0: 4, len: 3.4, tone: 0, type: 'croc' as const }] };
    const lanes = [croc];
    // At t = 0 it spans 0 to 3.4 (x0 4 minus the margin); it swims right, so its jaws are on the right.
    expect(hazard(lanes, 0, 0, 0)).toBe(false);
    expect(hazard(lanes, 0, 2.5, 0)).toBe(true);
  });

  it('every kind can be cleared at every level it is dealt, at both paces, with fitting stars', () => {
    for (const d of [2, 5] as const) {
      const [two, three] = crossing.stars(d);
      for (const { id } of kindsAt(d, KINDS))
        for (const seed of [4, 5]) {
          const fast = autopilot(d, seed, 1, id);
          expect(fast.won, `fast ${id} ${d}/${seed}`).toBe(true);
          expect(fast.deaths, `fast ${id} ${d}/${seed}`).toBe(0);
          expect(fast.s.score, `fast ${id} ${d}/${seed}`).toBeGreaterThanOrEqual(three);
          const steady = autopilot(d, seed, 3, id);
          expect(steady.won, `steady ${id} ${d}/${seed}`).toBe(true);
          expect(steady.s.score, `steady ${id} ${d}/${seed}`).toBeGreaterThanOrEqual(two);
        }
    }
  });

  it('quick forward hops build a streak: frozen traffic, then a shield, then a longer freeze', () => {
    const s = createLevel(2, new Rng(7), 'classic');
    // An open meadow, to hop forward freely.
    for (let r = 1; r < START_ROW; r++) s.lanes[r] = { kind: 'grass', speed: 0, period: 1, items: [] };
    const rewards: string[] = [];
    for (let i = 0; i < 40 && rewards.length < 3; i++) {
      hop(s, 0);
      if (s.reward) rewards.push(s.reward);
      step(s, HOP_S);
    }
    expect(rewards).toEqual(['freeze', 'shield', 'bigFreeze']);
    expect(s.shield).toBe(true);
    expect(s.freeze).toBeGreaterThan(0);
    // Frozen: the lane clock stands still while time runs.
    const clock = s.clock;
    step(s, 0.5);
    expect(s.clock).toBe(clock);
    // Waiting too long ends the streak.
    for (let t = 0; t < STREAK_WINDOW + 0.1; t += 0.1) step(s, 0.1);
    expect(s.streak).toBe(0);
  });

  it('a shield takes a hit without costing a heart', () => {
    const s = createLevel(1, new Rng(3), 'classic');
    grant(s, 'shield');
    s.row = s.lanes.findIndex((l) => l.kind === 'river');
    s.x = -2;
    const ev = step(s, 0.05);
    expect(ev.died).toBe(true);
    expect(ev.shielded).toBe(true);
    expect(s.lives).toBe(LIVES);
    expect(s.shield).toBe(false);
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
      expect(m.variant?.id).toBe(createLevel(d, new Rng(9)).kind);
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
        const plan = route(s.lanes, s.filled, s.row, s.x, s.clock, 30, 2, s.freeze) ?? [-1];
        for (const a of plan) {
          if (a !== -1) {
            m.inst.onKey?.(new KeyboardEvent('keydown', { key: KEYS[a] }));
            m.inst.onKey?.(new KeyboardEvent('keyup', { key: KEYS[a] }));
          }
          slot(s, a);
          for (let j = 0; j < SUBSTEPS && !m.outcome; j++) m.inst.frame?.(SUB);
          if (s.done || (a !== -1 && s.reward)) break;
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
