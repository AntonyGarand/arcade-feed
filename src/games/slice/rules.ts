import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind as LevelKind } from '../../core/variety';

export const W = 300;
export const H = 400;
export const LIVES = 3;
export const FRUIT_POINTS = 10;
export const TOUGH_POINTS = 30;
/** Extra points for each fruit after the first in one stroke. */
export const COMBO_POINTS = 10;
/** The combo bonus stops growing after this many extra fruit in one stroke. */
const MAX_CHAIN_BONUS = 4;
export const LIFE_BONUS = 50;
/** A golden fruit: small, flung high and fast, worth a lot. */
export const GOLD_POINTS = 25;
/** Slicing a bomb while the shield is up defuses it for these points. */
const DEFUSE_POINTS = 20;
/** Seconds of slow motion (from a frost fruit or a streak), and how slow the world runs. */
export const SLOW_S = 4;
export const SLOW = 0.45;
/** Seconds of double points from a long streak. */
export const DOUBLE_S = 6;
/** Streak lengths (slices in a row without a miss or a bomb) that fire a combo event. */
export const STREAK_TIERS = [5, 10, 16, 24, 34] as const;
/** What each streak milestone unlocks, in order. */
const TIER_POWERS = ['slow', 'frenzy', 'shield', 'double', 'frenzy'] as const;
export type Power = (typeof TIER_POWERS)[number];
/** Bonus fruit in a frenzy wave (the last milestone throws more). */
const frenzySize = (tier: number) => (tier >= 5 ? 8 : 5);
/** First throw, after a short breath. */
const FIRST_S = 1;
/** Blade speed (world units per second) a swipe needs to cut; it stays sharp HOT_S after the last fast move. */
const MIN_SPEED = 200;
const HOT_S = 0.15;
/** The blade cuts a little outside a fruit's outline (fingers are wide). */
const BLADE_PAD = 4;
/** Cuts more than this apart start a new combo. */
const COMBO_S = 0.35;
/** A tough fruit's second cut must come this long after the first. */
const RECUT_S = 0.12;
/** Keyboard blade speed. */
const KEY_SPEED = 460;
/** Pending blade segments kept between frames, at most. */
const MAX_SEGS = 64;

/** Fruits thrown in a run. */
export const fruitsFor = (d: Difficulty) => byLevel(d, [14, 20, 26, 32, 40]);
/** Of those, fruits with a hard rind that need two cuts. */
export const toughFor = (d: Difficulty) => byLevel(d, [0, 0, 3, 5, 7]);
/** Fruit radius. */
const radiusFor = (d: Difficulty) => byLevel(d, [29, 27, 25, 23, 21]);
/** Gravity: higher levels throw faster arcs. */
const gravityFor = (d: Difficulty) => byLevel(d, [400, 430, 470, 510, 550]);
/** Fruits per wave. */
const waveFor = (d: Difficulty) =>
  byLevel(d, [
    [1, 2],
    [1, 3],
    [2, 3],
    [2, 4],
    [2, 5],
  ] as const);
/** Seconds between waves. */
const gapFor = (d: Difficulty) =>
  byLevel(d, [
    [2.4, 3],
    [2.1, 2.6],
    [1.9, 2.4],
    [1.7, 2.2],
    [1.5, 2],
  ] as const);
/** Chance a wave brings a bomb (from the second wave on). */
const bombFor = (d: Difficulty) => byLevel(d, [0, 0.3, 0.45, 0.55, 0.65]);
/** Chance a wave comes as a salvo (one after the other) rather than a volley. */
const salvoFor = (d: Difficulty) => byLevel(d, [0.15, 0.25, 0.35, 0.4, 0.5]);
/** On Master a bomb ends the run; below, it costs a life. */
const bombEnds = (d: Difficulty) => d === 5;

/**
 * What flies: plain `fruit`, a `tough` one that needs two cuts, a `bomb`, a small `gold` fruit worth
 * a lot, a `frost` fruit that slows time, and `bonus` fruit from a frenzy. Only fruit and tough ones
 * must be sliced; the others are bonuses that leave without a penalty.
 */
type PieceKind = 'fruit' | 'tough' | 'bomb' | 'gold' | 'frost' | 'bonus';
/** Must this piece be sliced (missing it costs a heart)? */
export const required = (k: PieceKind) => k === 'fruit' || k === 'tough';

