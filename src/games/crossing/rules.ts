import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { DX, DY, type Dir } from '../../kits/gesture/gesture';

/**
 * A grid hopper: the field is ROWS lanes of COLS cells. The hopper's row is whole, its column is
 * whole on land and on roads but drifts with the log it rides on the river. Lanes are periodic, so
 * where every car and log sits is a pure function of time (which is what lets the solver plan ahead).
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

interface Item {
  /** Position at time 0 along the lane's loop. */
  x0: number;
  len: number;
  /** Palette slot (cars). */
  tone: number;
}

export interface Lane {
  kind: LaneKind;
  /** Cells per second, signed (positive = rightwards). */
  speed: number;
  /** Length of the loop the items travel around. */
  period: number;
  items: Item[];
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Left edge of an item at time `t` (between -MARGIN and period - MARGIN). */
export const itemX = (lane: Lane, it: Item, t: number) => mod(it.x0 + lane.speed * t, lane.period) - MARGIN;

/** Would a hopper at column `x` (left edge of its cell) of `row` be hit, drowned or swept away at time `t`? */
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
    return ix <= c && c < ix + it.len;
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
  lanes: Lane[];
  /** Seconds since the start. */
  time: number;
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

function roadLane(d: Difficulty, rng: Rng, dir: number): Lane {
  const truck = d >= 3 && rng.chance(0.35);
  const speed = dir * paceFor(d) * (truck ? rng.next() * 0.4 + 0.7 : rng.next() * 0.9 + 0.9);
  const [gMin, gMax] = gapFor(d);
  const items: Item[] = [];
  let at = 0;
  const tone = rng.pick([0, 3, 4, 5, 6]);
  while (at < COLS + 2 * MARGIN) {
    const len = truck ? rng.pick([2, 3]) : rng.pick(d >= 2 ? [1, 1, 2] : [1, 1, 1, 2]);
    items.push({ x0: at, len, tone });
    at += len + gMin + rng.next() * (gMax - gMin) + Math.abs(speed) * 0.25;
  }
  return shift(rng, { kind: 'road', speed, period: at, items });
}

function riverLane(d: Difficulty, rng: Rng, dir: number): Lane {
  const speed = dir * paceFor(d) * (rng.next() * 0.6 + 0.6);
  const [lMin, lMax] = logFor(d);
  const items: Item[] = [];
  let at = 0;
  while (at < COLS + 2 * MARGIN) {
    const len = lMin + rng.next() * (lMax - lMin);
    items.push({ x0: at, len, tone: 0 });
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

function makeLanes(d: Difficulty, rng: Rng): Lane[] {
  const grass = (): Lane => ({ kind: 'grass', speed: 0, period: 1, items: [] });
  const lanes: Lane[] = [{ kind: 'goal', speed: 0, period: 1, items: [] }];
  // Rows 1-5: river; 6: median; 7-11: road; 12: start. Lanes left out of play become grass strips.
  const dryRiver = new Set(rng.shuffle([2, 3, 4, 5]).slice(0, 5 - riverFor(d)));
  const dryRoad = new Set(rng.shuffle([7, 8, 9, 10, 11]).slice(0, 5 - roadFor(d)));
  let dir = rng.chance(0.5) ? 1 : -1;
  for (let r = 1; r <= 5; r++) {
    lanes.push(dryRiver.has(r) ? grass() : riverLane(d, rng, dir));
    dir = -dir;
  }
  lanes.push(grass());
  for (let r = 7; r <= 11; r++) {
    lanes.push(dryRoad.has(r) ? grass() : roadLane(d, rng, dir));
    dir = -dir;
  }
  lanes.push(grass());
  return lanes;
}

/**
 * Deal a level. Lanes are drawn from the seed, then checked with the solver: every home slot must be
 * reachable from the start (from a few start times), or the lanes are dealt again a little slower.
 */
export function createLevel(d: Difficulty, rng: Rng): State {
  let lanes = makeLanes(d, rng);
  for (let tries = 0; tries < 30 && !fair(lanes); tries++) {
    lanes = makeLanes(d, rng);
    if (tries > 10) for (const l of lanes) l.speed *= 0.9 ** (tries - 10);
  }
  return {
    d,
    lanes,
    time: 0,
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
 * Fastest plan from (row, x) at time t0 into a free home slot, searching hop slots in time (BFS):
 * one action per HOP_S (-1 = wait), each followed by SUBSTEPS steps of HOP_S / SUBSTEPS. Null when no
 * plan reaches a slot within `maxS` seconds. With `every` > 1 it only hops on every `every`-th slot (a
 * slower player).
 */
export function route(lanes: Lane[], filled: boolean[], row: number, x: number, t0: number, maxS: number, every = 1): (Dir | -1)[] | null {
  interface Node {
    row: number;
    x: number;
    prev: number;
    act: Dir | -1;
  }
  const nodes: Node[] = [{ row, x, prev: -1, act: -1 }];
  let layer = [0];
  let t = t0;
  const acts: (Dir | -1)[] = [0, -1, 1, 3, 2];
  const WAIT: (Dir | -1)[] = [-1];
  for (let k = 0; k * HOP_S < maxS && layer.length; k++) {
    // Time after this slot's substeps, accumulated like the game does.
    const times: number[] = [];
    let tt = t;
    for (let j = 0; j < SUBSTEPS; j++) times.push((tt += SUB));
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
        for (const tj of times) {
          nx += speed * SUB;
          if (hazard(lanes, to.row, nx, tj)) {
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

/** Hop one cell in `dir` (if the hopper is alive and rested). Scores new rows and home slots. */
export function hop(s: State, dir: Dir): HopResult {
  if (s.done || s.dead > 0 || s.cool > 1e-6) return '';
  const to = hopTarget(s.lanes, s.filled, s.row, s.x, dir);
  if (!to) return '';
  s.cool = HOP_S;
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
  respawned: boolean;
  /** Out of lives or out of time. */
  over: boolean;
}

/** Advance by `dt` seconds: ride the log, check for cars and water, count down the clock. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { died: false, respawned: false, over: false };
  if (s.done) return ev;
  s.time += dt;
  s.cool = Math.max(0, s.cool - dt);
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
  if (lane.kind === 'river') s.x += lane.speed * dt;
  if (hazard(s.lanes, s.row, s.x, s.time)) {
    s.lives--;
    ev.died = true;
    if (s.lives <= 0) {
      s.done = true;
      ev.over = true;
    } else s.dead = RESPAWN_S;
  }
  return ev;
}
