import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Table in world units: the playfield spans x 4…232 (centre 118), the plunger lane x 232…258. */
export const W = 262;
export const H = 420;
export const BALL_R = 6;
export const BALLS = 3;
/** Playfield centre line: the bottom of the table is symmetric around it. */
export const MID = 118;
const mirror = (x: number) => 2 * MID - x;
/** Plunger lane: the ball rests at (LANE_X, PLUNGER_Y). */
export const LANE_X = 245;
const LANE_L = 232;
const LANE_TOP = 150;
export const PLUNGER_Y = 398;
/** Top of the table: a half circle over the whole width. */
export const ARC = { x: 131, y: 131, r: 127 };
/** Top rollover lanes: their sensors sit between separator posts. */
export const LANE_Y0 = 38;
export const LANE_Y1 = 58;
const LANE_GAP = 24;
const FLIP_REST = 0.52;
const FLIP_UP = -0.5;
const FLIP_UP_SPEED = 26;
const FLIP_DOWN_SPEED = 15;
/** Flipper capsule radius at the pivot and at the tip. */
export const FLIP_R0 = 7;
export const FLIP_R1 = 4;
const MAX_SPEED = 950;
const BUMPER_KICK = 280;
const SLING_KICK = 260;
/** Seconds the ball waits on the plunger before it launches by itself, and to charge a full pull. */
const HOLD_S = 1.2;
const CHARGE_S = 0.8;
const AUTO_POWER = 0.6;
const MAX_MULT = 4;

export const PTS = { bumper: 50, sling: 10, target: 250, bank: 1500, lane: 100, lanes: 1000 } as const;
/** Bonus per ball left unplayed when the goal is reached. */
export const BALL_BONUS = 2500;

export const goalFor = (d: Difficulty) => byLevel(d, [7000, 7500, 8000, 8500, 9000]);
const bumpersFor = (d: Difficulty) => byLevel(d, [3, 3, 4, 4, 5]);
const bumperR = (d: Difficulty) => byLevel(d, [15, 14, 13, 12, 11]);
const banksFor = (d: Difficulty) => byLevel(d, [1, 1, 2, 2, 2]);
const bankSize = (d: Difficulty) => byLevel(d, [3, 3, 3, 4, 4]);
const lanesFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 4, 4]);
const flipLen = (d: Difficulty) => byLevel(d, [46, 44, 42, 40, 38]);
const gravityFor = (d: Difficulty) => byLevel(d, [290, 310, 330, 350, 370]);
/** Seconds after a launch during which a drained ball comes back (once per ball). */
export const saveFor = (d: Difficulty) => byLevel(d, [10, 8, 6, 5, 4]);
/** Side outlanes (a drain past the slingshots): closed, one side, then both, with a wider mouth. */
const outlanesFor = (d: Difficulty) => byLevel(d, [0, 0, 1, 2, 2]);
/** Radius of the post that splits the inlane from the outlane: a smaller post leaves a wider mouth. */
const outPostR = (d: Difficulty) => byLevel(d, [3, 3, 3.6, 3.2, 2.4]);

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  kind: 'wall' | 'sling' | 'gate';
  /** Sling side (0 left, 1 right). */
  side: number;
}
interface Circle {
  x: number;
  y: number;
  r: number;
}
interface Target {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  down: boolean;
  bank: number;
}
interface Bank {
  ids: number[];
  /** Seconds until a cleared bank stands back up (0: standing). */
  reset: number;
}
export interface Flipper {
  px: number;
  py: number;
  len: number;
  /** 1: left flipper (points right), -1: right flipper. */
  side: number;
  a: number;
  /** Angular speed in the last sub-step (radians per second). */
  w: number;
}

export interface State {
  d: Difficulty;
  rng: Rng;
  segs: Seg[];
  posts: Circle[];
  bumpers: Circle[];
  targets: Target[];
  banks: Bank[];
  /** Rollover lane centres and their lamps. */
  lanes: number[];
  lit: boolean[];
  /** Outlanes open on the left and right (closed ones are capped). */
  outlanes: [boolean, boolean];
  /** Lane the ball is in (-1: none), so a lane lights once per pass. */
  inLaneSensor: number;
  flippers: [Flipper, Flipper];
  /** Flipper buttons held (left, right). */
  press: [boolean, boolean];
  /** Buttons as they were last step (a press flips the lane lamps once). */
  was: [boolean, boolean];
  bx: number;
  by: number;
  vx: number;
  vy: number;
  gravity: number;
  /** Ball resting on the plunger, launching after `hold` seconds unless the plunger is being pulled. */
  held: boolean;
  hold: number;
  charging: boolean;
  charge: number;
  /** Ball still in the plunger lane (the lane gate stays open). */
  inLane: boolean;
  save: number;
  saveUsed: boolean;
  balls: number;
  mult: number;
  score: number;
  goal: number;
  stuck: number;
  done: boolean;
}

