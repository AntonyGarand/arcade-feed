import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units. */
export const W = 300;
export const H = 400;
export const GROUND_Y = 376;
/** Launchers and cities stand on the ground; a missile within this of one's centre wrecks it. */
const BASE_XS = [22, 150, 278] as const;
const HIT_R = 13;
export const CITY_W = 24;
/** Interceptor speed, and the highest point it can be sent to. */
export const SHOT_V = 330;
export const AIM_MIN_Y = GROUND_Y - 24;
/** Blast: grows, holds, then shrinks (seconds). Missiles caught in it blow up as smaller blasts. */
export const GROW_S = 0.4;
const HOLD_S = 0.35;
const FADE_S = 0.45;
const CHAIN = 0.62;
/** Keyboard crosshair speed. */
const AIM_SPEED = 240;
/** Points per missile destroyed; per city and per interceptor left at the end. */
export const MISSILE_POINTS = 25;
export const CITY_POINTS = 100;
export const AMMO_POINTS = 5;

export const missilesFor = (d: Difficulty) => byLevel(d, [16, 20, 24, 28, 32]);
export const citiesFor = (d: Difficulty) => byLevel(d, [6, 6, 6, 5, 4]);
export const ammoFor = (d: Difficulty) => byLevel(d, [8, 9, 10, 11, 12]);
/** Missile speed at the start of the wave (it rises 40% by the end) and the wave's length. */
export const speedFor = (d: Difficulty) => byLevel(d, [30, 34, 38, 42, 46]);
const waveFor = (d: Difficulty) => byLevel(d, [26, 28, 30, 32, 34]);
/** Missiles that split on the way down, and into how many. */
export const splitsFor = (d: Difficulty) => byLevel(d, [0, 0, 3, 6, 8]);
const kidsFor = (d: Difficulty) => (d >= 5 ? 3 : 2);
const blastFor = (d: Difficulty) => byLevel(d, [36, 35, 34, 33, 32]);

/** What a missile aims at: a city or a launcher. */
interface Aim {
  city: boolean;
  i: number;
}

/** One planned missile of the wave. */
interface Plan {
  t: number;
  x: number;
  aim: Aim;
  speed: number;
  /** Height where it splits (0 = never), and the children's aims. */
  splitY: number;
  kids: Aim[];
}

export interface Missile {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  splitY: number;
  kids: Aim[];
  /** Seconds since it appeared. */
  age: number;
}

interface Shot {
  x0: number;
  y0: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
}

export interface Blast {
  x: number;
  y: number;
  /** Full radius, age in seconds, and the kind (player blast, chain, or ground impact). */
  max: number;
  age: number;
  kind: 'shot' | 'chain' | 'impact';
}

interface City {
  x: number;
  alive: boolean;
}

export interface Base {
  x: number;
  ammo: number;
  alive: boolean;
}

export interface State {
  d: Difficulty;
  plan: Plan[];
  next: number;
  missiles: Missile[];
  shots: Shot[];
  blasts: Blast[];
  cities: City[];
  bases: Base[];
  /** Crosshair, and keyboard direction held. */
  cx: number;
  cy: number;
  kx: number;
  ky: number;
  kills: number;
  score: number;
  time: number;
  ids: number;
}

/** City centres: half in each gap between the launchers. */
function cityXs(n: number): number[] {
  const xs: number[] = [];
  const left = Math.ceil(n / 2);
  for (const [a, b, k] of [
    [BASE_XS[0], BASE_XS[1], left],
    [BASE_XS[1], BASE_XS[2], n - left],
  ])
    for (let i = 0; i < k; i++) xs.push(a + ((b - a) * (i + 1)) / (k + 1));
  return xs;
}

