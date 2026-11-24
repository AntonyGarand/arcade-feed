import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

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

/** A spring pad's launch speed (much higher than a jump), and its width. */
const SPRING = 860;
export const SPRING_W = 22;
/** Seconds a spring launch stays above the ground. */
const SPRING_AIR = (2 * SPRING) / GRAVITY;
/** Bird box: width and height. Low birds fly at `LOW_BIRD` (jump them), high ones at `BAR_GAP` (duck them). */
const BIRD_W = 18;
export const BIRD_H = 12;
const LOW_BIRD = 4;
/** Seconds a duck lasts once under a tunnel's roof (refreshed while under it). */
const TUNNEL_HOLD = 0.25;

/** Clean passes in a row that fire a combo event (tier 1 at 5…). */
export const COMBO_TIERS = [5, 10, 16, 24, 32] as const;
/** What a combo milestone unlocks: a coin magnet, a shield, an unstoppable dash, then more of them. */
export type Power = 'magnet' | 'shield' | 'dash' | 'dashShield' | 'all';
const TIER_POWERS: readonly Power[] = ['magnet', 'shield', 'dash', 'dashShield', 'all'];
export const MAGNET_S = 7;
export const DASH_S = 4;
/** Coins this close to the runner's middle fly in while the magnet runs. */
export const MAGNET_R = 26;

export const COIN_POINTS = 10;
export const LIFE_BONUS = 100;
/** Coins in a group (an arc over an obstacle, or a line under a bar). */
const GROUP = 5;

