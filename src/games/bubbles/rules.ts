import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units. */
export const W = 300;
export const H = 420;
/** Bubble radius; a row holds COLS bubbles (odd rows one less, shifted half a bubble right). */
export const R = 15;
export const COLS = 10;
/** Row spacing of the hex grid. */
export const RH = R * Math.sqrt(3);
/** Ceiling height before any drop. */
const TOP = 6;
/** A bubble reaching below this line ends the run. */
export const LINE_Y = 350;
export const LAUNCH = { x: W / 2, y: 392 };
/** Grid rows tracked (the last ones only ever sit past the line). */
const ROWS = 14;
/** Steepest aim from straight up (radians). */
export const MAX_AIM = 1.35;
/** Keyboard aim speed (radians per second). */
const AIM_SPEED = 1.5;
/** Shot speed (world units per second). */
const SPEED = 720;
/** Centre distance under which a shot sticks (a little under touching, so it can slip through gaps). */
const STICK = 2 * R - 5;
export const POP_POINTS = 10;
export const DROP_POINTS = 20;
/** Bonus per free row between the ceiling and the line when the board is cleared. */
export const ROW_BONUS = 100;
/** Points for a bubble blown up by a bomb, or a stone or bomb left over at the end. */
const BLAST_POINTS = 15;

/** Grid codes for the pieces that aren't coloured bubbles (colours are 0…4). */
export const STONE = 10;
export const BOMB = 11;
/** Launcher-only: a rainbow shot takes the colour of the biggest group it touches. */
export const RAINBOW = 12;
/** A coloured bubble (not a stone, a bomb or an empty cell). */
const isColour = (k: number) => k >= 0 && k < STONE;

/** Popping shots in a row that fire a streak event (bomb shot, ceiling lift, rainbow shot…). */
export const STREAK_TIERS = [3, 5, 8, 12, 17] as const;
export type Reward = 'bomb' | 'lift' | 'rainbow';
const REWARDS: readonly Reward[] = ['bomb', 'lift', 'rainbow', 'bomb', 'lift'];
/** Points multiplier inside a streak: ×1, then +0.5 per milestone reached. */
export const streakMult = (s: State) => 1 + s.tier * 0.5;

/** The kinds of board a level can deal. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'chandelier' },
  { id: 'quarry', min: 2 },
  { id: 'glacier', min: 2 },
  { id: 'minefield', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

export const rowsFor = (d: Difficulty) => byLevel(d, [5, 6, 7, 8, 9]);
export const coloursFor = (d: Difficulty) => byLevel(d, [3, 4, 4, 5, 5]);
/** Shots between ceiling drops. */
export const everyFor = (d: Difficulty) => byLevel(d, [8, 8, 7, 7, 6]);
/** Chance a dealt bubble copies a neighbour's colour (clumps are friendlier). */
const clumpFor = (d: Difficulty) => byLevel(d, [0.35, 0.3, 0.25, 0.22, 0.2]);

export interface Point {
  x: number;
  y: number;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  colours: number;
  /** Row-major colour per cell (row 0 under the ceiling), -1 when empty, `STONE` or `BOMB` for pieces. */
  grid: number[];
  /** Cells frozen in ice: they don't match until a bubble lands or pops next to them. */
  ice: boolean[];
  /** Rows the ceiling has come down. */
  drops: number;
  every: number;
  /** Shots left before the next drop. */
  untilDrop: number;
  shots: number;
  /** Colour in the launcher, and the one after it. */
  cur: number;
  next: number;
  /** Aim from straight up, radians (negative = left). */
  aim: number;
  /** Keyboard aim direction held: -1, 0 or 1. */
  turn: number;
  /** The shot in flight: its path, and how far along it is. */
  shot: Trace | null;
  travelled: number;
  score: number;
  /** Popping shots in a row, and the streak milestones reached. */
  streak: number;
  tier: number;
  rng: Rng;
}

/** A cell's row and column from its index (odd rows have no last column). */
const valid = (i: number) => i >= 0 && i < ROWS * COLS && !(Math.floor(i / COLS) % 2 && i % COLS === COLS - 1);
export const ceilingY = (s: State) => TOP + s.drops * RH;
export const cellX = (i: number) => R + (i % COLS) * 2 * R + (Math.floor(i / COLS) % 2 ? R : 0);
export const cellY = (s: State, i: number) => ceilingY(s) + R + Math.floor(i / COLS) * RH;

/** The up-to-six cells touching cell `i`. */
function neighbours(i: number): number[] {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  const shift = r % 2 ? 0 : -1;
  const out = [c > 0 ? i - 1 : -1, c < COLS - 1 ? i + 1 : -1];
  for (const dr of [-1, 1])
    for (const dc of [shift, shift + 1]) {
      const cc = c + dc;
      const rr = r + dr;
      if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) out.push(rr * COLS + cc);
    }
  return out.filter(valid);
}

