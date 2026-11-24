import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

export const LIVES = 3;
/** Points for a hit, plus up to QUICK more for a fast one and STREAK more per hit in a row. */
export const HIT_POINTS = 10;
export const GOLD_POINTS = 40;
/** Points for finishing off a helmeted critter, or catching a hopper. */
export const TOUGH_POINTS = 25;
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
/** Seconds a critter stays up at least once its helmet is knocked off. */
const BARE_S = 0.55;
/** Holes a hopper visits (it jumps to the next one when you're too slow). */
const HOPS = 3;

/** Hits in a row that fire a combo event, and what each one unlocks. */
export const STREAK_TIERS = [5, 10, 16, 24, 34] as const;
export type Power = 'slow' | 'frenzy' | 'golden';
const TIER_POWERS: readonly Power[] = ['slow', 'frenzy', 'golden', 'frenzy', 'golden'];
/** Seconds each power lasts (slow-mo in real seconds, the others in game time). */
export const POWER_S: Record<Power, number> = { slow: 4, frenzy: 3, golden: 4 };
/** How fast the game runs during slow-mo. */
export const SLOW_RATE = 0.55;
/** Seconds between two bonus critters during a frenzy. */
const FRENZY_GAP = 0.4;

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

/** What pops out: a plain critter, a golden one, a spiky decoy, a helmeted one (two hits), a hopper. */
type Critter = 'normal' | 'gold' | 'decoy' | 'helmet' | 'hopper';

/** The kinds of round a level can deal. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'goldrush' },
  { id: 'spiky', min: 2 },
  { id: 'helmets', min: 2 },
  { id: 'hoppers', min: 2 },
  { id: 'waves', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** The critter mix and pacing of a kind of round at a level. */
interface Mix {
  decoy: number;
  gold: number;
  helmet: number;
  hopper: number;
  /** Share of the hittable critters to hit. */
  share: number;
  /** Pop-ups come in bursts, all at once, with lulls between. */
  waves: boolean;
  /** Gold critters stay up this much of the usual time. */
  goldUp: number;
  /** Gaps between pop-ups scale by this, and this many more can be up at once. */
  pace: number;
  crowd: number;
}

function mixFor(kind: KindId, d: Difficulty): Mix {
  const base: Mix = {
    decoy: decoyFor(d),
    gold: GOLD,
    helmet: d >= 3 ? 0.06 : 0,
    hopper: d >= 4 ? 0.05 : 0,
    share: shareFor(d),
    waves: false,
    goldUp: 0.6,
    pace: 1,
    crowd: 0,
  };
  switch (kind) {
    case 'goldrush':
      return { ...base, gold: 0.25, goldUp: 0.75, share: base.share - 0.05 };
    case 'spiky':
      // More decoys on top of the usual critters: busier holes, same number to hit.
      return { ...base, decoy: Math.min(0.42, base.decoy * 1.9 + 0.06), pace: 0.8, crowd: 1, share: base.share + 0.03 };
    case 'helmets':
      return { ...base, helmet: 0.38, share: base.share - 0.08 };
    case 'hoppers':
      return { ...base, hopper: 0.32, share: base.share - 0.06 };
    case 'waves':
      return { ...base, waves: true };
    default:
      return base;
  }
}

export interface Pop {
  /** Time it comes up, and how long it stays. */
  t: number;
  dur: number;
  hole: number;
  kind: Critter;
  /** When it was whacked (-1 = not yet). */
  hit: number;
  /** Helmet hits left before it can be whacked. */
  armor: number;
  /** Hopper: which run of hops it belongs to (-1: none), and whether this is its last hop. */
  chain: number;
  last: boolean;
  /** Gone for good (a hopper caught on another hop). */
  gone: boolean;
  /** A frenzy bonus: letting it go doesn't break the streak. */
  bonus: boolean;
}

export interface State {
  d: Difficulty;
  kind: KindId;
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
  /** Streak milestones reached (index into `STREAK_TIERS`). */
  tier: number;
  /** Seconds left of the mallet being stuck after a whiff. */
  whiff: number;
  /** Seconds left of each power (0: off). */
  slow: number;
  frenzy: number;
  golden: number;
  /** Seconds to the next frenzy critter. */
  spawnIn: number;
  done: boolean;
  rng: Rng;
}

/** Is `p` up and hittable at time `t`? */
export const isUp = (p: Pop, t: number) => p.hit < 0 && !p.gone && t >= p.t && t < p.t + p.dur;

