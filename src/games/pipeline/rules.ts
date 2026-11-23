import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import type { Dir } from '../../kits/gesture/gesture';

/** Board size in cells. */
export const COLS = 7;
export const ROWS = 8;
/** Pieces shown in the queue (the head is the next one laid). */
export const QUEUE = 4;

/** Openings of a piece as a bit per side: up 1, right 2, down 4, left 8. */
export const H = 10;
export const V = 5;
const UR = 3;
export const RD = 6;
export const DL = 12;
export const LU = 9;
export const X = 15;
/** The queue deals each of the seven pieces equally often. */
const BAG = [H, V, UR, RD, DL, LU, X];

/** Pieces the flow must pass through. */
export const goalFor = (d: Difficulty) => byLevel(d, [8, 10, 12, 14, 16]);
/** Seconds before the flow starts by itself. */
export const countdownFor = (d: Difficulty) => byLevel(d, [20, 17, 14, 11, 9]);
/** Seconds the liquid takes to fill one piece. */
export const perPieceFor = (d: Difficulty) => byLevel(d, [2.8, 2.4, 2.1, 1.9, 1.7]);
/** Blocked cells scattered on the board. */
export const blocksFor = (d: Difficulty) => byLevel(d, [0, 2, 4, 6, 8]);
/** A drain tile: ending the flow in it pays a bonus (from Medium up). */
const hasDrain = (d: Difficulty) => d >= 2;

/** Points per piece the flow passes. */
export const PIPE_POINTS = 50;
/** Extra points when the flow crosses a cross piece a second time. */
export const CROSS_BONUS = 250;
/** Points per whole second left on the countdown when the flow is started early. */
export const EARLY_POINTS = 10;
/** Ending the flow in the drain, once the goal is met. */
export const DRAIN_BONUS = 400;
/** Cost of replacing a piece, and of each piece left dry at the end. */
export const REPLACE_POINTS = 25;
export const UNUSED_POINTS = 10;
/** Seconds you can't lay a piece after replacing one. */
const REPLACE_S = 0.7;
/** The flow fills pieces this many times faster once sped up. */
const FAST = 6;

export const opp = (d: Dir) => ((d + 2) % 4) as Dir;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** The neighbour of `cell` on side `d`, or -1 off the board. */
export function neighbour(cell: number, d: Dir): number {
  const c = (cell % COLS) + DX[d];
  const r = Math.floor(cell / COLS) + DY[d];
  return c >= 0 && r >= 0 && c < COLS && r < ROWS ? r * COLS + c : -1;
}

/** Does `piece` have an opening on side `d`? */
export const opens = (piece: number, d: Dir) => (piece >> d) & 1;

/** Where liquid entering `piece` from side `from` leaves (a cross goes straight on). */
export function exitOf(piece: number, from: Dir): Dir {
  if (piece === X) return opp(from);
  for (let d = 0; d < 4; d++) if (d !== from && opens(piece, d as Dir)) return d as Dir;
  return opp(from);
}

/** The channel bit a flow through `piece` from `from` fills: 1 across, 2 up and down (one channel for non-crosses). */
const channel = (piece: number, from: Dir) => (piece !== X ? 3 : from % 2 ? 1 : 2);

interface Flow {
  /** Cell the liquid is filling. */
  at: number;
  /** Side it came in from (-1 in the source). */
  from: Dir | -1;
  exit: Dir;
  /** How full the piece is, 0 → 1. */
  t: number;
}

export interface State {
  d: Difficulty;
  /** Openings of the piece on each cell (0 = empty). */
  pipe: number[];
  /** Channels already filled on each cell (bits from `channel`). */
  wet: number[];
  block: boolean[];
  source: number;
  srcDir: Dir;
  /** -1 without a drain. */
  drain: number;
  /** The drain's opening. */
  drainDir: Dir;
  queue: number[];
  goal: number;
  countdown: number;
  per: number;
  started: boolean;
  fast: boolean;
  flow: Flow;
  /** Pieces the flow has passed. */
  count: number;
  crosses: number;
  /** Placement delay left after a replacement. */
  cool: number;
  score: number;
  /** Points from starting early, kept for the end screen. */
  early: number;
  drained: boolean;
  done: '' | 'win' | 'lose';
  rng: Rng;
}

