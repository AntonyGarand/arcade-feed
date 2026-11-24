import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units (the canvas scales it to the card). */
export const W = 300;
export const H = 400;
export const BALL_R = 6;
export const PADDLE_H = 10;
/** Top edge of the player's paddle (bottom) and of the rival's (top). */
export const YOU_Y = 368;
export const AI_Y = 22;
/** Seconds the ball waits in the middle before a serve. */
export const SERVE_S = 1.1;
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
/** Points for sending the ball through a bonus star (Bullseye). */
export const TARGET_POINTS = 10;

/** Returns in a row (without conceding a point) that fire a combo event, and what each one unlocks. */
export const STREAK_TIERS = [4, 8, 13, 20, 28] as const;
export type Power = 'wide' | 'smash' | 'shrink' | 'double';
const TIER_POWERS: readonly Power[] = ['wide', 'smash', 'shrink', 'double', 'smash'];
/** Seconds a wide paddle or a shrunken rival lasts; smash shots granted at once. */
export const WIDE_S = 10;
export const SHRINK_S = 10;
export const SMASH_N = 3;
const WIDE_K = 1.4;
const SHRINK_K = 0.65;
/** Speed of a smash shot (× the serve speed), past the usual cap. */
const SMASH_SPEED = 2;
/** Shrink kind: how much both paddles narrow per hit of a rally, and the narrowest they get. */
const SQUEEZE_STEP = 0.05;
const SQUEEZE_MIN = 0.65;

/** The kinds of match a level can deal: rival styles and mid-field twists. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'wall' },
  { id: 'smasher', min: 2 },
  { id: 'bumpers', min: 2 },
  { id: 'shrink', min: 3 },
  { id: 'bullseye' },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

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

/** A round bumper in mid-field: the ball bounces straight off it. */
interface Bumper {
  x: number;
  y: number;
  r: number;
}

/** A bonus star: send the ball through it (after your hit) for points and a combo step. */
interface Target {
  x: number;
  y: number;
  r: number;
  /** Seconds before it shows up again after being taken (0 = up). */
  cool: number;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  /** Player paddle centre, width now and without powers or squeeze; where the finger wants it (or null), keyboard direction held. */
  px: number;
  pw: number;
  pw0: number;
  target: number | null;
  dir: number;
  /** Rival paddle centre, width (now and base), where it heads, and its reaction countdown. */
  ax: number;
  aw: number;
  aw0: number;
  aiTarget: number;
  aiWait: number;
  /** The rival already planned for this approach of the ball. */
  aiPlanned: boolean;
  /** The rival's style; `smash` is how much harder its returns speed the ball up (1 = normal). */
  ai: ReturnType<typeof aiFor> & { smash: number };
  /** Shrink kind: the paddles narrow with each hit of a rally (rival 1 → 0.65, yours half as much), back to full at the serve. */
  squeeze: number;
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
  bumpers: Bumper[];
  targets: Target[];
  /** Who touched the ball last. */
  last: 'you' | 'ai' | '';
  /** Combo: your returns in a row without conceding (plus stars taken), and the milestones reached. */
  streak: number;
  tier: number;
  /** Powers: seconds of wide paddle and of shrunken rival, smash shots left, next point doubled. */
  wide: number;
  shrink: number;
  smash: number;
  double: boolean;
  /** The ball in play is a smash shot: the rival misreads it. */
  hot: boolean;
  time: number;
  score: number;
  done: boolean;
  rng: Rng;
}

export interface Events {
  /** Who touched the ball this step. */
  hit: 'you' | 'ai' | '';
  wall: boolean;
  /** The bumper the ball bounced off this step. */
  bump: Bumper | null;
  /** Where a bonus star was taken this step. */
  star: { x: number; y: number } | null;
  /** A combo milestone reached this step (1-based) and the power it unlocked; 0 / null for none. */
  tier: number;
  unlocked: Power | null;
  /** Who scored this step. */
  point: 'you' | 'ai' | '';
  won: boolean;
  over: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Up to `n` spots in mid-field, at least `gap` apart and clear of the serve spot. */
function spots(rng: Rng, n: number, gap: number, xm: number, y0: number, y1: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    const p = { x: rng.int(xm, W - xm), y: rng.int(y0, y1) };
    if (Math.hypot(p.x - W / 2, p.y - H / 2) < 48) continue;
    if (out.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < gap)) continue;
    out.push(p);
  }
  return out;
}

