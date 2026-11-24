import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Points per lit tile found, for a round without a wrong tap, and per second left on a round's clock. */
export const TILE_POINTS = 10;
export const PERFECT_POINTS = 50;
export const SPEED_POINTS = 10;
/** A golden tile found: extra points and seconds on the round's clock. */
export const GOLD_POINTS = 15;
export const GOLD_S = 1;
export const LIVES = 3;
/** The round banner before the tiles light up. */
export const INTRO_S = 0.7;
/** The cheer after a round, and the reveal of the missed tiles after the clock ran out. */
const GOOD_S = 0.8;
const LATE_S = 1.4;
/** Sliding grids: how long the board takes to slide over, once the tiles go dark. */
export const MOVE_S = 0.6;
/** Flicker rounds: tiles light one after another, this far apart, each for FLICK_ON. */
const FLICK_GAP = 0.28;
export const FLICK_ON = 0.6;

/**
 * Correct tiles in a row (a wrong tile or a timeout ends it) unlock: extra seconds on the clock,
 * then a longer look at the next round, then a heart back.
 */
export const STREAK_TIERS = [6, 12, 20] as const;
export type Power = 'time' | 'look' | 'heart';
const POWERS: readonly Power[] = ['time', 'look', 'heart'];
export const TIME_BONUS = 2;
export const LOOK = 1.5;

export type KindId = 'classic' | 'shapes' | 'shift' | 'decoys' | 'flicker' | 'quick';
export const KINDS: readonly (Kind & { id: KindId })[] = [
  { id: 'classic', weight: 1.2 },
  { id: 'shapes' },
  { id: 'shift', min: 2 },
  { id: 'decoys', min: 2 },
  { id: 'flicker', min: 3 },
  { id: 'quick' },
];
/** Quick-look levels show the tiles for this share of the usual time. */
const QUICK = 0.65;

/** Tiles per side of the square grid. */
export const sideFor = (d: Difficulty) => byLevel(d, [4, 4, 5, 5, 6]);
/** Rounds to clear; each one lights one tile more than the last. */
export const roundsFor = (d: Difficulty) => byLevel(d, [4, 5, 5, 6, 6]);
/** Lit tiles in the first round. */
const startFor = (d: Difficulty) => byLevel(d, [3, 3, 4, 5, 6]);
/** Lit tiles in round `r` (1-based). */
export const tilesIn = (d: Difficulty, r: number) => startFor(d) + r - 1;
/** Seconds the tiles stay lit. */
export const showFor = (d: Difficulty) => byLevel(d, [1.6, 1.5, 1.5, 1.4, 1.4]);
/** Seconds on the clock to tap `k` tiles back once they go dark. */
const limitFor = (k: number) => 2 + 0.8 * k;
/** Golden tiles in round `r`: one from the second round on. */
const goldsIn = (r: number) => (r >= 2 ? 1 : 0);

type Phase = 'intro' | 'show' | 'move' | 'input' | 'good' | 'late' | 'done';

export interface State {
  d: Difficulty;
  kind: KindId;
  /** Tiles per side; tile `i` is at column `i % side`, row `floor(i / side)`. */
  side: number;
  /** Tiles cut out of the grid's shape (never lit, can't be tapped). */
  hole: boolean[];
  rounds: number;
  /** 1-based. */
  round: number;
  /** The lit tiles of every round (where they light up), its golden ones and decoys, dealt up front so the seed decides the whole level. */
  patterns: number[][];
  golds: number[][];
  decoys: number[][];
  /** Flicker rounds: the order the tiles light up in. */
  flicks: number[][];
  /** Sliding grids: the direction (0 up, 1 right, 2 down, 3 left) the board slides each round. */
  shifts: number[];
  /** This round: which tiles are lit (where they are now), golden, decoys, found, and tapped wrong. */
  lit: boolean[];
  gold: boolean[];
  decoy: boolean[];
  found: boolean[];
  miss: boolean[];
  /** Lit tiles still to find this round. */
  left: number;
  phase: Phase;
  /** Seconds into the current phase. */
  t: number;
  /** How long this round's tiles show. */
  show: number;
  /** This round's clock (seconds), once the tiles go dark. */
  limit: number;
  /** Seconds banked for the next round's clock, and the next round's longer look. */
  bank: number;
  look: number;
  /** Wrong taps this round. */
  slips: number;
  lives: number;
  /** Correct tiles in a row, the milestone reached, and the power the last tap unlocked. */
  streak: number;
  tier: number;
  unlocked: Power | null;
  score: number;
  /** Each finished round: true if every tile was found, false if its clock ran out. */
  cleared: boolean[];
  /** Bonuses of the last round cleared, for the game to show. */
  perfect: number;
  speed: number;
}

