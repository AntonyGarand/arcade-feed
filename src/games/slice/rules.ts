import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

export const W = 300;
export const H = 400;
export const LIVES = 3;
export const FRUIT_POINTS = 10;
export const TOUGH_POINTS = 30;
/** Extra points for each fruit after the first in one stroke. */
export const COMBO_POINTS = 10;
export const LIFE_BONUS = 50;
/** First throw, after a short breath. */
const FIRST_S = 1;
/** Blade speed (world units per second) a swipe needs to cut; it stays sharp HOT_S after the last fast move. */
const MIN_SPEED = 200;
const HOT_S = 0.15;
/** The blade cuts a little outside a fruit's outline (fingers are wide). */
const BLADE_PAD = 4;
/** Cuts more than this apart start a new combo. */
const COMBO_S = 0.35;
/** A tough fruit's second cut must come this long after the first. */
const RECUT_S = 0.12;
/** Keyboard blade speed. */
const KEY_SPEED = 460;
/** Pending blade segments kept between frames, at most. */
const MAX_SEGS = 64;

/** Fruits thrown in a run. */
export const fruitsFor = (d: Difficulty) => byLevel(d, [14, 20, 26, 32, 40]);
/** Of those, fruits with a hard rind that need two cuts. */
export const toughFor = (d: Difficulty) => byLevel(d, [0, 0, 3, 5, 7]);
/** Fruit radius. */
const radiusFor = (d: Difficulty) => byLevel(d, [24, 22, 20, 18, 16]);
/** Gravity: higher levels throw faster arcs. */
const gravityFor = (d: Difficulty) => byLevel(d, [400, 430, 470, 510, 550]);
/** Fruits per wave. */
const waveFor = (d: Difficulty) =>
  byLevel(d, [
    [1, 2],
    [1, 3],
    [2, 3],
    [2, 4],
    [2, 5],
  ] as const);
/** Seconds between waves. */
const gapFor = (d: Difficulty) =>
  byLevel(d, [
    [2.4, 3],
    [2.1, 2.6],
    [1.9, 2.4],
    [1.7, 2.2],
    [1.5, 2],
  ] as const);
/** Chance a wave brings a bomb (from the second wave on). */
const bombFor = (d: Difficulty) => byLevel(d, [0, 0.3, 0.45, 0.55, 0.65]);
/** Chance a wave comes as a salvo (one after the other) rather than a volley. */
const salvoFor = (d: Difficulty) => byLevel(d, [0.15, 0.25, 0.35, 0.4, 0.5]);
/** On Master a bomb ends the run; below, it costs a life. */
const bombEnds = (d: Difficulty) => d === 5;

type Kind = 'fruit' | 'tough' | 'bomb';

interface Throw {
  t: number;
  kind: Kind;
  /** Palette colour and glyph (they pair). */
  k: number;
  x: number;
  vx: number;
  vy: number;
  spin: number;
}

export interface Piece extends Throw {
  y: number;
  r: number;
  rot: number;
  /** Cuts left (2 for a tough fruit). */
  hp: number;
  /** Time of the last cut (-1 = none). */
  hitAt: number;
}

interface Cut {
  p: Piece;
  /** Direction of the blade (radians). */
  angle: number;
  points: number;
  /** Fruits in this stroke so far (2+ is a combo). */
  chain: number;
}

export interface State {
  d: Difficulty;
  r: number;
  g: number;
  schedule: Throw[];
  next: number;
  live: Piece[];
  time: number;
  lives: number;
  score: number;
  /** Fruits sliced (and fruits thrown in all). */
  sliced: number;
  total: number;
  bestChain: number;
  chain: number;
  chainT: number;
  /** Blade position and whether it is pressed. */
  bx: number;
  by: number;
  down: boolean;
  /** Seconds the blade stays sharp. */
  hot: number;
  /** Blade travel since the last step, and its segments (ax, ay, bx, by…). */
  travel: number;
  segs: number[];
  /** Keyboard direction held. */
  kx: number;
  ky: number;
  done: boolean;
}

/** Colours / glyphs for fruit: every palette slot but the accent's (p6) and p8 (tough fruit). */
const FRUIT_K = [0, 1, 2, 3, 4, 6] as const;
const TOUGH_K = 7;

