import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units. */
export const W = 300;
export const H = 420;
/** Bubble radius; a row holds COLS bubbles (odd rows one less, shifted half a bubble right). */
export const R = 15;
export const COLS = 10;
/** Row spacing of the hex grid. */
export const RH = R * Math.sqrt(3);
/** Ceiling height before any drop. */
const TOP = 6;
/** A bubble reaching below this line ends the run. */
export const LINE_Y = 350;
export const LAUNCH = { x: W / 2, y: 392 };
/** Grid rows tracked (the last ones only ever sit past the line). */
const ROWS = 14;
/** Steepest aim from straight up (radians). */
export const MAX_AIM = 1.35;
/** Keyboard aim speed (radians per second). */
const AIM_SPEED = 1.5;
/** Shot speed (world units per second). */
const SPEED = 720;
/** Centre distance under which a shot sticks (a little under touching, so it can slip through gaps). */
const STICK = 2 * R - 5;
export const POP_POINTS = 10;
export const DROP_POINTS = 20;
/** Bonus per free row between the ceiling and the line when the board is cleared. */
export const ROW_BONUS = 100;

export const rowsFor = (d: Difficulty) => byLevel(d, [5, 6, 7, 8, 9]);
export const coloursFor = (d: Difficulty) => byLevel(d, [3, 4, 4, 5, 5]);
/** Shots between ceiling drops. */
export const everyFor = (d: Difficulty) => byLevel(d, [8, 8, 7, 7, 6]);
/** Chance a dealt bubble copies a neighbour's colour (clumps are friendlier). */
const clumpFor = (d: Difficulty) => byLevel(d, [0.35, 0.3, 0.25, 0.22, 0.2]);

export interface Point {
  x: number;
  y: number;
}

export interface State {
  d: Difficulty;
  colours: number;
  /** Row-major colour per cell (row 0 under the ceiling), -1 when empty. */
  grid: number[];
  /** Rows the ceiling has come down. */
  drops: number;
  every: number;
  /** Shots left before the next drop. */
  untilDrop: number;
  shots: number;
  /** Colour in the launcher, and the one after it. */
  cur: number;
  next: number;
  /** Aim from straight up, radians (negative = left). */
  aim: number;
  /** Keyboard aim direction held: -1, 0 or 1. */
  turn: number;
  /** The shot in flight: its path, and how far along it is. */
  shot: Trace | null;
  travelled: number;
  score: number;
  rng: Rng;
}

/** A cell's row and column from its index (odd rows have no last column). */
const valid = (i: number) => i >= 0 && i < ROWS * COLS && !(Math.floor(i / COLS) % 2 && i % COLS === COLS - 1);
export const ceilingY = (s: State) => TOP + s.drops * RH;
export const cellX = (i: number) => R + (i % COLS) * 2 * R + (Math.floor(i / COLS) % 2 ? R : 0);
export const cellY = (s: State, i: number) => ceilingY(s) + R + Math.floor(i / COLS) * RH;

/** The up-to-six cells touching cell `i`. */
function neighbours(i: number): number[] {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  const shift = r % 2 ? 0 : -1;
  const out = [c > 0 ? i - 1 : -1, c < COLS - 1 ? i + 1 : -1];
  for (const dr of [-1, 1])
    for (const dc of [shift, shift + 1]) {
      const cc = c + dc;
      const rr = r + dr;
      if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) out.push(rr * COLS + cc);
    }
  return out.filter(valid);
}

/** Colours still on the board, in order. */
export function present(grid: readonly number[]): number[] {
  return [...new Set(grid.filter((k) => k >= 0))].sort((a, b) => a - b);
}

const pickColour = (s: State) => {
  const left = present(s.grid);
  return left.length ? s.rng.pick(left) : 0;
};

