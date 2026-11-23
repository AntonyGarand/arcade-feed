import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

export const W = 280;
export const H = 400;
export const FLOOR = 390;
/** Pieces resting above this line for OVERFLOW_S end the run. */
export const LINE = 96;
export const DROP_Y = 48;
export const OVERFLOW_S = 2;
/** Radius of each size; two pieces of size k merge into one of size k + 1. */
export const RADII: readonly number[] = [10, 14, 18, 23, 29, 36, 44, 53];
/** Points for making a piece of size k. */
export const mergePoints = (k: number) => 5 * 2 ** k;
/** Bonus per drop left of the level's budget when the target appears. */
export const DROP_BONUS = 15;

const GRAVITY = 900;
/** Physics runs at a fixed rate, so the same drops always settle the same way. */
const STEP = 1 / 120;
const ITERATIONS = 8;
const DAMPING = 0.995;
/** A new piece doesn't count for overflow until it has had this long to fall. */
const GRACE_S = 1;
const COOLDOWN_S = 0.45;

export const targetFor = (d: Difficulty) => byLevel(d, [4, 5, 5, 6, 6]);
export const jarWidth = (d: Difficulty) => byLevel(d, [240, 250, 220, 250, 230]);
/** Largest size that can be dropped (sizes 0…max, small ones likelier). */
const dropMax = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 3]);
/** Drops expected to make the target; fewer earns the bonus. */
export const dropBudget = (d: Difficulty) => byLevel(d, [20, 36, 28, 46, 46]);

interface Body {
  x: number;
  y: number;
  /** Previous position (velocity is the difference, Verlet style). */
  px: number;
  py: number;
  k: number;
  age: number;
}

export interface State {
  d: Difficulty;
  left: number;
  right: number;
  bodies: Body[];
  /** Size in hand and the one after it. */
  current: number;
  next: number;
  aimX: number;
  /** Keyboard aim direction held. */
  dir: number;
  cooldown: number;
  drops: number;
  target: number;
  biggest: number;
  /** Seconds a piece has been resting above the line. */
  over: number;
  score: number;
  acc: number;
  rng: Rng;
}

function deal(s: { d: Difficulty; rng: Rng }): number {
  // Small pieces are likelier: size i with weight (max + 1 - i).
  const max = dropMax(s.d);
  const pool: number[] = [];
  for (let k = 0; k <= max; k++) for (let i = 0; i < max + 1 - k; i++) pool.push(k);
  return s.rng.pick(pool);
}

export function createLevel(d: Difficulty, rng: Rng): State {
  const w = jarWidth(d);
  const s: State = {
    d,
    left: (W - w) / 2,
    right: (W + w) / 2,
    bodies: [],
    current: 0,
    next: 0,
    aimX: W / 2,
    dir: 0,
    cooldown: 0,
    drops: 0,
    target: targetFor(d),
    biggest: 0,
    over: 0,
    score: 0,
    acc: 0,
    rng,
  };
  s.current = deal(s);
  s.next = deal(s);
  return s;
}

/** Aim the piece in hand (kept inside the jar). */
export function aim(s: State, x: number) {
  const r = RADII[s.current];
  s.aimX = Math.max(s.left + r, Math.min(s.right - r, x));
}

/** Drop the piece in hand at the aim. False while the last drop is still clearing the spout. */
export function drop(s: State): boolean {
  if (s.cooldown > 0) return false;
  aim(s, s.aimX);
  s.bodies.push({ x: s.aimX, y: DROP_Y, px: s.aimX, py: DROP_Y, k: s.current, age: 0 });
  s.drops++;
  s.current = s.next;
  s.next = deal(s);
  s.cooldown = COOLDOWN_S;
  aim(s, s.aimX);
  return true;
}

export interface StepEvents {
  merged: boolean;
  won: boolean;
  lost: boolean;
}

/** One fixed physics tick: integrate, resolve overlaps and walls, then merge equal neighbours. */
function tick(s: State, ev: StepEvents) {
  const g = GRAVITY * STEP * STEP;
  for (const b of s.bodies) {
    const vx = (b.x - b.px) * DAMPING;
    const vy = (b.y - b.py) * DAMPING;
    b.px = b.x;
    b.py = b.y;
    b.x += vx;
    b.y += vy + g;
    b.age += STEP;
  }
  const n = s.bodies.length;
  for (let it = 0; it < ITERATIONS; it++) {
    for (let i = 0; i < n; i++) {
      const a = s.bodies[i];
      const ra = RADII[a.k];
      for (let j = i + 1; j < n; j++) {
        const b = s.bodies[j];
        const rb = RADII[b.k];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = ra + rb;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.001;
        const push = (min - d) / d;
        // Heavier pieces move less.
        const ma = ra * ra;
        const mb = rb * rb;
        const fa = mb / (ma + mb);
        const fb = ma / (ma + mb);
        a.x -= dx * push * fa;
        a.y -= dy * push * fa;
        b.x += dx * push * fb;
        b.y += dy * push * fb;
      }
    }
    for (const b of s.bodies) {
      const r = RADII[b.k];
      if (b.x < s.left + r) b.x = s.left + r;
      if (b.x > s.right - r) b.x = s.right - r;
      if (b.y > FLOOR - r) {
        b.y = FLOOR - r;
        // Floor friction: bleed sideways speed.
        b.px = b.x - (b.x - b.px) * 0.9;
      }
    }
  }
  // Rest: very slow pieces stop dead, so a settled pile doesn't shimmer.
  for (const b of s.bodies) if (Math.abs(b.x - b.px) < 0.004 && Math.abs(b.y - b.py) < 0.004) [b.px, b.py] = [b.x, b.y];

  // Merge touching equal pairs (each piece at most once per tick).
  const gone = new Set<Body>();
  const born: Body[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = s.bodies[i];
      const b = s.bodies[j];
      if (a.k !== b.k || gone.has(a) || gone.has(b) || a.k >= RADII.length - 1) continue;
      const min = RADII[a.k] * 2 + 0.5;
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > min * min) continue;
      gone.add(a);
      gone.add(b);
      const k = a.k + 1;
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      born.push({ x, y, px: x - (a.x - a.px + b.x - b.px) / 2, py: y - (a.y - a.py + b.y - b.py) / 2, k, age: GRACE_S });
      s.score += mergePoints(k);
      s.biggest = Math.max(s.biggest, k);
      ev.merged = true;
    }
  if (gone.size) s.bodies = s.bodies.filter((b) => !gone.has(b)).concat(born);
}

/** Advance by `dt` seconds (physics in fixed ticks), check the target and the overflow line. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { merged: false, won: false, lost: false };
  if (s.dir) aim(s, s.aimX + s.dir * 220 * dt);
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.acc += dt;
  while (s.acc >= STEP) {
    s.acc -= STEP;
    tick(s, ev);
    if (s.biggest >= s.target) {
      s.score += Math.max(0, dropBudget(s.d) - s.drops) * DROP_BONUS;
      ev.won = true;
      return ev;
    }
  }
  const above = s.bodies.some((b) => b.age > GRACE_S && b.y - RADII[b.k] < LINE);
  s.over = above ? s.over + dt : 0;
  if (s.over >= OVERFLOW_S) ev.lost = true;
  return ev;
}