/** Colours still on the board, in order. */
export function present(grid: readonly number[]): number[] {
  return [...new Set(grid.filter(isColour))].sort((a, b) => a - b);
}

const pickColour = (s: State) => {
  const left = present(s.grid);
  return left.length ? s.rng.pick(left) : 0;
};

/** Rows of thin stems a chandelier hangs from. */
const STEM_ROWS = 2;

export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const colours = coloursFor(d);
  const grid: number[] = Array(ROWS * COLS).fill(-1);
  const ice: boolean[] = Array(ROWS * COLS).fill(false);
  // Chandelier: three stems hold the whole block; cut one and its side falls.
  const stems = new Set([1, rng.int(4, 5), 8]);
  for (let i = 0; i < rowsFor(d) * COLS; i++) {
    if (!valid(i)) continue;
    if (kind === 'chandelier' && Math.floor(i / COLS) < STEM_ROWS && !stems.has(i % COLS)) continue;
    const near = neighbours(i).filter((j) => j < i && grid[j] >= 0);
    grid[i] = near.length && rng.chance(clumpFor(d)) ? grid[rng.pick(near)] : rng.int(0, colours - 1);
  }
  // Special pieces go below the top row, so the board stays anchored by bubbles you can pop.
  const spots = rng.shuffle(grid.map((k, i) => (k >= 0 && i >= COLS ? i : -1)).filter((i) => i >= 0));
  const n = spots.length;
  const stones = kind === 'quarry' ? Math.round(n * byLevel(d, [0.08, 0.08, 0.09, 0.1, 0.1])) : 0;
  const bombs = kind === 'minefield' ? Math.round(n / 9) : kind === 'quarry' ? 3 : kind === 'chandelier' ? 0 : byLevel(d, [0, 1, 1, 2, 2]);
  const frozen = kind === 'glacier' ? Math.round(n * byLevel(d, [0.2, 0.22, 0.24, 0.25, 0.25])) : kind === 'classic' && d >= 4 ? 4 : 0;
  for (let k = 0; k < stones && spots.length; k++) grid[spots.pop()!] = STONE;
  for (let k = 0; k < bombs && spots.length; k++) grid[spots.pop()!] = BOMB;
  for (let k = 0; k < frozen && spots.length; k++) ice[spots.pop()!] = true;
  const s: State = {
    d,
    kind,
    colours,
    grid,
    ice,
    drops: 0,
    every: everyFor(d),
    untilDrop: everyFor(d),
    shots: 0,
    cur: 0,
    next: 0,
    aim: 0,
    turn: 0,
    shot: null,
    travelled: 0,
    score: 0,
    streak: 0,
    tier: 0,
    rng,
  };
  s.cur = pickColour(s);
  s.next = pickColour(s);
  return s;
}

/** Aim at a point (pointer): the angle from the launcher, clamped to the allowed cone. */
export function aimAt(s: State, x: number, y: number) {
  const a = Math.atan2(x - LAUNCH.x, Math.max(1, LAUNCH.y - y));
  s.aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, a));
}

export interface Trace {
  /** Polyline from the launcher: start, each wall bounce, the stop. */
  pts: Point[];
  /** Total length of the path. */
  length: number;
  /** The cell the bubble snaps into. */
  cell: number;
}

