import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units, side view: the sling on the left, the forts on the right. */
export const W = 300;
export const H = 400;
export const GROUND = 360;
/** Where the pouch rests (and stones leave from). */
export const SLING = { x: 54, y: 302 };
export const STONE_R = 7;
const GRAVITY = 500;
const MIN_SPEED = 140;
const MAX_SPEED = 430;
/** Aim limits (radians above the horizon). */
const MIN_ANGLE = -0.5;
const MAX_ANGLE = 1.45;
const TURN_SPEED = 0.8;
const PULL_SPEED = 0.6;

/** Physics runs in fixed sub-steps, so a shot plays the same at any frame rate. */
const TICK = 1 / 120;
const ITERATIONS = 10;
/** Penetration left alone (keeps resting contacts warm), and how much of the rest is fixed per pass. */
const SLOP = 0.3;
const PUSH = 0.6;
/** Contacts are made this far before touching, so resting stacks never lose touch. */
const MARGIN = 0.5;
/** Below this approach speed, nothing bounces. */
const BOUNCE_V = 40;
/** A body slower than this for SLEEP_S falls asleep (frozen, solid) until something moving touches it. */
const SLEEP_V = 6;
const SLEEP_S = 0.35;
const WAKE_V = 12;
/** Sideways push on a box whose centre hangs past what holds it up: it slides off and drops. */
const TIP = 600;
/** Speed change from one hit that pops a blob. */
const POP_V = 75;
/** A shot gives up after this long, even if something is still twitching. */
const MAX_FLIGHT = 8;

export const TARGET_POINTS = 100;
export const SHOT_BONUS = 150;

type Mat = 'wood' | 'stone' | 'blob' | 'shot' | 'ground';
/** Per material: density, friction, bounce, the hit speed change that costs a hit point (0 = unbreakable), hit points and points. */
const MATS = {
  wood: { density: 1, friction: 0.6, bounce: 0.1, tough: 130, hp: 1, points: 10 },
  stone: { density: 2.6, friction: 0.7, bounce: 0.05, tough: 120, hp: 2, points: 25 },
  blob: { density: 0.7, friction: 0.5, bounce: 0.35, tough: 0, hp: 1, points: TARGET_POINTS },
  shot: { density: 3, friction: 0.5, bounce: 0.25, tough: 0, hp: 1, points: 0 },
  ground: { density: 0, friction: 0.8, bounce: 0.1, tough: 0, hp: 1, points: 0 },
} satisfies Record<Mat, Record<string, number>>;

export interface Body {
  id: number;
  ball: boolean;
  mat: Mat;
  /** Centre, velocity, half extents (a ball has hw = hh = r). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  hw: number;
  hh: number;
  inv: number;
  hp: number;
  awake: boolean;
  /** Seconds spent slower than SLEEP_V. */
  idle: number;
  /** Rolling angle (drawing only). */
  spin: number;
  dead: boolean;
}

export const shotsFor = (d: Difficulty) => byLevel(d, [3, 3, 4, 5, 5]);
export const targetsFor = (d: Difficulty) => byLevel(d, [2, 3, 4, 5, 6]);
/** Seconds of flight the aim guide shows. */
const previewFor = (d: Difficulty) => byLevel(d, [0.5, 0.42, 0.34, 0.27, 0.22]);

export interface State {
  d: Difficulty;
  bodies: Body[];
  nextId: number;
  shots: number;
  used: number;
  score: number;
  /** Blobs still standing. */
  targets: number;
  /** Aim: angle above the horizon, pull 0–1; keyboard keys held (−1/0/1). */
  angle: number;
  power: number;
  turn: number;
  pull: number;
  phase: 'aim' | 'flight' | 'done';
  /** The stone in flight (its body id), or −1. */
  shot: number;
  /** Seconds since the shot, and unspent physics time. */
  flight: number;
  acc: number;
  /** Last tick's impulses per touching pair (normal, friction), to start the solver from: stacks rest still. */
  warm: Map<number, [number, number]>;
}

interface Hit {
  x: number;
  y: number;
  mat: Mat;
  points: number;
}

