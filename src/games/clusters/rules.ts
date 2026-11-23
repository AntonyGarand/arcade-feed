import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Bonus per block left under the goal when the board runs out of moves. */
export const LEFT_BONUS = 40;
/** Extra bonus for clearing every block. */
export const CLEAR_BONUS = 600;
/** Beam width of the solver that proves a level winnable (and plays the autopilot). */
const BEAM = 8;
/** Deals tried before falling back to the solver's own result as the goal. */
const TRIES = 40;

export const colsFor = (d: Difficulty) => byLevel(d, [8, 8, 9, 9, 10]);
export const rowsFor = (d: Difficulty) => byLevel(d, [10, 10, 11, 11, 12]);
export const coloursFor = (d: Difficulty) => byLevel(d, [3, 4, 4, 5, 5]);
/** Most blocks that may be left when the moves run out. */
export const goalFor = (d: Difficulty) => byLevel(d, [10, 8, 7, 6, 5]);
/** Chance a block copies a neighbour's colour when dealt (clumpier boards are friendlier). */
export const clumpFor = (d: Difficulty) => byLevel(d, [0.3, 0.25, 0.22, 0.2, 0.16]);

export interface State {
  d: Difficulty;
  cols: number;
  rows: number;
  colours: number;
  /** Row-major colour per cell (row 0 at the top), -1 when empty. */
  grid: number[];
  goal: number;
  /** Blocks still on the board. */
  left: number;
  score: number;
  /** Groups popped so far. */
  moves: number;
}

/** Points for popping a group of `n`. */
export const groupPoints = (n: number) => n * (n - 1);

