import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Points per new correct tap, per round cleared (× the round number), and for a round with no slip. */
export const TAP_POINTS = 10;
export const ROUND_POINTS = 20;
export const PERFECT_POINTS = 30;
/** Pause before the first playback. */
const INTRO_S = 0.8;
/** Pause after the playback before your turn, then the cheer after a round and the buzz after a slip. */
const TAIL_S = 0.15;
const GOOD_S = 0.7;
const BAD_S = 1;
/** Seconds of no tap during your turn that count as a slip. */
export const IDLE_S = 8;
/** Share of each beat a pad stays lit while playing the sequence back. */
const LIT = 0.68;

/** Pads on the ring. */
export const padsFor = (d: Difficulty) => byLevel(d, [4, 4, 5, 6, 8]);
/** Rounds to clear (the sequence grows by one each round). */
export const roundsFor = (d: Difficulty) => byLevel(d, [5, 6, 6, 7, 8]);
/** Sequence length in the first round. */
const startFor = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 3]);
export const livesFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 3, 2]);
/** Seconds per step of the playback. */
export const beatFor = (d: Difficulty) => byLevel(d, [0.62, 0.54, 0.47, 0.41, 0.36]);

type Phase = 'intro' | 'show' | 'input' | 'good' | 'bad' | 'done';

export interface State {
  d: Difficulty;
  n: number;
  /** The whole sequence; round r plays its first `lenOf(s)` pads. */
  seq: number[];
  rounds: number;
  /** 1-based. */
  round: number;
  phase: Phase;
  /** Seconds into the current phase. */
  t: number;
  beat: number;
  /** Taps right so far this attempt, and the most ever this round (only new ground scores). */
  pos: number;
  reached: number;
  slips: number;
  lives: number;
  score: number;
  /** Last slip: the pad you should have tapped (-1 for a timeout) and the one you did. */
  want: number;
  got: number;
}

/** Length of the sequence this round. */
export const lenOf = (s: State) => startFor(s.d) + s.round - 1;

/** Deal the sequence: no pad three times in a row. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const n = padsFor(d);
  const rounds = roundsFor(d);
  const seq: number[] = [];
  while (seq.length < startFor(d) + rounds - 1) {
    const k = rng.int(0, n - 1);
    if (seq.length >= 2 && seq.at(-1) === k && seq.at(-2) === k) continue;
    seq.push(k);
  }
  return {
    d,
    n,
    seq,
    rounds,
    round: 1,
    phase: 'intro',
    t: 0,
    beat: beatFor(d),
    pos: 0,
    reached: 0,
    slips: 0,
    lives: livesFor(d),
    score: 0,
    want: -1,
    got: -1,
  };
}

/** Best possible score at a level (every round without a slip). */
export function maxScore(d: Difficulty): number {
  let total = 0;
  for (let r = 1; r <= roundsFor(d); r++) total += (startFor(d) + r - 1) * TAP_POINTS + r * ROUND_POINTS + PERFECT_POINTS;
  return total;
}

/** Roughly how long a clean run takes, playing back and tapping each step in `tap` seconds. */
export function runSeconds(d: Difficulty, tap = 0.5): number {
  let total = INTRO_S;
  for (let r = 1; r <= roundsFor(d); r++) total += (startFor(d) + r - 1) * (beatFor(d) + tap) + TAIL_S + GOOD_S;
  return total;
}

/** The pad lit by the playback right now, or -1. */
export function lit(s: State): number {
  if (s.phase !== 'show') return -1;
  const i = Math.floor(s.t / s.beat);
  return i < lenOf(s) && s.t - i * s.beat < s.beat * LIT ? s.seq[i] : -1;
}

export type PressResult = '' | 'ok' | 'round' | 'win' | 'slip' | 'lose';

function slip(s: State, want: number, got: number): PressResult {
  s.lives--;
  s.slips++;
  s.want = want;
  s.got = got;
  s.pos = 0;
  s.t = 0;
  if (s.lives <= 0) {
    s.phase = 'done';
    return 'lose';
  }
  s.phase = 'bad';
  return 'slip';
}

/** Tap pad `k` during your turn. */
export function press(s: State, k: number): PressResult {
  if (s.phase !== 'input' || k < 0 || k >= s.n) return '';
  const want = s.seq[s.pos];
  if (k !== want) return slip(s, want, k);
  s.pos++;
  s.t = 0;
  if (s.pos > s.reached) {
    s.reached = s.pos;
    s.score += TAP_POINTS;
  }
  if (s.pos < lenOf(s)) return 'ok';
  s.score += s.round * ROUND_POINTS + (s.slips ? 0 : PERFECT_POINTS);
  if (s.round >= s.rounds) {
    s.phase = 'done';
    return 'win';
  }
  s.phase = 'good';
  return 'round';
}

export interface StepEvents {
  /** The phase changed (playback started, your turn began…). */
  phase: boolean;
  /** You took too long and it counted as a slip ('slip' or 'lose'). */
  timeout: PressResult;
}

/** Advance by `dt` seconds: the playback, the pauses between rounds and the idle clock. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { phase: false, timeout: '' };
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
      if (s.t >= lenOf(s) * s.beat + TAIL_S) to('input');
      break;
    case 'input':
      if (s.t >= IDLE_S) {
        ev.timeout = slip(s, s.seq[s.pos], -1);
        ev.phase = true;
      }
      break;
    case 'good':
      if (s.t >= GOOD_S) {
        s.round++;
        s.pos = 0;
        s.reached = 0;
        s.slips = 0;
        to('show');
      }
      break;
    case 'bad':
      if (s.t >= BAD_S) to('show');
      break;
  }
  return ev;
}
