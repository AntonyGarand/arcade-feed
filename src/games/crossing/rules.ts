import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';
import { DX, DY, type Dir } from '../../kits/gesture/gesture';

/**
 * A grid hopper: the field is ROWS lanes of COLS cells. The hopper's row is whole, its column is
 * whole on land and on roads but drifts with the log it rides on the river. Lanes are periodic, so
 * where every car and log sits is a pure function of the lane clock (which is what lets the solver
 * plan ahead). The lane clock runs with time, except while traffic is frozen (a combo reward).
 */
export const COLS = 9;
export const ROWS = 13;
export const LIVES = 3;
/** Row of the far bank with the home slots, and of the start bank. */
export const GOAL_ROW = 0;
export const START_ROW = ROWS - 1;
const START_COL = 4;
/** Columns of the home slots in the goal row (the rest is hedge). */
export const SLOTS = [0, 2, 4, 6, 8];
/** Cells beyond each side edge where cars and logs wrap around, out of sight. */
const MARGIN = 4;
/** Seconds between two hops (the hop animation). */
export const HOP_S = 0.15;
/** Seconds the hopper stays splashed or squashed before it comes back at the start. */
export const RESPAWN_S = 0.8;
/** Half the hopper's width in cells, for collisions with cars. */
const HALF = 0.34;
export const ROW_POINTS = 10;
export const HOME_POINTS = 100;
export const TIME_POINTS = 10;
export const LIFE_BONUS = 50;

/** Home slots to fill. */
export const homesFor = (d: Difficulty) => byLevel(d, [2, 3, 3, 4, 4]);
/** Seconds for the whole level. */
export const timeFor = (d: Difficulty) => byLevel(d, [40, 50, 55, 70, 75]);
/** River and road lanes in play (the other rows of each zone are grass). */
export const riverFor = (d: Difficulty) => byLevel(d, [3, 4, 4, 5, 5]);
export const roadFor = (d: Difficulty) => byLevel(d, [3, 4, 5, 5, 5]);
/** Speed multiplier for everything that moves. */
export const paceFor = (d: Difficulty) => byLevel(d, [1, 1.15, 1.3, 1.45, 1.6]);
/** Log length range in cells. */
const logFor = (d: Difficulty) =>
  byLevel(d, [
    [3, 4.5],
    [3, 4],
    [2.5, 3.5],
    [2, 3.2],
    [2, 2.8],
  ] as const);
/** Road gap range in cells between two cars. */
const gapFor = (d: Difficulty) =>
  byLevel(d, [
    [3.5, 7],
    [3, 6],
    [2.8, 5],
    [2.5, 4.5],
    [2.4, 4],
  ] as const);

type LaneKind = 'goal' | 'river' | 'road' | 'grass';

/** What moves in a lane: cars and trains on roads; logs, turtles and crocodiles on the river. */
type ItemType = 'car' | 'train' | 'log' | 'turtle' | 'croc';

interface Item {
  /** Position at time 0 along the lane's loop. */
  x0: number;
  len: number;
  /** Palette slot (cars). */
  tone: number;
  type: ItemType;
  /** Diving turtles: phase in their dive cycle (undefined: they never dive). */
  dive?: number | undefined;
}

/** The kinds of level: what fills the lanes. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'rush' },
  { id: 'railway', min: 2 },
  { id: 'turtles', min: 2 },
  { id: 'flood', min: 2 },
  { id: 'night', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Diving turtles: seconds per cycle, and how long they stay under at the end of it (sinking before). */
const DIVE_S = 5;
const UNDER_S = 1.3;
/** A crocodile's jaws: this much of its front end bites. */
export const JAWS = 0.9;

/** Seconds between two forward hops before the streak ends. */
export const STREAK_WINDOW = 1.2;
/** Streak lengths that fire a combo event: freeze, shield, big freeze. */
export const STREAK_TIERS = [6, 12, 20] as const;
export type Reward = 'freeze' | 'shield' | 'bigFreeze';
const REWARDS: readonly Reward[] = ['freeze', 'shield', 'bigFreeze'];
/** Seconds traffic and the river stop for, by reward. */
const FREEZE_S = 2.5;
export const BIG_FREEZE_S = 4;

