import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

export const LIVES = 3;
/** Points for a hit, plus up to QUICK more for a fast one and STREAK more per hit in a row. */
export const HIT_POINTS = 10;
export const GOLD_POINTS = 40;
const QUICK = 10;
const STREAK = 2;
const STREAK_MAX = 5;
export const TIME_POINTS = 5;
export const LIFE_BONUS = 30;
/** Seconds the mallet is stuck after hitting an empty hole (so mashing every hole doesn't pay). */
export const WHIFF_S = 0.35;
/** First pop-up, after a short breath. */
const FIRST_S = 0.8;
/** Gap kept between two pop-ups in the same hole. */
const REST_S = 0.2;

/** Holes per side. */
export const sizeFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 4, 4]);
/** Seconds the level lasts. */
export const durationFor = (d: Difficulty) => byLevel(d, [30, 32, 35, 38, 40]);
/** Seconds a critter stays up (±15%). */
export const upFor = (d: Difficulty) => byLevel(d, [1.35, 1.15, 1, 0.88, 0.78]);
/** Seconds between pop-ups. */
const gapFor = (d: Difficulty) =>
  byLevel(d, [
    [0.75, 1.15],
    [0.6, 0.95],
    [0.5, 0.85],
    [0.42, 0.72],
    [0.36, 0.62],
  ] as const);
/** Critters up at once, at most. */
const maxUpFor = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 4]);
/** Share of pop-ups that are decoys (don't hit them). */
export const decoyFor = (d: Difficulty) => byLevel(d, [0, 0.1, 0.16, 0.2, 0.24]);
const GOLD = 0.08;
/** Share of the hittable critters you must hit. */
const shareFor = (d: Difficulty) => byLevel(d, [0.6, 0.62, 0.65, 0.68, 0.7]);

type Kind = 'normal' | 'gold' | 'decoy';

export interface Pop {
  /** Time it comes up, and how long it stays. */
  t: number;
  dur: number;
  hole: number;
  kind: Kind;
  /** When it was whacked (-1 = not yet). */
  hit: number;
}

export interface State {
  d: Difficulty;
  n: number;
  pops: Pop[];
  time: number;
  duration: number;
  /** Hits needed to win. */
  target: number;
  hits: number;
  lives: number;
  score: number;
  /** Hits in a row (a miss, a whiff or a decoy resets it). */
  streak: number;
  /** Seconds left of the mallet being stuck after a whiff. */
  whiff: number;
  done: boolean;
}

/** Is `p` up and hittable at time `t`? */
export const isUp = (p: Pop, t: number) => p.hit < 0 && t >= p.t && t < p.t + p.dur;

/** Deal the whole run of pop-ups from the seed (they don't depend on how you play). */
export function createLevel(d: Difficulty, rng: Rng): State {
  const n = sizeFor(d);
  const duration = durationFor(d);
  const [gMin, gMax] = gapFor(d);
  const pops: Pop[] = [];
  let t = FIRST_S;
  while (t < duration - 0.6) {
    const roll = rng.next();
    const kind: Kind = roll < decoyFor(d) ? 'decoy' : roll < decoyFor(d) + GOLD ? 'gold' : 'normal';
    const dur = upFor(d) * (0.85 + rng.next() * 0.3) * (kind === 'gold' ? 0.6 : 1);
    const at = t;
    const live = pops.filter((p) => p.t + p.dur + REST_S > at);
    const free = [...Array(n * n).keys()].filter((h) => !live.some((p) => p.hole === h));
    if (live.filter((p) => p.t + p.dur > at).length >= maxUpFor(d) || !free.length) {
      t += 0.1;
      continue;
    }
    pops.push({ t, dur, hole: rng.pick(free), kind, hit: -1 });
    t += gMin + rng.next() * (gMax - gMin);
  }
  const hittable = pops.filter((p) => p.kind !== 'decoy').length;
  return {
    d,
    n,
    pops,
    time: 0,
    duration,
    target: Math.round(hittable * shareFor(d)),
    hits: 0,
    lives: LIVES,
    score: 0,
    streak: 0,
    whiff: 0,
    done: false,
  };
}

export type WhackResult = '' | 'hit' | 'gold' | 'decoy' | 'whiff' | 'win' | 'lose';

/** Swing at `hole`. Returns what happened (and the critter it hit, if any). */
export function bop(s: State, hole: number): { out: WhackResult; pop: Pop | null; points: number } {
  const none = { out: '' as WhackResult, pop: null, points: 0 };
  if (s.done || s.whiff > 0 || hole < 0 || hole >= s.n * s.n) return none;
  const pop = s.pops.find((p) => p.hole === hole && isUp(p, s.time)) ?? null;
  if (!pop) {
    s.streak = 0;
    s.whiff = WHIFF_S;
    return { out: 'whiff', pop: null, points: 0 };
  }
  pop.hit = s.time;
  if (pop.kind === 'decoy') {
    s.streak = 0;
    s.lives--;
    if (s.lives > 0) return { out: 'decoy', pop, points: 0 };
    s.done = true;
    return { out: 'lose', pop, points: 0 };
  }
  s.streak++;
  const quick = Math.round(QUICK * Math.max(0, 1 - (s.time - pop.t) / pop.dur));
  const points = (pop.kind === 'gold' ? GOLD_POINTS : HIT_POINTS) + quick + Math.min(s.streak - 1, STREAK_MAX) * STREAK;
  s.score += points;
  s.hits++;
  if (s.hits < s.target) return { out: pop.kind === 'gold' ? 'gold' : 'hit', pop, points };
  s.done = true;
  s.score += Math.ceil(Math.max(0, s.duration - s.time)) * TIME_POINTS + s.lives * LIFE_BONUS;
  return { out: 'win', pop, points };
}

export interface StepEvents {
  /** A hittable critter went back down unhit. */
  missed: boolean;
  /** Time's up short of the target. */
  over: boolean;
}

/** Advance by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { missed: false, over: false };
  if (s.done) return ev;
  const before = s.time;
  s.time += dt;
  s.whiff = Math.max(0, s.whiff - dt);
  for (const p of s.pops) {
    const end = p.t + p.dur;
    if (p.hit < 0 && p.kind !== 'decoy' && end > before && end <= s.time) {
      ev.missed = true;
      s.streak = 0;
    }
  }
  if (s.time >= s.duration) {
    s.done = true;
    ev.over = true;
  }
  return ev;
}
