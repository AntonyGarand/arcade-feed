import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { DX, DY, type Dir } from '../../kits/gesture/gesture';

/** The field in cells; the outer ring starts claimed. */
export const COLS = 56;
export const ROWS = 68;
const N = COLS * ROWS;
export const LIVES = 3;
/** Clear bonus: per life left, per second under par, per percent beyond the goal. */
export const LIFE_BONUS = 100;
export const TIME_POINTS = 5;
export const OVER_POINTS = 20;
/** Marker speed in cells per second. */
export const MARKER_SPEED = 15;
/** Seconds of safety after losing a life (the marker blinks). */
const SAFE_S = 1.6;
/** How close (in cells) a spark must come to the drawing marker to hit it. */
const TOUCH = 1.4;

/** Cell values. Wall: claimed from the start (frame, notches); claimed: won by the player. */
export const OPEN = 0;
export const WALL = 1;
export const CLAIMED = 2;
export const TRAIL = 3;

export const goalFor = (d: Difficulty) => byLevel(d, [65, 70, 72, 75, 78]);
export const sparksFor = (d: Difficulty) => byLevel(d, [1, 1, 2, 2, 3]);
export const crawlersFor = (d: Difficulty) => byLevel(d, [0, 1, 1, 2, 2]);
/** Spark speed along each axis, in cells per second (they fly diagonally). */
export const sparkSpeedFor = (d: Difficulty) => byLevel(d, [8, 9, 10, 11, 12]);
const crawlSpeedFor = (d: Difficulty) => byLevel(d, [0, 8, 9, 10, 11]);
/** Pre-claimed blocks along the edges, so every field has its own shape. */
const notchesFor = (d: Difficulty) => byLevel(d, [0, 1, 2, 2, 3]);
export const parFor = (d: Difficulty) => byLevel(d, [60, 70, 80, 90, 100]);

/**
 * Two stars: a clear with a life to spare. Three: no life lost, mostly big captures, and a quarter of
 * the par time to spare.
 */
export const starGoals = (d: Difficulty): [number, number] => {
  const base = goalFor(d) * 10;
  return [Math.round(base * 1.1) + 2 * LIFE_BONUS, Math.round(base * 1.25) + 3 * LIFE_BONUS + Math.round(parFor(d) * 0.25) * TIME_POINTS];
};

/** A spark: a point (in cells) bouncing diagonally inside the open area. */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A crawler patrols the edge of the claimed ground, one cell at a time. */
interface Crawler {
  pos: number;
  dir: Dir;
  /** Which way it prefers to turn: 1 clockwise, -1 counter-clockwise. */
  hand: 1 | -1;
  acc: number;
  /** Last cells visited, so it keeps going instead of circling. */
  memo: number[];
}

export interface State {
  d: Difficulty;
  grid: Uint8Array;
  goal: number;
  /** Open cells at the start (the 100 %), and how many the player has claimed. */
  open0: number;
  claimed: number;
  /** Marker cell and heading (-1: stopped). `last` is the direction of the last step. */
  pos: number;
  dir: Dir | -1;
  last: Dir;
  drawing: boolean;
  /** Where the current trail left the claimed ground, and its cells in order. */
  start: number;
  trail: number[];
  acc: number;
  sparks: Spark[];
  sparkSpeed: number;
  crawlers: Crawler[];
  crawlSpeed: number;
  lives: number;
  safe: number;
  time: number;
  score: number;
  /** Marker steps so far, and the biggest single capture (percent). */
  steps: number;
  best: number;
  over: boolean;
  won: boolean;
}

export const idx = (c: number, r: number) => r * COLS + c;
const solid = (v: number) => v === WALL || v === CLAIMED;
export const START = idx(COLS >> 1, ROWS - 1);

/** The neighbour of cell `i` in direction `d`, or -1 off the field. */
export function next(i: number, d: Dir): number {
  const c = (i % COLS) + DX[d];
  const r = Math.floor(i / COLS) + DY[d];
  return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : idx(c, r);
}

/** A claimed cell touching (8 ways) a cell that isn't: where the marker and the crawlers can go. */
export function isEdge(s: State, i: number): boolean {
  if (i < 0 || !solid(s.grid[i])) return false;
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if ((dc || dr) && cc >= 0 && rr >= 0 && cc < COLS && rr < ROWS && !solid(s.grid[idx(cc, rr)])) return true;
    }
  return false;
}

