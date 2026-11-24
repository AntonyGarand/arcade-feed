import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units: side view, the archer on the left, targets to the right. */
export const W = 300;
export const H = 400;
export const GROUND = 356;
/** Where arrows leave the bow. */
export const BOW = { x: 40, y: 292 };
export const ARROW_LEN = 26;
const GRAVITY = 260;
const MIN_SPEED = 170;
const MAX_SPEED = 410;
/** Aim limits (radians above the horizon). */
export const MIN_ANGLE = -0.3;
export const MAX_ANGLE = 1.25;
/** Keyboard aim and draw speeds, per second. */
const TURN_SPEED = 0.7;
const PULL_SPEED = 0.55;
/** Seconds the result stays on screen before the next arrow. */
const SHOW_S = 1.1;
/** Ring scores, centre first; each ring is a fifth of the radius. */
export const RINGS = [10, 8, 6, 4, 2] as const;
/** Wind shown to the player in steps of this many units/s². */
export const WIND_STEP = 10;

export const arrowsFor = (d: Difficulty) => byLevel(d, [5, 6, 6, 7, 7]);
/** Points needed to clear: an average per arrow. */
export const goalFor = (d: Difficulty) => Math.round(arrowsFor(d) * byLevel(d, [5, 5, 5.5, 5, 5]));
const targetCount = (d: Difficulty) => byLevel(d, [1, 2, 2, 3, 3]);
const radiusFor = (d: Difficulty) => byLevel(d, [30, 26, 22, 18, 16]);
/** Nearest a target stands (they spread from here to the far end). */
const nearFor = (d: Difficulty) => byLevel(d, [140, 150, 160, 170, 180]);
const FAR = 280;
/** Wind range (units/s², either way). */
const windFor = (d: Difficulty) =>
  byLevel(d, [
    [0, 30],
    [20, 70],
    [35, 100],
    [50, 130],
    [60, 160],
  ] as const);
/** How far up and down moving targets bob (0 = still), and how many of them move. */
const bobFor = (d: Difficulty) => byLevel(d, [0, 0, 24, 32, 42]);
const movingCount = (d: Difficulty) => byLevel(d, [0, 0, 1, 2, 3]);
/** Seconds of flight the aim guide shows (gravity only, no wind). */
export const previewFor = (d: Difficulty) => byLevel(d, [0.42, 0.34, 0.27, 0.21, 0.16]);

