import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import type { Dir } from '../src/kits/gesture/gesture';
import { doubles } from '../src/games/doubles';
import {
  canMove,
  createLevel,
  dealFor,
  MOVE_BONUS,
  movesFor,
  play,
  slideGrid,
  stonesFor,
  targetFor,
  type Outcome,
  type State,
} from '../src/games/doubles/rules';
import { mountGame } from './support/mount';

const DIRS: Dir[] = [0, 1, 2, 3];
const KEYS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];

/** Snake-shaped weights: the big tile in the top-left corner, the rest trailing behind it in a zigzag. */
function weights(n: number): number[] {
  const w: number[] = Array(n * n).fill(0);
  let k = n * n;
  for (let r = 0; r < n; r++) for (let j = 0; j < n; j++) w[r * n + (r % 2 ? n - 1 - j : j)] = 4 ** (k-- / 2);
  return w;
}

function value(grid: readonly number[], w: readonly number[]) {
  let v = 0;
  let empty = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > 0) v += grid[i] * w[i];
    else if (grid[i] === 0) empty++;
  }
  return v * (1 + empty * 0.1);
}

/** One-ply expectimax: each move, averaged over a new 2 on every empty cell, then the best reply. */
function best(s: State, w: readonly number[]): Dir {
  let bd: Dir = 0;
  let bv = -Infinity;
  for (const d of DIRS) {
    const r = slideGrid(s.grid, s.n, d);
    if (!r) continue;
    const empty = r.grid.flatMap((v, i) => (v === 0 ? [i] : []));
    let total = 0;
    for (const i of empty) {
      const g = [...r.grid];
      g[i] = 2;
      let m = 0;
      for (const d2 of DIRS) {
        const r2 = slideGrid(g, s.n, d2);
        if (r2) m = Math.max(m, value(r2.grid, w));
      }
      total += m;
    }
    const v = empty.length ? total / empty.length : value(r.grid, w);
    if (v > bv) [bv, bd] = [v, d];
  }
  return bd;
}

function autopilot(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
  const w = weights(s.n);
  let out: Outcome = '';
  const dirs: Dir[] = [];
  while (out === '') {
    const dir = best(s, w);
    dirs.push(dir);
    const m = play(s, dir);
    expect(m).not.toBeNull();
    out = m!.out;
  }
  return { s, out, dirs };
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('doubles rules', () => {
  it('deals the same board and tiles from the same seed', () => {
    expect(createLevel(3, new Rng(9)).grid).toEqual(createLevel(3, new Rng(9)).grid);
    expect(createLevel(3, new Rng(9)).grid).not.toEqual(createLevel(3, new Rng(10)).grid);
    expect(autopilot(2, 4).dirs).toEqual(autopilot(2, 4).dirs);
  });

  it('gets harder: a bigger gap to the target per move, a smaller board, stones', () => {
    const gap = (d: Difficulty) => targetFor(d) - sum(dealFor(d));
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(gap(d)).toBeGreaterThanOrEqual(gap(lo));
      expect(targetFor(d)).toBeGreaterThanOrEqual(targetFor(lo));
    }
    expect(gap(5) / movesFor(5)).toBeGreaterThan(gap(1) / movesFor(1));
    expect(createLevel(1, new Rng(1)).n).toBeGreaterThan(createLevel(5, new Rng(1)).n);
    const s = createLevel(5, new Rng(1));
    expect(s.grid.filter((v) => v < 0).length).toBe(stonesFor(5));
    expect(sum(s.grid.filter((v) => v > 0))).toBe(sum(dealFor(5)));
  });

  it('slides, merges each tile once and stops at stones', () => {
    // Rows of a 4×4: 2 2 2 2 → 4 4, and 4 4 8 _ → 8 8; a stone splits the third row.
    const g = [2, 2, 2, 2, 4, 4, 8, 0, 2, -1, 2, 0, 0, 0, 0, 0];
    const r = slideGrid(g, 4, 3)!;
    expect(r.grid).toEqual([4, 4, 0, 0, 8, 8, 0, 0, 2, -1, 2, 0, 0, 0, 0, 0]);
    expect(r.points).toBe(4 + 4 + 8);
    expect(r.merged).toEqual([0, 1, 4]);
    const right = slideGrid(g, 4, 1)!;
    expect(right.grid.slice(8, 12)).toEqual([2, -1, 0, 2]);
    // Nothing moves: no move.
    expect(slideGrid([2, 4, 0, 0], 2, 0)).toBeNull();
    expect(canMove([2, 4, 4, 2], 2)).toBe(false);
  });

  it('spends a move and adds a tile each turn', () => {
    const s = createLevel(2, new Rng(3));
    const tiles = s.grid.filter((v) => v > 0).length;
    const dir = DIRS.find((d) => slideGrid(s.grid, s.n, d)?.merged.length === 0)!;
    const m = play(s, dir)!;
    expect(m.spawn).toBeGreaterThanOrEqual(0);
    expect(s.grid.filter((v) => v > 0).length).toBe(tiles + 1);
    expect(s.moves).toBe(movesFor(2) - 1);
  });

  it('is cleared by an autopilot at every level on most seeds, with the move bonus', () => {
    for (const d of LEVELS) {
      const runs = Array.from({ length: 8 }, (_, k) => autopilot(d, k * 11 + d));
      const won = runs.filter((r) => r.out === 'win');
      expect(won.length, `level ${d}`).toBeGreaterThanOrEqual(d === 1 ? 8 : 5);
      for (const r of won) {
        expect(r.s.best).toBeGreaterThanOrEqual(targetFor(d));
        expect(r.s.score).toBeGreaterThanOrEqual(r.s.moves * MOVE_BONUS + targetFor(d));
      }
      const stars = won.map((r) => starsFor(doubles, d, true, r.s.score));
      expect(stars.filter((n) => n >= 2).length, `level ${d}`).toBeGreaterThanOrEqual(won.length / 2);
      expect(stars.filter((n) => n === 3).length, `level ${d}`).toBeLessThan(won.length);
    }
  });

  it('is lost when the moves run out', () => {
    const s = createLevel(4, new Rng(5));
    s.target = 4096;
    let out: Outcome = '';
    // Rock between two directions until the moves run out (or the board jams).
    for (let k = 0; out === ''; k++) {
      const m = play(s, k % 2 ? 0 : 3) ?? play(s, 1) ?? play(s, 2);
      expect(m).not.toBeNull();
      out = m!.out;
    }
    expect(out).toBe('lose');
    expect(s.moves === 0 || !canMove(s.grid, s.n)).toBe(true);
  });
});

describe('doubles game', () => {
  it('mounts at level 1 and 5 and waits for the player', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(doubles, d, 4);
      expect(m.status).toContain(String(movesFor(d)));
      m.run(4);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('plays the autopilot’s moves from the keyboard to a win', () => {
    for (const d of [1, 5] as const) {
      const seed = [1, 2, 3, 4, 5, 6].find((k) => autopilot(d, k).out === 'win')!;
      const { s, dirs } = autopilot(d, seed);
      const m = mountGame(doubles, d, seed);
      for (const dir of dirs) {
        m.inst.onKey?.(new KeyboardEvent('keydown', { key: KEYS[dir] }));
        m.run(0.05);
      }
      expect(m.score).toBe(s.score);
      m.run(1);
      expect(m.outcome).toBe('win');
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
