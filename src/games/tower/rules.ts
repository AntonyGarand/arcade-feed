import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units; the tower grows upwards (negative y) and the card scrolls with it. */
export const W = 300;
export const H = 400;
/** Block height. */
export const BH = 18;
/** Top of the ground: the base block sits on it. */
export const GROUND = H - 26;
/** Points per block placed, and per step of the perfect streak. */
export const BLOCK_POINTS = 10;
export const PERFECT_POINTS = 10;
/** A perfect drop onto a golden block: bonus points, and it grows the next block. */
export const GOLD_POINTS = 25;
const GOLD_GROW = 12;
/** The streak bonus stops growing here. */
const STREAK_CAP = 5;
/** Every this many perfects in a row, the block grows back a little. */
export const REGROW_EVERY = 3;
const REGROW = 8;
/** A sliver thinner than this falls off: the tower is done. */
const MIN_W = 2;
const GRAVITY = 900;
/** Speed-up per floor, and its cap (×). */
const RAMP = 0.03;
const RAMP_MAX = 1.45;
/** How far an icy block skids on in its direction of travel when dropped. */
export const SLIP = 11;
/** Heavy blocks slide this much faster, and are worth this many blocks. */
const HEAVY_SPEED = 1.12;
const HEAVY_MULT = 2;
/** Wind: the slider goes up to this much faster with the wind (and slower against it). */
const WIND = 0.45;
/** Shrinking blocks lose this many units of width per second while they slide, down to this share of the floor below. */
const SHRINK_RATE = 3;
const SHRINK_MIN = 0.9;
/** The crane swings slower on average: it whips through the middle, where the tower is. */
const CRANE_SPEED = 0.6;

/**
 * Perfects in a row that unlock a crane event: the block rebuilt wider, then slow motion, then a
 * magnet (perfects snap from further away).
 */
export const STREAK_TIERS = [4, 7, 11] as const;
export type Power = 'wide' | 'slow' | 'magnet';
const POWERS: readonly Power[] = ['wide', 'slow', 'magnet'];
/** Floors that slow motion and the magnet last, and their strength; how much the rebuild adds (share of the base). */
export const POWER_FLOORS = 3;
const SLOW = 0.6;
const MAGNET = 2;
const WIDE = 0.3;

export type KindId = 'classic' | 'windy' | 'crane' | 'shrink' | 'ice' | 'heavy';
export const KINDS: readonly (Kind & { id: KindId })[] = [
  { id: 'classic', weight: 1.2 },
  { id: 'windy', min: 2 },
  { id: 'crane' },
  { id: 'shrink', min: 2 },
  { id: 'ice', min: 3 },
  { id: 'heavy', min: 3 },
];

/** Special blocks: golden (a perfect on it pays and grows), icy (skids on when dropped), heavy (fast, worth double). */
export type Trait = 'plain' | 'gold' | 'ice' | 'heavy';

export const goalFor = (d: Difficulty) => byLevel(d, [10, 13, 16, 19, 22]);
const widthFor = (d: Difficulty) => byLevel(d, [150, 135, 120, 110, 100]);
export const speedFor = (d: Difficulty) => byLevel(d, [100, 115, 130, 145, 160]);
/** How far off (world units) a drop may land and still count as perfect. */
const toleranceFor = (d: Difficulty) => byLevel(d, [6, 5.5, 5, 4.5, 4.2]);

interface Block {
  x: number;
  w: number;
  perfect: boolean;
  trait: Trait;
}

/** A sliced-off piece falling away (drawing only). */
interface Chunk {
  x: number;
  y: number;
  w: number;
  vx: number;
  vy: number;
  /** Rotation (radians) and its speed. */
  a: number;
  spin: number;
  /** Floor it was cut from (for its colour). */
  floor: number;
  trait: Trait;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  /** Placed blocks, bottom first: blocks[0] is the base. */
  blocks: Block[];
  /** The sliding block: left edge, width, velocity (signed). */
  x: number;
  w: number;
  v: number;
  /** What the sliding block is; every floor's trait is dealt up front (index = floor). */
  trait: Trait;
  traits: Trait[];
  /** Windy levels: this floor's wind, -1 (to the left) … 1 (to the right). */
  wind: number;
  winds: number[];
  /** Crane levels: the swing's phase (the block swings on a cable instead of sliding). */
  phase: number;
  /** Width the sliding block started with (shrinking levels melt it from there). */
  w0: number;
  /** Floors to build (blocks above the base). */
  goal: number;
  baseW: number;
  tol: number;
  /** Perfects in a row, and the highest milestone it reached. */
  streak: number;
  tier: number;
  perfects: number;
  /** Floors of slow motion and of magnet left. */
  slow: number;
  magnet: number;
  score: number;
  chunks: Chunk[];
  done: boolean;
  rng: Rng;
}