/** Cells of the same-colour group around cell `i` (empty if the cell is empty). */
export function groupAt(grid: readonly number[], cols: number, rows: number, i: number): number[] {
  const k = grid[i];
  if (k === undefined || k < 0) return [];
  const seen = new Set([i]);
  const out = [i];
  for (let n = 0; n < out.length; n++) {
    const j = out[n];
    const c = j % cols;
    for (const m of [c > 0 ? j - 1 : -1, c < cols - 1 ? j + 1 : -1, j - cols, j + cols]) {
      if (m < 0 || m >= cols * rows || seen.has(m) || grid[m] !== k) continue;
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/** Every poppable group (2+ blocks), each once. */
export function groups(grid: readonly number[], cols: number, rows: number): number[][] {
  const seen = new Uint8Array(grid.length);
  const out: number[][] = [];
  for (let i = 0; i < grid.length; i++) {
    if (seen[i] || grid[i] < 0) continue;
    const g = groupAt(grid, cols, rows, i);
    for (const j of g) seen[j] = 1;
    if (g.length > 1) out.push(g);
  }
  return out;
}

export const hasMove = (grid: readonly number[], cols: number, rows: number) => {
  for (let i = 0; i < grid.length; i++) {
    const k = grid[i];
    if (k < 0) continue;
    if ((i % cols < cols - 1 && grid[i + 1] === k) || (i + cols < cols * rows && grid[i + cols] === k)) return true;
  }
  return false;
};

/**
 * Remove the cells, let blocks fall and close empty columns to the left. Returns, for every cell of the
 * new grid, the cell its block came from (-1 when empty), for the animation.
 */
function collapse(grid: number[], cols: number, rows: number, cells: readonly number[]): number[] {
  for (const i of cells) grid[i] = -1;
  const from: number[] = Array(grid.length).fill(-1);
  const old = [...grid];
  grid.fill(-1);
  let w = 0;
  for (let c = 0; c < cols; c++) {
    let r2 = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      const v = old[r * cols + c];
      if (v < 0) continue;
      grid[r2 * cols + w] = v;
      from[r2 * cols + w] = r * cols + c;
      r2--;
    }
    if (r2 < rows - 1) w++;
  }
  return from;
}

export interface Pop {
  removed: number[];
  /** Per new cell, where its block was before (-1 when empty). */
  from: number[];
}

/** Pop the group at cell `i` (2+ blocks): score it and settle the board. Null if nothing to pop. */
export function pop(s: State, i: number): Pop | null {
  const removed = groupAt(s.grid, s.cols, s.rows, i);
  if (removed.length < 2) return null;
  const from = collapse(s.grid, s.cols, s.rows, removed);
  s.left -= removed.length;
  s.score += groupPoints(removed.length);
  s.moves++;
  return { removed, from };
}

export type Outcome = '' | 'win' | 'lose';

/** After a pop: once no group is left, a win (with the leftover bonus) if few enough blocks remain. */
export function settle(s: State): Outcome {
  if (hasMove(s.grid, s.cols, s.rows)) return '';
  if (s.left > s.goal) return 'lose';
  s.score += (s.goal - s.left) * LEFT_BONUS + (s.left ? 0 : CLEAR_BONUS);
  return 'win';
}

/** Lower is better: blocks left, plus a little for blocks with no same-colour neighbour. */
function rate(grid: readonly number[], cols: number): number {
  let left = 0;
  let lonely = 0;
  for (let i = 0; i < grid.length; i++) {
    const k = grid[i];
    if (k < 0) continue;
    left++;
    const c = i % cols;
    if ((c > 0 && grid[i - 1] === k) || (c < cols - 1 && grid[i + 1] === k) || grid[i - cols] === k || grid[i + cols] === k) continue;
    lonely++;
  }
  return left + lonely * 0.6;
}

export interface Plan {
  /** Blocks left at the end. */
  left: number;
  /** One cell per pop, in order (indices on the board as it is at that point). */
  path: number[];
}

/**
 * A beam search over pops (keeping the `width` best boards at each depth): how few blocks it can leave,
 * and the pops that get there. Used to prove a deal winnable and to play the test autopilot.
 */
export function solve(grid: readonly number[], cols: number, rows: number, width = BEAM): Plan {
  let beam: { grid: number[]; path: number[] }[] = [{ grid: [...grid], path: [] }];
  let best: Plan = { left: grid.filter((v) => v >= 0).length, path: [] };
  while (beam.length) {
    const next: { grid: number[]; path: number[]; v: number }[] = [];
    const seen = new Set<string>();
    for (const b of beam) {
      const gs = groups(b.grid, cols, rows);
      if (!gs.length) {
        const left = b.grid.filter((v) => v >= 0).length;
        if (left < best.left) best = { left, path: b.path };
        continue;
      }
      for (const g of gs) {
        const ng = [...b.grid];
        collapse(ng, cols, rows, g);
        const key = ng.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ grid: ng, path: [...b.path, g[0]], v: rate(ng, cols) });
      }
    }
    next.sort((a, b) => a.v - b.v);
    beam = next.slice(0, width);
  }
  return best;
}

/** Deal a board: seeded colours, with a chance to copy the block to the left or below. */
function deal(cols: number, rows: number, colours: number, clump: number, rng: Rng): number[] {
  const grid: number[] = Array(cols * rows).fill(0);
  for (let r = rows - 1; r >= 0; r--)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const near = [c > 0 ? grid[i - 1] : -1, r < rows - 1 ? grid[i + cols] : -1].filter((v) => v >= 0);
      grid[i] = near.length && rng.chance(clump) ? rng.pick(near) : rng.int(0, colours - 1);
    }
  return grid;
}

/** Deal a board the solver can bring down to the goal (re-dealing from the same rng until it can). */
export function createLevel(d: Difficulty, rng: Rng): State {
  const cols = colsFor(d);
  const rows = rowsFor(d);
  const colours = coloursFor(d);
  let goal = goalFor(d);
  let grid: number[] = [];
  let closest = Infinity;
  for (let t = 0; t < TRIES; t++) {
    const g = deal(cols, rows, colours, clumpFor(d), rng);
    const left = solve(g, cols, rows).left;
    if (left < closest) [closest, grid] = [left, g];
    if (left <= goal) break;
  }
  // Never seen in practice: keep the closest deal and make its result the goal.
  goal = Math.max(goal, closest);
  return { d, cols, rows, colours, grid, goal, left: cols * rows, score: 0, moves: 0 };
}
