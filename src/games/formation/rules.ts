import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';
import { Combo } from '../../kits/combo/combo';

/** Playfield in world units. */
export const W = 300;
export const H = 400;
export const LIVES = 3;
/** Formation cell (one critter per cell) and critter half-size. */
const CELL_W = 30;
const CELL_H = 28;
export const CRITTER_R = 11;
const TOP = 40;
const MARGIN = 8;
/** Sideways step per march tick, and the drop at an edge. */
const STEP_X = 6;
const STEP_DOWN = 12;
/** Cannon: centre line, half width, speeds. */
export const CANNON_Y = 372;
export const CANNON_HW = 13;
const KEY_SPEED = 190;
const DRAG_SPEED = 420;
const SHOT_V = 400;
const FIRE_GAP = 0.22;
/** Sideways speed of the two outer shots of a spread. */
const SPREAD_VX = 80;
/** Shots: half width and half length (player), length (enemy). */
export const SHOT_HW = 1.5;
export const SHOT_HL = 6;
/** Shields: a grid of small cells. */
export const SHIELD_Y = 318;
export const BLOCK = 5;
export const SHIELD_COLS = 6;
const SHIELD_ROWS = 4;
/** The formation wins if its lowest critter gets this low. */
export const LAND_Y = 338;
const SAFE_S = 1.6;
/** Clear bonus: per life left, per second under par. */
export const LIFE_BONUS = 200;
export const TIME_POINTS = 10;
/** The mothership: its centre line and half size. */
export const BOSS_Y = 22;
export const BOSS_HW = 22;
export const BOSS_HH = 9;
/** Seconds a combo lives after a hit (taking a hit ends it too). */
export const COMBO_WINDOW = 2.5;
/** Hits in a row (each within `COMBO_WINDOW` of the last, without being hit) that fire a combo event. */
export const COMBO_TIERS = [5, 10, 16, 24, 34] as const;
/** What each combo milestone unlocks, in order. */
const TIER_POWERS = ['rapid', 'spread', 'guard', 'bomb', 'spread'] as const;
/** Seconds rapid fire and spread shot last. */
export const RAPID_S = 8;
export const SPREAD_S = 8;

export const rowsFor = (d: Difficulty) => byLevel(d, [3, 4, 4, 5, 5]);
export const colsFor = (d: Difficulty) => byLevel(d, [6, 7, 8, 8, 8]);
/** Seconds between march ticks with the full formation (it speeds up as it thins out). */
export const tickFor = (d: Difficulty) => byLevel(d, [0.5, 0.44, 0.38, 0.33, 0.29]);
/** Enemy fire: seconds between shots, shot speed, shots on screen. */
export const fireGapFor = (d: Difficulty) => byLevel(d, [1.5, 1.15, 0.95, 0.8, 0.65]);
const enemyShotVFor = (d: Difficulty) => byLevel(d, [120, 135, 150, 165, 180]);
const enemyShotsFor = (d: Difficulty) => byLevel(d, [2, 3, 3, 4, 5]);
/** Player shots allowed on screen at once. */
const shotsFor = (d: Difficulty) => byLevel(d, [2, 2, 2, 1, 1]);
const shieldsFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 3, 2]);
export const parFor = (d: Difficulty) => byLevel(d, [40, 50, 60, 70, 80]);
/** Divers: seconds between dives, how many dive at once, their speed down. */
const diveGapFor = (d: Difficulty) => byLevel(d, [3.2, 2.8, 2.4, 2.1, 1.8]);
const diversAtOnce = (d: Difficulty) => byLevel(d, [1, 1, 2, 2, 2]);
const diveVFor = (d: Difficulty) => byLevel(d, [105, 115, 125, 135, 145]);
/** The mothership's hits and seconds between its volleys. */
export const bossHpFor = (d: Difficulty) => byLevel(d, [6, 8, 10, 12, 14]);
const bossGapFor = (d: Difficulty) => byLevel(d, [2.8, 2.5, 2.2, 2.0, 1.8]);

