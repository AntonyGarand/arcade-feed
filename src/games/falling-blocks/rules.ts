import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

export const COLS = 10;
export const ROWS = 20;
/** Cell value of a garbage block (pieces use 0–6). */
export const GARBAGE = 7;
/** Cell value of a bomb in the rubble: clearing its row blows up the rows next to it too. */
export const BOMB = 8;
/** Shape index of the bomb piece (a combo reward): where it lands, it blasts three rows away. */
export const BOMB_PIECE = 7;
/** Points per row blown up by a bomb. */
export const BLAST_POINTS = 150;
/** Clears in a row that fire a combo event: slow fall, a bomb piece, two bomb pieces. */
export const COMBO_TIERS = [3, 6, 10] as const;
export type Reward = 'slow' | 'bomb' | 'bombs';
const REWARDS: readonly Reward[] = ['slow', 'bomb', 'bombs'];
/** Pieces that fall at half speed after a slow-fall reward. */
const SLOW_PIECES = 8;
/** Bonus per earlier clear in the same combo. */
const COMBO_POINTS = 50;

/** The kinds of level: what the rubble looks like and how the board fights back. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'well' },
  { id: 'rising', min: 2 },
  { id: 'bombs', min: 2 },
  { id: 'speed', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Rising rubble: a new row pushes up from the bottom every this many pieces. */
export const riseFor = (d: Difficulty) => byLevel(d, [9, 8, 7, 7, 6]);
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
  { n: 1, cells: [[0, 0]] }, // bomb
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
  kind: KindId;
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
  /** Lines cleared by consecutive clearing locks (a lock that clears nothing ends it), clearing locks in it, milestones reached. */
  combo: number;
  clears: number;
  tier: number;
  /** Pieces left that fall at half speed. */
  slow: number;
  /** Pieces locked so far (rising rubble comes every `rise` of them; 0: never). */
  pieces: number;
  rise: number;
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
  s.piece = { k, rot: 0, x: k === 1 || k === BOMB_PIECE ? 4 : 3, y: 0 };
  s.fall = 0;
  s.lock = 0;
  s.resets = 0;
  return fits(s, s.piece);
}

/** A row of rubble with a hole (or two, when `ragged`), and a bomb in it now and then. */
function rubbleRow(rng: Rng, hole: number, ragged: boolean, bomb: number): number[] {
  const holes = new Set([hole]);
  if (ragged && rng.chance(0.5)) holes.add(rng.int(0, COLS - 1));
  const row: number[] = Array.from({ length: COLS }, (_, c) => (holes.has(c) ? -1 : GARBAGE));
  if (rng.chance(bomb)) {
    const at = rng.pick(row.flatMap((v, c) => (v >= 0 ? [c] : [])));
    row[at] = BOMB;
  }
  return row;
}

/** Odds of a bomb in each row of rubble, by kind. */
const bombOdds = (d: Difficulty, kind: KindId) => (kind === 'bombs' ? 0.5 : d >= 4 ? 0.12 : 0);

/**
 * Deal a level: its kind, rows of garbage at the bottom (each with a hole or two; wells line the holes
 * up in a column for three rows at a time) and the first piece.
 */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const grid: number[] = Array(COLS * ROWS).fill(-1);
  // Rising rubble starts lower: more comes up.
  const rows = kind === 'rising' ? Math.max(1, garbageFor(d) - 2) : garbageFor(d);
  let well = rng.int(0, COLS - 1);
  for (let r = ROWS - rows; r < ROWS; r++) {
    if ((ROWS - r) % 3 === 0) well = rng.int(0, COLS - 1);
    // Higher garbage gets ragged: a second hole now and then.
    const row = rubbleRow(rng, kind === 'well' ? well : rng.int(0, COLS - 1), kind !== 'well' && r < ROWS - 4, bombOdds(d, kind));
    for (let c = 0; c < COLS; c++) grid[r * COLS + c] = row[c];
  }
  const s: State = {
    d,
    kind,
    grid,
    piece: { k: 0, rot: 0, x: 3, y: 0 },
    queue: [],
    lines: 0,
    goal: goalFor(d),
    score: 0,
    // Speed-up starts slower and gets faster with every line.
    gravity: gravityFor(d) * (kind === 'speed' ? 1.5 : 1),
    fall: 0,
    lock: 0,
    resets: 0,
    rng,
    combo: 0,
    clears: 0,
    tier: 0,
    slow: 0,
    pieces: 0,
    rise: kind === 'rising' ? riseFor(d) : 0,
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
  /** Full rows cleared by the lock (indices before the clear). */
  cleared: number[];
  /** Rows blown up by bombs (indices before the clear; not in `cleared`). */
  blasted: number[];
  /** Where a bomb went off (a bomb piece, or a bomb cell in a cleared row). */
  booms: { x: number; y: number }[];
  /** Combo milestone reached by this lock (1-based, 0: none) and its reward. */
  tier: number;
  reward: Reward | null;
  /** A row of rubble rose from the bottom. */
  rose: boolean;
  won: boolean;
  over: boolean;
}

