import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';
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
/** Bonus coins on the board: the flow through a pipe on one collects it. */
export const coinsFor = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 3]);

/**
 * The kinds of level: plain, fixed reservoirs (slow, count double), walls in a maze, fixed one-way
 * pipes, and a flash flood (long countdown, fast flow).
 */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'reservoir' },
  { id: 'maze', min: 2 },
  { id: 'flood', min: 2 },
  { id: 'oneway', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Fixed pieces dealt on a reservoir or one-way level. */
const FIXED = 2;
const ONEWAYS = 3;
/** The flow takes this much longer to fill a reservoir, which counts as this many pipes. */
const RES_SLOW = 2.5;
export const RES_COUNT = 2;

/** Pieces joined to the chain in a row that fire a combo event, and what each unlocks. */
export const CHAIN_TIERS = [3, 6, 10, 15, 21] as const;
export type Power = 'freeze' | 'perfect' | 'double';
const TIER_POWERS: readonly Power[] = ['freeze', 'perfect', 'double', 'freeze', 'perfect'];
/** Seconds a freeze holds the flow (or adds to the countdown before it starts). */
export const FREEZE_S = 4;

/** Points per piece the flow passes, and per coin it collects. */
export const PIPE_POINTS = 50;
export const COIN_POINTS = 100;
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
  kind: KindId;
  /** Openings of the piece on each cell (0 = empty). */
  pipe: number[];
  /** Pieces dealt with the level: they can't be replaced. Reservoirs; one-way pipes (their exit, else -1). */
  fixed: boolean[];
  res: boolean[];
  oneway: number[];
  /** Coins still on the board. */
  coin: boolean[];
  coins: number;
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
  /** Seconds on the countdown at the start, and left now. */
  clock: number;
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
  /** Pieces joined to the chain in a row, and the milestone reached. */
  chain: number;
  tier: number;
  /** Combo rewards: seconds the flow is frozen, and flow points doubled for the rest of the run. */
  freeze: number;
  double: boolean;
  /** The last placement's milestone (1-based) and what it unlocked; 0 / '' for none. */
  fired: number;
  unlocked: Power | '';
  drained: boolean;
  done: '' | 'win' | 'lose';
  rng: Rng;
}

const free = (s: Pick<State, 'block' | 'source' | 'drain'>, cell: number) =>
  cell >= 0 && !s.block[cell] && cell !== s.source && cell !== s.drain;

/** Does the piece on `cell` take liquid in from side `from` (it opens there, and a one-way pipe points on)? */
export const accepts = (s: State, cell: number, from: Dir) =>
  s.pipe[cell] !== 0 && opens(s.pipe[cell], from) === 1 && (s.oneway[cell] < 0 || from === opp(s.oneway[cell] as Dir));

