import {
  BALL_BONUS,
  BALL_R,
  COMBO_TIERS,
  COMBO_WINDOW,
  type Circle,
  FLIP_R0,
  FLIP_R1,
  FLIP_REST,
  FRENZY_S,
  GUARD,
  GUARD_S,
  H,
  HOLD_S,
  LANE_GAP,
  LANE_L,
  LANE_X,
  LANE_Y0,
  LANE_Y1,
  MID,
  PLUNGER_Y,
  PTS,
  type Reward,
  SAUCER_R,
  STAR_R,
  type State,
  VORTEX_CORE,
  VORTEX_R,
  W,
  dist2,
  flipperTip,
  freeSpot,
  saveFor,
} from './table';

/** Ball physics on the dealt table (see `table.ts` for the layout). */
const FLIP_UP = -0.5;
const FLIP_UP_SPEED = 26;
const FLIP_DOWN_SPEED = 15;
const MAX_SPEED = 950;
const BUMPER_KICK = 280;
const SLING_KICK = 260;
/** Seconds to charge a full plunger pull, and the power of a launch nobody pulled. */
const CHARGE_S = 0.8;
const AUTO_POWER = 0.6;
const MAX_MULT = 4;
/** What each combo milestone unlocks (`COMBO_TIERS`). */
const REWARDS: readonly Reward[] = ['frenzy', 'save', 'guard', 'jackpot', 'jackpot'];
/** Seconds the combo ball save lasts. */
const SAVE_S = 6;
/** Seconds before a collected star shows up somewhere else (outside a star hunt). */
const STAR_BACK = 6;
/** Seconds the saucer and the black hole hold the ball before kicking it out. */
const SAUCER_HOLD = 0.7;
const VORTEX_HOLD = 0.5;
/** Black hole pull at its core (it fades to 0 at `VORTEX_R`). */
const VORTEX_PULL = 700;
/** Drifting bumpers: angular speed of their sway. */
const DRIFT_W = 1.3;

type HitKind = keyof typeof PTS;
/** Hits that count towards the combo. */
const COMBO_HITS: ReadonlySet<HitKind> = new Set(['bumper', 'target', 'lane', 'star', 'saucer']);
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
  /** A combo milestone reached this step (1-based) and what it unlocked; 0 / null for none. */
  tier: number;
  unlocked: Reward | null;
  /** The saucer or the black hole just kicked the ball back out. */
  kicked: boolean;
  /** The black hole swallowed the ball this step. */
  swallowed: boolean;
  won: boolean;
  over: boolean;
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

function addPts(s: State, ev: StepEvents, kind: HitKind, i: number, x: number, y: number, base: number = PTS[kind]) {
  // A frenzy doubles every plain hit (not the bank, lane, star-set or jackpot bonuses).
  const frenzy = s.frenzy > 0 && (COMBO_HITS.has(kind) || kind === 'sling') ? 2 : 1;
  const pts = base * s.mult * frenzy;
  s.score += pts;
  ev.hits.push({ kind, i, x, y, pts });
  if (COMBO_HITS.has(kind)) comboHit(s, ev);
}

/** One more hit in the combo; a milestone turns on its reward. */
function comboHit(s: State, ev: StepEvents) {
  s.combo++;
  s.comboLeft = COMBO_WINDOW;
  if (s.tier >= COMBO_TIERS.length || s.combo < COMBO_TIERS[s.tier]) return;
  let r = REWARDS[s.tier++];
  // One combo ball save per ball: after that, that milestone starts a frenzy instead.
  if (r === 'save' && s.comboSaved) r = 'frenzy';
  ev.tier = s.tier;
  ev.unlocked = r;
  grant(s, ev, r);
}

/** Turn a combo reward on: a fresh ball save, a frenzy, the drain guard post, or a jackpot. */
function grant(s: State, ev: StepEvents, r: Reward) {
  if (r === 'save') {
    s.save = SAVE_S;
    s.saveUsed = false;
    s.comboSaved = true;
  } else if (r === 'frenzy') s.frenzy = FRENZY_S;
  else if (r === 'guard') s.guard = GUARD_S;
  else {
    addPts(s, ev, 'jackpot', 0, MID, 200);
    s.mult = Math.min(MAX_MULT, s.mult + 1);
  }
}

