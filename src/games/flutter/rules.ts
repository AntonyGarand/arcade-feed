import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

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
export const COIN_R = 5;
export const BIRD_R = 9;
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
/** Coins in one trail; a whole trail is worth one star. */
export const TRAIL = 5;
export const COIN_POINTS = PICKUP_POINTS / TRAIL;
export const LIFE_BONUS = 50;

/** Combo counts (clean gates, perfect centres, pickups, in a row without a crash) that unlock a power. */
export const COMBO_TIERS = [6, 12, 20, 30] as const;
/** What each milestone unlocks: a shield bubble, a pickup magnet, slow motion, then all three. */
export type Power = 'shield' | 'magnet' | 'slow' | 'super';
const TIER_POWERS: readonly Power[] = ['shield', 'magnet', 'slow', 'super'];
export const MAGNET_S = 6;
export const SLOW_S = 5;
/** Pickups this close start flying to the flyer while the magnet runs. */
export const MAGNET_R = 42;
/** Scroll speed factor while slow motion runs. */
const SLOW_K = 0.6;
/** A pass this close to the gap's centre (fraction of the gap) is perfect and counts double. */
const PERFECT = 0.16;

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
/** Bonus stars (or coin trails) on offer (one in every third gap or so). */
export const pickupsFor = (d: Difficulty) => Math.floor(gatesFor(d) / 3);

