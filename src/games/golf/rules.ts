import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units, seen from above: the tee at the bottom, the cup near the top. */
export const W = 300;
export const H = 400;
/** Thickness of the border walls. */
export const WALL = 10;
export const BALL_R = 4.5;
export const CUP_R = 8;
const MIN_SPEED = 30;
const MAX_SPEED = 440;
/** Rolling resistance: a constant part and a part growing with speed (much stronger in sand). */
const ROLL = 70;
const DRAG = 0.7;
const SAND_ROLL = 420;
const SAND_DRAG = 2.4;
/** Over the cup slower than this, the ball drops in. */
const SINK_SPEED = 170;
const STOP_SPEED = 4;
const BOUNCE = 0.75;
/** Bumpers kick the ball back a little harder than it came. */
const BUMPER_KICK = 1.1;
/** Keyboard aim (radians/s) and power (per second) speeds. */
const TURN_SPEED = 1.5;
const POWER_SPEED = 0.7;
/** Points per stroke left under the limit when the ball drops (plus one share for holing out). */
export const STROKE_POINTS = 100;
/** Grid step (world units) of the reachability map. */
const GRID = 5;
/** Physics runs in fixed sub-steps, so a putt rolls the same at any frame rate. */
const TICK = 1 / 120;

export const parFor = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 4]);
/** Strokes allowed: par plus a few. */
export const limitFor = (d: Difficulty) => parFor(d) + 3;
const bandsFor = (d: Difficulty) => byLevel(d, [1, 2, 2, 2, 3]);
export const gapFor = (d: Difficulty) => byLevel(d, [110, 95, 85, 75, 66]);
const angledFor = (d: Difficulty) => byLevel(d, [0, 0.3, 0.45, 0.55, 0.65]);
const bumpersFor = (d: Difficulty) => byLevel(d, [0, 1, 2, 2, 3]);
const sandFor = (d: Difficulty) => byLevel(d, [0, 1, 1, 2, 2]);
const waterFor = (d: Difficulty) => byLevel(d, [0, 0, 1, 1, 2]);

/** Something the ball bounces off: a block, a round bumper or an angled rail (a thick segment). */
type Wall =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'disc'; x: number; y: number; r: number }
  | { kind: 'seg'; x1: number; y1: number; x2: number; y2: number; r: number };

interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

export interface State {
  d: Difficulty;
  walls: Wall[];
  sand: Zone[];
  water: Zone[];
  tee: Point;
  cup: Point;
  bx: number;
  by: number;
  vx: number;
  vy: number;
  /** Where the last putt started (a splash puts the ball back here). */
  rest: Point;
  rolling: boolean;
  /** Time not yet simulated (less than one tick). */
  acc: number;
  /** Aim direction (radians, screen space) and power 0–1. */
  aim: number;
  power: number;
  /** Keyboard keys held: turn −1/0/1, power −1/0/1. */
  turn: number;
  pump: number;
  strokes: number;
  par: number;
  limit: number;
  score: number;
  done: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const inZone = (z: Zone, x: number, y: number) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
/** Distance from a point to a zone (0 inside). */
const zoneDist = (z: Zone, x: number, y: number) => Math.hypot(x - clamp(x, z.x, z.x + z.w), y - clamp(y, z.y, z.y + z.h));

/** The nearest point of a wall's core to (x, y), and how far the wall reaches beyond it. */
function nearest(w: Wall, x: number, y: number): { px: number; py: number; rad: number } {
  switch (w.kind) {
    case 'rect':
      return { px: clamp(x, w.x, w.x + w.w), py: clamp(y, w.y, w.y + w.h), rad: 0 };
    case 'disc':
      return { px: w.x, py: w.y, rad: w.r };
    case 'seg': {
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const t = clamp(((x - w.x1) * dx + (y - w.y1) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      return { px: w.x1 + dx * t, py: w.y1 + dy * t, rad: w.r };
    }
  }
}

/** Gap between a point and a wall's surface (negative inside). */
function clearance(w: Wall, x: number, y: number): number {
  const { px, py, rad } = nearest(w, x, y);
  const d = Math.hypot(x - px, y - py);
  if (w.kind === 'rect' && d === 0) return -Math.min(x - w.x, w.x + w.w - x, y - w.y, w.y + w.h - y);
  return d - rad;
}

/** Can a resting ball sit here: clear of every wall and out of the water? */
const open = (s: Pick<State, 'walls' | 'water'>, x: number, y: number, margin = 0.5) =>
  s.walls.every((w) => clearance(w, x, y) > BALL_R + margin) && !s.water.some((z) => inZone(z, x, y));

const COLS = Math.ceil(W / GRID);
const ROWS = Math.ceil(H / GRID);

/**
 * Walking distance (world units, around walls and water) from every grid cell to the cup; Infinity
 * where the cup can't be reached. Generation uses it to guarantee a playable hole.
 */
export function distanceField(s: Pick<State, 'walls' | 'water' | 'cup'>): Float64Array {
  const dist = new Float64Array(COLS * ROWS).fill(Infinity);
  const free = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) free[r * COLS + c] = open(s, (c + 0.5) * GRID, (r + 0.5) * GRID) ? 1 : 0;
  const start = cellOf(s.cup.x, s.cup.y);
  dist[start] = 0;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const c = k % COLS;
    const r = (k - c) / COLS;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      const n = nr * COLS + nc;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || !free[n] || dist[n] !== Infinity) continue;
      dist[n] = dist[k] + GRID;
      queue.push(n);
    }
  }
  return dist;
}

