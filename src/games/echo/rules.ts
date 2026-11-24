import { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Points per new correct tap, per round cleared (× the round number), and for a round with no slip. */
export const TAP_POINTS = 10;
export const ROUND_POINTS = 20;
export const PERFECT_POINTS = 30;
/** Points for the first right tap on a golden step (never doubled), and a combo heart when you're full. */
export const GOLD_POINTS = 25;
const HEART_POINTS = 60;
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
/** Rush rounds: each playback is this much faster than the one before, down to RUSH_MIN of the beat. */
const RUSH = 0.9;
const RUSH_MIN = 0.6;
/** Slow replay (a combo reward): the beat stretches by this much. */
const SLOW = 1.4;

/** Right taps in a row that fire a combo event, and what each one unlocks. */
export const COMBO_TIERS = [6, 12, 20, 30, 42] as const;
export type Power = 'shield' | 'double' | 'hint' | 'slow' | 'heart';
const TIER_POWERS: readonly Power[] = ['shield', 'double', 'hint', 'slow', 'heart'];

/** The kinds of level: a plain ring, quickening playback, a bigger ring, answering backwards, pads that move, decoy flashes. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'rush' },
  { id: 'wide', max: 4 },
  { id: 'reverse', min: 2 },
  { id: 'swap', min: 2 },
  { id: 'tricks', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Pads on the ring. */
export const padsFor = (d: Difficulty) => byLevel(d, [4, 4, 5, 6, 8]);
/** Rounds to clear (the sequence grows by one each round). */
export const roundsFor = (d: Difficulty) => byLevel(d, [5, 6, 6, 7, 8]);
/** Sequence length in the first round. */
const startFor = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 3]);
export const livesFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 3, 2]);
/** Seconds per step of the playback. */
export const beatFor = (d: Difficulty) => byLevel(d, [0.62, 0.54, 0.47, 0.41, 0.36]);
/** Golden steps in the sequence. */
const goldFor = (d: Difficulty) => byLevel(d, [2, 2, 3, 3, 3]);
/** Decoy flashes per playback on a tricks level (from the second round). */
const fakesFor = (d: Difficulty) => byLevel(d, [1, 1, 1, 1, 2]);

type Phase = 'intro' | 'show' | 'input' | 'good' | 'bad' | 'done';

/** One beat of a playback: a pad, and whether it's a decoy flash (not part of the sequence). */
export interface Beat {
  pad: number;
  fake: boolean;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  n: number;
  /** The whole sequence; round r plays its first `lenOf(s)` pads. */
  seq: number[];
  rounds: number;
  /** 1-based. */
  round: number;
  phase: Phase;
  /** Seconds into the current phase. */
  t: number;
  /** The level's base beat (see `beatOf` for the one playing now). */
  beat: number;
  /** Taps right so far this attempt, and the most ever this round (only new ground scores). */
  pos: number;
  reached: number;
  slips: number;
  lives: number;
  maxLives: number;
  score: number;
  /** Last slip: the pad you should have tapped (-1 for a timeout) and the one you did. */
  want: number;
  got: number;
  /** Ring slot of each pad (pads trade places on a swap level). */
  slot: number[];
  /** Per round (index r - 1): the pairs of pads that trade places once it's cleared. */
  swaps: [number, number][][];
  /** Per round: decoy flashes as [after this many real steps, pad]. */
  fakes: [number, number][][];
  /** Sequence steps that are golden, and whether each one was collected. */
  gold: number[];
  goldGot: boolean[];
  /** Right taps in a row, and the highest milestone reached by this combo. */
  combo: number;
  tier: number;
  /** A combo milestone reached by the last tap (1-based) and what it unlocked; 0 / '' for none. */
  fired: number;
  unlocked: Power | '';
  /** Combo rewards: a shield that absorbs one wrong tap, rounds of double points and of hints, slow playbacks left. */
  shield: boolean;
  dbl: number;
  hint: number;
  slow: number;
}

/** Length of the sequence this round. */
export const lenOf = (s: State) => startFor(s.d) + s.round - 1;

