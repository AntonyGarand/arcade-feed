import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { flutter } from '../src/games/flutter';
import {
  createLevel,
  flap,
  gapFor,
  GATE_POINTS,
  gatesFor,
  LIFE_BONUS,
  livesFor,
  nextColumn,
  speedFor,
  step,
  swingFor,
  type State,
} from '../src/games/flutter/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * The plain policy: flap whenever the flyer sinks below a line in the next gap (a flap peaks ~40 above
 * it), the line set near the gap's star with `toStar`.
 */
function band(s: State, toStar: boolean) {
  const c = nextColumn(s);
  if (!c) return;
  const want = (toStar && c.star != null && !c.taken ? c.star : c.gy) + 20;
  if (s.y + s.vy * DT > Math.max(c.gy - s.gap / 2 + 54, Math.min(c.gy + s.gap / 2 - 14, want))) flap(s);
}

/** Fly the band policy, aimed at the stars (greedy) or at the middle of each gap. */
function autopilot(d: Difficulty, seed: number, greedy = true) {
  const s = createLevel(d, new Rng(seed));
  flap(s);
  for (let t = 0; t < 200; t += DT) {
    band(s, greedy);
    const ev = step(s, DT);
    if (ev.won) return { s, win: true };
    if (ev.over) return { s, win: false };
  }
  throw new Error('never ended');
}

describe('flutter rules', () => {
  it('deals the same columns from the same seed', () => {
    expect(createLevel(3, new Rng(9)).cols).toEqual(createLevel(3, new Rng(9)).cols);
    expect(createLevel(3, new Rng(9)).cols).not.toEqual(createLevel(3, new Rng(10)).cols);
  });

  it('gets harder: more gates, tighter gaps, faster, wilder swings, fewer lives', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(gatesFor(d)).toBeGreaterThan(gatesFor(lo));
      expect(gapFor(d)).toBeLessThan(gapFor(lo));
      expect(speedFor(d)).toBeGreaterThan(speedFor(lo));
      expect(swingFor(d)).toBeGreaterThan(swingFor(lo));
      expect(livesFor(d)).toBeLessThanOrEqual(livesFor(lo));
    }
  });

  it('hovers until the first flap', () => {
    const s = createLevel(1, new Rng(1));
    for (let i = 0; i < 300; i++) step(s, DT);
    expect(s.dist).toBe(0);
    expect(s.lives).toBe(livesFor(1));
  });

  it('is cleared by a flapping autopilot at every level', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed));
      const wins = runs.filter((r) => r.win);
      expect(wins.length, `level ${d}`).toBeGreaterThanOrEqual(5);
      const [two, three] = flutter.stars(d);
      for (const r of wins) {
        expect(r.s.score).toBeGreaterThanOrEqual(gatesFor(d) * GATE_POINTS + LIFE_BONUS);
        expect(r.s.score, `level ${d} two stars`).toBeGreaterThanOrEqual(two);
      }
      // A clean, greedy run reaches three stars on most seeds.
      expect(wins.filter((r) => r.s.score >= three).length, `level ${d} three stars`).toBeGreaterThanOrEqual(3);
      // Ignoring the stars stays below three.
      for (const seed of [1, 2, 3]) expect(autopilot(d, seed, false).s.score).toBeLessThan(three);
    }
  });

  it('loses a life per crash, respawns in the gap, and ends at zero', () => {
    const s = createLevel(2, new Rng(4));
    flap(s);
    let hurt = 0;
    let over = false;
    const respawns: number[] = [];
    const gaps: number[] = [];
    for (let t = 0; t < 60 && !over; t += DT) {
      const ev = step(s, DT); // never flap again: drop to the ground
      if (ev.hurt) hurt++;
      if (ev.hurt && !ev.over) {
        respawns.push(s.y);
        gaps.push(nextColumn(s)!.gy);
      }
      over = ev.over;
    }
    expect(over).toBe(true);
    expect(respawns).toEqual(gaps);
    expect(hurt).toBe(livesFor(2));
  });
});

describe('flutter card', () => {
  const press = (m: ReturnType<typeof mountGame>, type: 'keydown' | 'keyup') => m.inst.onKey?.(new KeyboardEvent(type, { key: ' ' }));

  for (const d of [1, 5] as const)
    it(`mounts at level ${d}, flies with Space and reports progress`, () => {
      const m = mountGame(flutter, d, 3);
      expect(m.lives).toEqual([livesFor(d), livesFor(d)]);
      expect(m.status).not.toBe('');
      m.run(2);
      expect(m.outcome).toBe('');
      const before = m.status;
      // A flap every 0.6 s holds the height (the first column is still a little way off).
      for (let i = 0; i < 2; i++) {
        expect(press(m, 'keydown')).toBe(true);
        press(m, 'keyup');
        m.run(0.6);
      }
      expect(m.outcome).toBe('');
      expect(m.status).not.toBe(before);
      // Stop flapping: the flyer drops and the lives run out.
      m.run(30);
      expect(m.outcome).toBe('lose');
      m.inst.destroy?.();
      m.root.remove();
    });
});
