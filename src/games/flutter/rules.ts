import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units (the canvas scales it to the card). */
export const W = 300;
export const H = 400;
/** Top of the ground strip: touching it is a hit. */
export const GROUND = H - 26;
/** The flyer stays at this x; the columns scroll past it. */
export const FX = 84;
export const FLYER_R = 10;
export const COL_W = 46;
export const PICKUP_R = 8;
const GRAVITY = 900;
/** Upward speed a flap sets. */
const FLAP = 270;
/** Slowest sustained climb we count on (a flap every ~0.2 s), for fair gap placement. */
const CLIMB = 160;
const INVULNERABLE_S = 1.6;
/** Columns keep this far from the ceiling and the ground. */
const EDGE = 34;
/** The first column starts this far right of the flyer (a calm start). */
const LEAD = 270;

export const GATE_POINTS = 10;
export const PICKUP_POINTS = 25;
export const LIFE_BONUS = 50;

/** Gates to pass. */
export const gatesFor = (d: Difficulty) => byLevel(d, [12, 16, 20, 24, 28]);
/** Opening height of each gap. */
export const gapFor = (d: Difficulty) => byLevel(d, [150, 136, 122, 110, 100]);
/** Scroll speed, world units per second. */
export const speedFor = (d: Difficulty) => byLevel(d, [105, 115, 127, 139, 150]);
/** Most a gap's centre moves from one column to the next. */
export const swingFor = (d: Difficulty) => byLevel(d, [50, 80, 105, 125, 145]);
/** Distance from one column to the next. */
export const spacingFor = (d: Difficulty) => byLevel(d, [210, 200, 190, 182, 176]);
export const livesFor = (d: Difficulty) => byLevel(d, [3, 3, 2, 2, 1]);
/** Bonus stars on offer (one in every third gap or so). */
export const pickupsFor = (d: Difficulty) => Math.floor(gatesFor(d) / 3);

interface Column {
  /** Left edge, in track units (screen x = x - dist). */
  x: number;
  /** Centre of the opening. */
  gy: number;
  /** A bonus star sits in this gap at this height (null if none). */
  star: number | null;
  taken: boolean;
}

export interface State {
  d: Difficulty;
  gap: number;
  speed: number;
  cols: Column[];
  /** Track distance scrolled so far. */
  dist: number;
  y: number;
  vy: number;
  /** Held in place until the first flap. */
  started: boolean;
  time: number;
  passed: number;
  goal: number;
  lives: number;
  invulnerable: number;
  pickups: number;
  score: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deal a level: every column's gap and the bonus stars, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const goal = gatesFor(d);
  const gap = gapFor(d);
  const speed = speedFor(d);
  const spacing = spacingFor(d);
  const lo = EDGE + gap / 2;
  const hi = GROUND - EDGE - gap / 2;
  // Time between leaving one column and entering the next: what bounds a fair change of height.
  const free = (spacing - COL_W - 2 * FLYER_R) / speed;
  const up = Math.min(swingFor(d), CLIMB * free + gap * 0.15);
  const down = Math.min(swingFor(d), 0.5 * GRAVITY * free * free + gap * 0.15);
  const cols: Column[] = [];
  let gy = (lo + hi) / 2 + rng.int(-20, 20);
  for (let i = 0; i < goal; i++) {
    if (i) {
      // Swing up or down by a seeded amount; bounce off the limits so it keeps varying.
      const go = rng.chance(0.5) ? -rng.next() * up : rng.next() * down;
      const next = gy + go;
      gy = next < lo || next > hi ? clamp(gy + clamp(-go * 0.6, -up, down), lo, hi) : next;
    }
    cols.push({ x: FX + LEAD + i * spacing, gy, star: null, taken: false });
  }
  // Stars in a seeded choice of gaps (never the first), off-centre to tempt a risk.
  const slots = rng.shuffle(cols.slice(1).map((_, i) => i + 1)).slice(0, pickupsFor(d));
  for (const i of slots) cols[i].star = cols[i].gy + (rng.chance(0.5) ? -1 : 1) * gap * (0.24 + rng.next() * 0.1);
  return {
    d,
    gap,
    speed,
    cols,
    dist: 0,
    y: (lo + hi) / 2,
    vy: 0,
    started: false,
    time: 0,
    passed: 0,
    goal,
    lives: livesFor(d),
    invulnerable: 0,
    pickups: 0,
    score: 0,
  };
}

/** Flap (tap, Space, ↑): starts the run on the first one. */
export function flap(s: State) {
  s.started = true;
  s.vy = -FLAP;
}

/** Does the flyer at height `y` touch column `c` (its solid parts)? */
function hitsColumn(s: State, c: Column, y: number): boolean {
  const left = c.x - s.dist;
  const nx = clamp(FX, left, left + COL_W);
  if (Math.abs(nx - FX) >= FLYER_R) return false;
  const r = Math.sqrt(FLYER_R * FLYER_R - (nx - FX) ** 2) - 1;
  return y - r < c.gy - s.gap / 2 || y + r > c.gy + s.gap / 2;
}

/** The column the flyer is in or about to meet (for respawns and the autopilot). */
export const nextColumn = (s: State): Column | undefined => s.cols.find((c) => c.x - s.dist + COL_W > FX - FLYER_R);

export interface StepEvents {
  passed: boolean;
  picked: boolean;
  hurt: boolean;
  won: boolean;
  over: boolean;
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { passed: false, picked: false, hurt: false, won: false, over: false };
  if (s.passed >= s.goal || s.lives <= 0) return ev;
  s.time += dt;
  if (!s.started) {
    // Hover gently until the first flap.
    s.y = (EDGE + GROUND) / 2 + Math.sin(s.time * 4) * 6;
    return ev;
  }
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.dist += s.speed * dt;
  s.vy = Math.min(s.vy + GRAVITY * dt, 420);
  s.y += s.vy * dt;
  if (s.y < FLYER_R) {
    s.y = FLYER_R;
    s.vy = Math.max(0, s.vy);
  }

  for (const c of s.cols) {
    const left = c.x - s.dist;
    if (c.star != null && !c.taken && Math.hypot(left + COL_W / 2 - FX, c.star - s.y) < PICKUP_R + FLYER_R) {
      c.taken = true;
      s.pickups++;
      s.score += PICKUP_POINTS;
      ev.picked = true;
    }
  }

  let hit = s.y + FLYER_R >= GROUND;
  if (!s.invulnerable) hit ||= s.cols.some((c) => hitsColumn(s, c, s.y));
  if (hit && !s.invulnerable) {
    s.lives--;
    ev.hurt = true;
    if (s.lives <= 0) {
      ev.over = true;
      return ev;
    }
    // Back into the nearest gap, safe for a moment.
    s.invulnerable = INVULNERABLE_S;
    s.y = nextColumn(s)?.gy ?? s.y;
    s.vy = -FLAP * 0.5;
  } else if (hit) {
    // Blinking: the ground bounces you back up.
    s.y = GROUND - FLYER_R;
    s.vy = -FLAP;
  }

  const passed = s.cols.filter((c) => c.x - s.dist + COL_W < FX - FLYER_R).length;
  if (passed > s.passed) {
    s.score += (passed - s.passed) * GATE_POINTS;
    s.passed = passed;
    ev.passed = true;
    if (passed >= s.goal) {
      s.score += s.lives * LIFE_BONUS;
      ev.won = true;
    }
  }
  return ev;
}