/** Advance a lane clock by `dt`, spending any freeze first. */
function tick(clock: number, freeze: number, dt: number) {
  const f = Math.min(freeze, dt);
  return { clock: clock + (dt - f), freeze: freeze - f, moved: dt - f };
}

export interface Lane {
  kind: LaneKind;
  /** Train tracks (a road lane with one long, fast train and a signal). */
  rail?: boolean;
  /** Cells per second, signed (positive = rightwards). */
  speed: number;
  /** Length of the loop the items travel around. */
  period: number;
  items: Item[];
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Left edge of an item at lane clock `t` (between -MARGIN and period - MARGIN). */
export const itemX = (lane: Lane, it: Item, t: number) => mod(it.x0 + lane.speed * t, lane.period) - MARGIN;

/** How far a diving turtle group has gone under at lane clock `t`: 0 up, 1 under (sinking between). */
export function sunk(it: Item, t: number): number {
  if (it.dive == null) return 0;
  const p = mod(t + it.dive, DIVE_S);
  const start = DIVE_S - UNDER_S - 0.8;
  return p < start ? 0 : p >= DIVE_S - UNDER_S ? 1 : (p - start) / 0.8;
}

/** Would a hopper at column `x` (left edge of its cell) of `row` be hit, drowned or swept away at lane clock `t`? */
export function hazard(lanes: Lane[], row: number, x: number, t: number): boolean {
  const lane = lanes[row];
  if (lane.kind === 'road')
    return lane.items.some((it) => {
      const ix = itemX(lane, it, t);
      return ix < x + 0.5 + HALF && ix + it.len > x + 0.5 - HALF;
    });
  if (lane.kind !== 'river') return false;
  if (x < -0.45 || x > COLS - 0.55) return true;
  const c = x + 0.5;
  return !lane.items.some((it) => {
    const ix = itemX(lane, it, t);
    if (c < ix || c >= ix + it.len) return false;
    if (it.type === 'turtle') return sunk(it, t) < 1;
    // A crocodile's back is safe; its jaws (the end it swims towards) bite.
    if (it.type === 'croc') return lane.speed > 0 ? c < ix + it.len - JAWS : c >= ix + JAWS;
    return true;
  });
}

/** Where a hop from (row, x) in `dir` lands, or null if it's refused (edge, hedge or full slot). */
function hopTarget(lanes: Lane[], filled: boolean[], row: number, x: number, dir: Dir) {
  const r = row + DY[dir];
  let nx = x + DX[dir];
  if (r < GOAL_ROW || r > START_ROW || nx < -0.3 || nx > COLS - 0.7) return null;
  if (lanes[r].kind !== 'river') nx = Math.max(0, Math.min(COLS - 1, Math.round(nx)));
  if (r === GOAL_ROW) {
    const slot = SLOTS.indexOf(nx);
    if (slot < 0 || filled[slot]) return null;
    return { row: r, x: nx, slot };
  }
  return { row: r, x: nx, slot: -1 };
}

export interface State {
  d: Difficulty;
  kind: KindId;
  lanes: Lane[];
  /** Seconds since the start. */
  time: number;
  /** Lane clock: where traffic and the river are (it stops while frozen). */
  clock: number;
  /** Seconds of frozen traffic left. */
  freeze: number;
  /** A shield: the next hit costs no heart. */
  shield: boolean;
  /** Forward hops in a row, each within `STREAK_WINDOW` of the last; seconds left; milestones reached. */
  streak: number;
  streakLeft: number;
  tier: number;
  /** Reward of the milestone the last hop reached (null: none), for the card to celebrate. */
  reward: Reward | null;
  limit: number;
  row: number;
  x: number;
  /** Seconds before the next hop is allowed. */
  cool: number;
  /** Seconds left of the splash/squash before respawning (0 = alive). */
  dead: number;
  lives: number;
  score: number;
  filled: boolean[];
  homes: number;
  need: number;
  /** Highest row (smallest index) reached on this crossing: only new rows score. */
  best: number;
  done: boolean;
}

/** A road lane; rush hour packs the cars closer and drives them faster. */
function roadLane(d: Difficulty, rng: Rng, dir: number, rush = false): Lane {
  const truck = d >= 3 && rng.chance(0.35);
  const speed = dir * paceFor(d) * (truck ? rng.next() * 0.4 + 0.7 : rng.next() * 0.9 + 0.9) * (rush ? 1.1 : 1);
  const [gMin, gMax] = gapFor(d).map((g) => g * (rush ? 0.85 : 1));
  const items: Item[] = [];
  let at = 0;
  const tone = rng.pick([0, 3, 4, 5, 6]);
  while (at < COLS + 2 * MARGIN) {
    const len = truck ? rng.pick([2, 3]) : rng.pick(d >= 2 ? [1, 1, 2] : [1, 1, 1, 2]);
    items.push({ x0: at, len, tone, type: 'car' });
    at += len + gMin + rng.next() * (gMax - gMin) + Math.abs(speed) * 0.25;
  }
  return shift(rng, { kind: 'road', speed, period: at, items });
}

/** Train tracks: one long, fast train now and then (a signal blinks before it comes). */
function railLane(d: Difficulty, rng: Rng, dir: number): Lane {
  const speed = dir * (5.5 + rng.next() * 1.5) * Math.sqrt(paceFor(d));
  const len = rng.int(6, 8);
  // Seconds between two trains.
  const every = 6 + rng.next() * 3;
  return shift(rng, {
    kind: 'road',
    rail: true,
    speed,
    period: Math.max(len + COLS + 2 * MARGIN + 4, Math.abs(speed) * every),
    items: [{ x0: 0, len, tone: 7, type: 'train' }],
  });
}

/** A river lane of logs (now and then a crocodile from Expert up), or of turtle groups, some diving. */
function riverLane(d: Difficulty, rng: Rng, dir: number, turtles = false): Lane {
  const speed = dir * paceFor(d) * (rng.next() * 0.6 + 0.6);
  const [lMin, lMax] = logFor(d);
  const items: Item[] = [];
  let at = 0;
  while (at < COLS + 2 * MARGIN) {
    if (turtles) {
      const len = rng.pick([2, 3, 3]);
      items.push({ x0: at, len, tone: 0, type: 'turtle', dive: rng.chance(0.5) ? rng.next() * DIVE_S : undefined });
      at += len + 1 + rng.next() * (0.5 + d * 0.3);
      continue;
    }
    const croc = d >= 3 && rng.chance(d >= 4 ? 0.3 : 0.2);
    const len = croc ? 3 + rng.next() * 0.6 : lMin + rng.next() * (lMax - lMin);
    items.push({ x0: at, len, tone: 0, type: croc ? 'croc' : 'log' });
    at += len + 1.2 + rng.next() * (0.6 + d * 0.35);
  }
  return shift(rng, { kind: 'river', speed, period: at, items });
}

/** Start the loop at a random phase. */
function shift(rng: Rng, lane: Lane): Lane {
  const off = rng.next() * lane.period;
  for (const it of lane.items) it.x0 = mod(it.x0 + off, lane.period);
  return lane;
}

function makeLanes(d: Difficulty, rng: Rng, kind: KindId): Lane[] {
  const grass = (): Lane => ({ kind: 'grass', speed: 0, period: 1, items: [] });
  const lanes: Lane[] = [{ kind: 'goal', speed: 0, period: 1, items: [] }];
  // Rows 1-5: river; 6: median; 7-11: road; 12: start. Lanes left out of play become grass strips.
  // Rush hour fills the road and dries a river lane; a flood turns road lanes into river.
  const rivers = kind === 'rush' ? Math.max(2, riverFor(d) - 1) : riverFor(d);
  const roads = kind === 'rush' ? 5 : roadFor(d);
  const dryRiver = new Set(rng.shuffle([2, 3, 4, 5]).slice(0, 5 - rivers));
  const dryRoad = new Set(rng.shuffle([7, 8, 9, 10, 11]).slice(0, 5 - roads));
  const open = [7, 8, 9, 10, 11].filter((r) => !dryRoad.has(r));
  const special = new Set(rng.shuffle(open).slice(0, kind === 'railway' ? 2 : kind === 'flood' ? Math.max(2, open.length - 2) : 0));
  let dir = rng.chance(0.5) ? 1 : -1;
  for (let r = 1; r <= 5; r++) {
    lanes.push(dryRiver.has(r) ? grass() : riverLane(d, rng, dir, kind === 'turtles' && r % 2 === 1));
    dir = -dir;
  }
  lanes.push(grass());
  for (let r = 7; r <= 11; r++) {
    if (dryRoad.has(r)) lanes.push(grass());
    else if (!special.has(r)) lanes.push(roadLane(d, rng, dir, kind === 'rush'));
    else lanes.push(kind === 'railway' ? railLane(d, rng, dir) : riverLane(d, rng, dir));

    dir = -dir;
  }
  lanes.push(grass());
  return lanes;
}

/**
 * Deal a level. Lanes are drawn from the seed, then checked with the solver: every home slot must be
 * reachable from the start (from a few start times), or the lanes are dealt again a little slower.
 */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  let lanes = makeLanes(d, rng, kind);
  for (let tries = 0; tries < 30 && !fair(lanes); tries++) {
    lanes = makeLanes(d, rng, kind);
    if (tries > 10) for (const l of lanes) l.speed *= 0.9 ** (tries - 10);
  }
  return {
    d,
    kind,
    lanes,
    time: 0,
    clock: 0,
    freeze: 0,
    shield: false,
    streak: 0,
    streakLeft: 0,
    tier: 0,
    reward: null,
    limit: timeFor(d),
    row: START_ROW,
    x: START_COL,
    cool: 0,
    dead: 0,
    lives: LIVES,
    score: 0,
    filled: SLOTS.map(() => false),
    homes: 0,
    need: homesFor(d),
    best: START_ROW,
    done: false,
  };
}