/** The kinds of formation a level can deal. */
export const KINDS = [
  { id: 'block', weight: 2 },
  { id: 'wedge' },
  { id: 'armour', min: 2 },
  { id: 'swoop', min: 2 },
  { id: 'mothership', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** A critter's type: `armour` takes two hits, `diver` peels off and swoops at the cannon. */
type CritterType = 'plain' | 'armour' | 'diver';
export type Power = (typeof TIER_POWERS)[number];

/** A diver out of the formation: diving at the cannon, or flying back to its slot from the top. */
interface Dive {
  x: number;
  y: number;
  t: number;
  back: boolean;
}

export interface Critter {
  /** Column and row in the formation. */
  c: number;
  r: number;
  /** Look: glyph and palette colour, by row from the top. */
  k: number;
  type: CritterType;
  /** Hits left. */
  hp: number;
  /** Points it's worth. */
  pts: number;
  alive: boolean;
  dive: Dive | null;
}

interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** An outer shot of a spread: it doesn't count towards the shot limit. */
  side?: boolean;
}

interface Shield {
  x: number;
  /** Row-major cells, true while standing. */
  cells: boolean[];
}

/** The mothership hovering over the formation. */
interface Boss {
  x: number;
  dir: number;
  hp: number;
  max: number;
  pts: number;
  fireIn: number;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  critters: Critter[];
  boss: Boss | null;
  /** Formation origin (top-left of cell 0,0) and march direction. */
  ox: number;
  oy: number;
  dir: number;
  tick: number;
  /** Leg pose, flips each tick. */
  pose: number;
  /** Cannon centre; keyboard direction held; drag target; fire held. */
  px: number;
  kdir: number;
  target: number | null;
  fire: boolean;
  cool: number;
  shots: Shot[];
  bombs: Shot[];
  bombIn: number;
  diveIn: number;
  shields: Shield[];
  lives: number;
  safe: number;
  score: number;
  time: number;
  /** Hits in quick succession; its milestones fire `TIER_POWERS`. */
  combo: Combo;
  /** Seconds of rapid fire and spread shot left; a guard bubble that takes the next hit. */
  rapid: number;
  spread: number;
  guard: boolean;
  rng: Rng;
}

/** Points for a critter of row `r` (top rows are worth more). */
const pointsFor = (rows: number, r: number) => 10 * (rows - r);

const SHIELD_SHAPE = (c: number, r: number) =>
  // A bunker: rounded top corners, an arch cut out of the bottom middle.
  !((r === 0 && (c === 0 || c === SHIELD_COLS - 1)) || (r === SHIELD_ROWS - 1 && c >= 2 && c <= 3));

/** The formation's cells (column, row) for a kind: always `rows × cols` of them, but the mothership's (a row fewer). */
function cells(kind: KindId, rows: number, cols: number): [number, number][] {
  const out: [number, number][] = [];
  const mid = (cols - 1) / 2;
  for (let c = 0; c < cols; c++) {
    // A wedge: each column drops by up to two rows towards the middle (an arrowhead pointing down).
    const drop = kind === 'wedge' ? Math.round(2 * (1 - Math.abs(c - mid) / mid)) : 0;
    const n = kind === 'mothership' ? rows - 1 : rows;
    for (let r = 0; r < n; r++) out.push([c, r + drop]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Deal a level: the kind, the formation with its special critters, shields, and the first enemy shot time. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const rows = rowsFor(d);
  const cols = colsFor(d);
  // Points by rank from the top, the same total in every kind: the mothership takes the top row's.
  const ranks: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ranks.push(pointsFor(rows, r));
  const spots = cells(kind, rows, cols);
  const bossPts = ranks.slice(0, ranks.length - spots.length).reduce((a, b) => a + b, 0);
  const pts = ranks.slice(ranks.length - spots.length);
  // Looks by row: a seeded pick of distinct glyph/colour pairs.
  const looks = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  const critters: Critter[] = spots.map(([c, r], i) => ({
    c,
    r,
    k: looks[r % 8],
    type: 'plain',
    hp: 1,
    pts: pts[i],
    alive: true,
    dive: null,
  }));
  const maxR = Math.max(...spots.map(([, r]) => r));
  // Special critters by kind (and a few more at higher levels).
  const pool = rng.shuffle(critters.slice());
  const armour = (k: Critter) => Object.assign(k, { type: 'armour', hp: 2 });
  if (kind === 'armour') {
    for (const k of critters) if (k.r === maxR) armour(k);
    for (const k of pool.filter((q) => q.type === 'plain').slice(0, byLevel(d, [0, 2, 3, 4, 5]))) armour(k);
  } else if (kind !== 'swoop') for (const k of pool.slice(0, byLevel(d, [0, 0, 2, 3, 4]))) armour(k);
  const divers = kind === 'swoop' ? Math.round(critters.length / 3) : byLevel(d, [0, 0, 0, 2, 3]);
  for (const k of pool.filter((q) => q.type === 'plain' && q.r < maxR).slice(0, divers)) k.type = 'diver';

  const n = shieldsFor(d);
  const shields: Shield[] = [];
  for (let i = 0; i < n; i++) {
    const cs: boolean[] = [];
    for (let r = 0; r < SHIELD_ROWS; r++) for (let c = 0; c < SHIELD_COLS; c++) cs.push(SHIELD_SHAPE(c, r));
    shields.push({ x: ((i + 0.5) * W) / n - (SHIELD_COLS * BLOCK) / 2, cells: cs });
  }
  const width = cols * CELL_W;
  const boss: Boss | null =
    kind === 'mothership'
      ? { x: W / 2, dir: rng.chance(0.5) ? 1 : -1, hp: bossHpFor(d), max: bossHpFor(d), pts: bossPts, fireIn: 2 }
      : null;
  return {
    d,
    kind,
    critters,
    boss,
    ox: MARGIN + rng.int(0, Math.floor((W - 2 * MARGIN - width) / STEP_X)) * STEP_X,
    // A wedge starts higher so its point is no lower than a classic block; the mothership's formation sits under it.
    oy: kind === 'wedge' ? TOP - CELL_H : kind === 'mothership' ? TOP + 4 : TOP,
    dir: rng.chance(0.5) ? 1 : -1,
    tick: tickFor(d),
    pose: 0,
    px: W / 2,
    kdir: 0,
    target: null,
    fire: false,
    cool: 0,
    shots: [],
    bombs: [],
    bombIn: fireGapFor(d) * (1 + rng.next()),
    diveIn: diveGapFor(d) + 1.5,
    shields,
    lives: LIVES,
    safe: 0,
    score: 0,
    time: 0,
    combo: new Combo({ tiers: COMBO_TIERS, window: COMBO_WINDOW }),
    rapid: 0,
    spread: 0,
    guard: false,
    rng,
  };
}

/** Where a critter's formation slot is. */
const slotAt = (s: State, k: Critter) => ({ x: s.ox + (k.c + 0.5) * CELL_W, y: s.oy + (k.r + 0.5) * CELL_H });
/** Centre of a critter in world units (its own spot while diving). */
export const critterAt = (s: State, k: Critter) => (k.dive ? { x: k.dive.x, y: k.dive.y } : slotAt(s, k));
export const shieldCell = (sh: Shield, i: number) => ({
  x: sh.x + (i % SHIELD_COLS) * BLOCK,
  y: SHIELD_Y + Math.floor(i / SHIELD_COLS) * BLOCK,
});
export const aliveCount = (s: State) => s.critters.filter((k) => k.alive).length;
/** Targets left: critters, plus the mothership while it flies. */
export const leftCount = (s: State) => aliveCount(s) + (s.boss && s.boss.hp > 0 ? 1 : 0);

/** Seconds per march tick now: from the full pace up to about three times faster for the last critter. */
export const tickNow = (s: State) => tickFor(s.d) * (0.3 + 0.7 * (aliveCount(s) / s.critters.length));

/** Fire a shot from the cannon if one is allowed (rapid fire: twice as often, two more in the air). */
function shoot(s: State) {
  const max = shotsFor(s.d) + (s.rapid > 0 ? 2 : 0);
  if (s.cool > 0 || s.shots.filter((b) => !b.side).length >= max) return false;
  s.cool = FIRE_GAP * (s.rapid > 0 ? 0.5 : 1);
  s.shots.push({ x: s.px, y: CANNON_Y - 10, vx: 0, vy: -SHOT_V });
  if (s.spread > 0) for (const side of [-1, 1]) s.shots.push({ x: s.px, y: CANNON_Y - 10, vx: side * SPREAD_VX, vy: -SHOT_V, side: true });
  return true;
}

/** Knock out the shield cell under (x, y), if any. */
function hitShield(s: State, x: number, y: number): boolean {
  for (const sh of s.shields) {
    if (x < sh.x || x >= sh.x + SHIELD_COLS * BLOCK || y < SHIELD_Y || y >= SHIELD_Y + SHIELD_ROWS * BLOCK) continue;
    const i = Math.floor((y - SHIELD_Y) / BLOCK) * SHIELD_COLS + Math.floor((x - sh.x) / BLOCK);
    if (sh.cells[i]) {
      sh.cells[i] = false;
      return true;
    }
  }
  return false;
}

/** The lowest living critter of each column still in formation (the ones that can shoot). */
export function shooters(s: State): Critter[] {
  const low = new Map<number, Critter>();
  for (const k of s.critters) if (k.alive && !k.dive && (low.get(k.c)?.r ?? -1) < k.r) low.set(k.c, k);
  return [...low.values()];
}

/** A critter popped (or the cannon or the mothership was hit) here, for the card's effects. */
interface Pop {
  x: number;
  y: number;
  /** Look of the critter; -1 for the cannon, -2 for the mothership. */
  k: number;
  /** Points it scored (0 for the cannon, or a hit that didn't finish it). */
  pts: number;
  /** Still alive after the hit (armour, mothership). */
  dent?: boolean;
}

export interface StepEvents {
  pops: Pop[];
  hit: boolean;
  hurt: boolean;
  /** The guard bubble took a hit instead of the cannon. */
  blocked: boolean;
  fired: boolean;
  /** Combo count after a hit this step (0: no hit). */
  combo: number;
  /** A combo milestone reached this step (1-based) and what it unlocked. */
  tier: number;
  power: Power | null;
  /** A critter peeled off to dive. */
  dove: boolean;
  cleared: boolean;
  over: boolean;
}

/** March one tick: sideways, or down and turn around at an edge. */
function march(s: State) {
  s.pose ^= 1;
  const live = s.critters.filter((k) => k.alive);
  const lo = Math.min(...live.map((k) => k.c));
  const hi = Math.max(...live.map((k) => k.c));
  const left = s.ox + lo * CELL_W + s.dir * STEP_X;
  const right = s.ox + (hi + 1) * CELL_W + s.dir * STEP_X;
  if (left < MARGIN || right > W - MARGIN) {
    s.oy += STEP_DOWN;
    s.dir = -s.dir;
  } else s.ox += s.dir * STEP_X;
  // Critters chew through the shields they walk over.
  for (const k of live) {
    if (k.dive) continue;
    const p = slotAt(s, k);
    if (p.y + CRITTER_R < SHIELD_Y) continue;
    for (const sh of s.shields)
      sh.cells.forEach((on, i) => {
        const b = shieldCell(sh, i);
        if (on && Math.abs(b.x + BLOCK / 2 - p.x) < CRITTER_R + BLOCK / 2 && Math.abs(b.y + BLOCK / 2 - p.y) < CRITTER_R + BLOCK / 2)
          sh.cells[i] = false;
      });
  }
}

/** Turn a combo power on. */
export function grant(s: State, p: Power, ev?: StepEvents) {
  if (p === 'rapid') s.rapid = RAPID_S;
  else if (p === 'spread') s.spread = SPREAD_S;
  else if (p === 'guard') s.guard = true;
  else {
    // Smart bomb: the lowest row still in formation goes up in smoke, and every enemy shot with it.
    s.bombs = [];
    const live = s.critters.filter((k) => k.alive && !k.dive);
    if (!live.length) return;
    const low = Math.max(...live.map((k) => k.r));
    for (const k of live)
      if (k.r === low) {
        k.alive = false;
        s.score += k.pts;
        ev?.pops.push({ ...critterAt(s, k), k: k.k, pts: k.pts });
      }
  }
}

/** The cannon takes a hit (or its guard bubble does). True when it's the last heart. */
function hurt(s: State, ev: StepEvents): boolean {
  s.combo.break();
  if (s.guard) {
    s.guard = false;
    s.safe = SAFE_S / 2;
    ev.blocked = true;
    return false;
  }
  s.lives--;
  s.safe = SAFE_S;
  ev.hurt = true;
  ev.pops.push({ x: s.px, y: CANNON_Y, k: -1, pts: 0 });
  if (s.lives <= 0) {
    ev.over = true;
    return true;
  }
  return false;
}

/** A hit landed: count the combo and fire its milestone. */
function scoreHit(s: State, ev: StepEvents) {
  const tier = s.combo.hit();
  ev.combo = s.combo.count;
  if (tier && tier <= TIER_POWERS.length) {
    const p = TIER_POWERS[tier - 1];
    ev.tier = tier;
    ev.power = p;
    grant(s, p, ev);
  }
}

/** Divers peel off, swoop at the cannon, and fly back in from the top if they miss. */
function moveDivers(s: State, dt: number, ev: StepEvents): boolean {
  s.diveIn -= dt;
  const diving = s.critters.filter((k) => k.alive && k.dive);
  if (s.diveIn <= 0) {
    s.diveIn = diveGapFor(s.d) * (0.7 + s.rng.next() * 0.6);
    const ready = s.critters.filter((k) => k.alive && !k.dive && k.type === 'diver');
    if (ready.length && diving.length < diversAtOnce(s.d)) {
      const k = s.rng.pick(ready);
      k.dive = { ...slotAt(s, k), t: 0, back: false };
      ev.dove = true;
    }
  }
  const v = diveVFor(s.d);
  for (const k of diving) {
    const dv = k.dive!;
    dv.t += dt;
    if (dv.back) {
      // Home in on the slot, which keeps marching.
      const to = slotAt(s, k);
      const dx = to.x - dv.x;
      const dy = to.y - dv.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) k.dive = null;
      else {
        const m = Math.min(dist, 170 * dt) / dist;
        dv.x += dx * m;
        dv.y += dy * m;
      }
      continue;
    }
    // Swoop: drift towards the cannon with a weave.
    dv.y += v * dt;
    dv.x += Math.max(-75 * dt, Math.min(75 * dt, s.px - dv.x)) + Math.cos(dv.t * 5) * 60 * dt;
    dv.x = Math.max(CRITTER_R, Math.min(W - CRITTER_R, dv.x));
    if (s.safe <= 0 && Math.abs(dv.x - s.px) < CANNON_HW + CRITTER_R * 0.6 && Math.abs(dv.y - CANNON_Y) < CRITTER_R + 6) {
      // It rams the cannon and is gone.
      k.alive = false;
      ev.pops.push({ x: dv.x, y: dv.y, k: k.k, pts: 0 });
      if (hurt(s, ev)) return true;
    } else if (dv.y > H + CRITTER_R) Object.assign(dv, { y: -CRITTER_R * 2, back: true });
  }
  return false;
}

/** The mothership glides over the formation and drops a fan of three shots now and then. */
function moveBoss(s: State, b: Boss, dt: number) {
  b.x += b.dir * byLevel(s.d, [40, 45, 50, 55, 60]) * dt;
  if (b.x < BOSS_HW + 4 || b.x > W - BOSS_HW - 4) {
    b.dir = -b.dir;
    b.x = Math.max(BOSS_HW + 4, Math.min(W - BOSS_HW - 4, b.x));
  }
  b.fireIn -= dt;
  if (b.fireIn <= 0) {
    b.fireIn = bossGapFor(s.d) * (0.8 + s.rng.next() * 0.4);
    const vy = enemyShotVFor(s.d) * 0.9;
    for (const vx of [-35, 0, 35]) s.bombs.push({ x: b.x, y: BOSS_Y + BOSS_HH, vx, vy });
  }
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    pops: [],
    hit: false,
    hurt: false,
    blocked: false,
    fired: false,
    combo: 0,
    tier: 0,
    power: null,
    dove: false,
    cleared: false,
    over: false,
  };
  s.time += dt;
  s.cool -= dt;
  s.safe = Math.max(0, s.safe - dt);
  s.rapid = Math.max(0, s.rapid - dt);
  s.spread = Math.max(0, s.spread - dt);
  s.combo.update(dt);

  // Cannon.
  if (s.target != null) {
    const d = s.target - s.px;
    s.px += Math.sign(d) * Math.min(Math.abs(d), DRAG_SPEED * dt);
  } else s.px += s.kdir * KEY_SPEED * dt;
  s.px = Math.max(CANNON_HW + 2, Math.min(W - CANNON_HW - 2, s.px));
  if (s.fire && shoot(s)) ev.fired = true;

  // Formation.
  s.tick -= dt;
  if (s.tick <= 0 && aliveCount(s)) {
    march(s);
    s.tick += tickNow(s);
  }
  if (moveDivers(s, dt, ev)) return ev;
  const boss = s.boss && s.boss.hp > 0 ? s.boss : null;
  if (boss) moveBoss(s, boss, dt);

  // Enemy fire: a seeded shooter, often the one nearest above the cannon.
  s.bombIn -= dt;
  if (s.bombIn <= 0) {
    s.bombIn = fireGapFor(s.d) * (0.6 + s.rng.next() * 0.8);
    const can = shooters(s);
    if (can.length && s.bombs.length < enemyShotsFor(s.d)) {
      let k = s.rng.pick(can);
      if (s.rng.chance(0.4)) {
        const near = [...can].sort((a, b) => Math.abs(critterAt(s, a).x - s.px) - Math.abs(critterAt(s, b).x - s.px));
        k = near[0];
      }
      const p = critterAt(s, k);
      s.bombs.push({ x: p.x, y: p.y + CRITTER_R, vx: 0, vy: enemyShotVFor(s.d) * (0.9 + s.rng.next() * 0.2) });
    }
  }

  // Player shots: shields, then critters, the mothership, then off the top.
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const b = s.shots[i];
    let gone = false;
    for (let h = 0; h < 3 && !gone; h++) {
      b.x += (b.vx * dt) / 3;
      b.y += (b.vy * dt) / 3;
      if (hitShield(s, b.x, b.y - SHOT_HL)) gone = true;
      for (const k of s.critters) {
        if (gone || !k.alive) continue;
        const p = critterAt(s, k);
        if (Math.abs(b.x - p.x) <= CRITTER_R + SHOT_HW && Math.abs(b.y - p.y) <= CRITTER_R + SHOT_HL) {
          gone = true;
          ev.hit = true;
          if (--k.hp > 0) {
            ev.pops.push({ ...p, k: k.k, pts: 0, dent: true });
          } else {
            k.alive = false;
            // A diver shot mid-swoop is worth double.
            const pts = k.dive && !k.dive.back ? k.pts * 2 : k.pts;
            s.score += pts;
            ev.pops.push({ ...p, k: k.k, pts });
            k.dive = null;
          }
          scoreHit(s, ev);
        }
      }
      if (!gone && boss && Math.abs(b.x - boss.x) <= BOSS_HW && Math.abs(b.y - BOSS_Y) <= BOSS_HH + SHOT_HL) {
        gone = true;
        ev.hit = true;
        boss.hp--;
        const pts = boss.hp <= 0 ? boss.pts : 0;
        s.score += pts;
        ev.pops.push({ x: b.x, y: BOSS_Y, k: -2, pts, dent: boss.hp > 0 });
        scoreHit(s, ev);
      }
      // Shots cancel each other out.
      const j = s.bombs.findIndex((m) => Math.abs(m.x - b.x) < 4 && Math.abs(m.y - b.y) < 8);
      if (!gone && j >= 0) {
        s.bombs.splice(j, 1);
        gone = true;
      }
    }
    if (gone || b.y < -SHOT_HL || b.x < -4 || b.x > W + 4) s.shots.splice(i, 1);
  }

  // Enemy shots: shields, then the cannon, then the ground.
  for (let i = s.bombs.length - 1; i >= 0; i--) {
    const m = s.bombs[i];
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    let gone = hitShield(s, m.x, m.y + SHOT_HL) || m.y > H || m.x < -6 || m.x > W + 6;
    if (!gone && s.safe <= 0 && Math.abs(m.x - s.px) <= CANNON_HW && m.y + SHOT_HL >= CANNON_Y - 8 && m.y < CANNON_Y + 10) {
      gone = true;
      if (hurt(s, ev)) return ev;
    }
    if (gone) s.bombs.splice(i, 1);
  }

  if (!leftCount(s)) {
    s.score += s.lives * LIFE_BONUS + Math.max(0, Math.round((parFor(s.d) - s.time) * TIME_POINTS));
    ev.cleared = true;
    return ev;
  }
  // Landed: the lowest critter still in formation reached the cannon's row.
  const marching = s.critters.filter((k) => k.alive && !k.dive);
  if (marching.length && Math.max(...marching.map((k) => slotAt(s, k).y)) + CRITTER_R >= LAND_Y) ev.over = true;
  return ev;
}

/** Every critter's points (and the mothership's): the same in every kind. */
export const formationPoints = (d: Difficulty) => {
  let n = 0;
  for (let r = 0; r < rowsFor(d); r++) n += colsFor(d) * pointsFor(rowsFor(d), r);
  return n;
};