/** The nearest cell to `from` (4-way steps through any cell) that passes `ok`. */
function nearest(from: number, ok: (i: number) => boolean): number {
  const seen = new Uint8Array(N);
  const todo = [from];
  seen[from] = 1;
  for (let k = 0; k < todo.length; k++) {
    const i = todo[k];
    if (ok(i)) return i;
    for (let d = 0; d < 4; d++) {
      const j = next(i, d as Dir);
      if (j >= 0 && !seen[j]) {
        seen[j] = 1;
        todo.push(j);
      }
    }
  }
  return from;
}

/** Deal a field: the claimed frame, a few seeded notches, sparks in the upper part and crawlers on top. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const grid = new Uint8Array(N);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1) grid[idx(c, r)] = WALL;
  const mid = COLS >> 1;
  for (let k = 0; k < notchesFor(d); k++) {
    const side = rng.int(0, 3);
    const along = side % 2 === 0 ? COLS : ROWS;
    const len = rng.int(7, 14);
    const depth = rng.int(4, 9);
    let a = rng.int(4, along - 5 - len);
    // Keep the middle of the top and bottom edges clear: the marker and the crawlers start there.
    if (side % 2 === 0 && a < mid + 6 && a + len > mid - 6) a = rng.chance(0.5) ? mid - 6 - len : mid + 6;
    for (let t = 0; t < len; t++)
      for (let u = 0; u < depth; u++) {
        const c = side === 0 || side === 2 ? a + t : side === 1 ? COLS - 1 - u : u;
        const r = side === 1 || side === 3 ? a + t : side === 0 ? u : ROWS - 1 - u;
        grid[idx(c, r)] = WALL;
      }
  }
  let open0 = 0;
  for (const v of grid) if (v === OPEN) open0++;
  const s: State = {
    d,
    grid,
    goal: goalFor(d),
    open0,
    claimed: 0,
    pos: START,
    dir: -1,
    last: 0,
    drawing: false,
    start: START,
    trail: [],
    acc: 0,
    sparks: [],
    sparkSpeed: sparkSpeedFor(d),
    crawlers: [],
    crawlSpeed: crawlSpeedFor(d),
    lives: LIVES,
    safe: 0,
    time: 0,
    score: 0,
    steps: 0,
    best: 0,
    over: false,
    won: false,
  };
  const roomy = (c: number, r: number) => {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (grid[idx(c + dc, r + dr)] !== OPEN) return false;
    return true;
  };
  for (let k = 0; k < sparksFor(d); k++) {
    let c = mid;
    let r = 12;
    for (let tries = 0; tries < 200; tries++) {
      c = rng.int(4, COLS - 5);
      r = rng.int(6, Math.floor(ROWS * 0.55));
      if (roomy(c, r)) break;
    }
    const v = s.sparkSpeed;
    s.sparks.push({ x: c + 0.5, y: r + 0.5, vx: rng.chance(0.5) ? v : -v, vy: rng.chance(0.5) ? v : -v });
  }
  for (let k = 0; k < crawlersFor(d); k++) {
    const pos = nearest(idx(mid + (k ? -2 : 2), 0), (i) => isEdge(s, i));
    s.crawlers.push({ pos, dir: k ? 3 : 1, hand: k ? -1 : 1, acc: 0, memo: [] });
  }
  return s;
}

/** Steer: the marker heads that way (a trail can't turn straight back on itself). */
export function turn(s: State, dir: Dir) {
  if (s.drawing && dir === (s.last + 2) % 4) return;
  s.dir = dir;
}

/** Stop on the claimed ground (a trail keeps going until it closes). */
export function stop(s: State) {
  if (!s.drawing) s.dir = -1;
}

/** Percent of the field claimed so far. */
export const percent = (s: State) => (s.claimed / s.open0) * 100;

/** Points for one capture of `pct` percent: bigger captures pay more per percent. */
const capturePoints = (pct: number) => Math.round(pct * 10 * (1 + pct / 25));