/** Holes free from `at` to `until` (with a rest before and after anything else in them). */
function freeHoles(pops: Pop[], n: number, at: number, until: number): number[] {
  return [...Array(n * n).keys()].filter(
    (h) => !pops.some((p) => p.hole === h && !p.gone && p.t < until + REST_S && (p.hit >= 0 ? p.hit + 0.3 : p.t + p.dur) + REST_S > at),
  );
}

const pop = (t: number, dur: number, hole: number, kind: Critter, extra: Partial<Pop> = {}): Pop => ({
  t,
  dur,
  hole,
  kind,
  hit: -1,
  armor: kind === 'helmet' ? 1 : 0,
  chain: -1,
  last: true,
  gone: false,
  bonus: false,
  ...extra,
});

/** Deal the whole run of pop-ups from the seed (they don't depend on how you play, bar frenzies). */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const mix = mixFor(kind, d);
  const n = sizeFor(d);
  const duration = durationFor(d);
  const [gMin, gMax] = gapFor(d);
  const up = upFor(d);
  const pops: Pop[] = [];
  let chains = 0;
  // Critters come from a shuffled deck of 25, so each kind's mix shows up as dealt, seed after seed.
  let deck: Critter[] = [];
  const roll = (): Critter => {
    if (!deck.length) {
      const share = (k: Critter, p: number) => Array<Critter>(Math.round(p * 25)).fill(k);
      deck = [...share('decoy', mix.decoy), ...share('gold', mix.gold), ...share('helmet', mix.helmet), ...share('hopper', mix.hopper)];
      deck = rng.shuffle([...deck, ...Array<Critter>(Math.max(0, 25 - deck.length)).fill('normal')]);
    }
    return deck.pop()!;
  };
  /** Place one critter (or a hopper's run of hops) at `t` if there's room; returns whether it did. */
  const place = (t: number, what: Critter): boolean => {
    const dur = up * (0.85 + rng.next() * 0.3) * (what === 'gold' ? mix.goldUp : what === 'helmet' ? 1.25 : what === 'hopper' ? 0.7 : 1);
    const free = freeHoles(pops, n, t, t + dur);
    if (!free.length) return false;
    if (what !== 'hopper') {
      pops.push(pop(t, dur, rng.pick(free), what));
      return true;
    }
    const chain = chains++;
    let at = t;
    let hole = rng.pick(free);
    for (let i = 0; i < HOPS && at < duration - 0.3; i++) {
      pops.push(pop(at, dur, hole, 'hopper', { chain, last: false }));
      at += dur + 0.06;
      const next = freeHoles(pops, n, at, at + dur).filter((h) => h !== hole);
      if (!next.length) break;
      hole = rng.pick(next);
    }
    pops[pops.length - 1].last = true;
    return true;
  };
  const upAt = (at: number) => pops.filter((p) => p.t <= at && p.t + p.dur > at).length;
  let t = FIRST_S;
  while (t < duration - 0.6) {
    if (mix.waves) {
      // A burst: a hole-full of critters springing up one after the other, then a lull.
      const k = Math.min(n * n - 2, maxUpFor(d) + 2);
      let placed = 0;
      for (let i = 0; i < k; i++) if (place(t + i * 0.12, roll())) placed++;
      t += ((gMin + gMax) / 2) * Math.max(2, placed) + rng.next() * gMin;
      continue;
    }
    if (upAt(t) >= maxUpFor(d) + mix.crowd) {
      t += 0.1;
      continue;
    }
    if (!place(t, roll())) {
      t += 0.1;
      continue;
    }
    t += (gMin + rng.next() * (gMax - gMin)) * mix.pace;
  }
  const hittable = pops.filter((p) => p.kind !== 'decoy' && p.last).length;
  return {
    d,
    kind,
    n,
    pops,
    time: 0,
    duration,
    target: Math.round(hittable * mix.share),
    hits: 0,
    lives: LIVES,
    score: 0,
    streak: 0,
    tier: 0,
    whiff: 0,
    slow: 0,
    frenzy: 0,
    golden: 0,
    spawnIn: 0,
    done: false,
    rng,
  };
}

/** Turn a power on. A frenzy tames every decoy now up or about to pop, and brings bonus critters. */
function grant(s: State, p: Power) {
  if (p === 'slow') s.slow = POWER_S.slow;
  else if (p === 'golden') s.golden = POWER_S.golden;
  else {
    s.frenzy = POWER_S.frenzy;
    s.spawnIn = 0;
    for (const q of s.pops)
      if (q.kind === 'decoy' && q.hit < 0 && q.t + q.dur > s.time && q.t < s.time + POWER_S.frenzy)
        Object.assign(q, { kind: 'normal', bonus: true });
  }
}

