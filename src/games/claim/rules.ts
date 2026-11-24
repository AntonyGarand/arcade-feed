import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';
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
/** Gems hidden in the open field: claim the ground under one to collect it. */
export const gemsFor = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 3]);
export const GEM_POINTS = 40;
/** Points for a mine shut inside a capture (defused). */
export const MINE_POINTS = 20;
/** Seconds between two captures before the streak ends, and the smallest capture (percent) that counts. */
export const STREAK_WINDOW = 6;
const STREAK_MIN_PCT = 0.5;
/** Streak lengths that fire a combo event: freeze, shield, double points, then a long freeze and a shield. */
export const STREAK_TIERS = [3, 5, 8, 12] as const;
export type Power = 'freeze' | 'shield' | 'double' | 'storm';
const TIER_POWERS: readonly Power[] = ['freeze', 'shield', 'double', 'storm'];
/** Seconds the enemies stay frozen, and double points last. */
export const FREEZE_S = 4;
const STORM_FREEZE_S = 6;
export const DOUBLE_S = 10;
/** Seconds between two turns of a seeker spark towards the drawing marker. */
const SEEK_S = 1.1;

/** The kinds of field a level can deal. */
export const KINDS = [
  { id: 'open', weight: 2 },
  { id: 'rocks' },
  { id: 'swarm', min: 2 },
  { id: 'minefield', min: 2 },
  { id: 'hunt', min: 2 },
  { id: 'comet', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/**
 * Two stars: a clear with a life to spare. Three: no life lost, mostly big captures, and a quarter of
 * the par time to spare. Set a little above the bare captures, since streak powers (double points)
 * and gems add to every kind of field.
 */
export const starGoals = (d: Difficulty): [number, number] => {
  const base = goalFor(d) * 10;
  return [Math.round(base * 1.25) + 2 * LIFE_BONUS, Math.round(base * 1.5) + 3 * LIFE_BONUS + Math.round(parFor(d) * 0.25) * TIME_POINTS];
};

/** A spark: a point (in cells) bouncing diagonally inside the open area. */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** A seeker turns towards the marker every `SEEK_S` while it draws; `aim` counts down to the next turn. */
  seek?: boolean;
  aim?: number;
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
  kind: KindId;
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
  /** Mines (cells) in the open: drawing over one costs a life. Gems (cells): claim them for points. */
  mines: number[];
  gems: number[];
  /** Captures in a quick row, seconds left before it ends, and milestones reached (index into `STREAK_TIERS`). */
  streak: number;
  streakLeft: number;
  tier: number;
  /** Seconds the enemies stay frozen, hits the shield will absorb, seconds of double points left. */
  freeze: number;
  shield: number;
  double: number;
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

/**
 * Deal a field: its kind, the claimed frame, a few seeded notches, rocks, mines and gems, sparks in the
 * upper part and crawlers on top.
 */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
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
  /** No wall cell within `m` cells of (c, r)? */
  const clearOf = (c: number, r: number, m: number) => {
    for (let dr = -m; dr <= m; dr++)
      for (let dc = -m; dc <= m; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS || grid[idx(cc, rr)] !== OPEN) return false;
      }
    return true;
  };
  // Rocks: claimed islands in the open, which sparks bounce off and lines can close on.
  if (kind === 'rocks') {
    const want = rng.int(4, 6);
    for (let k = 0, tries = 0; k < want && tries < 300; tries++) {
      const w = rng.int(4, 9);
      const h = rng.int(4, 8);
      const c0 = rng.int(6, COLS - 7 - w);
      const r0 = rng.int(8, ROWS - 9 - h);
      let ok = true;
      for (let r = r0; r < r0 + h && ok; r++) for (let c = c0; c < c0 + w && ok; c++) ok = clearOf(c, r, 4);
      if (!ok) continue;
      // Corners knocked off, so each rock reads as a boulder.
      for (let r = r0; r < r0 + h; r++)
        for (let c = c0; c < c0 + w; c++) if (!((r === r0 || r === r0 + h - 1) && (c === c0 || c === c0 + w - 1))) grid[idx(c, r)] = WALL;
      k++;
    }
  }
  const sc = START % COLS;
  const sr = Math.floor(START / COLS);
  /** Seeded open cells away from walls, the start and each other. */
  const scatter = (n: number, taken: number[]) => {
    const out: number[] = [];
    for (let tries = 0; out.length < n && tries < 400; tries++) {
      const c = rng.int(5, COLS - 6);
      const r = rng.int(5, ROWS - 6);
      if (!clearOf(c, r, 3) || Math.hypot(c - sc, r - sr) < 10) continue;
      if ([...taken, ...out].some((i) => Math.abs((i % COLS) - c) + Math.abs(Math.floor(i / COLS) - r) < 6)) continue;
      out.push(idx(c, r));
    }
    return out;
  };
  const mineCount = kind === 'minefield' ? byLevel(d, [4, 5, 6, 7, 8]) : d >= 4 && kind !== 'comet' ? 2 : 0;
  const mines = scatter(mineCount, []);
  const gems = scatter(gemsFor(d), mines);
  let open0 = 0;
  for (const v of grid) if (v === OPEN) open0++;
  // Enemy mix: a swarm of slow sparks, fewer comets that fly fast, or a seeker that hunts your line.
  const sparkN = kind === 'swarm' ? sparksFor(d) + 2 : kind === 'comet' ? Math.max(1, sparksFor(d) - 1) : sparksFor(d);
  const speed = sparkSpeedFor(d) * (kind === 'swarm' ? 0.65 : kind === 'comet' ? 1.45 : 1);
  const crawlN = kind === 'swarm' ? Math.max(0, crawlersFor(d) - 1) : crawlersFor(d);
  const s: State = {
    d,
    kind,
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
    sparkSpeed: speed,
    crawlers: [],
    crawlSpeed: crawlSpeedFor(d),
    lives: LIVES,
    safe: 0,
    time: 0,
    score: 0,
    steps: 0,
    best: 0,
    mines,
    gems,
    streak: 0,
    streakLeft: 0,
    tier: 0,
    freeze: 0,
    shield: 0,
    double: 0,
    over: false,
    won: false,
  };
  const roomy = (c: number, r: number) => {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (grid[idx(c + dc, r + dr)] !== OPEN) return false;
    return true;
  };
  for (let k = 0; k < sparkN; k++) {
    let c = mid;
    let r = 12;
    for (let tries = 0; tries < 200; tries++) {
      c = rng.int(4, COLS - 5);
      r = rng.int(6, Math.floor(ROWS * 0.55));
      if (roomy(c, r)) break;
    }
    const seek = kind === 'hunt' && k === 0;
    const v = seek ? s.sparkSpeed * 0.85 : s.sparkSpeed;
    const spark: Spark = { x: c + 0.5, y: r + 0.5, vx: rng.chance(0.5) ? v : -v, vy: rng.chance(0.5) ? v : -v };
    if (seek) Object.assign(spark, { seek, aim: SEEK_S });
    s.sparks.push(spark);
  }
  for (let k = 0; k < crawlN; k++) {
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
  /** Gems collected and mines defused by a capture this step (cells); their points are in `gain`. */
  gems: number[];
  defused: number[];
  /** A mine went off under the marker (cell), or -1. */
  boom: number;
  /** The shield absorbed a hit this step (at `hitAt`). */
  shielded: boolean;
  /** A streak milestone reached this step (1-based) and what it unlocked; 0 for none. */
  tier: number;
  unlocked: Power | null;
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
  ev.gain = capturePoints(pct) * (s.double > 0 ? 2 : 1);
  s.best = Math.max(s.best, pct);
  // Gems and mines shut in the new ground.
  ev.gems = s.gems.filter((i) => s.grid[i] === CLAIMED);
  ev.defused = s.mines.filter((i) => s.grid[i] === CLAIMED);
  s.gems = s.gems.filter((i) => s.grid[i] !== CLAIMED);
  s.mines = s.mines.filter((i) => s.grid[i] !== CLAIMED);
  ev.gain += ev.gems.length * GEM_POINTS + ev.defused.length * MINE_POINTS;
  s.score += ev.gain;
  if (pct >= STREAK_MIN_PCT) addStreak(s, ev);
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

/** Turn a power on: enemies freeze, a shield, double points, or a long freeze with a shield. */
export function grant(s: State, p: Power) {
  if (p === 'freeze') s.freeze = Math.max(s.freeze, FREEZE_S);
  else if (p === 'shield') s.shield = Math.min(2, s.shield + 1);
  else if (p === 'double') s.double = DOUBLE_S;
  else {
    s.freeze = Math.max(s.freeze, STORM_FREEZE_S);
    s.shield = Math.min(2, s.shield + 1);
  }
}

/** One more capture in the streak: past a milestone, unlock its power. */
function addStreak(s: State, ev: StepEvents) {
  s.streak++;
  s.streakLeft = STREAK_WINDOW;
  if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
    const p = TIER_POWERS[s.tier];
    s.tier++;
    grant(s, p);
    ev.tier = s.tier;
    ev.unlocked = p;
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
    if (s.safe <= 0 && s.mines.includes(j)) ev.boom = j;
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

/** Point a seeker diagonally towards cell `to`, keeping its speed. */
function aimAt(k: Spark, to: number) {
  const v = Math.abs(k.vx);
  const dx = (to % COLS) + 0.5 - k.x;
  const dy = Math.floor(to / COLS) + 0.5 - k.y;
  if (Math.abs(dx) > 1) k.vx = Math.sign(dx) * v;
  if (Math.abs(dy) > 1) k.vy = Math.sign(dy) * v;
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
  const ev: StepEvents = {
    started: false,
    fresh: [],
    gain: 0,
    pct: 0,
    gems: [],
    defused: [],
    boom: -1,
    shielded: false,
    tier: 0,
    unlocked: null,
    lostLife: false,
    hitAt: -1,
    bonus: 0,
    won: false,
    over: false,
  };
  if (s.over || s.won) return ev;
  s.time += dt;
  s.safe = Math.max(0, s.safe - dt);
  s.double = Math.max(0, s.double - dt);
  if (s.streak && (s.streakLeft -= dt) <= 0) s.streak = s.tier = 0;
  s.acc += dt * MARKER_SPEED;
  while (s.acc >= 1) {
    s.acc -= 1;
    moveMarker(s, ev);
    if (ev.won) return ev;
    if (ev.boom >= 0) break;
  }
  if (s.dir < 0) s.acc = 0;
  if (s.freeze > 0) s.freeze = Math.max(0, s.freeze - dt);
  else {
    for (const k of s.sparks) {
      if (k.seek && (k.aim = (k.aim ?? SEEK_S) - dt) <= 0) {
        k.aim = SEEK_S;
        if (s.drawing) aimAt(k, s.pos);
      }
      moveSpark(s, k, dt);
    }
    for (const cr of s.crawlers) for (cr.acc += dt * s.crawlSpeed; cr.acc >= 1; cr.acc--) moveCrawler(s, cr);
  }
  // A mine goes off once, whatever happens next.
  if (ev.boom >= 0) s.mines = s.mines.filter((i) => i !== ev.boom);
  const at = ev.boom >= 0 ? ev.boom : hit(s);
  if (at >= 0 && s.shield > 0) {
    // The shield takes the hit: the line stays, and the marker is safe for a moment.
    s.shield--;
    s.safe = SAFE_S;
    ev.shielded = true;
    ev.hitAt = at;
  } else if (at >= 0) {
    ev.lostLife = true;
    ev.hitAt = at;
    s.lives--;
    s.streak = s.tier = 0;
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
