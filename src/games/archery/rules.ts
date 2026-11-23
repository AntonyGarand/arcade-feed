import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units: side view, the archer on the left, targets to the right. */
export const W = 300;
export const H = 400;
export const GROUND = 356;
/** Where arrows leave the bow. */
export const BOW = { x: 40, y: 292 };
export const ARROW_LEN = 26;
const GRAVITY = 260;
const MIN_SPEED = 170;
const MAX_SPEED = 410;
/** Aim limits (radians above the horizon). */
export const MIN_ANGLE = -0.3;
export const MAX_ANGLE = 1.25;
/** Keyboard aim and draw speeds, per second. */
const TURN_SPEED = 0.7;
const PULL_SPEED = 0.55;
/** Seconds the result stays on screen before the next arrow. */
const SHOW_S = 1.1;
/** Ring scores, centre first; each ring is a fifth of the radius. */
export const RINGS = [10, 8, 6, 4, 2] as const;
/** Wind shown to the player in steps of this many units/s². */
export const WIND_STEP = 10;

export const arrowsFor = (d: Difficulty) => byLevel(d, [5, 6, 6, 7, 7]);
/** Points needed to clear: an average per arrow. */
export const goalFor = (d: Difficulty) => Math.round(arrowsFor(d) * byLevel(d, [5, 5, 5.5, 5, 5]));
const targetCount = (d: Difficulty) => byLevel(d, [1, 2, 2, 3, 3]);
const radiusFor = (d: Difficulty) => byLevel(d, [30, 26, 22, 18, 16]);
/** Nearest a target stands (they spread from here to the far end). */
const nearFor = (d: Difficulty) => byLevel(d, [140, 150, 160, 170, 180]);
const FAR = 280;
/** Wind range (units/s², either way). */
const windFor = (d: Difficulty) =>
  byLevel(d, [
    [0, 30],
    [20, 70],
    [35, 100],
    [50, 130],
    [60, 160],
  ] as const);
/** How far up and down moving targets bob (0 = still), and how many of them move. */
const bobFor = (d: Difficulty) => byLevel(d, [0, 0, 24, 32, 42]);
const movingCount = (d: Difficulty) => byLevel(d, [0, 0, 1, 2, 3]);
/** Seconds of flight the aim guide shows (gravity only, no wind). */
export const previewFor = (d: Difficulty) => byLevel(d, [0.42, 0.34, 0.27, 0.21, 0.16]);

interface Target {
  x: number;
  /** Centre height at rest; it bobs `amp` units at `freq` rad/s from `phase`. */
  y: number;
  r: number;
  amp: number;
  freq: number;
  phase: number;
}

/** An arrow at rest: stuck in a target (moves with it) or in the ground. */
interface Stuck {
  /** Target index, or -1 for the ground. */
  t: number;
  x: number;
  /** Height (ground) or offset from the target's centre. */
  y: number;
  a: number;
}

export interface State {
  d: Difficulty;
  targets: Target[];
  /** Wind per arrow (units/s², positive = towards the targets). */
  winds: number[];
  arrows: number;
  /** Arrows shot so far (the next one is `shot`). */
  shot: number;
  goal: number;
  score: number;
  /** Points per arrow shot. */
  hits: number[];
  /** Aim: angle above the horizon, draw 0–1. */
  angle: number;
  power: number;
  /** Keyboard keys held: angle −1/0/1 and draw −1/0/1. */
  turn: number;
  pull: number;
  phase: 'aim' | 'flight' | 'show' | 'done';
  /** Arrow in flight: tip and velocity. */
  ax: number;
  ay: number;
  vx: number;
  vy: number;
  /** Clock (targets bob with it) and the result display timer. */
  time: number;
  wait: number;
  stuck: Stuck[];
}

/** Deal a range: targets at seeded distances and heights, and the wind for every arrow. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const n = targetCount(d);
  const r = radiusFor(d);
  const targets: Target[] = [];
  // Spread targets over distance bands, near to far, at seeded heights.
  const near = nearFor(d);
  for (let i = 0; i < n; i++) {
    const lo = near + (i * (FAR - near)) / n;
    const hi = near + ((i + 1) * (FAR - near)) / n;
    targets.push({ x: Math.round(lo + rng.next() * (hi - lo)), y: rng.int(110, GROUND - r - 30), r, amp: 0, freq: 0, phase: 0 });
  }
  rng.shuffle(targets);
  const bob = bobFor(d);
  for (const t of targets.slice(0, movingCount(d))) {
    t.amp = bob;
    t.y = Math.max(70 + bob, Math.min(GROUND - r - 20 - bob, t.y));
    t.freq = 1.2 + rng.next() * 0.9;
    t.phase = rng.next() * Math.PI * 2;
  }
  const [wlo, whi] = windFor(d);
  const arrows = arrowsFor(d);
  const winds = Array.from({ length: arrows }, () => Math.round((wlo + rng.next() * (whi - wlo)) * (rng.chance(0.5) ? 1 : -1)));
  return {
    d,
    targets,
    winds,
    arrows,
    shot: 0,
    goal: goalFor(d),
    score: 0,
    hits: [],
    angle: 0.35,
    power: 0.6,
    turn: 0,
    pull: 0,
    phase: 'aim',
    ax: BOW.x,
    ay: BOW.y,
    vx: 0,
    vy: 0,
    time: 0,
    wait: 0,
    stuck: [],
  };
}

/** The target the current arrow must hit: they take turns. */
export const current = (s: State) => Math.min(s.shot, s.arrows - 1) % s.targets.length;
export const wind = (s: State) => s.winds[Math.min(s.shot, s.arrows - 1)];
/** A target's centre height at the current time. */
export const targetY = (s: State, t: Target, time = s.time) => t.y + t.amp * Math.sin(t.freq * time + t.phase);
const speedOf = (power: number) => MIN_SPEED + power * (MAX_SPEED - MIN_SPEED);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Set the aim (pointer drag): direction and draw, clamped. */
export function setAim(s: State, angle: number, power: number) {
  if (s.phase !== 'aim') return;
  s.angle = clamp(angle, MIN_ANGLE, MAX_ANGLE);
  s.power = clamp(power, 0, 1);
}

