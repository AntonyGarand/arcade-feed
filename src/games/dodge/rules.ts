import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

export const W = 300;
export const H = 400;
export const PLAYER_R = 10;
/** Keyboard speed, world units per second. */
const KEY_SPEED = 240;
const INVULNERABLE_S = 1.5;
export const PICKUP_R = 9;
export const PICKUP_LIFE_S = 4.5;
export const PICKUP_POINTS = 50;
/** Points per second survived, and per life left at the end. */
const SECOND_POINTS = 10;
export const LIFE_BONUS = 100;
/** Hazards are announced at the edge this long before they enter. */
const WARN_S = 0.7;
/** A hazard passing this close (gap in world units) without a hit is a near miss. */
const CLOSE = 7;
/** Points for a near miss (times the chain multiplier). */
export const GRAZE_POINTS = 5;
/** Seconds a chain of near misses and stars stays alive after the last one. */
export const CHAIN_WINDOW = 5;
/** Chain lengths that unlock a power: shield, slow-mo, magnet + star shower, blast, blast again. */
export const CHAIN_TIERS = [3, 6, 10, 15, 22] as const;
export type Power = 'shield' | 'slow' | 'magnet' | 'blast';
const TIER_POWERS: readonly Power[] = ['shield', 'slow', 'magnet', 'blast', 'blast'];
/** Seconds slow-mo and the magnet last; how slow hazards go meanwhile. */
export const SLOW_S = 5;
export const MAGNET_S = 6;
const SLOW_RATE = 0.45;
const MAGNET_R = 130;
/** Stars dropped around the player by the magnet power. */
const SHOWER = 4;
/** Points per hazard cleared by a blast. */
export const BLAST_POINTS = 20;

export const durationFor = (d: Difficulty) => byLevel(d, [30, 35, 40, 45, 50]);
export const livesFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 3, 2]);
/** Hazards per second at the start (it ramps up 50% by the end). */
export const rateFor = (d: Difficulty) => byLevel(d, [1.2, 1.4, 1.6, 1.8, 2]);
const speedFor = (d: Difficulty) => byLevel(d, [1, 1.08, 1.16, 1.24, 1.32]);
/** Roughly how many pickups a run offers (one every 3.5 s on average). */
export const pickupsFor = (d: Difficulty) => Math.floor((durationFor(d) - 3) / 3.5);

/**
 * What flies at you. `block` falls, `disc` crosses from a side, `bar` comes down with a gap, `sweep` is a
 * wall sliding across with a gap, `seeker` homes in for a while, `bouncer` ricochets off the walls, `bomb`
 * falls and bursts into `shard`s.
 */
export type Shape = 'block' | 'disc' | 'bar' | 'sweep' | 'seeker' | 'bouncer' | 'bomb' | 'shard';
/** Shapes that collide as circles (the others are boxes). */
export const isRound = (k: Shape) => k !== 'block' && k !== 'bar' && k !== 'sweep';

/** Which hazards the classic mix deals: falling blocks always, side discs from Medium, gapped bars from Hard. */
const classicFor = (d: Difficulty): Shape[] =>
  byLevel<Shape[]>(d, [
    ['block'],
    ['block', 'block', 'disc'],
    ['block', 'disc', 'bar'],
    ['block', 'block', 'disc', 'bar'],
    ['block', 'disc', 'disc', 'bar'],
  ]);

/** The kinds of run a level can deal. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'rain' },
  { id: 'sweep', min: 2 },
  { id: 'seekers', min: 2 },
  { id: 'bouncers', min: 3 },
  { id: 'shrapnel', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Per kind: the hazard mix and how dense it comes (× the level's rate). */
const MIX: Record<KindId, (d: Difficulty) => { shapes: Shape[]; rate: number }> = {
  classic: (d) => ({ shapes: classicFor(d), rate: 1 }),
  rain: () => ({ shapes: ['block'], rate: 1.6 }),
  sweep: () => ({ shapes: ['sweep', 'block', 'block'], rate: 0.85 }),
  seekers: (d) => ({ shapes: d >= 4 ? ['seeker', 'block', 'disc'] : ['seeker', 'block', 'block'], rate: 1.2 }),
  bouncers: () => ({ shapes: ['bouncer', 'block', 'block', 'block'], rate: 1 }),
  shrapnel: (d) => ({ shapes: d >= 4 ? ['bomb', 'block', 'disc'] : ['bomb', 'block', 'block'], rate: 1.2 }),
};