export interface StepEvents {
  /** The marker left the claimed ground (a trail starts). */
  started: boolean;
  /** Cells claimed by a capture this step (the trail first), its points and size in percent. */
  fresh: number[];
  gain: number;
  pct: number;
  /** A life was lost; `hitAt` is the cell where it happened. */
  lostLife: boolean;
  hitAt: number;
  /** Clear bonus (percent beyond the goal, lives, time). */
  bonus: number;
  won: boolean;
  over: boolean;
}

/** The largest 4-connected open area, as a mask. */
function biggestArea(s: State): Uint8Array {
  const label = new Int32Array(N);
  let best = 0;
  let bestSize = 0;
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (s.grid[i] !== OPEN || label[i]) continue;
    n++;
    label[i] = n;
    const todo = [i];
    for (let k = 0; k < todo.length; k++)
      for (let d = 0; d < 4; d++) {
        const j = next(todo[k], d as Dir);
        if (j >= 0 && s.grid[j] === OPEN && !label[j]) {
          label[j] = n;
          todo.push(j);
        }
      }
    if (todo.length > bestSize) {
      bestSize = todo.length;
      best = n;
    }
  }
  return Uint8Array.from(label, (l) => (l === best && best ? 1 : 0));
}

/** Close the trail: claim it, then every open cell no spark can reach. */
function capture(s: State, ev: StepEvents) {
  const fresh = s.trail.slice();
  for (const t of fresh) s.grid[t] = CLAIMED;
  const seen = new Uint8Array(N);
  const todo: number[] = [];
  const seed = (i: number) => {
    if (i >= 0 && s.grid[i] === OPEN && !seen[i]) {
      seen[i] = 1;
      todo.push(i);
    }
  };
  for (const k of s.sparks) {
    const i = idx(Math.floor(k.x), Math.floor(k.y));
    seed(i);
    for (let d = 0; d < 4; d++) seed(next(i, d as Dir));
  }
  for (let k = 0; k < todo.length; k++) for (let d = 0; d < 4; d++) seed(next(todo[k], d as Dir));
  for (let i = 0; i < N; i++)
    if (s.grid[i] === OPEN && !seen[i]) {
      s.grid[i] = CLAIMED;
      fresh.push(i);
    }
  s.claimed += fresh.length;
  s.trail = [];
  s.drawing = false;
  s.dir = -1;
  const pct = (fresh.length / s.open0) * 100;
  ev.fresh = fresh;
  ev.pct = pct;
  ev.gain = capturePoints(pct);
  s.score += ev.gain;
  s.best = Math.max(s.best, pct);
  // Claimed ground can swallow the marker or cut it off on a small pocket: move it to the edge of the
  // biggest open area. Crawlers just move to the nearest edge.
  const main = biggestArea(s);
  const onMain = (i: number) => {
    if (!isEdge(s, i)) return false;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const c = (i % COLS) + dc;
        const r = Math.floor(i / COLS) + dr;
        if (c >= 0 && r >= 0 && c < COLS && r < ROWS && main[idx(c, r)]) return true;
      }
    return false;
  };
  if (!onMain(s.pos)) s.pos = nearest(s.pos, onMain);
  const px = s.pos % COLS;
  const py = Math.floor(s.pos / COLS);
  for (const cr of s.crawlers)
    if (!isEdge(s, cr.pos)) {
      cr.pos = nearest(cr.pos, (i) => isEdge(s, i));
      cr.memo = [];
      if (Math.max(Math.abs((cr.pos % COLS) - px), Math.abs(Math.floor(cr.pos / COLS) - py)) < 6) s.safe = Math.max(s.safe, 1);
    }
  if (percent(s) >= s.goal) {
    s.won = true;
    ev.won = true;
    ev.bonus =
      Math.round((percent(s) - s.goal) * OVER_POINTS) + s.lives * LIFE_BONUS + Math.round(Math.max(0, parFor(s.d) - s.time)) * TIME_POINTS;
    s.score += ev.bonus;
  }
}