/** The tile one step over in direction `dir`, wrapping around the grid. */
export function slide(side: number, i: number, dir: number): number {
  const c = i % side;
  const r = Math.floor(i / side);
  const dc = dir === 1 ? 1 : dir === 3 ? -1 : 0;
  const dr = dir === 2 ? 1 : dir === 0 ? -1 : 0;
  return ((r + dr + side) % side) * side + ((c + dc + side) % side);
}

/** When tile `order` (its place in the round's pattern) is lit during a flicker show. */
export const flickAt = (order: number) => order * FLICK_GAP;

/** How long round `r`'s tiles show: longer for flicker rounds, and after a longer-look reward. */
function showLen(s: State, r: number) {
  const base =
    s.kind === 'flicker'
      ? Math.max(showFor(s.d), flickAt(s.patterns[r - 1].length - 1) + FLICK_ON)
      : showFor(s.d) * (s.kind === 'quick' ? QUICK : 1);
  return base * s.look;
}

/** Light round `r`'s pattern. */
function deal(s: State, r: number) {
  const n = s.side * s.side;
  s.round = r;
  const mark = (list: number[]) => {
    const a = new Array<boolean>(n).fill(false);
    for (const i of list) a[i] = true;
    return a;
  };
  s.lit = mark(s.patterns[r - 1]);
  s.gold = mark(s.golds[r - 1]);
  s.decoy = mark(s.decoys[r - 1]);
  s.found = new Array<boolean>(n).fill(false);
  s.miss = new Array<boolean>(n).fill(false);
  s.left = s.patterns[r - 1].length;
  s.limit = limitFor(s.left) + s.bank;
  s.bank = 0;
  s.show = showLen(s, r);
  s.look = 1;
  s.slips = 0;
  s.phase = 'intro';
  s.t = 0;
}

/** The grid's shape: whole for most kinds, a cut-corner octagon one size up for shaped ones. */
function shape(kind: KindId, side: number): boolean[] {
  const hole = new Array<boolean>(side * side).fill(false);
  if (kind !== 'shapes') return hole;
  const m = (side - 1) / 2;
  const cut = m + (side >= 6 ? 1 : 1.5);
  for (let i = 0; i < side * side; i++) if (Math.abs((i % side) - m) + Math.abs(Math.floor(i / side) - m) > cut) hole[i] = true;
  return hole;
}

export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const side = kind === 'shapes' ? sideFor(d) + 1 : sideFor(d);
  const rounds = roundsFor(d);
  const hole = shape(kind, side);
  const tiles = [...Array(side * side).keys()].filter((i) => !hole[i]);
  const patterns: number[][] = [];
  const golds: number[][] = [];
  const flicks: number[][] = [];
  const decoys: number[][] = [];
  const shifts: number[] = [];
  for (let r = 1; r <= rounds; r++) {
    const k = tilesIn(d, r);
    const extra = kind === 'decoys' ? Math.max(1, Math.floor(k / 3)) : 0;
    const pick = rng.shuffle([...tiles]).slice(0, k + extra);
    const lit = pick.slice(0, k);
    patterns.push([...lit].sort((a, b) => a - b));
    flicks.push(lit);
    decoys.push(pick.slice(k).sort((a, b) => a - b));
    golds.push(lit.slice(0, goldsIn(r)).sort((a, b) => a - b));
    shifts.push(kind === 'shift' ? rng.int(0, 3) : -1);
  }
  const s: State = {
    d,
    kind,
    side,
    hole,
    rounds,
    round: 1,
    patterns,
    golds,
    flicks,
    decoys,
    shifts,
    lit: [],
    gold: [],
    decoy: [],
    found: [],
    miss: [],
    left: 0,
    phase: 'intro',
    t: 0,
    show: 0,
    limit: 0,
    bank: 0,
    look: 1,
    slips: 0,
    lives: LIVES,
    streak: 0,
    tier: 0,
    unlocked: null,
    score: 0,
    cleared: [],
    perfect: 0,
    speed: 0,
  };
  deal(s, 1);
  return s;
}

/** Speed bonus for a round cleared with `left` seconds on its clock. */
const speedBonus = (left: number) => Math.floor(Math.max(0, left) * SPEED_POINTS);

/** Every tile of the level. */
export function tileCount(d: Difficulty): number {
  let n = 0;
  for (let r = 1; r <= roundsFor(d); r++) n += tilesIn(d, r);
  return n;
}

/**
 * Score of a run with no wrong tap that taps each tile `tap` seconds after the previous one (or the
 * tiles going dark), finding the usual golden tiles (one a round from the second).
 */
export function scoreAt(d: Difficulty, tap: number, perfectRounds = roundsFor(d)): number {
  let total = tileCount(d) * TILE_POINTS + perfectRounds * PERFECT_POINTS;
  for (let r = 1; r <= roundsFor(d); r++) {
    const k = tilesIn(d, r);
    const golds = goldsIn(r);
    total += speedBonus(limitFor(k) + golds * GOLD_S - k * tap) + golds * GOLD_POINTS;
  }
  return total;
}

