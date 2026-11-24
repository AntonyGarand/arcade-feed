import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units; everything wraps around its edges. */
export const W = 300;
export const H = 400;
export const SHIP_R = 8;
export const LIVES = 3;
/** Rock radius and points by size (1 small, 2 medium, 3 big). */
export const ROCK_R = [0, 9, 17, 30] as const;
export const POINTS = [0, 100, 50, 20] as const;
/** Iron rocks take two hits per piece and score half as much again. */
const IRON_PAY = 1.5;
/** Clear bonus: per life left, and per second under par. */
export const LIFE_BONUS = 250;
export const TIME_POINTS = 10;
/** Turn rate (rad/s), thrust (units/s²), drag (per second) and top speed of the ship. */
const TURN = 4.4;
const THRUST = 230;
const DRAG = 0.7;
const MAX_V = 190;
const BULLET_V = 330;
const BULLET_LIFE = 0.75;
export const BULLET_R = 2.4;
const MAX_BULLETS = 4;
const FIRE_GAP = 0.22;
/** Safe time after a respawn; a respawn waits for a clear centre, or forces a shield after a while. */
const SAFE_S = 2.2;
const RESPAWN_S = 1.1;
const FORCE_S = 3.2;
const CLEAR_R = 70;
/** Touch: a finger farther than this from the ship makes it thrust (gently). */
export const TOUCH_THRUST = 80;
const TOUCH_POWER = 0.65;

/** The saucer hunter: radius, and what it's worth (as much as a big rock and all its pieces). */
export const UFO_R = 11;
export const UFO_POINTS = POINTS[3] + 2 * POINTS[2] + 4 * POINTS[1];
const UFO_SHOT_V = 110;
const UFO_SHOT_LIFE = 3;
export const SHOT_R = 3;
/** Mines: radius, blast radius, and points for setting one off. */
export const MINE_R = 6;
export const MINE_BLAST = 58;
export const MINE_POINTS = 25;
/** Gravity well: pull at 60 units (units/s²), the deadly core's radius. */
const PULL = 70;
export const CORE_R = 12;

/** Seconds between two hits before the combo ends. */
export const COMBO_WINDOW = 2.2;
/** Hits in a combo that unlock a power: rapid fire, spread shot, shield, smart bomb, then both guns. */
export const COMBO_TIERS = [5, 10, 16, 24, 34] as const;
export type Power = 'rapid' | 'spread' | 'shield' | 'bomb' | 'frenzy';
const TIER_POWERS: readonly Power[] = ['rapid', 'spread', 'shield', 'bomb', 'frenzy'];
/** Seconds a rapid fire or spread shot lasts. */
export const POWER_S = 8;
/** Smart bomb: breaks every rock this close to the ship. */
export const BOMB_R = 120;

/** Big rocks at the start, their speed, and the par time (seconds) for the time bonus. */
export const bigFor = (d: Difficulty) => byLevel(d, [4, 5, 6, 7, 8]);
const speedFor = (d: Difficulty) => byLevel(d, [26, 32, 38, 45, 52]);
export const parFor = (d: Difficulty) => byLevel(d, [45, 55, 65, 75, 85]);