/** The kinds of range a level can deal. */
export const KINDS = [
  { id: 'range', weight: 2 },
  { id: 'balloons' },
  { id: 'wall', min: 2 },
  { id: 'gusty', min: 2 },
  { id: 'carnival', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Good shots in a row (a ring worth at least this) build the streak. */
export const STREAK_MIN = 6;
/** Streak lengths that unlock a reward: a wind guide, then double points, then a bonus arrow. */
export const STREAK_TIERS = [2, 3, 5] as const;
export type Reward = 'guide' | 'double' | 'extra';
const REWARDS: readonly Reward[] = ['guide', 'double', 'extra'];
/** Most bonus arrows a level can give. */
const MAX_EXTRA = 1;
/** Points for popping a balloon on the way (doubled by the streak's double points). */
export const BALLOON_PTS = 2;
export const BALLOON_R = 9;
/** How much longer the streak's wind guide is than the plain guide. */
const GUIDE_X = 2.4;
/** Balloons rise from the ground up to here, then start over. */
const SKY_TOP = 60;

/** A balloon drifting up through the range: pop it on the way for bonus points. */
interface Balloon {
  x: number;
  /** Height at time 0; it rises `rise` units/s, wrapping from the top back to the ground. */
  y0: number;
  rise: number;
  /** Palette index. */
  c: number;
  popped: boolean;
}

/** A wooden palisade between the archer and the targets: arrows that hit it are lost. */
interface Wall {
  x: number;
  w: number;
  top: number;
}

/** Gusts: the wind swells and drops around its base on a slow wave. */
interface Gust {
  amp: number;
  freq: number;
  phase: number;
}

interface Target {
  x: number;
  /** Centre height at rest; it bobs `amp` units at `freq` rad/s from `phase`. */
  y: number;
  r: number;
  amp: number;
  freq: number;
  phase: number;
}

/** An arrow at rest: stuck in a target (moves with it) or in the ground. */
interface Stuck {
  /** Target index, or -1 for the ground (or the palisade). */
  t: number;
  x: number;
  /** Height (ground) or offset from the target's centre. */
  y: number;
  a: number;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  targets: Target[];
  balloons: Balloon[];
  wall: Wall | null;
  gust: Gust | null;
  /** Wind per arrow (units/s², positive = towards the targets), with a spare one for a bonus arrow. */
  winds: number[];
  arrows: number;
  /** Arrows shot so far (the next one is `shot`). */
  shot: number;
  goal: number;
  score: number;
  /** Points per arrow shot. */
  hits: number[];
  /** Aim: angle above the horizon, draw 0–1. */
  angle: number;
  power: number;
  /** Keyboard keys held: angle −1/0/1 and draw −1/0/1. */
  turn: number;
  pull: number;
  phase: 'aim' | 'flight' | 'show' | 'done';
  /** Arrow in flight: tip and velocity. */
  ax: number;
  ay: number;
  vx: number;
  vy: number;
  /** Clock (targets bob with it) and the result display timer. */
  time: number;
  wait: number;
  stuck: Stuck[];
  /** Good shots in a row, and the rewards it reached (index into `STREAK_TIERS`). */
  streak: number;
  tier: number;
  /** Bonus arrows given so far. */
  extra: number;
}

/** Deal a range: targets at seeded distances and heights, the wind for every arrow, and the kind's twist. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const n = targetCount(d);
  const r = radiusFor(d);
  const targets: Target[] = [];
  // A palisade stands between the archer and the targets: lob over it.
  const wall: Wall | null =
    kind === 'wall' ? { x: rng.int(92, 112), w: 9, top: GROUND - rng.int(byLevel(d, [70, 70, 80, 85, 90]), 105) } : null;
  // Spread targets over distance bands, near to far, at seeded heights (clear of the palisade).
  const near = nearFor(d);
  const yHi = wall ? Math.min(GROUND - r - 30, wall.top) : GROUND - r - 30;
  for (let i = 0; i < n; i++) {
    const lo = near + (i * (FAR - near)) / n;
    const hi = near + ((i + 1) * (FAR - near)) / n;
    targets.push({ x: Math.round(lo + rng.next() * (hi - lo)), y: rng.int(110, yHi), r, amp: 0, freq: 0, phase: 0 });
  }
  rng.shuffle(targets);
  // A carnival range: every target bobs, from Easy up.
  const carnival = kind === 'carnival';
  const bob = carnival ? Math.max(30, bobFor(d)) : bobFor(d);
  for (const t of targets.slice(0, carnival ? n : movingCount(d))) {
    t.amp = bob;
    t.y = Math.max(70 + bob, Math.min(GROUND - r - 20 - bob, t.y));
    t.freq = 1.2 + rng.next() * 0.9;
    t.phase = rng.next() * Math.PI * 2;
  }
  const [wlo, whi] = windFor(d);
  // Gusts swell and drop around a gentler base wind.
  const base = kind === 'gusty' ? 0.6 : 1;
  const arrows = arrowsFor(d);
  const winds = Array.from({ length: arrows + MAX_EXTRA }, () =>
    Math.round((wlo + rng.next() * (whi - wlo)) * base * (rng.chance(0.5) ? 1 : -1)),
  );
  const gust: Gust | null =
    kind === 'gusty' ? { amp: Math.max(40, whi * 0.6), freq: 1.1 + rng.next() * 0.6, phase: rng.next() * Math.PI * 2 } : null;
  // Balloons drift up through the range: a whole bunch, or a stray one on a classic range from Hard up.
  const nb = kind === 'balloons' ? 3 : kind === 'range' && d >= 3 ? 1 : 0;
  const balloons: Balloon[] = Array.from({ length: nb }, (_, i) => ({
    x: Math.round(90 + ((i + 0.2 + rng.next() * 0.6) * (FAR - 110)) / nb),
    y0: rng.int(SKY_TOP + 20, GROUND - 20),
    rise: rng.int(14, 26),
    c: rng.pick([0, 2, 4, 5, 6]),
    popped: false,
  }));
  return {
    d,
    kind,
    targets,
    balloons,
    wall,
    gust,
    winds,
    arrows,
    shot: 0,
    goal: goalFor(d),
    score: 0,
    hits: [],
    angle: 0.35,
    power: 0.6,
    turn: 0,
    pull: 0,
    phase: 'aim',
    ax: BOW.x,
    ay: BOW.y,
    vx: 0,
    vy: 0,
    time: 0,
    wait: 0,
    stuck: [],
    streak: 0,
    tier: 0,
    extra: 0,
  };
}

/** The target the current arrow must hit: they take turns. */
export const current = (s: State) => Math.min(s.shot, s.arrows - 1) % s.targets.length;
/** The wind right now: the arrow's own, and on a gusty range it swells and drops around it. */
export function wind(s: State, time = s.time): number {
  const w = s.winds[Math.min(s.shot, s.arrows - 1)];
  return s.gust ? Math.round(w + s.gust.amp * Math.sin(s.gust.freq * time + s.gust.phase)) : w;
}
/** A target's centre height at the current time. */
export const targetY = (s: State, t: Target, time = s.time) => t.y + t.amp * Math.sin(t.freq * time + t.phase);
/** A balloon's height at a time (rising, wrapping back down to the ground). */
export function balloonY(b: Balloon, time: number): number {
  const span = GROUND - 10 - SKY_TOP;
  const k = (((GROUND - 10 - b.y0 + b.rise * time) % span) + span) % span;
  return GROUND - 10 - k;
}
const tierAt = (n: number) => STREAK_TIERS.filter((t) => n >= t).length;
/** Points multiplier from the streak: double points from its second reward on. */
export const mult = (s: State) => (s.tier >= 2 ? 2 : 1);
/** Is the streak's wind guide on? */
export const guided = (s: State) => s.tier >= 1;
const speedOf = (power: number) => MIN_SPEED + power * (MAX_SPEED - MIN_SPEED);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Set the aim (pointer drag): direction and draw, clamped. */
export function setAim(s: State, angle: number, power: number) {
  if (s.phase !== 'aim') return;
  s.angle = clamp(angle, MIN_ANGLE, MAX_ANGLE);
  s.power = clamp(power, 0, 1);
}

/** Loose the arrow. */
export function shoot(s: State): boolean {
  if (s.phase !== 'aim') return false;
  const v = speedOf(s.power);
  s.phase = 'flight';
  s.ax = BOW.x + Math.cos(s.angle) * ARROW_LEN;
  s.ay = BOW.y - Math.sin(s.angle) * ARROW_LEN;
  s.vx = Math.cos(s.angle) * v;
  s.vy = -Math.sin(s.angle) * v;
  return true;
}

/**
 * The first stretch of the arrow's path, for the aim guide: gravity only (the wind isn't shown), or, with
 * the streak's wind guide, a longer stretch that bends with the wind blowing right now.
 */
export function aimPath(s: State): { x: number; y: number }[] {
  const v = speedOf(s.power);
  const pts = [];
  const x0 = BOW.x + Math.cos(s.angle) * ARROW_LEN;
  const y0 = BOW.y - Math.sin(s.angle) * ARROW_LEN;
  const w = guided(s) ? wind(s) : 0;
  const len = previewFor(s.d) * (guided(s) ? GUIDE_X : 1);
  for (let t = 0; t <= len; t += 0.03)
    pts.push({ x: x0 + Math.cos(s.angle) * v * t + (w * t * t) / 2, y: y0 - Math.sin(s.angle) * v * t + (GRAVITY * t * t) / 2 });
  return pts;
}

/** Points for crossing a target's face `dy` from its centre (0 = outside the face). */
export function ringScore(dy: number, r: number): number {
  const k = Math.floor((Math.abs(dy) / r) * RINGS.length);
  return k < RINGS.length ? RINGS[k] : 0;
}

export interface StepEvents {
  /** The arrow came to rest: `points` scored (0 for a miss), stuck at (x, y). */
  landed: boolean;
  points: number;
  /** The ring it hit (10 to 2, 0 for a miss), before the streak's double points. */
  ring: number;
  x: number;
  y: number;
  /** The arrow struck the palisade. */
  blocked: boolean;
  /** Balloons popped this step (centres, points scored). */
  pops: { x: number; y: number; points: number }[];
  /** Streak length after this step (0: broken or none). */
  streak: number;
  /** A streak reward reached this step (1-based tier) and what it unlocked; 0 / null for none. */
  tier: number;
  unlocked: Reward | null;
  /** The next arrow is ready (the wind changed). */
  next: boolean;
  cleared: boolean;
  over: boolean;
}

/** Count one good shot (or balloon) into the streak; a milestone unlocks the next reward. */
function good(s: State, ev: StepEvents) {
  s.streak++;
  ev.streak = s.streak;
  const t = tierAt(s.streak);
  if (t <= s.tier) return;
  s.tier = t;
  ev.tier = t;
  ev.unlocked = REWARDS[t - 1];
  if (ev.unlocked === 'extra' && s.extra < MAX_EXTRA) {
    s.extra++;
    s.arrows++;
  }
}

/** A shot that didn't make a good ring: the streak and its rewards are gone. */
function breakStreak(s: State, ev: StepEvents) {
  s.streak = s.tier = 0;
  ev.streak = 0;
}

/** The most points still possible: every balloon popped and every arrow left in the bullseye. */
function reach(s: State): number {
  const bal = s.balloons.filter((b) => !b.popped).length;
  let n = s.streak;
  let extra = s.extra;
  let pts = bal * BALLOON_PTS * 2;
  for (let left = s.arrows - s.shot; left > 0; left--) {
    pts += RINGS[0] * (tierAt(n) >= 2 ? 2 : 1);
    n++;
    if (tierAt(n) >= 3 && extra < MAX_EXTRA) {
      extra++;
      left++;
    }
  }
  return pts;
}

/** After an arrow: wait, then the next arrow or the end (lost early once the goal is out of reach). */
function settle(s: State, ev: StepEvents) {
  s.shot++;
  const left = s.arrows - s.shot;
  if (!left) {
    s.phase = 'done';
    if (s.score >= s.goal) ev.cleared = true;
    else ev.over = true;
  } else if (s.score + reach(s) < s.goal) {
    s.phase = 'done';
    ev.over = true;
  } else {
    s.phase = 'show';
    s.wait = SHOW_S;
  }
}

/** Advance by `dt` seconds: the aim keys, the targets, the arrow in flight. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    landed: false,
    points: 0,
    ring: 0,
    x: 0,
    y: 0,
    blocked: false,
    pops: [],
    streak: s.streak,
    tier: 0,
    unlocked: null,
    next: false,
    cleared: false,
    over: false,
  };
  s.time += dt;
  if (s.phase === 'aim') {
    s.angle = clamp(s.angle + s.turn * TURN_SPEED * dt, MIN_ANGLE, MAX_ANGLE);
    s.power = clamp(s.power + s.pull * PULL_SPEED * dt, 0, 1);
    return ev;
  }
  if (s.phase === 'show') {
    s.wait -= dt;
    if (s.wait <= 0) {
      s.phase = 'aim';
      ev.next = true;
    }
    return ev;
  }
  if (s.phase === 'done') return ev;

  const n = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / 3));
  const h = dt / n;
  const ti = current(s);
  const t = s.targets[ti];
  for (let i = 0; i < n; i++) {
    const px = s.ax;
    const py = s.ay;
    const now = s.time - dt + h * (i + 1);
    s.vx += wind(s, now) * h;
    s.vy += GRAVITY * h;
    s.ax += s.vx * h;
    s.ay += s.vy * h;
    const a = Math.atan2(s.vy, s.vx);
    // Balloons on the way pop, and the arrow flies on.
    for (const b of s.balloons) {
      if (b.popped) continue;
      const by = balloonY(b, now);
      if (Math.hypot(s.ax - b.x, s.ay - by) > BALLOON_R + 2) continue;
      b.popped = true;
      const pts = BALLOON_PTS * mult(s);
      s.score += pts;
      ev.pops.push({ x: b.x, y: by, points: pts });
    }
    // The palisade stops any arrow that meets it below its top.
    const wl = s.wall;
    if (wl && px < wl.x + wl.w && s.ax >= wl.x && s.ay > wl.top) {
      const x = clamp(s.ax, wl.x, wl.x + wl.w);
      s.stuck.push({ t: -1, x, y: s.ay, a });
      s.hits.push(0);
      breakStreak(s, ev);
      Object.assign(ev, { landed: true, blocked: true, points: 0, x, y: s.ay });
      settle(s, ev);
      return ev;
    }
    // Crossing the current target's face (front to back).
    if (px < t.x && s.ax >= t.x) {
      const y = py + ((s.ay - py) * (t.x - px)) / (s.ax - px);
      const dy = y - targetY(s, t, now);
      const ring = ringScore(dy, t.r);
      if (ring) {
        const pts = ring * mult(s);
        s.stuck.push({ t: ti, x: t.x, y: dy, a });
        s.score += pts;
        s.hits.push(pts);
        if (ring >= STREAK_MIN) good(s, ev);
        else breakStreak(s, ev);
        Object.assign(ev, { landed: true, points: pts, ring, x: t.x, y });
        settle(s, ev);
        return ev;
      }
    }
    const out = s.ax > W + 40 || s.ax < -40;
    if (s.ay >= GROUND || out) {
      if (!out) {
        s.ay = GROUND;
        s.stuck.push({ t: -1, x: s.ax, y: GROUND, a });
      }
      s.hits.push(0);
      breakStreak(s, ev);
      Object.assign(ev, { landed: true, points: 0, x: clamp(s.ax, 10, W - 10), y: Math.min(s.ay, GROUND) });
      settle(s, ev);
      return ev;
    }
  }
  return ev;
}
