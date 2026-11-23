import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { DX, DY, type Dir } from '../../kits/gesture/gesture';

/** Bonus per unused move when the target tile is made. */
export const MOVE_BONUS = 20;
/** Chance a new tile is a 4 rather than a 2. */
const FOUR = 0.1;

const sizeFor = (d: Difficulty) => byLevel(d, [5, 4, 4, 4, 4]);
export const targetFor = (d: Difficulty) => byLevel(d, [64, 128, 128, 256, 256]);
export const movesFor = (d: Difficulty) => byLevel(d, [60, 65, 70, 80, 85]);
/** Tiles on the board at the start (placed at random): a head start towards the bigger targets. */
export const dealFor = (d: Difficulty): readonly number[] =>
  byLevel(d, [
    [2, 2, 4, 8],
    [2, 4, 8, 16, 32],
    [2, 4, 8, 16, 32],
    [8, 16, 32, 64, 64],
    [4, 16, 32, 64, 64],
  ]);
/** Stones: cells that never hold a tile, tiles stop against them. */
export const stonesFor = (d: Difficulty) => byLevel(d, [0, 0, 1, 0, 1]);

export interface State {
  d: Difficulty;
  /** Board side. */
  n: number;
  /** Row-major tile values (0 for an empty cell, -1 for a stone). */
  grid: number[];
  target: number;
  moves: number;
  score: number;
  /** Biggest tile made so far. */
  best: number;
  rng: Rng;
}

/** One tile's slide in a move: from cell, to cell, and its value before any merge. */
export interface Slide {
  from: number;
  to: number;
  v: number;
}

export interface Move {
  slides: Slide[];
  /** Cells where two tiles merged. */
  merged: number[];
  /** Cell of the new tile (-1 if the board was full). */
  spawn: number;
}

/** Place a new tile (2, sometimes 4) on a random empty cell. Returns the cell, or -1 if full. */
function spawn(s: State): number {
  const empty = s.grid.flatMap((v, i) => (v === 0 ? [i] : []));
  if (!empty.length) return -1;
  const i = s.rng.pick(empty);
  s.grid[i] = s.rng.chance(FOUR) ? 4 : 2;
  return i;
}

/**
 * Slide every tile towards `dir` on a copy of the grid: equal tiles that meet merge into one of double
 * value (each tile merges at most once per move). Returns the new grid, the slides, merged cells and
 * the points scored, or null when nothing moves.
 */
export function slideGrid(
  grid: readonly number[],
  n: number,
  dir: Dir,
): { grid: number[]; slides: Slide[]; merged: number[]; points: number } | null {
  const out = [...grid];
  const slides: Slide[] = [];
  const merged: number[] = [];
  let points = 0;
  let moved = false;
  // Walk each line from the edge the tiles move towards.
  const dx = DX[dir];
  const dy = DY[dir];
  for (let line = 0; line < n; line++) {
    const cells: number[] = [];
    for (let k = 0; k < n; k++) {
      // k = 0 is the leading edge.
      const c = dx ? (dx > 0 ? n - 1 - k : k) : line;
      const r = dy ? (dy > 0 ? n - 1 - k : k) : line;
      cells.push(r * n + c);
    }
    // Stones split a line into segments that slide on their own.
    let seg: number[] = [];
    const flush = () => {
      let w = 0;
      let lastFree = true;
      for (const i of seg) {
        const v = grid[i];
        if (!v) continue;
        out[i] = 0;
        if (!lastFree && out[seg[w - 1]] === v) {
          const to = seg[w - 1];
          out[to] = v * 2;
          points += v * 2;
          merged.push(to);
          slides.push({ from: i, to, v });
          lastFree = true;
          moved = true;
        } else {
          const to = seg[w];
          out[to] = v;
          slides.push({ from: i, to, v });
          if (to !== i) moved = true;
          w++;
          lastFree = false;
        }
      }
      seg = [];
    };
    for (const i of cells) {
      if (grid[i] < 0) flush();
      else seg.push(i);
    }
    flush();
  }
  return moved ? { grid: out, slides, merged, points } : null;
}

export const canMove = (grid: readonly number[], n: number) => ([0, 1, 2, 3] as const).some((d) => slideGrid(grid, n, d));

/** Deal a level: stones, then the head-start tiles, on random cells. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const n = sizeFor(d);
  const grid: number[] = Array(n * n).fill(0);
  const cells = rng.shuffle([...grid.keys()]);
  // Stones stay off the corners, so every corner can hold the big tile.
  const corners = new Set([0, n - 1, n * (n - 1), n * n - 1]);
  const inner = cells.filter((i) => !corners.has(i));
  for (const i of inner.slice(0, stonesFor(d))) grid[i] = -1;
  const free = cells.filter((i) => grid[i] === 0);
  for (const [k, v] of dealFor(d).entries()) grid[free[k]] = v;
  return { d, n, grid, target: targetFor(d), moves: movesFor(d), score: 0, best: Math.max(...grid), rng };
}

export type Outcome = '' | 'win' | 'lose';

/** Play a move: slide, score, spawn a tile, spend a move. Null if nothing moves. */
export function play(s: State, dir: Dir): (Move & { out: Outcome }) | null {
  if (s.moves <= 0) return null;
  const r = slideGrid(s.grid, s.n, dir);
  if (!r) return null;
  s.grid = r.grid;
  s.score += r.points;
  s.moves--;
  s.best = Math.max(s.best, ...r.grid);
  let out: Outcome = '';
  let at = -1;
  if (s.best >= s.target) {
    s.score += s.moves * MOVE_BONUS;
    out = 'win';
  } else {
    at = spawn(s);
    if (s.moves <= 0 || !canMove(s.grid, s.n)) out = 'lose';
  }
  return { slides: r.slides, merged: r.merged, spawn: at, out };
}
