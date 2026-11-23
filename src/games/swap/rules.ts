import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Points per cleared gem (times the cascade step: 1, 2, 3…). */
const GEM_POINTS = 10;
/** Bonus per unused move when the target is reached. */
export const MOVE_BONUS = 60;

const sizeFor = (d: Difficulty) => byLevel(d, [7, 7, 8, 8, 8]);
export const coloursFor = (d: Difficulty) => byLevel(d, [5, 5, 6, 6, 7]);
export const movesFor = (d: Difficulty) => byLevel(d, [20, 18, 18, 16, 15]);
export const targetFor = (d: Difficulty) => byLevel(d, [1400, 1400, 1000, 900, 650]);

export interface State {
  d: Difficulty;
  /** Board side (cells). */
  n: number;
  colours: number;
  /** Row-major colour per cell, -1 while empty (between a clear and the refill). */
  grid: number[];
  moves: number;
  target: number;
  score: number;
  /** Cascade step of the current move (1 for the swap's own match). */
  chain: number;
  /** Rows each gem fell in the last collapse (for the fall animation). */
  fell: number[];
  rng: Rng;
}

/** Cells of every horizontal or vertical line of 3+ equal gems. */
export function findMatches(grid: readonly number[], n: number): Set<number> {
  const out = new Set<number>();
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const v = grid[i];
      if (v < 0) continue;
      if (c <= n - 3 && grid[i + 1] === v && grid[i + 2] === v) {
        let k = c;
        while (k < n && grid[r * n + k] === v) out.add(r * n + k++);
      }
      if (r <= n - 3 && grid[i + n] === v && grid[i + 2 * n] === v) {
        let k = r;
        while (k < n && grid[k * n + c] === v) out.add(k++ * n + c);
      }
    }
  return out;
}

export const adjacent = (n: number, a: number, b: number) =>
  (Math.abs(a - b) === 1 && Math.floor(a / n) === Math.floor(b / n)) || Math.abs(a - b) === n;

function swapCells(grid: number[], a: number, b: number) {
  [grid[a], grid[b]] = [grid[b], grid[a]];
}

/** Every swap that makes a match, as [a, b] pairs (b to the right of or below a). */
export function validMoves(grid: readonly number[], n: number): [number, number][] {
  const g = [...grid];
  const out: [number, number][] = [];
  for (let i = 0; i < n * n; i++)
    for (const j of [i % n < n - 1 ? i + 1 : -1, i + n < n * n ? i + n : -1]) {
      if (j < 0 || g[i] === g[j]) continue;
      swapCells(g, i, j);
      if (findMatches(g, n).size) out.push([i, j]);
      swapCells(g, i, j);
    }
  return out;
}

export const hasMove = (grid: readonly number[], n: number) => validMoves(grid, n).length > 0;

/** A colour for cell i that doesn't complete a line with the two gems left of it or above it. */
function safeColour(grid: number[], n: number, i: number, colours: number, rng: Rng): number {
  const c = i % n;
  const bad = new Set<number>();
  if (c >= 2 && grid[i - 1] === grid[i - 2]) bad.add(grid[i - 1]);
  if (i >= 2 * n && grid[i - n] === grid[i - 2 * n]) bad.add(grid[i - n]);
  const ok = [...Array(colours).keys()].filter((k) => !bad.has(k));
  return rng.pick(ok);
}

/** Fill a board with no line already made and at least one valid swap. */
function deal(n: number, colours: number, rng: Rng): number[] {
  for (;;) {
    const grid: number[] = [];
    for (let i = 0; i < n * n; i++) grid.push(safeColour(grid, n, i, colours, rng));
    if (hasMove(grid, n)) return grid;
  }
}

export function createLevel(d: Difficulty, rng: Rng): State {
  const n = sizeFor(d);
  const colours = coloursFor(d);
  return {
    d,
    n,
    colours,
    grid: deal(n, colours, rng),
    moves: movesFor(d),
    target: targetFor(d),
    score: 0,
    chain: 0,
    fell: Array(n * n).fill(0),
    rng,
  };
}

/**
 * Try to swap two neighbouring gems. A swap that makes no line is refused (and costs nothing). On
 * success the move is spent; call `clearStep` / `collapse` until the board settles.
 */
export function trySwap(s: State, a: number, b: number): boolean {
  if (s.moves <= 0 || !adjacent(s.n, a, b) || s.grid[a] === s.grid[b]) return false;
  swapCells(s.grid, a, b);
  if (!findMatches(s.grid, s.n).size) {
    swapCells(s.grid, a, b);
    return false;
  }
  s.moves--;
  s.chain = 0;
  return true;
}

/** Clear the lines on the board, scoring them at the next cascade step. Returns the cleared cells. */
export function clearStep(s: State): number[] {
  const m = [...findMatches(s.grid, s.n)];
  if (!m.length) return m;
  s.chain++;
  // Longer lines are worth more per gem: 3 → 3 gems, 4 → 5 gems' worth, 5 → 8.
  const extra = Math.max(0, m.length - 3);
  s.score += (m.length + extra * 2) * GEM_POINTS * s.chain;
  for (const i of m) s.grid[i] = -1;
  return m;
}

/** Let gems fall into the gaps and refill from the top with seeded colours. Records `fell`. */
export function collapse(s: State) {
  const { n, grid } = s;
  s.fell.fill(0);
  for (let c = 0; c < n; c++) {
    let w = n - 1;
    for (let r = n - 1; r >= 0; r--) {
      const v = grid[r * n + c];
      if (v < 0) continue;
      grid[w * n + c] = v;
      s.fell[w * n + c] = w - r;
      w--;
    }
    const empty = w + 1;
    for (let r = w; r >= 0; r--) {
      grid[r * n + c] = s.rng.int(0, s.colours - 1);
      s.fell[r * n + c] = empty;
    }
  }
}

/** Shuffle the gems in place until no line is made and a swap exists (when the board is stuck). */
export function reshuffle(s: State) {
  for (let tries = 0; tries < 200; tries++) {
    s.rng.shuffle(s.grid);
    if (!findMatches(s.grid, s.n).size && hasMove(s.grid, s.n)) return;
  }
  s.grid = deal(s.n, s.colours, s.rng);
}

export type Outcome = '' | 'win' | 'lose';

/** After the board settles: reshuffle if stuck, then check the goal. Adds the unused-move bonus on a win. */
export function settle(s: State): Outcome {
  if (s.score >= s.target) {
    s.score += s.moves * MOVE_BONUS;
    return 'win';
  }
  if (s.moves <= 0) return 'lose';
  if (!hasMove(s.grid, s.n)) reshuffle(s);
  return '';
}

/** Play a whole move without animation (tests and previews): swap, cascade, settle. */
export function play(s: State, a: number, b: number): Outcome | null {
  if (!trySwap(s, a, b)) return null;
  while (clearStep(s).length) collapse(s);
  return settle(s);
}
