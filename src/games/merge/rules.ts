import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

export const W = 280;
export const H = 400;
export const FLOOR = 390;
/** Pieces resting above this line for OVERFLOW_S end the run. */
export const LINE = 96;
export const DROP_Y = 48;
export const OVERFLOW_S = 2;
/** Radius of each size; two pieces of size k merge into one of size k + 1. */
export const RADII: readonly number[] = [10, 14, 18, 23, 29, 36, 44, 53];
/** Points for making a piece of size k. */
export const mergePoints = (k: number) => 5 * 2 ** k;
/** Bonus per drop left of the level's budget when the target appears. */
export const DROP_BONUS = 15;

const GRAVITY = 900;
/** Physics runs at a fixed rate, so the same drops always settle the same way. */
const STEP = 1 / 120;
const ITERATIONS = 8;
const DAMPING = 0.995;
/** A new piece doesn't count for overflow until it has had this long to fall. */
const GRACE_S = 1;
const COOLDOWN_S = 0.45;

/**
 * What a piece is: a fruit merges with its twin; a wildcard merges with any fruit it touches (and
 * grows it a size); a rock never merges and crumbles when a merge happens next to it; a bomb blows
 * up the small fruit and rocks around where it lands.
 */
export type PieceType = 'fruit' | 'wild' | 'rock' | 'bomb';
/** Bombs clear fruit up to this size (and every rock) within BLAST of where they go off. */
export const BOMB_MAX = 2;
export const BLAST = 58;
/** Size (radius) of the special pieces. */
const SPECIAL_K: Record<PieceType, number> = { fruit: 0, wild: 1, rock: 2, bomb: 1 };

/** Rising floor: it climbs RISE units every RISE_S seconds, up to RISE_MAX; a merge to size k ≥ 3 pushes it back down. */
const RISE = 6;
export const RISE_S = 4;
const RISE_MAX = 84;
const SINK = 5;

/** Merges in quick succession (each within CHAIN_S of the last) make a chain; these lengths unlock an event. */
export const CHAIN_S = 1.2;
export const CHAIN_TIERS = [3, 5, 8] as const;
/** Chain events: a wildcard in hand, then a tidy-up (the smallest fruit and every rock pop), then every smallest fruit grows a size. */
export type Power = 'wild' | 'tidy' | 'grow';
const POWERS: readonly Power[] = ['wild', 'tidy', 'grow'];

export type KindId = 'classic' | 'narrow' | 'rocks' | 'bombs' | 'rising' | 'rainbow';
export const KINDS: readonly (Kind & { id: KindId })[] = [
  { id: 'classic', weight: 1.2 },
  { id: 'narrow', min: 2 },
  { id: 'rocks', min: 2 },
  { id: 'bombs' },
  { id: 'rising', min: 3 },
  { id: 'rainbow' },
];

export const targetFor = (d: Difficulty) => byLevel(d, [4, 5, 5, 6, 6]);
export const jarWidth = (d: Difficulty) => byLevel(d, [240, 250, 220, 250, 230]);
/** Jar width for a kind (narrow and rainbow jars are slimmer). */
const kindWidth = (d: Difficulty, kind: KindId) => jarWidth(d) - (kind === 'narrow' ? 40 : kind === 'rainbow' ? 24 : 0);
/** Largest size that can be dropped (sizes 0…max, small ones likelier). */
const dropMax = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 3]);
/** Drops expected to make the target; fewer earns the bonus. */
export const dropBudget = (d: Difficulty) => byLevel(d, [20, 36, 28, 46, 46]);
/** Odds that a dealt piece is a wildcard, a rock or a bomb, by kind. */
const ODDS: Record<KindId, Partial<Record<PieceType, number>>> = {
  classic: { wild: 0.03 },
  narrow: { wild: 0.06 },
  rocks: { rock: 0.1, wild: 0.03 },
  bombs: { bomb: 0.07, wild: 0.03 },
  rising: { wild: 0.04 },
  rainbow: { wild: 0.13 },
};