/** The kinds of flight a level can deal. */
export const KINDS = [
  { id: 'meadow', weight: 2 },
  { id: 'trails' },
  { id: 'cave' },
  { id: 'sliding', min: 2 },
  { id: 'windy', min: 2 },
  { id: 'flock', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

interface Column {
  /** Left edge, in track units (screen x = x - dist). */
  x: number;
  /** Centre of the opening right now. */
  gy: number;
  /** Centre it swings around (sliding gates), and how far / at what phase. */
  gy0: number;
  amp: number;
  phase: number;
  /** Opening height of this gap. */
  gap: number;
  /** Furthest the flyer strayed from the centre while inside (for a perfect pass). */
  dev: number;
}

/** A star (one in a gap) or a coin (in a trail between gaps). */
interface Pickup {
  /** Centre, in track units. */
  x: number;
  y: number;
  coin: boolean;
  /** Column it rides with (sliding gates), or -1, at `off` from its centre. */
  col: number;
  off: number;
  taken: boolean;
  /** Pulled in by the magnet. */
  pulled: boolean;
}

/** An updraft (force < 0) or a downdraft between two columns. */
interface Draft {
  x0: number;
  x1: number;
  force: number;
}

/** A bird hovering between columns, bobbing up and down. */
interface Bird {
  x: number;
  y0: number;
  y: number;
  amp: number;
  phase: number;
  /** Struck and scattered. */
  gone: boolean;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  gap: number;
  speed: number;
  cols: Column[];
  pickups: Pickup[];
  drafts: Draft[];
  birds: Bird[];
  /** Rock walls between the columns (cave). */
  cave: boolean;
  /** Track distance scrolled so far. */
  dist: number;
  y: number;
  vy: number;
  /** Held in place until the first flap. */
  started: boolean;
  time: number;
  /** Seconds flown since the first flap. */
  flight: number;
  passed: number;
  goal: number;
  lives: number;
  invulnerable: number;
  /** Stars and full coin trails picked (a trail counts once all its coins are in). */
  got: number;
  coins: number;
  score: number;
  /** Clean flight in a row: gates (perfect ones count 2) and pickups since the last crash. */
  combo: number;
  best: number;
  /** Combo milestones reached (index into `COMBO_TIERS`). */
  tier: number;
  shield: boolean;
  magnet: number;
  slow: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deal a level: its kind, every column's gap, pickups, drafts and birds, all from the seed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const goal = gatesFor(d);
  const gap = gapFor(d);
  const speed = speedFor(d);
  const spacing = spacingFor(d);
  const cave = kind === 'cave';
  const sliding = kind === 'sliding';
  // The cave's tunnel winds gently; sliding gates move, so their resting spots swing less.
  const swing = swingFor(d) * (cave ? 0.5 : sliding ? 0.6 : 1);
  // Time between leaving one column and entering the next: what bounds a fair change of height.
  const free = (spacing - COL_W - 2 * FLYER_R) / speed;
  const up = Math.min(swing, CLIMB * free + gap * 0.15);
  const down = Math.min(swing, 0.5 * GRAVITY * free * free + gap * 0.15);
  const cols: Column[] = [];
  const mid = (EDGE + GROUND) / 2;
  let gy = mid + rng.int(-20, 20);
  for (let i = 0; i < goal; i++) {
    // The cave narrows from roomy to tight; other kinds keep one gap height.
    const g = cave ? Math.round(gap * (1.2 - (0.3 * i) / Math.max(1, goal - 1))) : gap;
    const amp = sliding && i ? Math.round(g * (0.2 + rng.next() * 0.08)) : 0;
    const lo = EDGE + g / 2 + amp;
    const hi = GROUND - EDGE - g / 2 - amp;
    if (i) {
      // Swing up or down by a seeded amount; bounce off the limits so it keeps varying.
      const go = rng.chance(0.5) ? -rng.next() * up : rng.next() * down;
      const next = gy + go;
      gy = next < lo || next > hi ? clamp(gy + clamp(-go * 0.6, -up, down), lo, hi) : next;
    }
    gy = clamp(gy, lo, hi);
    const phase = rng.next() * Math.PI * 2;
    cols.push({ x: FX + LEAD + i * spacing, gy: gy + amp * Math.sin(phase), gy0: gy, amp, phase, gap: g, dev: 0 });
  }
  const pickups: Pickup[] = [];
  // Stars (or coin trails leading into the gap) in a seeded choice of gaps, never the first.
  const slots = rng.shuffle(cols.slice(1).map((_, i) => i + 1)).slice(0, pickupsFor(d));
  for (const i of slots) {
    const c = cols[i];
    const side = rng.chance(0.5) ? -1 : 1;
    if (kind === 'trails') {
      // An arc of coins from the previous gap to this one, bowed off the straight path.
      const p = cols[i - 1];
      const x0 = p.x + COL_W + FLYER_R;
      const x1 = c.x + COL_W / 2;
      const bow = side * Math.min(p.gap, c.gap) * (0.28 + rng.next() * 0.08);
      for (let k = 0; k < TRAIL; k++) {
        const f = (k + 0.5) / TRAIL;
        const y = p.gy0 + (c.gy0 - p.gy0) * f + bow * Math.sin(Math.PI * f) * (k === TRAIL - 1 ? 1.6 : 1);
        pickups.push({ x: x0 + (x1 - x0) * f, y: clamp(y, EDGE, GROUND - EDGE), coin: true, col: -1, off: 0, taken: false, pulled: false });
      }
    } else {
      // Off-centre, to tempt a risk.
      const off = side * c.gap * (0.24 + rng.next() * 0.1);
      pickups.push({ x: c.x + COL_W / 2, y: c.gy + off, coin: false, col: i, off, taken: false, pulled: false });
    }
  }
  // Windy: drafts in about two free spans out of three, lifting before a higher gap, pushing down before a lower one.
  const drafts: Draft[] = [];
  if (kind === 'windy')
    for (let i = 1; i < goal; i++) {
      if (!rng.chance(0.65)) continue;
      const rise = cols[i].gy0 - cols[i - 1].gy0;
      const upward = Math.abs(rise) < 15 ? rng.chance(0.5) : rise < 0;
      const force = upward ? -(280 + rng.int(0, 100)) : 200 + rng.int(0, 100);
      drafts.push({ x0: cols[i - 1].x + COL_W, x1: cols[i].x, force });
    }
  // Birds: a flock between the columns, each just off the line from one gap to the next, bobbing into it.
  const birds: Bird[] = [];
  if (kind === 'flock') {
    const spans = rng.shuffle(cols.slice(2).map((_, i) => i + 2)).slice(0, Math.floor(goal / 4));
    for (const i of spans) {
      const a = cols[i - 1];
      const b = cols[i];
      const g = Math.min(a.gap, b.gap);
      const amp = Math.round(g * 0.22);
      const above = Math.min(a.gy0, b.gy0) - g * 0.32;
      const below = Math.max(a.gy0, b.gy0) + g * 0.32;
      const room = EDGE + amp + BIRD_R;
      const y0 = above - room > GROUND - room - below ? above : below;
      if (y0 < room || y0 > GROUND - room) continue;
      const phase = rng.next() * Math.PI * 2;
      birds.push({ x: (a.x + COL_W + b.x) / 2, y0, y: y0 + amp * Math.sin(phase), amp, phase, gone: false });
    }
  }
  return {
    d,
    kind,
    gap,
    speed,
    cols,
    pickups,
    drafts,
    birds,
    cave,
    dist: 0,
    y: mid,
    vy: 0,
    started: false,
    time: 0,
    flight: 0,
    passed: 0,
    goal,
    lives: livesFor(d),
    invulnerable: 0,
    got: 0,
    coins: 0,
    score: 0,
    combo: 0,
    best: 0,
    tier: 0,
    shield: false,
    magnet: 0,
    slow: 0,
  };
}

/** Flap (tap, Space, ↑): starts the run on the first one. */
export function flap(s: State) {
  s.started = true;
  s.vy = -FLAP;
}

/** Turn a power on (a combo milestone). */
export function grant(s: State, p: Power) {
  if (p === 'shield' || p === 'super') s.shield = true;
  if (p === 'magnet' || p === 'super') s.magnet = MAGNET_S;
  if (p === 'slow' || p === 'super') s.slow = SLOW_S;
}

/** Does the flyer at height `y` touch column `c` (its solid parts)? */
function hitsColumn(s: State, c: Column, y: number): boolean {
  const left = c.x - s.dist;
  const nx = clamp(FX, left, left + COL_W);
  if (Math.abs(nx - FX) >= FLYER_R) return false;
  const r = Math.sqrt(FLYER_R * FLYER_R - (nx - FX) ** 2) - 1;
  return y - r < c.gy - c.gap / 2 || y + r > c.gy + c.gap / 2;
}

/** Extra room the cave walls leave above and below the gaps between two columns. */
const caveSlack = (c: Column) => 24 + c.gap * 0.15;

/**
 * The cave's ceiling and floor at track x (between two columns: a straight slope from one gap to the
 * next, with some slack), or null where there's no wall (before the first column, past the last, and
 * inside a column, which has its own lips).
 */
export function caveAt(s: State, x: number): [top: number, bottom: number] | null {
  if (!s.cave) return null;
  for (let i = 1; i < s.cols.length; i++) {
    const a = s.cols[i - 1];
    const b = s.cols[i];
    const x0 = a.x + COL_W;
    if (x < x0) return null;
    if (x > b.x) continue;
    const f = (x - x0) / (b.x - x0);
    const sa = caveSlack(a);
    const sb = caveSlack(b);
    const top = a.gy - a.gap / 2 - sa + (b.gy - b.gap / 2 - sb - (a.gy - a.gap / 2 - sa)) * f;
    const bottom = a.gy + a.gap / 2 + sa + (b.gy + b.gap / 2 + sb - (a.gy + a.gap / 2 + sa)) * f;
    return [top, bottom];
  }
  return null;
}

function hitsCave(s: State): boolean {
  if (!s.cave) return false;
  for (const dx of [-FLYER_R * 0.7, 0, FLYER_R * 0.7]) {
    const w = caveAt(s, s.dist + FX + dx);
    if (!w) continue;
    const r = Math.sqrt(FLYER_R * FLYER_R - dx * dx) - 1;
    if (s.y - r < w[0] || s.y + r > w[1]) return true;
  }
  return false;
}

/** The column the flyer is in or about to meet (for respawns and the autopilot). */
export const nextColumn = (s: State): Column | undefined => s.cols.find((c) => c.x - s.dist + COL_W > FX - FLYER_R);

export interface StepEvents {
  passed: boolean;
  /** The gate just passed was right through the middle. */
  perfect: boolean;
  /** A star or a whole coin trail picked up this step. */
  picked: boolean;
  /** Coins picked up this step. */
  coins: number;
  hurt: boolean;
  /** A bird was hit this step (it scatters). */
  bird: { x: number; y: number } | null;
  /** The shield took a hit this step instead of a heart. */
  shielded: boolean;
  /** Combo milestone reached this step (1-based) and what it unlocked; 0 for none. */
  tier: number;
  unlocked: Power | null;
  /** The combo was broken by a crash this step, after this many. */
  broke: number;
  won: boolean;
  over: boolean;
}

/** Count `n` towards the combo; unlock a power at each milestone. */
function addCombo(s: State, n: number, ev: StepEvents) {
  s.combo += n;
  s.best = Math.max(s.best, s.combo);
  while (s.tier < COMBO_TIERS.length && s.combo >= COMBO_TIERS[s.tier]) {
    const p = TIER_POWERS[s.tier++];
    grant(s, p);
    ev.tier = s.tier;
    ev.unlocked = p;
  }
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    passed: false,
    perfect: false,
    picked: false,
    coins: 0,
    hurt: false,
    bird: null,
    shielded: false,
    tier: 0,
    unlocked: null,
    broke: 0,
    won: false,
    over: false,
  };
  if (s.passed >= s.goal || s.lives <= 0) return ev;
  s.time += dt;
  if (!s.started) {
    // Hover gently until the first flap.
    s.y = (EDGE + GROUND) / 2 + Math.sin(s.time * 4) * 6;
    return ev;
  }
  s.flight += dt;
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  s.magnet = Math.max(0, s.magnet - dt);
  s.slow = Math.max(0, s.slow - dt);
  s.dist += s.speed * (s.slow > 0 ? SLOW_K : 1) * dt;
  let g = GRAVITY;
  const at = s.dist + FX;
  for (const w of s.drafts) if (at >= w.x0 && at <= w.x1) g += w.force;
  s.vy = clamp(s.vy + g * dt, -FLAP * 1.2, 420);
  s.y += s.vy * dt;
  if (s.y < FLYER_R) {
    s.y = FLYER_R;
    s.vy = Math.max(0, s.vy);
  }

  // Sliding gates glide up and down; their stars ride along.
  for (const c of s.cols) if (c.amp) c.gy = c.gy0 + c.amp * Math.sin(s.flight * 1.5 + c.phase);
  for (const b of s.birds) if (!b.gone) b.y = b.y0 + b.amp * Math.sin(s.flight * 2.6 + b.phase);

  for (const p of s.pickups) {
    if (p.taken) continue;
    if (p.col >= 0) p.y = s.cols[p.col].gy + p.off;
    let sx = p.x - s.dist;
    if (s.magnet > 0 && (p.pulled || (sx > FX - 20 && Math.hypot(sx - FX, p.y - s.y) < MAGNET_R))) {
      // The magnet reels it in.
      p.pulled = true;
      p.col = -1;
      const d = Math.hypot(sx - FX, p.y - s.y) || 1;
      const k = Math.min(1, (360 * dt) / d);
      p.x += (FX - sx) * k;
      p.y += (s.y - p.y) * k;
      sx = p.x - s.dist;
    }
    if (Math.hypot(sx - FX, p.y - s.y) < (p.coin ? COIN_R : PICKUP_R) + FLYER_R) {
      p.taken = true;
      if (p.coin) {
        s.coins++;
        s.score += COIN_POINTS;
        ev.coins++;
        // A whole trail counts like a star, and twice towards the combo.
        if (s.coins % TRAIL === 0) {
          s.got++;
          ev.picked = true;
          addCombo(s, 2, ev);
        }
      } else {
        s.got++;
        s.score += PICKUP_POINTS;
        ev.picked = true;
        addCombo(s, 1, ev);
      }
    }
  }

  // How far from the centre the flyer flies through each gap it's in.
  for (const c of s.cols) {
    const left = c.x - s.dist;
    if (left < FX + FLYER_R && left + COL_W > FX - FLYER_R) c.dev = Math.max(c.dev, Math.abs(s.y - c.gy) / c.gap);
  }

  let hit = s.y + FLYER_R >= GROUND;
  if (!s.invulnerable) {
    hit ||= s.cols.some((c) => hitsColumn(s, c, s.y)) || hitsCave(s);
    const bird = s.birds.find((b) => !b.gone && Math.hypot(b.x - s.dist - FX, b.y - s.y) < BIRD_R + FLYER_R - 2) ?? null;
    if (bird) {
      bird.gone = true;
      ev.bird = { x: bird.x - s.dist, y: bird.y };
      hit = true;
    }
  }
  if (hit && !s.invulnerable && s.shield) {
    // The shield pops instead of a heart; the combo lives on.
    s.shield = false;
    ev.shielded = true;
    s.invulnerable = INVULNERABLE_S * 0.6;
    if (s.y + FLYER_R >= GROUND) s.vy = -FLAP;
  } else if (hit && !s.invulnerable) {
    s.lives--;
    ev.hurt = true;
    if (s.combo >= 2) ev.broke = s.combo;
    s.combo = s.tier = 0;
    if (s.lives <= 0) {
      ev.over = true;
      return ev;
    }
    // Back into the nearest gap, safe for a moment.
    s.invulnerable = INVULNERABLE_S;
    s.y = nextColumn(s)?.gy ?? s.y;
    s.vy = -FLAP * 0.5;
  } else if (hit && s.y + FLYER_R >= GROUND) {
    // Blinking: the ground bounces you back up.
    s.y = GROUND - FLYER_R;
    s.vy = -FLAP;
  }

  const passed = s.cols.filter((c) => c.x - s.dist + COL_W < FX - FLYER_R).length;
  if (passed > s.passed) {
    for (let i = s.passed; i < passed; i++) {
      const perfect = s.cols[i].dev <= PERFECT;
      ev.perfect ||= perfect;
      if (!ev.hurt) addCombo(s, perfect ? 2 : 1, ev);
    }
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
