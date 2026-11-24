import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

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

export interface Critter {
  /** Column and row in the formation. */
  c: number;
  r: number;
  /** Kind: glyph and palette colour, by row from the top. */
  k: number;
  alive: boolean;
}

interface Shot {
  x: number;
  y: number;
  vy: number;
}

interface Shield {
  x: number;
  /** Row-major cells, true while standing. */
  cells: boolean[];
}

export interface State {
  d: Difficulty;
  critters: Critter[];
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
  shields: Shield[];
  lives: number;
  safe: number;
  score: number;
  time: number;
  rng: Rng;
}

/** Points for a critter of row `r` (top rows are worth more). */
const pointsFor = (rows: number, r: number) => 10 * (rows - r);

const SHIELD_SHAPE = (c: number, r: number) =>
  // A bunker: rounded top corners, an arch cut out of the bottom middle.
  !((r === 0 && (c === 0 || c === SHIELD_COLS - 1)) || (r === SHIELD_ROWS - 1 && c >= 2 && c <= 3));

/** Deal a level: the formation, its kinds by row, shields, and the first enemy shot time. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const rows = rowsFor(d);
  const cols = colsFor(d);
  // Kinds by row: a seeded pick of distinct glyph/colour pairs, top row the rarest.
  const kinds = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]).slice(0, rows);
  const critters: Critter[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) critters.push({ c, r, k: kinds[r], alive: true });
  const n = shieldsFor(d);
  const shields: Shield[] = [];
  for (let i = 0; i < n; i++) {
    const cells: boolean[] = [];
    for (let r = 0; r < SHIELD_ROWS; r++) for (let c = 0; c < SHIELD_COLS; c++) cells.push(SHIELD_SHAPE(c, r));
    shields.push({ x: ((i + 0.5) * W) / n - (SHIELD_COLS * BLOCK) / 2, cells });
  }
  const width = cols * CELL_W;
  return {
    d,
    critters,
    ox: MARGIN + rng.int(0, Math.floor((W - 2 * MARGIN - width) / STEP_X)) * STEP_X,
    oy: TOP,
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
    shields,
    lives: LIVES,
    safe: 0,
    score: 0,
    time: 0,
    rng,
  };
}

/** Centre of a critter in world units. */
export const critterAt = (s: State, k: Critter) => ({ x: s.ox + (k.c + 0.5) * CELL_W, y: s.oy + (k.r + 0.5) * CELL_H });
export const shieldCell = (sh: Shield, i: number) => ({
  x: sh.x + (i % SHIELD_COLS) * BLOCK,
  y: SHIELD_Y + Math.floor(i / SHIELD_COLS) * BLOCK,
});
export const aliveCount = (s: State) => s.critters.filter((k) => k.alive).length;

/** Seconds per march tick now: from the full pace up to about three times faster for the last critter. */
export const tickNow = (s: State) => tickFor(s.d) * (0.3 + 0.7 * (aliveCount(s) / s.critters.length));