/** Is there a run of `len` free cells from `start` without revisiting any (so the level has room)? */
function roomFor(s: Pick<State, 'block' | 'source' | 'drain'>, start: number, len: number): boolean {
  // (Fixed pieces are dealt as blocks first, then turned into pipes: room never counts on them.)
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

/** Deal a level: source, drain, blocked cells, fixed pieces, coins and the piece queue, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const goal = goalFor(d);
  const n = COLS * ROWS;
  const fixedN = kind === 'reservoir' ? FIXED : kind === 'oneway' ? ONEWAYS : 0;
  const clock = kind === 'flood' ? Math.round(countdownFor(d) * 1.4) : kind === 'maze' ? countdownFor(d) + 3 : countdownFor(d);
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
    if (kind === 'maze') {
      // Walls: short lines of two or three blocks, a few more cells than usual.
      let left = blocksFor(d) + 3;
      for (const c of cells) {
        if (left <= 1) break;
        const dir: Dir = rng.chance(0.5) ? 1 : 2;
        const line: number[] = [];
        for (let k = 0, at = c; k < Math.min(left, rng.int(2, 3)) && at >= 0 && !reserved.has(at) && !block[at]; k++) {
          line.push(at);
          at = neighbour(at, dir);
        }
        if (line.length < 2) continue;
        for (const b of line) block[b] = true;
        left -= line.length;
      }
    } else for (const c of cells.slice(0, blocksFor(d))) block[c] = true;
    // Fixed pieces: straights with a free cell at both ends, apart from each other. Dealt as blocks
    // while checking the board has room, so the room never counts on them.
    const fixed: { cell: number; pipe: number; exit: Dir }[] = [];
    for (const c of cells) {
      if (fixed.length >= fixedN) break;
      const across = rng.chance(0.5);
      const [a, b] = across ? [neighbour(c, 3), neighbour(c, 1)] : [neighbour(c, 0), neighbour(c, 2)];
      const near = (x: number) =>
        fixed.some((f) => Math.abs((f.cell % COLS) - (x % COLS)) + Math.abs(Math.floor(f.cell / COLS) - Math.floor(x / COLS)) < 3);
      if (block[c] || a < 0 || b < 0 || block[a] || block[b] || reserved.has(a) || reserved.has(b) || near(c)) continue;
      const exit: Dir = across ? (rng.chance(0.5) ? 1 : 3) : rng.chance(0.5) ? 0 : 2;
      fixed.push({ cell: c, pipe: across ? H : V, exit });
      block[c] = true;
    }
    s = {
      d,
      kind,
      pipe: new Array<number>(n).fill(0),
      fixed: new Array<boolean>(n).fill(false),
      res: new Array<boolean>(n).fill(false),
      oneway: new Array<number>(n).fill(-1),
      coin: new Array<boolean>(n).fill(false),
      coins: 0,
      wet: new Array<number>(n).fill(0),
      block,
      source,
      srcDir,
      drain,
      drainDir,
      queue: [],
      goal,
      clock,
      countdown: clock,
      per: perPieceFor(d) * (kind === 'flood' ? 0.75 : 1),
      started: false,
      fast: false,
      flow: { at: source, from: -1, exit: srcDir, t: 0 },
      count: 0,
      crosses: 0,
      cool: 0,
      score: 0,
      early: 0,
      chain: 0,
      tier: 0,
      freeze: 0,
      double: false,
      fired: 0,
      unlocked: '',
      drained: false,
      done: '',
      rng,
    };
    const room = roomFor(s, neighbour(source, srcDir), goal + 4);
    for (const f of fixed) {
      block[f.cell] = false;
      s.pipe[f.cell] = f.pipe;
      s.fixed[f.cell] = true;
      if (kind === 'reservoir') s.res[f.cell] = true;
      else s.oneway[f.cell] = f.exit;
    }
    if (room) break;
  }
  const st = s!;
  // Coins on empty cells, not right by the source.
  const spots = [...Array(n).keys()].filter(
    (c) =>
      free(st, c) &&
      !st.pipe[c] &&
      c !== neighbour(st.source, st.srcDir) &&
      Math.abs((c % COLS) - (st.source % COLS)) + Math.abs(Math.floor(c / COLS) - Math.floor(st.source / COLS)) >= 2,
  );
  for (const c of rng.shuffle(spots).slice(0, coinsFor(d))) st.coin[c] = true;
  st.coins = coinsFor(d);
  for (let i = 0; i < QUEUE; i++) st.queue.push(deal(rng));
  return st;
}

export type PlaceResult = 'placed' | 'replaced' | 'wait' | 'no';

/** Can a piece be laid on `cell` now (empty, or holding a dry piece the flow isn't in, never a fixed one)? */
export function canPlace(s: State, cell: number): boolean {
  if (s.done || cell < 0 || !free(s, cell) || s.fixed[cell]) return false;
  return !s.wet[cell] && !(s.started && s.flow.at === cell);
}

interface End {
  cell: number;
  from: Dir;
  length: number;
}

/** Walk the chain of pieces from the source: how many pieces it has, and its open end (null at a dead end). */
function walk(s: State): { end: End | null; length: number } {
  let cell = s.source;
  let exit = s.srcDir;
  const seen = new Set<number>();
  for (let k = 0; k < COLS * ROWS * 2; k++) {
    const next = neighbour(cell, exit);
    if (!free(s, next)) return { end: null, length: k };
    const from = opp(exit);
    const p = s.pipe[next];
    if (!p) return { end: { cell: next, from, length: k }, length: k };
    const key = next * 4 + (channel(p, from) as number);
    if (!accepts(s, next, from) || seen.has(key)) return { end: null, length: k };
    seen.add(key);
    cell = next;
    exit = exitOf(p, from);
  }
  return { end: null, length: 0 };
}

/**
 * Where the next piece must go to extend the chain of pieces from the source, the side it is entered
 * from, and how many pieces the chain has so far. Null when the chain runs into a dead end.
 */
export const openEnd = (s: State): End | null => walk(s).end;

/** The piece that best extends the chain from its open end (towards the roomiest free cell), or 0. */
export function perfectPiece(s: State): number {
  const end = openEnd(s);
  if (!end) return 0;
  let best = 0;
  let bestRoom = -1;
  for (const p of [H, V, UR, RD, DL, LU]) {
    if (!opens(p, end.from)) continue;
    const exit = exitOf(p, end.from);
    const nb = neighbour(end.cell, exit);
    if (!free(s, nb) || s.wet[nb] || (s.pipe[nb] && !accepts(s, nb, opp(exit)))) continue;
    let room = s.pipe[nb] ? 3 : 0;
    for (let d = 0; d < 4; d++) {
      const nn = neighbour(nb, d as Dir);
      if (nn !== end.cell && free(s, nn) && !s.pipe[nn]) room++;
    }
    // Straight on wins ties.
    if (room > bestRoom || (room === bestRoom && exit === opp(end.from))) [best, bestRoom] = [p, room];
  }
  return best;
}

/** Turn a combo reward on; returns what it actually did (a perfect piece with nowhere to go freezes instead). */
function unlock(s: State, p: Power): Power {
  if (p === 'perfect') {
    const piece = perfectPiece(s);
    if (piece) {
      s.queue[0] = piece;
      return p;
    }
  }
  if (p === 'double') s.double = true;
  else if (!s.started) s.countdown += FREEZE_S;
  else s.freeze = FREEZE_S;
  return p === 'double' ? p : 'freeze';
}

/** Lay the head of the queue on `cell`. Replacing a dry piece costs points and a short delay. */
export function place(s: State, cell: number): PlaceResult {
  s.fired = 0;
  s.unlocked = '';
  if (!canPlace(s, cell)) return 'no';
  if (s.cool > 0) return 'wait';
  const before = walk(s).length;
  const replaced = s.pipe[cell] !== 0;
  s.pipe[cell] = s.queue.shift()!;
  s.queue.push(deal(s.rng));
  if (replaced) {
    s.score = Math.max(0, s.score - REPLACE_POINTS);
    s.cool = REPLACE_S;
  }
  // The combo: pieces that join the chain, in a row. A piece that doesn't join it breaks the combo.
  const joined = walk(s).length - before;
  if (joined > 0) {
    s.chain += joined;
    while (s.tier < CHAIN_TIERS.length && s.chain >= CHAIN_TIERS[s.tier]) {
      s.fired = ++s.tier;
      s.unlocked = unlock(s, TIER_POWERS[s.tier - 1]);
    }
  } else s.chain = s.tier = 0;
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

export interface StepEvents {
  /** A whole second of the countdown went by. */
  tick: boolean;
  started: boolean;
  /** Cells the liquid entered this step, and coins it collected (cells). */
  entered: number[];
  coins: number[];
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
  const ev: StepEvents = {
    tick: false,
    started: false,
    entered: [],
    coins: [],
    cross: false,
    goal: false,
    end: '',
    spill: -1,
    spillDir: 0,
  };
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
  // Frozen (a combo reward): the flow holds still.
  if (s.freeze > 0) {
    s.freeze = Math.max(0, s.freeze - dt);
    return ev;
  }
  const f = s.flow;
  const per = s.per * (s.res[f.at] ? RES_SLOW : 1);
  f.t += dt / (s.fast ? per / FAST : per);
  const mult = s.double ? 2 : 1;
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
    if (!p || !accepts(s, next, from) || s.wet[next] & ch) {
      f.t = 1;
      finish(s, false);
      ev.end = s.done;
      ev.spill = f.at;
      ev.spillDir = f.exit;
      return ev;
    }
    if (p === X && s.wet[next]) {
      s.crosses++;
      s.score += CROSS_BONUS * mult;
      ev.cross = true;
    }
    if (s.coin[next]) {
      s.coin[next] = false;
      s.score += COIN_POINTS;
      ev.coins.push(next);
    }
    s.wet[next] |= ch;
    const before = s.count;
    const n = s.res[next] ? RES_COUNT : 1;
    s.count += n;
    s.score += PIPE_POINTS * n * mult;
    if (before < s.goal && s.count >= s.goal) ev.goal = true;
    ev.entered.push(next);
    // Carry the leftover time on into the next piece (a reservoir takes longer to fill).
    f.t = ((f.t - 1) * (s.res[f.at] ? RES_SLOW : 1)) / (s.res[next] ? RES_SLOW : 1);
    f.at = next;
    f.from = from;
    f.exit = exitOf(p, from);
  }
  return ev;
}