/** Loose the arrow. */
export function shoot(s: State): boolean {
  if (s.phase !== 'aim') return false;
  const v = speedOf(s.power);
  s.phase = 'flight';
  s.ax = BOW.x + Math.cos(s.angle) * ARROW_LEN;
  s.ay = BOW.y - Math.sin(s.angle) * ARROW_LEN;
  s.vx = Math.cos(s.angle) * v;
  s.vy = -Math.sin(s.angle) * v;
  return true;
}

/** The first stretch of the arrow's path (gravity only: the wind isn't shown), for the aim guide. */
export function aimPath(s: State): { x: number; y: number }[] {
  const v = speedOf(s.power);
  const pts = [];
  const x0 = BOW.x + Math.cos(s.angle) * ARROW_LEN;
  const y0 = BOW.y - Math.sin(s.angle) * ARROW_LEN;
  for (let t = 0; t <= previewFor(s.d); t += 0.03)
    pts.push({ x: x0 + Math.cos(s.angle) * v * t, y: y0 - Math.sin(s.angle) * v * t + (GRAVITY * t * t) / 2 });
  return pts;
}

/** Points for crossing a target's face `dy` from its centre (0 = outside the face). */
export function ringScore(dy: number, r: number): number {
  const k = Math.floor((Math.abs(dy) / r) * RINGS.length);
  return k < RINGS.length ? RINGS[k] : 0;
}

export interface StepEvents {
  /** The arrow came to rest: `points` scored (0 for a miss), stuck at (x, y). */
  landed: boolean;
  points: number;
  x: number;
  y: number;
  /** The next arrow is ready (the wind changed). */
  next: boolean;
  cleared: boolean;
  over: boolean;
}

/** After an arrow: wait, then the next arrow or the end (lost early once the goal is out of reach). */
function settle(s: State, ev: StepEvents) {
  s.shot++;
  const left = s.arrows - s.shot;
  if (s.score >= s.goal && !left) {
    s.phase = 'done';
    ev.cleared = true;
  } else if (s.score + left * RINGS[0] < s.goal) {
    s.phase = 'done';
    ev.over = true;
  } else {
    s.phase = 'show';
    s.wait = SHOW_S;
  }
}

/** Advance by `dt` seconds: the aim keys, the targets, the arrow in flight. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { landed: false, points: 0, x: 0, y: 0, next: false, cleared: false, over: false };
  s.time += dt;
  if (s.phase === 'aim') {
    s.angle = clamp(s.angle + s.turn * TURN_SPEED * dt, MIN_ANGLE, MAX_ANGLE);
    s.power = clamp(s.power + s.pull * PULL_SPEED * dt, 0, 1);
    return ev;
  }
  if (s.phase === 'show') {
    s.wait -= dt;
    if (s.wait <= 0) {
      s.phase = 'aim';
      ev.next = true;
    }
    return ev;
  }
  if (s.phase === 'done') return ev;

  const n = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / 3));
  const h = dt / n;
  const ti = current(s);
  const t = s.targets[ti];
  for (let i = 0; i < n; i++) {
    const px = s.ax;
    const py = s.ay;
    s.vx += wind(s) * h;
    s.vy += GRAVITY * h;
    s.ax += s.vx * h;
    s.ay += s.vy * h;
    const a = Math.atan2(s.vy, s.vx);
    // Crossing the current target's face (front to back).
    if (px < t.x && s.ax >= t.x) {
      const y = py + ((s.ay - py) * (t.x - px)) / (s.ax - px);
      const dy = y - targetY(s, t, s.time - dt + h * (i + 1));
      const pts = ringScore(dy, t.r);
      if (pts) {
        s.stuck.push({ t: ti, x: t.x, y: dy, a });
        s.score += pts;
        s.hits.push(pts);
        Object.assign(ev, { landed: true, points: pts, x: t.x, y });
        settle(s, ev);
        return ev;
      }
    }
    const out = s.ax > W + 40 || s.ax < -40;
    if (s.ay >= GROUND || out) {
      if (!out) {
        s.ay = GROUND;
        s.stuck.push({ t: -1, x: s.ax, y: GROUND, a });
      }
      s.hits.push(0);
      Object.assign(ev, { landed: true, points: 0, x: clamp(s.ax, 10, W - 10), y: Math.min(s.ay, GROUND) });
      settle(s, ev);
      return ev;
    }
  }
  return ev;
}
