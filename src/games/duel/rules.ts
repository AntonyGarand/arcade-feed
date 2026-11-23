import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units (the canvas scales it to the card). */
export const W = 300;
export const H = 400;
export const BALL_R = 6;
export const PADDLE_H = 10;
/** Top edge of the player's paddle (bottom) and of the rival's (top). */
export const YOU_Y = 368;
export const AI_Y = 22;
/** Seconds the ball waits in the middle before a serve. */
const SERVE_S = 1.1;
/** Keyboard paddle speed, and the fastest a dragged paddle catches up with the finger. */
const KEY_SPEED = 400;
const DRAG_SPEED = 1100;
/** Steepest bounce off a paddle edge, from straight up or down. */
const MAX_ANGLE = Math.PI / 3;
/** Speed-up per paddle hit, and the cap (× the serve speed). */
const SPEED_UP = 1.06;
const SPEED_CAP = 1.75;

/** Points per point won, per hit in the rally that won it (up to 10), per point of margin at the end. */
export const POINT = 100;
export const RALLY_POINTS = 10;
const RALLY_CAP = 10;
export const MARGIN_BONUS = 100;

export const goalFor = (d: Difficulty) => byLevel(d, [3, 3, 4, 4, 5]);
const serveSpeedFor = (d: Difficulty) => byLevel(d, [210, 230, 250, 270, 290]);
const youWidthFor = (d: Difficulty) => byLevel(d, [80, 74, 70, 66, 62]);
const aiWidthFor = (d: Difficulty) => byLevel(d, [56, 56, 56, 54, 54]);
/** The rival: seconds before it reacts, top speed, aim error (world units) and how often it aims for a corner. */
export const aiFor = (d: Difficulty) => ({
  react: byLevel(d, [0.3, 0.25, 0.2, 0.16, 0.12]),
  speed: byLevel(d, [170, 195, 220, 240, 260]),
  error: byLevel(d, [30, 27, 24, 21, 18]),
  aim: byLevel(d, [0, 0.25, 0.4, 0.55, 0.7]),
});

export interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Sideways sway (0 = still) around `x0`, and which way it starts. */
  amp: number;
  x0: number;
  phase: number;
}

export interface State {
  d: Difficulty;
  /** Player paddle centre and width; where the finger wants it (or null), keyboard direction held. */
  px: number;
  pw: number;
  target: number | null;
  dir: number;
  /** Rival paddle centre, width, where it heads, and its reaction countdown. */
  ax: number;
  aw: number;
  aiTarget: number;
  aiWait: number;
  /** The rival already planned for this approach of the ball. */
  aiPlanned: boolean;
  ai: ReturnType<typeof aiFor>;
  bx: number;
  by: number;
  vx: number;
  vy: number;
  /** Serve speed and the ball's current speed. */
  base: number;
  speed: number;
  /** Seconds until the next serve (0 while the ball is in play); which way it goes. */
  serve: number;
  serveDown: boolean;
  you: number;
  them: number;
  goal: number;
  /** Player hits in the current rally. */
  rally: number;
  /** Longest rally so far (for the status line). */
  best: number;
  /** Mid-field blocks the ball bounces off (Expert: one, Master: a mirrored pair that sway). */
  blocks: Block[];
  time: number;
  score: number;
  done: boolean;
  rng: Rng;
}

export interface Events {
  /** Who touched the ball this step. */
  hit: 'you' | 'ai' | '';
  wall: boolean;
  /** Who scored this step. */
  point: 'you' | 'ai' | '';
  won: boolean;
  over: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Set up a match: paddles, serve and (from Expert on) blocks in mid-field, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const blocks: Block[] = [];
  if (d >= 4) {
    const w = byLevel(d, [0, 0, 0, 60, 46]);
    const x0 = rng.int(70, W - 70);
    const amp = d === 5 ? rng.int(35, 55) : 0;
    const make = (x: number, y: number, phase: number): Block => ({ x: x - w / 2, y: y - 7, w, h: 14, amp, x0: x, phase });
    // One block on the rival's side; at Master a mirrored twin on yours, swaying the other way.
    if (d === 5) blocks.push(make(x0, H / 2 - 60, 0), make(W - x0, H / 2 + 60, Math.PI));
    else blocks.push(make(x0, H / 2 - 50, 0));
  }
  const base = serveSpeedFor(d);
  return {
    d,
    px: W / 2,
    pw: youWidthFor(d),
    target: null,
    dir: 0,
    ax: W / 2,
    aw: aiWidthFor(d),
    aiTarget: W / 2,
    aiWait: 0,
    aiPlanned: false,
    ai: aiFor(d),
    bx: W / 2,
    by: H / 2,
    vx: 0,
    vy: 0,
    base,
    speed: base,
    serve: SERVE_S,
    serveDown: true,
    you: 0,
    them: 0,
    goal: goalFor(d),
    rally: 0,
    best: 0,
    blocks,
    time: 0,
    score: 0,
    done: false,
    rng,
  };
}

