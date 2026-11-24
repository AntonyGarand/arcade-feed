import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { memory } from '../src/games/memory';
import {
  createLevel,
  LIVES,
  press,
  roundsFor,
  runSeconds,
  showFor,
  sideFor,
  step,
  tileCount,
  tilesIn,
  type PressResult,
  type State,
} from '../src/games/memory/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Run frames until the tiles go dark (or the run ends); returns the tiles seen lit. */
function watch(s: State, frame: (dt: number) => void = (dt) => step(s, dt)): number[] {
  const seen = new Set<number>();
  for (let i = 0; i < 6000 && s.phase !== 'input' && s.phase !== 'done'; i++) {
    frame(DT);
    if (s.phase === 'show') s.lit.forEach((on, k) => on && seen.add(k));
  }
  return [...seen];
}

/** Wait `t` seconds of game time. */
const wait = (s: State, t: number) => {
  for (let x = 0; x < t - 1e-9; x += DT) step(s, DT);
};

/** Tap back what was seen, one tile every `tap` seconds; `slips` wrong tiles first in round 1. */
function autopilot(d: Difficulty, seed: number, tap: number, slips = 0) {
  const s = createLevel(d, new Rng(seed));
  let out: PressResult = '';
  while (out !== 'win' && out !== 'lose') {
    const seen = watch(s);
    if (s.phase === 'done') return { s, out: s.lives > 0 ? 'win' : 'lose' };
    if (s.round === 1)
      for (let k = 0, i = 0; k < slips; i++)
        if (!s.lit[i]) {
          press(s, i);
          k++;
        }
    for (const k of seen) {
      wait(s, tap);
      out = press(s, k);
    }
  }
  return { s, out };
}

describe('memory rules', () => {
  it('deals the same patterns from the same seed, and others from another', () => {
    expect(createLevel(3, new Rng(7)).patterns).toEqual(createLevel(3, new Rng(7)).patterns);
    expect(createLevel(3, new Rng(7)).patterns).not.toEqual(createLevel(3, new Rng(8)).patterns);
  });

  it('lights one tile more each round, all distinct and on the grid', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 10; seed++) {
        const s = createLevel(d, new Rng(seed));
        expect(s.patterns.length).toBe(roundsFor(d));
        s.patterns.forEach((p, r) => {
          expect(p.length).toBe(tilesIn(d, r + 1));
          expect(new Set(p).size).toBe(p.length);
          expect(p.every((i) => i >= 0 && i < s.side * s.side)).toBe(true);
        });
      }
  });

  it('gets harder: bigger grid, more rounds and tiles, a shorter look', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(sideFor(d)).toBeGreaterThanOrEqual(sideFor(lo));
      expect(tileCount(d)).toBeGreaterThan(tileCount(lo));
      expect(showFor(d)).toBeLessThanOrEqual(showFor(lo));
      expect(memory.stars(d)[1]).toBeGreaterThan(memory.stars(lo)[1]);
    }
    for (const d of LEVELS) {
      expect(showFor(d)).toBeGreaterThanOrEqual(1.2);
      expect(runSeconds(d)).toBeGreaterThan(15);
      expect(runSeconds(d)).toBeLessThan(60);
    }
  });

  it('shows the tiles on the clock, and only takes taps once they go dark', () => {
    const s = createLevel(2, new Rng(3));
    expect(s.phase).toBe('intro');
    const lit = s.patterns[0][0];
    expect(press(s, lit)).toBe('');
    wait(s, 0.8);
    expect(s.phase).toBe('show');
    expect(press(s, lit)).toBe('');
    wait(s, showFor(2));
    expect(s.phase).toBe('input');
    expect(press(s, lit)).toBe('hit');
    expect(press(s, lit)).toBe('');
  });

  it('is cleared by a perfect, quick memory at every level with three stars', () => {
    for (const d of LEVELS) {
      const [, three] = memory.stars(d);
      for (let seed = 1; seed <= 4; seed++) {
        const r = autopilot(d, seed, 0.45);
        expect(r.out, `${d}/${seed}`).toBe('win');
        expect(r.s.score, `${d}/${seed}`).toBeGreaterThanOrEqual(three);
      }
    }
  });

  it('gives two stars for a quick run with a slip, one for a slow one', () => {
    for (const d of LEVELS) {
      const [two, three] = memory.stars(d);
      const slip = autopilot(d, 2, 0.5, 1);
      expect(slip.out).toBe('win');
      expect(slip.s.lives).toBe(LIVES - 1);
      expect(slip.s.score, `level ${d}`).toBeGreaterThanOrEqual(two);
      expect(slip.s.score, `level ${d}`).toBeLessThan(three);
      // Slow (some rounds run out at the top levels) with a slip: one star at best.
      const slow = autopilot(d, 2, 1.2, 1);
      expect(slow.s.score, `level ${d}`).toBeLessThan(two);
    }
  });

  it('costs a heart for each wrong tile, and the run ends with the last one', () => {
    const s = createLevel(1, new Rng(4));
    watch(s);
    const wrong = [...s.lit.keys()].filter((i) => !s.lit[i]);
    expect(press(s, wrong[0])).toBe('slip');
    expect(press(s, wrong[0])).toBe(''); // already marked
    expect(press(s, wrong[1])).toBe('slip');
    expect(press(s, wrong[2])).toBe('lose');
    expect(s.lives).toBe(0);
    expect(s.phase).toBe('done');
  });

  it('costs a heart when the clock runs out, shows the missed tiles and moves on', () => {
    const s = createLevel(1, new Rng(5));
    watch(s);
    press(s, s.patterns[0][0]);
    let late = '';
    for (let i = 0; i < 2000 && !late; i++) late = step(s, DT).late;
    expect(late).toBe('late');
    expect(s.phase).toBe('late');
    expect(s.lives).toBe(LIVES - 1);
    expect(s.left).toBe(tilesIn(1, 1) - 1);
    watch(s);
    expect(s.round).toBe(2);
    expect(s.cleared).toEqual([false]);
    // Running out twice more ends the run.
    for (let i = 0; i < 2000 && late !== 'lose'; i++) late = step(s, DT).late || late;
    expect(late).toBe('lose');
    expect(s.round).toBe(3);
  });

  it('clears the level when the last round runs out with a heart to spare', () => {
    const s = createLevel(1, new Rng(6));
    for (let r = 1; r < s.rounds; r++) for (const k of watch(s)) press(s, k);
    watch(s);
    expect(s.round).toBe(s.rounds);
    let late = '';
    for (let i = 0; i < 2000 && !late; i++) late = step(s, DT).late;
    expect(late).toBe('win');
    expect(s.phase).toBe('done');
  });
});

