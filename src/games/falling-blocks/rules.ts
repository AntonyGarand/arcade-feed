import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

export const COLS = 10;
export const ROWS = 20;
/** Cell value of a garbage block (pieces use 0–6). */
export const GARBAGE = 7;
/** Seconds a grounded piece waits before it locks (each move or turn restarts it, a few times). */
const LOCK_S = 0.5;
const MAX_RESETS = 15;
/** Points for clearing 1, 2, 3 or 4 lines at once. */
export const LINE_POINTS = [0, 100, 300, 500, 800] as const;

export const goalFor = (d: Difficulty) => byLevel(d, [6, 8, 10, 12, 14]);
export const garbageFor = (d: Difficulty) => byLevel(d, [2, 4, 6, 8, 10]);
/** Seconds per row of fall. */
export const gravityFor = (d: Difficulty) => byLevel(d, [0.8, 0.62, 0.48, 0.36, 0.26]);

/** The seven four-cell shapes, in their spawn orientation inside an n×n box. */
const SHAPES: { n: number; cells: [number, number][] }[] = [
  {
    n: 4,
    cells: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  }, // bar
  {
    n: 2,
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  }, // square
  {
    n: 3,
    cells: [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  }, // tee
  {
    n: 3,
    cells: [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
  }, // step right
  {
    n: 3,
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  }, // step left
  {
    n: 3,
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  }, // hook left
  {
    n: 3,
    cells: [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  }, // hook right
];

/** Cells of shape `k` turned `rot` quarter turns clockwise. */
export function shapeCells(k: number, rot: number): [number, number][] {
  const { n, cells } = SHAPES[k];
  let out = cells;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) out = out.map(([x, y]) => [n - 1 - y, x]);
  return out;
}

export interface Piece {
  k: number;
  rot: number;
  x: number;
  y: number;
}

export interface State {
  d: Difficulty;
  /** Row-major, -1 = empty. */
  grid: number[];
  piece: Piece;
  /** Upcoming shapes (refilled one shuffled bag of seven at a time). */
  queue: number[];
  lines: number;
  goal: number;
  score: number;
  gravity: number;
  fall: number;
  lock: number;
  resets: number;
  rng: Rng;
}

export function fits(s: State, p: Piece): boolean {
  for (const [cx, cy] of shapeCells(p.k, p.rot)) {
    const x = p.x + cx;
    const y = p.y + cy;
    if (x < 0 || x >= COLS || y >= ROWS) return false;
    if (y >= 0 && s.grid[y * COLS + x] >= 0) return false;
  }
  return true;
}

function nextShape(s: State): number {
  if (s.queue.length < 2) s.queue.push(...s.rng.shuffle([0, 1, 2, 3, 4, 5, 6]));
  return s.queue.shift()!;
}

/** Put the next piece at the top. False when it doesn't fit (top-out). */
function spawn(s: State): boolean {
  const k = nextShape(s);
  s.piece = { k, rot: 0, x: k === 1 ? 4 : 3, y: 0 };
  s.fall = 0;
  s.lock = 0;
  s.resets = 0;
  return fits(s, s.piece);
}

/** Deal a level: rows of garbage at the bottom (each with a hole or two) and the first piece. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const grid: number[] = Array(COLS * ROWS).fill(-1);
  const rows = garbageFor(d);
  for (let r = ROWS - rows; r < ROWS; r++) {
    const holes = new Set([rng.int(0, COLS - 1)]);
    // Higher garbage gets ragged: a second hole now and then.
    if (r < ROWS - 4 && rng.chance(0.5)) holes.add(rng.int(0, COLS - 1));
    for (let c = 0; c < COLS; c++) if (!holes.has(c)) grid[r * COLS + c] = GARBAGE;
  }
  const s: State = {
    d,
    grid,
    piece: { k: 0, rot: 0, x: 3, y: 0 },
    queue: [],
    lines: 0,
    goal: goalFor(d),
    score: 0,
    gravity: gravityFor(d),
    fall: 0,
    lock: 0,
    resets: 0,
    rng,
  };
  spawn(s);
  return s;
}

const grounded = (s: State) => !fits(s, { ...s.piece, y: s.piece.y + 1 });

function touched(s: State) {
  if (grounded(s) && s.resets < MAX_RESETS) {
    s.lock = 0;
    s.resets++;
  }
}

export function move(s: State, dx: number): boolean {
  const p = { ...s.piece, x: s.piece.x + dx };
  if (!fits(s, p)) return false;
  s.piece = p;
  touched(s);
  return true;
}

/** Turn a quarter clockwise (dir 1) or counter-clockwise (-1), nudging sideways or up if blocked. */
export function rotate(s: State, dir: 1 | -1): boolean {
  for (const [dx, dy] of [
    [0, 0],
    [-1, 0],
    [1, 0],
    [-2, 0],
    [2, 0],
    [0, -1],
  ]) {
    const p = { ...s.piece, rot: (s.piece.rot + dir + 4) % 4, x: s.piece.x + dx, y: s.piece.y + dy };
    if (fits(s, p)) {
      s.piece = p;
      touched(s);
      return true;
    }
  }
  return false;
}

/** Rows the piece would fall before landing. */
export function dropDistance(s: State): number {
  let n = 0;
  while (fits(s, { ...s.piece, y: s.piece.y + n + 1 })) n++;
  return n;
}

export interface StepEvents {
  locked: boolean;
  /** Rows cleared by the lock (indices before the clear). */
  cleared: number[];
  won: boolean;
  over: boolean;
}

const none = (): StepEvents => ({ locked: false, cleared: [], won: false, over: false });

/** Fix the piece in place, clear full rows, check the goal and bring the next piece. */
function lockPiece(s: State): StepEvents {
  const ev = none();
  ev.locked = true;
  let above = false;
  for (const [cx, cy] of shapeCells(s.piece.k, s.piece.rot)) {
    const y = s.piece.y + cy;
    if (y < 0) above = true;
    else s.grid[y * COLS + s.piece.x + cx] = s.piece.k;
  }
  for (let r = 0; r < ROWS; r++) {
    let full = true;
    for (let c = 0; c < COLS && full; c++) full = s.grid[r * COLS + c] >= 0;
    if (full) ev.cleared.push(r);
  }
  for (const r of ev.cleared) {
    s.grid.splice(r * COLS, COLS);
    s.grid.unshift(...Array<number>(COLS).fill(-1));
  }
  s.lines += ev.cleared.length;
  s.score += LINE_POINTS[ev.cleared.length];
  if (s.lines >= s.goal) ev.won = true;
  else if (above || !spawn(s)) ev.over = true;
  return ev;
}

/** One row down (soft drop): a point per row. Locks if it can't. */
export function softDrop(s: State): StepEvents {
  if (move0(s, 1)) {
    s.score += 1;
    s.fall = 0;
    return none();
  }
  return lockPiece(s);
}

/** Straight down and lock: two points per row. */
export function hardDrop(s: State): StepEvents {
  const n = dropDistance(s);
  s.piece = { ...s.piece, y: s.piece.y + n };
  s.score += 2 * n;
  return lockPiece(s);
}

function move0(s: State, dy: number): boolean {
  const p = { ...s.piece, y: s.piece.y + dy };
  if (!fits(s, p)) return false;
  s.piece = p;
  return true;
}

/** Gravity and lock delay. */
export function step(s: State, dt: number): StepEvents {
  if (grounded(s)) {
    s.lock += dt;
    if (s.lock >= LOCK_S) return lockPiece(s);
    return none();
  }
  s.fall += dt;
  while (s.fall >= s.gravity) {
    s.fall -= s.gravity;
    if (!move0(s, 1)) break;
  }
  return none();
}