interface Body {
  x: number;
  y: number;
  /** Previous position (velocity is the difference, Verlet style). */
  px: number;
  py: number;
  k: number;
  type: PieceType;
  age: number;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  left: number;
  right: number;
  bodies: Body[];
  /** Size and type in hand, and of the one after it. */
  current: number;
  currentType: PieceType;
  next: number;
  nextType: PieceType;
  aimX: number;
  /** Keyboard aim direction held. */
  dir: number;
  cooldown: number;
  drops: number;
  target: number;
  biggest: number;
  /** Seconds a piece has been resting above the line. */
  over: number;
  /** Rising floor: how far up it is, and the clock to its next climb. */
  lift: number;
  liftT: number;
  /** Merges in the current chain, seconds left to extend it, and the milestone it reached. */
  chain: number;
  chainLeft: number;
  tier: number;
  bestChain: number;
  score: number;
  acc: number;
  rng: Rng;
}

/** The jar's floor (it rises on rising levels). */
export const floorOf = (s: State) => FLOOR - s.lift;

function deal(s: State): [number, PieceType] {
  const odds = ODDS[s.kind];
  let r = s.rng.next();
  for (const type of ['wild', 'rock', 'bomb'] as const) {
    const p = odds[type] ?? 0;
    if (r < p) return [SPECIAL_K[type], type];
    r -= p;
  }
  // Small pieces are likelier: size i with weight (max + 1 - i).
  const max = dropMax(s.d);
  const pool: number[] = [];
  for (let k = 0; k <= max; k++) for (let i = 0; i < max + 1 - k; i++) pool.push(k);
  return [s.rng.pick(pool), 'fruit'];
}

function advance(s: State) {
  s.current = s.next;
  s.currentType = s.nextType;
  [s.next, s.nextType] = deal(s);
}

export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const w = kindWidth(d, kind);
  const s: State = {
    d,
    kind,
    left: (W - w) / 2,
    right: (W + w) / 2,
    bodies: [],
    current: 0,
    currentType: 'fruit',
    next: 0,
    nextType: 'fruit',
    aimX: W / 2,
    dir: 0,
    cooldown: 0,
    drops: 0,
    target: targetFor(d),
    biggest: 0,
    over: 0,
    lift: 0,
    liftT: 0,
    chain: 0,
    chainLeft: 0,
    tier: 0,
    bestChain: 0,
    score: 0,
    acc: 0,
    rng,
  };
  // Rock levels start with a couple of boulders on the floor.
  if (kind === 'rocks')
    for (let i = 0; i < 2; i++) {
      const r = RADII[SPECIAL_K.rock];
      const x = s.left + r + rng.next() * (w - 2 * r);
      const y = FLOOR - r - i * 2 * r;
      s.bodies.push({ x, y, px: x, py: y, k: SPECIAL_K.rock, type: 'rock', age: GRACE_S });
    }
  [s.current, s.currentType] = deal(s);
  [s.next, s.nextType] = deal(s);
  // The first piece is always a fruit.
  if (s.currentType !== 'fruit') [s.current, s.currentType] = [0, 'fruit'];
  return s;
}

/** Aim the piece in hand (kept inside the jar). */
export function aim(s: State, x: number) {
  const r = RADII[s.current];
  s.aimX = Math.max(s.left + r, Math.min(s.right - r, x));
}

/** Drop the piece in hand at the aim. False while the last drop is still clearing the spout. */
export function drop(s: State): boolean {
  if (s.cooldown > 0) return false;
  aim(s, s.aimX);
  s.bodies.push({ x: s.aimX, y: DROP_Y, px: s.aimX, py: DROP_Y, k: s.current, type: s.currentType, age: 0 });
  s.drops++;
  advance(s);
  s.cooldown = COOLDOWN_S;
  aim(s, s.aimX);
  return true;
}

export interface StepEvents {
  merged: boolean;
  /** Bombs that went off this step (where), and rocks that crumbled. */
  blasts: { x: number; y: number }[];
  crumbled: { x: number; y: number }[];
  /** The chain reached milestone `tier` (1-based) and unlocked `power` (0 / null: none). */
  tier: number;
  power: Power | null;
  won: boolean;
  lost: boolean;
}