const cellOf = (x: number, y: number) => clamp(Math.floor(y / GRID), 0, ROWS - 1) * COLS + clamp(Math.floor(x / GRID), 0, COLS - 1);
/** The distance field's value at a point (a ball resting against a wall reads its open neighbours). */
export function fieldAt(f: Float64Array, x: number, y: number): number {
  let best = f[cellOf(x, y)];
  if (best < Infinity) return best;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) best = Math.min(best, f[cellOf(x + dx * GRID, y + dy * GRID)] + Math.hypot(dx, dy) * GRID);
  return best;
}

/** Lay out a hole: walls across the course with gaps, then bumpers, sand and water from the seed. */
function layout(d: Difficulty, rng: Rng, hazards: boolean): State {
  const tee = { x: rng.int(60, W - 60), y: H - 40 };
  const cup = { x: rng.int(50, W - 50), y: rng.int(48, 72) };
  const walls: Wall[] = [
    { kind: 'rect', x: 0, y: 0, w: W, h: WALL },
    { kind: 'rect', x: 0, y: H - WALL, w: W, h: WALL },
    { kind: 'rect', x: 0, y: 0, w: WALL, h: H },
    { kind: 'rect', x: W - WALL, y: 0, w: WALL, h: H },
  ];
  // Bands across the course, each with one gap; from level 3 the gaps zigzag.
  const k = bandsFor(d);
  const gap = gapFor(d);
  let prev = -1;
  for (let i = 0; i < k; i++) {
    const y = Math.round(110 + (205 * (i + 0.5)) / k + rng.int(-10, 10));
    const lo = WALL + gap / 2;
    const hi = W - WALL - gap / 2;
    let gx = lo + rng.next() * (hi - lo);
    if (d >= 3 && prev >= 0) gx = prev < W / 2 ? W / 2 + 15 + rng.next() * (hi - W / 2 - 15) : lo + rng.next() * (W / 2 - 15 - lo);
    prev = gx;
    for (const [a, b] of [
      [WALL, gx - gap / 2],
      [gx + gap / 2, W - WALL],
    ]) {
      if (b - a < 8) continue;
      if (rng.chance(angledFor(d))) {
        const tilt = rng.int(10, 22) * (rng.chance(0.5) ? 1 : -1);
        walls.push({ kind: 'seg', x1: a, y1: y + tilt, x2: b, y2: y - tilt, r: 4 });
      } else walls.push({ kind: 'rect', x: a, y: y - 4, w: b - a, h: 8 });
    }
  }
  // From level 4 a short rail guards the cup's front.
  if (d >= 4) walls.push({ kind: 'rect', x: cup.x - 24 + rng.int(-14, 14), y: cup.y + 22, w: 48, h: 6 });

  const s: State = {
    d,
    walls,
    sand: [],
    water: [],
    tee,
    cup,
    bx: tee.x,
    by: tee.y,
    vx: 0,
    vy: 0,
    rest: { ...tee },
    rolling: false,
    acc: 0,
    aim: 0,
    power: 0.5,
    turn: 0,
    pump: 0,
    strokes: 0,
    par: parFor(d),
    limit: limitFor(d),
    score: 0,
    done: false,
  };
  if (!hazards) return s;
  const near = (x: number, y: number, r: number) => Math.hypot(x - tee.x, y - tee.y) < r + 34 || Math.hypot(x - cup.x, y - cup.y) < r + 30;
  for (let n = bumpersFor(d), tries = 0; n > 0 && tries < 40; tries++) {
    const b: Wall = { kind: 'disc', x: rng.int(30, W - 30), y: rng.int(90, H - 80), r: rng.int(9, 13) };
    if (near(b.x, b.y, b.r) || walls.some((w) => clearance(w, b.x, b.y) < b.r + 14)) continue;
    walls.push(b);
    n--;
  }
  const zone = (wMin: number, wMax: number, hMin: number, hMax: number): Zone => {
    const w = rng.int(wMin, wMax);
    const h = rng.int(hMin, hMax);
    return { x: rng.int(WALL, W - WALL - w), y: rng.int(80, H - 70 - h), w, h };
  };
  for (let n = sandFor(d), tries = 0; n > 0 && tries < 40; tries++) {
    const z = zone(50, 90, 24, 38);
    if (zoneDist(z, tee.x, tee.y) < 24 || zoneDist(z, cup.x, cup.y) < 18) continue;
    s.sand.push(z);
    n--;
  }
  for (let n = waterFor(d), tries = 0; n > 0 && tries < 40; tries++) {
    const z = zone(40, 80, 20, 30);
    if (
      zoneDist(z, tee.x, tee.y) < 34 ||
      zoneDist(z, cup.x, cup.y) < 30 ||
      s.sand.some((o) => zoneDist(o, z.x + z.w / 2, z.y + z.h / 2) < 30)
    )
      continue;
    s.water.push(z);
    n--;
  }
  return s;
}