/** The y of floor `i`'s top edge (floor 0 is the base). */
export const floorY = (i: number) => GROUND - (i + 1) * BH;
/** Floors built above the base. */
export const height = (s: State) => s.blocks.length - 1;
const top = (s: State) => s.blocks[s.blocks.length - 1];

/** Speed of the slider on the current floor. */
function sliderSpeed(s: State) {
  let v = speedFor(s.d) * Math.min(RAMP_MAX, 1 + RAMP * height(s));
  if (s.trait === 'heavy') v *= HEAVY_SPEED;
  if (s.slow > 0) v *= SLOW;
  return v;
}

/** Perfect tolerance right now (the magnet widens it). */
export const tolerance = (s: State) => s.tol * (s.magnet > 0 ? MAGNET : 1);

/** Where the sliding block would land if dropped now (icy blocks skid on). */
export function landX(s: State): number {
  if (s.trait !== 'ice') return s.x;
  return Math.max(0, Math.min(W - s.w, s.x + Math.sign(s.v) * SLIP));
}

/** Swing half-width and centre for the crane (the block swings across the whole field). */
const swing = (s: State) => (W - s.w) / 2;

/** Start the next block at a side: from the left on easy levels, alternating at 3–4, at random on 5. */
function spawn(s: State) {
  const n = height(s);
  const fromRight = s.d >= 5 ? s.rng.chance(0.5) : s.d >= 3 ? n % 2 === 1 : false;
  s.trait = s.traits[s.blocks.length] ?? 'plain';
  s.wind = s.winds[s.blocks.length] ?? 0;
  s.w = s.w0 = top(s).w;
  s.x = fromRight ? W - s.w : 0;
  s.v = (fromRight ? -1 : 1) * sliderSpeed(s);
  s.phase = fromRight ? Math.PI / 2 : -Math.PI / 2;
}

/** Deal every floor's block trait and wind, by kind. */
function dealFloors(s: State) {
  const n = s.goal + 2;
  const gold = s.kind === 'classic' ? 0.2 : 0.1;
  const ice = s.kind === 'ice' ? 0.45 : 0;
  const heavy = s.kind === 'heavy' ? 0.4 : 0;
  s.traits = ['plain'];
  s.winds = [0];
  let wind = s.rng.chance(0.5) ? 1 : -1;
  for (let i = 1; i < n; i++) {
    const r = s.rng.next();
    // The first two floors are always plain, to get going.
    s.traits.push(i <= 2 ? 'plain' : r < ice ? 'ice' : r < ice + heavy ? 'heavy' : r < ice + heavy + gold ? 'gold' : 'plain');
    // Gusts keep a direction for a few floors, then turn.
    if (s.rng.chance(0.3)) wind = -wind;
    s.winds.push(s.kind === 'windy' ? wind * (0.5 + s.rng.next() * 0.5) : 0);
  }
}

/** Deal a level: the base slab, centred, and the first block sliding in. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const baseW = widthFor(d);
  const s: State = {
    d,
    kind,
    blocks: [{ x: (W - baseW) / 2 + rng.int(-20, 20), w: baseW, perfect: false, trait: 'plain' }],
    x: 0,
    w: baseW,
    v: 0,
    trait: 'plain',
    traits: [],
    wind: 0,
    winds: [],
    phase: 0,
    w0: baseW,
    goal: goalFor(d),
    baseW,
    tol: toleranceFor(d),
    streak: 0,
    tier: 0,
    perfects: 0,
    slow: 0,
    magnet: 0,
    score: 0,
    chunks: [],
    done: false,
    rng,
  };
  dealFloors(s);
  spawn(s);
  return s;
}

export interface DropResult {
  kind: 'perfect' | 'cut' | 'miss';
  /** Width sliced off. */
  cut: number;
  /** Points this drop earned. */
  points: number;
  /** The block grew back (a streak of perfects or a golden perfect). */
  grew: boolean;
  /** A perfect on a golden block. */
  gold: boolean;
  /** The streak just reached milestone `tier` (1-based) and unlocked `power` (0 / null: none). */
  tier: number;
  power: Power | null;
  cleared: boolean;
  over: boolean;
}

function fall(s: State, x: number, w: number, dir: number) {
  s.chunks.push({
    x,
    y: floorY(s.blocks.length),
    w,
    vx: dir * 40,
    vy: 0,
    a: 0,
    spin: dir * (2 + s.rng.next() * 2),
    floor: s.blocks.length,
    trait: s.trait,
  });
}

