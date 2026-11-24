import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

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
  /**
   * A moving pad swings its left edge between `lo` and `hi` along a flat rail (easing at the ends):
   * `ph` is its phase, `rate` how fast it turns (radians/s), `v` its speed right now.
   */
  rail?: { lo: number; hi: number; ph: number; rate: number; v: number };
}

/** The kinds of level: a twist on the ground, the sky or the physics. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'canyon', min: 2 },
  { id: 'moving', min: 2 },
  { id: 'moon' },
  { id: 'storm', min: 3 },
  { id: 'asteroids', min: 2 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** A crystal (points) or a fuel can (a quarter tank) floating in the sky. */
interface Pickup {
  x: number;
  y: number;
  type: 'gem' | 'fuel';
  taken: boolean;
}

/** A drifting rock: touching it is a crash. */
interface Rock {
  x: number;
  y: number;
  vx: number;
  r: number;
}

/** Radius within which the ship grabs a pickup. */
const PICK_R = 14;
/** Seconds between two pickups before the chain breaks. */
export const CHAIN_WINDOW = 3.5;
/** Chain lengths that fire a combo event: a full tank, a shield, then slow motion. */
export const CHAIN_TIERS = [3, 5, 7] as const;
export type Reward = 'refill' | 'shield' | 'slow';
const REWARDS: readonly Reward[] = ['refill', 'shield', 'slow'];
/** Seconds of slow motion, and how fast time runs during it. */
export const SLOW_S = 6;
const SLOW_RATE = 0.55;
/** Points per pickup, times its place in the chain. */
const PICK_PTS = 5;

type Phase = 'fly' | 'boom' | 'landed' | 'over';

export interface State {
  d: Difficulty;
  kind: KindId;
  /** Terrain heights (screen y) at x = i * STEP. */
  ground: number[];
  pads: Pad[];
  gravity: number;
  wind: number;
  /** Storm: the wind swings from one side to the other. */
  swing: boolean;
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
  pickups: Pickup[];
  rocks: Rock[];
  /** Pickups grabbed in a row, each within `CHAIN_WINDOW` of the last; seconds left; milestones reached. */
  chain: number;
  chainLeft: number;
  tier: number;
  /** A shield takes the next hit. */
  shield: boolean;
  /** Seconds of slow motion left. */
  slow: number;
  /** Points from pickups, added to the landing score. */
  bonus: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deal a level: its kind, jagged ground with flat pads, pickups, start drift and wind, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const ground: number[] = [];
  let y = rng.int(280, 350);
  for (let i = 0; i < POINTS; i++) {
    y = clamp(y + rng.int(-roughFor(d), roughFor(d)), 230, 385);
    ground.push(y);
  }
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
  if (kind === 'canyon') carveCanyon(ground, pads, rng);
  if (kind === 'moving') laySlider(ground, pads, d, rng);
  const moon = kind === 'moon';
  const drift = byLevel(d, [10, 14, 18, 22, 26]) * (moon ? 1.5 : 1);
  const start = { x: rng.int(40, W - 40), y: 46, vx: rng.int(-drift, drift) };
  const fuel = fuelFor(d) * (moon ? 0.55 : 1);
  const wind = (kind === 'storm' ? windFor(d) + 8 : moon ? 0 : windFor(d)) * (rng.chance(0.5) ? -1 : 1);
  const s: State = {
    d,
    kind,
    ground,
    pads,
    gravity: gravityFor(d) * (moon ? 0.5 : 1),
    wind,
    swing: kind === 'storm',
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
    pickups: [],
    rocks: [],
    chain: 0,
    chainLeft: 0,
    tier: 0,
    shield: false,
    slow: 0,
    bonus: 0,
  };
  s.pickups = dealPickups(s, rng);
  if (kind === 'asteroids') s.rocks = dealRocks(s, rng);
  return s;
}

/** Canyon: a tall rock spire in every stretch between pads (and the edges), so each pad sits in a valley. */
function carveCanyon(ground: number[], pads: Pad[], rng: Rng) {
  const ends = [0, ...pads.flatMap((p) => [p.x0 / STEP, p.x1 / STEP]), POINTS - 1];
  for (let k = 0; k < ends.length; k += 2) {
    // Leave the step next to each pad alone, so the pad keeps a lip.
    const a = ends[k] + (k ? 1 : 0);
    const b = ends[k + 1] - (k + 2 < ends.length ? 1 : 0);
    if (b - a < 1) continue;
    const m = rng.int(a, b);
    const top = rng.int(140, 175);
    const slope = rng.int(22, 30);
    for (let j = a; j <= b; j++) ground[j] = Math.min(ground[j], top + Math.abs(j - m) * slope);
  }
}

