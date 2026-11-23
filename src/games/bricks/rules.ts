import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units (the canvas scales it to the card). */
export const W = 300;
export const H = 400;
const COLS = 7;
export const LIVES = 3;
const MARGIN = 10;
const GAP = 4;
const TOP = 44;
const BRICK_H = 16;
export const BALL_R = 6;
export const PADDLE_Y = 366;
export const PADDLE_H = 12;
/** Seconds the ball rests on the paddle before it launches by itself. */
const HOLD_S = 0.9;
/** Keyboard paddle speed (world units per second). */
const KEY_SPEED = 380;

const rowsFor = (d: Difficulty) => byLevel(d, [3, 4, 5, 5, 6]);
export const brickCount = (d: Difficulty) => rowsFor(d) * COLS;

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Hits left (2 = tough brick). */
  hp: number;
  /** Palette index. */
  c: number;
}

export interface State {
  d: Difficulty;
  bricks: Brick[];
  px: number;
  pw: number;
  /** Where the player wants the paddle (pointer), or null for keyboard control. */
  target: number | null;
  /** Keyboard direction held: -1, 0 or 1. */
  dir: number;
  bx: number;
  by: number;
  vx: number;
  vy: number;
  speed: number;
  /** Ball resting on the paddle, launching after `hold` seconds. */
  held: boolean;
  hold: number;
  lives: number;
  score: number;
  /** Bricks hit since the ball last touched the paddle (the next hit scores ×combo). */
  combo: number;
  rng: Rng;
}

/** Deal a level: brick wall, paddle and ball, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const rows = rowsFor(d);
  const tough = byLevel(d, [0, 0, 0.15, 0.25, 0.35]);
  const bw = (W - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
  const bricks: Brick[] = [];
  const colours = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < COLS; c++)
      bricks.push({
        x: MARGIN + c * (bw + GAP),
        y: TOP + r * (BRICK_H + GAP),
        w: bw,
        h: BRICK_H,
        hp: rng.chance(tough) ? 2 : 1,
        c: colours[r % 8],
      });
  const pw = byLevel(d, [84, 74, 64, 56, 50]);
  const speed = byLevel(d, [230, 260, 290, 320, 350]);
  return {
    d,
    bricks,
    px: W / 2,
    pw,
    target: null,
    dir: 0,
    bx: W / 2,
    by: PADDLE_Y - BALL_R,
    vx: 0,
    vy: 0,
    speed,
    held: true,
    hold: HOLD_S,
    lives: LIVES,
    score: 0,
    combo: 0,
    rng,
  };
}

/** Score for clearing with lives to spare. */
export const LIFE_BONUS = 150;

/** What one step changed, for the card (score, hearts, end of run). */
export interface StepEvents {
  hit: boolean;
  lostLife: boolean;
  cleared: boolean;
  over: boolean;
}

/** Launch the ball off the paddle now (tap or Space), at an angle from the seed. */
export function launch(s: State) {
  if (!s.held) return;
  s.held = false;
  const a = (s.rng.next() - 0.5) * (Math.PI / 3); // ±30° from straight up
  s.vx = Math.sin(a) * s.speed;
  s.vy = -Math.cos(a) * s.speed;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { hit: false, lostLife: false, cleared: false, over: false };
  // Paddle: straight to the pointer, or at a steady speed with the keys.
  if (s.target != null) s.px = s.target;
  else s.px += s.dir * KEY_SPEED * dt;
  s.px = clamp(s.px, s.pw / 2, W - s.pw / 2);

  if (s.held) {
    s.bx = s.px;
    s.by = PADDLE_Y - BALL_R;
    s.hold -= dt;
    if (s.hold <= 0) launch(s);
    return ev;
  }

  // Sub-steps of at most half a ball radius, so the ball never tunnels through a brick or the paddle.
  const dist = Math.hypot(s.vx, s.vy) * dt;
  const n = Math.max(1, Math.ceil(dist / (BALL_R / 2)));
  for (let i = 0; i < n; i++) {
    s.bx += (s.vx * dt) / n;
    s.by += (s.vy * dt) / n;
    if (s.bx < BALL_R) {
      s.bx = BALL_R;
      s.vx = Math.abs(s.vx);
    } else if (s.bx > W - BALL_R) {
      s.bx = W - BALL_R;
      s.vx = -Math.abs(s.vx);
    }
    if (s.by < BALL_R) {
      s.by = BALL_R;
      s.vy = Math.abs(s.vy);
    }
    // Paddle: the bounce angle follows where the ball lands on it (edges send it sideways).
    if (s.vy > 0 && s.by + BALL_R >= PADDLE_Y && s.by < PADDLE_Y + PADDLE_H && Math.abs(s.bx - s.px) <= s.pw / 2 + BALL_R) {
      const rel = clamp((s.bx - s.px) / (s.pw / 2), -1, 1);
      const a = rel * (Math.PI / 3);
      const sp = Math.hypot(s.vx, s.vy);
      s.vx = Math.sin(a) * sp;
      s.vy = -Math.cos(a) * sp;
      s.by = PADDLE_Y - BALL_R;
      s.combo = 0;
    }
    if (hitBrick(s)) {
      ev.hit = true;
      if (!s.bricks.length) {
        s.score += s.lives * LIFE_BONUS;
        ev.cleared = true;
        return ev;
      }
    }
    if (s.by - BALL_R > H) {
      s.lives--;
      s.combo = 0;
      ev.lostLife = true;
      if (s.lives <= 0) {
        ev.over = true;
        return ev;
      }
      s.held = true;
      s.hold = HOLD_S;
      s.bx = s.px;
      s.by = PADDLE_Y - BALL_R;
      return ev;
    }
  }
  return ev;
}

/** Bounce off the first brick the ball overlaps, along the axis it went in least. True on a hit. */
function hitBrick(s: State): boolean {
  for (let i = 0; i < s.bricks.length; i++) {
    const b = s.bricks[i];
    const nx = clamp(s.bx, b.x, b.x + b.w);
    const ny = clamp(s.by, b.y, b.y + b.h);
    if ((s.bx - nx) ** 2 + (s.by - ny) ** 2 > BALL_R * BALL_R) continue;
    const overX = Math.min(s.bx + BALL_R - b.x, b.x + b.w - (s.bx - BALL_R));
    const overY = Math.min(s.by + BALL_R - b.y, b.y + b.h - (s.by - BALL_R));
    if (overX < overY) s.vx = s.bx < b.x + b.w / 2 ? -Math.abs(s.vx) : Math.abs(s.vx);
    else s.vy = s.by < b.y + b.h / 2 ? -Math.abs(s.vy) : Math.abs(s.vy);
    b.hp--;
    if (b.hp <= 0) {
      s.bricks.splice(i, 1);
      s.combo++;
      s.score += 10 * s.combo;
      // A little faster with every brick, up to +25%.
      const sp = Math.hypot(s.vx, s.vy);
      const to = Math.min(sp * 1.01, s.speed * 1.25);
      s.vx *= to / sp;
      s.vy *= to / sp;
    } else s.score += 5;
    return true;
  }
  return false;
}