interface Hazard {
  kind: Shape;
  /** Pair id: the two halves of a bar or sweep share it (one near miss for both). */
  id: number;
  /** Spawn time (hazard clock). */
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Box size (blocks, bar halves) or diameter (round ones). */
  w: number;
  h: number;
  /** Seekers: seconds of homing left. Bouncers: seconds of bouncing left. Bombs: the height they burst at. */
  life: number;
}

interface Pickup {
  t: number;
  x: number;
  y: number;
  taken: boolean;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  duration: number;
  time: number;
  /** Hazard clock: runs slower during slow-mo (spawns and moves follow it). */
  clock: number;
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
  /** Near misses and stars in a row, each within `CHAIN_WINDOW` of the last; a hit ends it. */
  chain: number;
  chainLeft: number;
  /** Chain milestones reached (index into `CHAIN_TIERS`). */
  tier: number;
  /** Near misses this run. */
  grazes: number;
  /** A shield that soaks up the next hit. */
  shield: boolean;
  /** Seconds of slow-mo and magnet left. */
  slow: number;
  magnet: number;
  /** Hazard pairs that already counted as a near miss. */
  grazed: Set<number>;
  nextId: number;
  rng: Rng;
}

/** Deal the run: every hazard and pickup with its time, place and speed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const duration = durationFor(d);
  const { shapes, rate: rateK } = MIX[kind](d);
  const sp = speedFor(d);
  const schedule: Hazard[] = [];
  let id = 0;
  const add = (z: Omit<Hazard, 'id' | 'life'> & { life?: number }) => schedule.push({ life: 0, ...z, id: id++ });
  // A short calm at the start, then a ramp.
  let wallAt = 0;
  for (let t = 1.2; t < duration - 0.5;) {
    let k = rng.pick(shapes);
    // Bars and sweeps come at most every 2.2 s, so there's time to reach the next gap.
    if ((k === 'bar' || k === 'sweep') && t < wallAt) k = 'block';
    if (k === 'block') {
      const w = kind === 'rain' ? rng.int(12, 22) : rng.int(18, 34);
      const v = (kind === 'rain' ? rng.int(150, 210) : rng.int(110, 170)) * sp;
      add({ kind: k, t, x: rng.int(0, W - w), y: -w, vx: 0, vy: v, w, h: w });
    } else if (k === 'disc') {
      const w = rng.int(14, 22);
      const left = rng.chance(0.5);
      const v = rng.int(120, 180) * sp;
      add({ kind: k, t, x: left ? -w : W, y: rng.int(80, H - 30), vx: left ? v : -v, vy: rng.int(-20, 20), w, h: w });
    } else if (k === 'bar') {
      // A full-width bar with a gap to slip through.
      const gap = byLevel(d, [90, 90, 80, 72, 64]);
      const at = rng.int(10, W - gap - 10);
      const vy = rng.int(70, 100) * sp;
      const pair = id;
      add({ kind: k, t, x: 0, y: -12, vx: 0, vy, w: at, h: 12 });
      add({ kind: k, t, x: at + gap, y: -12, vx: 0, vy, w: W - at - gap, h: 12 });
      schedule[schedule.length - 1].id = schedule[schedule.length - 2].id = pair;
      id = pair + 1;
      wallAt = t + 2.2;
    } else if (k === 'sweep') {
      // A full-height wall sliding in from a side, with a gap to slip through.
      const gap = byLevel(d, [110, 110, 100, 92, 84]);
      const at = rng.int(40, H - gap - 20);
      const left = rng.chance(0.5);
      const v = rng.int(60, 85) * sp;
      const x = left ? -12 : W;
      const vx = left ? v : -v;
      const pair = id;
      add({ kind: k, t, x, y: 0, vx, vy: 0, w: 12, h: at });
      add({ kind: k, t, x, y: at + gap, vx, vy: 0, w: 12, h: H - at - gap });
      schedule[schedule.length - 1].id = schedule[schedule.length - 2].id = pair;
      id = pair + 1;
      wallAt = t + 3;
    } else if (k === 'seeker') {
      const w = 16;
      add({ kind: k, t, x: rng.int(20, W - 20 - w), y: -w, vx: 0, vy: rng.int(95, 120) * sp, w, h: w, life: 2.4 });
    } else if (k === 'bouncer') {
      const w = rng.int(16, 22);
      const v = rng.int(95, 125) * sp;
      const a = (rng.next() - 0.5) * 1.6;
      add({ kind: k, t, x: rng.int(20, W - 20 - w), y: -w, vx: Math.sin(a) * v, vy: Math.cos(a) * v, w, h: w, life: rng.int(5, 7) });
    } else {
      // A bomb: falls, then bursts into shards at its fuse height.
      const w = 20;
      add({
        kind: k,
        t,
        x: rng.int(20, W - 20 - w),
        y: -w,
        vx: rng.next() * 2 - 1,
        vy: rng.int(80, 105) * sp,
        w,
        h: w,
        life: rng.int(H * 0.25, H * 0.55),
      });
    }
    const rate = rateFor(d) * rateK * (1 + (0.5 * t) / duration);
    t += (0.5 + rng.next()) / rate;
  }
  const stars: Pickup[] = [];
  for (let t = 2 + rng.next() * 2; t < duration - 1; t += 2.5 + rng.next() * 2)
    stars.push({ t, x: rng.int(20, W - 20), y: rng.int(H / 3, H - 24), taken: false });
  return {
    d,
    kind,
    duration,
    time: 0,
    clock: 0,
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
    chain: 0,
    chainLeft: 0,
    tier: 0,
    grazes: 0,
    shield: false,
    slow: 0,
    magnet: 0,
    grazed: new Set(),
    nextId: id,
    rng,
  };
}

/** Pickups showing right now. */
export const starsOut = (s: State) => s.stars.filter((p) => !p.taken && s.time >= p.t && s.time < p.t + PICKUP_LIFE_S);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Gap between a circle of radius `r` at (x, y) and hazard `z` (negative: overlapping). */
function gapTo(z: Hazard, x: number, y: number, r: number): number {
  if (isRound(z.kind)) return Math.hypot(z.x + z.w / 2 - x, z.y + z.h / 2 - y) - z.w / 2 - r;
  const nx = clamp(x, z.x, z.x + z.w);
  const ny = clamp(y, z.y, z.y + z.h);
  return Math.hypot(x - nx, y - ny) - r;
}