/** Deal a hole that can be played out: the cup must be reachable from the tee around walls and water. */
export function createLevel(d: Difficulty, rng: Rng): State {
  for (let attempt = 0; ; attempt++) {
    // After many tries, fall back to the walls alone (their gaps are always wide enough).
    const s = layout(d, rng, attempt < 25);
    if (fieldAt(distanceField(s), s.tee.x, s.tee.y) < Infinity) {
      aimAtCup(s);
      return s;
    }
  }
}

/** Point the aim straight at the cup (at the start and after every putt). */
function aimAtCup(s: State) {
  s.aim = Math.atan2(s.cup.y - s.by, s.cup.x - s.bx);
}

/** Set the aim from a pointer drag: direction and power. */
export function setAim(s: State, aim: number, power: number) {
  if (s.rolling || s.done) return;
  s.aim = aim;
  s.power = clamp(power, 0, 1);
}

/** Putt the ball with the current aim and power. */
export function putt(s: State): boolean {
  if (s.rolling || s.done) return false;
  const v = MIN_SPEED + s.power * (MAX_SPEED - MIN_SPEED);
  s.strokes++;
  s.rest = { x: s.bx, y: s.by };
  s.vx = Math.cos(s.aim) * v;
  s.vy = Math.sin(s.aim) * v;
  s.rolling = true;
  s.acc = 0;
  return true;
}

export interface StepEvents {
  /** The ball hit something this step (how hard, for feedback). */
  bump: number;
  /** Into the water: a penalty stroke, back to where the putt started. */
  splash: boolean;
  /** The ball came to rest (not in the cup). */
  stopped: boolean;
  cleared: boolean;
  over: boolean;
}

/** Quick test: the ball is clearly out of a wall's reach (its bounding box). */
function far(w: Wall, x: number, y: number): boolean {
  const m = BALL_R + 1;
  switch (w.kind) {
    case 'rect':
      return x < w.x - m || x > w.x + w.w + m || y < w.y - m || y > w.y + w.h + m;
    case 'disc':
      return Math.abs(x - w.x) > w.r + m || Math.abs(y - w.y) > w.r + m;
    case 'seg':
      return (
        x < Math.min(w.x1, w.x2) - w.r - m ||
        x > Math.max(w.x1, w.x2) + w.r + m ||
        y < Math.min(w.y1, w.y2) - w.r - m ||
        y > Math.max(w.y1, w.y2) + w.r + m
      );
  }
}