/** One marker step along its heading. */
function moveMarker(s: State, ev: StepEvents) {
  if (s.dir === -1) return;
  const dir = s.dir;
  const j = next(s.pos, dir);
  const v = j < 0 ? WALL : s.grid[j];
  if (!s.drawing) {
    if (j >= 0 && v === OPEN) {
      s.drawing = true;
      s.start = s.pos;
      s.trail = [];
      ev.started = true;
    } else if (!isEdge(s, j)) {
      s.dir = -1;
      return;
    }
  } else if (v === TRAIL) return; // can't cross the trail: wait for a turn
  s.pos = j;
  s.last = dir;
  s.steps++;
  if (!s.drawing || v === TRAIL) return;
  if (v === OPEN) {
    s.grid[j] = TRAIL;
    s.trail.push(j);
  } else capture(s, ev);
}

function moveSpark(s: State, k: Spark, dt: number) {
  const blocked = (x: number, y: number) => {
    const c = Math.floor(x);
    const r = Math.floor(y);
    return c < 0 || r < 0 || c >= COLS || r >= ROWS || solid(s.grid[idx(c, r)]);
  };
  const n = Math.ceil((s.sparkSpeed * dt) / 0.3);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const nx = k.x + k.vx * h;
    if (blocked(nx + Math.sign(k.vx) * 0.5, k.y)) k.vx = -k.vx;
    else k.x = nx;
    const ny = k.y + k.vy * h;
    if (blocked(k.x, ny + Math.sign(k.vy) * 0.5)) k.vy = -k.vy;
    else k.y = ny;
  }
}

function moveCrawler(s: State, cr: Crawler) {
  const turns: Dir[] = [cr.dir, ((cr.dir + 4 + cr.hand) % 4) as Dir, ((cr.dir + 4 - cr.hand) % 4) as Dir, ((cr.dir + 2) % 4) as Dir];
  let pick: Dir | -1 = -1;
  for (const d of turns) {
    const j = next(cr.pos, d);
    if (!isEdge(s, j)) continue;
    if (pick === -1) pick = d;
    if (!cr.memo.includes(j)) {
      pick = d;
      break;
    }
  }
  if (pick === -1) return;
  cr.dir = pick;
  cr.pos = next(cr.pos, pick);
  cr.memo.push(cr.pos);
  if (cr.memo.length > 6) cr.memo.shift();
}

/** Did an enemy hit the trail or the marker? Returns the cell, or -1. */
function hit(s: State): number {
  if (s.safe > 0) return -1;
  const mc = s.pos % COLS;
  const mr = Math.floor(s.pos / COLS);
  for (const cr of s.crawlers) if (Math.max(Math.abs((cr.pos % COLS) - mc), Math.abs(Math.floor(cr.pos / COLS) - mr)) <= 1) return s.pos;
  if (!s.drawing) return -1;
  for (const k of s.sparks) {
    if (Math.hypot(k.x - mc - 0.5, k.y - mr - 0.5) < TOUCH) return s.pos;
    const c = Math.floor(k.x);
    const r = Math.floor(k.y);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < COLS && rr < ROWS && s.grid[idx(cc, rr)] === TRAIL) return idx(cc, rr);
      }
  }
  return -1;
}

/** Advance by `dt` seconds: the marker, then the enemies, then collisions. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { started: false, fresh: [], gain: 0, pct: 0, lostLife: false, hitAt: -1, bonus: 0, won: false, over: false };
  if (s.over || s.won) return ev;
  s.time += dt;
  s.safe = Math.max(0, s.safe - dt);
  s.acc += dt * MARKER_SPEED;
  while (s.acc >= 1) {
    s.acc -= 1;
    moveMarker(s, ev);
    if (ev.won) return ev;
  }
  if (s.dir < 0) s.acc = 0;
  for (const k of s.sparks) moveSpark(s, k, dt);
  for (const cr of s.crawlers) for (cr.acc += dt * s.crawlSpeed; cr.acc >= 1; cr.acc--) moveCrawler(s, cr);
  const at = hit(s);
  if (at >= 0) {
    ev.lostLife = true;
    ev.hitAt = at;
    s.lives--;
    for (const t of s.trail) s.grid[t] = OPEN;
    s.trail = [];
    if (s.drawing) s.pos = s.start;
    s.drawing = false;
    s.dir = -1;
    s.safe = SAFE_S;
    if (s.lives <= 0) {
      s.over = true;
      ev.over = true;
    }
  }
  return ev;
}