export interface StepEvents {
  hurt: boolean;
  picked: boolean;
  /** The shield soaked up a hit. */
  shielded: boolean;
  /** Near misses this step (where). */
  grazes: { x: number; y: number }[];
  /** A chain milestone reached (1-based), with the power it unlocked; 0 / null for none. */
  tier: number;
  unlocked: Power | null;
  /** Hazards cleared by a blast (centres). */
  blasted: { x: number; y: number }[];
  /** Bombs that burst this step (centres). */
  bursts: { x: number; y: number }[];
  won: boolean;
  over: boolean;
}

/** One more link in the chain (a near miss or a star): may reach a milestone and unlock a power. */
function link(s: State, ev: StepEvents) {
  s.chain++;
  s.chainLeft = CHAIN_WINDOW;
  if (s.tier < CHAIN_TIERS.length && s.chain >= CHAIN_TIERS[s.tier]) {
    s.tier++;
    const p = TIER_POWERS[s.tier - 1];
    grant(s, p, ev);
    ev.tier = s.tier;
    ev.unlocked = p;
  }
}

/** Turn a power on: a shield, slow-mo, a magnet with a shower of stars, or a blast that clears the field. */
export function grant(s: State, p: Power, ev?: StepEvents) {
  if (p === 'shield') s.shield = true;
  else if (p === 'slow') s.slow = SLOW_S;
  else if (p === 'magnet') {
    s.magnet = MAGNET_S;
    const a0 = s.rng.next() * Math.PI * 2;
    for (let i = 0; i < SHOWER; i++) {
      const a = a0 + (i * Math.PI * 2) / SHOWER;
      const r = 70 + s.rng.next() * 40;
      s.stars.push({ t: s.time, x: clamp(s.px + Math.cos(a) * r, 20, W - 20), y: clamp(s.py + Math.sin(a) * r, 30, H - 20), taken: false });
    }
  } else {
    for (const z of s.live) ev?.blasted.push({ x: z.x + z.w / 2, y: z.y + z.h / 2 });
    s.score += s.live.length * BLAST_POINTS;
    s.live = [];
  }
}

