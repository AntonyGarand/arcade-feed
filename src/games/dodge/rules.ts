import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

export const W = 300;
export const H = 400;
export const PLAYER_R = 10;
/** Keyboard speed, world units per second. */
const KEY_SPEED = 240;
const INVULNERABLE_S = 1.5;
export const PICKUP_R = 9;
const PICKUP_LIFE_S = 4.5;
export const PICKUP_POINTS = 50;
/** Points per second survived, and per life left at the end. */
const SECOND_POINTS = 10;
export const LIFE_BONUS = 100;
/** Hazards are announced at the edge this long before they enter. */
const WARN_S = 0.7;

export const durationFor = (d: Difficulty) => byLevel(d, [30, 35, 40, 45, 50]);
export const livesFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 3, 2]);
/** Hazards per second at the start (it ramps up 50% by the end). */
export const rateFor = (d: Difficulty) => byLevel(d, [0.9, 1.2, 1.45, 1.65, 1.85]);
const speedFor = (d: Difficulty) => byLevel(d, [1, 1.08, 1.16, 1.24, 1.32]);
/** Roughly how many pickups a run offers (one every 3.5 s on average). */
export const pickupsFor = (d: Difficulty) => Math.floor((durationFor(d) - 3) / 3.5);
/** Which hazard kinds appear: falling blocks always, side discs from Medium, gapped bars from Hard. */
const kindsFor = (d: Difficulty): Kind[] =>
  byLevel<Kind[]>(d, [
    ['block'],
    ['block', 'block', 'disc'],
    ['block', 'disc', 'bar'],
    ['block', 'block', 'disc', 'bar'],
    ['block', 'disc', 'disc', 'bar'],
  ]);

type Kind = 'block' | 'disc' | 'bar';

interface Hazard {
  kind: Kind;
  /** Spawn time (seconds into the run). */
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Box size (blocks, bar halves) or diameter (discs). */
  w: number;
  h: number;
}

interface Pickup {
  t: number;
  x: number;
  y: number;
  taken: boolean;
}

export interface State {
  d: Difficulty;
  duration: number;
  time: number;
  px: number;
  py: number;
  /** Pointer target (null = keyboard). */
  target: { x: number; y: number } | null;
  /** Keyboard direction held. */
  kx: number;
  ky: number;
  lives: number;
  invulnerable: number;
  pickups: number;
  score: number;
  /** The whole run's schedule, dealt from the seed. */
  schedule: Hazard[];
  next: number;
  live: Hazard[];
  stars: Pickup[];
}

/** Deal the run: every hazard and pickup with its time, place and speed. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const duration = durationFor(d);
  const kinds = kindsFor(d);
  const sp = speedFor(d);
  const schedule: Hazard[] = [];
  // A short calm at the start, then a ramp.
  let barAt = 0;
  for (let t = 1.2; t < duration - 0.5;) {
    let kind = rng.pick(kinds);
    // Bars come at most every 2.2 s, so there's time to reach the next gap.
    if (kind === 'bar' && t < barAt) kind = 'block';
    if (kind === 'block') {
      const w = rng.int(16, 30);
      schedule.push({ kind, t, x: rng.int(0, W - w), y: -w, vx: 0, vy: rng.int(110, 170) * sp, w, h: w });
    } else if (kind === 'disc') {
      const w = rng.int(14, 22);
      const left = rng.chance(0.5);
      const v = rng.int(120, 180) * sp;
      schedule.push({ kind, t, x: left ? -w : W, y: rng.int(80, H - 30), vx: left ? v : -v, vy: rng.int(-20, 20), w, h: w });
    } else {
      // A full-width bar with a gap to slip through.
      const gap = byLevel(d, [90, 90, 80, 72, 64]);
      const at = rng.int(10, W - gap - 10);
      const vy = rng.int(70, 100) * sp;
      schedule.push({ kind, t, x: 0, y: -12, vx: 0, vy, w: at, h: 12 });
      schedule.push({ kind, t, x: at + gap, y: -12, vx: 0, vy, w: W - at - gap, h: 12 });
      barAt = t + 2.2;
    }
    const rate = rateFor(d) * (1 + (0.5 * t) / duration);
    t += (0.5 + rng.next()) / rate;
  }
  const stars: Pickup[] = [];
  for (let t = 2 + rng.next() * 2; t < duration - 1; t += 2.5 + rng.next() * 2)
    stars.push({ t, x: rng.int(20, W - 20), y: rng.int(H / 3, H - 24), taken: false });
  return {
    d,
    duration,
    time: 0,
    px: W / 2,
    py: H - 60,
    target: null,
    kx: 0,
    ky: 0,
    lives: livesFor(d),
    invulnerable: 0,
    pickups: 0,
    score: 0,
    schedule,
    next: 0,
    live: [],
    stars,
  };
}

/** Pickups showing right now. */
export const starsOut = (s: State) => s.stars.filter((p) => !p.taken && s.time >= p.t && s.time < p.t + PICKUP_LIFE_S);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Does a circle at (x, y) touch hazard `z`? */
function touches(z: Hazard, x: number, y: number, r = PLAYER_R): boolean {
  if (z.kind === 'disc') return Math.hypot(z.x + z.w / 2 - x, z.y + z.h / 2 - y) < z.w / 2 + r - 1;
  const nx = clamp(x, z.x, z.x + z.w);
  const ny = clamp(y, z.y, z.y + z.h);
  return (x - nx) ** 2 + (y - ny) ** 2 < (r - 1) ** 2;
}

export interface StepEvents {
  hurt: boolean;
  picked: boolean;
  won: boolean;
  over: boolean;
}

export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { hurt: false, picked: false, won: false, over: false };
  const before = Math.floor(s.time);
  s.time += dt;
  if (s.target) {
    s.px = s.target.x;
    s.py = s.target.y;
  } else if (s.kx || s.ky) {
    const n = Math.hypot(s.kx, s.ky);
    s.px += (s.kx / n) * KEY_SPEED * dt;
    s.py += (s.ky / n) * KEY_SPEED * dt;
  }
  s.px = clamp(s.px, PLAYER_R, W - PLAYER_R);
  s.py = clamp(s.py, PLAYER_R, H - PLAYER_R);
  s.invulnerable = Math.max(0, s.invulnerable - dt);

  while (s.next < s.schedule.length && s.schedule[s.next].t <= s.time) s.live.push({ ...s.schedule[s.next++] });
  for (const z of s.live) {
    z.x += z.vx * dt;
    z.y += z.vy * dt;
  }
  s.live = s.live.filter((z) => z.y < H + 10 && z.x < W + 40 && z.x + z.w > -40);
  if (!s.invulnerable && s.live.some((z) => touches(z, s.px, s.py))) {
    s.lives--;
    s.invulnerable = INVULNERABLE_S;
    ev.hurt = true;
    if (s.lives <= 0) {
      ev.over = true;
      return ev;
    }
  }
  for (const p of starsOut(s))
    if (Math.hypot(p.x - s.px, p.y - s.py) < PICKUP_R + PLAYER_R) {
      p.taken = true;
      s.pickups++;
      s.score += PICKUP_POINTS;
      ev.picked = true;
    }
  if (Math.floor(s.time) > before) s.score += SECOND_POINTS;
  if (s.time >= s.duration) {
    s.score += s.lives * LIFE_BONUS;
    ev.won = true;
  }
  return ev;
}

/** Hazards entering within WARN_S, for the edge markers. */
export const incoming = (s: State) => s.schedule.slice(s.next).filter((z) => z.t - s.time < WARN_S);