/** Deal the sequence: no pad three times in a row; plus the level's twists (swaps, decoys, golden steps). */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const n = kind === 'wide' ? Math.min(8, padsFor(d) + 2) : padsFor(d);
  const rounds = roundsFor(d);
  const total = startFor(d) + rounds - 1;
  const seq: number[] = [];
  while (seq.length < total) {
    const k = rng.int(0, n - 1);
    if (seq.length >= 2 && seq.at(-1) === k && seq.at(-2) === k) continue;
    seq.push(k);
  }
  const swaps: [number, number][][] = [];
  const fakes: [number, number][][] = [];
  for (let r = 1; r <= rounds; r++) {
    const pairs: [number, number][] = [];
    if (kind === 'swap' && r < rounds) {
      const order = rng.shuffle(Array.from({ length: n }, (_, k) => k));
      for (let i = 0; i < (d >= 4 ? 2 : 1); i++) pairs.push([order[2 * i], order[2 * i + 1]]);
    }
    swaps.push(pairs);
    const flashes: [number, number][] = [];
    const len = startFor(d) + r - 1;
    if (kind === 'tricks' && r >= 2)
      for (let i = 0; i < fakesFor(d); i++) {
        const after = rng.int(1, len - 1);
        // A decoy never repeats the pads around it, so it can't pass for a doubled step.
        let pad = rng.int(0, n - 1);
        for (let t = 0; t < 20 && (pad === seq[after - 1] || pad === seq[after]); t++) pad = rng.int(0, n - 1);
        if (!flashes.some(([a]) => a === after)) flashes.push([after, pad]);
      }
    fakes.push(flashes.sort((a, b) => a[0] - b[0]));
  }
  const gold = rng
    .shuffle(Array.from({ length: total - 1 }, (_, i) => i + 1))
    .slice(0, goldFor(d))
    .sort((a, b) => a - b);
  const beat = beatFor(d) * (kind === 'wide' ? 1.08 : 1);
  return {
    d,
    kind,
    n,
    seq,
    rounds,
    round: 1,
    phase: 'intro',
    t: 0,
    beat,
    pos: 0,
    reached: 0,
    slips: 0,
    lives: livesFor(d),
    maxLives: livesFor(d),
    score: 0,
    want: -1,
    got: -1,
    slot: Array.from({ length: n }, (_, k) => k),
    swaps,
    fakes,
    gold,
    goldGot: gold.map(() => false),
    combo: 0,
    tier: 0,
    fired: 0,
    unlocked: '',
    shield: false,
    dbl: 0,
    hint: 0,
    slow: 0,
  };
}

/** Seconds per beat of the playback right now (rush rounds quicken, a slow replay stretches it). */
export function beatOf(s: State): number {
  const rush = s.kind === 'rush' ? Math.max(RUSH_MIN, RUSH ** (s.round - 1)) : 1;
  return s.beat * rush * (s.slow > 0 ? SLOW : 1);
}

/** This round's playback: the steps in order, with any decoy flashes slipped in. */
export function playback(s: State): Beat[] {
  const out: Beat[] = [];
  const fakes = s.fakes[s.round - 1] ?? [];
  let f = 0;
  for (let i = 0; i < lenOf(s); i++) {
    while (f < fakes.length && fakes[f][0] === i) out.push({ pad: fakes[f++][1], fake: true });
    out.push({ pad: s.seq[i], fake: false });
  }
  return out;
}

/** Index of the beat playing now (-1 outside a playback). */
export function beatIndex(s: State): number {
  return s.phase === 'show' ? Math.floor(s.t / beatOf(s)) : -1;
}

function litBeat(s: State): Beat | null {
  const i = beatIndex(s);
  if (i < 0) return null;
  const all = playback(s);
  return i < all.length && s.t - i * beatOf(s) < beatOf(s) * LIT ? all[i] : null;
}

/** The pad lit by the playback right now (a real step), or -1. */
export function lit(s: State): number {
  const b = litBeat(s);
  return b && !b.fake ? b.pad : -1;
}

/** The pad flashing as a decoy right now, or -1. */
export function ghost(s: State): number {
  const b = litBeat(s);
  return b?.fake ? b.pad : -1;
}

