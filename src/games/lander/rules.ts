import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units (the canvas scales it to the card). */
export const W = 300;
export const H = 400;
/** Terrain is a polyline with a point every `STEP` units. */
const STEP = 10;
const POINTS = W / STEP + 1;
/** Ship body radius, and where its feet sit (relative to its centre, before tilting). */
export const SHIP_R = 9;
export const FOOT_X = 8;
export const FOOT_Y = 11;
/** Engine push, world units per second². */
export const THRUST = 72;
/** Turning speed with the keys or towards a drag's tilt, and the self-levelling speed. */
const TURN = 2.6;
const LEVEL = 1.6;
export const MAX_TILT = 1.3;
/** A drag this far sideways tilts the ship all the way. */
export const DRAG_FULL = 60;
/** Touchdown limits: sideways and downward speed, and tilt (radians). */
export const SAFE_VX = 18;
export const SAFE_VY = 30;
export const SAFE_TILT = 0.27;
/** Seconds the wreck shows before the next attempt. */
const BOOM_S = 1.1;

export const LIFE_BONUS = 50;

export const gravityFor = (d: Difficulty) => byLevel(d, [24, 28, 32, 36, 40]);
/** Seconds of thrust in the tank. */
export const fuelFor = (d: Difficulty) => byLevel(d, [13, 11.5, 10, 9, 8]);
/** Roughness of the ground: most a point rises or falls from the last. */
export const roughFor = (d: Difficulty) => byLevel(d, [10, 14, 18, 22, 26]);
/** Steady push of the wind (its side comes from the seed; it gusts a little). */
export const windFor = (d: Difficulty) => byLevel(d, [0, 0, 3, 6, 9]);
export const livesFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 2, 2]);
/** Pads on offer: their score multipliers (narrower pads pay more). */
const padsFor = (d: Difficulty) =>
  byLevel<number[]>(d, [
    [1, 2, 3],
    [1, 2, 3],
    [1, 2, 3],
    [2, 3],
    [2, 3],
  ]);
/** Pad width in terrain steps, by multiplier. */
const padSteps = (d: Difficulty, mult: number) =>
  byLevel(d, [
    [6, 5, 4],
    [5, 4, 3],
    [5, 4, 3],
    [5, 4, 3],
    [5, 4, 3],
  ])[mult - 1];

export interface Pad {
  x0: number;
  x1: number;
  y: number;
  mult: number;
}

type Phase = 'fly' | 'boom' | 'landed' | 'over';

export interface State {
  d: Difficulty;
  /** Terrain heights (screen y) at x = i * STEP. */
  ground: number[];
  pads: Pad[];
  gravity: number;
  wind: number;
  start: { x: number; y: number; vx: number };
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Tilt in radians: 0 is upright, positive leans right (thrust pushes right). */
  angle: number;
  /** Inputs: engine on, keys turning (-1, 0, 1), or a drag's tilt to turn towards (null when not dragging). */
  thrust: boolean;
  turn: number;
  tilt: number | null;
  fuel: number;
  fuelMax: number;
  phase: Phase;
  /** Seconds left of the wreck on screen. */
  boom: number;
  lives: number;
  time: number;
  score: number;
  /** The pad landed on. */
  pad: Pad | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deal a level: jagged ground with flat pads, start drift and wind, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const ground: number[] = [];
  let y = rng.int(280, 350);
  for (let i = 0; i < POINTS; i++) {
    y = clamp(y + rng.int(-roughFor(d), roughFor(d)), 230, 385);
    ground.push(y);
  }
  // Pads on separate stretches (seeded order), flattened into the ground.
  // Pads left to right in a seeded order, with seeded room between them (at least two steps of rough
  // ground, and one from each edge).
  const order = rng.shuffle([...padsFor(d)]);
  const spans = order.map((m) => padSteps(d, m));
  const slack = POINTS - 1 - spans.reduce((a, b) => a + b, 0) - 2 * order.length;
  const weights = order.map(() => 0.2 + rng.next());
  const total = weights.reduce((a, b) => a + b, 0) + 0.2 + rng.next();
  const pads: Pad[] = [];
  let i = 1;
  order.forEach((mult, k) => {
    i += Math.floor((slack * weights[k]) / total) + (k ? 2 : 0);
    const n = spans[k];
    const py = clamp(Math.round((ground[i] + ground[i + n]) / 2), 260, 375);
    for (let j = i; j <= i + n; j++) ground[j] = py;
    pads.push({ x0: i * STEP, x1: (i + n) * STEP, y: py, mult });
    i += n;
  });
  const drift = byLevel(d, [10, 14, 18, 22, 26]);
  const start = { x: rng.int(40, W - 40), y: 46, vx: rng.int(-drift, drift) };
  const fuel = fuelFor(d);
  return {
    d,
    ground,
    pads,
    gravity: gravityFor(d),
    wind: windFor(d) * (rng.chance(0.5) ? -1 : 1),
    start,
    x: start.x,
    y: start.y,
    vx: start.vx,
    vy: 0,
    angle: 0,
    thrust: false,
    turn: 0,
    tilt: null,
    fuel,
    fuelMax: fuel,
    phase: 'fly',
    boom: 0,
    lives: livesFor(d),
    time: 0,
    score: 0,
    pad: null,
  };
}