type HitKind = 'bumper' | 'sling' | 'target' | 'bank' | 'lane' | 'lanes';
interface Hit {
  kind: HitKind;
  /** Bumper, target, bank, lane or sling index. */
  i: number;
  x: number;
  y: number;
  pts: number;
}
export interface StepEvents {
  hits: Hit[];
  launched: boolean;
  /** Flipper pressed this step (left, right): for the swing effects. */
  flip: [boolean, boolean];
  /** The ball drained but the ball save sent it back. */
  saved: boolean;
  drained: boolean;
  won: boolean;
  over: boolean;
}

const seg = (ax: number, ay: number, bx: number, by: number, kind: Seg['kind'] = 'wall', r = 0, side = 0): Seg => ({
  ax,
  ay,
  bx,
  by,
  r,
  kind,
  side,
});

/** The sling triangle on the left (mirrored for the right): its kick face runs from A to C. */
export const SLING = { ax: 38, ay: 284, bx: 38, by: 318, cx: 58, cy: 336 };
const GUIDE = { x: 20, top: 300, knee: 330, ex: 64, ey: 364 };
const PIVOT = { x: 66, y: 372 };
const DEFLECT = { x: 22, y0: 248, y1: 280 };
/** The post at the top left that stops the orbit and turns the ball back into the field. */
const KICKER = { x: 34, y: 63, r: 9 };

const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