export function createLevel(d: Difficulty, rng: Rng): State {
  const colours = coloursFor(d);
  const grid: number[] = Array(ROWS * COLS).fill(-1);
  for (let i = 0; i < rowsFor(d) * COLS; i++) {
    if (!valid(i)) continue;
    const near = neighbours(i).filter((j) => j < i && grid[j] >= 0);
    grid[i] = near.length && rng.chance(clumpFor(d)) ? grid[rng.pick(near)] : rng.int(0, colours - 1);
  }
  const s: State = {
    d,
    colours,
    grid,
    drops: 0,
    every: everyFor(d),
    untilDrop: everyFor(d),
    shots: 0,
    cur: 0,
    next: 0,
    aim: 0,
    turn: 0,
    shot: null,
    travelled: 0,
    score: 0,
    rng,
  };
  s.cur = pickColour(s);
  s.next = pickColour(s);
  return s;
}

/** Aim at a point (pointer): the angle from the launcher, clamped to the allowed cone. */
export function aimAt(s: State, x: number, y: number) {
  const a = Math.atan2(x - LAUNCH.x, Math.max(1, LAUNCH.y - y));
  s.aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, a));
}

export interface Trace {
  /** Polyline from the launcher: start, each wall bounce, the stop. */
  pts: Point[];
  /** Total length of the path. */
  length: number;
  /** The cell the bubble snaps into. */
  cell: number;
}

