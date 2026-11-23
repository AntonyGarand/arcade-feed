import { getProfile } from '../../core/store';

/**
 * Tiny 8-bit sound effects, synthesised on the fly with Web Audio (no files to load, so they work offline
 * and cost nothing): square and triangle voices with pitch sweeps, and a noise channel, like an old home
 * console. Also a short vibration for impacts on phones that have one.
 *
 * Games call `sfx('pop')` at the moment something happens (from `frame()` or an input handler). The card
 * already plays the start, lost-life, win and lose sounds, so games don't repeat those. Everything is a
 * no-op when sound is off in Settings, before the first tap (browsers keep audio locked until then), in
 * a hidden tab, and in tests.
 */
export type Sfx =
  /** A light UI tick: aim nudges, cursor steps, selecting. */
  | 'tick'
  /** Something small collected or matched: a coin, a seed, a gem. */
  | 'coin'
  /** A pop: a bubble, a match cleared, a fruit sliced. */
  | 'pop'
  /** A solid knock: ball on paddle or wall, bumper, block landing. */
  | 'hit'
  /** A springy bounce or jump. */
  | 'jump'
  /** A shot fired: a stone, a marble, an arrow, a laser. */
  | 'shoot'
  /** A rope or blade cut, a swipe. */
  | 'cut'
  /** An explosion or a heavy crash. */
  | 'boom'
  /** A power-up or a big bonus: a multiplier lit, a power berry, a spring. */
  | 'power'
  /** Liquid: water flowing in, a splash. */
  | 'splash'
  /** A refused move: blocked, out of shots, a wrong tap. */
  | 'error'
  /** A flipper or a lever snapping. */
  | 'flip'
  /** A combo or chain step: pass `step` so each one rings higher. */
  | 'combo'
  /** The run starts (played by the card). */
  | 'start'
  /** A life lost (played by the card). */
  | 'hurt'
  /** The level is cleared (played by the card). */
  | 'win'
  /** The run is over (played by the card). */
  | 'lose';

type Wave = 'square' | 'triangle' | 'sawtooth' | 'noise';
/** One voice of a sound: a tone (or noise) sweeping from f0 to f1 Hz over `d` seconds, `t` seconds in. */
interface Voice {
  w: Wave;
  f0: number;
  f1?: number;
  d: number;
  t?: number;
  v?: number;
}

const NOTE = (n: number) => 440 * 2 ** ((n - 69) / 12);

const BANK: Record<Sfx, Voice[]> = {
  tick: [{ w: 'square', f0: 1800, d: 0.025, v: 0.25 }],
  coin: [
    { w: 'square', f0: NOTE(83), d: 0.06, v: 0.45 },
    { w: 'square', f0: NOTE(88), d: 0.14, t: 0.06, v: 0.45 },
  ],
  pop: [{ w: 'square', f0: 380, f1: 1100, d: 0.07, v: 0.5 }],
  hit: [
    { w: 'triangle', f0: 320, f1: 140, d: 0.08, v: 0.9 },
    { w: 'noise', f0: 2500, d: 0.03, v: 0.35 },
  ],
  jump: [{ w: 'square', f0: 260, f1: 720, d: 0.14, v: 0.4 }],
  shoot: [
    { w: 'square', f0: 1100, f1: 260, d: 0.12, v: 0.35 },
    { w: 'noise', f0: 5000, d: 0.04, v: 0.25 },
  ],
  cut: [{ w: 'noise', f0: 6000, f1: 2500, d: 0.09, v: 0.55 }],
  boom: [
    { w: 'noise', f0: 900, f1: 120, d: 0.45, v: 1 },
    { w: 'triangle', f0: 110, f1: 40, d: 0.35, v: 0.9 },
  ],
  power: [0, 4, 7, 12, 16].map((n, i) => ({ w: 'square' as const, f0: NOTE(72 + n), d: 0.06, t: i * 0.05, v: 0.35 })),
  splash: [{ w: 'noise', f0: 1400, f1: 500, d: 0.22, v: 0.5 }],
  error: [{ w: 'square', f0: 150, f1: 110, d: 0.14, v: 0.4 }],
  flip: [
    { w: 'noise', f0: 3500, d: 0.025, v: 0.4 },
    { w: 'triangle', f0: 500, f1: 260, d: 0.05, v: 0.6 },
  ],
  combo: [{ w: 'square', f0: NOTE(76), d: 0.09, v: 0.4 }],
  start: [
    { w: 'square', f0: NOTE(72), d: 0.07, v: 0.35 },
    { w: 'square', f0: NOTE(79), d: 0.12, t: 0.07, v: 0.35 },
  ],
  hurt: [
    { w: 'square', f0: 520, f1: 90, d: 0.3, v: 0.5 },
    { w: 'noise', f0: 1200, f1: 300, d: 0.2, v: 0.4 },
  ],
  win: [
    ...[0, 4, 7, 12].map((n, i) => ({ w: 'square' as const, f0: NOTE(72 + n), d: 0.09, t: i * 0.09, v: 0.35 })),
    { w: 'square', f0: NOTE(91), d: 0.32, t: 0.38, v: 0.35 },
    { w: 'triangle', f0: NOTE(48), d: 0.5, t: 0.36, v: 0.7 },
  ],
  lose: [7, 3, 0, -5].map((n, i) => ({ w: 'triangle' as const, f0: NOTE(60 + n), f1: NOTE(59 + n), d: 0.16, t: i * 0.15, v: 0.8 })),
};

