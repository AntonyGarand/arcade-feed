import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units (the canvas scales it to the card). */
export const W = 260;
export const H = 310;
/** Screen height of the running surface. */
export const GROUND = 250;
/** The runner stays at this screen x; the track scrolls past. */
export const RX = 58;
/** Runner box: width, standing and ducking heights. */
export const PW = 18;
const PH = 30;
const DUCK_H = 15;
/** Overhead bars leave this much room above the ground: enough to duck under, not to stand. */
export const BAR_GAP = 21;
export const COIN_R = 6;
const GRAVITY = 1900;
/** Take-off speed of a jump; letting go early cuts the climb to `CUT`. */
const JUMP = 640;
const CUT = 240;
/** Ducking in the air slams you down at this speed. */
const SLAM = 700;
/** A swipe down keeps you ducked this long (a held ↓ for as long as it's held). */
const SWIPE_DUCK_S = 0.6;
/** A fresh hop lower than this is undone by a duck. */
const HOP_UNDO = 40;
const INVULNERABLE_S = 1.3;
/** Falling this far into a pit costs a heart. */
const PIT_DEPTH = 46;
/** Reaction time we allow between landing and the next obstacle, in seconds. */
const REACT_S = 0.42;

export const COIN_POINTS = 10;
export const LIFE_BONUS = 100;
/** Coins in a group (an arc over an obstacle, or a line under a bar). */
const GROUP = 5;

/** Track length to run. */
export const lengthFor = (d: Difficulty) => byLevel(d, [5200, 6400, 7600, 8800, 10000]);
/** Running speed at the start; it climbs by `RAMP` by the finish line. */
export const speedFor = (d: Difficulty) => byLevel(d, [175, 195, 215, 235, 255]);
const RAMP = 0.3;
export const livesFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 2, 2]);
/** Obstacle kinds by level: low blocks always, pits from Medium, overhead bars from Hard. */
const kindsFor = (d: Difficulty): Kind[] =>
  byLevel<Kind[]>(d, [
    ['block'],
    ['block', 'block', 'pit'],
    ['block', 'pit', 'bar'],
    ['block', 'pit', 'pit', 'bar'],
    ['block', 'pit', 'bar', 'bar'],
  ]);
/** Extra room between obstacles, in seconds of running (less is denser). */
export const slackFor = (d: Difficulty) => byLevel(d, [0.9, 0.7, 0.5, 0.35, 0.25]);
/** Coin groups on offer. */
const groupsFor = (d: Difficulty) => byLevel(d, [8, 9, 10, 11, 12]);
export const coinsFor = (d: Difficulty) => groupsFor(d) * GROUP;

type Kind = 'block' | 'pit' | 'bar';

interface Obstacle {
  kind: Kind;
  /** Track x of the left edge, and width. */
  x: number;
  w: number;
  /** Block height (0 for pits and bars). */
  h: number;
}

interface Coin {
  x: number;
  /** Height above the ground. */
  y: number;
  taken: boolean;
}

export interface State {
  d: Difficulty;
  length: number;
  obstacles: Obstacle[];
  coins: Coin[];
  /** Track x of the runner's centre. */
  x: number;
  /** Feet height above the ground (negative inside a pit), and vertical speed (up is positive). */
  y: number;
  vy: number;
  grounded: boolean;
  /** Jump button held (a release cuts the jump short). */
  holding: boolean;
  /** Feet height at the last take-off (a duck right after it cancels the hop). */
  jumpY: number;
  /** ↓ held, or seconds left of a swiped duck. */
  duckKey: boolean;
  duckTime: number;
  /** Fell into a pit: no control until the respawn. */
  falling: boolean;
  /** Index of the pit being fallen into. */
  pit: number;
  lives: number;
  invulnerable: number;
  collected: number;
  score: number;
  time: number;
}

/** Running speed at track position `x`: it ramps up along the run. */
export const speedAt = (d: Difficulty, x: number) => speedFor(d) * (1 + (RAMP * Math.max(0, x)) / lengthFor(d));

/** Seconds a full jump stays above height `h`. */
const airAbove = (h: number) => (2 * Math.sqrt(Math.max(0, JUMP * JUMP - 2 * GRAVITY * h))) / GRAVITY;
/** Highest point of a full jump. */
const APEX = (JUMP * JUMP) / (2 * GRAVITY);
/** Seconds from take-off to the top of a full jump. */
export const APEX_S = JUMP / GRAVITY;

