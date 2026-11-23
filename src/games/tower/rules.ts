import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units; the tower grows upwards (negative y) and the card scrolls with it. */
export const W = 300;
export const H = 400;
/** Block height. */
export const BH = 18;
/** Top of the ground: the base block sits on it. */
export const GROUND = H - 26;
/** Points per block placed, and per step of the perfect streak. */
export const BLOCK_POINTS = 10;
export const PERFECT_POINTS = 10;
/** The streak bonus stops growing here. */
const STREAK_CAP = 5;
/** Every this many perfects in a row, the block grows back a little. */
export const REGROW_EVERY = 3;
const REGROW = 8;
/** A sliver thinner than this falls off: the tower is done. */
const MIN_W = 2;
const GRAVITY = 900;
/** Speed-up per floor, and its cap (×). */
const RAMP = 0.03;
const RAMP_MAX = 1.45;

export const goalFor = (d: Difficulty) => byLevel(d, [10, 13, 16, 19, 22]);
const widthFor = (d: Difficulty) => byLevel(d, [150, 135, 120, 110, 100]);
export const speedFor = (d: Difficulty) => byLevel(d, [100, 115, 130, 145, 160]);
/** How far off (world units) a drop may land and still count as perfect. */
const toleranceFor = (d: Difficulty) => byLevel(d, [6, 5.5, 5, 4.5, 4.2]);

interface Block {
  x: number;
  w: number;
  perfect: boolean;
}

/** A sliced-off piece falling away (drawing only). */
interface Chunk {
  x: number;
  y: number;
  w: number;
  vx: number;
  vy: number;
  /** Rotation (radians) and its speed. */
  a: number;
  spin: number;
  /** Floor it was cut from (for its colour). */
  floor: number;
}

export interface State {
  d: Difficulty;
  /** Placed blocks, bottom first: blocks[0] is the base. */
  blocks: Block[];
  /** The sliding block: left edge, width, velocity (signed). */
  x: number;
  w: number;
  v: number;
  /** Floors to build (blocks above the base). */
  goal: number;
  baseW: number;
  tol: number;
  /** Perfects in a row. */
  streak: number;
  perfects: number;
  score: number;
  chunks: Chunk[];
  done: boolean;
  rng: Rng;
}

/** The y of floor `i`'s top edge (floor 0 is the base). */
export const floorY = (i: number) => GROUND - (i + 1) * BH;
/** Floors built above the base. */
export const height = (s: State) => s.blocks.length - 1;
const top = (s: State) => s.blocks[s.blocks.length - 1];

/** Speed of the slider on the current floor. */
const sliderSpeed = (s: State) => speedFor(s.d) * Math.min(RAMP_MAX, 1 + RAMP * height(s));

/** Start the next block at a side: from the left on easy levels, alternating at 3–4, at random on 5. */
function spawn(s: State) {
  const n = height(s);
  const fromRight = s.d >= 5 ? s.rng.chance(0.5) : s.d >= 3 ? n % 2 === 1 : false;
  s.w = top(s).w;
  s.x = fromRight ? W - s.w : 0;
  s.v = (fromRight ? -1 : 1) * sliderSpeed(s);
}

/** Deal a level: the base slab, centred, and the first block sliding in. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const baseW = widthFor(d);
  const s: State = {
    d,
    blocks: [{ x: (W - baseW) / 2 + rng.int(-20, 20), w: baseW, perfect: false }],
    x: 0,
    w: baseW,
    v: 0,
    goal: goalFor(d),
    baseW,
    tol: toleranceFor(d),
    streak: 0,
    perfects: 0,
    score: 0,
    chunks: [],
    done: false,
    rng,
  };
  spawn(s);
  return s;
}

export interface DropResult {
  kind: 'perfect' | 'cut' | 'miss';
  /** Width sliced off. */
  cut: number;
  /** Points this drop earned. */
  points: number;
  /** The block grew back (a streak of perfects). */
  grew: boolean;
  cleared: boolean;
  over: boolean;
}

function fall(s: State, x: number, w: number, dir: number) {
  s.chunks.push({
    x,
    y: floorY(s.blocks.length),
    w,
    vx: dir * 40,
    vy: 0,
    a: 0,
    spin: dir * (2 + s.rng.next() * 2),
    floor: s.blocks.length,
  });
}

/** Drop the sliding block where it is: perfect, sliced, or off the tower. */
export function drop(s: State): DropResult | null {
  if (s.done) return null;
  const t = top(s);
  const res: DropResult = { kind: 'cut', cut: 0, points: 0, grew: false, cleared: false, over: false };
  const left = Math.max(s.x, t.x);
  const right = Math.min(s.x + s.w, t.x + t.w);
  if (right - left < MIN_W) {
    fall(s, s.x, s.w, s.x < t.x ? -1 : 1);
    res.kind = 'miss';
    res.cut = s.w;
    res.over = true;
    s.done = true;
    s.streak = 0;
    return res;
  }
  let x = left;
  let w = right - left;
  if (Math.abs(s.x - t.x) <= s.tol) {
    // Close enough: snap onto the block below, keep the full width.
    res.kind = 'perfect';
    x = t.x;
    w = t.w;
    s.streak++;
    s.perfects++;
    res.points = BLOCK_POINTS + PERFECT_POINTS * Math.min(STREAK_CAP, s.streak);
    if (s.streak % REGROW_EVERY === 0 && w < s.baseW) {
      const grow = Math.min(REGROW, s.baseW - w);
      w += grow;
      x = Math.max(0, Math.min(W - w, x - grow / 2));
      res.grew = true;
    }
  } else {
    res.cut = s.w - w;
    if (s.x < left) fall(s, s.x, left - s.x, -1);
    if (s.x + s.w > right) fall(s, right, s.x + s.w - right, 1);
    s.streak = 0;
    res.points = BLOCK_POINTS;
  }
  s.blocks.push({ x, w, perfect: res.kind === 'perfect' });
  s.score += res.points;
  if (height(s) >= s.goal) {
    res.cleared = true;
    s.done = true;
  } else spawn(s);
  return res;
}

/** Advance by `dt` seconds: the slider bounces between the walls, cut pieces fall away. */
export function step(s: State, dt: number) {
  if (!s.done) {
    s.x += s.v * dt;
    if (s.x < 0) {
      s.x = -s.x;
      s.v = Math.abs(s.v);
    } else if (s.x > W - s.w) {
      s.x = 2 * (W - s.w) - s.x;
      s.v = -Math.abs(s.v);
    }
  }
  for (const c of s.chunks) {
    c.vy += GRAVITY * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.a += c.spin * dt;
  }
  // Pieces that fell well below the tower are gone.
  const floor = floorY(height(s)) + H * 1.5;
  s.chunks = s.chunks.filter((c) => c.y < floor);
}