/** Deal a table: bumpers, drop-target banks and top lanes from the seed; flippers, slings and walls fixed. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const segs: Seg[] = [];
  const posts: Circle[] = [];
  const open = outlanesFor(d);
  const one = rng.int(0, 1);
  const outlanes: [boolean, boolean] = [open === 2 || (open === 1 && one === 0), open === 2 || (open === 1 && one === 1)];
  // Outer walls, the lane and its gate, then the arched top.
  segs.push(seg(4, ARC.y, 4, H + 30), seg(258, ARC.y, 258, H + 30), seg(LANE_L, LANE_TOP, LANE_L, H + 30));
  segs.push(seg(LANE_L, LANE_TOP, 258, ARC.y, 'gate'));
  const N = 32;
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI + (i / N) * Math.PI;
    const a1 = Math.PI + ((i + 1) / N) * Math.PI;
    segs.push(seg(ARC.x + Math.cos(a0) * ARC.r, ARC.y + Math.sin(a0) * ARC.r, ARC.x + Math.cos(a1) * ARC.r, ARC.y + Math.sin(a1) * ARC.r));
  }
  // Bottom: inlane guides, slings, outlane covers on the easy levels; the left side, then its mirror.
  for (const side of [0, 1]) {
    const m = side ? mirror : (x: number) => x;
    segs.push(seg(m(GUIDE.x), GUIDE.top, m(GUIDE.x), GUIDE.knee), seg(m(GUIDE.x), GUIDE.knee, m(GUIDE.ex), GUIDE.ey));
    posts.push({ x: m(GUIDE.x), y: GUIDE.top, r: outPostR(d) });
    // A rubber on the wall turns balls coming down the side into the inlane, not the outlane.
    segs.push(seg(m(4), DEFLECT.y0, m(DEFLECT.x), DEFLECT.y1));
    posts.push({ x: m(DEFLECT.x), y: DEFLECT.y1, r: 2 });
    if (!outlanes[side]) segs.push(seg(m(4), GUIDE.top - 16, m(GUIDE.x), GUIDE.top - 2));
    const { ax, ay, bx, by, cx, cy } = SLING;
    segs.push(seg(m(ax), ay, m(bx), by), seg(m(bx), by, m(cx), cy), seg(m(ax), ay, m(cx), cy, 'sling', 0, side));
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
      [cx, cy],
    ])
      posts.push({ x: m(x), y, r: 2.5 });
  }
  // Top rollover lanes between separator posts.
  const nl = lanesFor(d);
  const lanes: number[] = [];
  const lx0 = 124 - (nl * LANE_GAP) / 2;
  for (let i = 0; i <= nl; i++) segs.push(seg(lx0 + i * LANE_GAP, LANE_Y0, lx0 + i * LANE_GAP, LANE_Y1, 'wall', 2.5));
  for (let i = 0; i < nl; i++) lanes.push(lx0 + (i + 0.5) * LANE_GAP);

  // Drop-target banks: along the left wall, the right wall or across the middle.
  const targets: Target[] = [];
  const banks: Bank[] = [];
  const boxes: [number, number, number, number][] = [];
  const kinds = rng.shuffle(['L', 'R', 'C']).slice(0, banksFor(d));
  const n = bankSize(d);
  for (const k of kinds) {
    const bank: Bank = { ids: [], reset: 0 };
    const len = n * 20 - 5;
    if (k === 'C') {
      const y = rng.int(246, 258);
      const x0 = MID - len / 2 + rng.int(-12, 12);
      for (let i = 0; i < n; i++) targets.push({ ax: x0 + i * 20, ay: y, bx: x0 + i * 20 + 15, by: y, down: false, bank: banks.length });
      boxes.push([x0, y, x0 + len, y]);
    } else {
      const x = k === 'L' ? 8 : LANE_L - 4;
      const y0 = rng.int(150, 240 - len);
      for (let i = 0; i < n; i++) targets.push({ ax: x, ay: y0 + i * 20, bx: x, by: y0 + i * 20 + 15, down: false, bank: banks.length });
      boxes.push([x, y0, x, y0 + len]);
    }
    for (let i = 0; i < n; i++) bank.ids.push(targets.length - n + i);
    banks.push(bank);
  }

  // Round bumpers: spread out in the upper field, clear of the banks, lanes and each other.
  const bumpers: Circle[] = [{ ...KICKER }];
  const br = bumperR(d);
  for (let tries = 0; bumpers.length < bumpersFor(d) + 1 && tries < 400; tries++) {
    const x = rng.int(50, 186);
    const y = rng.int(LANE_Y1 + br + 18, 232);
    const r = br + (tries % 3 === 0 ? 2 : 0);
    if (bumpers.some((b) => dist2(x, y, b.x, b.y) < (b.r + r + 2 * BALL_R + 8) ** 2)) continue;
    if (boxes.some(([x0, y0, x1, y1]) => x > x0 - r - 18 && x < x1 + r + 18 && y > y0 - r - 18 && y < y1 + r + 18)) continue;
    bumpers.push({ x, y, r });
  }

  const len = flipLen(d);
  const flipper = (side: number): Flipper => ({ px: side > 0 ? PIVOT.x : mirror(PIVOT.x), py: PIVOT.y, len, side, a: FLIP_REST, w: 0 });
  return {
    d,
    rng,
    segs,
    posts,
    bumpers,
    targets,
    banks,
    lanes,
    lit: lanes.map(() => false),
    outlanes,
    inLaneSensor: -1,
    flippers: [flipper(1), flipper(-1)],
    press: [false, false],
    was: [false, false],
    bx: LANE_X,
    by: PLUNGER_Y,
    vx: 0,
    vy: 0,
    gravity: gravityFor(d),
    held: true,
    hold: HOLD_S,
    charging: false,
    charge: 0,
    inLane: true,
    save: 0,
    saveUsed: false,
    balls: BALLS,
    mult: 1,
    score: 0,
    goal: goalFor(d),
    stuck: 0,
    done: false,
  };
}

/** A flipper's tip. */
export function flipperTip(f: Flipper) {
  return { x: f.px + f.side * f.len * Math.cos(f.a), y: f.py + f.len * Math.sin(f.a) };
}

/** Start pulling the plunger back (key or touch held while the ball waits). */
export function pull(s: State) {
  if (s.held && !s.done) s.charging = true;
}

/** Let the plunger go: launch with the charge built so far. */
export function release(s: State): boolean {
  if (!s.held || !s.charging || s.done) return false;
  launch(s, Math.max(0.3, s.charge));
  return true;
}

function launch(s: State, power: number) {
  s.held = false;
  s.charging = false;
  s.charge = 0;
  s.inLane = true;
  s.bx = LANE_X;
  s.by = PLUNGER_Y;
  s.vx = 0;
  s.vy = -(560 + 260 * power);
  if (!s.saveUsed) s.save = saveFor(s.d);
}

function toPlunger(s: State) {
  s.held = true;
  s.hold = HOLD_S;
  s.charging = false;
  s.charge = 0;
  s.inLane = true;
  s.bx = LANE_X;
  s.by = PLUNGER_Y;
  s.vx = s.vy = 0;
}

/** Bounce the ball off a surface moving at (sx, sy), with normal (nx, ny) pointing towards the ball. */
function bounce(s: State, nx: number, ny: number, e: number, sx = 0, sy = 0): number {
  const vn = (s.vx - sx) * nx + (s.vy - sy) * ny;
  if (vn < 0) {
    s.vx -= (1 + e) * vn * nx;
    s.vy -= (1 + e) * vn * ny;
  }
  return vn;
}