/** Deal the whole run of throws from the seed (they don't depend on how you play). */
export function createLevel(d: Difficulty, rng: Rng): State {
  const r = radiusFor(d);
  const g = gravityFor(d);
  const total = fruitsFor(d);
  const [wLo, wHi] = waveFor(d);
  const [gLo, gHi] = gapFor(d);
  // Which fruit get the hard rind (never the first few).
  const order = [...Array(total).keys()].slice(3);
  const tough = new Set(rng.shuffle(order).slice(0, toughFor(d)));
  const schedule: Throw[] = [];
  /** A throw from x0 that peaks at apexY and lands at x1, with the bottom edge as both ends. */
  const toss = (t: number, kind: Kind, k: number, x0: number, x1: number, apexY: number): Throw => {
    const rise = H + r - apexY;
    const up = Math.sqrt((2 * rise) / g);
    return { t, kind, k, x: x0, vx: (x1 - x0) / (2 * up), vy: -g * up, spin: (rng.next() - 0.5) * 6 };
  };
  let t = FIRST_S;
  let made = 0;
  for (let wave = 0; made < total; wave++) {
    // A calm opening: one high, slow fruit first.
    const size = wave === 0 ? 1 : Math.min(total - made, rng.int(wLo, wHi));
    const salvo = size > 1 && rng.chance(salvoFor(d));
    const apexes: number[] = [];
    for (let i = 0; i < size; i++) {
      const x0 = rng.int(40, W - 40);
      const x1 = rng.int(30, W - 30);
      const apexY = wave === 0 ? rng.int(70, 100) : rng.int(60, 170);
      const kind: Kind = tough.has(made) ? 'tough' : 'fruit';
      schedule.push(toss(t + (salvo ? i * 0.3 : rng.next() * 0.15), kind, kind === 'tough' ? TOUGH_K : rng.pick(FRUIT_K), x0, x1, apexY));
      apexes.push((x0 + x1) / 2);
      made++;
    }
    const bombs = wave > 0 && rng.chance(bombFor(d)) ? (d === 5 && rng.chance(0.3) ? 2 : 1) : 0;
    for (let b = 0; b < bombs; b++) {
      // Keep the bomb's path apart from this wave's fruit.
      let x0 = 0;
      let x1 = 0;
      for (let tries = 0; tries < 12; tries++) {
        x0 = rng.int(40, W - 40);
        x1 = rng.int(30, W - 30);
        if (apexes.every((a) => Math.abs(a - (x0 + x1) / 2) > 3 * r)) break;
      }
      apexes.push((x0 + x1) / 2);
      schedule.push(toss(t + 0.1 + rng.next() * 0.3, 'bomb', 0, x0, x1, rng.int(60, 170)));
    }
    t += gLo + rng.next() * (gHi - gLo);
  }
  schedule.sort((a, b) => a.t - b.t);
  return {
    d,
    r,
    g,
    schedule,
    next: 0,
    live: [],
    time: 0,
    lives: LIVES,
    score: 0,
    sliced: 0,
    total,
    bestChain: 0,
    chain: 0,
    chainT: 0,
    bx: W / 2,
    by: H / 2,
    down: false,
    hot: 0,
    travel: 0,
    segs: [],
    kx: 0,
    ky: 0,
    done: false,
  };
}

/** Fruits not thrown yet. */
export const toCome = (s: State) => s.schedule.slice(s.next).filter((z) => z.kind !== 'bomb').length;

/** Press the blade at (x, y): a new stroke. */
export function press(s: State, x: number, y: number) {
  s.bx = x;
  s.by = y;
  s.down = true;
  s.chain = 0;
}

/** Move the blade to (x, y); while pressed, the motion is a cut (if it is fast enough by the next step). */
export function drag(s: State, x: number, y: number) {
  if (s.down) {
    s.travel += Math.hypot(x - s.bx, y - s.by);
    if (s.segs.length < MAX_SEGS * 4) s.segs.push(s.bx, s.by, x, y);
  }
  s.bx = x;
  s.by = y;
}