/** Deal the wave: every missile's time, start, aim, speed and split, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const cities = cityXs(citiesFor(d)).map((x) => ({ x, alive: true }));
  const pickAim = (): Aim => (rng.chance(0.75) ? { city: true, i: rng.int(0, cities.length - 1) } : { city: false, i: rng.int(0, 2) });
  const n = missilesFor(d);
  const wave = waveFor(d);
  // A fixed number of splitters, at seeded places in the wave (never among the first salvo).
  const splitters = new Set(rng.shuffle(Array.from({ length: n - 3 }, (_, i) => i + 3)).slice(0, splitsFor(d)));
  const plan: Plan[] = [];
  for (let k = 0; k < n; k++) {
    // Salvos of two to four, spread over the wave.
    const t = 1 + Math.floor(k / 3) * ((3 * wave) / n) + rng.next() * 1.2;
    const split = splitters.has(k);
    plan.push({
      t,
      x: 10 + rng.next() * (W - 20),
      aim: pickAim(),
      speed: speedFor(d) * (0.85 + rng.next() * 0.3) * (1 + (0.4 * k) / n),
      splitY: split ? 110 + rng.next() * 90 : 0,
      kids: split ? Array.from({ length: kidsFor(d) }, pickAim) : [],
    });
  }
  plan.sort((a, b) => a.t - b.t);
  return {
    d,
    plan,
    next: 0,
    missiles: [],
    shots: [],
    blasts: [],
    cities,
    bases: BASE_XS.map((x) => ({ x, ammo: ammoFor(d), alive: true })),
    cx: W / 2,
    cy: H / 2,
    kx: 0,
    ky: 0,
    kills: 0,
    score: 0,
    time: 0,
    ids: 0,
  };
}

const aimX = (s: State, a: Aim) => (a.city ? s.cities[a.i].x : s.bases[a.i].x);

function launchMissile(s: State, x: number, y: number, aim: Aim, speed: number, splitY: number, kids: Aim[]) {
  const tx = aimX(s, aim);
  const ty = GROUND_Y;
  const dist = Math.hypot(tx - x, ty - y) || 1;
  s.missiles.push({
    id: s.ids++,
    x0: x,
    y0: y,
    x,
    y,
    tx,
    ty,
    vx: ((tx - x) / dist) * speed,
    vy: ((ty - y) / dist) * speed,
    splitY,
    kids,
    age: 0,
  });
}

/** Interceptors left, all launchers together. */
export const ammoLeft = (s: State) => s.bases.reduce((n, b) => n + (b.alive ? b.ammo : 0), 0);
/** Missiles still to come or in the air. */
export const incoming = (s: State) => s.plan.length - s.next + s.missiles.length;
export const citiesLeft = (s: State) => s.cities.filter((c) => c.alive).length;

/** The launcher that would fire at x: the nearest one with ammo (or a forced one), or null. */
export function baseFor(s: State, x: number, force = -1): Base | null {
  if (force >= 0) {
    const b = s.bases[force];
    return b.alive && b.ammo > 0 ? b : null;
  }
  let best: Base | null = null;
  for (const b of s.bases) if (b.alive && b.ammo > 0 && (!best || Math.abs(b.x - x) < Math.abs(best.x - x))) best = b;
  return best;
}

/** Send an interceptor to (x, y) from the nearest launcher (or launcher `force`). True if one went. */
export function fire(s: State, x: number, y: number, force = -1): boolean {
  const b = baseFor(s, x, force);
  if (!b) return false;
  b.ammo--;
  const ty = Math.min(AIM_MIN_Y, Math.max(8, y));
  const tx = Math.max(4, Math.min(W - 4, x));
  s.shots.push({ x0: b.x, y0: GROUND_Y - 12, x: b.x, y: GROUND_Y - 12, tx, ty });
  return true;
}

