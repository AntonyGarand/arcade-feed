import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units; everything wraps around its edges. */
export const W = 300;
export const H = 400;
export const SHIP_R = 8;
export const LIVES = 3;
/** Rock radius and points by size (1 small, 2 medium, 3 big). */
export const ROCK_R = [0, 9, 17, 30] as const;
export const POINTS = [0, 100, 50, 20] as const;
/** Clear bonus: per life left, and per second under par. */
export const LIFE_BONUS = 250;
export const TIME_POINTS = 10;
/** Turn rate (rad/s), thrust (units/s²), drag (per second) and top speed of the ship. */
const TURN = 4.4;
const THRUST = 230;
const DRAG = 0.7;
const MAX_V = 190;
const BULLET_V = 330;
const BULLET_LIFE = 0.75;
export const BULLET_R = 2.4;
const MAX_BULLETS = 4;
const FIRE_GAP = 0.22;
/** Safe time after a respawn; a respawn waits for a clear centre, or forces a shield after a while. */
const SAFE_S = 2.2;
const RESPAWN_S = 1.1;
const FORCE_S = 3.2;
const CLEAR_R = 70;
/** Touch: a finger farther than this from the ship makes it thrust (gently). */
export const TOUCH_THRUST = 80;
const TOUCH_POWER = 0.65;

/** Big rocks at the start, their speed, and the par time (seconds) for the time bonus. */
export const bigFor = (d: Difficulty) => byLevel(d, [4, 5, 6, 7, 8]);
const speedFor = (d: Difficulty) => byLevel(d, [26, 32, 38, 45, 52]);
export const parFor = (d: Difficulty) => byLevel(d, [45, 55, 65, 75, 85]);

export interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 3 big, 2 medium, 1 small. */
  size: number;
  /** Outline: one radius factor per vertex (irregular polygon). */
  shape: number[];
  rot: number;
  spin: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface State {
  d: Difficulty;
  rocks: Rock[];
  bullets: Bullet[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Heading in radians, 0 = up, clockwise. */
  a: number;
  alive: boolean;
  /** Seconds of safety left (blinks, rocks pass through). */
  safe: number;
  /** Seconds since the ship was lost (waiting to respawn). */
  wait: number;
  cool: number;
  /** Keyboard: turn -1/0/1, thrust and fire held. */
  turn: number;
  thrust: boolean;
  fire: boolean;
  /** Touch: where the finger is held (null when not touching). */
  pointer: { x: number; y: number } | null;
  /** The ship thrusted this step (for the flame). */
  burning: boolean;
  lives: number;
  score: number;
  time: number;
  rng: Rng;
}

/** Wrapped difference b − a along an axis of length `size`, in [−size/2, size/2). */
export const wrapD = (a: number, b: number, size: number) => ((((b - a + size / 2) % size) + size) % size) - size / 2;
const wrap = (v: number, size: number) => ((v % size) + size) % size;
/** Smallest signed angle from a to b. */
export const angleTo = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function makeRock(rng: Rng, x: number, y: number, size: number, dir: number, speed: number): Rock {
  const n = rng.int(9, 12);
  const shape: number[] = [];
  for (let i = 0; i < n; i++) shape.push(0.72 + rng.next() * 0.34);
  return {
    x,
    y,
    vx: Math.sin(dir) * speed,
    vy: -Math.cos(dir) * speed,
    size,
    shape,
    rot: rng.next() * Math.PI * 2,
    spin: (rng.next() - 0.5) * (4 - size) * 0.9,
  };
}

/** Deal a level: big rocks around (never on) the ship, with seeded shapes, headings and speeds. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const rocks: Rock[] = [];
  const n = bigFor(d);
  const sp = speedFor(d);
  const turn0 = rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const at = turn0 + (i * Math.PI * 2) / n + (rng.next() - 0.5) * 0.6;
    const dist = 120 + rng.next() * 50;
    const x = wrap(W / 2 + Math.sin(at) * dist, W);
    const y = wrap(H / 2 - Math.cos(at) * dist, H);
    // Mostly sideways to the centre, so nothing starts on a collision course with the ship.
    const dir = at + (rng.chance(0.5) ? 1 : -1) * (Math.PI / 2 + (rng.next() - 0.5) * 0.8);
    rocks.push(makeRock(rng, x, y, 3, dir, sp * (0.8 + rng.next() * 0.4)));
  }
  return {
    d,
    rocks,
    bullets: [],
    x: W / 2,
    y: H / 2,
    vx: 0,
    vy: 0,
    a: 0,
    alive: true,
    safe: 1.2,
    wait: 0,
    cool: 0,
    turn: 0,
    thrust: false,
    fire: false,
    pointer: null,
    burning: false,
    lives: LIVES,
    score: 0,
    time: 0,
    rng,
  };
}

/** A rock broke (or the ship blew up) here: for the card's debris. */
interface Blast {
  x: number;
  y: number;
  r: number;
  ship: boolean;
}

/** What one step changed, for the card. */
export interface StepEvents {
  blasts: Blast[];
  hit: boolean;
  died: boolean;
  respawned: boolean;
  cleared: boolean;
  over: boolean;
}

/** The ship's controls this step, merging keys and the held finger. */
function controls(s: State, dt: number): { thrust: number; fire: boolean } {
  let thrust = s.thrust ? 1 : 0;
  let fire = s.fire;
  if (s.pointer) {
    // Turn toward the finger (snapping when close), thrust gently if it's far, fire while held.
    const dx = s.pointer.x - s.x;
    const dy = s.pointer.y - s.y;
    const diff = angleTo(s.a, Math.atan2(dx, -dy));
    s.a += Math.abs(diff) <= TURN * dt ? diff : Math.sign(diff) * TURN * dt;
    if (Math.hypot(dx, dy) > TOUCH_THRUST && Math.abs(diff) < 1.2) thrust = Math.max(thrust, TOUCH_POWER);
    fire = true;
  } else s.a += s.turn * TURN * dt;
  return { thrust, fire };
}

/** Break rock `i`: two smaller ones fly apart (small ones just vanish). */
function breakRock(s: State, i: number, ev: StepEvents) {
  const r = s.rocks[i];
  s.rocks.splice(i, 1);
  s.score += POINTS[r.size];
  ev.hit = true;
  ev.blasts.push({ x: r.x, y: r.y, r: ROCK_R[r.size], ship: false });
  if (r.size <= 1) return;
  const dir = Math.atan2(r.vx, -r.vy);
  const sp = Math.max(Math.hypot(r.vx, r.vy) * 1.3, speedFor(s.d) * (r.size === 3 ? 1.3 : 1.7));
  for (const k of [-1, 1]) {
    const d2 = dir + k * (0.45 + s.rng.next() * 0.5);
    s.rocks.push(makeRock(s.rng, r.x, r.y, r.size - 1, d2, sp * (0.9 + s.rng.next() * 0.2)));
  }
}

const centreClear = (s: State) => s.rocks.every((r) => Math.hypot(wrapD(W / 2, r.x, W), wrapD(H / 2, r.y, H)) > CLEAR_R + ROCK_R[r.size]);

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { blasts: [], hit: false, died: false, respawned: false, cleared: false, over: false };
  s.time += dt;
  s.cool -= dt;
  s.burning = false;

  if (s.alive) {
    const c = controls(s, dt);
    const hx = Math.sin(s.a);
    const hy = -Math.cos(s.a);
    if (c.thrust) {
      s.vx += hx * THRUST * c.thrust * dt;
      s.vy += hy * THRUST * c.thrust * dt;
      s.burning = true;
    }
    const k = Math.exp(-DRAG * dt);
    s.vx *= k;
    s.vy *= k;
    const v = Math.hypot(s.vx, s.vy);
    if (v > MAX_V) {
      s.vx *= MAX_V / v;
      s.vy *= MAX_V / v;
    }
    s.x = wrap(s.x + s.vx * dt, W);
    s.y = wrap(s.y + s.vy * dt, H);
    s.safe = Math.max(0, s.safe - dt);
    if (c.fire && s.cool <= 0 && s.bullets.length < MAX_BULLETS) {
      s.cool = FIRE_GAP;
      s.bullets.push({
        x: s.x + hx * SHIP_R,
        y: s.y + hy * SHIP_R,
        vx: hx * BULLET_V + s.vx * 0.4,
        vy: hy * BULLET_V + s.vy * 0.4,
        life: BULLET_LIFE,
      });
    }
  } else if (s.lives > 0) {
    s.wait += dt;
    const forced = s.wait >= FORCE_S;
    if (s.wait >= RESPAWN_S && (forced || centreClear(s))) {
      Object.assign(s, { alive: true, x: W / 2, y: H / 2, vx: 0, vy: 0, a: 0, safe: forced ? SAFE_S + 1 : SAFE_S, wait: 0 });
      ev.respawned = true;
    }
  }

  for (const r of s.rocks) {
    r.x = wrap(r.x + r.vx * dt, W);
    r.y = wrap(r.y + r.vy * dt, H);
    r.rot += r.spin * dt;
  }

  // Bullets: in two half-steps so a fast shot never skips a small rock.
  for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
    const b = s.bullets[bi];
    b.life -= dt;
    let gone = b.life <= 0;
    for (let h = 0; h < 2 && !gone; h++) {
      b.x = wrap(b.x + (b.vx * dt) / 2, W);
      b.y = wrap(b.y + (b.vy * dt) / 2, H);
      const i = s.rocks.findIndex((r) => Math.hypot(wrapD(r.x, b.x, W), wrapD(r.y, b.y, H)) < ROCK_R[r.size] * 0.95 + BULLET_R);
      if (i >= 0) {
        breakRock(s, i, ev);
        gone = true;
      }
    }
    if (gone) s.bullets.splice(bi, 1);
  }

  if (s.alive && s.safe <= 0) {
    const i = s.rocks.findIndex((r) => Math.hypot(wrapD(r.x, s.x, W), wrapD(r.y, s.y, H)) < ROCK_R[r.size] * 0.85 + SHIP_R * 0.8);
    if (i >= 0) {
      s.alive = false;
      s.wait = 0;
      s.lives--;
      ev.died = true;
      ev.blasts.push({ x: s.x, y: s.y, r: 14, ship: true });
      breakRock(s, i, ev);
      if (s.lives <= 0) {
        ev.over = true;
        return ev;
      }
    }
  }

  if (!s.rocks.length) {
    s.score += s.lives * LIFE_BONUS + Math.max(0, Math.round((parFor(s.d) - s.time) * TIME_POINTS));
    ev.cleared = true;
  }
  return ev;
}

/** Every rock's points if all of them are shot: big 20, two medium 50, four small 100. */
export const rockPoints = (d: Difficulty) => bigFor(d) * (POINTS[3] + 2 * POINTS[2] + 4 * POINTS[1]);