/** Push the ball out of a capsule (a → b, radius r0 at a, r1 at b). Returns the contact normal and point, or null. */
function capsule(s: State, ax: number, ay: number, bx: number, by: number, r0: number, r1: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((s.bx - ax) * dx + (s.by - ay) * dy) / l2));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  const rr = r0 + (r1 - r0) * t + BALL_R;
  const d2 = dist2(s.bx, s.by, cx, cy);
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = d2 ? (s.bx - cx) / d : -dy / Math.sqrt(l2);
  const ny = d2 ? (s.by - cy) / d : dx / Math.sqrt(l2);
  s.bx = cx + nx * rr;
  s.by = cy + ny * rr;
  return { nx, ny, cx, cy };
}

function circle(s: State, c: Circle) {
  const rr = c.r + BALL_R;
  const d2 = dist2(s.bx, s.by, c.x, c.y);
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = (s.bx - c.x) / d;
  const ny = (s.by - c.y) / d;
  s.bx = c.x + nx * rr;
  s.by = c.y + ny * rr;
  return { nx, ny };
}

function addPts(s: State, ev: StepEvents, kind: HitKind, i: number, x: number, y: number) {
  const pts = PTS[kind] * s.mult;
  s.score += pts;
  ev.hits.push({ kind, i, x, y, pts });
}

/** Turn the lit lane lamps one step (flipper presses steer them, as on a real table). */
function rotateLanes(s: State, dir: number) {
  const n = s.lit.length;
  s.lit = s.lit.map((_, i) => s.lit[(i - dir + n) % n]);
}

function collide(s: State, ev: StepEvents) {
  for (const g of s.segs) {
    if (g.kind === 'gate' && s.inLane) continue;
    const c = capsule(s, g.ax, g.ay, g.bx, g.by, g.r, g.r);
    if (!c) continue;
    const vn = bounce(s, c.nx, c.ny, 0.45);
    if (g.kind === 'sling' && vn < -40) {
      // Kick only off the face that looks into the field.
      const fx = g.side ? -1 : 1;
      if (c.nx * fx > 0.3) {
        s.vx += c.nx * SLING_KICK;
        s.vy += c.ny * SLING_KICK;
        addPts(s, ev, 'sling', g.side, s.bx, s.by);
      }
    }
  }
  for (const p of s.posts) {
    const c = circle(s, p);
    if (c) bounce(s, c.nx, c.ny, 0.45);
  }
  for (let i = 0; i < s.bumpers.length; i++) {
    const b = s.bumpers[i];
    const c = circle(s, b);
    if (!c) continue;
    const vn = s.vx * c.nx + s.vy * c.ny;
    if (vn < 0) {
      // Strip the inward speed and fire the ball straight out.
      s.vx -= vn * c.nx;
      s.vy -= vn * c.ny;
      const out = Math.max(-vn * 0.6, BUMPER_KICK);
      s.vx += c.nx * out;
      s.vy += c.ny * out;
      addPts(s, ev, 'bumper', i, b.x + c.nx * b.r, b.y + c.ny * b.r);
    }
  }
  for (let i = 0; i < s.targets.length; i++) {
    const t = s.targets[i];
    if (t.down) continue;
    const c = capsule(s, t.ax, t.ay, t.bx, t.by, 3, 3);
    if (!c) continue;
    bounce(s, c.nx, c.ny, 0.5);
    t.down = true;
    addPts(s, ev, 'target', i, (t.ax + t.bx) / 2, (t.ay + t.by) / 2);
    const bank = s.banks[t.bank];
    if (bank.ids.every((j) => s.targets[j].down)) {
      addPts(s, ev, 'bank', t.bank, (t.ax + t.bx) / 2, (t.ay + t.by) / 2);
      s.mult = Math.min(MAX_MULT, s.mult + 1);
      bank.reset = 2;
    }
  }
  for (const f of s.flippers) {
    const tip = flipperTip(f);
    const c = capsule(s, f.px, f.py, tip.x, tip.y, FLIP_R0, FLIP_R1);
    if (!c) continue;
    // The flipper's surface speed where the ball touches it: ω × r.
    const sx = f.side * f.w * -(c.cy - f.py);
    const sy = f.side * f.w * (c.cx - f.px);
    bounce(s, c.nx, c.ny, 0.25, sx, sy);
  }
}

/** Ball in a top lane (index), or -1. */
function laneAt(s: State): number {
  if (s.by < LANE_Y0 || s.by > LANE_Y1) return -1;
  return s.lanes.findIndex((x) => Math.abs(s.bx - x) < LANE_GAP / 2 - 2);
}