/** The kinds of level a run can deal. */
export const KINDS = [
  { id: 'toss', weight: 2 },
  { id: 'rain' },
  { id: 'festival' },
  { id: 'volley', min: 2 },
  { id: 'bombs', min: 2 },
  { id: 'sides', min: 3 },
] as const satisfies readonly LevelKind[];
export type KindId = (typeof KINDS)[number]['id'];

interface Throw {
  t: number;
  kind: PieceKind;
  /** Palette colour and glyph (they pair). */
  k: number;
  x: number;
  /** Where it starts (below the field, above it for rain, off a side). */
  y0: number;
  vx: number;
  vy: number;
  spin: number;
}

export interface Piece extends Throw {
  y: number;
  r: number;
  rot: number;
  /** Cuts left (2 for a tough fruit). */
  hp: number;
  /** Time of the last cut (-1 = none). */
  hitAt: number;
}

interface Cut {
  p: Piece;
  /** Direction of the blade (radians). */
  angle: number;
  points: number;
  /** Fruits in this stroke so far (2+ is a combo). */
  chain: number;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  r: number;
  g: number;
  schedule: Throw[];
  next: number;
  live: Piece[];
  time: number;
  lives: number;
  score: number;
  /** Fruits sliced (and fruits thrown in all). */
  sliced: number;
  total: number;
  bestChain: number;
  chain: number;
  chainT: number;
  /** Blade position and whether it is pressed. */
  bx: number;
  by: number;
  down: boolean;
  /** Seconds the blade stays sharp. */
  hot: number;
  /** Blade travel since the last step, and its segments (ax, ay, bx, by…). */
  travel: number;
  segs: number[];
  /** Keyboard direction held. */
  kx: number;
  ky: number;
  done: boolean;
  /** Slices in a row without a miss or a bomb (a 3+ fruit stroke counts double), and milestones reached. */
  streak: number;
  tier: number;
  /** Seconds of slow motion and double points left; bombs the shield will defuse. */
  slow: number;
  double: number;
  shield: number;
  /** For frenzy waves (they depend on play). */
  rng: Rng;
}

/** Colours / glyphs: gold is the accent (p1), frost p6, tough fruit p8; fruit gets the rest. */
const FRUIT_K = [1, 2, 3, 4, 6] as const;
const TOUGH_K = 7;
const FROST_K = 5;
const GOLD_K = 0;

/** A piece's radius from the level's fruit radius. */
const sizeOf = (r: number, kind: PieceKind) => r * (kind === 'gold' ? 0.72 : kind === 'bomb' || kind === 'bonus' ? 0.88 : 1);

/** Velocity for a throw from (x0, y0) that peaks at apexY and leaves past the bottom edge at x1. */
function arc(g: number, x0: number, y0: number, x1: number, apexY: number, r: number) {
  const up = Math.sqrt((2 * Math.max(0, y0 - apexY)) / g);
  const down = Math.sqrt((2 * (H + r - apexY)) / g);
  return { vx: (x1 - x0) / (up + down), vy: -g * up };
}

/** Where a throw is `tau` seconds after it starts. */
const posAt = (z: Throw, g: number, tau: number) => [z.x + z.vx * tau, z.y0 + z.vy * tau + (g * tau * tau) / 2] as const;

/** Seconds that two throws spend close together inside the field (a bomb shadowing a fruit). */
function shadow(a: Throw, b: Throw, g: number, r: number): number {
  const STEP = 0.05;
  let close = 0;
  for (let t = Math.max(a.t, b.t); t < Math.max(a.t, b.t) + 5; t += STEP) {
    const [ax, ay] = posAt(a, g, t - a.t);
    const [bx, by] = posAt(b, g, t - b.t);
    if (ay > H + r && t > a.t + 0.2) break;
    if (ay < H && ay > 0 && Math.hypot(ax - bx, ay - by) < r * 2.6) close += STEP;
  }
  return close;
}

interface Spot {
  x0: number;
  y0: number;
  x1: number;
  apex: number;
}