const merges = (a: Body, b: Body) =>
  (a.type === 'fruit' && b.type === 'fruit' && a.k === b.k) ||
  (a.type === 'wild' && b.type !== 'rock' && b.type !== 'bomb') ||
  (b.type === 'wild' && a.type !== 'rock' && a.type !== 'bomb');

/** A merge made a piece of size k: score it, extend the chain, sink a rising floor. */
function scored(s: State, k: number, ev: StepEvents) {
  s.score += mergePoints(k);
  s.biggest = Math.max(s.biggest, k);
  ev.merged = true;
  if (k >= 3) s.lift = Math.max(0, s.lift - SINK * (k - 2));
  s.chain = s.chainLeft > 0 ? s.chain + 1 : 1;
  s.chainLeft = CHAIN_S;
  s.bestChain = Math.max(s.bestChain, s.chain);
  if (s.tier < CHAIN_TIERS.length && s.chain >= CHAIN_TIERS[s.tier]) {
    ev.tier = ++s.tier;
    ev.power = POWERS[s.tier - 1];
  }
}

/** Fire a chain event (also used by tests). */
export function grant(s: State, p: Power) {
  if (p === 'wild') {
    s.next = SPECIAL_K.wild;
    s.nextType = 'wild';
  } else if (p === 'tidy') {
    // The smallest fruit size in the jar pops, and every rock crumbles.
    const small = Math.min(...s.bodies.filter((b) => b.type === 'fruit').map((b) => b.k));
    s.bodies = s.bodies.filter((b) => {
      if (b.type === 'rock') return false;
      if (b.type === 'fruit' && b.k === small && small <= 1) {
        s.score += mergePoints(b.k);
        return false;
      }
      return true;
    });
  } else {
    // Every fruit of the smallest size in the jar grows one size.
    const small = Math.min(...s.bodies.filter((b) => b.type === 'fruit').map((b) => b.k));
    for (const b of s.bodies)
      if (b.type === 'fruit' && b.k === small && b.k < s.target - 1) {
        b.k++;
        b.age = Math.max(b.age, GRACE_S);
      }
  }
}