/** Advance the table by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { hits: [], launched: false, flip: [false, false], saved: false, drained: false, won: false, over: false };
  if (s.done) return ev;
  for (let k = 0; k < 2; k++) {
    if (s.press[k] && !s.was[k]) {
      ev.flip[k] = true;
      rotateLanes(s, k ? 1 : -1);
    }
    s.was[k] = s.press[k];
  }
  for (const b of s.banks)
    if (b.reset > 0 && (b.reset -= dt) <= 0) {
      const near = b.ids.some((j) => {
        const t = s.targets[j];
        return dist2(s.bx, s.by, (t.ax + t.bx) / 2, (t.ay + t.by) / 2) < 30 * 30;
      });
      if (near) b.reset = 0.2;
      else for (const j of b.ids) s.targets[j].down = false;
    }

  // Sub-steps: the ball and the flipper tips move at most 2 units each, so nothing tunnels.
  const moving = s.flippers.some((f, k) => Math.abs((s.press[k] ? FLIP_UP : FLIP_REST) - f.a) > 1e-3);
  const tipSpeed = moving ? FLIP_UP_SPEED * s.flippers[0].len : 0;
  const n = Math.min(40, Math.max(1, Math.ceil((Math.max(Math.hypot(s.vx, s.vy), tipSpeed) * dt) / 2)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) {
      const f = s.flippers[k];
      const to = s.press[k] ? FLIP_UP : FLIP_REST;
      const max = (s.press[k] ? FLIP_UP_SPEED : FLIP_DOWN_SPEED) * h;
      const da = Math.max(-max, Math.min(max, to - f.a));
      f.a += da;
      f.w = da / h;
    }
    if (s.held) continue;
    s.vy += s.gravity * h;
    s.bx += s.vx * h;
    s.by += s.vy * h;
    collide(s, ev);
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > MAX_SPEED) {
      s.vx *= MAX_SPEED / sp;
      s.vy *= MAX_SPEED / sp;
    }
    const lane = laneAt(s);
    if (lane !== s.inLaneSensor) {
      s.inLaneSensor = lane;
      if (lane >= 0 && !s.lit[lane]) {
        s.lit[lane] = true;
        addPts(s, ev, 'lane', lane, s.lanes[lane], (LANE_Y0 + LANE_Y1) / 2);
        if (s.lit.every(Boolean)) {
          addPts(s, ev, 'lanes', lane, s.lanes[lane], (LANE_Y0 + LANE_Y1) / 2);
          s.lit = s.lit.map(() => false);
        }
      }
    }
    if (s.inLane && s.bx < LANE_L - 6) s.inLane = false;
    // A weak launch that falls back down the lane rests on the plunger again.
    if (s.inLane && s.bx > LANE_L && s.by >= PLUNGER_Y && s.vy > 0) {
      toPlunger(s);
      break;
    }
    if (s.by > H + BALL_R || s.bx < -20 || s.bx > W + 20 || s.by < -40) break;
  }

  if (s.held) {
    if (s.charging) s.charge = Math.min(1, s.charge + dt / CHARGE_S);
    else if ((s.hold -= dt) <= 0) launch(s, AUTO_POWER + s.rng.next() * 0.3);
    if (!s.held) ev.launched = true;
  } else {
    if (!s.inLane && s.save > 0) s.save = Math.max(0, s.save - dt);
    // A ball that has come to rest away from a raised flipper gets a nudge.
    const cradled = s.press.some(Boolean) && s.by > 330;
    s.stuck = Math.hypot(s.vx, s.vy) < 12 && !cradled ? s.stuck + dt : 0;
    if (s.stuck > 2.5) {
      s.stuck = 0;
      s.vy = -240;
      s.vx = (s.rng.next() - 0.5) * 240;
    }
  }

  if (s.score >= s.goal) {
    s.score += (s.balls - 1) * BALL_BONUS;
    s.done = true;
    ev.won = true;
    return ev;
  }
  if (!s.held && s.by > H + BALL_R) {
    if (s.save > 0 && !s.saveUsed) {
      s.saveUsed = true;
      s.save = 0;
      ev.saved = true;
      toPlunger(s);
      return ev;
    }
    s.balls--;
    s.saveUsed = false;
    s.save = 0;
    ev.drained = true;
    if (s.balls <= 0) {
      s.done = true;
      ev.over = true;
      s.bx = MID;
      return ev;
    }
    s.mult = 1;
    toPlunger(s);
  } else if (!s.held && (s.bx < -20 || s.bx > W + 20 || s.by < -40)) toPlunger(s); // escaped: never happens, but never strand it
  return ev;
}