/** Push the ball out of a wall it overlaps and bounce it off. Returns the impact speed. */
function collide(s: State, w: Wall): number {
  if (far(w, s.bx, s.by)) return 0;
  const { px, py, rad } = nearest(w, s.bx, s.by);
  let dx = s.bx - px;
  let dy = s.by - py;
  let d = Math.hypot(dx, dy);
  if (d - rad >= BALL_R) return 0;
  if (d === 0 && w.kind === 'rect') {
    // Centre inside a block: leave by the nearest side.
    const sides = [s.bx - w.x, w.x + w.w - s.bx, s.by - w.y, w.y + w.h - s.by];
    const m = sides.indexOf(Math.min(...sides));
    [dx, dy] = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ][m];
    d = -sides[m];
  } else if (d === 0) {
    dx = 0;
    dy = -1;
  } else {
    dx /= d;
    dy /= d;
  }
  const push = BALL_R + rad - d;
  s.bx += dx * push;
  s.by += dy * push;
  const vn = s.vx * dx + s.vy * dy;
  if (vn >= 0) return 0;
  const e = w.kind === 'disc' ? BUMPER_KICK : BOUNCE;
  s.vx -= (1 + e) * vn * dx;
  s.vy -= (1 + e) * vn * dy;
  return -vn;
}

/** Advance by `dt` seconds: keyboard aim while waiting, the rolling ball otherwise. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { bump: 0, splash: false, stopped: false, cleared: false, over: false };
  if (s.done) return ev;
  if (!s.rolling) {
    s.aim += s.turn * TURN_SPEED * dt;
    s.power = clamp(s.power + s.pump * POWER_SPEED * dt, 0, 1);
    return ev;
  }
  const h = TICK;
  for (s.acc += dt; s.acc >= h; s.acc -= h) {
    const sp = Math.hypot(s.vx, s.vy);
    const sand = s.sand.some((z) => inZone(z, s.bx, s.by));
    const slow = (sand ? SAND_ROLL + SAND_DRAG * sp : ROLL + DRAG * sp) * h;
    const k = sp > 0 ? Math.max(0, sp - slow) / sp : 0;
    s.vx *= k;
    s.vy *= k;
    // The cup's lip draws a slow ball in.
    const cx = s.cup.x - s.bx;
    const cy = s.cup.y - s.by;
    const cd = Math.hypot(cx, cy);
    if (cd < CUP_R + BALL_R && cd > 0.01) {
      s.vx += (cx / cd) * 500 * h;
      s.vy += (cy / cd) * 500 * h;
    }
    s.bx += s.vx * h;
    s.by += s.vy * h;
    for (const w of s.walls) ev.bump = Math.max(ev.bump, collide(s, w));
    const v = Math.hypot(s.vx, s.vy);
    if (v > MAX_SPEED) {
      s.vx *= MAX_SPEED / v;
      s.vy *= MAX_SPEED / v;
    }
    if (Math.hypot(s.cup.x - s.bx, s.cup.y - s.by) < CUP_R - 1 && v < SINK_SPEED) {
      s.bx = s.cup.x;
      s.by = s.cup.y;
      s.rolling = false;
      s.done = true;
      s.score = STROKE_POINTS * (s.limit - s.strokes + 1);
      ev.cleared = true;
      return ev;
    }
    if (s.water.some((z) => inZone(z, s.bx, s.by))) {
      ev.splash = true;
      s.strokes++;
      s.bx = s.rest.x;
      s.by = s.rest.y;
      break;
    }
    if (v < STOP_SPEED) break;
  }
  if (ev.splash || Math.hypot(s.vx, s.vy) < STOP_SPEED) {
    s.vx = s.vy = 0;
    s.rolling = false;
    ev.stopped = true;
    if (s.strokes >= s.limit) {
      s.done = true;
      ev.over = true;
    } else aimAtCup(s);
  }
  return ev;
}