export interface StepEvents {
  /** Blobs popped and blocks broken or lost this frame (with the points they earned). */
  popped: Hit[];
  broken: Hit[];
  /** Hard knocks (for sparks and shake): where, and the speed change. */
  bumps: { x: number; y: number; v: number }[];
  /** A cracked stone block (first hit). */
  cracked: Hit[];
  /** Spent stones cleared away when the world settled. */
  crumbled: Hit[];
  /** The world settled and the next stone is ready. */
  ready: boolean;
  cleared: boolean;
  over: boolean;
  /** Points for the stones left (on a clear). */
  bonus: number;
}

function add(s: State, ball: boolean, mat: Mat, x: number, y: number, hw: number, hh: number): Body {
  const m = MATS[mat];
  const mass = (ball ? Math.PI * hw * hw : 4 * hw * hh) * m.density;
  const b: Body = {
    id: s.nextId++,
    ball,
    mat,
    x,
    y,
    vx: 0,
    vy: 0,
    hw,
    hh,
    inv: mass ? 1 / mass : 0,
    hp: m.hp,
    awake: false,
    idle: 0,
    spin: 0,
    dead: false,
  };
  s.bodies.push(b);
  return b;
}

/** A box by its left edge and bottom; returns its top. */
const box = (s: State, x: number, bottom: number, w: number, h: number, mat: Mat) => {
  add(s, false, mat, x + w / 2, bottom - h / 2, w / 2, h / 2);
  return bottom - h;
};
const BLOB_R = 8.5;
const blob = (s: State, cx: number, bottom: number) => {
  add(s, true, 'blob', cx, bottom - BLOB_R, BLOB_R, BLOB_R);
  s.targets++;
};

/** Building blocks of a fort, sized in world units. */
const POST_W = 8;
const POST_H = 28;
const PLANK_H = 8;
const CUBE = 16;

/**
 * A hut of `floors` stacked rooms (two posts and a roof each), a blob sheltered in the rooms listed in
 * `inside`, maybe one on the roof. The top `stone` floors are built of stone: heavy lids that crush
 * what they fall on.
 */
function hut(s: State, x: number, ground: number, w: number, floors: number, inside: boolean[], roof: boolean, stone: number) {
  let base = ground;
  for (let f = 0; f < floors; f++) {
    const mat: Mat = f >= floors - stone ? 'stone' : 'wood';
    box(s, x, base, POST_W, POST_H, mat);
    box(s, x + w - POST_W, base, POST_W, POST_H, mat);
    if (inside[f]) blob(s, x + w / 2, base);
    base = box(s, x, base - POST_H, w, PLANK_H, mat);
  }
  if (roof) blob(s, x + w / 2, base);
}

/** A column of cubes with a blob on top. */
function perch(s: State, x: number, ground: number, n: number, stone: boolean) {
  let base = ground;
  for (let i = 0; i < n; i++) base = box(s, x, base, CUBE, CUBE, stone && i === 0 ? 'stone' : 'wood');
  blob(s, x + CUBE / 2, base);
}

/** One fort plan: what it needs and how wide it is. */
interface Plan {
  w: number;
  build: (s: State, x: number, ground: number) => void;
}

/** Forts for a level: huts (taller and stonier with the level) and perches, `n` blobs in all. */
function plans(d: Difficulty, rng: Rng): Plan[] {
  const out: Plan[] = [];
  let left = targetsFor(d);
  const huts = byLevel(d, [1, 1, 2, 2, 2]);
  const floorsMax = byLevel(d, [1, 2, 2, 3, 3]);
  const stoneMax = byLevel(d, [0, 0, 1, 1, 2]);
  for (let i = 0; i < huts && left > 0; i++) {
    const floors = rng.int(Math.max(1, floorsMax - 1), floorsMax);
    const w = rng.int(36, 44);
    const inside = Array.from({ length: floors }, () => false);
    let blobs = 0;
    for (let f = 0; f < floors && left - blobs > 1; f++)
      if (f === 0 || rng.chance(0.6)) {
        inside[f] = true;
        blobs++;
      }
    const roof = left - blobs > (huts - i - 1) * 2 ? true : rng.chance(0.4);
    if (roof) blobs++;
    const stone = Math.min(floors - 1, stoneMax ? rng.int(stoneMax - 1, stoneMax) : 0);
    left -= blobs;
    out.push({ w, build: (st, x, g) => hut(st, x, g, w, floors, inside, roof, stone) });
  }
  while (left > 0) {
    const n = rng.int(1, byLevel(d, [1, 2, 3, 3, 4]));
    const stone = d >= 3 && rng.chance(0.5);
    left--;
    out.push({ w: CUBE, build: (st, x, g) => perch(st, x, g, n, stone) });
  }
  return rng.shuffle(out);
}