/** The kinds of field a level can deal. */
export const KINDS = [
  { id: 'belt', weight: 2 },
  { id: 'swarm' },
  { id: 'minefield', min: 2 },
  { id: 'hunter', min: 2 },
  { id: 'iron', min: 3 },
  { id: 'well', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

export interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 3 big, 2 medium, 1 small. */
  size: number;
  /** Outline: one radius factor per vertex (irregular polygon). */
  shape: number[];
  rot: number;
  spin: number;
  /** Iron rock: each piece takes two hits. */
  iron: boolean;
  /** Hits left (2 for a fresh iron piece). */
  hp: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** The saucer: drifts across, wobbling, and fires at the ship. Must be shot down to clear. */
export interface Ufo {
  x: number;
  y: number;
  /** Lane it wobbles around. */
  y0: number;
  vx: number;
  hp: number;
  max: number;
  cool: number;
  t: number;
}

interface Mine {
  x: number;
  y: number;
  /** Phase of its blink. */
  ph: number;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  rocks: Rock[];
  bullets: Bullet[];
  /** Saucer shots. */
  shots: Bullet[];
  ufo: Ufo | null;
  /** Seconds until the saucer shows up (−1: none to come). */
  ufoDue: number;
  mines: Mine[];
  /** Gravity well centre, or null. */
  well: { x: number; y: number } | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Heading in radians, 0 = up, clockwise. */
  a: number;
  alive: boolean;
  /** Seconds of safety left (blinks, rocks pass through). */
  safe: number;
  /** Seconds since the ship was lost (waiting to respawn). */
  wait: number;
  cool: number;
  /** Keyboard: turn -1/0/1, thrust and fire held. */
  turn: number;
  thrust: boolean;
  fire: boolean;
  /** Touch: where the finger is held (null when not touching). */
  pointer: { x: number; y: number } | null;
  /** The ship thrusted this step (for the flame). */
  burning: boolean;
  /** Hits in a row, each within `COMBO_WINDOW` of the last; seconds left; milestones reached. */
  combo: number;
  comboLeft: number;
  tier: number;
  /** Seconds of rapid fire and spread shot left; a shield that soaks one hit. */
  rapid: number;
  spread: number;
  shield: boolean;
  lives: number;
  score: number;
  time: number;
  rng: Rng;
}

/** Wrapped difference b − a along an axis of length `size`, in [−size/2, size/2). */
export const wrapD = (a: number, b: number, size: number) => ((((b - a + size / 2) % size) + size) % size) - size / 2;
const wrap = (v: number, size: number) => ((v % size) + size) % size;
/** Wrapped distance between two points of the field. */
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(wrapD(ax, bx, W), wrapD(ay, by, H));
/** Smallest signed angle from a to b. */
export const angleTo = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function makeRock(rng: Rng, x: number, y: number, size: number, dir: number, speed: number, iron = false): Rock {
  const n = rng.int(9, 12);
  const shape: number[] = [];
  for (let i = 0; i < n; i++) shape.push(0.72 + rng.next() * 0.34);
  return {
    x,
    y,
    vx: Math.sin(dir) * speed,
    vy: -Math.cos(dir) * speed,
    size,
    shape,
    rot: rng.next() * Math.PI * 2,
    spin: (rng.next() - 0.5) * (4 - size) * 0.9,
    iron,
    hp: iron ? 2 : 1,
  };
}

/** Rocks in a ring around (never on) the centre, mostly heading sideways so none starts on a collision course. */
function ring(rng: Rng, n: number, size: number, sp: number, from: number, to: number): Rock[] {
  const rocks: Rock[] = [];
  const turn0 = rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const at = turn0 + (i * Math.PI * 2) / n + (rng.next() - 0.5) * 0.6;
    const d = from + rng.next() * (to - from);
    const x = wrap(W / 2 + Math.sin(at) * d, W);
    const y = wrap(H / 2 - Math.cos(at) * d, H);
    const dir = at + (rng.chance(0.5) ? 1 : -1) * (Math.PI / 2 + (rng.next() - 0.5) * 0.8);
    rocks.push(makeRock(rng, x, y, size, dir, sp * (0.8 + rng.next() * 0.4)));
  }
  return rocks;
}

/** A spot at least `min` from the centre and `gap` from every spot in `taken`. */
function spot(rng: Rng, min: number, gap: number, taken: { x: number; y: number }[]) {
  for (let i = 0; ; i++) {
    const p = { x: 20 + rng.next() * (W - 40), y: 24 + rng.next() * (H - 48) };
    if (i > 200) return p;
    if (dist(p.x, p.y, W / 2, H / 2) < min) continue;
    if (taken.some((q) => dist(p.x, p.y, q.x, q.y) < gap)) continue;
    return p;
  }
}

/** Deal a level: its kind, then rocks (and mines, a saucer or a well) around the ship, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const n = bigFor(d);
  const sp = speedFor(d);
  let rocks: Rock[];
  const mines: Mine[] = [];
  let well: State['well'] = null;
  let ufoDue = -1;
  switch (kind) {
    case 'swarm':
      // Twice as many medium rocks, a bit quicker: about the same points and hits as the big ones.
      rocks = ring(rng, n * 2, 2, sp * 1.15, 100, 175);
      break;
    case 'hunter':
      // One big rock fewer, and a saucer worth as much that hunts you.
      rocks = ring(rng, n - 1, 3, sp, 120, 170);
      ufoDue = 2.5;
      break;
    case 'iron': {
      // Two iron rocks (two hits a piece, 1.5× points) in place of three plain ones: same points.
      rocks = ring(rng, n - 1, 3, sp, 120, 170);
      for (const k of rng.shuffle(rocks.map((_, i) => i)).slice(0, 2)) Object.assign(rocks[k], { iron: true, hp: 2 });
      break;
    }
    case 'minefield': {
      rocks = ring(rng, n, 3, sp, 120, 170);
      const count = byLevel(d, [4, 4, 5, 6, 6]);
      for (let i = 0; i < count; i++) mines.push({ ...spot(rng, 80, 46, mines), ph: rng.next() * Math.PI * 2 });
      break;
    }
    case 'well':
      rocks = ring(rng, n, 3, sp * 0.9, 120, 170);
      well = spot(rng, 115, 0, []);
      break;
    default:
      rocks = ring(rng, n, 3, sp, 120, 170);
  }
  return {
    d,
    kind,
    rocks,
    bullets: [],
    shots: [],
    ufo: null,
    ufoDue,
    mines,
    well,
    x: W / 2,
    y: H / 2,
    vx: 0,
    vy: 0,
    a: 0,
    alive: true,
    safe: 1.2,
    wait: 0,
    cool: 0,
    turn: 0,
    thrust: false,
    fire: false,
    pointer: null,
    burning: false,
    combo: 0,
    comboLeft: 0,
    tier: 0,
    rapid: 0,
    spread: 0,
    shield: false,
    lives: LIVES,
    score: 0,
    time: 0,
    rng,
  };
}

/** Something blew up here: for the card's debris. */
interface Blast {
  x: number;
  y: number;
  r: number;
  what: 'rock' | 'ship' | 'mine' | 'ufo';
  /** Points it scored (0 for the ship). */
  pts: number;
  iron?: boolean;
}

/** What one step changed, for the card. */
export interface StepEvents {
  blasts: Blast[];
  /** Shots that dented an iron rock or the saucer without breaking it. */
  dents: { x: number; y: number }[];
  hit: boolean;
  /** Combo milestone reached this step (1-based) and the power it gave; 0 / null for none. */
  tier: number;
  power: Power | null;
  /** The combo ended this step (it was at least this long). */
  comboEnd: number;
  /** The saucer showed up, or fired. */
  ufoIn: boolean;
  ufoFired: boolean;
  /** The shield soaked a hit. */
  shielded: boolean;
  died: boolean;
  respawned: boolean;
  cleared: boolean;
  over: boolean;
}

/** The ship's controls this step, merging keys and the held finger. */
function controls(s: State, dt: number): { thrust: number; fire: boolean } {
  let thrust = s.thrust ? 1 : 0;
  let fire = s.fire;
  if (s.pointer) {
    // Turn toward the finger (snapping when close), thrust gently if it's far, fire while held.
    const dx = s.pointer.x - s.x;
    const dy = s.pointer.y - s.y;
    const diff = angleTo(s.a, Math.atan2(dx, -dy));
    s.a += Math.abs(diff) <= TURN * dt ? diff : Math.sign(diff) * TURN * dt;
    if (Math.hypot(dx, dy) > TOUCH_THRUST && Math.abs(diff) < 1.2) thrust = Math.max(thrust, TOUCH_POWER);
    fire = true;
  } else s.a += s.turn * TURN * dt;
  return { thrust, fire };
}

/** Turn a power on. */
export function grant(s: State, p: Power, ev?: StepEvents) {
  if (p === 'rapid' || p === 'frenzy') s.rapid = POWER_S;
  if (p === 'spread' || p === 'frenzy') s.spread = POWER_S;
  if (p === 'shield') s.shield = true;
  if (p === 'bomb') smartBomb(s, ev ?? blankEvents());
}

/** Count `n` hits towards the combo; a milestone grants its power. */
function comboHit(s: State, n: number, ev: StepEvents) {
  s.combo += n;
  s.comboLeft = COMBO_WINDOW;
  while (s.tier < COMBO_TIERS.length && s.combo >= COMBO_TIERS[s.tier]) {
    s.tier++;
    const p = TIER_POWERS[s.tier - 1];
    ev.tier = s.tier;
    ev.power = p;
    grant(s, p, ev);
  }
}

function comboBreak(s: State, ev: StepEvents) {
  if (s.combo >= 2) ev.comboEnd = s.combo;
  s.combo = s.tier = 0;
  s.comboLeft = 0;
}

/** Break rock `i`: two smaller ones fly apart (small ones just vanish). Returns false for a dent on iron. */
function breakRock(s: State, i: number, ev: StepEvents, force = false): boolean {
  const r = s.rocks[i];
  if (r.hp > 1 && !force) {
    r.hp--;
    ev.dents.push({ x: r.x, y: r.y });
    return false;
  }
  s.rocks.splice(i, 1);
  const pts = Math.round(POINTS[r.size] * (r.iron ? IRON_PAY : 1));
  s.score += pts;
  ev.hit = true;
  ev.blasts.push({ x: r.x, y: r.y, r: ROCK_R[r.size], what: 'rock', pts, iron: r.iron });
  if (r.size <= 1) return true;
  const dir = Math.atan2(r.vx, -r.vy);
  const sp = Math.max(Math.hypot(r.vx, r.vy) * 1.3, speedFor(s.d) * (r.size === 3 ? 1.3 : 1.7));
  for (const k of [-1, 1]) {
    const d2 = dir + k * (0.45 + s.rng.next() * 0.5);
    s.rocks.push(makeRock(s.rng, r.x, r.y, r.size - 1, d2, sp * (0.9 + s.rng.next() * 0.2), r.iron));
  }
  return true;
}

/** Damage the saucer; true when it goes down. */
function hitUfo(s: State, ev: StepEvents, dmg = 1): boolean {
  const u = s.ufo;
  if (!u) return false;
  u.hp -= dmg;
  if (u.hp > 0) {
    ev.dents.push({ x: u.x, y: u.y });
    return false;
  }
  s.ufo = null;
  s.shots = [];
  s.score += UFO_POINTS;
  ev.hit = true;
  ev.blasts.push({ x: u.x, y: u.y, r: UFO_R * 2, what: 'ufo', pts: UFO_POINTS });
  return true;
}

/** Set off mine `i`: it breaks every rock (one step) in its blast, chains other mines, hurts the saucer. */
function detonate(s: State, i: number, ev: StepEvents): number {
  const m = s.mines[i];
  s.mines.splice(i, 1);
  s.score += MINE_POINTS;
  ev.hit = true;
  ev.blasts.push({ x: m.x, y: m.y, r: MINE_BLAST, what: 'mine', pts: MINE_POINTS });
  let n = 1;
  const caught = s.rocks.filter((r) => dist(r.x, r.y, m.x, m.y) < MINE_BLAST + ROCK_R[r.size] * 0.5);
  for (const r of caught) {
    const j = s.rocks.indexOf(r);
    if (j >= 0 && breakRock(s, j, ev, true)) n++;
  }
  if (s.ufo && dist(s.ufo.x, s.ufo.y, m.x, m.y) < MINE_BLAST + UFO_R && hitUfo(s, ev, 2)) n++;
  for (let j = s.mines.length - 1; j >= 0; j--) {
    if (j < s.mines.length && dist(s.mines[j].x, s.mines[j].y, m.x, m.y) < MINE_BLAST) n += detonate(s, j, ev);
  }
  return n;
}

/** The smart bomb: every rock near the ship breaks a step, the saucer takes a hit, its shots vanish. */
function smartBomb(s: State, ev: StepEvents) {
  const caught = s.rocks.filter((r) => dist(r.x, r.y, s.x, s.y) < BOMB_R + ROCK_R[r.size]);
  for (const r of caught) {
    const j = s.rocks.indexOf(r);
    if (j >= 0) breakRock(s, j, ev, true);
  }
  if (s.ufo && dist(s.ufo.x, s.ufo.y, s.x, s.y) < BOMB_R + UFO_R) hitUfo(s, ev);
  s.shots = [];
  if (s.alive) s.safe = Math.max(s.safe, 1);
}

/** The well's pull on something at (x, y), as an acceleration. */
function pull(s: State, x: number, y: number): [number, number] {
  if (!s.well) return [0, 0];
  const dx = wrapD(x, s.well.x, W);
  const dy = wrapD(y, s.well.y, H);
  const r = Math.hypot(dx, dy) || 1;
  const a = Math.min(400, PULL * (60 / Math.max(r, 20)) ** 2);
  return [(dx / r) * a, (dy / r) * a];
}

const centreClear = (s: State) =>
  s.rocks.every((r) => dist(W / 2, H / 2, r.x, r.y) > CLEAR_R + ROCK_R[r.size]) &&
  (!s.ufo || dist(W / 2, H / 2, s.ufo.x, s.ufo.y) > CLEAR_R);

const blankEvents = (): StepEvents => ({
  blasts: [],
  dents: [],
  hit: false,
  tier: 0,
  power: null,
  comboEnd: 0,
  ufoIn: false,
  ufoFired: false,
  shielded: false,
  died: false,
  respawned: false,
  cleared: false,
  over: false,
});

/** Saucer: shows up from a side edge, drifts across with a wobble, fires at the ship. */
function moveUfo(s: State, dt: number, ev: StepEvents) {
  if (!s.ufo && s.ufoDue >= 0) {
    if (!s.rocks.length) s.ufoDue = 0;
    s.ufoDue -= dt;
    if (s.ufoDue <= 0) {
      const left = s.rng.chance(0.5);
      const lane = s.rng.pick([0.18, 0.3, 0.7, 0.82]) * H;
      const hp = byLevel(s.d, [3, 3, 3, 4, 4]);
      s.ufo = { x: left ? 0 : W, y: lane, y0: lane, vx: (left ? 1 : -1) * (38 + s.d * 5), hp, max: hp, cool: 1.4, t: 0 };
      s.ufoDue = -1;
      ev.ufoIn = true;
    }
  }
  const u = s.ufo;
  if (!u) return;
  u.t += dt;
  u.x = wrap(u.x + u.vx * dt, W);
  u.y = wrap(u.y0 + Math.sin(u.t * 1.7) * 28, H);
  u.cool -= dt;
  if (u.cool <= 0 && s.alive && s.safe <= 0) {
    u.cool = byLevel(s.d, [2.8, 2.6, 2.4, 2.1, 1.9]);
    const aim = Math.atan2(wrapD(u.x, s.x, W), -wrapD(u.y, s.y, H)) + (s.rng.next() - 0.5) * 0.35;
    s.shots.push({ x: u.x, y: u.y, vx: Math.sin(aim) * UFO_SHOT_V, vy: -Math.cos(aim) * UFO_SHOT_V, life: UFO_SHOT_LIFE });
    ev.ufoFired = true;
  }
}

/** Lose the ship (unless the shield soaks it). True when the run is over. */
function crash(s: State, ev: StepEvents): boolean {
  if (s.shield) {
    s.shield = false;
    s.safe = 1;
    ev.shielded = true;
    return false;
  }
  s.alive = false;
  s.wait = 0;
  s.lives--;
  s.rapid = s.spread = 0;
  comboBreak(s, ev);
  ev.died = true;
  ev.blasts.push({ x: s.x, y: s.y, r: 14, what: 'ship', pts: 0 });
  return s.lives <= 0;
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev = blankEvents();
  s.time += dt;
  s.cool -= dt;
  s.burning = false;
  s.rapid = Math.max(0, s.rapid - dt);
  s.spread = Math.max(0, s.spread - dt);
  if (s.combo && (s.comboLeft -= dt) <= 0) comboBreak(s, ev);

  if (s.alive) {
    const c = controls(s, dt);
    const hx = Math.sin(s.a);
    const hy = -Math.cos(s.a);
    if (c.thrust) {
      s.vx += hx * THRUST * c.thrust * dt;
      s.vy += hy * THRUST * c.thrust * dt;
      s.burning = true;
    }
    const [gx, gy] = pull(s, s.x, s.y);
    s.vx += gx * dt;
    s.vy += gy * dt;
    const k = Math.exp(-DRAG * dt);
    s.vx *= k;
    s.vy *= k;
    const v = Math.hypot(s.vx, s.vy);
    if (v > MAX_V) {
      s.vx *= MAX_V / v;
      s.vy *= MAX_V / v;
    }
    s.x = wrap(s.x + s.vx * dt, W);
    s.y = wrap(s.y + s.vy * dt, H);
    s.safe = Math.max(0, s.safe - dt);
    const fan = s.spread > 0 ? [-0.24, 0, 0.24] : [0];
    const max = MAX_BULLETS * (s.rapid > 0 ? 2 : 1) + (fan.length - 1) * 2;
    if (c.fire && s.cool <= 0 && s.bullets.length + fan.length <= max) {
      s.cool = s.rapid > 0 ? FIRE_GAP / 2 : FIRE_GAP;
      for (const f of fan) {
        const bx = Math.sin(s.a + f);
        const by = -Math.cos(s.a + f);
        s.bullets.push({
          x: s.x + hx * SHIP_R,
          y: s.y + hy * SHIP_R,
          vx: bx * BULLET_V + s.vx * 0.4,
          vy: by * BULLET_V + s.vy * 0.4,
          life: BULLET_LIFE,
        });
      }
    }
  } else if (s.lives > 0) {
    s.wait += dt;
    const forced = s.wait >= FORCE_S;
    if (s.wait >= RESPAWN_S && (forced || centreClear(s))) {
      Object.assign(s, { alive: true, x: W / 2, y: H / 2, vx: 0, vy: 0, a: 0, safe: forced ? SAFE_S + 1 : SAFE_S, wait: 0 });
      ev.respawned = true;
    }
  }

  const cap = speedFor(s.d) * 3;
  for (const r of s.rocks) {
    if (s.well) {
      const [gx, gy] = pull(s, r.x, r.y);
      r.vx += gx * dt;
      r.vy += gy * dt;
      const v = Math.hypot(r.vx, r.vy);
      if (v > cap) {
        r.vx *= cap / v;
        r.vy *= cap / v;
      }
    }
    r.x = wrap(r.x + r.vx * dt, W);
    r.y = wrap(r.y + r.vy * dt, H);
    r.rot += r.spin * dt;
  }
  moveUfo(s, dt, ev);
  for (const m of s.mines) m.ph += dt;

  // Bullets: in two half-steps so a fast shot never skips a small rock.
  for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
    const b = s.bullets[bi];
    b.life -= dt;
    let gone = b.life <= 0;
    if (s.well) {
      const [gx, gy] = pull(s, b.x, b.y);
      b.vx += gx * dt;
      b.vy += gy * dt;
    }
    for (let h = 0; h < 2 && !gone; h++) {
      b.x = wrap(b.x + (b.vx * dt) / 2, W);
      b.y = wrap(b.y + (b.vy * dt) / 2, H);
      const i = s.rocks.findIndex((r) => dist(r.x, r.y, b.x, b.y) < ROCK_R[r.size] * 0.95 + BULLET_R);
      if (i >= 0) {
        breakRock(s, i, ev);
        comboHit(s, 1, ev);
        gone = true;
        continue;
      }
      const m = s.mines.findIndex((q) => dist(q.x, q.y, b.x, b.y) < MINE_R + BULLET_R + 1);
      if (m >= 0) {
        comboHit(s, detonate(s, m, ev), ev);
        gone = true;
        continue;
      }
      if (s.ufo && dist(s.ufo.x, s.ufo.y, b.x, b.y) < UFO_R + BULLET_R) {
        hitUfo(s, ev);
        comboHit(s, 1, ev);
        gone = true;
      }
    }
    if (gone) s.bullets.splice(bi, 1);
  }

  // Saucer shots drift on until they fade (they pass through rocks).
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const b = s.shots[i];
    b.life -= dt;
    b.x = wrap(b.x + b.vx * dt, W);
    b.y = wrap(b.y + b.vy * dt, H);
    if (b.life <= 0) s.shots.splice(i, 1);
  }

  if (s.alive && s.safe <= 0) {
    const i = s.rocks.findIndex((r) => dist(r.x, r.y, s.x, s.y) < ROCK_R[r.size] * 0.85 + SHIP_R * 0.8);
    const m = s.mines.findIndex((q) => dist(q.x, q.y, s.x, s.y) < MINE_R + SHIP_R * 0.8);
    const shot = s.shots.findIndex((b) => dist(b.x, b.y, s.x, s.y) < SHOT_R + SHIP_R * 0.7);
    const ufo = !!s.ufo && dist(s.ufo.x, s.ufo.y, s.x, s.y) < UFO_R + SHIP_R * 0.8;
    const core = !!s.well && dist(s.well.x, s.well.y, s.x, s.y) < CORE_R;
    if (i >= 0 || m >= 0 || shot >= 0 || ufo || core) {
      const over = crash(s, ev);
      if (i >= 0) breakRock(s, i, ev, true);
      if (m >= 0) detonate(s, m, ev);
      if (shot >= 0) s.shots.splice(shot, 1);
      if (ufo) hitUfo(s, ev);
      if (core && s.well && ev.shielded) {
        // The shield flings the ship clear of the core.
        const dx = wrapD(s.well.x, s.x, W);
        const dy = wrapD(s.well.y, s.y, H);
        const r = Math.hypot(dx, dy) || 1;
        s.vx = (dx / r) * MAX_V;
        s.vy = (dy / r) * MAX_V;
      }
      if (over) {
        ev.over = true;
        return ev;
      }
    }
  }

  if (!s.rocks.length && !s.ufo && s.ufoDue < 0) {
    s.score += s.lives * LIFE_BONUS + Math.max(0, Math.round((parFor(s.d) - s.time) * TIME_POINTS));
    ev.cleared = true;
  }
  return ev;
}

/** Rocks (and the saucer) still to shoot. */
export const targetsLeft = (s: State) => s.rocks.length + (s.ufo || s.ufoDue >= 0 ? 1 : 0);

/** Points still on the field if every rock and the saucer are shot (mines not counted). */
export function worth(s: State): number {
  const family = (size: number): number => POINTS[size] + (size > 1 ? 2 * family(size - 1) : 0);
  const rocks = s.rocks.reduce((t, r) => t + Math.round(family(r.size) * (r.iron ? IRON_PAY : 1)), 0);
  return rocks + (s.ufo || s.ufoDue >= 0 ? UFO_POINTS : 0);
}

/** Every rock's points if all of them are shot: big 20, two medium 50, four small 100. */
export const rockPoints = (d: Difficulty) => bigFor(d) * (POINTS[3] + 2 * POINTS[2] + 4 * POINTS[1]);
