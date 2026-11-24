import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units, seen from above: the tee at the bottom, the cup near the top. */
export const W = 300;
export const H = 400;
/** Thickness of the border walls. */
export const WALL = 10;
export const BALL_R = 5.5;
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
/** Keyboard aim (radians/s: slow for a fine nudge, then fast once held) and power (per second) speeds. */
const TURN_FINE = 0.35;
const TURN_SPEED = 1.6;
/** Seconds an aim key is held before it speeds up. */
const TURN_RAMP = 0.4;
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
/** Coins on every hole (the same count whatever the kind, so scores stay comparable). */
export const coinsFor = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 3]);
export const COIN_POINTS = 20;
const COIN_R = 6;
/** Speed a boost pad adds to a ball rolling along its arrow. */
const BOOST_KICK = 170;
const PAD = 28;
/** Impacts harder than this count as a trick (bumpers kick from a gentler touch). */
const TRICK_WALL = 60;
const TRICK_BUMPER = 20;
/** Tricks in one putt (bank shots, bumpers, coins, boosts) that unlock a boon for the rest of the hole. */
export const TRICK_TIERS = [3, 5, 8] as const;
/** What each trick milestone unlocks: the full aim guide, a magnet cup, then a free putt. */
const BOONS = ['guide', 'magnet', 'free'] as const;
export type Boon = (typeof BOONS)[number];

/** The kinds of hole a level can deal. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'pinball' },
  { id: 'gates', min: 2 },
  { id: 'speedway' },
  { id: 'lakes', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

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

/** A gate sliding to and fro across a band's gap (it never fills more than half of it). */
interface Gate {
  y: number;
  /** The gap it slides in. */
  lo: number;
  hi: number;
  w: number;
  speed: number;
  phase: number;
}
const GATE_H = 10;

/** A boost pad: a ball rolling along its arrow gets a kick. */
interface Pad extends Zone {
  /** Arrow direction (radians). */
  dir: number;
}