/** Shortest gap between two plays of the same sound: a burst of hits in one frame plays once. */
const GAP_S = 0.035;
const MASTER = 0.18;

let ac: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
const last = new Map<string, number>();

const enabled = () => getProfile().sound !== false;

function audio(): AudioContext | null {
  if (ac) return ac;
  const Ctor = globalThis.AudioContext as typeof AudioContext | undefined;
  if (!Ctor) return null;
  try {
    ac = new Ctor();
  } catch {
    return null;
  }
  out = ac.createGain();
  out.gain.value = MASTER;
  out.connect(ac.destination);
  const n = ac.sampleRate * 0.5;
  noise = ac.createBuffer(1, n, ac.sampleRate);
  const data = noise.getChannelData(0);
  // A fixed LFSR, like the consoles' noise channel: no Math.random, same hiss every time.
  let r = 0x7ace;
  for (let i = 0; i < n; i++) {
    r ^= r << 7;
    r ^= r >> 9;
    r ^= r << 8;
    r &= 0xffff;
    data[i] = (r / 0x8000 - 1) * 0.9;
  }
  return ac;
}

// Browsers only let audio start from a user gesture: open (or wake) the context on the first one.
if (typeof window !== 'undefined' && typeof globalThis.AudioContext !== 'undefined') {
  const unlock = () => {
    if (!enabled()) return;
    const a = audio();
    if (a && a.state === 'suspended') void a.resume();
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });
}

function voice(a: AudioContext, dest: AudioNode, v: Voice, at: number, rate: number, vol: number) {
  const start = at + (v.t ?? 0);
  const end = start + v.d;
  const g = a.createGain();
  const peak = (v.v ?? 0.5) * vol;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  g.connect(dest);
  if (v.w === 'noise') {
    const src = a.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(v.f0 * rate, start);
    if (v.f1) f.frequency.exponentialRampToValueAtTime(v.f1 * rate, end);
    src.connect(f).connect(g);
    src.start(start);
    src.stop(end + 0.02);
    return;
  }
  const o = a.createOscillator();
  o.type = v.w;
  o.frequency.setValueAtTime(v.f0 * rate, start);
  if (v.f1) o.frequency.exponentialRampToValueAtTime(v.f1 * rate, end);
  o.connect(g);
  o.start(start);
  o.stop(end + 0.02);
}

export interface SfxOptions {
  /** Pitch shift in semitones (a rising combo, a bigger or smaller object). */
  pitch?: number;
  /** For `combo`: the step in the chain (1, 2, 3…), each a note higher on a major scale. */
  step?: number;
  /** Volume multiplier, 0–1 (default 1). */
  vol?: number;
}

const SCALE = [0, 2, 4, 5, 7, 9, 11];

/** Play a sound effect now. */
export function sfx(name: Sfx, o: SfxOptions = {}) {
  if (!enabled() || (typeof document !== 'undefined' && document.hidden)) return;
  const a = audio();
  if (!a || !out || a.state !== 'running') return;
  const key = `${name}:${o.step ?? 0}`;
  const now = a.currentTime;
  if (now - (last.get(key) ?? -1) < GAP_S) return;
  last.set(key, now);
  let semis = o.pitch ?? 0;
  if (o.step != null) {
    const s = Math.max(0, o.step - 1);
    semis += 12 * Math.floor(s / 7) + SCALE[s % 7];
  }
  const rate = 2 ** (semis / 12);
  for (const v of BANK[name]) voice(a, out, v, now + 0.005, rate, o.vol ?? 1);
}

/** A short vibration (milliseconds, or an on/off pattern), for impacts. Does nothing on devices without one. */
export function haptic(ms: number | number[]) {
  if (getProfile().haptics === false || (typeof document !== 'undefined' && document.hidden)) return;
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav && typeof nav.vibrate === 'function') nav.vibrate(ms);
}

/** Whether this device can vibrate (Settings shows the toggle only then). */
export const canVibrate = () => typeof globalThis.navigator?.vibrate === 'function';