/** Sequence index of the step to tap next (backwards on a reverse level). */
export const wantIndex = (s: State) => (s.kind === 'reverse' ? lenOf(s) - 1 - s.pos : s.pos);
/** The pad to tap next. */
export const wanted = (s: State) => s.seq[wantIndex(s)];
/** Points are doubled while a double reward runs. */
export const multOf = (s: State) => (s.dbl > 0 ? 2 : 1);

/** Best possible score at a level: every round without a slip, with the combo rewards a perfect run earns. */
export function maxScore(d: Difficulty): number {
  // The score of a perfect run doesn't depend on the seed or the kind: golden steps and hearts aren't doubled.
  const s = createLevel(d, new Rng(1), 'classic');
  for (let i = 0; i < 2000 && s.phase !== 'done'; i++) {
    if (s.phase === 'input') press(s, wanted(s));
    else step(s, 0.5);
  }
  return s.score;
}

/** Roughly how long a clean run takes, playing back and tapping each step in `tap` seconds. */
export function runSeconds(d: Difficulty, tap = 0.5): number {
  let total = INTRO_S;
  for (let r = 1; r <= roundsFor(d); r++) total += (startFor(d) + r - 1) * (beatFor(d) + tap) + TAIL_S + GOOD_S;
  return total;
}

export type PressResult = '' | 'ok' | 'round' | 'win' | 'slip' | 'lose' | 'shield';

function breakCombo(s: State) {
  s.combo = s.tier = 0;
}

function slip(s: State, want: number, got: number): PressResult {
  breakCombo(s);
  s.want = want;
  s.got = got;
  // A shield takes the hit: no heart lost, and you carry on from the same step.
  if (s.shield && got >= 0) {
    s.shield = false;
    s.t = 0;
    return 'shield';
  }
  s.lives--;
  s.slips++;
  s.pos = 0;
  s.t = 0;
  if (s.lives <= 0) {
    s.phase = 'done';
    return 'lose';
  }
  s.phase = 'bad';
  return 'slip';
}

/** Turn a combo reward on. */
function unlock(s: State, p: Power) {
  if (p === 'shield') s.shield = true;
  else if (p === 'double') s.dbl = 2;
  else if (p === 'hint') s.hint = 2;
  else if (p === 'slow') s.slow = 2;
  else if (s.lives < s.maxLives) s.lives++;
  else s.score += HEART_POINTS;
}

/** One more right tap in the combo; fires the milestone it reaches. */
function hitCombo(s: State) {
  s.combo++;
  if (s.tier < COMBO_TIERS.length && s.combo >= COMBO_TIERS[s.tier]) {
    s.fired = ++s.tier;
    s.unlocked = TIER_POWERS[s.tier - 1];
    unlock(s, s.unlocked);
  }
}

/** Tap pad `k` during your turn. */
export function press(s: State, k: number): PressResult {
  s.fired = 0;
  s.unlocked = '';
  if (s.phase !== 'input' || k < 0 || k >= s.n) return '';
  const idx = wantIndex(s);
  const want = s.seq[idx];
  if (k !== want) return slip(s, want, k);
  s.pos++;
  s.t = 0;
  hitCombo(s);
  if (s.pos > s.reached) {
    s.reached = s.pos;
    s.score += TAP_POINTS * multOf(s);
  }
  const g = s.gold.indexOf(idx);
  if (g >= 0 && !s.goldGot[g]) {
    s.goldGot[g] = true;
    s.score += GOLD_POINTS;
  }
  if (s.pos < lenOf(s)) return 'ok';
  s.score += (s.round * ROUND_POINTS + (s.slips ? 0 : PERFECT_POINTS)) * multOf(s);
  s.dbl = Math.max(0, s.dbl - 1);
  s.hint = Math.max(0, s.hint - 1);
  for (const [a, b] of s.swaps[s.round - 1] ?? []) [s.slot[a], s.slot[b]] = [s.slot[b], s.slot[a]];
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
      if (s.t >= playback(s).length * beatOf(s) + TAIL_S) {
        s.slow = Math.max(0, s.slow - 1);
        to('input');
      }
      break;
    case 'input':
      if (s.t >= IDLE_S) {
        ev.timeout = slip(s, wanted(s), -1);
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