/** Where a throw of this level kind starts, peaks and ends (wave 0 is always a calm toss from below). */
function spot(kind: KindId, rng: Rng, wave: number, r: number): Spot {
  if (kind === 'rain' && wave > 0) {
    const x0 = rng.int(30, W - 30);
    return { x0, y0: -r, x1: Math.max(30, Math.min(W - 30, x0 + rng.int(-50, 50))), apex: -r };
  }
  if (kind === 'sides' && wave > 0) {
    const left = rng.chance(0.5);
    return {
      x0: left ? -r : W + r,
      y0: rng.int(H * 0.55, H * 0.8),
      x1: left ? rng.int(W * 0.55, W - 30) : rng.int(30, W * 0.45),
      apex: rng.int(60, 150),
    };
  }
  return { x0: rng.int(40, W - 40), y0: H + r, x1: rng.int(30, W - 30), apex: wave === 0 ? rng.int(70, 100) : rng.int(60, 170) };
}

/** Deal the whole run of throws from the seed (they don't depend on how you play). */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const r = radiusFor(d);
  // Rain falls from rest, so it gets a lighter pull to stay catchable.
  const g = gravityFor(d) * (kind === 'rain' ? 0.35 : 1);
  const total = fruitsFor(d);
  const [wLo, wHi] = waveFor(d);
  const [gLo, gHi] = gapFor(d);
  // Which fruit get the hard rind (never the first few).
  const order = [...Array(total).keys()].slice(3);
  const tough = new Set(rng.shuffle(order).slice(0, toughFor(d)));
  const schedule: Throw[] = [];
  const toss = (t: number, sort: PieceKind, k: number, at: Spot): Throw => {
    const { vx, vy } = arc(g, at.x0, at.y0, at.x1, at.apex, sizeOf(r, sort));
    return { t, kind: sort, k, x: at.x0, y0: at.y0, vx, vy, spin: (rng.next() - 0.5) * 6 };
  };
  const bombChance = kind === 'bombs' ? 0.85 : kind === 'festival' ? bombFor(d) * 0.6 : bombFor(d);
  const maxBombs = kind === 'bombs' ? (d >= 4 ? 3 : 2) : 1;
  const waves: number[] = [];
  /** Bombs to place once every fruit is dealt: (time, wave). */
  const bombAt: [number, number][] = [];
  let t = FIRST_S;
  let made = 0;
  for (let wave = 0; made < total; wave++) {
    waves.push(t);
    // A calm opening: one high, slow fruit first. Volleys come bigger and all at once, with longer breaths.
    const volley = kind === 'volley' && wave > 0;
    const size = wave === 0 ? 1 : Math.min(total - made, volley ? wHi + 1 : rng.int(wLo, wHi));
    const salvo = !volley && size > 1 && (kind === 'rain' || rng.chance(salvoFor(d)));
    // A volley fans out from a single launcher.
    const launcher = spot(kind, rng, wave, r);
    for (let i = 0; i < size; i++) {
      const at = volley
        ? { ...launcher, x1: 30 + ((W - 60) * (i + rng.next() * 0.6)) / size, apex: rng.int(70, 150) }
        : spot(kind, rng, wave, r);
      const sort: PieceKind = tough.has(made) ? 'tough' : 'fruit';
      const when = t + (volley ? i * 0.08 : salvo ? i * (kind === 'rain' ? 0.4 : 0.3) : rng.next() * 0.15);
      schedule.push(toss(when, sort, sort === 'tough' ? TOUGH_K : rng.pick(FRUIT_K), at));
      made++;
    }
    const bombs = wave > 0 && rng.chance(bombChance) ? (d === 5 && kind !== 'bombs' && rng.chance(0.3) ? 2 : rng.int(1, maxBombs)) : 0;
    for (let b = 0; b < bombs; b++) bombAt.push([t + 0.1 + rng.next() * 0.3, wave]);
    t += (gLo + rng.next() * (gHi - gLo)) * (volley ? (2 * (wHi + 1)) / (wLo + wHi) : 1);
  }
  // Bombs keep apart from the fruit in the air with them, so every fruit can be sliced clear of them.
  const fruit = schedule.slice();
  for (const [bt, wave] of bombAt) {
    let best: Throw | null = null;
    let worst = Infinity;
    for (let tries = 0; tries < 12 && worst > 0; tries++) {
      const z = toss(bt, 'bomb', 0, spot(kind, rng, wave, r));
      const near = fruit.reduce((m, f) => Math.max(m, shadow(f, z, g, r)), 0);
      if (near < worst) [best, worst] = [z, near];
    }
    // A bomb that would hug a fruit for long is left out.
    if (best && worst < 0.3) schedule.push(best);
  }
  // Specials ride along with later waves: gold fruit (flung high) and frost fruit.
  const golds = kind === 'festival' ? 3 : 1;
  const frosts = kind === 'festival' ? 2 : d >= 2 ? 1 : 0;
  for (let i = 0; i < golds + frosts; i++) {
    const sort: PieceKind = i < golds ? 'gold' : 'frost';
    const at = spot(kind, rng, 1, r);
    if (sort === 'gold' && at.apex > 0) at.apex = rng.int(40, 80);
    const wt = waves[rng.int(1, Math.max(1, waves.length - 2))] ?? waves[0];
    schedule.push(toss(wt + 0.25 + rng.next() * 0.3, sort, sort === 'frost' ? FROST_K : GOLD_K, at));
  }
  schedule.sort((a, b) => a.t - b.t);
  return {
    d,
    kind,
    r,
    g,
    schedule,
    next: 0,
    live: [],
    time: 0,
    lives: LIVES,
    score: 0,
    sliced: 0,
    total,
    bestChain: 0,
    chain: 0,
    chainT: 0,
    bx: W / 2,
    by: H / 2,
    down: false,
    hot: 0,
    travel: 0,
    segs: [],
    kx: 0,
    ky: 0,
    done: false,
    streak: 0,
    tier: 0,
    slow: 0,
    double: 0,
    shield: 0,
    rng,
  };
}