/** Track length to run (faster kinds run a longer track in the same time). */
export const lengthFor = (d: Difficulty) => byLevel(d, [5200, 6400, 7600, 8800, 10000]);
/** Running speed at the start; it climbs by `RAMP` by the finish line. */
export const speedFor = (d: Difficulty) => byLevel(d, [175, 195, 215, 235, 255]);
const RAMP = 0.3;
export const livesFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 2, 2]);
/** City obstacles by level: low blocks always, pits from Medium, overhead bars from Hard. */
const cityPieces = (d: Difficulty): Piece[] =>
  byLevel<Piece[]>(d, [
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

/** The kinds of run a level can deal. */
export const KINDS = [
  { id: 'city', weight: 2 },
  { id: 'woods' },
  { id: 'springs', min: 2 },
  { id: 'underpass', min: 3 },
  { id: 'sprint', min: 2 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** What each kind of run throws at you. */
function piecesFor(kind: KindId, d: Difficulty): Piece[] {
  switch (kind) {
    case 'woods':
      return d === 1 ? ['block', 'block', 'bird'] : ['block', 'pit', 'bird', 'bird'];
    case 'springs':
      return [...cityPieces(d).filter((p) => p !== 'bar'), 'spring', 'spring'];
    case 'underpass':
      return d >= 4 ? ['block', 'pit', 'bar', 'tunnel', 'tunnel'] : ['block', 'block', 'bar', 'tunnel', 'tunnel'];
    case 'sprint':
      return ['block', 'block', 'pit'];
    default:
      return cityPieces(d);
  }
}
/** A sprint runs a fifth faster (on a track a fifth longer). */
const paceOf = (kind: KindId) => (kind === 'sprint' ? 1.2 : 1);

/**
 * A piece of track: a crate (`block`), a hole (`pit`; a wide chasm after a spring), a hanging `bar`,
 * a long low `tunnel` (stay ducked), a `spring` pad that launches you high, or a `bird` flying along.
 */
type Piece = 'block' | 'pit' | 'bar' | 'tunnel' | 'spring' | 'bird';

interface Obstacle {
  kind: Piece;
  /** Track x of the left edge, and width. A bird is here when the runner meets it (see `birdX`). */
  x: number;
  w: number;
  /** Block height; a bird's flying height (its bottom). 0 otherwise. */
  h: number;
  /** Birds: their own speed along the run, as a share of yours (they fly the same way, slower). */
  k?: number;
  /** A pit too wide to jump: the spring before it clears it. */
  chasm?: boolean;
  /** Passed (counted for the combo, or spoiled by a bump). */
  done?: boolean;
  /** Smashed by a dash (crates, birds): gone. */
  smashed?: boolean;
}

interface Coin {
  x: number;
  /** Height above the ground. */
  y: number;
  taken: boolean;
  /** Group index: taking a whole group counts for the combo. */
  g: number;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  /** Speed multiplier of this kind of run. */
  pace: number;
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
  /** Launched by a spring: letting go of jump doesn't cut this flight. */
  sprung: boolean;
  /** Clean passes in a row: obstacles cleared without a bump, and whole coin groups. */
  combo: number;
  best: number;
  /** Combo milestones reached by the current combo. */
  tier: number;
  /** Seconds of magnet and dash left, and shield charges. */
  magnet: number;
  dash: number;
  shield: number;
}

/** Running speed at track position `x`: it ramps up along the run (`pace` for faster kinds). */
export const speedAt = (d: Difficulty, x: number, pace = 1) => speedFor(d) * pace * (1 + (RAMP * Math.max(0, x)) / (lengthFor(d) * pace));
const speedOf = (s: State) => speedAt(s.d, s.x, s.pace);
/** Track x of a bird's centre when the runner's centre is at `x`: it meets you right over its slot. */
export const birdX = (o: Obstacle, x: number) => o.x + o.w / 2 + (x - o.x - o.w / 2) * (o.k ?? 0);

/** Seconds a full jump stays above height `h`. */
const airAbove = (h: number) => (2 * Math.sqrt(Math.max(0, JUMP * JUMP - 2 * GRAVITY * h))) / GRAVITY;
/** Highest point of a full jump. */
const APEX = (JUMP * JUMP) / (2 * GRAVITY);
/** Seconds from take-off to the top of a full jump. */
export const APEX_S = JUMP / GRAVITY;

/**
 * Deal a run: its kind, obstacles and coins along the track, all from the seed. Every obstacle is
 * checked against the jump at the speed you'll be running when you reach it, with room to land and
 * react; a chasm against the spring launch before it.
 */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const pace = paceOf(kind);
  const length = Math.round(lengthFor(d) * pace);
  const pieces = piecesFor(kind, d);
  const speed = (x: number) => speedAt(d, x, pace);
  /** Room to land, see the next obstacle and react, at the speed by then. */
  const room = (x: number) => speed(x) * (2 * APEX_S + REACT_S + slackFor(d) * (0.4 + rng.next()));
  const obstacles: Obstacle[] = [];
  let x = 700 * pace; // a calm start: the first obstacle is a few seconds away
  let last: Piece | '' = '';
  while (x < length - 300 * pace) {
    const v = speed(x);
    let piece = rng.pick(pieces);
    if (piece === last && piece !== 'block' && rng.chance(0.5)) piece = 'block';
    last = piece;
    if (piece === 'spring') {
      // A spring pad, then a chasm too wide to jump that its launch clears with room to spare.
      obstacles.push({ kind: 'spring', x, w: SPRING_W, h: 0 });
      const cx = x + SPRING_W + 6;
      const reach = Math.floor(-SPRING_W / 2 - 6 + 0.85 * v * SPRING_AIR - PW / 2);
      const jumpable = airAbove(0) * v * 0.8 - PW;
      const cw = Math.min(reach, Math.round(Math.max(jumpable + 8, reach * (0.8 + rng.next() * 0.12))));
      obstacles.push({ kind: 'pit', x: cx, w: cw, h: 0, chasm: true });
      x = cx + cw + speed(cx) * SPRING_AIR * 0.25 + room(cx + cw);
      continue;
    }
    let w: number;
    let h = 0;
    let k: number | undefined;
    if (piece === 'block') {
      h = rng.int(18, byLevel(d, [34, 42, 50, 56, 62]));
      // The runner must clear the block's top with its whole width while above it.
      const most = airAbove(h + 6) * v * 0.8 - PW;
      w = Math.max(14, Math.min(rng.int(16, byLevel(d, [30, 40, 50, 60, 70])), most));
    } else if (piece === 'pit') {
      // A full jump crosses it with a fifth of its flight to spare.
      const most = airAbove(0) * v * 0.8 - PW;
      w = Math.min(rng.int(byLevel(d, [40, 44, 50, 56, 60]), byLevel(d, [60, 80, 100, 115, 130])), most);
    } else if (piece === 'bar') {
      // A bar is ducked under: passing it must fit inside one swiped duck.
      const most = (SWIPE_DUCK_S - 0.2) * v - PW;
      w = Math.min(rng.int(30, byLevel(d, [40, 50, 70, 85, 100])), most);
    } else if (piece === 'tunnel') {
      // Long: a duck started before it lasts as long as you stay under its roof.
      w = rng.int(110, byLevel(d, [150, 170, 200, 230, 260]));
    } else {
      // A bird flying your way, slower: low ones are jumped, high ones (Hard and up) ducked. It
      // closes in slower than a crate, so both fit inside a full jump or a swiped duck.
      w = BIRD_W;
      h = d >= 3 && rng.chance(0.5) ? BAR_GAP : LOW_BIRD;
      k = 0.2 + rng.next() * 0.2;
    }
    w = Math.round(w);
    obstacles.push(k == null ? { kind: piece, x, w, h } : { kind: piece, x, w, h, k });
    x += w + room(x + w);
  }
  const coins: Coin[] = [];
  // No coins on a spring's flight: it flies itself, so they'd be free.
  const spots = obstacles.map((_, i) => i).filter((i) => obstacles[i].kind !== 'spring' && !obstacles[i].chasm);
  const slots = rng.shuffle(spots).slice(0, groupsFor(d));
  slots.forEach((i, g) => {
    const o = obstacles[i];
    const v = speed(o.x);
    const mid = o.x + o.w / 2;
    for (let k = 0; k < GROUP; k++) {
      const t = (k - (GROUP - 1) / 2) * 0.1;
      if (o.kind === 'bar' || o.kind === 'tunnel' || (o.kind === 'bird' && o.h === BAR_GAP))
        // Under a bar, a tunnel or a high bird: a low line.
        coins.push({ x: o.x + (o.w * (k + 0.5)) / GROUP, y: 8, taken: false, g });
      // Elsewhere: along a full jump whose top is over the obstacle.
      else coins.push({ x: mid + v * t, y: APEX - 0.5 * GRAVITY * t * t + PH / 2, taken: false, g });
    }
  });
  // Groups the obstacles can't hold (short tracks, many springs): a low coin road on the calm start.
  for (let i = slots.length; i < groupsFor(d); i++)
    for (let k = 0; k < GROUP; k++) coins.push({ x: 90 + (i - slots.length) * 72 + k * 16, y: 10, taken: false, g: i });
  coins.sort((a, b) => a.x - b.x);
  return {
    d,
    kind,
    pace,
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
    sprung: false,
    combo: 0,
    best: 0,
    tier: 0,
    magnet: 0,
    dash: 0,
    shield: 0,
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

/** Let go of jump: a rising jump is cut short (not a spring's launch). */
export function release(s: State) {
  s.holding = false;
  if (!s.grounded && !s.sprung && s.vy > CUT) s.vy = CUT;
}

/**
 * Swipe down: duck for a moment (and drop at once if in the air). A swipe starts with a press, which
 * jumps: ducking while that hop is still low cancels it, so a swipe never lifts you into a bar.
 */
export function duck(s: State) {
  s.duckTime = SWIPE_DUCK_S;
  if (!s.grounded && !s.falling && !s.sprung && s.vy > 0 && s.y - s.jumpY < HOP_UNDO) {
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
 * ground (if any part of the feet is over it, or always while dashing), or -∞ over a pit. A block
 * you ran into is no floor.
 */
function supportAt(s: State, left: number, right: number, feet: number): number {
  let top = s.dash <= 0 && pitUnder(s, left, right) >= 0 ? -Infinity : 0;
  for (const o of s.obstacles)
    if (o.kind === 'block' && !o.smashed && o.x < right && o.x + o.w > left && o.h <= feet + 2) top = Math.max(top, o.h);
  return top;
}

/** Whether obstacle `o` overlaps the runner's box right now. */
function touches(s: State, o: Obstacle, left: number, right: number): boolean {
  if (o.smashed) return false;
  const top = s.y + heightOf(s);
  if (o.kind === 'bird') {
    const bx = birdX(o, s.x);
    return bx - o.w / 2 < right - 2 && bx + o.w / 2 > left + 2 && o.h < top - 2 && o.h + BIRD_H > s.y + 2;
  }
  if (!(o.x < right - 2 && o.x + o.w > left + 2)) return false;
  if (o.kind === 'block') return s.y < o.h - 3;
  return (o.kind === 'bar' || o.kind === 'tunnel') && top > BAR_GAP;
}

/** Whether the runner is past obstacle `o`. */
const passed = (s: State, o: Obstacle) => (o.kind === 'bird' ? birdX(o, s.x) + o.w / 2 < s.x - PW / 2 : o.x + o.w < s.x - PW / 2);

export interface StepEvents {
  coin: boolean;
  hurt: boolean;
  /** A shield took a bump instead of a heart. */
  shielded: boolean;
  landed: boolean;
  /** A spring launched you. */
  sprung: boolean;
  /** The combo grew this step (a clean pass or a whole coin group). */
  combo: boolean;
  /** A combo milestone reached this step (1-based), and what it unlocked; 0 for none. */
  tier: number;
  unlocked: Power | null;
  /** Crates and birds a dash smashed this step (track x, height). */
  smashed: { x: number; y: number }[];
  won: boolean;
  over: boolean;
}

/** Turn a combo power on. */
export function grant(s: State, p: Power) {
  if (p === 'magnet' || p === 'all') s.magnet = MAGNET_S;
  if (p === 'shield' || p === 'dashShield' || p === 'all') s.shield = Math.min(2, s.shield + 1);
  if (p === 'dash' || p === 'dashShield' || p === 'all') s.dash = DASH_S;
}

/** One more clean pass: count it, and fire a milestone's power. */
function addCombo(s: State, ev: StepEvents) {
  s.combo++;
  s.best = Math.max(s.best, s.combo);
  ev.combo = true;
  if (s.tier < COMBO_TIERS.length && s.combo >= COMBO_TIERS[s.tier]) {
    const p = TIER_POWERS[s.tier];
    s.tier++;
    grant(s, p);
    ev.tier = s.tier;
    ev.unlocked = p;
  }
}

/** A bump: a shield charge takes it, else a heart and the combo. True when the run is over. */
function bump(s: State, ev: StepEvents): boolean {
  s.invulnerable = INVULNERABLE_S;
  if (s.shield > 0) {
    s.shield--;
    ev.shielded = true;
    return false;
  }
  s.lives--;
  s.combo = s.tier = 0;
  ev.hurt = true;
  if (s.lives > 0) return false;
  ev.over = true;
  return true;
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    coin: false,
    hurt: false,
    shielded: false,
    landed: false,
    sprung: false,
    combo: false,
    tier: 0,
    unlocked: null,
    smashed: [],
    won: false,
    over: false,
  };
  if (s.x >= s.length || s.lives <= 0) return ev;
  s.time += dt;
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.duckTime = Math.max(0, s.duckTime - dt);
  s.magnet = Math.max(0, s.magnet - dt);
  const v = speedOf(s);
  const before = s.y;
  s.x += v * dt;
  const left = s.x - PW / 2;
  const right = s.x + PW / 2;
  // A dash never runs out over a hole: it carries you to the far side.
  if (s.dash > 0) {
    const overPit = s.obstacles.some((o) => o.kind === 'pit' && o.x < right && o.x + o.w > left);
    s.dash = Math.max(overPit ? 0.05 : 0, s.dash - dt);
  }

  if (s.falling) {
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    // Stay inside the pit: the far wall stops you.
    const pit = s.obstacles[s.pit];
    s.x = Math.min(s.x, pit.x + pit.w - PW / 2);
    return s.y < -PIT_DEPTH ? respawn(s, ev) : ev;
  }

  // Under a tunnel's roof, a duck holds.
  if (ducking(s) && s.obstacles.some((o) => o.kind === 'tunnel' && o.x < right && o.x + o.w > left))
    s.duckTime = Math.max(s.duckTime, TUNNEL_HOLD);

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
    s.sprung = false;
  } else {
    s.grounded = false;
    if (s.y < 0) {
      // Over a pit, below the rim: falling in.
      s.falling = true;
      s.pit = pitUnder(s, left, right);
      s.obstacles[s.pit].done = true;
      return ev;
    }
  }

  // A spring under you on the ground launches you high.
  if (s.grounded && s.y === 0)
    for (const o of s.obstacles)
      if (o.kind === 'spring' && s.x >= o.x + o.w / 2 && left < o.x + o.w) {
        s.vy = SPRING;
        s.grounded = false;
        s.sprung = true;
        s.duckTime = 0;
        ev.sprung = true;
      }

  // Bumps: the side of a block, a bar or a tunnel at head height, a bird. A dash smashes through.
  for (const o of s.obstacles) {
    if (!touches(s, o, left, right)) continue;
    if (s.dash > 0) {
      if (o.kind === 'block' || o.kind === 'bird') {
        o.smashed = true;
        ev.smashed.push(o.kind === 'bird' ? { x: birdX(o, s.x), y: o.h + BIRD_H / 2 } : { x: o.x + o.w / 2, y: o.h / 2 });
      }
      continue;
    }
    if (s.invulnerable) continue;
    o.done = true;
    if (bump(s, ev)) return ev;
    break;
  }

  // Obstacles left behind cleanly grow the combo.
  for (const o of s.obstacles) {
    if (o.done || o.kind === 'spring' || !passed(s, o)) continue;
    o.done = true;
    addCombo(s, ev);
  }

  const mid = s.y + heightOf(s) / 2;
  for (const c of s.coins) {
    if (c.taken) continue;
    const near = s.magnet > 0 && Math.hypot(c.x - s.x, c.y - mid) < MAGNET_R;
    if (!near && (c.x < left - COIN_R || c.x > right + COIN_R || c.y + COIN_R <= s.y || c.y - COIN_R >= s.y + heightOf(s))) continue;
    c.taken = true;
    s.collected++;
    s.score += COIN_POINTS;
    ev.coin = true;
    // A whole group taken: one more for the combo.
    if (s.coins.every((o) => o.g !== c.g || o.taken)) addCombo(s, ev);
  }

  if (s.x >= s.length) {
    s.score += s.lives * LIFE_BONUS;
    ev.won = true;
  }
  return ev;
}

/** A heart (or a shield) for the pit; back on the ground just past it, safe for a moment. */
function respawn(s: State, ev: StepEvents): StepEvents {
  if (bump(s, ev)) return ev;
  const pit = s.obstacles[s.pit];
  s.x = pit.x + pit.w + PW;
  s.y = 0;
  s.vy = 0;
  s.falling = false;
  s.grounded = true;
  s.sprung = false;
  return ev;
}