const free = (s: Pick<State, 'block' | 'source' | 'drain'>, cell: number) =>
  cell >= 0 && !s.block[cell] && cell !== s.source && cell !== s.drain;

/** Is there a run of `len` free cells from `start` without revisiting any (so the level has room)? */
function roomFor(s: Pick<State, 'block' | 'source' | 'drain'>, start: number, len: number): boolean {
  const seen = new Array<boolean>(COLS * ROWS).fill(false);
  let budget = 40000;
  const dfs = (cell: number, n: number): boolean => {
    if (n >= len) return true;
    if (--budget < 0) return false;
    seen[cell] = true;
    for (let d = 0; d < 4; d++) {
      const nb = neighbour(cell, d as Dir);
      if (free(s, nb) && !seen[nb] && dfs(nb, n + 1)) return true;
    }
    seen[cell] = false;
    return false;
  };
  return free(s, start) && dfs(start, 1);
}

const deal = (rng: Rng) => rng.pick(BAG);

/** Deal a level: source, drain, blocked cells and the piece queue, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const goal = goalFor(d);
  const n = COLS * ROWS;
  let s: State | null = null;
  for (let tries = 0; tries < 60; tries++) {
    // The source sits inside the board, with two free cells straight ahead (a straight piece always fits).
    const source = rng.int(1, ROWS - 2) * COLS + rng.int(1, COLS - 2);
    let srcDir = rng.int(0, 3) as Dir;
    while (neighbour(neighbour(source, srcDir), srcDir) < 0) srcDir = ((srcDir + 1) % 4) as Dir;
    const reserved = new Set([source, neighbour(source, srcDir), neighbour(neighbour(source, srcDir), srcDir)]);
    let drain = -1;
    let drainDir: Dir = 0;
    if (hasDrain(d))
      for (let k = 0; k < 100 && drain < 0; k++) {
        const cell = rng.int(0, n - 1);
        const dist = Math.abs((cell % COLS) - (source % COLS)) + Math.abs(Math.floor(cell / COLS) - Math.floor(source / COLS));
        const dir = rng.int(0, 3) as Dir;
        const nb = neighbour(cell, dir);
        if (reserved.has(cell) || dist < 3 || nb < 0 || reserved.has(nb)) continue;
        drain = cell;
        drainDir = dir;
        reserved.add(cell).add(nb);
      }
    const block = new Array<boolean>(n).fill(false);
    const cells = rng.shuffle([...Array(n).keys()].filter((c) => !reserved.has(c)));
    for (const c of cells.slice(0, blocksFor(d))) block[c] = true;
    s = {
      d,
      pipe: new Array<number>(n).fill(0),
      wet: new Array<number>(n).fill(0),
      block,
      source,
      srcDir,
      drain,
      drainDir,
      queue: [],
      goal,
      countdown: countdownFor(d),
      per: perPieceFor(d),
      started: false,
      fast: false,
      flow: { at: source, from: -1, exit: srcDir, t: 0 },
      count: 0,
      crosses: 0,
      cool: 0,
      score: 0,
      early: 0,
      drained: false,
      done: '',
      rng,
    };
    if (roomFor(s, neighbour(source, srcDir), goal + 4)) break;
  }
  for (let i = 0; i < QUEUE; i++) s!.queue.push(deal(rng));
  return s!;
}

export type PlaceResult = 'placed' | 'replaced' | 'wait' | 'no';

/** Can a piece be laid on `cell` now (empty, or holding a dry piece the flow isn't in)? */
export function canPlace(s: State, cell: number): boolean {
  if (s.done || cell < 0 || !free(s, cell)) return false;
  return !s.wet[cell] && !(s.started && s.flow.at === cell);
}

/** Lay the head of the queue on `cell`. Replacing a dry piece costs points and a short delay. */
export function place(s: State, cell: number): PlaceResult {
  if (!canPlace(s, cell)) return 'no';
  if (s.cool > 0) return 'wait';
  const replaced = s.pipe[cell] !== 0;
  s.pipe[cell] = s.queue.shift()!;
  s.queue.push(deal(s.rng));
  if (replaced) {
    s.score = Math.max(0, s.score - REPLACE_POINTS);
    s.cool = REPLACE_S;
  }
  return replaced ? 'replaced' : 'placed';
}

