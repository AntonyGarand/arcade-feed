import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units (the canvas scales it to the card). */
export const W = 300;
export const H = 400;
const COLS = 7;
/** Most brick rows that fit above the paddle's reach. */
const MAX_ROWS = 9;
export const LIVES = 3;
const MARGIN = 10;
const GAP = 5;
const TOP = 54;
const BRICK_H = 18;
const BRICK_W = (W - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
export const BALL_R = 6;
export const PADDLE_Y = 366;
export const PADDLE_H = 12;
/** Seconds the ball rests on the paddle before it launches by itself. */
const HOLD_S = 0.9;
/** Keyboard paddle speed (world units per second). */
const KEY_SPEED = 380;
/** Most balls in play at once (multiball). */
const MAX_BALLS = 5;
/** Seconds between two breaks before the streak ends. */
export const STREAK_WINDOW = 6;
/** Streak lengths that fire a combo event: wide paddle, multiball, fireball, then multiball again. */
const STREAK_TIERS = [6, 12, 20, 30, 45] as const;
/** Seconds a wide paddle or a fireball lasts. */
const WIDE_S = 10;
const FIRE_S = 6;
const CAPSULE_SPEED = 95;

const rowsFor = (d: Difficulty) => byLevel(d, [3, 4, 5, 5, 6]);
/** Breakable bricks dealt at a level (every layout deals about this many). */
export const brickCount = (d: Difficulty) => rowsFor(d) * COLS;

/** A brick's special trait: `bomb` blows up its neighbours, `gift` drops a power-up, `steel` never breaks. */
type Trait = 'plain' | 'bomb' | 'gift' | 'steel';
export type Power = 'wide' | 'multi' | 'fire';

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where it sits when its row isn't sliding. */
  x0: number;
  /** Row index (sliding rows move together). */
  row: number;
  /** Hits left (2 = tough brick). Steel bricks keep theirs. */
  hp: number;
  /** Palette index. */
  c: number;
  trait: Trait;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A power-up capsule falling from a gift brick: catch it with the paddle. */
interface Capsule {
  x: number;
  y: number;
  power: Power;
}

/** The kinds of wall a level can deal. */
export const KINDS = [
  { id: 'wall', weight: 2 },
  { id: 'pyramid' },
  { id: 'diamond', min: 2, max: 4 },
  { id: 'pillars' },
  { id: 'slide', min: 2 },
  { id: 'fortress', min: 3 },
  { id: 'minefield', min: 2 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

export interface State {
  d: Difficulty;
  kind: KindId;
  bricks: Brick[];
  px: number;
  /** Paddle width right now (wider while `wide` runs). */
  pw: number;
  /** Paddle width without power-ups. */
  pw0: number;
  /** Where the player wants the paddle (pointer), or null for keyboard control. */
  target: number | null;
  /** Keyboard direction held: -1, 0 or 1. */
  dir: number;
  /** Balls in play; the first one rests on the paddle while `held`. */
  balls: Ball[];
  speed: number;
  /** Ball resting on the paddle, launching after `hold` seconds. */
  held: boolean;
  hold: number;
  /** Launch angle of the resting ball (radians from straight up), rolled when it lands on the paddle. */
  aim: number;
  lives: number;
  score: number;
  /** Bricks hit since a ball last touched the paddle (the next hit scores ×combo). */
  combo: number;
  /** Bricks broken in a row without losing a ball, each within `STREAK_WINDOW` of the last. */
  streak: number;
  /** Seconds left before the streak runs out. */
  streakLeft: number;
  /** Streak milestones reached (index into `STREAK_TIERS`). */
  tier: number;
  /** Seconds of wide paddle and fireball left. */
  wide: number;
  fire: number;
  capsules: Capsule[];
  /** Seconds since the level started (sliding rows). */
  t: number;
  rng: Rng;
}

/** Which grid cells (row, col) a layout fills, in the order they're used. */
function cells(kind: KindId, rng: Rng): [number, number][] {
  const all: [number, number][] = [];
  for (let r = 0; r < MAX_ROWS; r++) for (let c = 0; c < COLS; c++) all.push([r, c]);
  const mid = (COLS - 1) / 2;
  switch (kind) {
    case 'pyramid':
      return all.filter(([r, c]) => Math.abs(c - mid) <= r);
    case 'diamond': {
      const k = 4;
      return all.filter(([r, c]) => Math.abs(c - mid) + Math.abs(r - k) <= k);
    }
    case 'pillars': {
      const gap = rng.pick([1, 3, 5]);
      return all.filter(([, c]) => c !== gap && c !== COLS - 1 - gap);
    }
    case 'slide':
      // Narrower rows, so they have room to slide.
      return all.filter(([, c]) => c >= 1 && c <= COLS - 2);
    default:
      return all;
  }
}

/** Deal a level: brick wall, paddle and ball, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const n = brickCount(d);
  const tough = byLevel(d, [0, 0, 0.15, 0.25, 0.35]);
  const spots = cells(kind, rng);
  // Expert and up: a couple of steel bricks in the way, on top of the breakable ones.
  const steel = d >= 4 && kind !== 'slide' && kind !== 'fortress' && spots.length >= n + 2 ? 2 : 0;
  const used = spots.slice(0, n + steel);
  // A sparse layout that can't fit them all makes up for it with tougher bricks.
  const extraTough = n + steel - used.length;
  // Every palette colour but the paddle's (the accent, --p2), so the paddle never blends into a row.
  const colours = rng.shuffle([0, 2, 3, 4, 5, 6, 7]);
  const bricks: Brick[] = used.map(([r, c], i) => {
    const x = MARGIN + c * (BRICK_W + GAP);
    return {
      x,
      x0: x,
      y: TOP + r * (BRICK_H + GAP),
      w: BRICK_W,
      h: BRICK_H,
      row: r,
      hp: i < extraTough || rng.chance(tough) ? 2 : 1,
      c: colours[r % colours.length],
      trait: 'plain',
    };
  });
  // Special bricks: a few gifts everywhere, bombs (lots in a minefield).
  const plain = rng.shuffle(bricks.slice());
  for (let i = 0; i < steel; i++) Object.assign(plain.pop()!, { trait: 'steel', hp: 1, c: 1 });
  const gifts = byLevel(d, [3, 3, 2, 2, 2]);
  const bombs = kind === 'minefield' ? Math.round(n / 5) : byLevel(d, [1, 1, 2, 2, 2]);
  for (let i = 0; i < gifts && plain.length; i++) Object.assign(plain.pop()!, { trait: 'gift', hp: 1 });
  for (let i = 0; i < bombs && plain.length; i++) Object.assign(plain.pop()!, { trait: 'bomb', hp: 1 });
  // A fortress hides its wall behind a steel rampart with two gaps.
  if (kind === 'fortress') {
    const below = Math.max(...bricks.map((b) => b.row)) + 1;
    const gaps = new Set([rng.int(0, 2), rng.int(4, 6)]);
    for (let c = 0; c < COLS; c++) {
      if (gaps.has(c)) continue;
      const x = MARGIN + c * (BRICK_W + GAP);
      bricks.push({ x, x0: x, y: TOP + below * (BRICK_H + GAP) + 8, w: BRICK_W, h: BRICK_H, row: below, hp: 1, c: 1, trait: 'steel' });
    }
  }
  const pw = byLevel(d, [84, 74, 64, 56, 50]);
  const speed = byLevel(d, [230, 260, 290, 320, 350]);
  return {
    d,
    kind,
    bricks,
    px: W / 2,
    pw,
    pw0: pw,
    target: null,
    dir: 0,
    balls: [{ x: W / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0 }],
    speed,
    held: true,
    hold: HOLD_S,
    aim: rollAim(rng),
    lives: LIVES,
    score: 0,
    combo: 0,
    streak: 0,
    streakLeft: 0,
    tier: 0,
    wide: 0,
    fire: 0,
    capsules: [],
    t: 0,
    rng,
  };
}

/** Bricks still needed to clear (steel ones don't count). */
export const left = (s: State) => s.bricks.reduce((n, b) => n + (b.trait === 'steel' ? 0 : 1), 0);

/** Score for clearing with lives to spare. */
export const LIFE_BONUS = 150;

/** What one step changed, for the card (score, hearts, end of run). */
export interface StepEvents {
  hit: boolean;
  /** Bricks blown up by bombs this step (centres). */
  blasts: { x: number; y: number }[];
  /** A streak milestone reached this step (1-based), with what it unlocked; 0 for none. */
  tier: number;
  unlocked: Power | null;
  /** A capsule caught this step. */
  caught: Power | null;
  /** A ball fell but others are still in play. */
  lostBall: boolean;
  lostLife: boolean;
  cleared: boolean;
  over: boolean;
}

/** A launch angle from the seed: up to 30° either side of straight up. */
const rollAim = (rng: Rng) => (rng.next() - 0.5) * (Math.PI / 3);

/** Launch the ball off the paddle now (tap or Space), at the angle rolled for it. */
export function launch(s: State) {
  if (!s.held) return;
  s.held = false;
  const a = s.aim;
  const b = s.balls[0];
  b.vx = Math.sin(a) * s.speed;
  b.vy = -Math.cos(a) * s.speed;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Turn a power on: a wider paddle, two more balls, or a ball that smashes straight through. */
export function grant(s: State, p: Power) {
  if (p === 'wide') s.wide = WIDE_S;
  else if (p === 'fire') s.fire = FIRE_S;
  else {
    const src = s.held ? null : s.balls[0];
    for (const da of [-0.5, 0.5]) {
      if (s.balls.length >= MAX_BALLS) break;
      const x = src?.x ?? s.px;
      const y = src?.y ?? PADDLE_Y - BALL_R * 3;
      const a = (src ? Math.atan2(src.vx, -src.vy) : 0) + da;
      s.balls.push({ x, y, vx: Math.sin(a) * s.speed, vy: -Math.abs(Math.cos(a)) * s.speed });
    }
  }
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    hit: false,
    blasts: [],
    tier: 0,
    unlocked: null,
    caught: null,
    lostBall: false,
    lostLife: false,
    cleared: false,
    over: false,
  };
  s.t += dt;
  s.wide = Math.max(0, s.wide - dt);
  s.fire = Math.max(0, s.fire - dt);
  s.pw += ((s.wide > 0 ? s.pw0 * 1.5 : s.pw0) - s.pw) * Math.min(1, dt * 8);
  if (s.streak && (s.streakLeft -= dt) <= 0) s.streak = s.tier = 0;
  // Paddle: straight to the pointer, or at a steady speed with the keys.
  if (s.target != null) s.px = s.target;
  else s.px += s.dir * KEY_SPEED * dt;
  s.px = clamp(s.px, s.pw / 2, W - s.pw / 2);

  // Sliding rows: every other row glides from side to side.
  if (s.kind === 'slide') {
    const amp = BRICK_W + GAP;
    for (const b of s.bricks) b.x = b.x0 + Math.sin(s.t * 0.9 + b.row * 1.3) * amp * (b.row % 2 ? 1 : -1);
  }

  // Capsules fall; the paddle catches them.
  for (let i = s.capsules.length - 1; i >= 0; i--) {
    const c = s.capsules[i];
    c.y += CAPSULE_SPEED * dt;
    if (c.y >= PADDLE_Y - 4 && c.y <= PADDLE_Y + PADDLE_H + 4 && Math.abs(c.x - s.px) <= s.pw / 2 + 8) {
      s.capsules.splice(i, 1);
      grant(s, c.power);
      ev.caught = c.power;
    } else if (c.y > H + 10) s.capsules.splice(i, 1);
  }

  if (s.held) {
    const b = s.balls[0];
    b.x = s.px;
    b.y = PADDLE_Y - BALL_R;
    s.hold -= dt;
    if (s.hold <= 0) launch(s);
    return ev;
  }

  for (let bi = s.balls.length - 1; bi >= 0; bi--) {
    const ball = s.balls[bi];
    if (moveBall(s, ball, dt, ev)) return ev;
    if (ball.y - BALL_R > H) {
      s.balls.splice(bi, 1);
      if (s.balls.length) ev.lostBall = true;
    }
  }
  if (!s.balls.length) {
    s.lives--;
    s.combo = s.streak = s.tier = 0;
    s.wide = s.fire = 0;
    s.capsules = [];
    ev.lostLife = true;
    if (s.lives <= 0) {
      ev.over = true;
      s.balls = [{ x: s.px, y: H + BALL_R * 2, vx: 0, vy: 0 }];
      return ev;
    }
    s.held = true;
    s.hold = HOLD_S;
    s.aim = rollAim(s.rng);
    s.balls = [{ x: s.px, y: PADDLE_Y - BALL_R, vx: 0, vy: 0 }];
  }
  return ev;
}

/** Move one ball by `dt` in sub-steps. True when the level just got cleared. */
function moveBall(s: State, ball: Ball, dt: number, ev: StepEvents): boolean {
  // Sub-steps of at most half a ball radius, so the ball never tunnels through a brick or the paddle.
  const dist = Math.hypot(ball.vx, ball.vy) * dt;
  const n = Math.max(1, Math.ceil(dist / (BALL_R / 2)));
  for (let i = 0; i < n; i++) {
    ball.x += (ball.vx * dt) / n;
    ball.y += (ball.vy * dt) / n;
    if (ball.x < BALL_R) {
      ball.x = BALL_R;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x > W - BALL_R) {
      ball.x = W - BALL_R;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y < BALL_R) {
      ball.y = BALL_R;
      ball.vy = Math.abs(ball.vy);
    }
    // Paddle: the bounce angle follows where the ball lands on it (edges send it sideways).
    if (ball.vy > 0 && ball.y + BALL_R >= PADDLE_Y && ball.y < PADDLE_Y + PADDLE_H && Math.abs(ball.x - s.px) <= s.pw / 2 + BALL_R) {
      const rel = clamp((ball.x - s.px) / (s.pw / 2), -1, 1);
      const a = rel * (Math.PI / 3);
      const sp = Math.hypot(ball.vx, ball.vy);
      ball.vx = Math.sin(a) * sp;
      ball.vy = -Math.cos(a) * sp;
      ball.y = PADDLE_Y - BALL_R;
      s.combo = 0;
    }
    if (hitBrick(s, ball, ev)) {
      ev.hit = true;
      if (!left(s)) {
        s.score += s.lives * LIFE_BONUS;
        ev.cleared = true;
        return true;
      }
    }
  }
  return false;
}

/** Break brick `b` (already out of hits): score it, count the streak, drop its gift, set off its bomb. */
function breakBrick(s: State, b: Brick, ev: StepEvents) {
  const i = s.bricks.indexOf(b);
  if (i < 0) return;
  s.bricks.splice(i, 1);
  s.combo++;
  s.score += 10 * s.combo;
  s.streak++;
  s.streakLeft = STREAK_WINDOW;
  if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
    s.tier++;
    const p: Power = (['wide', 'multi', 'fire', 'multi', 'fire'] as const)[s.tier - 1];
    grant(s, p);
    ev.tier = s.tier;
    ev.unlocked = p;
  }
  if (b.trait === 'gift') s.capsules.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, power: s.rng.pick(['wide', 'multi', 'fire'] as const) });
  if (b.trait === 'bomb') {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ev.blasts.push({ x: cx, y: cy });
    for (const o of s.bricks.slice()) {
      if (o.trait === 'steel') continue;
      if (Math.abs(o.x + o.w / 2 - cx) <= BRICK_W * 1.6 && Math.abs(o.y + o.h / 2 - cy) <= BRICK_H * 1.8) breakBrick(s, o, ev);
    }
  }
}