/** Deal a level: forts side by side on the right, everything at rest, the first stone ready. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const s: State = {
    d,
    bodies: [],
    nextId: 0,
    shots: shotsFor(d),
    used: 0,
    score: 0,
    targets: 0,
    angle: 0.55,
    power: 0.7,
    turn: 0,
    pull: 0,
    phase: 'aim',
    shot: -1,
    flight: 0,
    acc: 0,
    warm: new Map(),
  };
  // The ground: one static slab, wider than the field.
  add(s, false, 'ground', W / 2, GROUND + 60, W * 2, 60);
  // A boulder in front of the forts from Medium up: flat shots stop there, lob over it.
  const rock = byLevel(d, [0, 46, 50, 54, 56]);
  if (rock) box(s, rng.int(82, 92), GROUND, rng.int(16, 22), rock + rng.int(0, 6), 'ground');
  const forts = plans(d, rng);
  const span = forts.reduce((a, p) => a + p.w, 0);
  const lo = 146;
  const hi = W - 8;
  const room = Math.max(0, hi - lo - span);
  // Gaps between forts: a seeded share of the spare room, at least 10 units each.
  const cuts = forts.map(() => 0.4 + rng.next());
  const total = cuts.reduce((a, c) => a + c, 0) + 0.4;
  let x = lo + (room * 0.4) / total;
  const ledge = byLevel(d, [0, 0.3, 0.45, 0.6, 0.7]);
  for (const [i, p] of forts.entries()) {
    // Some forts stand on a rock ledge (solid, part of the ground).
    let base = GROUND;
    if (rng.chance(ledge)) base = box(s, Math.round(x) - 4, GROUND, p.w + 8, rng.int(1, 3) * 12, 'ground');
    p.build(s, Math.round(x), base);
    x += p.w + Math.max(10, (room * cuts[i]) / total);
  }
  return s;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const speedOf = (power: number) => MIN_SPEED + power * (MAX_SPEED - MIN_SPEED);

/** Set the aim (pointer drag): direction and pull, clamped. */
export function setAim(s: State, angle: number, power: number) {
  if (s.phase !== 'aim') return;
  s.angle = clamp(angle, MIN_ANGLE, MAX_ANGLE);
  s.power = clamp(power, 0, 1);
}

/** Let the stone fly. */
export function fire(s: State): boolean {
  if (s.phase !== 'aim' || s.used >= s.shots) return false;
  const v = speedOf(s.power);
  const b = add(s, true, 'shot', SLING.x, SLING.y, STONE_R, STONE_R);
  b.awake = true;
  b.vx = Math.cos(s.angle) * v;
  b.vy = -Math.sin(s.angle) * v;
  s.shot = b.id;
  s.used++;
  s.phase = 'flight';
  s.flight = 0;
  return true;
}

/** The first stretch of the flight, for the dotted guide. */
export function aimPath(s: State): { x: number; y: number }[] {
  const v = speedOf(s.power);
  const vx = Math.cos(s.angle) * v;
  const vy = -Math.sin(s.angle) * v;
  const pts = [];
  for (let t = 0.04; t <= previewFor(s.d); t += 0.035) pts.push({ x: SLING.x + vx * t, y: SLING.y + vy * t + (GRAVITY * t * t) / 2 });
  return pts;
}

export const stoneOf = (s: State) => s.bodies.find((b) => b.id === s.shot);