/** Where a block sits at time `t` (they sway at Master). */
export function blockAt(b: Block, t: number): Block {
  if (!b.amp) return b;
  return { ...b, x: b.x0 - b.w / 2 + Math.sin(t * 0.9 + b.phase) * b.amp };
}

/** Bounce a ball off the block if they overlap (along the axis it went in least). True on a hit. */
function bounceBlock(o: { bx: number; by: number; vx: number; vy: number }, b: Block): boolean {
  const nx = clamp(o.bx, b.x, b.x + b.w);
  const ny = clamp(o.by, b.y, b.y + b.h);
  if ((o.bx - nx) ** 2 + (o.by - ny) ** 2 > BALL_R * BALL_R) return false;
  const overX = Math.min(o.bx + BALL_R - b.x, b.x + b.w - (o.bx - BALL_R));
  const overY = Math.min(o.by + BALL_R - b.y, b.y + b.h - (o.by - BALL_R));
  if (overX < overY) {
    o.vx = o.bx < b.x + b.w / 2 ? -Math.abs(o.vx) : Math.abs(o.vx);
    o.bx = o.bx < b.x + b.w / 2 ? b.x - BALL_R : b.x + b.w + BALL_R;
  } else {
    o.vy = o.by < b.y + b.h / 2 ? -Math.abs(o.vy) : Math.abs(o.vy);
    o.by = o.by < b.y + b.h / 2 ? b.y - BALL_R : b.y + b.h + BALL_R;
  }
  return true;
}

/** Move a ball by `dt` against the side walls and the blocks. True if it bounced off something. */
function fly(o: { bx: number; by: number; vx: number; vy: number }, dt: number, blocks: readonly Block[], t: number): boolean {
  o.bx += o.vx * dt;
  o.by += o.vy * dt;
  let hit = false;
  if (o.bx < BALL_R) {
    o.bx = BALL_R;
    o.vx = Math.abs(o.vx);
    hit = true;
  } else if (o.bx > W - BALL_R) {
    o.bx = W - BALL_R;
    o.vx = -Math.abs(o.vx);
    hit = true;
  }
  for (const b of blocks) if (bounceBlock(o, blockAt(b, t))) hit = true;
  return hit;
}

/** Where the ball will cross height `y` (walls and blocks included), or its x now if it is going away. */
export function predict(s: State, y: number): number {
  const o = { bx: s.bx, by: s.by, vx: s.vx, vy: s.vy };
  const dt = 1 / 120;
  for (let t = 0; t < 4; t += dt) {
    if ((o.vy > 0 && o.by >= y) || (o.vy < 0 && o.by <= y) || !o.vy) return o.bx;
    fly(o, dt, s.blocks, s.time + t);
  }
  return o.bx;
}

/** Send the ball off from the middle, towards whoever conceded the last point. */
function launch(s: State) {
  const a = (s.rng.next() - 0.5) * (Math.PI / 3);
  s.speed = s.base;
  s.vx = Math.sin(a) * s.speed;
  s.vy = (s.serveDown ? 1 : -1) * Math.cos(a) * s.speed;
  s.rally = 0;
  s.aiPlanned = false;
}