export function release(s: State) {
  s.down = false;
  s.chain = 0;
}

/** Does the segment (ax, ay)–(bx, by) pass within `r` of (cx, cy)? */
export function crosses(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / l2)) : 0;
  return (ax + dx * k - cx) ** 2 + (ay + dy * k - cy) ** 2 <= r * r;
}

interface StepEvents {
  cuts: Cut[];
  /** Tough fruit that took their first cut. */
  cracked: Piece[];
  /** Bombs the blade touched. */
  booms: Piece[];
  /** Fruit that fell off the bottom uncut. */
  missed: Piece[];
  thrown: number;
  won: boolean;
  over: boolean;
}

function lose(s: State, ev: StepEvents, n: number) {
  s.lives = Math.max(0, s.lives - n);
  s.chain = 0;
  if (s.lives === 0) {
    s.done = true;
    ev.over = true;
  }
}

/** Advance by `dt` seconds: blade cuts, throws, flight, misses. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { cuts: [], cracked: [], booms: [], missed: [], thrown: 0, won: false, over: false };
  if (s.done) return ev;
  s.time += dt;
  if (s.kx || s.ky) {
    const n = Math.hypot(s.kx, s.ky);
    drag(s, Math.max(0, Math.min(W, s.bx + (s.kx / n) * KEY_SPEED * dt)), Math.max(0, Math.min(H, s.by + (s.ky / n) * KEY_SPEED * dt)));
  }
  if (dt > 0 && s.travel / dt >= MIN_SPEED) s.hot = HOT_S;
  else s.hot = Math.max(0, s.hot - dt);
  s.chainT = Math.max(0, s.chainT - dt);
  if (s.hot > 0) {
    for (let i = 0; i < s.segs.length && !s.done; i += 4) {
      const [ax, ay, bx, by] = s.segs.slice(i, i + 4);
      for (const p of s.live) {
        if (p.hp <= 0 || !crosses(ax, ay, bx, by, p.x, p.y, p.r + BLADE_PAD)) continue;
        if (p.kind === 'bomb') {
          p.hp = 0;
          ev.booms.push(p);
          lose(s, ev, bombEnds(s.d) ? LIVES : 1);
          if (s.done) break;
          continue;
        }
        if (p.hitAt >= 0 && s.time - p.hitAt < RECUT_S) continue;
        p.hitAt = s.time;
        if (--p.hp > 0) {
          // The rind cracks and the fruit gets knocked up a little.
          p.vy = Math.min(p.vy, 0) - 60;
          ev.cracked.push(p);
          continue;
        }
        s.chain = s.chainT > 0 ? s.chain + 1 : 1;
        s.chainT = COMBO_S;
        s.bestChain = Math.max(s.bestChain, s.chain);
        const points = (p.kind === 'tough' ? TOUGH_POINTS : FRUIT_POINTS) + COMBO_POINTS * (s.chain - 1);
        s.score += points;
        s.sliced++;
        ev.cuts.push({ p, angle: Math.atan2(by - ay, bx - ax), points, chain: s.chain });
      }
    }
  }
  s.segs.length = 0;
  s.travel = 0;
  if (s.done) return ev;

  while (s.next < s.schedule.length && s.schedule[s.next].t <= s.time) {
    const z = s.schedule[s.next++];
    s.live.push({ ...z, y: H + s.r, r: z.kind === 'bomb' ? s.r * 0.9 : s.r, rot: 0, hp: z.kind === 'tough' ? 2 : 1, hitAt: -1 });
    ev.thrown++;
  }
  for (const p of s.live) {
    p.vy += s.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
  }
  const gone = (p: Piece) => p.hp <= 0 || (p.vy > 0 && p.y - p.r > H);
  for (const p of s.live) if (p.hp > 0 && p.kind !== 'bomb' && gone(p)) ev.missed.push(p);
  s.live = s.live.filter((p) => !gone(p));
  if (ev.missed.length) lose(s, ev, ev.missed.length);
  if (!s.done && s.next >= s.schedule.length && !s.live.length) {
    s.done = true;
    s.score += s.lives * LIFE_BONUS;
    ev.won = true;
  }
  return ev;
}