/** Fruits not thrown yet. */
export const toCome = (s: State) => s.schedule.slice(s.next).filter((z) => required(z.kind)).length;

/** Press the blade at (x, y): a new stroke. */
export function press(s: State, x: number, y: number) {
  s.bx = x;
  s.by = y;
  s.down = true;
  s.chain = 0;
}

/** Move the blade to (x, y); while pressed, the motion is a cut (if it is fast enough by the next step). */
export function drag(s: State, x: number, y: number) {
  if (s.down) {
    s.travel += Math.hypot(x - s.bx, y - s.by);
    if (s.segs.length < MAX_SEGS * 4) s.segs.push(s.bx, s.by, x, y);
  }
  s.bx = x;
  s.by = y;
}

export function release(s: State) {
  s.down = false;
  s.chain = 0;
}

/** Does the segment (ax, ay)–(bx, by) pass within `r` of (cx, cy)? */
export function crosses(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / l2)) : 0;
  return (ax + dx * k - cx) ** 2 + (ay + dy * k - cy) ** 2 <= r * r;
}

interface StepEvents {
  cuts: Cut[];
  /** Tough fruit that took their first cut. */
  cracked: Piece[];
  /** Bombs the blade touched. */
  booms: Piece[];
  /** Bombs the shield defused. */
  defused: Piece[];
  /** Fruit that fell off the bottom uncut. */
  missed: Piece[];
  /** A streak milestone reached this step (1-based), and what it unlocked; 0 / null for none. */
  tier: number;
  unlocked: Power | null;
  thrown: number;
  won: boolean;
  over: boolean;
}

function lose(s: State, ev: StepEvents, n: number) {
  s.lives = Math.max(0, s.lives - n);
  s.chain = 0;
  s.streak = s.tier = 0;
  if (s.lives === 0) {
    s.done = true;
    ev.over = true;
  }
}

/** Throw a frenzy wave: `n` bonus fruit fanning up from the bottom, peaking high in the field. */
function frenzy(s: State, n: number) {
  const r = sizeOf(s.r, 'bonus');
  for (let i = 0; i < n; i++) {
    const x0 = s.rng.int(40, W - 40);
    const x1 = 30 + ((W - 60) * (i + 0.5)) / n;
    const { vx, vy } = arc(s.g, x0, H + r, x1, s.rng.int(70, 140), r);
    s.live.push({
      t: s.time,
      kind: 'bonus',
      k: FRUIT_K[i % FRUIT_K.length],
      x: x0,
      y0: H + r,
      y: H + r,
      vx,
      vy,
      spin: (s.rng.next() - 0.5) * 6,
      r,
      rot: 0,
      hp: 1,
      hitAt: -1,
    });
  }
}

/** Turn a streak reward on. */
export function grant(s: State, p: Power, tier = 1) {
  if (p === 'slow') s.slow = SLOW_S;
  else if (p === 'double') s.double = DOUBLE_S;
  else if (p === 'shield') s.shield = 1;
  else frenzy(s, frenzySize(tier));
}

/** Count `n` more slices in the streak; fire the milestones it crosses. */
function addStreak(s: State, ev: StepEvents, n: number) {
  s.streak += n;
  while (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
    const p = TIER_POWERS[s.tier++];
    grant(s, p, s.tier);
    ev.tier = s.tier;
    ev.unlocked = p;
  }
}

