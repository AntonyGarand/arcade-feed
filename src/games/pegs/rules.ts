import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units. */
export const W = 300;
export const H = 420;
export const LAUNCH = { x: W / 2, y: 26 };
export const BALL_R = 5;
export const PEG_R = 7;
export const BUCKET_Y = H - 18;
export const BUCKET_H = 14;
const GRAVITY = 380;
const SHOT_SPEED = 320;
const MAX_SPEED = 560;
const BOUNCE = 0.78;
/** Steepest aim from straight down (radians). */
export const MAX_AIM = 1.45;
/** Keyboard aim speed (radians per second). */
const AIM_SPEED = 1.3;
const TARGET_POINTS = 100;
const PEG_POINTS = 10;
/** Bonus per ball left when the last target falls. */
export const BALL_BONUS = 250;
/** A ball creeping this slowly for this long is stuck: its lit pegs go at once. */
const STUCK_SPEED = 25;
const STUCK_S = 1.2;
/** Bumpers: never cleared, they kick the ball away at least this fast. */
export const BUMPER_R = 10;
const BUMP_SPEED = 280;
/** A bomb peg lights every peg this close when it lights. */
const BLAST_R = 48;
/** The combo blast (a shot milestone) is bigger. */
const BIG_BLAST_R = 60;
const MAX_MULT = 5;
/** Pegs hit in one shot that fire a combo event (see `POWERS`). */
export const SHOT_TIERS = [6, 12, 18, 26, 36] as const;
/** What each milestone unlocks: a wide bucket, a blast around the ball, a free ball… */
const POWERS = ['bucket', 'blast', 'ball', 'blast', 'ball'] as const;
export type Power = (typeof POWERS)[number];
/** How much wider the bucket gets for the rest of the shot. */
const WIDE_BUCKET = 1.7;

export const ballsFor = (d: Difficulty) => byLevel(d, [10, 9, 9, 8, 8]);
export const targetsFor = (d: Difficulty) => byLevel(d, [6, 8, 10, 12, 14]);
const pegsFor = (d: Difficulty) => byLevel(d, [34, 40, 46, 50, 54]);
const bucketWidth = (d: Difficulty) => byLevel(d, [84, 70, 60, 52, 44]);
const bucketSpeed = (d: Difficulty) => byLevel(d, [50, 65, 80, 95, 110]);

/** A peg's special trait: `bomb` lights its neighbours, `gold` gives a ball back. */
type Trait = 'plain' | 'bomb' | 'gold';

/** A peg circling a hub (wheels). */
interface Orbit {
  cx: number;
  cy: number;
  r: number;
  /** Angle at t = 0, and spin in radians per second. */
  a: number;
  w: number;
}

interface Peg {
  x: number;
  y: number;
  /** Orange target (must be cleared) or plain peg. */
  target: boolean;
  trait: Trait;
  /** Hits left before it lights (2: an armoured target, cracked by the first hit). */
  hp: number;
  orbit: Orbit | null;
  /** Hit by the ball in flight: it vanishes when the ball leaves play. */
  lit: boolean;
  gone: boolean;
}

/** A round bumper: never cleared, it kicks the ball away. */
interface Bumper {
  x: number;
  y: number;
}