/** Set up a match: its kind, rival, paddles, serve and mid-field pieces, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const blocks: Block[] = [];
  const bumpers: Bumper[] = [];
  const targets: Target[] = [];
  if (kind === 'bumpers') {
    for (const p of spots(rng, byLevel(d, [2, 2, 3, 3, 3]), 80, 50, 120, 280)) bumpers.push({ ...p, r: 12 });
  } else if (kind === 'bullseye') {
    for (const p of spots(rng, 2, 60, 30, 110, 290)) targets.push({ ...p, r: 11, cool: 0 });
  } else if (d >= 4) {
    const w = byLevel(d, [0, 0, 0, 60, 46]);
    const x0 = rng.int(70, W - 70);
    const amp = d === 5 ? rng.int(35, 55) : 0;
    const make = (x: number, y: number, phase: number): Block => ({ x: x - w / 2, y: y - 7, w, h: 14, amp, x0: x, phase });
    // One block on the rival's side; at Master a mirrored twin on yours, swaying the other way.
    if (d === 5) blocks.push(make(x0, H / 2 - 60, 0), make(W - x0, H / 2 + 60, Math.PI));
    else blocks.push(make(x0, H / 2 - 50, 0));
  }
  const base = serveSpeedFor(d);
  // Rival styles: a wide but slow wall; a smasher that speeds the ball up but misreads more.
  const ai = { ...aiFor(d), smash: 1 };
  let aw = aiWidthFor(d);
  if (kind === 'wall') {
    aw = Math.round(aw * 1.45);
    Object.assign(ai, { speed: ai.speed * 0.62, react: ai.react + 0.06, aim: 0 });
  } else if (kind === 'smasher') Object.assign(ai, { smash: 1.14, error: ai.error * 1.3, aim: Math.min(0.85, ai.aim + 0.25) });
  const pw = youWidthFor(d);
  return {
    d,
    kind,
    px: W / 2,
    pw,
    pw0: pw,
    target: null,
    dir: 0,
    ax: W / 2,
    aw,
    aw0: aw,
    aiTarget: W / 2,
    aiWait: 0,
    aiPlanned: false,
    ai,
    squeeze: 1,
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
    bumpers,
    targets,
    last: '',
    streak: 0,
    tier: 0,
    wide: 0,
    shrink: 0,
    smash: 0,
    double: false,
    hot: false,
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

type Ball = { bx: number; by: number; vx: number; vy: number };

/** Bounce a ball off the block if they overlap (along the axis it went in least). True on a hit. */
function bounceBlock(o: Ball, b: Block): boolean {
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

/** Bounce a ball straight off a round bumper (same speed, never too flat). True on a hit. */
function bounceBumper(o: Ball, b: Bumper): boolean {
  const dx = o.bx - b.x;
  const dy = o.by - b.y;
  const dist = Math.hypot(dx, dy);
  const reach = b.r + BALL_R;
  if (dist >= reach || dist === 0) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  o.bx = b.x + nx * reach;
  o.by = b.y + ny * reach;
  const dot = o.vx * nx + o.vy * ny;
  if (dot >= 0) return false;
  const sp = Math.hypot(o.vx, o.vy);
  o.vx -= 2 * dot * nx;
  o.vy -= 2 * dot * ny;
  // Keep it heading for an end: at least a third of its speed goes up or down.
  const minVy = sp * 0.35;
  if (Math.abs(o.vy) < minVy) {
    o.vy = (o.vy < 0 || (o.vy === 0 && ny < 0) ? -1 : 1) * minVy;
    o.vx = (Math.sign(o.vx) || Math.sign(nx) || 1) * Math.sqrt(sp * sp - minVy * minVy);
  }
  return true;
}

/** Move a ball by `dt` against the side walls, blocks and bumpers: the bumper it hit, true for a wall or block, else false. */
function fly(o: Ball, dt: number, f: Pick<State, 'blocks' | 'bumpers'>, t: number): Bumper | boolean {
  o.bx += o.vx * dt;
  o.by += o.vy * dt;
  let hit: Bumper | boolean = false;
  if (o.bx < BALL_R) {
    o.bx = BALL_R;
    o.vx = Math.abs(o.vx);
    hit = true;
  } else if (o.bx > W - BALL_R) {
    o.bx = W - BALL_R;
    o.vx = -Math.abs(o.vx);
    hit = true;
  }
  for (const b of f.blocks) if (bounceBlock(o, blockAt(b, t))) hit = true;
  for (const b of f.bumpers) if (bounceBumper(o, b)) hit = b;
  return hit;
}

/** Where the ball will cross height `y` (walls, blocks and bumpers included), or its x now if it is going away. */
export function predict(s: State, y: number): number {
  const o = { bx: s.bx, by: s.by, vx: s.vx, vy: s.vy };
  const dt = 1 / 120;
  for (let t = 0; t < 4; t += dt) {
    if ((o.vy > 0 && o.by >= y) || (o.vy < 0 && o.by <= y) || !o.vy) return o.bx;
    fly(o, dt, s, s.time + t);
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
  s.hot = false;
  s.last = '';
  s.squeeze = 1;
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
      // Faster balls make it sloppier, and a smash shot fools it badly.
      const err = (s.rng.next() + s.rng.next() - 1) * 2 * s.ai.error * (s.speed / s.base) * (s.hot ? 2.2 : 1);
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
  // A smasher rival hits harder, up to a higher cap; a smash shot of yours flies at full tilt.
  const k = up ? SPEED_UP : SPEED_UP * s.ai.smash;
  const cap = s.base * (up || s.ai.smash === 1 ? SPEED_CAP : SPEED_CAP + 0.3);
  s.speed = Math.max(Math.min(s.speed * k, cap), Math.min(s.speed, cap));
  s.hot = false;
  if (up && s.smash > 0) {
    s.smash--;
    s.hot = true;
    s.speed = s.base * SMASH_SPEED;
  }
  if (s.kind === 'shrink') s.squeeze = Math.max(SQUEEZE_MIN, s.squeeze - SQUEEZE_STEP);
  s.vx = Math.sin(a) * s.speed;
  s.vy = (up ? -1 : 1) * Math.cos(a) * s.speed;
}

/** Turn a power on: a wide paddle, smash shots, a shrunken rival or a doubled next point. */
export function grant(s: State, p: Power) {
  if (p === 'wide') s.wide = WIDE_S;
  else if (p === 'shrink') s.shrink = SHRINK_S;
  else if (p === 'smash') s.smash += SMASH_N;
  else s.double = true;
}

/** Count combo steps; past a milestone, unlock its power. */
function addStreak(s: State, n: number, ev: Events) {
  s.streak += n;
  if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
    const p = TIER_POWERS[s.tier++];
    grant(s, p);
    ev.tier = s.tier;
    ev.unlocked = p;
  }
}

/** Advance the match by `dt` seconds. */
export function step(s: State, dt: number): Events {
  const ev: Events = { hit: '', wall: false, bump: null, star: null, tier: 0, unlocked: null, point: '', won: false, over: false };
  if (s.done) return ev;
  s.time += dt;
  s.wide = Math.max(0, s.wide - dt);
  s.shrink = Math.max(0, s.shrink - dt);
  // Paddles ease towards their width: powers, and the shrink kind's squeeze.
  const ease = Math.min(1, dt * 8);
  s.pw += (s.pw0 * ((1 + s.squeeze) / 2) * (s.wide > 0 ? WIDE_K : 1) - s.pw) * ease;
  s.aw += (s.aw0 * s.squeeze * (s.shrink > 0 ? SHRINK_K : 1) - s.aw) * ease;
  for (const t of s.targets) t.cool = Math.max(0, t.cool - dt);
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
    const bounced = fly(s, dt / n, s, s.time);
    if (bounced === true) ev.wall = true;
    else if (bounced) ev.bump = bounced;
    // Bonus stars: taken by a ball you sent; each comes back elsewhere a moment later.
    if (s.last === 'you')
      for (const t of s.targets)
        if (!t.cool && Math.hypot(s.bx - t.x, s.by - t.y) < t.r + BALL_R) {
          ev.star = { x: t.x, y: t.y };
          t.cool = 1.6;
          s.score += TARGET_POINTS;
          const [p] = spots(s.rng, 1, 0, 30, 110, 290);
          if (p) Object.assign(t, p);
          addStreak(s, 1, ev);
        }
    if (s.vy > 0 && s.by + BALL_R >= YOU_Y && s.by < YOU_Y + PADDLE_H && Math.abs(s.bx - s.px) <= s.pw / 2 + BALL_R) {
      paddleBounce(s, s.px, s.pw, true);
      s.by = YOU_Y - BALL_R;
      s.rally++;
      s.best = Math.max(s.best, s.rally);
      s.last = 'you';
      ev.hit = 'you';
      addStreak(s, 1, ev);
    } else if (s.vy < 0 && s.by - BALL_R <= AI_Y + PADDLE_H && s.by > AI_Y && Math.abs(s.bx - s.ax) <= s.aw / 2 + BALL_R) {
      paddleBounce(s, s.ax, s.aw, false);
      s.by = AI_Y + PADDLE_H + BALL_R;
      s.last = 'ai';
      ev.hit = 'ai';
    }
    const out = s.by - BALL_R > H ? 'ai' : s.by + BALL_R < 0 ? 'you' : '';
    if (out) {
      ev.point = out;
      if (out === 'you') {
        s.you++;
        s.score += (POINT + Math.min(s.rally, RALLY_CAP) * RALLY_POINTS) * (s.double ? 2 : 1);
        s.double = false;
      } else {
        s.them++;
        s.streak = s.tier = 0;
      }
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
