import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

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
/** Missiles in the whole wave, counting the pieces of the ones that split (the same for every kind). */
export const waveSize = (d: Difficulty) => missilesFor(d) + splitsFor(d) * (kidsFor(d) - 1);

/** The kinds of wave a level can deal. */
export const KINDS = [
  { id: 'barrage', weight: 2 },
  { id: 'weavers' },
  { id: 'swarm' },
  { id: 'heavy', min: 2 },
  { id: 'mirv', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Streak powers: bigger blasts, a resupply, slow motion, a rebuilt city. */
export type Power = 'big' | 'supply' | 'slow' | 'rebuild';
/** Kills in a row (no wasted interceptor, nothing reaching the ground) that unlock each power. */
export const STREAK_TIERS = [6, 12, 20, 30, 42] as const;
const TIER_POWERS: readonly Power[] = ['big', 'supply', 'slow', 'rebuild', 'big'];
/** Seconds the big blasts and the slow motion last; how much bigger and how much slower. */
export const BIG_S = 8;
export const SLOW_S = 5;
const BIG_K = 1.35;
const SLOW_K = 0.5;
/** Interceptors a resupply gives each standing launcher, and a supply crate in all. */
export const SUPPLY_AMMO = 2;
export const CRATE_AMMO = 3;
const CRATE_V = 22;
export const CRATE_R = 9;

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
  /** Armour (2 = a heavy warhead that shrugs off its first blast), and sideways weave (0 = straight). */
  hp: number;
  wob: number;
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
  /** Hits left: a heavy warhead (2) survives its first blast. */
  hp: number;
  /** The blast that cracked its armour (it ignores that one), or -1. */
  skip: number;
  /** Sideways weave amplitude (0 = flies straight) and phase. */
  wob: number;
  ph: number;
  /** Where it would be without the weave. */
  px: number;
  py: number;
}

/** A supply crate drifting down on a parachute: blast it for interceptors. */
interface Crate {
  x: number;
  y: number;
  /** Wave time when it drops in. */
  t: number;
  /** Swing phase. */
  ph: number;
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
  id: number;
  x: number;
  y: number;
  /** Full radius, age in seconds, and the kind (player blast, chain, or ground impact). */
  max: number;
  age: number;
  kind: 'shot' | 'chain' | 'impact';
  /** Missiles (or crates) it caught: a player blast that catches nothing is a wasted shot. */
  hits: number;
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
  kind: KindId;
  plan: Plan[];
  next: number;
  /** Supply crates still to come or in the air (each drops in at its `t`). */
  crates: Crate[];
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
  /** Wave clock: runs at half speed during slow motion. */
  clock: number;
  ids: number;
  /** Kills in a row with no wasted interceptor and nothing reaching the ground; milestones reached. */
  streak: number;
  tier: number;
  /** Seconds of big blasts and slow motion left. */
  big: number;
  slow: number;
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

/** Deal the wave: its kind, then every missile's time, start, aim, speed and twist, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const cities = cityXs(citiesFor(d)).map((x) => ({ x, alive: true }));
  const pickAim = (): Aim => (rng.chance(0.75) ? { city: true, i: rng.int(0, cities.length - 1) } : { city: false, i: rng.int(0, 2) });
  // Every kind deals the same number of pieces in all (`waveSize`): a MIRV wave has more splitters,
  // so fewer missiles.
  const kids = kidsFor(d);
  const splits = kind === 'mirv' ? splitsFor(d) + byLevel(d, [3, 3, 4, 4, 4]) : splitsFor(d);
  const n = waveSize(d) - splits * (kids - 1);
  const wave = waveFor(d);
  // A fixed number of splitters, at seeded places in the wave (never among the first salvo).
  const splitters = new Set(rng.shuffle(Array.from({ length: n - 3 }, (_, i) => i + 3)).slice(0, splits));
  const heavies = kind === 'heavy' ? Math.round(n * 0.3) : 0;
  const plain = Array.from({ length: n }, (_, i) => i).filter((i) => !splitters.has(i));
  const heavy = new Set(rng.shuffle(plain).slice(0, heavies));
  // A swarm comes in tight packs of four from one spot; other waves in salvos of about three.
  const pack = kind === 'swarm' ? 4 : 3;
  let packX = W / 2;
  const plan: Plan[] = [];
  for (let k = 0; k < n; k++) {
    if (k % pack === 0) packX = 40 + rng.next() * (W - 80);
    const t = 1 + Math.floor(k / pack) * ((pack * wave) / n) + rng.next() * (kind === 'swarm' ? 0.6 : 1.2);
    const split = splitters.has(k);
    const weaves = kind === 'weavers' && rng.chance(0.65);
    plan.push({
      t,
      x: kind === 'swarm' ? packX + (rng.next() - 0.5) * 40 : 10 + rng.next() * (W - 20),
      aim: pickAim(),
      speed: speedFor(d) * (0.85 + rng.next() * 0.3) * (1 + (0.4 * k) / n) * (heavy.has(k) ? 0.8 : 1),
      splitY: split ? 110 + rng.next() * 90 : 0,
      kids: split ? Array.from({ length: kids }, pickAim) : [],
      hp: heavy.has(k) ? 2 : 1,
      wob: weaves ? 14 + rng.next() * byLevel(d, [6, 8, 10, 12, 14]) : 0,
    });
  }
  plan.sort((a, b) => a.t - b.t);
  // Supply crates: one a wave from Normal up, two against heavy warheads, at seeded times.
  const nCrates = kind === 'heavy' ? 2 : d >= 2 ? 1 : 0;
  const crates: Crate[] = Array.from({ length: nCrates }, (_, i) => ({
    x: 50 + rng.next() * (W - 100),
    y: -CRATE_R,
    t: wave * (0.25 + 0.35 * i) + rng.next() * 3,
    ph: rng.next() * Math.PI * 2,
  }));
  // Heavy warheads take two blasts, so their launchers get extra interceptors. A swarm is easy to
  // chain, so its launchers get one fewer.
  const ammo = ammoFor(d) + (kind === 'heavy' ? Math.ceil(heavies / 6) : kind === 'swarm' ? -2 : 0);
  return {
    d,
    kind,
    plan,
    next: 0,
    crates,
    missiles: [],
    shots: [],
    blasts: [],
    cities,
    bases: BASE_XS.map((x) => ({ x, ammo, alive: true })),
    cx: W / 2,
    cy: H / 2,
    kx: 0,
    ky: 0,
    kills: 0,
    score: 0,
    time: 0,
    clock: 0,
    ids: 0,
    streak: 0,
    tier: 0,
    big: 0,
    slow: 0,
  };
}

const aimX = (s: State, a: Aim) => (a.city ? s.cities[a.i].x : s.bases[a.i].x);

function launchMissile(s: State, x: number, y: number, aim: Aim, speed: number, splitY = 0, kids: Aim[] = [], hp = 1, wob = 0) {
  const tx = aimX(s, aim);
  const ty = GROUND_Y;
  const dist = Math.hypot(tx - x, ty - y) || 1;
  const id = s.ids++;
  s.missiles.push({
    id,
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
    hp,
    skip: -1,
    wob,
    ph: id * 1.7,
    px: x,
    py: y,
  });
}

/** Sideways weave at a missile's age and height: fades out near the ground, so it still lands on its mark. */
export const weave = (m: Missile, age: number, y: number) =>
  m.wob ? m.wob * Math.sin(age * 2.2 + m.ph) * Math.max(0, Math.min(1, (m.ty - y) / 90)) : 0;

/** Where a missile will be in `t` seconds, counting its weave and any slow motion left. */
export function predict(s: State, m: Missile, t: number): { x: number; y: number } {
  const k = s.slow > 0 ? Math.min(t, s.slow) * SLOW_K + Math.max(0, t - s.slow) : t;
  const py = m.py + m.vy * k;
  return { x: m.px + m.vx * k + weave(m, m.age + k, py), y: py };
}

/** Interceptors left, all launchers together. */
export const ammoLeft = (s: State) => s.bases.reduce((n, b) => n + (b.alive ? b.ammo : 0), 0);
/** Missiles still to come or in the air (crates don't count). */
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
/** The full blast radius right now (bigger while the `big` power runs): for the autopilot and the aim ring. */
export const blastMax = (s: State) => blastFor(s.d) * (s.big > 0 ? BIG_K : 1);

export interface StepEvents {
  killed: number;
  /** A missile hit the ground (where), wrecking a city or a launcher if it was there. */
  impacts: { x: number; wrecked: boolean }[];
  /** Heavy warheads whose armour a blast cracked (they fly on). */
  cracked: { x: number; y: number }[];
  /** Supply crates blasted open. */
  crates: { x: number; y: number }[];
  /** The streak just ended (a wasted interceptor or a missile through) after this many kills, or 0. */
  broke: number;
  /** A streak milestone reached this step (1-based) and the power it unlocked; 0 / null for none. */
  tier: number;
  power: Power | null;
  /** The city a `rebuild` brought back (index), or -1. */
  rebuilt: number;
  cleared: boolean;
  over: boolean;
}

/** Share `n` interceptors among the standing launchers, the emptiest first. */
function resupply(s: State, n: number) {
  const alive = s.bases.filter((b) => b.alive).sort((a, b) => a.ammo - b.ammo);
  for (let k = 0; k < n && alive.length; k++) alive[k % alive.length].ammo++;
}

/** Turn a streak power on. Returns the city it rebuilt, or -1. */
export function grant(s: State, p: Power): number {
  if (p === 'big') s.big = BIG_S;
  else if (p === 'slow') s.slow = SLOW_S;
  else {
    const i = p === 'rebuild' ? s.cities.findIndex((c) => !c.alive) : -1;
    if (i >= 0) {
      s.cities[i].alive = true;
      return i;
    }
    // A resupply (or nothing to rebuild): more interceptors for every standing launcher.
    resupply(s, SUPPLY_AMMO * s.bases.filter((b) => b.alive).length);
  }
  return -1;
}

/** Count `n` kills towards the streak; fire the milestones reached. */
function addStreak(s: State, n: number, ev: StepEvents) {
  s.streak += n;
  while (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
    const p = TIER_POWERS[s.tier++];
    ev.tier = s.tier;
    ev.power = p;
    const r = grant(s, p);
    if (r >= 0) ev.rebuilt = r;
  }
}

function breakStreak(s: State, ev: StepEvents) {
  if (s.streak >= 2) ev.broke = s.streak;
  s.streak = s.tier = 0;
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    killed: 0,
    impacts: [],
    cracked: [],
    crates: [],
    broke: 0,
    tier: 0,
    power: null,
    rebuilt: -1,
    cleared: false,
    over: false,
  };
  s.time += dt;
  // Slow motion slows the wave (missiles, crates and the wave clock), not your interceptors.
  const mdt = s.slow > 0 ? dt * SLOW_K : dt;
  s.slow = Math.max(0, s.slow - dt);
  s.big = Math.max(0, s.big - dt);
  s.clock += mdt;
  s.cx = Math.max(4, Math.min(W - 4, s.cx + s.kx * AIM_SPEED * dt));
  s.cy = Math.max(8, Math.min(AIM_MIN_Y, s.cy + s.ky * AIM_SPEED * dt));

  while (s.next < s.plan.length && s.plan[s.next].t <= s.clock) {
    const p = s.plan[s.next++];
    launchMissile(s, p.x, 0, p.aim, p.speed, p.splitY, p.kids, p.hp, p.wob);
  }

  // Interceptors fly straight to their mark and blow up there.
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const sh = s.shots[i];
    const dx = sh.tx - sh.x;
    const dy = sh.ty - sh.y;
    const d = Math.hypot(dx, dy);
    if (d <= SHOT_V * dt) {
      s.shots.splice(i, 1);
      s.blasts.push({ id: s.ids++, x: sh.tx, y: sh.ty, max: blastMax(s), age: 0, kind: 'shot', hits: 0 });
    } else {
      sh.x += (dx / d) * SHOT_V * dt;
      sh.y += (dy / d) * SHOT_V * dt;
    }
  }

  for (const b of s.blasts) b.age += dt;
  // A player blast that fades out without catching anything was a wasted shot: the streak ends.
  if (s.blasts.some((b) => b.age >= BLAST_S && b.kind === 'shot' && !b.hits)) breakStreak(s, ev);
  s.blasts = s.blasts.filter((b) => b.age < BLAST_S);
  const caught = (x: number, y: number, skip = -1) =>
    s.blasts.find((b) => b.kind !== 'impact' && b.id !== skip && Math.hypot(b.x - x, b.y - y) <= blastR(b));

  // Supply crates drift down on their parachutes; a blast opens them.
  for (let i = s.crates.length - 1; i >= 0; i--) {
    const c = s.crates[i];
    if (c.t > s.clock) continue;
    c.y += CRATE_V * mdt;
    c.x = Math.max(CRATE_R, Math.min(W - CRATE_R, c.x + Math.sin(s.clock * 1.6 + c.ph) * 10 * mdt));
    const b = c.y > 0 ? caught(c.x, c.y) : undefined;
    if (b) {
      b.hits++;
      s.crates.splice(i, 1);
      ev.crates.push({ x: c.x, y: c.y });
      resupply(s, CRATE_AMMO);
    } else if (c.y >= GROUND_Y - CRATE_R) s.crates.splice(i, 1);
  }

  let killed = 0;
  for (let i = s.missiles.length - 1; i >= 0; i--) {
    const m = s.missiles[i];
    m.age += mdt;
    m.px += m.vx * mdt;
    m.py += m.vy * mdt;
    m.y = m.py;
    m.x = m.px + weave(m, m.age, m.py);
    // Caught in a blast: it blows up too (a chain). A heavy warhead loses its armour first.
    const b = caught(m.x, m.y, m.skip);
    if (b) {
      b.hits++;
      if (m.hp > 1) {
        m.hp--;
        m.skip = b.id;
        ev.cracked.push({ x: m.x, y: m.y });
        continue;
      }
      s.missiles.splice(i, 1);
      s.blasts.push({ id: s.ids++, x: m.x, y: m.y, max: blastFor(s.d) * CHAIN, age: 0, kind: 'chain', hits: 0 });
      // A splitter stopped early counts for all its pieces.
      const n = m.splitY ? m.kids.length : 1;
      s.kills += n;
      s.score += n * MISSILE_POINTS;
      killed += n;
      continue;
    }
    if (m.splitY && m.y >= m.splitY) {
      s.missiles.splice(i, 1);
      for (const k of m.kids) launchMissile(s, m.x, m.y, k, Math.hypot(m.vx, m.vy));
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
      s.blasts.push({ id: s.ids++, x: m.tx, y: GROUND_Y, max: 16, age: 0, kind: 'impact', hits: 0 });
      ev.impacts.push({ x: m.tx, wrecked });
    }
  }
  if (ev.impacts.length) breakStreak(s, ev);
  if (killed) addStreak(s, killed, ev);
  ev.killed = killed;

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
