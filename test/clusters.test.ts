import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { clusters } from '../src/games/clusters';
import {
  clumpFor,
  coloursFor,
  colsFor,
  createLevel,
  goalFor,
  groupAt,
  groups,
  hasMove,
  pop,
  rowsFor,
  settle,
  solve,
  type Outcome,
  type State,
} from '../src/games/clusters/rules';
import { mountGame, type Mounted } from './support/mount';

/** Play the solver's plan (the strong autopilot). */
function planned(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
  let out: Outcome = '';
  for (const i of solve(s.grid, s.cols, s.rows).path) {
    expect(pop(s, i)).not.toBeNull();
    out = settle(s);
  }
  return { s, out };
}

/** Always pop the biggest group (a hasty player). */
function hasty(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
  let out: Outcome = '';
  while (out === '') {
    const g = groups(s.grid, s.cols, s.rows).sort((a, b) => b.length - a.length)[0];
    pop(s, g[0]);
    out = settle(s);
  }
  return { s, out };
}

const blocks = (s: State) => s.grid.filter((v) => v >= 0).length;

describe('clusters rules', () => {
  it('deals the same board from the same seed', () => {
    expect(createLevel(3, new Rng(9)).grid).toEqual(createLevel(3, new Rng(9)).grid);
    expect(createLevel(3, new Rng(9)).grid).not.toEqual(createLevel(3, new Rng(10)).grid);
  });

  it('gets harder: bigger boards, more colours, a lower goal', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(colsFor(d) * rowsFor(d)).toBeGreaterThanOrEqual(colsFor(lo) * rowsFor(lo));
      expect(coloursFor(d)).toBeGreaterThanOrEqual(coloursFor(lo));
      expect(goalFor(d)).toBeLessThan(goalFor(lo));
      expect(clumpFor(d)).toBeLessThan(clumpFor(lo));
    }
    const s = createLevel(5, new Rng(1));
    expect(s.grid.length).toBe(colsFor(5) * rowsFor(5));
    expect(Math.max(...s.grid)).toBe(coloursFor(5) - 1);
  });

  it('only deals boards the solver brings down to the goal', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 6; seed++) {
        const s = createLevel(d, new Rng(seed));
        expect(s.goal, `${d}/${seed}`).toBe(goalFor(d));
        expect(solve(s.grid, s.cols, s.rows).left, `${d}/${seed}`).toBeLessThanOrEqual(s.goal);
      }
  });

  it('pops a group, drops the blocks above and closes empty columns', () => {
    const s = createLevel(1, new Rng(2));
    Object.assign(s, { cols: 3, rows: 3, left: 9, score: 0 });
    s.grid = [0, 3, 4, 0, 1, 3, 0, 1, 4];
    // The first column goes: the others slide left.
    expect(pop(s, 0)?.removed.length).toBe(3);
    expect(s.grid).toEqual([3, 4, -1, 1, 3, -1, 1, 4, -1]);
    expect(s.score).toBe(6);
    // The pair of 1s goes: the 3 above falls two rows.
    const out = pop(s, 6);
    expect(out?.removed.length).toBe(2);
    expect(s.grid).toEqual([-1, 4, -1, -1, 3, -1, 3, 4, -1]);
    expect(out?.from[6]).toBe(0);
    expect(s.left).toBe(4);
    expect(s.score).toBe(8);
    // Lone blocks can't be popped, and nothing is left to pop.
    expect(groupAt(s.grid, 3, 3, 4)).toEqual([4]);
    expect(pop(s, 4)).toBeNull();
    expect(groups(s.grid, 3, 3)).toEqual([]);
    expect(blocks(s)).toBe(s.left);
  });

  it('is cleared by the solver at every level, and a hasty player only the easy ones', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => planned(d, seed * 7 + d));
      for (const r of runs) {
        expect(r.out).toBe('win');
        expect(r.s.left).toBeLessThanOrEqual(goalFor(d));
      }
      // Most solver runs earn two stars or more, and three stars stay rare.
      const stars = runs.map((r) => starsFor(clusters, d, true, r.s.score));
      expect(stars.filter((n) => n >= 2).length, `level ${d}`).toBeGreaterThanOrEqual(6);
      expect(stars.filter((n) => n === 3).length, `level ${d}`).toBeLessThanOrEqual(6);
    }
    // A hasty player (biggest group first) gets through the easy level but rarely the master one.
    const wins = (d: Difficulty) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((seed) => hasty(d, seed * 7 + d).out === 'win').length;
    expect(wins(1)).toBeGreaterThanOrEqual(9);
    expect(wins(5)).toBeLessThanOrEqual(3);
  });

  it('is lost when no move is left above the goal', () => {
    const s = createLevel(4, new Rng(3));
    // A checkerboard of two colours has no group at all.
    s.grid = s.grid.map((_, i) => ((i % s.cols) + Math.floor(i / s.cols)) % 2);
    expect(hasMove(s.grid, s.cols, s.rows)).toBe(false);
    expect(settle(s)).toBe('lose');
  });
});

describe('clusters game', () => {
  const key = (m: Mounted, k: string) => m.inst.onKey?.(new KeyboardEvent('keydown', { key: k }));

  it('mounts at level 1 and 5, reports progress and waits for the player', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(clusters, d, 4);
      expect(m.status).toContain(String(colsFor(d) * rowsFor(d)));
      m.run(5);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('plays a level to a win from the keyboard', () => {
    const m = mountGame(clusters, 1, 5);
    const s = createLevel(1, new Rng(5));
    const { cols } = s;
    key(m, 'ArrowDown'); // shows the cursor
    let at = -1;
    const goTo = (i: number) => {
      // From wherever the cursor is, walk there with the arrows (the cursor starts at an occupied cell).
      if (at < 0) {
        // Park the cursor in the top-left corner first.
        for (let n = 0; n < 20; n++) key(m, 'ArrowUp');
        for (let n = 0; n < 20; n++) key(m, 'ArrowLeft');
        at = 0;
      }
      const dc = (i % cols) - (at % cols);
      const dr = Math.floor(i / cols) - Math.floor(at / cols);
      for (let n = 0; n < Math.abs(dc); n++) key(m, dc > 0 ? 'ArrowRight' : 'ArrowLeft');
      for (let n = 0; n < Math.abs(dr); n++) key(m, dr > 0 ? 'ArrowDown' : 'ArrowUp');
      at = i;
    };
    for (const i of solve(s.grid, s.cols, s.rows).path) {
      goTo(i);
      key(m, ' ');
      pop(s, i);
      settle(s);
      m.run(0.3); // let the slide finish
      expect(m.score).toBe(s.score);
      at = i; // the cursor stays put (or moves to the nearest block when its block left)
      if (s.grid[i] < 0) at = -1;
    }
    m.run(1);
    expect(m.outcome).toBe('win');
    m.inst.destroy?.();
    m.root.remove();
  });
});