interface Coin extends Point {
  taken: boolean;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  walls: Wall[];
  sand: Zone[];
  water: Zone[];
  gates: Gate[];
  pads: Pad[];
  coins: Coin[];
  /** Seconds since the hole started (moving gates). */
  t: number;
  /** The pad the ball is on (-1: none), so a pad kicks once per pass. */
  onPad: number;
  /** Tricks in the current putt, and trick milestones reached this hole. */
  tricks: number;
  tier: number;
  /** Boons unlocked: the aim guide shows the whole roll, the cup pulls harder, free putts left. */
  guide: boolean;
  magnet: boolean;
  free: number;
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
  /** How long the current aim key has been held. */
  turnT: number;
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

/** Where a gate sits at time `t`, as a block. */
export function gateRect(g: Gate, t: number): Wall & { kind: 'rect' } {
  const k = 0.5 + 0.5 * Math.sin(t * g.speed + g.phase);
  return { kind: 'rect', x: g.lo + (g.hi - g.lo - g.w) * k, y: g.y - GATE_H / 2, w: g.w, h: GATE_H };
}

/** Is (x, y) within `m` of the strip a gate sweeps? */
const nearGate = (s: Pick<State, 'gates'>, x: number, y: number, m: number) =>
  s.gates.some((g) => x > g.lo - m && x < g.hi + m && Math.abs(y - g.y) < GATE_H / 2 + m);

/** Lay out a hole: walls across the course with gaps, then bumpers, sand and water from the seed. */
function layout(d: Difficulty, rng: Rng, kind: KindId, hazards: boolean): State {
  const tee = { x: rng.int(60, W - 60), y: H - 40 };
  const cup = { x: rng.int(50, W - 50), y: rng.int(48, 72) };
  const walls: Wall[] = [
    { kind: 'rect', x: 0, y: 0, w: W, h: WALL },
    { kind: 'rect', x: 0, y: H - WALL, w: W, h: WALL },
    { kind: 'rect', x: 0, y: 0, w: WALL, h: H },
    { kind: 'rect', x: W - WALL, y: 0, w: WALL, h: H },
  ];
  // Bands across the course, each with one gap; from level 3 the gaps zigzag.
  const k = kind === 'lakes' || (kind === 'pinball' && d >= 5) ? Math.max(1, bandsFor(d) - 1) : bandsFor(d);
  const gap = kind === 'gates' ? gapFor(d) + 12 : gapFor(d);
  const gates: Gate[] = [];
  // Moving gates: one sliding in every gap.
  const gated = kind === 'gates';
  let prev = -1;
  for (let i = 0; i < k; i++) {
    const y = Math.round(110 + (205 * (i + 0.5)) / k + rng.int(-10, 10));
    const lo = WALL + gap / 2;
    const hi = W - WALL - gap / 2;
    let gx = lo + rng.next() * (hi - lo);
    if (d >= 3 && prev >= 0) gx = prev < W / 2 ? W / 2 + 15 + rng.next() * (hi - W / 2 - 15) : lo + rng.next() * (W / 2 - 15 - lo);
    prev = gx;
    if (gated)
      gates.push({
        y,
        lo: gx - gap / 2,
        hi: gx + gap / 2,
        w: Math.round(gap * 0.35),
        speed: 0.8 + rng.next() * 0.6,
        phase: rng.next() * 6.28,
      });
    for (const [a, b] of [
      [WALL, gx - gap / 2],
      [gx + gap / 2, W - WALL],
    ]) {
      if (b - a < 8) continue;
      if (!gated && rng.chance(angledFor(d))) {
        const tilt = rng.int(10, 22) * (rng.chance(0.5) ? 1 : -1);
        walls.push({ kind: 'seg', x1: a, y1: y + tilt, x2: b, y2: y - tilt, r: 4 });
      } else walls.push({ kind: 'rect', x: a, y: y - 4, w: b - a, h: 8 });
    }
  }
  // From level 4 a short rail guards the cup's front.
  if (d >= 4) walls.push({ kind: 'rect', x: cup.x - 24 + rng.int(-14, 14), y: cup.y + 22, w: 48, h: 6 });

  const s: State = {
    d,
    kind,
    walls,
    sand: [],
    water: [],
    gates,
    pads: [],
    coins: [],
    t: 0,
    onPad: -1,
    tricks: 0,
    tier: 0,
    guide: false,
    magnet: false,
    free: 0,
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
    turnT: 0,
    strokes: 0,
    par: parFor(d),
    limit: limitFor(d),
    score: 0,
    done: false,
  };
  // Boost pads (floor markings, so they never block the way): a speedway is full of them.
  const pads = kind === 'speedway' ? byLevel(d, [2, 3, 3, 4, 4]) : kind === 'classic' && d >= 3 ? 1 : 0;
  for (let n = pads, tries = 0; n > 0 && tries < 60; tries++) {
    const x = rng.int(WALL + 4, W - WALL - 4 - PAD);
    const y = rng.int(90, H - 80 - PAD);
    const cx = x + PAD / 2;
    const cy = y + PAD / 2;
    // Mostly up the course (towards the cup), sometimes across.
    const dir = rng.chance(0.65) ? -Math.PI / 2 + (rng.next() - 0.5) * 1.2 : rng.chance(0.5) ? 0 : Math.PI;
    if (
      Math.hypot(cx - tee.x, cy - tee.y) < 40 ||
      Math.hypot(cx - cup.x, cy - cup.y) < 50 ||
      nearGate(s, cx, cy, PAD) ||
      walls.some((w) => clearance(w, cx, cy) < PAD * 0.75) ||
      // Room to run along the arrow, so a pad never pins the ball against a wall.
      walls.some((w) => clearance(w, cx + Math.cos(dir) * 40, cy + Math.sin(dir) * 40) < BALL_R + 2) ||
      s.pads.some((p) => Math.hypot(p.x - x, p.y - y) < PAD * 1.6)
    )
      continue;
    s.pads.push({ x, y, w: PAD, h: PAD, dir });
    n--;
  }
  if (!hazards) return s;
  const near = (x: number, y: number, r: number) => Math.hypot(x - tee.x, y - tee.y) < r + 34 || Math.hypot(x - cup.x, y - cup.y) < r + 30;
  const bumpers = kind === 'pinball' ? bumpersFor(d) + (d >= 3 ? 2 : 3) : kind === 'gates' ? Math.max(0, bumpersFor(d) - 1) : bumpersFor(d);
  for (let n = bumpers, tries = 0; n > 0 && tries < 80; tries++) {
    const b: Wall = { kind: 'disc', x: rng.int(30, W - 30), y: rng.int(90, H - 80), r: rng.int(9, 13) };
    if (
      near(b.x, b.y, b.r) ||
      nearGate(s, b.x, b.y, b.r + 10) ||
      s.pads.some((p) => zoneDist(p, b.x, b.y) < b.r + 6) ||
      walls.some((w) => clearance(w, b.x, b.y) < b.r + 14)
    )
      continue;
    walls.push(b);
    n--;
  }
  const zone = (wMin: number, wMax: number, hMin: number, hMax: number): Zone => {
    const w = rng.int(wMin, wMax);
    const h = rng.int(hMin, hMax);
    return { x: rng.int(WALL, W - WALL - w), y: rng.int(80, H - 70 - h), w, h };
  };
  const onPad = (z: Zone) => s.pads.some((p) => zoneDist(z, p.x + p.w / 2, p.y + p.h / 2) < PAD);
  for (let n = kind === 'pinball' ? Math.max(0, sandFor(d) - 1) : sandFor(d), tries = 0; n > 0 && tries < 40; tries++) {
    const z = zone(50, 90, 24, 38);
    if (zoneDist(z, tee.x, tee.y) < 24 || zoneDist(z, cup.x, cup.y) < 18 || onPad(z)) continue;
    s.sand.push(z);
    n--;
  }
  const ponds = kind === 'lakes' ? 3 : kind === 'gates' ? Math.max(0, waterFor(d) - 1) : waterFor(d);
  for (let n = ponds, tries = 0; n > 0 && tries < 60; tries++) {
    const z = zone(40, 80, 20, 30);
    if (
      zoneDist(z, tee.x, tee.y) < 34 ||
      zoneDist(z, cup.x, cup.y) < 30 ||
      onPad(z) ||
      s.gates.some((g) => zoneDist(z, (g.lo + g.hi) / 2, g.y) < (g.hi - g.lo) / 2 + 12) ||
      s.sand.some((o) => zoneDist(o, z.x + z.w / 2, z.y + z.h / 2) < 30)
    )
      continue;
    s.water.push(z);
    n--;
  }
  return s;
}

/** Deal a hole that can be played out: the cup must be reachable from the tee around walls and water. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  for (let attempt = 0; ; attempt++) {
    // After many tries, fall back to the walls alone (their gaps are always wide enough; gates fill half at most).
    const s = layout(d, rng, kind, attempt < 25);
    const field = distanceField(s);
    if (fieldAt(field, s.tee.x, s.tee.y) < Infinity) {
      placeCoins(s, rng, field);
      aimAtCup(s);
      return s;
    }
  }
}

/** Scatter the coins on open, reachable grass, away from the tee, the cup and each other. */
function placeCoins(s: State, rng: Rng, field: Float64Array) {
  const n = coinsFor(s.d);
  for (let tries = 0; s.coins.length < n && tries < 400; tries++) {
    const x = rng.int(WALL + 14, W - WALL - 14);
    const y = rng.int(80, H - 70);
    const loose = tries > 300;
    if (
      !open(s, x, y, 3) ||
      nearGate(s, x, y, BALL_R + 4) ||
      Math.hypot(x - s.tee.x, y - s.tee.y) < 36 ||
      Math.hypot(x - s.cup.x, y - s.cup.y) < 28 ||
      !(fieldAt(field, x, y) < Infinity) ||
      (!loose && s.coins.some((c) => Math.hypot(c.x - x, c.y - y) < 50))
    )
      continue;
    s.coins.push({ x, y, taken: false });
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
  if (s.free > 0) s.free--;
  else s.strokes++;
  s.tricks = 0;
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
  /** Tricks scored this step (bank shots, bumpers, coins, boosts). */
  tricks: number;
  /** Coins picked up and boost pads ridden this step. */
  coins: Point[];
  boosts: Point[];
  /** A trick milestone reached this step (1-based) and the boon it unlocked; 0 / null for none. */
  tier: number;
  unlocked: Boon | null;
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
  const ev: StepEvents = {
    bump: 0,
    splash: false,
    stopped: false,
    tricks: 0,
    coins: [],
    boosts: [],
    tier: 0,
    unlocked: null,
    cleared: false,
    over: false,
  };
  if (s.done) return ev;
  if (!s.rolling) {
    s.t += dt;
    s.turnT = s.turn ? s.turnT + dt : 0;
    s.aim += s.turn * (s.turnT < TURN_RAMP ? TURN_FINE : TURN_SPEED) * dt;
    s.power = clamp(s.power + s.pump * POWER_SPEED * dt, 0, 1);
    // A gate sliding into a resting ball nudges it off the band.
    for (const g of s.gates) {
      if (clearance(gateRect(g, s.t), s.bx, s.by) >= BALL_R) continue;
      s.by = s.by < g.y ? g.y - GATE_H / 2 - BALL_R - 0.5 : g.y + GATE_H / 2 + BALL_R + 0.5;
    }
    return ev;
  }
  const h = TICK;
  const pull = s.magnet ? 2.2 : 1;
  for (s.acc += dt; s.acc >= h; s.acc -= h) {
    s.t += h;
    const sp = Math.hypot(s.vx, s.vy);
    const sand = s.sand.some((z) => inZone(z, s.bx, s.by));
    const slow = (sand ? SAND_ROLL + SAND_DRAG * sp : ROLL + DRAG * sp) * h;
    const k = sp > 0 ? Math.max(0, sp - slow) / sp : 0;
    s.vx *= k;
    s.vy *= k;
    // The cup's lip draws a slow ball in (from further away with the magnet).
    const cx = s.cup.x - s.bx;
    const cy = s.cup.y - s.by;
    const cd = Math.hypot(cx, cy);
    if (cd < (CUP_R + BALL_R) * pull && cd > 0.01) {
      s.vx += (cx / cd) * 500 * pull * h;
      s.vy += (cy / cd) * 500 * pull * h;
    }
    s.bx += s.vx * h;
    s.by += s.vy * h;
    for (const w of s.walls) {
      const hit = collide(s, w);
      ev.bump = Math.max(ev.bump, hit);
      if (hit > (w.kind === 'disc' ? TRICK_BUMPER : TRICK_WALL)) trick(s, ev);
    }
    for (const g of s.gates) {
      const hit = collide(s, gateRect(g, s.t));
      ev.bump = Math.max(ev.bump, hit);
      if (hit > TRICK_WALL) trick(s, ev);
    }
    // Boost pads kick a ball rolling along their arrow, once per pass.
    const pad = s.pads.findIndex((p) => inZone(p, s.bx, s.by));
    if (pad >= 0 && pad !== s.onPad) {
      const p = s.pads[pad];
      const ux = Math.cos(p.dir);
      const uy = Math.sin(p.dir);
      if (s.vx * ux + s.vy * uy >= 0) {
        s.vx += ux * BOOST_KICK;
        s.vy += uy * BOOST_KICK;
        ev.boosts.push({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
        trick(s, ev);
      }
    }
    s.onPad = pad;
    for (const c of s.coins) {
      if (c.taken || Math.hypot(c.x - s.bx, c.y - s.by) > COIN_R + BALL_R) continue;
      c.taken = true;
      ev.coins.push({ x: c.x, y: c.y });
      trick(s, ev);
    }
    const v = Math.hypot(s.vx, s.vy);
    if (v > MAX_SPEED) {
      s.vx *= MAX_SPEED / v;
      s.vy *= MAX_SPEED / v;
    }
    if (Math.hypot(s.cup.x - s.bx, s.cup.y - s.by) < CUP_R - 1 + (s.magnet ? 3 : 0) && v < SINK_SPEED * (s.magnet ? 1.4 : 1)) {
      s.bx = s.cup.x;
      s.by = s.cup.y;
      s.rolling = false;
      s.done = true;
      s.score = scoreOf(s);
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
    s.onPad = -1;
    ev.stopped = true;
    if (s.strokes >= s.limit) {
      s.done = true;
      ev.over = true;
    } else aimAtCup(s);
  }
  return ev;
}

/** Final score: strokes left under the limit (one share for holing out), plus the coins. */
export const scoreOf = (s: State) => STROKE_POINTS * (s.limit - s.strokes + 1) + COIN_POINTS * s.coins.filter((c) => c.taken).length;

/** One more trick in this putt; a new milestone unlocks the next boon for the rest of the hole. */
function trick(s: State, ev: StepEvents) {
  s.tricks++;
  ev.tricks++;
  if (s.tier >= TRICK_TIERS.length || s.tricks < TRICK_TIERS[s.tier]) return;
  const boon = BOONS[s.tier++];
  grantBoon(s, boon);
  ev.tier = s.tier;
  ev.unlocked = boon;
}

/** Turn a boon on: the whole roll in the aim guide, a magnet cup, or one free putt. */
export function grantBoon(s: State, b: Boon) {
  if (b === 'guide') s.guide = true;
  else if (b === 'magnet') s.magnet = true;
  else s.free++;
}