/** The rival: once the ball heads its way it waits, then picks a spot (with an error) and slides there. */
function think(s: State, dt: number) {
  if (s.serve > 0 || s.vy > 0) {
    // Ball going away: drift back towards the middle.
    s.aiPlanned = false;
    s.aiWait = s.ai.react;
    s.aiTarget = W / 2 + (s.bx - W / 2) * 0.3;
  } else if (!s.aiPlanned) {
    s.aiWait -= dt;
    if (s.aiWait <= 0) {
      s.aiPlanned = true;
      // Faster balls make it sloppier.
      const err = (s.rng.next() + s.rng.next() - 1) * 2 * s.ai.error * (s.speed / s.base);
      let aim = 0;
      if (s.rng.chance(s.ai.aim)) aim = (s.px < W / 2 ? -1 : 1) * s.aw * 0.35;
      s.aiTarget = predict(s, AI_Y + PADDLE_H + BALL_R) + err + aim;
    }
  }
  const dx = clamp(s.aiTarget - s.ax, -s.ai.speed * dt, s.ai.speed * dt);
  s.ax = clamp(s.ax + dx, s.aw / 2, W - s.aw / 2);
}

/** Bounce off a paddle: the further from its centre, the steeper; a little faster each time. */
function paddleBounce(s: State, centre: number, width: number, up: boolean) {
  const rel = clamp((s.bx - centre) / (width / 2), -1, 1);
  const a = rel * MAX_ANGLE;
  s.speed = Math.min(s.speed * SPEED_UP, s.base * SPEED_CAP);
  s.vx = Math.sin(a) * s.speed;
  s.vy = (up ? -1 : 1) * Math.cos(a) * s.speed;
}

/** Advance the match by `dt` seconds. */
export function step(s: State, dt: number): Events {
  const ev: Events = { hit: '', wall: false, point: '', won: false, over: false };
  if (s.done) return ev;
  s.time += dt;
  // Player paddle: towards the finger (fast, not instant), or at a steady speed with the keys.
  if (s.target != null) s.px += clamp(s.target - s.px, -DRAG_SPEED * dt, DRAG_SPEED * dt);
  else s.px += s.dir * KEY_SPEED * dt;
  s.px = clamp(s.px, s.pw / 2, W - s.pw / 2);
  think(s, dt);

  if (s.serve > 0) {
    s.serve -= dt;
    if (s.serve <= 0) {
      s.serve = 0;
      launch(s);
    }
    return ev;
  }

  // Sub-steps of at most half a ball radius, so the ball never tunnels through a paddle.
  const n = Math.max(1, Math.ceil((s.speed * dt) / (BALL_R / 2)));
  for (let i = 0; i < n; i++) {
    if (fly(s, dt / n, s.blocks, s.time)) ev.wall = true;
    if (s.vy > 0 && s.by + BALL_R >= YOU_Y && s.by < YOU_Y + PADDLE_H && Math.abs(s.bx - s.px) <= s.pw / 2 + BALL_R) {
      paddleBounce(s, s.px, s.pw, true);
      s.by = YOU_Y - BALL_R;
      s.rally++;
      s.best = Math.max(s.best, s.rally);
      ev.hit = 'you';
    } else if (s.vy < 0 && s.by - BALL_R <= AI_Y + PADDLE_H && s.by > AI_Y && Math.abs(s.bx - s.ax) <= s.aw / 2 + BALL_R) {
      paddleBounce(s, s.ax, s.aw, false);
      s.by = AI_Y + PADDLE_H + BALL_R;
      ev.hit = 'ai';
    }
    const out = s.by - BALL_R > H ? 'ai' : s.by + BALL_R < 0 ? 'you' : '';
    if (out) {
      ev.point = out;
      if (out === 'you') {
        s.you++;
        s.score += POINT + Math.min(s.rally, RALLY_CAP) * RALLY_POINTS;
      } else s.them++;
      if (s.you >= s.goal || s.them >= s.goal) {
        s.done = true;
        if (s.you >= s.goal) {
          s.score += (s.goal - s.them) * MARGIN_BONUS;
          ev.won = true;
        } else ev.over = true;
        return ev;
      }
      s.serve = SERVE_S;
      s.serveDown = out === 'ai';
      s.bx = W / 2;
      s.by = H / 2;
      s.vx = 0;
      s.vy = 0;
      return ev;
    }
  }
  return ev;
}