/** Roughly how long a run takes, tapping a tile every `tap` seconds. */
export function runSeconds(d: Difficulty, tap = 0.7): number {
  let total = 0;
  for (let r = 1; r <= roundsFor(d); r++) total += INTRO_S + showFor(d) + tilesIn(d, r) * tap + GOOD_S;
  return total;
}

/** Seconds left on the round's clock (the full clock until the tiles go dark and the board settles). */
export function clockLeft(s: State): number {
  if (s.phase === 'input') return Math.max(0, s.limit - s.t);
  return s.phase === 'intro' || s.phase === 'show' || s.phase === 'move' ? s.limit : 0;
}

/** Turn on a streak power (also used by tests). */
export function grant(s: State, p: Power) {
  if (p === 'time') {
    if (s.phase === 'input' && s.left > 0) s.limit += TIME_BONUS;
    else s.bank += TIME_BONUS;
  } else if (p === 'look') s.look = LOOK;
  else if (s.lives < LIVES) s.lives++;
  else s.score += PERFECT_POINTS;
}

export type PressResult = '' | 'hit' | 'round' | 'win' | 'slip' | 'lose';

/** Tap tile `i` while the tiles are dark. Holes, tiles already found or already tapped wrong are ignored. */
export function press(s: State, i: number): PressResult {
  s.unlocked = null;
  if (s.phase !== 'input' || i < 0 || i >= s.lit.length || s.hole[i] || s.found[i] || s.miss[i]) return '';
  if (!s.lit[i]) {
    s.miss[i] = true;
    s.slips++;
    s.lives--;
    s.streak = s.tier = 0;
    if (s.lives > 0) return 'slip';
    s.phase = 'done';
    return 'lose';
  }
  s.found[i] = true;
  s.left--;
  s.score += TILE_POINTS;
  if (s.gold[i]) {
    s.score += GOLD_POINTS;
    s.limit += GOLD_S;
  }
  s.streak++;
  if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
    s.unlocked = POWERS[s.tier++];
    grant(s, s.unlocked);
  }
  if (s.left > 0) return 'hit';
  s.perfect = s.slips ? 0 : PERFECT_POINTS;
  s.speed = speedBonus(s.limit - s.t);
  s.score += s.perfect + s.speed;
  s.cleared.push(true);
  s.t = 0;
  if (s.round >= s.rounds) {
    s.phase = 'done';
    return 'win';
  }
  s.phase = 'good';
  return 'round';
}

export interface StepEvents {
  /** The phase changed (the tiles lit up, went dark, the board slid, a new round began…). */
  phase: boolean;
  /**
   * The clock ran out: 'late' costs a heart and moves on to the next round, 'lose' was the last heart,
   * 'win' was the last round (with a heart to spare).
   */
  late: '' | 'late' | 'lose' | 'win';
}

/** Slide the round's tiles over (the board moves one step, wrapping). */
function shiftTiles(s: State) {
  const dir = s.shifts[s.round - 1];
  const move = (a: boolean[]) => {
    const out = new Array<boolean>(a.length).fill(false);
    for (let i = 0; i < a.length; i++) if (a[i]) out[slide(s.side, i, dir)] = true;
    return out;
  };
  s.lit = move(s.lit);
  s.gold = move(s.gold);
}

/** Advance by `dt` seconds: the banner, the lit tiles, the slide, the round's clock and the pauses between rounds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { phase: false, late: '' };
  if (s.phase === 'done') return ev;
  s.t += dt;
  const to = (p: Phase) => {
    s.phase = p;
    s.t = 0;
    ev.phase = true;
  };
  switch (s.phase) {
    case 'intro':
      if (s.t >= INTRO_S) to('show');
      break;
    case 'show':
      if (s.t >= s.show) {
        if (s.shifts[s.round - 1] >= 0) to('move');
        else to('input');
      }
      break;
    case 'move':
      if (s.t >= MOVE_S) {
        shiftTiles(s);
        to('input');
      }
      break;
    case 'input':
      if (s.t >= s.limit) {
        s.lives--;
        s.streak = s.tier = 0;
        s.cleared.push(false);
        if (s.lives <= 0) {
          to('done');
          ev.late = 'lose';
        } else if (s.round >= s.rounds) {
          to('done');
          ev.late = 'win';
        } else {
          to('late');
          ev.late = 'late';
        }
      }
      break;
    case 'good':
      if (s.t >= GOOD_S) {
        deal(s, s.round + 1);
        ev.phase = true;
      }
      break;
    case 'late':
      if (s.t >= LATE_S) {
        deal(s, s.round + 1);
        ev.phase = true;
      }
      break;
  }
  return ev;
}