/** Grow the block about to be placed by up to `grow` (not past the base), keeping it on the field. */
function widen(s: State, b: { x: number; w: number }, grow: number) {
  const g = Math.min(grow, s.baseW - b.w);
  if (g <= 0) return false;
  b.w += g;
  b.x = Math.max(0, Math.min(W - b.w, b.x - g / 2));
  return true;
}

/** Turn on a streak power. */
function grant(s: State, p: Power, b: { x: number; w: number }) {
  if (p === 'slow') s.slow = POWER_FLOORS;
  else if (p === 'magnet') s.magnet = POWER_FLOORS;
  else widen(s, b, s.baseW * WIDE);
}

/** Drop the sliding block where it is: perfect, sliced, or off the tower. */
export function drop(s: State): DropResult | null {
  if (s.done) return null;
  const t = top(s);
  const res: DropResult = { kind: 'cut', cut: 0, points: 0, grew: false, gold: false, tier: 0, power: null, cleared: false, over: false };
  const sx = landX(s);
  const left = Math.max(sx, t.x);
  const right = Math.min(sx + s.w, t.x + t.w);
  if (right - left < MIN_W) {
    fall(s, sx, s.w, sx < t.x ? -1 : 1);
    res.kind = 'miss';
    res.cut = s.w;
    res.over = true;
    s.done = true;
    s.streak = s.tier = 0;
    return res;
  }
  const b = { x: left, w: right - left };
  const base = BLOCK_POINTS * (s.trait === 'heavy' ? HEAVY_MULT : 1);
  // Perfect: the centres line up (blocks are as wide as the floor below, except when they shrink).
  if (Math.abs(sx + s.w / 2 - (t.x + t.w / 2)) <= tolerance(s)) {
    res.kind = 'perfect';
    b.w = Math.min(s.w, t.w);
    b.x = t.x + (t.w - b.w) / 2;
    s.streak++;
    s.perfects++;
    res.points = base + PERFECT_POINTS * Math.min(STREAK_CAP, s.streak);
    if (s.streak % REGROW_EVERY === 0) res.grew = widen(s, b, REGROW);
    if (t.trait === 'gold') {
      res.gold = true;
      res.points += GOLD_POINTS;
      res.grew = widen(s, b, GOLD_GROW) || res.grew;
    }
    if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
      res.tier = ++s.tier;
      res.power = POWERS[s.tier - 1];
      grant(s, res.power, b);
      if (res.power === 'wide') res.grew = true;
    }
  } else {
    res.cut = s.w - b.w;
    if (sx < left) fall(s, sx, left - sx, -1);
    if (sx + s.w > right) fall(s, right, sx + s.w - right, 1);
    s.streak = s.tier = 0;
    res.points = base;
  }
  // Slow motion and the magnet run down one floor per drop.
  if (!res.power) {
    s.slow = Math.max(0, s.slow - 1);
    s.magnet = Math.max(0, s.magnet - 1);
  }
  s.blocks.push({ x: b.x, w: b.w, perfect: res.kind === 'perfect', trait: s.trait });
  s.score += res.points;
  if (height(s) >= s.goal) {
    res.cleared = true;
    s.done = true;
  } else spawn(s);
  return res;
}

/** Advance by `dt` seconds: the slider moves (slides, rides the wind or swings), cut pieces fall away. */
export function step(s: State, dt: number) {
  if (!s.done) {
    const speed = sliderSpeed(s);
    if (s.kind === 'crane') {
      // Swing on a cable: fast through the middle, slow at the ends, same average speed.
      const a = swing(s);
      const om = a > 0 ? (Math.PI * speed * CRANE_SPEED) / (2 * a) : 0;
      s.phase += om * dt;
      s.x = W / 2 - s.w / 2 + a * Math.sin(s.phase);
      s.v = a * om * Math.cos(s.phase);
    } else {
      const dir = Math.sign(s.v) || 1;
      s.v = dir * speed * (1 + WIND * s.wind * dir);
      s.x += s.v * dt;
      if (s.x < 0) {
        s.x = -s.x;
        s.v = Math.abs(s.v);
      } else if (s.x > W - s.w) {
        s.x = 2 * (W - s.w) - s.x;
        s.v = -Math.abs(s.v);
      }
    }
    if (s.kind === 'shrink') {
      // The block melts from both sides while it slides.
      const min = s.w0 * SHRINK_MIN;
      if (s.w > min) {
        const nw = Math.max(min, s.w - SHRINK_RATE * dt);
        s.x += (s.w - nw) / 2;
        s.w = nw;
      }
    }
  }
  for (const c of s.chunks) {
    c.vy += GRAVITY * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.a += c.spin * dt;
  }
  // Pieces that fell well below the tower are gone.
  const floor = floorY(height(s)) + H * 1.5;
  s.chunks = s.chunks.filter((c) => c.y < floor);
}