const none = (): StepEvents => ({
  locked: false,
  cleared: [],
  blasted: [],
  booms: [],
  tier: 0,
  reward: null,
  rose: false,
  won: false,
  over: false,
});

const filled = (s: State, r: number) => s.grid.slice(r * COLS, r * COLS + COLS).some((v) => v >= 0);

/** Give a combo reward: slow fall, or bomb pieces next in line. */
export function grant(s: State, r: Reward) {
  if (r === 'slow') s.slow = SLOW_PIECES;
  else s.queue.unshift(...(r === 'bomb' ? [BOMB_PIECE] : [BOMB_PIECE, BOMB_PIECE]));
}

/** Push a row of rubble up from the bottom. False if the stack spills over the top. */
function rise(s: State): boolean {
  const spill = filled(s, 0);
  s.grid.splice(0, COLS);
  s.grid.push(...rubbleRow(s.rng, s.rng.int(0, COLS - 1), false, bombOdds(s.d, s.kind)));
  return !spill;
}

/** Fix the piece in place (or set off a bomb piece), clear full rows and blasts, count the combo, check the goal and bring the next piece. */
function lockPiece(s: State): StepEvents {
  const ev = none();
  ev.locked = true;
  let above = false;
  const blast = new Set<number>();
  if (s.piece.k === BOMB_PIECE) {
    // A bomb piece blows up its own row and the two under it.
    const y = Math.max(0, s.piece.y);
    ev.booms.push({ x: s.piece.x, y });
    for (let r = y; r < Math.min(ROWS, y + 3); r++) if (filled(s, r)) blast.add(r);
  } else
    for (const [cx, cy] of shapeCells(s.piece.k, s.piece.rot)) {
      const y = s.piece.y + cy;
      if (y < 0) above = true;
      else s.grid[y * COLS + s.piece.x + cx] = s.piece.k;
    }
  for (let r = 0; r < ROWS; r++) {
    let full = true;
    for (let c = 0; c < COLS && full; c++) full = s.grid[r * COLS + c] >= 0;
    if (!full) continue;
    ev.cleared.push(r);
    // A bomb in a full row takes the rows next to it along.
    const b = s.grid.slice(r * COLS, r * COLS + COLS).indexOf(BOMB);
    if (b >= 0) {
      ev.booms.push({ x: b, y: r });
      for (const n of [r - 1, r + 1]) if (n >= 0 && n < ROWS && filled(s, n)) blast.add(n);
    }
  }
  for (const r of ev.cleared) blast.delete(r);
  ev.blasted = [...blast].sort((a, b) => a - b);
  const gone = new Set([...ev.cleared, ...ev.blasted]);
  if (gone.size) {
    const keep = s.grid.filter((_, i) => !gone.has(Math.floor(i / COLS)));
    s.grid = [...Array<number>(gone.size * COLS).fill(-1), ...keep];
  }
  s.lines += gone.size;
  s.score += LINE_POINTS[Math.min(4, ev.cleared.length)] + ev.blasted.length * BLAST_POINTS;
  // Combo: lines from locks that clear one after the other.
  if (gone.size) {
    s.score += COMBO_POINTS * s.clears;
    s.clears++;
    s.combo += gone.size;
    if (s.tier < COMBO_TIERS.length && s.combo >= COMBO_TIERS[s.tier]) {
      ev.reward = REWARDS[s.tier];
      ev.tier = ++s.tier;
      grant(s, ev.reward);
    }
    if (s.kind === 'speed') s.gravity = Math.max(gravityFor(s.d) * 0.6, s.gravity * 0.93 ** gone.size);
  } else s.combo = s.clears = s.tier = 0;
  s.pieces++;
  if (s.slow > 0) s.slow--;
  if (s.lines >= s.goal) ev.won = true;
  else if (above) ev.over = true;
  else {
    if (s.rise && s.pieces % s.rise === 0) {
      ev.rose = true;
      if (!rise(s)) ev.over = true;
    }
    if (!ev.over && !spawn(s)) ev.over = true;
  }
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
  const g = s.gravity * (s.slow > 0 ? 2 : 1);
  while (s.fall >= g) {
    s.fall -= g;

    if (!move0(s, 1)) break;
  }
  return none();
}