interface Contact {
  a: Body;
  b: Body;
  /** Normal from a to b, penetration, contact x (for what holds a box up). */
  nx: number;
  ny: number;
  pen: number;
  px: number;
  /** Half the width of a flat contact (box on box). */
  span: number;
  ia: number;
  ib: number;
  bounce: number;
  mu: number;
  /** Approach speed before solving (what does the damage). */
  hit: number;
  pn: number;
  pt: number;
}

/** Normal (a → b), penetration and contact x of two bodies, or null if apart (by more than MARGIN). */
function collide(a: Body, b: Body): { nx: number; ny: number; pen: number; px: number; span: number } | null {
  if (a.ball && b.ball) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const pen = a.hw + b.hw - d;
    if (pen < -MARGIN) return null;
    const nx = d > 1e-6 ? dx / d : 0;
    const ny = d > 1e-6 ? dy / d : 1;
    return { nx, ny, pen, px: a.x + nx * a.hw, span: 0 };
  }
  if (a.ball || b.ball) {
    const [c, r] = a.ball ? [a, b] : [b, a];
    const qx = clamp(c.x, r.x - r.hw, r.x + r.hw);
    const qy = clamp(c.y, r.y - r.hh, r.y + r.hh);
    let dx = c.x - qx;
    let dy = c.y - qy;
    let d = Math.hypot(dx, dy);
    let pen: number;
    if (d > 1e-6) pen = c.hw - d;
    else {
      // Centre inside the box: out through the nearest side.
      const ox = r.hw - Math.abs(c.x - r.x);
      const oy = r.hh - Math.abs(c.y - r.y);
      if (ox < oy) [dx, dy] = [Math.sign(c.x - r.x) || 1, 0];
      else [dx, dy] = [0, Math.sign(c.y - r.y) || -1];
      d = 1;
      pen = c.hw + Math.min(ox, oy);
    }
    if (pen < -MARGIN) return null;
    // Normal from the box to the ball; flip if a is the ball.
    const k = a.ball ? -1 : 1;
    return { nx: (k * dx) / d, ny: (k * dy) / d, pen, px: qx, span: 0 };
  }
  const ox = a.hw + b.hw - Math.abs(b.x - a.x);
  const oy = a.hh + b.hh - Math.abs(b.y - a.y);
  if (ox < -MARGIN || oy < -MARGIN || (ox < 0 && oy < 0)) return null;
  const l = Math.max(a.x - a.hw, b.x - b.hw);
  const r = Math.min(a.x + a.hw, b.x + b.hw);
  if (oy <= ox) return { nx: 0, ny: b.y > a.y ? 1 : -1, pen: oy, px: (l + r) / 2, span: Math.max(0, (r - l) / 2) };
  return { nx: b.x > a.x ? 1 : -1, ny: 0, pen: ox, px: (l + r) / 2, span: 0 };
}

const moving = (b: Body) => b.awake && Math.hypot(b.vx, b.vy) > WAKE_V;
const dynamic = (b: Body) => b.awake && b.inv > 0;

function wake(b: Body) {
  if (b.inv > 0 && !b.dead) Object.assign(b, { awake: true, idle: 0 });
}

/** Wake everything touching `b` (it broke or left). */
function wakeAround(s: State, b: Body) {
  for (const o of s.bodies) if (o !== b && !o.awake && collide(o, b)) wake(o);
}

/** Take a body out of play, scoring it. */
function remove(s: State, b: Body, ev: StepEvents, list: 'popped' | 'broken') {
  if (b.dead) return;
  b.dead = true;
  const points = MATS[b.mat].points;
  s.score += points;
  if (b.mat === 'blob') s.targets--;
  ev[list].push({ x: b.x, y: b.y, mat: b.mat, points });
  wakeAround(s, b);
}