/** Ground height (screen y) at x. */
export function groundAt(s: State, x: number): number {
  const f = clamp(x, 0, W) / STEP;
  const i = Math.min(POINTS - 2, Math.floor(f));
  return s.ground[i] + (s.ground[i + 1] - s.ground[i]) * (f - i);
}

/** The wind's push right now (it gusts slowly around its steady value). */
export const windNow = (s: State) => s.wind * (0.75 + 0.25 * Math.sin(s.time * 0.9));

/** Is the ship's speed slow enough for a touchdown? */
export const slowEnough = (s: State) => Math.abs(s.vx) <= SAFE_VX && s.vy <= SAFE_VY;

/** A point on the ship (offset from its centre before tilting), in world units. */
function onShip(s: State, dx: number, dy: number) {
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  return { x: s.x + dx * c - dy * n, y: s.y + dx * n + dy * c };
}

/** The ship's two feet, in world units. */
const feet = (s: State) => [onShip(s, -FOOT_X, FOOT_Y), onShip(s, FOOT_X, FOOT_Y)];

export interface StepEvents {
  landed: boolean;
  crashed: boolean;
  /** A new attempt starts (after a crash with lives left). */
  retry: boolean;
  over: boolean;
}

/** Points for a touchdown on `pad`: its multiplier × (base + fuel left + softness), plus spare lives. */
function landingScore(s: State, pad: Pad): number {
  const soft = 1 - Math.max(Math.abs(s.vx) / SAFE_VX, Math.max(0, s.vy) / SAFE_VY);
  return pad.mult * (100 + Math.round((150 * s.fuel) / s.fuelMax) + Math.round(50 * soft)) + (s.lives - 1) * LIFE_BONUS;
}

/** Back to the start for another attempt, with a full tank. */
function reset(s: State) {
  s.x = s.start.x;
  s.y = s.start.y;
  s.vx = s.start.vx;
  s.vy = 0;
  s.angle = 0;
  s.fuel = s.fuelMax;
  s.phase = 'fly';
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { landed: false, crashed: false, retry: false, over: false };
  if (s.phase === 'landed' || s.phase === 'over') return ev;
  s.time += dt;
  if (s.phase === 'boom') {
    s.boom -= dt;
    if (s.boom > 0) return ev;
    if (s.lives <= 0) {
      s.phase = 'over';
      ev.over = true;
    } else {
      reset(s);
      ev.retry = true;
    }
    return ev;
  }

  // Turning: towards a drag's tilt, with the keys, or levelling itself when let go.
  if (s.tilt != null) {
    const d = clamp(s.tilt, -MAX_TILT, MAX_TILT) - s.angle;
    s.angle += clamp(d, -TURN * dt, TURN * dt);
  } else if (s.turn) s.angle = clamp(s.angle + s.turn * TURN * dt, -MAX_TILT, MAX_TILT);
  else s.angle -= clamp(s.angle, -LEVEL * dt, LEVEL * dt);

  let ax = windNow(s);
  let ay = s.gravity;
  if (s.thrust && s.fuel > 0) {
    s.fuel = Math.max(0, s.fuel - dt);
    ax += Math.sin(s.angle) * THRUST;
    ay -= Math.cos(s.angle) * THRUST;
  }
  s.vx += ax * dt;
  s.vy += ay * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  // Invisible walls at the sides and the top.
  if (s.x < SHIP_R || s.x > W - SHIP_R) {
    s.x = clamp(s.x, SHIP_R, W - SHIP_R);
    s.vx = 0;
  }
  if (s.y < SHIP_R + 24) {
    s.y = SHIP_R + 24;
    s.vy = Math.max(0, s.vy);
  }

  // Touching the ground: feet or hull.
  const [a, b] = feet(s);
  const hull = Array.from({ length: 8 }, (_, k) => onShip(s, Math.cos((k * Math.PI) / 4) * SHIP_R, Math.sin((k * Math.PI) / 4) * SHIP_R));
  const touching = [a, b, ...hull].some((p) => p.y >= groundAt(s, p.x));
  if (!touching) return ev;
  const pad = s.pads.find((p) => a.x >= p.x0 && b.x <= p.x1 && Math.abs(groundAt(s, s.x) - p.y) < 1);
  const footDown = [a, b].some((p) => p.y >= groundAt(s, p.x)) && hull.every((p) => p.y < groundAt(s, p.x));
  if (pad && footDown && slowEnough(s) && Math.abs(s.angle) <= SAFE_TILT) {
    s.phase = 'landed';
    s.pad = pad;
    s.y = pad.y - FOOT_Y;
    s.score = landingScore(s, pad);
    ev.landed = true;
    return ev;
  }
  s.lives--;
  s.phase = 'boom';
  s.boom = BOOM_S;
  ev.crashed = true;
  return ev;
}