type WhackResult = '' | 'hit' | 'gold' | 'clank' | 'decoy' | 'whiff' | 'win' | 'lose';

export interface BopResult {
  out: WhackResult;
  pop: Pop | null;
  points: number;
  /** A streak milestone reached by this hit (1-based), with the power it unlocked; 0 for none. */
  tier: number;
  power: Power | null;
}

/** Swing at `hole`. Returns what happened (and the critter it hit, if any). */
export function bop(s: State, hole: number): BopResult {
  const res: BopResult = { out: '', pop: null, points: 0, tier: 0, power: null };
  if (s.done || s.whiff > 0 || hole < 0 || hole >= s.n * s.n) return res;
  const p = s.pops.find((q) => q.hole === hole && isUp(q, s.time)) ?? null;
  res.pop = p;
  if (!p) {
    s.streak = s.tier = 0;
    s.whiff = WHIFF_S;
    res.out = 'whiff';
    return res;
  }
  if (p.kind === 'decoy') {
    p.hit = s.time;
    s.streak = s.tier = 0;
    s.lives--;
    if (s.lives > 0) res.out = 'decoy';
    else {
      s.done = true;
      res.out = 'lose';
    }
    return res;
  }
  if (p.armor > 0) {
    // Knock the helmet off: it stays up a little longer for the second hit.
    p.armor--;
    p.dur = Math.max(p.dur, s.time - p.t + BARE_S);
    res.out = 'clank';
    return res;
  }
  p.hit = s.time;
  if (p.chain >= 0) for (const q of s.pops) if (q.chain === p.chain && q !== p) q.gone = true;
  // Frenzy bonus critters pay, but don't push the streak on to the next milestone.
  if (!p.bonus) s.streak++;
  if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
    res.power = TIER_POWERS[s.tier];
    res.tier = ++s.tier;
    grant(s, res.power);
  }
  const base = p.kind === 'gold' || s.golden > 0 ? GOLD_POINTS : p.kind === 'helmet' || p.kind === 'hopper' ? TOUGH_POINTS : HIT_POINTS;
  const quick = Math.round(QUICK * Math.max(0, 1 - (s.time - p.t) / p.dur));
  res.points = base + quick + Math.min(s.streak - 1, STREAK_MAX) * STREAK;
  s.score += res.points;
  // Frenzy bonus critters only pay points: the goal counts the dealt ones.
  if (!p.bonus) s.hits++;
  if (s.hits < s.target) {
    res.out = p.kind === 'gold' || s.golden > 0 ? 'gold' : 'hit';
    return res;
  }
  s.done = true;
  s.score += Math.ceil(Math.max(0, s.duration - s.time)) * TIME_POINTS + s.lives * LIFE_BONUS;
  res.out = 'win';
  return res;
}

export interface StepEvents {
  /** A hittable critter went back down unhit. */
  missed: boolean;
  /** A hopper jumped to its next hole. */
  hopped: boolean;
  /** Frenzy critters that just popped up. */
  spawned: Pop[];
  /** Time's up short of the target. */
  over: boolean;
}

/** Advance by `dt` seconds (of real time: slow-mo runs the game slower). */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { missed: false, hopped: false, spawned: [], over: false };
  if (s.done) return ev;
  const gdt = s.slow > 0 ? dt * SLOW_RATE : dt;
  s.slow = Math.max(0, s.slow - dt);
  s.whiff = Math.max(0, s.whiff - dt);
  const before = s.time;
  s.time += gdt;
  s.golden = Math.max(0, s.golden - gdt);
  for (const p of s.pops) {
    const end = p.t + p.dur;
    if (p.hit >= 0 || p.gone || p.kind === 'decoy' || end <= before || end > s.time) continue;
    if (!p.last) ev.hopped = true;
    else if (!p.bonus) {
      ev.missed = true;
      s.streak = s.tier = 0;
    }
  }
  if (s.frenzy > 0) {
    // Bonus critters spring up in empty holes, quick and harmless.
    s.spawnIn -= gdt;
    while (s.spawnIn <= 0) {
      s.spawnIn += FRENZY_GAP;
      const dur = upFor(s.d) * 0.9;
      const free = freeHoles(s.pops, s.n, s.time, s.time + dur);
      if (!free.length) break;
      const q = pop(s.time, dur, s.rng.pick(free), 'normal', { bonus: true });
      s.pops.push(q);
      ev.spawned.push(q);
    }
    s.frenzy = Math.max(0, s.frenzy - gdt);
  }
  if (s.time >= s.duration) {
    s.done = true;
    ev.over = true;
  }
  return ev;
}