/** Moving pad: the best pad (a step wider, as it's harder to hit) slides along a flat rail around it. */
function laySlider(ground: number[], pads: Pad[], d: Difficulty, rng: Rng) {
  const k = pads.reduce((a, p, j) => (p.mult > pads[a].mult ? j : a), 0);
  const p = pads[k];
  const lo = k ? pads[k - 1].x1 + 2 * STEP : STEP;
  const hi = k < pads.length - 1 ? pads[k + 1].x0 - 2 * STEP : W - STEP;
  const from = Math.max(lo, p.x0 - 4 * STEP);
  const to = Math.min(hi, p.x1 + 4 * STEP);
  const w = Math.min(to - from, p.x1 - p.x0 + STEP);
  for (let j = from / STEP; j <= to / STEP; j++) ground[j] = p.y;
  // Top speed at the middle of the rail, capped so a short rail doesn't shuttle frantically.
  const top = byLevel(d, [9, 10, 12, 13, 14]);
  const amp = (to - w - from) / 2;
  const rate = Math.min(0.7, top / Math.max(1, amp));
  p.rail = { lo: from, hi: to - w, ph: rng.next() * Math.PI * 2, rate, v: 0 };
  slide(p, 0);
}

/** Move a rail pad along by `dt` seconds. */
function slide(p: Pad, dt: number) {
  const r = p.rail;
  if (!r) return;
  const w = p.x1 - p.x0;
  const amp = (r.hi - r.lo) / 2;
  r.ph += r.rate * dt;
  p.x0 = r.lo + amp * (1 - Math.cos(r.ph));
  p.x1 = p.x0 + w;
  r.v = amp * r.rate * Math.sin(r.ph);
}

/**
 * Pickups: a trail of crystals snaking down from the start towards a pad (grab them in a row for a
 * chain), plus a fuel can or two off to the side.
 */
function dealPickups(s: State, rng: Rng): Pickup[] {
  const out: Pickup[] = [];
  const n = byLevel(s.d, [6, 6, 7, 7, 8]);
  const pad = rng.pick(s.pads);
  const tx = (pad.x0 + pad.x1) / 2;
  let x = clamp(s.start.x + rng.int(-30, 30), 24, W - 24);
  let y = 88;
  const dx = (tx - x) / n;
  const wob = rng.int(12, 22);
  const ph = rng.next() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const px = clamp(x + Math.sin(ph + k * 0.9) * wob, 16, W - 16);
    out.push({ x: px, y: Math.min(y, skyAt(s, px) - 40), type: 'gem', taken: false });
    x += dx;
    y += 22;
  }
  for (let k = 0; k < byLevel(s.d, [1, 1, 2, 2, 2]); k++) {
    const px = rng.int(20, W - 20);
    out.push({ x: px, y: rng.int(90, Math.max(100, skyAt(s, px) - 50)), type: 'fuel', taken: false });
  }
  return out;
}

/** Highest ground within a ship's width of x. */
const skyAt = (s: State, x: number) => Math.min(...[-14, 0, 14].map((o) => groundAt(s, clamp(x + o, 0, W))));

/** Asteroids: a few slow rocks drifting across the sky, clear of the start. */
function dealRocks(s: State, rng: Rng): Rock[] {
  const top = Math.min(...s.ground);
  const n = byLevel(s.d, [2, 2, 3, 3, 4]);
  return Array.from({ length: n }, (_, k) => {
    const y = 105 + ((top - 165) * (k + 0.5)) / n + rng.int(-6, 6);
    let x = rng.int(0, W);
    if (Math.abs(x - s.start.x) < 70) x = (x + W / 2) % W;
    return { x, y, vx: rng.int(12, 24) * (rng.chance(0.5) ? -1 : 1), r: rng.int(9, 12) };
  });
}

/** Ground height (screen y) at x. */
export function groundAt(s: State, x: number): number {
  const f = clamp(x, 0, W) / STEP;
  const i = Math.min(POINTS - 2, Math.floor(f));
  return s.ground[i] + (s.ground[i + 1] - s.ground[i]) * (f - i);
}

/** The wind's push right now: it gusts slowly around its steady value, or swings side to side in a storm. */
export const windNow = (s: State) =>
  s.swing ? s.wind * Math.sin(s.time * 0.45) * (0.85 + 0.15 * Math.sin(s.time * 1.7)) : s.wind * (0.75 + 0.25 * Math.sin(s.time * 0.9));