const breakCombo = (s: State) => {
  s.combo = s.tier = 0;
  s.comboLeft = 0;
};

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
  if (s.guard > 0) {
    const c = circle(s, GUARD);
    if (c) bounce(s, c.nx, c.ny, 0.8);
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
      // A drifting bumper is worth double.
      addPts(s, ev, 'bumper', i, b.x + c.nx * b.r, b.y + c.ny * b.r, b.amp ? PTS.bumper * 2 : PTS.bumper);
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

/** Run down the combo, frenzy and guard, sway the drifting bumpers and bring collected stars back. */
function timers(s: State, dt: number) {
  s.t += dt;
  if (s.combo && (s.comboLeft -= dt) <= 0) breakCombo(s);
  s.frenzy = Math.max(0, s.frenzy - dt);
  s.guard = Math.max(0, s.guard - dt);
  if (s.saucer) s.saucer.cool = Math.max(0, s.saucer.cool - dt);
  for (const b of s.bumpers) if (b.amp) b.x = b.x0 + b.amp * Math.sin(s.t * DRIFT_W + b.ph);
  for (const q of s.stars) {
    if (q.on || (q.back -= dt) > 0) continue;
    const at = freeSpot(s, STAR_R);
    if (at) Object.assign(q, at, { on: true });
    else q.back = 1;
  }
}

/** Ball rolling through a star, into the saucer or the black hole's core. */
function sensors(s: State, ev: StepEvents) {
  for (let i = 0; i < s.stars.length; i++) {
    const q = s.stars[i];
    if (!q.on || dist2(s.bx, s.by, q.x, q.y) > (STAR_R + BALL_R) ** 2) continue;
    q.on = false;
    q.back = s.starSet ? Infinity : STAR_BACK;
    addPts(s, ev, 'star', i, q.x, q.y);
    if (s.starSet && s.stars.every((o) => !o.on)) {
      addPts(s, ev, 'stars', i, q.x, q.y);
      for (const o of s.stars) o.back = 1.5;
    }
  }
  const sc = s.saucer;
  if (sc && !sc.cool && dist2(s.bx, s.by, sc.x, sc.y) < SAUCER_R ** 2) {
    // Each catch scores one step more (up to ×4), then the ball goes back up the table.
    sc.n++;
    addPts(s, ev, 'saucer', 0, sc.x, sc.y, PTS.saucer * Math.min(4, sc.n));
    sc.cool = SAUCER_HOLD + 0.6;
    const a = (s.rng.next() < 0.5 ? -1 : 1) * (0.35 + s.rng.next() * 0.45);
    hold(s, sc.x, sc.y, SAUCER_HOLD, a, 480);
  }
  const v = s.vortex;
  if (v && dist2(s.bx, s.by, v.x, v.y) < v.r ** 2) {
    // Swallowed: the multiplier drops one step and the combo ends; the ball is spat back up.
    s.mult = Math.max(1, s.mult - 1);
    breakCombo(s);
    ev.swallowed = true;
    hold(s, v.x, v.y, VORTEX_HOLD, (s.rng.next() - 0.5) * 1.4, 420);
  }
}

/** Hold the ball at (x, y) for `t` seconds, then kick it out at angle `a` from straight up. */
function hold(s: State, x: number, y: number, t: number, a: number, speed: number) {
  s.bx = x;
  s.by = y;
  s.vx = s.vy = 0;
  s.lock = t;
  s.kick = [Math.sin(a) * speed, -Math.cos(a) * speed];
}

/** Advance the table by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    hits: [],
    launched: false,
    flip: [false, false],
    saved: false,
    drained: false,
    tier: 0,
    unlocked: null,
    kicked: false,
    swallowed: false,
    won: false,
    over: false,
  };
  if (s.done) return ev;
  timers(s, dt);
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
    if (s.held || s.lock > 0) continue;
    s.vy += s.gravity * h;
    if (s.vortex) {
      // The black hole pulls harder the closer the ball gets.
      const dx = s.vortex.x - s.bx;
      const dy = s.vortex.y - s.by;
      const dd = Math.hypot(dx, dy) || 1;
      if (dd < VORTEX_R) {
        const a = VORTEX_PULL * (1 - dd / VORTEX_R);
        s.vx += (dx / dd) * a * h;
        s.vy += (dy / dd) * a * h;
      }
    }
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
    sensors(s, ev);
    if (s.lock > 0) break;
    if (s.inLane && s.bx < LANE_L - 6) s.inLane = false;
    // A weak launch that falls back down the lane rests on the plunger again.
    if (s.inLane && s.bx > LANE_L && s.by >= PLUNGER_Y && s.vy > 0) {
      toPlunger(s);
      break;
    }
    if (s.by > H + BALL_R || s.bx < -20 || s.bx > W + 20 || s.by < -40) break;
  }

  if (s.lock > 0 && (s.lock -= dt) <= 0) {
    s.lock = 0;
    [s.vx, s.vy] = s.kick;
    // Out of the hole first, so it doesn't catch the ball straight back.
    const sp = Math.hypot(s.vx, s.vy) || 1;
    s.bx += (s.vx / sp) * (VORTEX_CORE + 3);
    s.by += (s.vy / sp) * (VORTEX_CORE + 3);
    ev.kicked = true;
  }
  if (s.held) {
    if (s.charging) s.charge = Math.min(1, s.charge + dt / CHARGE_S);
    else if ((s.hold -= dt) <= 0) launch(s, AUTO_POWER + s.rng.next() * 0.3);
    if (!s.held) ev.launched = true;
  } else {
    if (!s.inLane && s.save > 0) s.save = Math.max(0, s.save - dt);
    // A ball that has come to rest away from a raised flipper gets a nudge.
    const cradled = (s.press.some(Boolean) && s.by > 330) || s.lock > 0;
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
    breakCombo(s);
    s.guard = 0;
    if (s.save > 0 && !s.saveUsed) {
      s.saveUsed = true;
      s.save = 0;
      ev.saved = true;
      toPlunger(s);
      return ev;
    }
    s.balls--;
    s.saveUsed = s.comboSaved = false;
    s.frenzy = 0;
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