describe('memory game', () => {
  it('mounts at every level and reports score, hearts and rounds', () => {
    for (const d of LEVELS) {
      const m = mountGame(memory, d, 2);
      expect(m.lives).toEqual([LIVES, LIVES]);
      expect(m.status).toContain(`1/${roundsFor(d)}`);
      m.run(2);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is won from the keyboard, moving the cursor to the tiles that lit up', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(memory, d, 6);
      const s = createLevel(d, new Rng(6)); // the same level, stepped alongside to see the lights
      const key = (k: string) => {
        expect(m.inst.onKey?.(new KeyboardEvent('keydown', { key: k }))).toBe(true);
        m.inst.onKey?.(new KeyboardEvent('keyup', { key: k }));
      };
      key('ArrowUp'); // shows the cursor in the middle
      let at = Math.floor(s.side / 2) * s.side + Math.floor(s.side / 2);
      while (!m.outcome) {
        const seen = watch(s, (dt) => {
          step(s, dt);
          m.inst.frame?.(dt);
        });
        for (const k of seen) {
          for (; at % s.side < k % s.side; at++) key('ArrowRight');
          for (; at % s.side > k % s.side; at--) key('a');
          for (; Math.floor(at / s.side) < Math.floor(k / s.side); at += s.side) key('s');
          for (; Math.floor(at / s.side) > Math.floor(k / s.side); at -= s.side) key('ArrowUp');
          key(k % 2 ? ' ' : 'Enter');
          press(s, k);
        }
      }
      expect(m.outcome).toBe('win');
      expect(m.score).toBe(s.score);
      expect(m.inst.onKey?.(new KeyboardEvent('keydown', { key: 'x' }))).toBe(false);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is lost by running out the clock', () => {
    const m = mountGame(memory, 3, 3);
    m.run(120);
    expect(m.outcome).toBe('lose');
    expect(m.lives).toEqual([0, LIVES]);
  });
});