/** Is the ship's speed slow enough for a touchdown? */
export const slowEnough = (s: State) => Math.abs(sideSpeed(s)) <= SAFE_VX && s.vy <= SAFE_VY;

/** Sideways speed, relative to a moving pad when over one. */
const sideSpeed = (s: State) => s.vx - (s.pads.find((p) => p.rail && s.x >= p.x0 && s.x <= p.x1)?.rail?.v ?? 0);

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
  /** Pickups grabbed this step. */
  picked: Pickup[];
  /** Chain milestone reached this step (1-based, 0: none) and the reward it gave. */
  tier: number;
  reward: Reward | null;
  /** The shield took a hit instead of the ship. */
  shielded: boolean;
}

/** Points for a touchdown on `pad`: its multiplier × (base + fuel left + softness), plus spare lives and pickups. */
function landingScore(s: State, pad: Pad): number {
  const soft = 1 - Math.max(Math.abs(sideSpeed(s)) / SAFE_VX, Math.max(0, s.vy) / SAFE_VY);

  return pad.mult * (100 + Math.round((150 * s.fuel) / s.fuelMax) + Math.round(50 * soft)) + (s.lives - 1) * LIFE_BONUS + s.bonus;
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

/** Give a chain reward: a full tank, a shield, or slow motion. */
function grant(s: State, r: Reward) {
  if (r === 'refill') s.fuel = s.fuelMax;
  else if (r === 'shield') s.shield = true;
  else s.slow = SLOW_S;
}

/** Grab the pickups the ship touches; a quick chain of them earns rewards. */
function pick(s: State, ev: StepEvents) {
  for (const p of s.pickups) {
    if (p.taken || Math.hypot(p.x - s.x, p.y - s.y) > PICK_R) continue;
    p.taken = true;
    ev.picked.push(p);
    if (p.type === 'fuel') s.fuel = Math.min(s.fuelMax, s.fuel + s.fuelMax * 0.25);
    s.chain++;
    s.chainLeft = CHAIN_WINDOW;
    s.bonus += PICK_PTS * s.chain;
    if (s.tier < CHAIN_TIERS.length && s.chain >= CHAIN_TIERS[s.tier]) {
      ev.reward = REWARDS[s.tier];
      ev.tier = ++s.tier;
      grant(s, ev.reward);
    }
  }
}

/** The ship hit something: the shield takes it (the ship bounces up), or it's a crash. */
function hit(s: State, ev: StepEvents, ground: boolean) {
  if (s.shield) {
    s.shield = false;
    ev.shielded = true;
    s.vy = -Math.max(40, Math.abs(s.vy) * 0.6);
    s.vx *= -0.4;
    s.angle = 0;
    if (ground) s.y = skyAt(s, s.x) - FOOT_Y - SHIP_R - 4;
    return;
  }
  s.lives--;
  s.phase = 'boom';
  s.boom = BOOM_S;
  s.chain = s.tier = 0;
  s.chainLeft = s.slow = 0;
  ev.crashed = true;
}

/** Advance the game by `dt` seconds. */
export function step(s: State, frame: number): StepEvents {
  const ev: StepEvents = { landed: false, crashed: false, retry: false, over: false, picked: [], tier: 0, reward: null, shielded: false };
  if (s.phase === 'landed' || s.phase === 'over') return ev;
  // Slow motion: the whole world (and the chain clock) runs slower.
  const dt = s.slow > 0 ? frame * SLOW_RATE : frame;
  s.slow = Math.max(0, s.slow - frame);
  s.time += dt;

  for (const r of s.rocks) {
    r.x += r.vx * dt;
    if (r.x < -r.r) r.x += W + 2 * r.r;
    else if (r.x > W + r.r) r.x -= W + 2 * r.r;
  }
  for (const p of s.pads) slide(p, dt);

  if (s.chain && (s.chainLeft -= dt) <= 0) s.chain = s.tier = s.chainLeft = 0;
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

  pick(s, ev);
  const rock = s.rocks.find((r) => Math.hypot(r.x - s.x, r.y - s.y) < r.r + SHIP_R * 0.85);
  if (rock) {
    // A shield smashes the rock.
    if (s.shield) s.rocks.splice(s.rocks.indexOf(rock), 1);
    hit(s, ev, false);
    return ev;
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
  hit(s, ev, true);
  return ev;
}