function fair(lanes: Lane[]): boolean {
  return SLOTS.every((_, k) => {
    const filled = SLOTS.map((__, j) => j !== k);
    return [0, 6.3, 13.7].every((t0) => route(lanes, filled, START_ROW, START_COL, t0, 20, 2) !== null);
  });
}

/** Steps per hop slot used by the solver (and by anything that wants to replay its plan exactly). */
export const SUBSTEPS = 3;
const SUB = HOP_S / SUBSTEPS;

/**
 * Fastest plan from (row, x) at lane clock t0 into a free home slot, searching hop slots in time (BFS):
 * one action per HOP_S (-1 = wait), each followed by SUBSTEPS steps of HOP_S / SUBSTEPS. Null when no
 * plan reaches a slot within `maxS` seconds. With `every` > 1 it only hops on every `every`-th slot (a
 * slower player). `freeze` is the frozen traffic left (seconds) at the start.
 */
export function route(
  lanes: Lane[],
  filled: boolean[],
  row: number,
  x: number,
  t0: number,
  maxS: number,
  every = 1,
  freeze = 0,
): (Dir | -1)[] | null {
  interface Node {
    row: number;
    x: number;
    prev: number;
    act: Dir | -1;
  }
  const nodes: Node[] = [{ row, x, prev: -1, act: -1 }];
  let layer = [0];
  let t = t0;
  let frz = freeze;
  const acts: (Dir | -1)[] = [0, -1, 1, 3, 2];
  const WAIT: (Dir | -1)[] = [-1];
  for (let k = 0; k * HOP_S < maxS && layer.length; k++) {
    // Lane clock after each of this slot's substeps (and how far the river moved), accumulated like the game does.
    const times: number[] = [];
    const moves: number[] = [];
    let tt = t;
    for (let j = 0; j < SUBSTEPS; j++) {
      const k2 = tick(tt, frz, SUB);
      tt = k2.clock;
      frz = k2.freeze;
      times.push(tt);
      moves.push(k2.moved);
    }
    const seen = new Set<number>();
    const next: number[] = [];
    for (const i of layer) {
      const n = nodes[i];
      for (const a of k % every ? WAIT : acts) {
        const to = a === -1 ? { row: n.row, x: n.x, slot: -1 } : hopTarget(lanes, filled, n.row, n.x, a);
        if (!to) continue;
        if (to.slot >= 0) {
          const plan: (Dir | -1)[] = [a];
          for (let p = i; nodes[p].prev >= 0; p = nodes[p].prev) plan.push(nodes[p].act);
          return plan.reverse();
        }
        let nx = to.x;
        let dead = false;
        const speed = lanes[to.row].kind === 'river' ? lanes[to.row].speed : 0;
        for (let j = 0; j < SUBSTEPS; j++) {
          nx += speed * moves[j];
          if (hazard(lanes, to.row, nx, times[j])) {
            dead = true;
            break;
          }
        }
        if (dead) continue;
        const key = to.row * 10000 + Math.round((nx + MARGIN) * 8);
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.push({ row: to.row, x: nx, prev: i, act: a });
        next.push(nodes.length - 1);
      }
    }
    layer = next;
    t = tt;
  }
  return null;
}