/** One fixed physics tick. */
function tick(s: State, ev: StepEvents) {
  const h = TICK;
  const bodies = s.bodies;
  for (const b of bodies) if (dynamic(b)) b.vy += GRAVITY * h;

  // Contacts (pairs where something moves); moving bodies wake what they touch.
  const contacts: Contact[] = [];
  const lo = new Map<Body, number>();
  const hi = new Map<Body, number>();
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (!dynamic(a) && !dynamic(b)) continue;
      if (Math.abs(a.x - b.x) > a.hw + b.hw + MARGIN || Math.abs(a.y - b.y) > a.hh + b.hh + MARGIN) continue;
      const c = collide(a, b);
      if (!c) continue;
      if (!a.awake && moving(b)) wake(a);
      if (!b.awake && moving(a)) wake(b);
      const ma = MATS[a.mat];
      const mb = MATS[b.mat];
      const ia = dynamic(a) ? a.inv : 0;
      const ib = dynamic(b) ? b.inv : 0;
      const vn = (b.vx - a.vx) * c.nx + (b.vy - a.vy) * c.ny;
      const e = Math.max(ma.bounce, mb.bounce);
      contacts.push({
        a,
        b,
        ...c,
        ia,
        ib,
        bounce: c.pen < 0 ? c.pen / h : vn < -BOUNCE_V ? -e * vn : 0,
        mu: Math.sqrt(ma.friction * mb.friction),
        hit: c.pen < 0 ? 0 : Math.max(0, -vn),
        pn: c.pen < 0 ? 0 : (s.warm.get(a.id * 4096 + b.id)?.[0] ?? 0),
        pt: c.pen < 0 ? 0 : (s.warm.get(a.id * 4096 + b.id)?.[1] ?? 0),
      });
      // What holds a box up: contacts below it, as an x span.
      for (const [top, ny] of [
        [a, -c.ny],
        [b, c.ny],
      ] as const)
        if (!top.ball && ny < -0.7 && c.pen > -MARGIN) {
          lo.set(top, Math.min(lo.get(top) ?? Infinity, c.px - c.span));
          hi.set(top, Math.max(hi.get(top) ?? -Infinity, c.px + c.span));
        }
    }
  }

  // Sequential impulses, warm-started: normal (no pulling) then friction (within the cone).
  for (const c of contacts) {
    const jx = c.pn * c.nx - c.pt * c.ny;
    const jy = c.pn * c.ny + c.pt * c.nx;
    c.a.vx -= jx * c.ia;
    c.a.vy -= jy * c.ia;
    c.b.vx += jx * c.ib;
    c.b.vy += jy * c.ib;
  }
  for (let it = 0; it < ITERATIONS; it++)
    for (const c of contacts) {
      const k = c.ia + c.ib;
      if (!k) continue;
      const { a, b, nx, ny } = c;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      const old = c.pn;
      c.pn = Math.max(0, old + (c.bounce - vn) / k);
      let j = c.pn - old;
      a.vx -= j * nx * c.ia;
      a.vy -= j * ny * c.ia;
      b.vx += j * nx * c.ib;
      b.vy += j * ny * c.ib;
      const vt = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
      const oldT = c.pt;
      c.pt = clamp(oldT - vt / k, -c.mu * c.pn, c.mu * c.pn);
      j = c.pt - oldT;
      a.vx -= j * -ny * c.ia;
      a.vy -= j * nx * c.ia;
      b.vx += j * -ny * c.ib;
      b.vy += j * nx * c.ib;
    }

  // Boxes hanging past their support slide off it.
  for (const [b, l] of lo) {
    const r = hi.get(b) ?? l;
    if (!dynamic(b)) continue;
    // (Under SLEEP_V per tick, so a box wedged against a neighbour can still fall asleep.)
    if (b.x < l - 0.5) b.vx -= TIP * h;
    else if (b.x > r + 0.5) b.vx += TIP * h;
  }

  s.warm = new Map(contacts.map((c) => [c.a.id * 4096 + c.b.id, [c.pn, c.pt]]));

  // Damage: each body's share of the impact speed (by mass), so resting loads never break anything.
  for (const c of contacts)
    for (const [body, inv] of [
      [c.a, c.ia],
      [c.b, c.ib],
    ] as const) {
      // Blobs are soft: being squashed (the whole impulse, loads included) pops them too.
      const dv = !inv ? 0 : body.mat === 'blob' ? Math.max(c.pn * inv, (c.hit * inv) / (c.ia + c.ib)) : (c.hit * inv) / (c.ia + c.ib);
      if (body.dead || !dv) continue;
      if (dv > 90) ev.bumps.push({ x: c.px, y: body.y, v: dv });
      const m = MATS[body.mat];
      if (body.mat === 'blob' && dv > POP_V) remove(s, body, ev, 'popped');
      else if (m.tough && dv > m.tough) {
        body.hp--;
        if (body.hp <= 0) remove(s, body, ev, 'broken');
        else ev.cracked.push({ x: body.x, y: body.y, mat: body.mat, points: 0 });
      }
    }

  for (const b of bodies)
    if (dynamic(b)) {
      b.x += b.vx * h;
      b.y += b.vy * h;
      if (b.ball) b.spin += (b.vx * h) / b.hw;
    }

  // Push overlapping pairs apart (positions only, so nothing gains speed).
  for (let pass = 0; pass < 2; pass++)
    for (const c of contacts) {
      const k = c.ia + c.ib;
      if (!k || c.a.dead || c.b.dead) continue;
      const q = collide(c.a, c.b);
      if (!q || q.pen <= SLOP) continue;
      const p = ((q.pen - SLOP) * PUSH) / k;
      c.a.x -= q.nx * p * c.ia;
      c.a.y -= q.ny * p * c.ia;
      c.b.x += q.nx * p * c.ib;
      c.b.y += q.ny * p * c.ib;
    }

  // Rolling balls slow down on whatever they roll on.
  for (const c of contacts) for (const body of [c.a, c.b]) if (body.ball && dynamic(body) && Math.abs(c.ny) > 0.7) body.vx *= 1 - 1.5 * h;

  for (const b of bodies) {
    if (b.dead || !dynamic(b)) continue;
    if (b.y > H + 40 || b.x < -40 || b.x > W + 40) {
      if (b.mat === 'shot') b.dead = true;
      else remove(s, b, ev, b.mat === 'blob' ? 'popped' : 'broken');
      continue;
    }
    if (Math.hypot(b.vx, b.vy) < SLEEP_V) b.idle += h;
    else b.idle = 0;
    if (b.idle > SLEEP_S) Object.assign(b, { awake: false, vx: 0, vy: 0 });
  }
  if (bodies.some((b) => b.dead)) s.bodies = bodies.filter((b) => !b.dead);
}