/** Path length along a polyline at each point. */
function lengths(pts: readonly Point[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return out;
}

/** Where a shot at `aim` goes: bouncing off the side walls until it touches a bubble or the ceiling. */
export function trace(s: State, aim: number): Trace {
  let x = LAUNCH.x;
  let y = LAUNCH.y;
  let dx = Math.sin(aim);
  const dy = -Math.cos(aim);
  const pts: Point[] = [{ x, y }];
  const top = ceilingY(s);
  const h = 3;
  for (let n = 0; n < 4000; n++) {
    x += dx * h;
    y += dy * h;
    if (x < R || x > W - R) {
      // Bounce: note the exact wall contact, then mirror the overshoot.
      const wall = x < R ? R : W - R;
      const back = (x - wall) / dx;
      pts.push({ x: wall, y: y - dy * back });
      x = 2 * wall - x;
      dx = -dx;
    }
    if (y - R <= top || touching(s, x, y)) break;
  }
  pts.push({ x, y });
  return { pts, length: lengths(pts).at(-1)!, cell: snap(s, x, y) };
}

/** A shot centred at (x, y) touches a bubble. */
function touching(s: State, x: number, y: number): boolean {
  const r = Math.round((y - ceilingY(s) - R) / RH);
  for (let rr = Math.max(0, r - 1); rr <= Math.min(ROWS - 1, r + 1); rr++)
    for (let c = 0; c < COLS; c++) {
      const i = rr * COLS + c;
      if (s.grid[i] < 0) continue;
      if ((cellX(i) - x) ** 2 + (cellY(s, i) - y) ** 2 < STICK * STICK) return true;
    }
  return false;
}

/** The empty cell, under the ceiling or next to a bubble, closest to where the shot stopped. */
function snap(s: State, x: number, y: number): number {
  let best = -1;
  let dist = Infinity;
  // Nearby rows first; the whole grid only if none of them has room.
  const r = Math.round((y - ceilingY(s) - R) / RH);
  const near = (i: number) => Math.abs(Math.floor(i / COLS) - r) <= 1;
  for (const pass of [true, false]) {
    for (let i = 0; i < ROWS * COLS; i++) {
      if (!valid(i) || s.grid[i] >= 0 || (pass && !near(i))) continue;
      if (i >= COLS && !neighbours(i).some((j) => s.grid[j] >= 0)) continue;
      const d = (cellX(i) - x) ** 2 + (cellY(s, i) - y) ** 2;
      if (d < dist) [dist, best] = [d, i];
    }
    if (best >= 0) return best;
  }
  return best;
}

/** The point the shot has reached `d` along its path. */
export function along(t: Trace, d: number): Point {
  const ls = lengths(t.pts);
  for (let i = 1; i < t.pts.length; i++)
    if (d <= ls[i] || i === t.pts.length - 1) {
      const a = t.pts[i - 1];
      const b = t.pts[i];
      const f = Math.min(1, (d - ls[i - 1]) / Math.max(1e-6, ls[i] - ls[i - 1]));
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  return t.pts[0];
}

export function shoot(s: State): boolean {
  if (s.shot) return false;
  s.shot = trace(s, s.aim);
  s.travelled = 0;
  return true;
}

/** Swap the launcher's bubble with the next one. */
export function swapNext(s: State) {
  if (!s.shot) [s.cur, s.next] = [s.next, s.cur];
}

export interface Landing {
  cell: number;
  colour: number;
  /** Cells that popped (3+ of a colour) and cells that fell (cut off from the ceiling). */
  popped: number[];
  dropped: number[];
  /** Colours of the dropped cells, in the same order. */
  droppedColours: number[];
  /** The ceiling came down a row. */
  lowered: boolean;
  won: boolean;
  lost: boolean;
}

/** Cells still hanging from the ceiling through other bubbles. */
function anchored(grid: readonly number[]): Set<number> {
  const seen = new Set<number>();
  const todo: number[] = [];
  for (let c = 0; c < COLS; c++)
    if (grid[c] >= 0) {
      seen.add(c);
      todo.push(c);
    }
  for (let k = 0; k < todo.length; k++)
    for (const j of neighbours(todo[k]))
      if (grid[j] >= 0 && !seen.has(j)) {
        seen.add(j);
        todo.push(j);
      }
  return seen;
}

/** Free rows between the ceiling and the line. */
const freeRows = (s: State) => Math.max(0, Math.floor((LINE_Y - ceilingY(s)) / RH) - 1);

/** Settle the bubble in `cell`: pop its group, drop what's cut off, maybe lower the ceiling, reload. */
export function land(s: State, cell: number): Landing {
  const colour = s.cur;
  const out: Landing = { cell, colour, popped: [], dropped: [], droppedColours: [], lowered: false, won: false, lost: false };
  s.shot = null;
  s.shots++;
  if (cell >= 0) {
    s.grid[cell] = colour;
    const group = [cell];
    const seen = new Set(group);
    for (let k = 0; k < group.length; k++)
      for (const j of neighbours(group[k]))
        if (s.grid[j] === colour && !seen.has(j)) {
          seen.add(j);
          group.push(j);
        }
    if (group.length >= 3) {
      for (const i of group) s.grid[i] = -1;
      out.popped = group;
      s.score += group.length * POP_POINTS;
      const keep = anchored(s.grid);
      for (let i = 0; i < s.grid.length; i++)
        if (s.grid[i] >= 0 && !keep.has(i)) {
          out.dropped.push(i);
          out.droppedColours.push(s.grid[i]);
          s.grid[i] = -1;
        }
      s.score += out.dropped.length * DROP_POINTS;
    }
  }
  if (!present(s.grid).length) {
    out.won = true;
    s.score += freeRows(s) * ROW_BONUS;
    return out;
  }
  if (--s.untilDrop <= 0) {
    s.drops++;
    s.untilDrop = s.every;
    out.lowered = true;
  }
  out.lost = cell < 0 || s.grid.some((k, i) => k >= 0 && cellY(s, i) + R > LINE_Y);
  // Reload, keeping to colours still on the board.
  const left = present(s.grid);
  s.cur = left.includes(s.next) ? s.next : pickColour(s);
  s.next = pickColour(s);
  return out;
}

/** Advance by `dt` seconds: keyboard aim, and the shot in flight (landing when it arrives). */
export function step(s: State, dt: number): Landing | null {
  if (s.turn) s.aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, s.aim + s.turn * AIM_SPEED * dt));
  if (!s.shot) return null;
  s.travelled += SPEED * dt;
  if (s.travelled < s.shot.length) return null;
  return land(s, s.shot.cell);
}