/** Advance by `dt` seconds: blade cuts, throws, flight, misses. Slow motion slows the world, not the blade. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    cuts: [],
    cracked: [],
    booms: [],
    defused: [],
    missed: [],
    tier: 0,
    unlocked: null,
    thrown: 0,
    won: false,
    over: false,
  };
  if (s.done) return ev;
  const wdt = s.slow > 0 ? dt * SLOW : dt;
  s.slow = Math.max(0, s.slow - dt);
  s.double = Math.max(0, s.double - dt);
  s.time += wdt;
  if (s.kx || s.ky) {
    const n = Math.hypot(s.kx, s.ky);
    drag(s, Math.max(0, Math.min(W, s.bx + (s.kx / n) * KEY_SPEED * dt)), Math.max(0, Math.min(H, s.by + (s.ky / n) * KEY_SPEED * dt)));
  }
  if (dt > 0 && s.travel / dt >= MIN_SPEED) s.hot = HOT_S;
  else s.hot = Math.max(0, s.hot - dt);
  s.chainT = Math.max(0, s.chainT - dt);
  if (s.hot > 0) {
    for (let i = 0; i < s.segs.length && !s.done; i += 4) {
      const [ax, ay, bx, by] = s.segs.slice(i, i + 4);
      for (const p of s.live) {
        if (p.hp <= 0 || !crosses(ax, ay, bx, by, p.x, p.y, p.r + BLADE_PAD)) continue;
        if (p.kind === 'bomb') {
          p.hp = 0;
          if (s.shield > 0) {
            s.shield--;
            s.score += DEFUSE_POINTS;
            ev.defused.push(p);
            continue;
          }
          ev.booms.push(p);
          lose(s, ev, bombEnds(s.d) ? LIVES : 1);
          if (s.done) break;
          continue;
        }
        if (p.hitAt >= 0 && s.time - p.hitAt < RECUT_S) continue;
        p.hitAt = s.time;
        if (--p.hp > 0) {
          // The rind cracks and the fruit gets knocked up a little.
          p.vy = Math.min(p.vy, 0) - 60;
          ev.cracked.push(p);
          continue;
        }
        s.chain = s.chainT > 0 ? s.chain + 1 : 1;
        s.chainT = COMBO_S;
        s.bestChain = Math.max(s.bestChain, s.chain);
        const worth = p.kind === 'tough' ? TOUGH_POINTS : p.kind === 'gold' ? GOLD_POINTS : FRUIT_POINTS;
        const points = (worth + COMBO_POINTS * Math.min(MAX_CHAIN_BONUS, s.chain - 1)) * (s.double > 0 ? 2 : 1);
        s.score += points;
        if (required(p.kind)) s.sliced++;
        if (p.kind === 'frost') s.slow = Math.max(s.slow, SLOW_S);
        ev.cuts.push({ p, angle: Math.atan2(by - ay, bx - ax), points, chain: s.chain });
        // Long strokes feed the streak faster: the third fruit and up in one stroke count double.
        addStreak(s, ev, s.chain >= 3 ? 2 : 1);
      }
    }
  }
  s.segs.length = 0;
  s.travel = 0;
  if (s.done) return ev;

  while (s.next < s.schedule.length && s.schedule[s.next].t <= s.time) {
    const z = s.schedule[s.next++];
    s.live.push({ ...z, y: z.y0, r: sizeOf(s.r, z.kind), rot: 0, hp: z.kind === 'tough' ? 2 : 1, hitAt: -1 });
    ev.thrown++;
  }
  for (const p of s.live) {
    p.vy += s.g * wdt;
    p.x += p.vx * wdt;
    p.y += p.vy * wdt;
    p.rot += p.spin * wdt;
  }
  const gone = (p: Piece) => p.hp <= 0 || (p.vy > 0 && p.y - p.r > H);
  for (const p of s.live) if (p.hp > 0 && required(p.kind) && gone(p)) ev.missed.push(p);
  s.live = s.live.filter((p) => !gone(p));
  if (ev.missed.length) lose(s, ev, ev.missed.length);
  if (!s.done && s.next >= s.schedule.length && !s.live.length) {
    s.done = true;
    s.score += s.lives * LIFE_BONUS;
    ev.won = true;
  }
  return ev;
}