/** The kinds of peg field a level can deal. */
export const KINDS = [
  { id: 'scatter', weight: 2 },
  { id: 'rings' },
  { id: 'wheels', min: 2 },
  { id: 'mines', min: 2 },
  { id: 'fortress', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

export interface State {
  d: Difficulty;
  kind: KindId;
  pegs: Peg[];
  bumpers: Bumper[];
  /** Seconds since the level started (spinning wheels). */
  t: number;
  /** Aim angle from straight down, radians (negative = left). */
  aim: number;
  /** Keyboard aim direction held: -1, 0 or 1. */
  turn: number;
  flying: boolean;
  bx: number;
  by: number;
  vx: number;
  vy: number;
  /** Pegs hit this shot (the multiplier grows every 4, milestones at `SHOT_TIERS`). */
  hits: number;
  /** Shot milestones reached this shot. */
  tier: number;
  stuck: number;
  bucketX: number;
  bucketW: number;
  /** Bucket width without the combo's widening. */
  bucketW0: number;
  bucketV: number;
  balls: number;
  /** Balls at the start (free balls never go past it). */
  maxBalls: number;
  score: number;
}

interface Spot {
  x: number;
  y: number;
  orbit: Orbit | null;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Staggered rows with a seeded jitter, shuffled. */
function grid(rng: Rng): Spot[] {
  const spots: Spot[] = [];
  for (let r = 0; r < 9; r++) {
    const y = 104 + r * 30;
    const off = r % 2 ? 17 : 0;
    for (let x = 26 + off; x <= W - 26; x += 34) spots.push({ x: x + rng.int(-5, 5), y: y + rng.int(-4, 4), orbit: null });
  }
  return rng.shuffle(spots);
}

/** `k` pegs evenly around a circle from a seeded phase, spinning at `w` (0: still). */
function ring(rng: Rng, cx: number, cy: number, r: number, k: number, w = 0): Spot[] {
  const a0 = rng.next() * Math.PI * 2;
  return Array.from({ length: k }, (_, i) => {
    const a = a0 + (i / k) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, orbit: w ? { cx, cy, r, a, w } : null };
  });
}

/** Where a kind puts its `n` pegs (its shape first, then grid fill) and its bumpers. */
function layout(kind: KindId, n: number, rng: Rng): { spots: Spot[]; bumpers: Bumper[] } {
  const shape: Spot[] = [];
  const bumpers: Bumper[] = [];
  let keepOut = 0;
  if (kind === 'rings') {
    // Two or three hubs, each a bumper inside two rings of pegs.
    const hubs =
      n < 45
        ? [
            [85, 190],
            [215, 290],
          ]
        : [
            [78, 175],
            [222, 175],
            [150, 305],
          ];
    const flip = rng.chance(0.5);
    for (const [hx, hy] of hubs) {
      const x = (flip ? W - hx : hx) + rng.int(-6, 6);
      const y = hy + rng.int(-6, 6);
      bumpers.push({ x, y });
      shape.push(...ring(rng, x, y, 30, 6), ...ring(rng, x, y, 54, 10));
    }
    keepOut = 70;
  } else if (kind === 'wheels') {
    // Two wheels of pegs spinning opposite ways around a bumper.
    const flip = rng.chance(0.5);
    for (const [hx, hy, w] of [
      [85, 190, 0.8],
      [215, 300, -0.8],
    ]) {
      const x = flip ? W - hx : hx;
      bumpers.push({ x, y: hy });
      shape.push(...ring(rng, x, hy, 48, 10, flip ? -w : w));
    }
    keepOut = 72;
  }
  const fill = grid(rng).filter((p) => shape.every((q) => dist(p, q) >= 26) && bumpers.every((b) => dist(p, b) >= keepOut));
  return { spots: [...shape, ...fill].slice(0, n), bumpers };
}

/** Deal a peg field of the given kind (or one the seed picks): pegs, targets, special pegs and bumpers. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const n = pegsFor(d);
  const { spots, bumpers } = layout(kind, n, rng);
  const pegs: Peg[] = spots.map((p) => ({
    x: p.x,
    y: p.y,
    target: false,
    trait: 'plain',
    hp: 1,
    orbit: p.orbit,
    lit: false,
    gone: false,
  }));
  // Targets anywhere, or tucked into the lower half behind a screen of pegs in a fortress.
  const order = rng.shuffle(pegs.slice());
  if (kind === 'fortress') order.sort((a, b) => Number(a.y < 230) - Number(b.y < 230));
  const targets = order.slice(0, targetsFor(d));
  for (const p of targets) p.target = true;
  // Armour: half the fortress, a couple of targets elsewhere from Expert up.
  const armoured = kind === 'fortress' ? Math.ceil(targets.length / 2) : d >= 4 ? 2 : 0;
  for (const p of rng.shuffle(targets.slice()).slice(0, armoured)) p.hp = 2;
  const plain = rng.shuffle(pegs.filter((p) => !p.target));
  const bombs = kind === 'mines' ? Math.round(n / 6) : kind === 'fortress' ? 2 : d >= 2 ? 1 : 0;
  for (let i = 0; i < bombs && plain.length; i++) plain.pop()!.trait = 'bomb';
  if (kind !== 'mines' && plain.length) plain.pop()!.trait = 'gold';
  pegs.sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    d,
    kind,
    pegs,
    bumpers,
    t: 0,
    aim: 0,
    turn: 0,
    flying: false,
    bx: LAUNCH.x,
    by: LAUNCH.y,
    vx: 0,
    vy: 0,
    hits: 0,
    tier: 0,
    stuck: 0,
    bucketX: W / 2,
    bucketW: bucketWidth(d),
    bucketW0: bucketWidth(d),
    bucketV: bucketSpeed(d),
    balls: ballsFor(d),
    maxBalls: ballsFor(d),
    score: 0,
  };
}

export const targetsLeft = (s: State) => s.pegs.filter((p) => p.target && !p.gone).length;
/** Points multiplier for this shot: +1 every 4 pegs hit, up to ×5. */
export const multiplier = (s: State) => Math.min(MAX_MULT, 1 + Math.floor(s.hits / 4));

/** Aim at a point (pointer): the angle from the launcher, clamped to the allowed cone. */
export function aimAt(s: State, x: number, y: number) {
  if (s.flying) return;
  const a = Math.atan2(x - LAUNCH.x, Math.max(1, y - LAUNCH.y));
  s.aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, a));
}