export type HopResult = '' | 'move' | 'home' | 'win';

/** Give a streak reward: frozen traffic, or a shield. */
export function grant(s: State, r: Reward) {
  if (r === 'shield') s.shield = true;
  else s.freeze = Math.max(s.freeze, r === 'freeze' ? FREEZE_S : BIG_FREEZE_S);
}

/** Hop one cell in `dir` (if the hopper is alive and rested). Scores new rows and home slots; quick forward hops build a streak. */
export function hop(s: State, dir: Dir): HopResult {
  if (s.done || s.dead > 0 || s.cool > 1e-6) return '';
  const to = hopTarget(s.lanes, s.filled, s.row, s.x, dir);
  if (!to) return '';
  s.cool = HOP_S;
  s.reward = null;
  if (dir === 0) {
    s.streak++;
    s.streakLeft = STREAK_WINDOW;
    if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
      s.reward = REWARDS[s.tier++];
      grant(s, s.reward);
    }
  }
  if (to.row < s.best) {
    s.score += ROW_POINTS * (s.best - to.row);
    s.best = to.row;
  }
  if (to.slot < 0) {
    s.row = to.row;
    s.x = to.x;
    return 'move';
  }
  s.filled[to.slot] = true;
  s.homes++;
  s.score += HOME_POINTS;
  s.row = START_ROW;
  s.x = START_COL;
  s.best = START_ROW;
  if (s.homes < s.need) return 'home';
  s.done = true;
  s.score += Math.ceil(Math.max(0, s.limit - s.time)) * TIME_POINTS + s.lives * LIFE_BONUS;
  return 'win';
}

