import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Points per lit tile found, for a round without a wrong tap, and per second left on a round's clock. */
export const TILE_POINTS = 10;
export const PERFECT_POINTS = 50;
export const SPEED_POINTS = 10;
export const LIVES = 3;
/** The round banner before the tiles light up. */
export const INTRO_S = 0.7;
/** The cheer after a round, and the reveal of the missed tiles after the clock ran out. */
const GOOD_S = 0.8;
const LATE_S = 1.4;

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

type Phase = 'intro' | 'show' | 'input' | 'good' | 'late' | 'done';

export interface State {
  d: Difficulty;
  /** Tiles per side; tile `i` is at column `i % side`, row `floor(i / side)`. */
  side: number;
  rounds: number;
  /** 1-based. */
  round: number;
  /** The lit tiles of every round, dealt up front so the seed decides the whole level. */
  patterns: number[][];
  /** This round: which tiles were lit, found, and tapped wrong. */
  lit: boolean[];
  found: boolean[];
  miss: boolean[];
  /** Lit tiles still to find this round. */
  left: number;
  phase: Phase;
  /** Seconds into the current phase. */
  t: number;
  /** This round's clock (seconds), once the tiles go dark. */
  limit: number;
  /** Wrong taps this round. */
  slips: number;
  lives: number;
  score: number;
  /** Each finished round: true if every tile was found, false if its clock ran out. */
  cleared: boolean[];
  /** Bonuses of the last round cleared, for the game to show. */
  perfect: number;
  speed: number;
}

/** Light round `r`'s pattern. */
function deal(s: State, r: number) {
  const n = s.side * s.side;
  s.round = r;
  s.lit = new Array<boolean>(n).fill(false);
  s.found = new Array<boolean>(n).fill(false);
  s.miss = new Array<boolean>(n).fill(false);
  for (const i of s.patterns[r - 1]) s.lit[i] = true;
  s.left = s.patterns[r - 1].length;
  s.limit = limitFor(s.left);
  s.slips = 0;
  s.phase = 'intro';
  s.t = 0;
}

export function createLevel(d: Difficulty, rng: Rng): State {
  const side = sideFor(d);
  const rounds = roundsFor(d);
  const patterns = Array.from({ length: rounds }, (_, r) =>
    rng
      .shuffle([...Array(side * side).keys()])
      .slice(0, tilesIn(d, r + 1))
      .sort((a, b) => a - b),
  );
  const s: State = {
    d,
    side,
    rounds,
    round: 1,
    patterns,
    lit: [],
    found: [],
    miss: [],
    left: 0,
    phase: 'intro',
    t: 0,
    limit: 0,
    slips: 0,
    lives: LIVES,
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

/** Score of a run with no wrong tap that taps each tile `tap` seconds after the previous one (or the tiles going dark). */
export function scoreAt(d: Difficulty, tap: number, perfectRounds = roundsFor(d)): number {
  let total = tileCount(d) * TILE_POINTS + perfectRounds * PERFECT_POINTS;
  for (let r = 1; r <= roundsFor(d); r++) {
    const k = tilesIn(d, r);
    total += speedBonus(limitFor(k) - k * tap);
  }
  return total;
}

/** Roughly how long a run takes, tapping a tile every `tap` seconds. */
export function runSeconds(d: Difficulty, tap = 0.7): number {
  let total = 0;
  for (let r = 1; r <= roundsFor(d); r++) total += INTRO_S + showFor(d) + tilesIn(d, r) * tap + GOOD_S;
  return total;
}

/** Seconds left on the round's clock (the full clock until the tiles go dark). */
export function clockLeft(s: State): number {
  if (s.phase === 'input') return Math.max(0, s.limit - s.t);
  return s.phase === 'intro' || s.phase === 'show' ? s.limit : 0;
}

export type PressResult = '' | 'hit' | 'round' | 'win' | 'slip' | 'lose';

/** Tap tile `i` while the tiles are dark. Tiles already found or already tapped wrong are ignored. */
export function press(s: State, i: number): PressResult {
  if (s.phase !== 'input' || i < 0 || i >= s.lit.length || s.found[i] || s.miss[i]) return '';
  if (!s.lit[i]) {
    s.miss[i] = true;
    s.slips++;
    s.lives--;
    if (s.lives > 0) return 'slip';
    s.phase = 'done';
    return 'lose';
  }
  s.found[i] = true;
  s.left--;
  s.score += TILE_POINTS;
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
  /** The phase changed (the tiles lit up, went dark, a new round began…). */
  phase: boolean;
  /**
   * The clock ran out: 'late' costs a heart and moves on to the next round, 'lose' was the last heart,
   * 'win' was the last round (with a heart to spare).
   */
  late: '' | 'late' | 'lose' | 'win';
}

/** Advance by `dt` seconds: the banner, the lit tiles, the round's clock and the pauses between rounds. */
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
      if (s.t >= showFor(s.d)) to('input');
      break;
    case 'input':
      if (s.t >= s.limit) {
        s.lives--;
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