/** Fire a shot from the cannon if one is allowed. */
function shoot(s: State) {
  if (s.cool > 0 || s.shots.length >= shotsFor(s.d)) return false;
  s.cool = FIRE_GAP;
  s.shots.push({ x: s.px, y: CANNON_Y - 10, vy: -SHOT_V });
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

/** The lowest living critter of each column (the ones that can shoot). */
export function shooters(s: State): Critter[] {
  const low = new Map<number, Critter>();
  for (const k of s.critters) if (k.alive && (low.get(k.c)?.r ?? -1) < k.r) low.set(k.c, k);
  return [...low.values()];
}

/** A critter popped (or the cannon was hit) here, for the card's effects. */
interface Pop {
  x: number;
  y: number;
  k: number;
  /** Points it scored (0 for the cannon). */
  pts: number;
}

export interface StepEvents {
  pops: Pop[];
  hit: boolean;
  hurt: boolean;
  fired: boolean;
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
    const p = critterAt(s, k);
    if (p.y + CRITTER_R < SHIELD_Y) continue;
    for (const sh of s.shields)
      sh.cells.forEach((on, i) => {
        const b = shieldCell(sh, i);
        if (on && Math.abs(b.x + BLOCK / 2 - p.x) < CRITTER_R + BLOCK / 2 && Math.abs(b.y + BLOCK / 2 - p.y) < CRITTER_R + BLOCK / 2)
          sh.cells[i] = false;
      });
  }
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { pops: [], hit: false, hurt: false, fired: false, cleared: false, over: false };
  s.time += dt;
  s.cool -= dt;
  s.safe = Math.max(0, s.safe - dt);

  // Cannon.
  if (s.target != null) {
    const d = s.target - s.px;
    s.px += Math.sign(d) * Math.min(Math.abs(d), DRAG_SPEED * dt);
  } else s.px += s.kdir * KEY_SPEED * dt;
  s.px = Math.max(CANNON_HW + 2, Math.min(W - CANNON_HW - 2, s.px));
  if (s.fire && shoot(s)) ev.fired = true;

  // Formation.
  s.tick -= dt;
  if (s.tick <= 0) {
    march(s);
    s.tick += tickNow(s);
  }

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
      s.bombs.push({ x: p.x, y: p.y + CRITTER_R, vy: enemyShotVFor(s.d) * (0.9 + s.rng.next() * 0.2) });
    }
  }

  // Player shots: shields, then critters, then off the top.
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const b = s.shots[i];
    let gone = false;
    for (let h = 0; h < 3 && !gone; h++) {
      b.y += (b.vy * dt) / 3;
      if (hitShield(s, b.x, b.y - SHOT_HL)) gone = true;
      for (const k of s.critters) {
        if (gone || !k.alive) continue;
        const p = critterAt(s, k);
        if (Math.abs(b.x - p.x) <= CRITTER_R + SHOT_HW && Math.abs(b.y - p.y) <= CRITTER_R + SHOT_HL) {
          k.alive = false;
          gone = true;
          s.score += pointsFor(rowsFor(s.d), k.r);
          ev.hit = true;
          ev.pops.push({ ...p, k: k.k, pts: pointsFor(rowsFor(s.d), k.r) });
        }
      }
      // Shots cancel each other out.
      const j = s.bombs.findIndex((m) => Math.abs(m.x - b.x) < 4 && Math.abs(m.y - b.y) < 8);
      if (!gone && j >= 0) {
        s.bombs.splice(j, 1);
        gone = true;
      }
    }
    if (gone || b.y < -SHOT_HL) s.shots.splice(i, 1);
  }

  // Enemy shots: shields, then the cannon, then the ground.
  for (let i = s.bombs.length - 1; i >= 0; i--) {
    const m = s.bombs[i];
    m.y += m.vy * dt;
    let gone = hitShield(s, m.x, m.y + SHOT_HL) || m.y > H;
    if (!gone && s.safe <= 0 && Math.abs(m.x - s.px) <= CANNON_HW && m.y + SHOT_HL >= CANNON_Y - 8 && m.y < CANNON_Y + 10) {
      gone = true;
      s.lives--;
      s.safe = SAFE_S;
      ev.hurt = true;
      ev.pops.push({ x: s.px, y: CANNON_Y, k: -1, pts: 0 });
      if (s.lives <= 0) {
        ev.over = true;
        return ev;
      }
    }
    if (gone) s.bombs.splice(i, 1);
  }

  if (!aliveCount(s)) {
    s.score += s.lives * LIFE_BONUS + Math.max(0, Math.round((parFor(s.d) - s.time) * TIME_POINTS));
    ev.cleared = true;
    return ev;
  }
  // Landed: the lowest critter reached the cannon's row.
  const low = Math.max(...s.critters.filter((k) => k.alive).map((k) => critterAt(s, k).y));
  if (low + CRITTER_R >= LAND_Y) ev.over = true;
  return ev;
}

/** Every critter's points. */
export const formationPoints = (d: Difficulty) => {
  let n = 0;
  for (let r = 0; r < rowsFor(d); r++) n += colsFor(d) * pointsFor(rowsFor(d), r);
  return n;
};