export interface StepEvents {
  /** Hit by a car or fell in the water this step. */
  died: boolean;
  /** The shield took the hit: no heart lost. */
  shielded: boolean;
  /** The streak of forward hops ran out (after this many). */
  streakEnd: number;
  respawned: boolean;
  /** Out of lives or out of time. */
  over: boolean;
}

/** Advance by `dt` seconds: ride the log, check for cars and water, count down the clock. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { died: false, shielded: false, streakEnd: 0, respawned: false, over: false };
  if (s.done) return ev;
  s.time += dt;
  const k = tick(s.clock, s.freeze, dt);
  s.clock = k.clock;
  s.freeze = k.freeze;
  s.cool = Math.max(0, s.cool - dt);
  if (s.streak && (s.streakLeft -= dt) <= 0) endStreak(s, ev);
  if (s.time >= s.limit) {
    s.done = true;
    ev.over = true;
    return ev;
  }
  if (s.dead > 0) {
    s.dead -= dt;
    if (s.dead <= 0) {
      s.dead = 0;
      s.row = START_ROW;
      s.x = START_COL;
      ev.respawned = true;
    }
    return ev;
  }
  const lane = s.lanes[s.row];
  if (lane.kind === 'river') s.x += lane.speed * k.moved;
  if (hazard(s.lanes, s.row, s.x, s.clock)) {
    ev.died = true;
    endStreak(s, ev);
    if (s.shield) {
      // The shield takes it: back to the start, no heart lost.
      s.shield = false;
      ev.shielded = true;
      s.dead = RESPAWN_S;
      return ev;
    }
    s.lives--;

    if (s.lives <= 0) {
      s.done = true;
      ev.over = true;
    } else s.dead = RESPAWN_S;
  }
  return ev;
}

/** The streak of forward hops is over (timed out, or the hopper went down). */
function endStreak(s: State, ev: StepEvents) {
  if (s.streak >= 2) ev.streakEnd = s.streak;
  s.streak = s.tier = 0;
  s.streakLeft = 0;
}