/** Move hazard `z` by `dt` of hazard time: seekers steer at the player, bouncers ricochet, bombs burst. */
function move(s: State, z: Hazard, dt: number, ev: StepEvents, born: Hazard[]): boolean {
  if (z.kind === 'seeker' && z.life > 0) {
    z.life -= dt;
    const sp = Math.hypot(z.vx, z.vy);
    const want = Math.atan2(s.py - (z.y + z.h / 2), s.px - (z.x + z.w / 2));
    const a = Math.atan2(z.vy, z.vx);
    let da = want - a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const na = a + clamp(da, -1.7 * dt, 1.7 * dt);
    z.vx = Math.cos(na) * sp;
    z.vy = Math.sin(na) * sp;
  }
  z.x += z.vx * dt;
  z.y += z.vy * dt;
  if (z.kind === 'bouncer' && (z.life -= dt) > 0) {
    if (z.x < 0 && z.vx < 0) z.vx = -z.vx;
    if (z.x + z.w > W && z.vx > 0) z.vx = -z.vx;
    if (z.y < 0 && z.vy < 0 && z.life < 4.5) z.vy = -z.vy;
    if (z.y + z.h > H && z.vy > 0) z.vy = -z.vy;
  }
  if (z.kind === 'bomb' && z.y + z.h / 2 >= z.life) {
    const cx = z.x + z.w / 2;
    const cy = z.y + z.h / 2;
    ev.bursts.push({ x: cx, y: cy });
    const n = 6;
    const a0 = (z.x * 7.3) % 1;
    const v = 115 * speedFor(s.d);
    for (let i = 0; i < n; i++) {
      const a = (a0 + i / n) * Math.PI * 2;
      born.push({
        kind: 'shard',
        id: s.nextId++,
        t: s.clock,
        x: cx - 4,
        y: cy - 4,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: 8,
        h: 8,
        life: 0,
      });
    }
    return false;
  }
  return z.y < H + 10 && z.y + z.h > -60 && z.x < W + 40 && z.x + z.w > -40;
}

export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    hurt: false,
    picked: false,
    shielded: false,
    grazes: [],
    tier: 0,
    unlocked: null,
    blasted: [],
    bursts: [],
    won: false,
    over: false,
  };
  const before = Math.floor(s.time);
  s.time += dt;
  const hz = dt * (s.slow > 0 ? SLOW_RATE : 1);
  s.clock += hz;
  s.slow = Math.max(0, s.slow - dt);
  s.magnet = Math.max(0, s.magnet - dt);
  if (s.chain && (s.chainLeft -= dt) <= 0) s.chain = s.tier = 0;
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

  while (s.next < s.schedule.length && s.schedule[s.next].t <= s.clock) s.live.push({ ...s.schedule[s.next++] });
  const born: Hazard[] = [];
  s.live = s.live.filter((z) => move(s, z, hz, ev, born));
  s.live.push(...born);
  if (!s.invulnerable && s.live.some((z) => gapTo(z, s.px, s.py, PLAYER_R - 1) < 0)) {
    s.invulnerable = INVULNERABLE_S;
    s.chain = s.tier = 0;
    if (s.shield) {
      s.shield = false;
      ev.shielded = true;
    } else {
      s.lives--;
      ev.hurt = true;
      if (s.lives <= 0) {
        ev.over = true;
        return ev;
      }
    }
  }
  // Near misses: a hazard brushing past (once per hazard) feeds the chain.
  if (!s.invulnerable)
    for (const z of s.live.slice()) {
      if (!s.live.includes(z)) break; // a blast just cleared the field
      if (s.grazed.has(z.id) || gapTo(z, s.px, s.py, PLAYER_R) > CLOSE) continue;
      s.grazed.add(z.id);
      s.grazes++;
      ev.grazes.push({ x: z.x + z.w / 2, y: z.y + z.h / 2 });
      link(s, ev);
      s.score += GRAZE_POINTS * (1 + s.tier);
    }
  for (const p of starsOut(s)) {
    if (s.magnet > 0) {
      const d = Math.hypot(s.px - p.x, s.py - p.y);
      if (d < MAGNET_R && d > 0) {
        const k = Math.min(d, 260 * dt) / d;
        p.x += (s.px - p.x) * k;
        p.y += (s.py - p.y) * k;
      }
    }
    if (Math.hypot(p.x - s.px, p.y - s.py) < PICKUP_R + PLAYER_R) {
      p.taken = true;
      s.pickups++;
      s.score += PICKUP_POINTS;
      ev.picked = true;
      link(s, ev);
    }
  }
  if (Math.floor(s.time) > before) s.score += SECOND_POINTS;
  if (s.time >= s.duration) {
    s.score += s.lives * LIFE_BONUS;
    ev.won = true;
  }
  return ev;
}

/** Hazards entering within WARN_S, for the edge markers. */
export const incoming = (s: State) => s.schedule.slice(s.next).filter((z) => z.t - s.clock < WARN_S);