/**
 * Deal a run: obstacles and coins along the track, all from the seed. Every obstacle is checked
 * against the jump at the speed you'll be running when you reach it, with room to land and react.
 */
export function createLevel(d: Difficulty, rng: Rng): State {
  const length = lengthFor(d);
  const kinds = kindsFor(d);
  const obstacles: Obstacle[] = [];
  let x = 700; // a calm start: the first obstacle is a few seconds away
  let last: Kind | '' = '';
  while (x < length - 300) {
    const v = speedAt(d, x);
    let kind = rng.pick(kinds);
    if (kind === last && kind !== 'block' && rng.chance(0.5)) kind = 'block';
    let w: number;
    let h = 0;
    if (kind === 'block') {
      h = rng.int(18, byLevel(d, [34, 42, 50, 56, 62]));
      // The runner must clear the block's top with its whole width while above it.
      const most = airAbove(h + 6) * v * 0.8 - PW;
      w = Math.max(14, Math.min(rng.int(16, byLevel(d, [30, 40, 50, 60, 70])), most));
    } else if (kind === 'pit') {
      // A full jump crosses it with a fifth of its flight to spare.
      const most = airAbove(0) * v * 0.8 - PW;
      w = Math.min(rng.int(byLevel(d, [40, 44, 50, 56, 60]), byLevel(d, [60, 80, 100, 115, 130])), most);
    } else {
      // A bar is ducked under: passing it must fit inside one swiped duck.
      const most = (SWIPE_DUCK_S - 0.2) * v - PW;
      w = Math.min(rng.int(30, byLevel(d, [40, 50, 70, 85, 100])), most);
    }
    w = Math.round(w);
    obstacles.push({ kind, x, w, h });
    last = kind;
    // Room to land, see the next one and react, at the speed by then.
    const vAfter = speedAt(d, x + w);
    x += w + vAfter * (2 * APEX_S + REACT_S + slackFor(d) * (0.4 + rng.next()));
  }
  const coins: Coin[] = [];
  const slots = rng.shuffle(obstacles.map((_, i) => i)).slice(0, groupsFor(d));
  for (const i of slots) {
    const o = obstacles[i];
    const v = speedAt(d, o.x);
    const mid = o.x + o.w / 2;
    for (let k = 0; k < GROUP; k++) {
      const t = (k - (GROUP - 1) / 2) * 0.1;
      // Under a bar: a low line. Elsewhere: along a full jump whose top is over the obstacle.
      if (o.kind === 'bar') coins.push({ x: o.x + (o.w * (k + 0.5)) / GROUP, y: 8, taken: false });
      else coins.push({ x: mid + v * t, y: APEX - 0.5 * GRAVITY * t * t + PH / 2, taken: false });
    }
  }
  // Groups past the obstacles (short tracks): a low line on open ground.
  for (let i = slots.length; i < groupsFor(d); i++)
    for (let k = 0; k < GROUP; k++) coins.push({ x: 400 + i * 40 + k * 16, y: 10, taken: false });
  coins.sort((a, b) => a.x - b.x);
  return {
    d,
    length,
    obstacles,
    coins,
    x: 0,
    y: 0,
    vy: 0,
    grounded: true,
    holding: false,
    jumpY: 0,
    duckKey: false,
    duckTime: 0,
    falling: false,
    pit: -1,
    lives: livesFor(d),
    invulnerable: 0,
    collected: 0,
    score: 0,
    time: 0,
  };
}

/** Press jump (tap, Space, ↑): jumps if on the ground. */
export function press(s: State) {
  s.holding = true;
  if (s.grounded && !s.falling) {
    s.vy = JUMP;
    s.jumpY = s.y;
    s.grounded = false;
    s.duckTime = 0;
  }
}

/** Let go of jump: a rising jump is cut short. */
export function release(s: State) {
  s.holding = false;
  if (!s.grounded && s.vy > CUT) s.vy = CUT;
}

/**
 * Swipe down: duck for a moment (and drop at once if in the air). A swipe starts with a press, which
 * jumps: ducking while that hop is still low cancels it, so a swipe never lifts you into a bar.
 */
