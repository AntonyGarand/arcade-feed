import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import {
  collapse,
  coloursFor,
  createLevel,
  findMatches,
  hasMove,
  MOVE_BONUS,
  movesFor,
  play,
  reshuffle,
  settle,
  targetFor,
  trySwap,
  validMoves,
  type State,
} from '../src/games/swap/rules';

/** Pick the swap that clears the most gems right away. */
function greedy(s: State): [number, number] {
  let best = validMoves(s.grid, s.n)[0];
  let most = -1;
  for (const m of validMoves(s.grid, s.n)) {
    const g = [...s.grid];
    [g[m[0]], g[m[1]]] = [g[m[1]], g[m[0]]];
    const k = findMatches(g, s.n).size;
    if (k > most) [most, best] = [k, m];
  }
  return best;
}

function autopilot(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
  let out: ReturnType<typeof play> = '';
  while (out === '') {
    // The board always offers a move between turns.
    expect(hasMove(s.grid, s.n)).toBe(true);
    expect(findMatches(s.grid, s.n).size).toBe(0);
    const [a, b] = greedy(s);
    out = play(s, a, b);
  }
  return { s, out };
}

describe('swap rules', () => {
  it('deals the same board from the same seed', () => {
    expect(createLevel(3, new Rng(9)).grid).toEqual(createLevel(3, new Rng(9)).grid);
    expect(createLevel(3, new Rng(9)).grid).not.toEqual(createLevel(3, new Rng(10)).grid);
  });

  it('never deals a board with a line already made, and always deals a move', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 60; seed++) {
        const s = createLevel(d, new Rng(seed));
        expect(findMatches(s.grid, s.n).size, `${d}/${seed}`).toBe(0);
        expect(hasMove(s.grid, s.n), `${d}/${seed}`).toBe(true);
        expect(Math.max(...s.grid)).toBeLessThan(coloursFor(d));
      }
  });

  it('gets harder: more colours, fewer moves per point of target', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(coloursFor(d)).toBeGreaterThanOrEqual(coloursFor(lo));
      expect(movesFor(d)).toBeLessThanOrEqual(movesFor(lo));
    }
    expect(coloursFor(5)).toBeGreaterThan(coloursFor(1));
    expect(createLevel(5, new Rng(1)).n).toBeGreaterThan(createLevel(1, new Rng(1)).n);
  });

  it('refuses a swap that makes no line, for free', () => {
    const s = createLevel(1, new Rng(4));
    const n = s.n;
    const valid = new Set(validMoves(s.grid, n).map(([a, b]) => `${a},${b}`));
    const i = [...Array(n * n).keys()].find((k) => k % n < n - 1 && !valid.has(`${k},${k + 1}`))!;
    expect(i).toBeGreaterThanOrEqual(0);
    const before = [...s.grid];
    expect(trySwap(s, i, i + 1)).toBe(false);
    expect(s.grid).toEqual(before);
    expect(s.moves).toBe(movesFor(1));
    expect(trySwap(s, 0, 2)).toBe(false); // not neighbours
  });

  it('cascades and refills the board completely', () => {
    const s = createLevel(2, new Rng(8));
    const [a, b] = validMoves(s.grid, s.n)[0];
    expect(play(s, a, b)).toBe('');
    expect(s.grid.every((v) => v >= 0)).toBe(true);
    expect(s.score).toBeGreaterThan(0);
    expect(s.moves).toBe(movesFor(2) - 1);
  });

  it('reshuffles a stuck board into one with a move and no line', () => {
    const s = createLevel(1, new Rng(2));
    // A stuck pattern: colours in a 5-cycle along each row, shifted by 2 each row, can't make a line.
    s.grid = s.grid.map((_, i) => ((i % s.n) + 2 * Math.floor(i / s.n)) % 5);
    expect(hasMove(s.grid, s.n)).toBe(false);
    expect(findMatches(s.grid, s.n).size).toBe(0);
    expect(settle(s)).toBe('');
    expect(hasMove(s.grid, s.n)).toBe(true);
    expect(findMatches(s.grid, s.n).size).toBe(0);
    reshuffle(s);
    expect(hasMove(s.grid, s.n)).toBe(true);
  });

  it('is cleared by a greedy player at every level on most seeds, with the move bonus', () => {
    for (const d of LEVELS) {
      const runs = Array.from({ length: 10 }, (_, k) => autopilot(d, k * 31 + d));
      const won = runs.filter((r) => r.out === 'win');
      for (const r of won) expect(r.s.score).toBeGreaterThanOrEqual(targetFor(d) + r.s.moves * MOVE_BONUS);
      expect(won.length, `level ${d}`).toBeGreaterThanOrEqual(d === 1 ? 9 : 5);
    }
  });

  it('is lost when the moves run out short of the target', () => {
    const s = createLevel(5, new Rng(3));
    s.target = 1e9;
    let out: ReturnType<typeof play> = '';
    while (out === '') {
      const [a, b] = validMoves(s.grid, s.n)[0];
      out = play(s, a, b);
    }
    expect(out).toBe('lose');
    expect(s.moves).toBe(0);
  });

  it('collapses gems down and records how far they fell', () => {
    const s = createLevel(1, new Rng(5));
    const n = s.n;
    const top = s.grid[0];
    s.grid[(n - 1) * n] = -1; // hole at the bottom of column 0
    collapse(s);
    expect(s.grid[n]).toBe(top); // everything in column 0 moved down one row
    expect(s.fell[n]).toBe(1);
    expect(s.fell[0]).toBe(1); // the new gem drops in from above
  });
});