/** Path length along a polyline at each point. */
function lengths(pts: readonly Point[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return out;
}

/** Where a shot at `aim` goes: bouncing off the side walls until it touches a bubble or the ceiling. */
export function trace(s: State, aim: number): Trace {
  let x = LAUNCH.x;
  let y = LAUNCH.y;
  let dx = Math.sin(aim);
  const dy = -Math.cos(aim);
  const pts: Point[] = [{ x, y }];
  const top = ceilingY(s);
  const h = 3;
  for (let n = 0; n < 4000; n++) {
    x += dx * h;
    y += dy * h;
    if (x < R || x > W - R) {
      // Bounce: note the exact wall contact, then mirror the overshoot.
      const wall = x < R ? R : W - R;
      const back = (x - wall) / dx;
      pts.push({ x: wall, y: y - dy * back });
      x = 2 * wall - x;
      dx = -dx;
    }
    if (y - R <= top || touching(s, x, y)) break;
  }
  pts.push({ x, y });
  return { pts, length: lengths(pts).at(-1)!, cell: snap(s, x, y) };
}

/** A shot centred at (x, y) touches a bubble. */
function touching(s: State, x: number, y: number): boolean {
  const r = Math.round((y - ceilingY(s) - R) / RH);
  for (let rr = Math.max(0, r - 1); rr <= Math.min(ROWS - 1, r + 1); rr++)
    for (let c = 0; c < COLS; c++) {
      const i = rr * COLS + c;
      if (s.grid[i] < 0) continue;
      if ((cellX(i) - x) ** 2 + (cellY(s, i) - y) ** 2 < STICK * STICK) return true;
    }
  return false;
}

/** The empty cell, under the ceiling or next to a bubble, closest to where the shot stopped. */
function snap(s: State, x: number, y: number): number {
  let best = -1;
  let dist = Infinity;
  // Nearby rows first; the whole grid only if none of them has room.
  const r = Math.round((y - ceilingY(s) - R) / RH);
  const near = (i: number) => Math.abs(Math.floor(i / COLS) - r) <= 1;
  for (const pass of [true, false]) {
    for (let i = 0; i < ROWS * COLS; i++) {
      if (!valid(i) || s.grid[i] >= 0 || (pass && !near(i))) continue;
      if (i >= COLS && !neighbours(i).some((j) => s.grid[j] >= 0)) continue;
      const d = (cellX(i) - x) ** 2 + (cellY(s, i) - y) ** 2;
      if (d < dist) [dist, best] = [d, i];
    }
    if (best >= 0) return best;
  }
  return best;
}

/** The point the shot has reached `d` along its path. */
export function along(t: Trace, d: number): Point {
  const ls = lengths(t.pts);
  for (let i = 1; i < t.pts.length; i++)
    if (d <= ls[i] || i === t.pts.length - 1) {
      const a = t.pts[i - 1];
      const b = t.pts[i];
      const f = Math.min(1, (d - ls[i - 1]) / Math.max(1e-6, ls[i] - ls[i - 1]));
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  return t.pts[0];
}

export function shoot(s: State): boolean {
  if (s.shot) return false;
  s.shot = trace(s, s.aim);
  s.travelled = 0;
  return true;
}

/** Swap the launcher's bubble with the next one. */
export function swapNext(s: State) {
  if (!s.shot) [s.cur, s.next] = [s.next, s.cur];
}

export interface Landing {
  cell: number;
  colour: number;
  /** Cells that popped (3+ of a colour) and cells that fell (cut off from the ceiling). */
  popped: number[];
  dropped: number[];
  /** What sat in the dropped cells (colours, stones, bombs), in the same order. */
  droppedColours: number[];
  /** Cells cleared by bomb blasts, and what was in them. */
  blasted: number[];
  blastedKinds: number[];
  /** Cells where a bomb went off. */
  booms: number[];
  /** Cells whose ice melted. */
  melted: number[];
  /** Points this landing scored. */
  gain: number;
  /** Popping shots in a row after this one (0: the streak broke), and a milestone just reached (0: none). */
  streak: number;
  tier: number;
  reward: Reward | null;
  /** The ceiling came down a row. */
  lowered: boolean;
  won: boolean;
  lost: boolean;
}

/** Cells still hanging from the ceiling through other bubbles. */
function anchored(grid: readonly number[]): Set<number> {
  const seen = new Set<number>();
  const todo: number[] = [];
  for (let c = 0; c < COLS; c++)
    if (grid[c] >= 0) {
      seen.add(c);
      todo.push(c);
    }
  for (let k = 0; k < todo.length; k++)
    for (const j of neighbours(todo[k]))
      if (grid[j] >= 0 && !seen.has(j)) {
        seen.add(j);
        todo.push(j);
      }
  return seen;
}

/** Free rows between the ceiling and the line. */
const freeRows = (s: State) => Math.max(0, Math.floor((LINE_Y - ceilingY(s)) / RH) - 1);

/** Unfrozen bubbles of colour `k` connected to `from`. */
function groupOf(s: State, from: number, k: number): number[] {
  const out = [from];
  const seen = new Set(out);
  for (let n = 0; n < out.length; n++)
    for (const j of neighbours(out[n]))
      if (s.grid[j] === k && !s.ice[j] && !seen.has(j)) {
        seen.add(j);
        out.push(j);
      }
  return out;
}

/** A rainbow shot's colour: the biggest unfrozen group it touches, or any colour still on the board. */
function rainbowColour(s: State, cell: number): number {
  let best = -1;
  let size = 0;
  for (const j of neighbours(cell)) {
    const k = s.grid[j];
    if (!isColour(k) || s.ice[j]) continue;
    const n = groupOf(s, j, k).length;
    if (n > size) [best, size] = [k, n];
  }
  return best >= 0 ? best : pickColour(s);
}

/** Set off the bomb at `at`: it clears every cell within `reach` steps, setting off the bombs it catches. */
function explode(s: State, at: number, reach: number, out: Landing) {
  const todo: [number, number][] = [[at, reach]];
  for (let n = 0; n < todo.length; n++) {
    const [c, r0] = todo[n];
    out.booms.push(c);
    s.grid[c] = -1;
    s.ice[c] = false;
    let ring = [c];
    const seen = new Set(ring);
    for (let r = 0; r < r0; r++) {
      const next: number[] = [];
      for (const i of ring)
        for (const j of neighbours(i)) {
          if (seen.has(j)) continue;
          seen.add(j);
          next.push(j);
          const k = s.grid[j];
          if (k < 0) continue;
          if (k === BOMB) todo.push([j, 1]);
          else {
            out.blasted.push(j);
            out.blastedKinds.push(k);
          }
          s.grid[j] = -1;
          s.ice[j] = false;
        }
      ring = next;
    }
  }
}

/** Settle the bubble in `cell`: pop its group, set off bombs, drop what's cut off, maybe lower the ceiling, reload. */
export function land(s: State, cell: number): Landing {
  const shot = s.cur;
  const colour = shot === RAINBOW && cell >= 0 ? rainbowColour(s, cell) : shot;
  const out: Landing = {
    cell,
    colour,
    popped: [],
    dropped: [],
    droppedColours: [],
    blasted: [],
    blastedKinds: [],
    booms: [],
    melted: [],
    gain: 0,
    streak: 0,
    tier: 0,
    reward: null,
    lowered: false,
    won: false,
    lost: false,
  };
  const before = s.score;
  s.shot = null;
  s.shots++;
  let hit = false;
  if (cell >= 0) {
    const touched = neighbours(cell);
    if (shot === BOMB) {
      // A bomb shot blows up where it lands.
      explode(s, cell, 2, out);
    } else {
      s.grid[cell] = colour;
      const group = groupOf(s, cell, colour);
      if (group.length >= 3) {
        for (const i of group) s.grid[i] = -1;
        out.popped = group;
        // Bombs touching a popped group go off.
        for (const i of group) {
          touched.push(...neighbours(i));
          for (const j of neighbours(i)) if (s.grid[j] === BOMB) explode(s, j, 1, out);
        }
      }
    }
    // Ice melts next to a landing or a pop.
    for (const j of new Set(touched))
      if (s.ice[j]) {
        s.ice[j] = false;
        if (s.grid[j] >= 0) out.melted.push(j);
      }
    hit = out.popped.length > 0 || out.booms.length > 0;
    if (hit) {
      const keep = anchored(s.grid);
      for (let i = 0; i < s.grid.length; i++)
        if (s.grid[i] >= 0 && !keep.has(i)) {
          out.dropped.push(i);
          out.droppedColours.push(s.grid[i]);
          s.grid[i] = -1;
          s.ice[i] = false;
        }
    }
  }
  // A shot that pops or blasts something keeps the streak going; milestones load rewards.
  if (hit) {
    s.streak++;
    if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
      out.reward = REWARDS[s.tier];
      out.tier = ++s.tier;
    }
    const raw = out.popped.length * POP_POINTS + out.dropped.length * DROP_POINTS + out.blasted.length * BLAST_POINTS;
    s.score += Math.round(raw * streakMult(s));
  } else s.streak = s.tier = 0;
  out.streak = s.streak;
  // Nothing coloured left: the stones and bombs still hanging crumble, and the board is clear.
  if (!present(s.grid).length) {
    for (let i = 0; i < s.grid.length; i++)
      if (s.grid[i] >= 0) {
        out.dropped.push(i);
        out.droppedColours.push(s.grid[i]);
        s.grid[i] = -1;
        s.score += BLAST_POINTS;
      }
    out.won = true;
    s.score += freeRows(s) * ROW_BONUS;
    out.gain = s.score - before;
    return out;
  }
  // Lift: the ceiling goes back up a row (or, still at the top, holds off its next drop).
  if (out.reward === 'lift') {
    if (s.drops > 0) s.drops--;
    else s.untilDrop += s.every;
  }
  if (--s.untilDrop <= 0) {
    s.drops++;
    s.untilDrop = s.every;
    out.lowered = true;
  }
  out.lost = cell < 0 || s.grid.some((k, i) => k >= 0 && cellY(s, i) + R > LINE_Y);
  // Reload, keeping to colours still on the board; a streak reward loads a special shot.
  const left = present(s.grid);
  s.cur = left.includes(s.next) || s.next >= BOMB ? s.next : pickColour(s);
  s.next = pickColour(s);
  if (out.reward === 'bomb') s.cur = BOMB;
  else if (out.reward === 'rainbow') s.cur = RAINBOW;
  out.gain = s.score - before;
  return out;
}

/** Advance by `dt` seconds: keyboard aim, and the shot in flight (landing when it arrives). */
export function step(s: State, dt: number): Landing | null {
  if (s.turn) s.aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, s.aim + s.turn * AIM_SPEED * dt));
  if (!s.shot) return null;
  s.travelled += SPEED * dt;
  if (s.travelled < s.shot.length) return null;
  return land(s, s.shot.cell);
}