export function shoot(s: State): boolean {
  if (s.flying || s.balls <= 0) return false;
  s.flying = true;
  s.bx = LAUNCH.x + Math.sin(s.aim) * 14;
  s.by = LAUNCH.y + Math.cos(s.aim) * 14;
  s.vx = Math.sin(s.aim) * SHOT_SPEED;
  s.vy = Math.cos(s.aim) * SHOT_SPEED;
  s.hits = 0;
  s.tier = 0;
  s.stuck = 0;
  return true;
}

/** The start of the shot's arc (no bounces), for the aim guide. */
export function aimPath(s: State, seconds = 0.32): { x: number; y: number }[] {
  const pts = [];
  let x = LAUNCH.x + Math.sin(s.aim) * 14;
  let y = LAUNCH.y + Math.cos(s.aim) * 14;
  let vx = Math.sin(s.aim) * SHOT_SPEED;
  let vy = Math.cos(s.aim) * SHOT_SPEED;
  const dt = 1 / 60;
  for (let t = 0; t <= seconds; t += dt) {
    pts.push({ x, y });
    vy += GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    if (x < BALL_R || x > W - BALL_R) vx = -vx;
    if (s.pegs.some((p) => !p.gone && (p.x - x) ** 2 + (p.y - y) ** 2 < (PEG_R + BALL_R) ** 2)) break;
    if (s.bumpers.some((b) => (b.x - x) ** 2 + (b.y - y) ** 2 < (BUMPER_R + BALL_R) ** 2)) break;
  }
  return pts;
}

export interface StepEvents {
  hit: boolean;
  /** Armoured targets cracked this step. */
  cracks: { x: number; y: number }[];
  /** Blasts this step (bombs and combo blasts): centre and radius. */
  blasts: { x: number; y: number; r: number }[];
  /** Bumpers that kicked the ball (indices into `bumpers`). */
  bumps: number[];
  /** Balls given back by gold pegs and milestones (or their worth in points, with a full rack). */
  free: number;
  /** Shot milestones reached this step (1-based) and what they unlocked. */
  unlocks: { tier: number; power: Power }[];
  /** The ball left play: through the bottom (`lost`) or into the bucket (`caught`). */
  ended: boolean;
  caught: boolean;
  lost: boolean;
  cleared: boolean;
  over: boolean;
}

function clearLit(s: State) {
  for (const p of s.pegs) if (p.lit) p.gone = true;
}

/** A ball back (or its worth in points when the rack is full). */
function freeBall(s: State, ev: StepEvents) {
  if (s.balls < s.maxBalls) s.balls++;
  else s.score += BALL_BONUS;
  ev.free++;
}

/** Light every peg within `r` of (x, y), armour or not. */
function blast(s: State, x: number, y: number, r: number, ev: StepEvents) {
  ev.blasts.push({ x, y, r });
  for (const p of s.pegs) if (!p.gone && !p.lit && dist(p, { x, y }) <= r) light(s, p, ev);
}

/** One more peg hit this shot: score it at the multiplier and fire the milestones it reaches. */
function count(s: State, points: number, ev: StepEvents) {
  s.hits++;
  s.score += points * multiplier(s);
  ev.hit = true;
  while (s.tier < SHOT_TIERS.length && s.hits >= SHOT_TIERS[s.tier]) {
    const power = POWERS[s.tier++];
    ev.unlocks.push({ tier: s.tier, power });
    if (power === 'bucket') s.bucketW = s.bucketW0 * WIDE_BUCKET;
    else if (power === 'ball') freeBall(s, ev);
    else blast(s, s.bx, s.by, BIG_BLAST_R, ev);
  }
}

/** Light a peg: it scores now and goes once the ball leaves play; bombs blow, gold gives a ball. */
function light(s: State, p: Peg, ev: StepEvents) {
  p.lit = true;
  p.hp = 0;
  count(s, p.target ? TARGET_POINTS : PEG_POINTS, ev);
  if (p.trait === 'gold') freeBall(s, ev);
  if (p.trait === 'bomb') blast(s, p.x, p.y, BLAST_R, ev);
}