/** Start the flow now (bonus for the seconds left), or speed up a running flow. */
export function flowNow(s: State) {
  if (s.done) return;
  if (!s.started) {
    s.early = Math.floor(s.countdown) * EARLY_POINTS;
    s.score += s.early;
    s.countdown = 0;
    s.started = true;
  } else s.fast = true;
}

/**
 * Where the next piece must go to extend the chain of pieces from the source, the side it is entered
 * from, and how many pieces the chain has so far. Null when the chain runs into a dead end.
 */
export function openEnd(s: State): { cell: number; from: Dir; length: number } | null {
  let cell = s.source;
  let exit = s.srcDir;
  const seen = new Set<number>();
  for (let k = 0; k < COLS * ROWS * 2; k++) {
    const next = neighbour(cell, exit);
    if (!free(s, next)) return null;
    const from = opp(exit);
    const p = s.pipe[next];
    if (!p) return { cell: next, from, length: k };
    const key = next * 4 + (channel(p, from) as number);
    if (!opens(p, from) || seen.has(key)) return null;
    seen.add(key);
    cell = next;
    exit = exitOf(p, from);
  }
  return null;
}

export interface StepEvents {
  /** A whole second of the countdown went by. */
  tick: boolean;
  started: boolean;
  /** Cells the liquid entered this step. */
  entered: number[];
  /** A cross was filled a second time. */
  cross: boolean;
  /** The flow just passed the goal count. */
  goal: boolean;
  /** The flow stopped: spilled (`spill` is the last cell and `spillDir` the side) or drained. */
  end: '' | 'win' | 'lose';
  spill: number;
  spillDir: Dir;
}

function finish(s: State, drained: boolean) {
  let dry = 0;
  for (let i = 0; i < s.pipe.length; i++) if (s.pipe[i] && !s.wet[i]) dry++;
  s.score = Math.max(0, s.score - dry * UNUSED_POINTS);
  s.drained = drained;
  if (s.count >= s.goal) {
    if (drained) s.score += DRAIN_BONUS;
    s.done = 'win';
  } else s.done = 'lose';
}

/** Advance the countdown and the flow by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { tick: false, started: false, entered: [], cross: false, goal: false, end: '', spill: -1, spillDir: 0 };
  if (s.done) return ev;
  s.cool = Math.max(0, s.cool - dt);
  if (!s.started) {
    const before = Math.ceil(s.countdown);
    s.countdown = Math.max(0, s.countdown - dt);
    ev.tick = Math.ceil(s.countdown) < before;
    if (s.countdown > 0) return ev;
    s.started = true;
    ev.started = true;
    return ev;
  }
  const f = s.flow;
  f.t += dt / (s.fast ? s.per / FAST : s.per);
  while (f.t >= 1) {
    const next = neighbour(f.at, f.exit);
    const from = opp(f.exit);
    if (next >= 0 && next === s.drain && s.drainDir === from) {
      finish(s, true);
      ev.end = s.done;
      ev.spill = next;
      ev.spillDir = f.exit;
      return ev;
    }
    const p = next >= 0 && free(s, next) ? s.pipe[next] : 0;
    const ch = channel(p, from);
    if (!p || !opens(p, from) || s.wet[next] & ch) {
      f.t = 1;
      finish(s, false);
      ev.end = s.done;
      ev.spill = f.at;
      ev.spillDir = f.exit;
      return ev;
    }
    if (p === X && s.wet[next]) {
      s.crosses++;
      s.score += CROSS_BONUS;
      ev.cross = true;
    }
    s.wet[next] |= ch;
    s.count++;
    s.score += PIPE_POINTS;
    if (s.count === s.goal) ev.goal = true;
    ev.entered.push(next);
    f.t -= 1;
    f.at = next;
    f.from = from;
    f.exit = exitOf(p, from);
  }
  return ev;
}