/** Advance by `dt` seconds: the aim keys, then the physics in fixed ticks while a stone is out. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    popped: [],
    broken: [],
    bumps: [],
    cracked: [],
    crumbled: [],
    ready: false,
    cleared: false,
    over: false,
    bonus: 0,
  };
  if (s.phase === 'aim') {
    s.angle = clamp(s.angle + s.turn * TURN_SPEED * dt, MIN_ANGLE, MAX_ANGLE);
    s.power = clamp(s.power + s.pull * PULL_SPEED * dt, 0, 1);
    return ev;
  }
  if (s.phase === 'done') return ev;
  s.acc += dt;
  while (s.acc >= TICK) {
    s.acc -= TICK;
    s.flight += TICK;
    tick(s, ev);
    if (s.targets <= 0) {
      ev.bonus = (s.shots - s.used) * SHOT_BONUS;
      s.score += ev.bonus;
      s.phase = 'done';
      ev.cleared = true;
      return ev;
    }
    if (s.flight > MAX_FLIGHT || !s.bodies.some((b) => b.awake && b.inv > 0)) {
      // Spent stones crumble away, unless something rests on them.
      for (const b of s.bodies)
        if (b.mat === 'shot' && !s.bodies.some((o) => o.inv && o !== b && o.y < b.y && collide(o, b))) {
          b.dead = true;
          ev.crumbled.push({ x: b.x, y: b.y, mat: b.mat, points: 0 });
        }
      s.bodies = s.bodies.filter((b) => !b.dead);
      s.acc = 0;
      s.shot = -1;
      ev.over = s.used >= s.shots;
      ev.ready = !ev.over;
      s.phase = ev.over ? 'done' : 'aim';
      return ev;
    }
  }
  return ev;
}
