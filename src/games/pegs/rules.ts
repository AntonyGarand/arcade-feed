import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units. */
export const W = 300;
export const H = 420;
export const LAUNCH = { x: W / 2, y: 26 };
export const BALL_R = 5;
export const PEG_R = 6;
export const BUCKET_Y = H - 18;
export const BUCKET_H = 14;
const GRAVITY = 380;
const SHOT_SPEED = 320;
const MAX_SPEED = 560;
const BOUNCE = 0.78;
/** Steepest aim from straight down (radians). */
export const MAX_AIM = 1.45;
/** Keyboard aim speed (radians per second). */
const AIM_SPEED = 1.3;
const TARGET_POINTS = 100;
const PEG_POINTS = 10;
/** Bonus per ball left when the last target falls. */
export const BALL_BONUS = 250;
/** A ball creeping this slowly for this long is stuck: its lit pegs go at once. */
const STUCK_SPEED = 25;
const STUCK_S = 1.2;

export const ballsFor = (d: Difficulty) => byLevel(d, [10, 9, 9, 8, 8]);
export const targetsFor = (d: Difficulty) => byLevel(d, [6, 8, 10, 12, 14]);
const pegsFor = (d: Difficulty) => byLevel(d, [34, 40, 46, 50, 54]);
const bucketWidth = (d: Difficulty) => byLevel(d, [84, 70, 60, 52, 44]);
const bucketSpeed = (d: Difficulty) => byLevel(d, [50, 65, 80, 95, 110]);

interface Peg {
  x: number;
  y: number;
  /** Orange target (must be cleared) or plain peg. */
  target: boolean;
  /** Hit by the ball in flight: it vanishes when the ball leaves play. */
  lit: boolean;
  gone: boolean;
}

export interface State {
  d: Difficulty;
  pegs: Peg[];
  /** Aim angle from straight down, radians (negative = left). */
  aim: number;
  /** Keyboard aim direction held: -1, 0 or 1. */
  turn: number;
  flying: boolean;
  bx: number;
  by: number;
  vx: number;
  vy: number;
  /** Pegs hit this shot (the multiplier grows every 4). */
  hits: number;
  stuck: number;
  bucketX: number;
  bucketW: number;
  bucketV: number;
  balls: number;
  score: number;
}

/** Deal a peg field: staggered rows with a seeded jitter, some pegs missing, targets picked at random. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const spots: { x: number; y: number }[] = [];
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    const y = 104 + r * 30;
    const off = r % 2 ? 17 : 0;
    for (let x = 26 + off; x <= W - 26; x += 34) spots.push({ x: x + rng.int(-5, 5), y: y + rng.int(-4, 4) });
  }
  rng.shuffle(spots);
  const pegs = spots
    .slice(0, pegsFor(d))
    .map((p, i) => ({ ...p, target: i < targetsFor(d), lit: false, gone: false }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    d,
    pegs,
    aim: 0,
    turn: 0,
    flying: false,
    bx: LAUNCH.x,
    by: LAUNCH.y,
    vx: 0,
    vy: 0,
    hits: 0,
    stuck: 0,
    bucketX: W / 2,
    bucketW: bucketWidth(d),
    bucketV: bucketSpeed(d),
    balls: ballsFor(d),
    score: 0,
  };
}

export const targetsLeft = (s: State) => s.pegs.filter((p) => p.target && !p.gone).length;
export const multiplier = (s: State) => 1 + Math.floor(s.hits / 4);

/** Aim at a point (pointer): the angle from the launcher, clamped to the allowed cone. */
export function aimAt(s: State, x: number, y: number) {
  if (s.flying) return;
  const a = Math.atan2(x - LAUNCH.x, Math.max(1, y - LAUNCH.y));
  s.aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, a));
}

export function shoot(s: State): boolean {
  if (s.flying || s.balls <= 0) return false;
  s.flying = true;
  s.bx = LAUNCH.x + Math.sin(s.aim) * 14;
  s.by = LAUNCH.y + Math.cos(s.aim) * 14;
  s.vx = Math.sin(s.aim) * SHOT_SPEED;
  s.vy = Math.cos(s.aim) * SHOT_SPEED;
  s.hits = 0;
  s.stuck = 0;
  return true;
}