/** Bounce off the first brick the ball overlaps, along the axis it went in least. True on a hit. */
function hitBrick(s: State, ball: Ball, ev: StepEvents): boolean {
  for (const b of s.bricks) {
    const nx = clamp(ball.x, b.x, b.x + b.w);
    const ny = clamp(ball.y, b.y, b.y + b.h);
    if ((ball.x - nx) ** 2 + (ball.y - ny) ** 2 > BALL_R * BALL_R) continue;
    // A fireball smashes straight through anything but steel.
    const smash = s.fire > 0 && b.trait !== 'steel';
    if (!smash) {
      const overX = Math.min(ball.x + BALL_R - b.x, b.x + b.w - (ball.x - BALL_R));
      const overY = Math.min(ball.y + BALL_R - b.y, b.y + b.h - (ball.y - BALL_R));
      if (overX < overY) ball.vx = ball.x < b.x + b.w / 2 ? -Math.abs(ball.vx) : Math.abs(ball.vx);
      else ball.vy = ball.y < b.y + b.h / 2 ? -Math.abs(ball.vy) : Math.abs(ball.vy);
    }
    if (b.trait === 'steel') return true;
    b.hp = smash ? 0 : b.hp - 1;
    if (b.hp <= 0) {
      breakBrick(s, b, ev);
      // A little faster with every brick, up to +25%.
      const sp = Math.hypot(ball.vx, ball.vy);
      const to = Math.min(sp * 1.01, s.speed * 1.25);
      ball.vx *= to / sp;
      ball.vy *= to / sp;
    } else s.score += 5;
    return true;
  }
  return false;
}