/** Seconds an interceptor from the launcher at `bx` takes to reach (x, y). */
export const flightTime = (bx: number, x: number, y: number) => Math.hypot(x - bx, y - (GROUND_Y - 12)) / SHOT_V;
/** A blast's radius at its age. */
export function blastR(b: Blast): number {
  if (b.age < GROW_S) return b.max * (b.age / GROW_S);
  if (b.age < GROW_S + HOLD_S) return b.max;
  return Math.max(0, b.max * (1 - (b.age - GROW_S - HOLD_S) / FADE_S));
}
const BLAST_S = GROW_S + HOLD_S + FADE_S;
/** The full blast radius at a level (for the autopilot and the aim ring). */
export const blastMax = (s: State) => blastFor(s.d);

export interface StepEvents {
  killed: number;
  /** A missile hit the ground (where), wrecking a city or a launcher if it was there. */
  impacts: { x: number; wrecked: boolean }[];
  cleared: boolean;
  over: boolean;
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { killed: 0, impacts: [], cleared: false, over: false };
  s.time += dt;
  s.cx = Math.max(4, Math.min(W - 4, s.cx + s.kx * AIM_SPEED * dt));
  s.cy = Math.max(8, Math.min(AIM_MIN_Y, s.cy + s.ky * AIM_SPEED * dt));

  while (s.next < s.plan.length && s.plan[s.next].t <= s.time) {
    const p = s.plan[s.next++];
    launchMissile(s, p.x, 0, p.aim, p.speed, p.splitY, p.kids);
  }

  // Interceptors fly straight to their mark and blow up there.
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const sh = s.shots[i];
    const dx = sh.tx - sh.x;
    const dy = sh.ty - sh.y;
    const d = Math.hypot(dx, dy);
    if (d <= SHOT_V * dt) {
      s.shots.splice(i, 1);
      s.blasts.push({ x: sh.tx, y: sh.ty, max: blastFor(s.d), age: 0, kind: 'shot' });
    } else {
      sh.x += (dx / d) * SHOT_V * dt;
      sh.y += (dy / d) * SHOT_V * dt;
    }
  }

  for (const b of s.blasts) b.age += dt;
  s.blasts = s.blasts.filter((b) => b.age < BLAST_S);

  for (let i = s.missiles.length - 1; i >= 0; i--) {
    const m = s.missiles[i];
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.age += dt;
    // Caught in a blast: it blows up too (a chain).
    if (s.blasts.some((b) => b.kind !== 'impact' && Math.hypot(b.x - m.x, b.y - m.y) <= blastR(b))) {
      s.missiles.splice(i, 1);
      s.blasts.push({ x: m.x, y: m.y, max: blastFor(s.d) * CHAIN, age: 0, kind: 'chain' });
      // A splitter stopped early counts for all its pieces.
      const n = m.splitY ? m.kids.length : 1;
      s.kills += n;
      s.score += n * MISSILE_POINTS;
      ev.killed += n;
      continue;
    }
    if (m.splitY && m.y >= m.splitY) {
      s.missiles.splice(i, 1);
      for (const k of m.kids) launchMissile(s, m.x, m.y, k, Math.hypot(m.vx, m.vy), 0, []);
      continue;
    }
    if (m.y >= m.ty) {
      s.missiles.splice(i, 1);
      let wrecked = false;
      for (const t of [...s.cities, ...s.bases])
        if (t.alive && Math.abs(t.x - m.tx) < HIT_R) {
          t.alive = false;
          wrecked = true;
        }
      s.blasts.push({ x: m.tx, y: GROUND_Y, max: 16, age: 0, kind: 'impact' });
      ev.impacts.push({ x: m.tx, wrecked });
    }
  }

  if (!citiesLeft(s)) {
    ev.over = true;
    return ev;
  }
  if (!incoming(s)) {
    s.score += citiesLeft(s) * CITY_POINTS + ammoLeft(s) * AMMO_POINTS;
    ev.cleared = true;
  }
  return ev;
}

/** Missiles in the whole wave, counting the pieces of the ones that split. */
export const waveSize = (d: Difficulty) => missilesFor(d) + splitsFor(d) * (kidsFor(d) - 1);