/** The start of the shot's arc (no bounces), for the aim guide. */
export function aimPath(s: State, seconds = 0.32): { x: number; y: number }[] {
  const pts = [];
  let x = LAUNCH.x + Math.sin(s.aim) * 14;
  let y = LAUNCH.y + Math.cos(s.aim) * 14;
  let vx = Math.sin(s.aim) * SHOT_SPEED;
  let vy = Math.cos(s.aim) * SHOT_SPEED;
  const dt = 1 / 60;
  for (let t = 0; t <= seconds; t += dt) {
    pts.push({ x, y });
    vy += GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    if (x < BALL_R || x > W - BALL_R) vx = -vx;
    if (s.pegs.some((p) => !p.gone && (p.x - x) ** 2 + (p.y - y) ** 2 < (PEG_R + BALL_R) ** 2)) break;
  }
  return pts;
}

export interface StepEvents {
  hit: boolean;
  /** The ball left play: through the bottom (`lost`) or into the bucket (`caught`). */
  ended: boolean;
  caught: boolean;
  lost: boolean;
  cleared: boolean;
  over: boolean;
}

function clearLit(s: State) {
  for (const p of s.pegs) if (p.lit) p.gone = true;
}

/** Advance by `dt` seconds: the aim, the bucket and the ball in flight. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { hit: false, ended: false, caught: false, lost: false, cleared: false, over: false };
  if (!s.flying && s.turn) s.aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, s.aim + s.turn * AIM_SPEED * dt));
  // Bucket glides edge to edge.
  s.bucketX += s.bucketV * dt;
  const half = s.bucketW / 2;
  if (s.bucketX > W - half) {
    s.bucketX = W - half;
    s.bucketV = -Math.abs(s.bucketV);
  } else if (s.bucketX < half) {
    s.bucketX = half;
    s.bucketV = Math.abs(s.bucketV);
  }
  if (!s.flying) return ev;

  const n = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / (BALL_R / 2)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.vy += GRAVITY * h;
    s.bx += s.vx * h;
    s.by += s.vy * h;
    if (s.bx < BALL_R) {
      s.bx = BALL_R;
      s.vx = Math.abs(s.vx) * BOUNCE;
    } else if (s.bx > W - BALL_R) {
      s.bx = W - BALL_R;
      s.vx = -Math.abs(s.vx) * BOUNCE;
    }
    if (s.by < BALL_R) {
      s.by = BALL_R;
      s.vy = Math.abs(s.vy) * BOUNCE;
    }
    for (const p of s.pegs) {
      if (p.gone) continue;
      const dx = s.bx - p.x;
      const dy = s.by - p.y;
      const d2 = dx * dx + dy * dy;
      const min = PEG_R + BALL_R;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1;
      const nx = dx / d;
      const ny = dy / d;
      s.bx = p.x + nx * min;
      s.by = p.y + ny * min;
      const vn = s.vx * nx + s.vy * ny;
      if (vn < 0) {
        s.vx -= (1 + BOUNCE) * vn * nx;
        s.vy -= (1 + BOUNCE) * vn * ny;
      }
      if (!p.lit) {
        p.lit = true;
        s.hits++;
        s.score += (p.target ? TARGET_POINTS : PEG_POINTS) * multiplier(s);
        ev.hit = true;
      }
    }
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > MAX_SPEED) {
      s.vx *= MAX_SPEED / sp;
      s.vy *= MAX_SPEED / sp;
    }
    // Into the bucket: the ball comes back.
    if (
      s.vy > 0 &&
      s.by + BALL_R >= BUCKET_Y &&
      s.by - s.vy * h + BALL_R < BUCKET_Y &&
      Math.abs(s.bx - s.bucketX) < s.bucketW / 2 - BALL_R
    ) {
      ev.caught = true;
      break;
    }
    if (s.by - BALL_R > H) {
      ev.lost = true;
      break;
    }
  }
  if (!ev.caught && !ev.lost) {
    s.stuck = Math.hypot(s.vx, s.vy) < STUCK_SPEED ? s.stuck + dt : 0;
    if (s.stuck > STUCK_S) {
      clearLit(s);
      s.stuck = 0;
    }
    return ev;
  }
  ev.ended = true;
  s.flying = false;
  clearLit(s);
  if (ev.lost) s.balls--;
  if (!targetsLeft(s)) {
    s.score += s.balls * BALL_BONUS;
    ev.cleared = true;
  } else if (s.balls <= 0) ev.over = true;
  return ev;
}