export function duck(s: State) {
  s.duckTime = SWIPE_DUCK_S;
  if (!s.grounded && !s.falling && s.vy > 0 && s.y - s.jumpY < HOP_UNDO) {
    s.y = s.jumpY;
    s.vy = 0;
    s.grounded = true;
  }
}

export const ducking = (s: State) => !s.falling && (s.duckKey || s.duckTime > 0);
export const heightOf = (s: State) => (ducking(s) ? DUCK_H : PH);
export const progress = (s: State) => Math.min(1, s.x / s.length);

/** The pit right under the whole feet span, if any. */
const pitUnder = (s: State, left: number, right: number) =>
  s.obstacles.findIndex((o) => o.kind === 'pit' && o.x <= left && o.x + o.w >= right);

/**
 * Top of the surface under the feet span, for feet at height `feet`: a block top you're above, the
 * ground (if any part of the feet is over it), or -∞ over a pit. A block you ran into is no floor.
 */
function supportAt(s: State, left: number, right: number, feet: number): number {
  let top = pitUnder(s, left, right) >= 0 ? -Infinity : 0;
  for (const o of s.obstacles) if (o.kind === 'block' && o.x < right && o.x + o.w > left && o.h <= feet + 2) top = Math.max(top, o.h);
  return top;
}

export interface StepEvents {
  coin: boolean;
  hurt: boolean;
  landed: boolean;
  won: boolean;
  over: boolean;
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { coin: false, hurt: false, landed: false, won: false, over: false };
  if (s.x >= s.length || s.lives <= 0) return ev;
  s.time += dt;
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.duckTime = Math.max(0, s.duckTime - dt);
  const v = speedAt(s.d, s.x);
  const before = s.y;
  s.x += v * dt;
  const left = s.x - PW / 2;
  const right = s.x + PW / 2;

  if (s.falling) {
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    // Stay inside the pit: the far wall stops you.
    const pit = s.obstacles[s.pit];
    s.x = Math.min(s.x, pit.x + pit.w - PW / 2);
    return s.y < -PIT_DEPTH ? respawn(s, ev) : ev;
  }

  // Ducking in the air slams you down.
  if (!s.grounded && ducking(s) && s.vy > -SLAM) s.vy = -SLAM;
  s.vy -= GRAVITY * dt;
  s.y += s.vy * dt;
  const floor = supportAt(s, left, right, before);
  if (s.y <= floor) {
    if (!s.grounded) ev.landed = true;
    s.y = floor;
    s.vy = 0;
    s.grounded = true;
  } else {
    s.grounded = false;
    if (s.y < 0) {
      // Over a pit, below the rim: falling in.
      s.falling = true;
      s.pit = pitUnder(s, left, right);
      return ev;
    }
  }

  // Bumps: the side of a block, or a bar at head height.
  if (!s.invulnerable) {
    const top = s.y + heightOf(s);
    const hit = s.obstacles.some(
      (o) => o.x < right - 2 && o.x + o.w > left + 2 && ((o.kind === 'block' && s.y < o.h - 3) || (o.kind === 'bar' && top > BAR_GAP)),
    );
    if (hit) {
      s.lives--;
      ev.hurt = true;
      if (s.lives <= 0) {
        ev.over = true;
        return ev;
      }
      s.invulnerable = INVULNERABLE_S;
    }
  }

  for (const c of s.coins) {
    if (c.taken || c.x < left - COIN_R || c.x > right + COIN_R) continue;
    if (c.y + COIN_R > s.y && c.y - COIN_R < s.y + heightOf(s)) {
      c.taken = true;
      s.collected++;
      s.score += COIN_POINTS;
      ev.coin = true;
    }
  }

  if (s.x >= s.length) {
    s.score += s.lives * LIFE_BONUS;
    ev.won = true;
  }
  return ev;
}

/** A heart for the pit; back on the ground just past it, safe for a moment. */
function respawn(s: State, ev: StepEvents): StepEvents {
  s.lives--;
  ev.hurt = true;
  if (s.lives <= 0) {
    ev.over = true;
    return ev;
  }
  const pit = s.obstacles[s.pit];
  s.x = pit.x + pit.w + PW;
  s.y = 0;
  s.vy = 0;
  s.falling = false;
  s.grounded = true;
  s.invulnerable = INVULNERABLE_S;
  return ev;
}