/** Advance by `dt` seconds: the aim, the bucket, the wheels and the ball in flight. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    hit: false,
    cracks: [],
    blasts: [],
    bumps: [],
    free: 0,
    unlocks: [],
    ended: false,
    caught: false,
    lost: false,
    cleared: false,
    over: false,
  };
  s.t += dt;
  for (const p of s.pegs) {
    const o = p.orbit;
    if (!o) continue;
    p.x = o.cx + Math.cos(o.a + o.w * s.t) * o.r;
    p.y = o.cy + Math.sin(o.a + o.w * s.t) * o.r;
  }
  if (!s.flying && s.turn) s.aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, s.aim + s.turn * AIM_SPEED * dt));
  // Bucket glides edge to edge.
  s.bucketX += s.bucketV * dt;
  const half = s.bucketW / 2;
  if (s.bucketX > W - half) {
    s.bucketX = W - half;
    s.bucketV = -Math.abs(s.bucketV);
  } else if (s.bucketX < half) {
    s.bucketX = half;
    s.bucketV = Math.abs(s.bucketV);
  }
  if (!s.flying) return ev;

  const n = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / (BALL_R / 2)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.vy += GRAVITY * h;
    s.bx += s.vx * h;
    s.by += s.vy * h;
    if (s.bx < BALL_R) {
      s.bx = BALL_R;
      s.vx = Math.abs(s.vx) * BOUNCE;
    } else if (s.bx > W - BALL_R) {
      s.bx = W - BALL_R;
      s.vx = -Math.abs(s.vx) * BOUNCE;
    }
    if (s.by < BALL_R) {
      s.by = BALL_R;
      s.vy = Math.abs(s.vy) * BOUNCE;
    }
    for (const p of s.pegs) {
      if (p.gone) continue;
      const dx = s.bx - p.x;
      const dy = s.by - p.y;
      const d2 = dx * dx + dy * dy;
      const min = PEG_R + BALL_R;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1;
      const nx = dx / d;
      const ny = dy / d;
      s.bx = p.x + nx * min;
      s.by = p.y + ny * min;
      const vn = s.vx * nx + s.vy * ny;
      if (vn < 0) {
        s.vx -= (1 + BOUNCE) * vn * nx;
        s.vy -= (1 + BOUNCE) * vn * ny;
      }
      if (p.lit) continue;
      if (p.hp > 1) {
        // Armour cracks on a real hit (not a ball resting on it); the next hit lights it.
        if (vn < -40) {
          p.hp--;
          count(s, PEG_POINTS, ev);
          ev.cracks.push({ x: p.x, y: p.y });
        }
      } else light(s, p, ev);
    }
    for (let bi = 0; bi < s.bumpers.length; bi++) {
      const b = s.bumpers[bi];
      const dx = s.bx - b.x;
      const dy = s.by - b.y;
      const min = BUMPER_R + BALL_R;
      if (dx * dx + dy * dy >= min * min) continue;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      s.bx = b.x + nx * min;
      s.by = b.y + ny * min;
      const vn = s.vx * nx + s.vy * ny;
      if (vn < 0) {
        s.vx -= 2 * vn * nx;
        s.vy -= 2 * vn * ny;
      }
      // A kick outwards, at least `BUMP_SPEED`.
      const out = s.vx * nx + s.vy * ny;
      if (out < BUMP_SPEED) {
        s.vx += (BUMP_SPEED - out) * nx;
        s.vy += (BUMP_SPEED - out) * ny;
      }
      // And a sideways nudge, so a ball dropped dead centre can't bounce on it forever.
      s.vx += (nx >= 0 ? 1 : -1) * 70 * (1 - Math.abs(nx));
      ev.bumps.push(bi);
    }
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > MAX_SPEED) {
      s.vx *= MAX_SPEED / sp;
      s.vy *= MAX_SPEED / sp;
    }
    // Into the bucket: the ball comes back.
    if (
      s.vy > 0 &&
      s.by + BALL_R >= BUCKET_Y &&
      s.by - s.vy * h + BALL_R < BUCKET_Y &&
      Math.abs(s.bx - s.bucketX) < s.bucketW / 2 - BALL_R
    ) {
      ev.caught = true;
      break;
    }
    if (s.by - BALL_R > H) {
      ev.lost = true;
      break;
    }
  }
  if (!ev.caught && !ev.lost) {
    s.stuck = Math.hypot(s.vx, s.vy) < STUCK_SPEED ? s.stuck + dt : 0;
    if (s.stuck > STUCK_S) {
      // Whatever the ball rests on gives way (armour too), so it falls.
      for (const p of s.pegs) if (!p.gone && !p.lit && dist(p, { x: s.bx, y: s.by }) <= PEG_R + BALL_R + 2) light(s, p, ev);
      clearLit(s);
      s.stuck = 0;
    }
    return ev;
  }
  ev.ended = true;
  s.flying = false;
  s.bucketW = s.bucketW0;
  clearLit(s);
  if (ev.lost) s.balls--;
  if (!targetsLeft(s)) {
    s.score += s.balls * BALL_BONUS;
    ev.cleared = true;
  } else if (s.balls <= 0) ev.over = true;
  return ev;
}