/** One fixed physics tick: integrate, resolve overlaps and walls, then merge, crumble and blow up. */
function tick(s: State, ev: StepEvents) {
  const power = ev.power;
  const g = GRAVITY * STEP * STEP;
  const floor = floorOf(s);
  for (const b of s.bodies) {
    const vx = (b.x - b.px) * DAMPING;
    const vy = (b.y - b.py) * DAMPING;
    b.px = b.x;
    b.py = b.y;
    b.x += vx;
    b.y += vy + g;
    b.age += STEP;
  }
  const n = s.bodies.length;
  /** Bombs that touched something this tick. */
  const lit = new Set<Body>();
  for (let it = 0; it < ITERATIONS; it++) {
    for (let i = 0; i < n; i++) {
      const a = s.bodies[i];
      const ra = RADII[a.k];
      for (let j = i + 1; j < n; j++) {
        const b = s.bodies[j];
        const rb = RADII[b.k];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = ra + rb;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        if (a.type === 'bomb') lit.add(a);
        if (b.type === 'bomb') lit.add(b);
        const d = Math.sqrt(d2) || 0.001;
        const push = (min - d) / d;
        // Heavier pieces move less (rocks most of all).
        const ma = ra * ra * (a.type === 'rock' ? 3 : 1);
        const mb = rb * rb * (b.type === 'rock' ? 3 : 1);
        const fa = mb / (ma + mb);
        const fb = ma / (ma + mb);
        a.x -= dx * push * fa;
        a.y -= dy * push * fa;
        b.x += dx * push * fb;
        b.y += dy * push * fb;
      }
    }
    for (const b of s.bodies) {
      const r = RADII[b.k];
      if (b.x < s.left + r) b.x = s.left + r;
      if (b.x > s.right - r) b.x = s.right - r;
      if (b.y > floor - r) {
        b.y = floor - r;
        if (b.type === 'bomb') lit.add(b);
        // Floor friction: bleed sideways speed.
        b.px = b.x - (b.x - b.px) * 0.9;
      }
    }
  }
  // Rest: very slow pieces stop dead, so a settled pile doesn't shimmer.
  for (const b of s.bodies) if (Math.abs(b.x - b.px) < 0.004 && Math.abs(b.y - b.py) < 0.004) [b.px, b.py] = [b.x, b.y];

  // Merge touching pairs (each piece at most once per tick).
  const gone = new Set<Body>();
  const born: Body[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = s.bodies[i];
      const b = s.bodies[j];
      if (gone.has(a) || gone.has(b) || !merges(a, b)) continue;
      // A wildcard takes the size of the fruit it touches (two wildcards make a size-1 fruit).
      const base = a.type === 'fruit' ? a.k : b.type === 'fruit' ? b.k : 0;
      if (base >= RADII.length - 1) continue;
      const min = RADII[a.k] + RADII[b.k] + 0.5;
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > min * min) continue;
      gone.add(a);
      gone.add(b);
      const k = base + 1;
      // A wildcard merge happens where the fruit was.
      const at = a.type === 'wild' && b.type === 'fruit' ? b : b.type === 'wild' && a.type === 'fruit' ? a : null;
      const x = at ? at.x : (a.x + b.x) / 2;
      const y = at ? at.y : (a.y + b.y) / 2;
      born.push({ x, y, px: x - (a.x - a.px + b.x - b.px) / 2, py: y - (a.y - a.py + b.y - b.py) / 2, k, type: 'fruit', age: GRACE_S });
      scored(s, k, ev);
    }
  // Rocks next to a merge crumble.
  for (const nb of born)
    for (const r of s.bodies)
      if (r.type === 'rock' && !gone.has(r) && Math.hypot(r.x - nb.x, r.y - nb.y) < RADII[r.k] + RADII[nb.k] + 3) {
        gone.add(r);
        ev.crumbled.push({ x: r.x, y: r.y });
      }
  // Bombs that touched something go off: small fruit and rocks around them are cleared.
  for (const bomb of lit) {
    if (gone.has(bomb) || bomb.age < 0.05) continue;
    gone.add(bomb);
    ev.blasts.push({ x: bomb.x, y: bomb.y });
    for (const b of s.bodies)
      if (!gone.has(b) && (b.type === 'rock' || b.type === 'wild' || (b.type === 'fruit' && b.k <= BOMB_MAX))) {
        if (Math.hypot(b.x - bomb.x, b.y - bomb.y) < BLAST + RADII[b.k] * 0.5) gone.add(b);
      }
  }
  if (gone.size) s.bodies = s.bodies.filter((b) => !gone.has(b)).concat(born);
  // A chain milestone reached this tick fires once the merges are in.
  if (ev.power && power !== ev.power) grant(s, ev.power);
}

/** Advance by `dt` seconds (physics in fixed ticks), check the target and the overflow line. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { merged: false, blasts: [], crumbled: [], tier: 0, power: null, won: false, lost: false };
  if (s.dir) aim(s, s.aimX + s.dir * 220 * dt);
  s.cooldown = Math.max(0, s.cooldown - dt);
  if (s.chainLeft > 0) {
    s.chainLeft -= dt;
    if (s.chainLeft <= 0) s.chain = s.tier = 0;
  }
  if (s.kind === 'rising' && s.lift < RISE_MAX && (s.liftT += dt) >= RISE_S) {
    s.liftT -= RISE_S;
    s.lift = Math.min(RISE_MAX, s.lift + RISE);
  }
  s.acc += dt;
  while (s.acc >= STEP) {
    s.acc -= STEP;
    tick(s, ev);
    if (s.biggest >= s.target) {
      s.score += Math.max(0, dropBudget(s.d) - s.drops) * DROP_BONUS;
      ev.won = true;
      return ev;
    }
  }
  const above = s.bodies.some((b) => b.age > GRACE_S && b.y - RADII[b.k] < LINE);
  s.over = above ? s.over + dt : 0;
  if (s.over >= OVERFLOW_S) ev.lost = true;
  return ev;
}
