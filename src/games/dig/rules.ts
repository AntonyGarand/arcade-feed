import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units (the canvas scales it to the card). */
export const W = 300;
export const H = 400;
/** The earth is a grid of COLS × ROWS cells, CELL world units each. */
export const COLS = 60;
export const ROWS = 80;
export const CELL = 5;

/** What a cell holds. */
export const EMPTY = 0;
export const DIRT = 1;
export const ROCK = 2;
export const WATER = 3;
/** Toxic goo: water that touches it is lost. Never moves, can't be dug. */
export const SLUDGE = 4;
/** The pipe's mouth: water that enters it is delivered. */
const DRAIN = 5;
/** The pipe's wall: solid, like rock. */
const PIPE = 6;
/** Lava: water that touches it is lost, and cools the lava it touched into rock. Can't be dug. */
export const LAVA = 7;

/** Digging radius in cells (a tunnel is about five cells wide). */
export const BRUSH = 2.6;
/** Cells around the planned route kept free of rock, sludge and caves. */
const CORRIDOR = BRUSH + 1;
/** Water simulation steps per second. */
const TICK = 1 / 75;
/** Cells a water cell may slide sideways per step. */
const SPREAD = 3;
/** Seconds of still water (and no digging) that end the run. */
export const SETTLE_S = 3;
/** Seconds of still water that end a run once the goal is met. */
const DONE_S = 1.5;
/** Points per percent of the water delivered, and per gem touched by water. */
export const PCT_POINTS = 10;
export const GEM_POINTS = 150;
export const GEMS = 3;

const DRAIN_W = 7;
const DRAIN_Y = 74;
const POCKET_W = 18;
const POCKET_TOP = 2;

/** Share of the water the pipe must receive, in percent. */
export const needFor = (d: Difficulty) => byLevel(d, [50, 55, 60, 65, 70]);
/** Share of the water (percent) a clean run that takes every gem delivers, at least. */
export const cleanFor = (d: Difficulty) => byLevel(d, [65, 68, 70, 72, 73]);
/** Horizontal runs on the planned route (more turns, longer path). */
export const legsFor = (d: Difficulty) => byLevel(d, [1, 2, 2, 3, 4]);
const rocksFor = (d: Difficulty) => byLevel(d, [5, 8, 10, 12, 14]);
export const sludgeFor = (d: Difficulty) => byLevel(d, [0, 0, 2, 3, 4]);
const cavesFor = (d: Difficulty) => byLevel(d, [1, 2, 2, 3, 3]);
const pocketHFor = (d: Difficulty) => byLevel(d, [8, 8, 8, 9, 9]);
/** Lava pools on a volcano level (other levels get one from Hard up). */
const lavaFor = (d: Difficulty) => byLevel(d, [2, 2, 3, 4, 4]);
/** Moles on a mole level. */
export const molesFor = (d: Difficulty) => byLevel(d, [1, 1, 1, 2, 2]);

/** The kinds of level: map shapes (switchbacks, caverns, bedrock) and hazard mixes (lava, gem-stealing moles). */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'zigzag', max: 4 },
  { id: 'caverns' },
  { id: 'volcano', min: 2 },
  { id: 'moles', min: 2 },
  { id: 'bedrock', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** A mole: crawls through the earth from its burrow to a gem and steals it, unless dug at or washed away. */
const MOLE_SPEED = 1.8;
/** Seconds a mole waits in its burrow at the start (after your first dig) and after a bonk. */
const MOLE_WAIT_S = 2;
export const BONK_S = 3;
/** Cells from a burrow to the nearest gem, at least. */
const MOLE_FAR = 26;

/**
 * Flow combo: each 5 % of the water delivered without the flow stopping for STREAK_GAP seconds is a
 * step. Milestones (in steps) and what each unlocks.
 */
export const STREAK_GAP = 1;
export const STREAK_TIERS = [3, 6, 9, 12] as const;
export type Power = 'purify' | 'double' | 'magnet';
const TIER_POWERS: readonly Power[] = ['purify', 'double', 'magnet', 'magnet'];
/** Seconds sludge and lava are harmless after a purify. */
export const PURIFY_S = 6;

export interface Pt {
  x: number;
  y: number;
}

interface Gem extends Pt {
  /** Where to dig (cells) so the water reaches it: a little dip below the planned tunnel. */
  dig: Pt;
  got: boolean;
  /** A mole took it. */
  stolen: boolean;
}

interface Mole extends Pt {
  home: Pt;
  /** Seconds left before it sets off again. */
  wait: number;
  /** The gem it's after (-1: none), and whether it's carrying one home. */
  target: number;
  carrying: boolean;
  /** Washed away by the water. */
  gone: boolean;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  cell: Uint8Array;
  /** Sideways direction each water cell is sliding: 1 right, 0 left. */
  flow: Uint8Array;
  /** Last step each cell moved in (so nothing moves twice per step). */
  stamp: Uint32Array;
  /** Cells next to sludge (water there is lost). */
  toxic: Uint8Array;
  /** Cells next to lava (water there is lost and cools the lava). */
  hot: Uint8Array;
  ticks: number;
  acc: number;
  /** Water cells at the start, alive now, delivered to the pipe, lost to sludge. */
  total: number;
  water: number;
  delivered: number;
  lost: number;
  /** Water cells the pipe must receive. */
  need: number;
  gems: Gem[];
  /** Sludge and lava blobs (cell centre and radius), for drawing. */
  sludge: { x: number; y: number; r: number }[];
  lava: { x: number; y: number; r: number }[];
  moles: Mole[];
  /** Moles bonked by digging, in total (the card watches it for effects). */
  bonks: number;
  /** Flow combo: steps (5 % each) in the current streak, the milestone reached, seconds since water last arrived. */
  streak: number;
  tier: number;
  gap: number;
  /** 5 % steps delivered so far, and whole percents (for the double bonus). */
  chunks: number;
  pcts: number;
  /** Combo rewards: seconds of harmless hazards, double water points (until the streak breaks), points earned by it. */
  purify: number;
  double: boolean;
  bonus: number;
  pocket: { x: number; y: number; w: number; h: number };
  /** Pipe mouth: first column, row, width (cells). */
  drain: { x: number; y: number; w: number };
  /** The planned rock-free route from the water to the pipe (cell centres). */
  route: Pt[];
  /** Water has started to move. */
  released: boolean;
  /** Seconds the water has been still with no digging. */
  still: number;
  /** Last cell where water was lost (for effects), or -1. */
  lostAt: number;
  dug: number;
  done: boolean;
}

export interface Events {
  /** Water cells that fell this frame. */
  fell: number;
  delivered: number;
  lost: number;
  /** Gems water touched (or a magnet pulled) this frame (indices). */
  gems: number[];
  /** Lava cells cooled to rock by water this frame. */
  steam: number[];
  /** Gems moles stole, and moles the water washed away, this frame (indices). */
  stolen: number[];
  washed: number[];
  /** A flow-combo milestone reached this frame (1-based) and what it unlocked; 0 / '' for none. */
  tier: number;
  unlocked: Power | '';
  /** A gem pulled in by a magnet this frame, or -1. */
  magnet: number;
  /** The streak just broke after this many steps (0: it didn't). */
  broke: number;
  /** The goal was just reached. */
  goal: boolean;
  won: boolean;
  over: boolean;
}

const at = (x: number, y: number) => y * COLS + x;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function segDist(px: number, py: number, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l ? clamp(((px - a.x) * dx + (py - a.y) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - a.x - dx * t, py - a.y - dy * t);
}

/** A lumpy blob (cell centre, radii, harmonics) as a cell test. */
function blob(rng: Rng, cx: number, cy: number, rx: number, ry: number) {
  const p1 = rng.next() * 6.28;
  const p2 = rng.next() * 6.28;
  const k1 = 0.1 + rng.next() * 0.2;
  return (x: number, y: number) => {
    const a = Math.atan2(y - cy, x - cx);
    const r = 1 + k1 * Math.sin(2 * a + p1) + 0.12 * Math.sin(3 * a + p2);
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= r * r;
  };
}

/** Cells next to (or on) a cell of kind `k`, as a mask. */
function rim(cell: Uint8Array, k: number) {
  const out = new Uint8Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (cell[at(x, y)] === k)
        for (const [ox, oy] of [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS) out[at(nx, ny)] = 1;
        }
  return out;
}

/**
 * Deal a level: water pocket, pipe, a guaranteed route between them, then rock, sludge, lava, caves and
 * moles off it, mixed by the kind of level.
 */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const n = kind === 'zigzag' ? Math.min(4, legsFor(d) + 1) : legsFor(d);
  const cell = new Uint8Array(COLS * ROWS).fill(DIRT);
  // Turn points alternate between the left and right thirds, so every run crosses the field.
  const zone = (side: number) => (side ? rng.int(41, 53) : rng.int(6, 18));
  const side0 = rng.int(0, 1);
  const xs = Array.from({ length: n + 1 }, (_, k) => zone((side0 + k) % 2));
  const ph = pocketHFor(d);
  const px = clamp(xs[0] - POCKET_W / 2, 2, COLS - 2 - POCKET_W);
  const pb = POCKET_TOP + ph - 1;
  // Rows of the runs, each dropping a little towards its end.
  const top = pb + 5;
  const drops = xs.slice(1).map((x, k) => clamp(Math.round(Math.abs(x - xs[k]) / 10), 1, 3));
  const ys: number[] = [];
  if (n === 1) ys.push(rng.int(top + 4, 48));
  else {
    const gap = Math.floor((60 - top) / (n - 1));
    for (let k = 0; k < n; k++) ys.push(top + k * gap + rng.int(0, Math.min(2, gap - 15)));
  }
  const route: Pt[] = [{ x: xs[0], y: pb }];
  for (let k = 0; k < n; k++) route.push({ x: xs[k], y: ys[k] }, { x: xs[k + 1], y: ys[k] + drops[k] });
  route.push({ x: xs[n], y: DRAIN_Y });

  // Gems: a little below the runs, spread along them.
  const gems: Gem[] = [];
  const legs = rng.shuffle(Array.from({ length: n }, (_, k) => k));
  for (let i = 0; i < GEMS; i++) {
    const k = legs[i % n];
    const a = Math.min(xs[k], xs[k + 1]) + 4;
    const b = Math.max(xs[k], xs[k + 1]) - 4;
    let gx = rng.int(a, b);
    for (let t = 0; t < 30 && gems.some((g) => Math.abs(g.x - gx) < 5 && Math.abs(g.y - ys[k]) < 8); t++) gx = rng.int(a, b);
    const ly = Math.round(ys[k] + (drops[k] * (gx - xs[k])) / (xs[k + 1] - xs[k]));
    gems.push({ x: gx, y: ly + 5, dig: { x: gx, y: ly + 3 }, got: false, stolen: false });
  }

  // Distance from every cell to the route (and the gem dips): nothing solid goes near it.
  const dist = new Float32Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      let m = Infinity;
      for (let i = 1; i < route.length; i++) m = Math.min(m, segDist(x, y, route[i - 1], route[i]));
      for (const g of gems) m = Math.min(m, Math.hypot(x - g.dig.x, y - g.dig.y));
      dist[at(x, y)] = m;
    }
  const nearPocket = (x: number, y: number, m: number) => x >= px - m && x < px + POCKET_W + m && y >= POCKET_TOP - m && y <= pb + m;
  const nearPipe = (x: number, y: number) => y >= DRAIN_Y - 4 && Math.abs(x - xs[n]) <= DRAIN_W / 2 + 4;

  // Rock: lumpy boulders, and strata under each run (gapped where the route drops through). Bedrock
  // levels are stacked with them; switchbacks and caverns have fewer boulders.
  const rocks = rocksFor(d) + (kind === 'bedrock' ? 5 : kind === 'zigzag' || kind === 'caverns' ? -3 : 0);
  for (let i = 0; i < rocks; i++) {
    const cx = rng.int(2, COLS - 3);
    const cy = rng.int(pb + 3, 72);
    const rx = 2.5 + rng.next() * 5;
    const ry = 1.8 + rng.next() * 3;
    const inside = blob(rng, cx, cy, rx, ry);
    for (let y = Math.floor(cy - ry * 1.4); y <= cy + ry * 1.4; y++)
      for (let x = Math.floor(cx - rx * 1.4); x <= cx + rx * 1.4; x++)
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS && inside(x, y) && dist[at(x, y)] > CORRIDOR) cell[at(x, y)] = ROCK;
  }
  const strata: [number, number][] = [];
  for (let k = 0; k < n - 1; k++) strata.push([ys[k] + drops[k] + 8, 1]);
  // Bedrock: a thick layer under the last run too, and one between the pocket and the first run.
  if (kind === 'bedrock') strata.push([ys[n - 1] + drops[n - 1] + 6, 2], [pb + 3, 1]);
  for (const [r0, thick] of strata) {
    const ph2 = rng.next() * 6.28;
    for (let x = 0; x < COLS; x++) {
      const y0 = r0 + Math.round(Math.sin(x * 0.35 + ph2) * 0.8);
      for (let y = y0; y <= y0 + thick && y < ROWS; y++) if (dist[at(x, y)] > CORRIDOR) cell[at(x, y)] = ROCK;
    }
  }

  // Sludge and lava: pools close to (but clear of) the route, for sloppy diggers.
  const pools = (count: number, what: number, r0: number) => {
    const out: State['sludge'] = [];
    for (let i = 0, tries = 0; i < count && tries < 400; tries++) {
      const k = rng.int(1, route.length - 1);
      const t = rng.next();
      const a = route[k - 1];
      const b = route[k];
      const r = r0 + rng.next();
      const off = CORRIDOR + 1.5 + r + rng.next() * 2;
      const vertical = a.x === b.x;
      const sgn = rng.chance(0.5) ? 1 : -1;
      const cx = Math.round(a.x + (b.x - a.x) * t + (vertical ? sgn * off : 0));
      const cy = Math.round(a.y + (b.y - a.y) * t + (vertical ? 0 : sgn * off));
      const cells: number[] = [];
      let ok = cx > 2 && cx < COLS - 3 && cy > pb + 4 && cy < 72;
      for (let y = Math.floor(cy - r); ok && y <= cy + r; y++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (Math.hypot(x - cx, y - cy) > r) continue;
          if (dist[at(x, y)] <= CORRIDOR + 1.5 || nearPocket(x, y, 4) || nearPipe(x, y) || cell[at(x, y)] === SLUDGE) ok = false;
          cells.push(at(x, y));
        }
      if (!ok) continue;
      for (const j of cells) cell[j] = what;
      out.push({ x: cx, y: cy, r });
      i++;
    }
    return out;
  };
  const sludge = pools(kind === 'volcano' ? Math.max(0, sludgeFor(d) - 2) : sludgeFor(d), SLUDGE, 1.6);
  const lava = pools(kind === 'volcano' ? lavaFor(d) : d >= 4 ? 1 : 0, LAVA, 2);

  // Caves: empty air pockets that waste water if a tunnel breaks into them (big and many in caverns).
  const caves = kind === 'caverns' ? cavesFor(d) + 4 : kind === 'bedrock' ? 1 : cavesFor(d);
  for (let i = 0, tries = 0; i < caves && tries < 300; tries++) {
    const cx = rng.int(3, COLS - 4);
    const cy = rng.int(pb + 6, 70);
    const r = kind === 'caverns' ? 2.2 + rng.next() * 1.6 : 1.5 + rng.next();
    const cells: number[] = [];
    let ok = true;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (Math.hypot(x - cx, y - cy) > r) continue;
        if (dist[at(x, y)] <= CORRIDOR + 0.6 || nearPocket(x, y, 4) || nearPipe(x, y) || cell[at(x, y)] !== DIRT) ok = false;
        cells.push(at(x, y));
      }
    if (!ok) continue;
    for (const j of cells) cell[j] = EMPTY;
    i++;
  }

  // The water pocket, sealed by dirt and rock.
  let total = 0;
  for (let y = POCKET_TOP; y <= pb; y++)
    for (let x = px; x < px + POCKET_W; x++) {
      cell[at(x, y)] = WATER;
      total++;
    }

  // The pipe: a mouth two cells deep, walls on both sides and its body below.
  const dx = xs[n] - (DRAIN_W >> 1);
  for (let y = DRAIN_Y; y < ROWS; y++)
    for (let x = dx - 1; x <= dx + DRAIN_W; x++) cell[at(x, y)] = x >= dx && x < dx + DRAIN_W && y < DRAIN_Y + 2 ? DRAIN : PIPE;

  // Moles: burrows at the field's sides, far from every gem, so a quick digger beats them to it.
  const moles: Mole[] = [];
  for (let i = 0; i < (kind === 'moles' ? molesFor(d) : 0); i++) {
    let best: Pt = { x: 1, y: 40 };
    let far = -1;
    for (let t = 0; t < 40; t++) {
      const p = { x: (i + t) % 2 ? COLS - 2 : 1, y: rng.int(pb + 6, 70) };
      const m = Math.min(...gems.map((g) => Math.hypot(g.x - p.x, g.y - p.y)));
      if (m > far) [best, far] = [p, m];
      if (m >= MOLE_FAR) break;
    }
    moles.push({ ...best, home: { ...best }, wait: MOLE_WAIT_S, target: -1, carrying: false, gone: false });
  }

  return {
    d,
    kind,
    cell,
    flow: new Uint8Array(COLS * ROWS),
    stamp: new Uint32Array(COLS * ROWS),
    toxic: rim(cell, SLUDGE),
    hot: rim(cell, LAVA),
    ticks: 0,
    acc: 0,
    total,
    water: total,
    delivered: 0,
    lost: 0,
    need: Math.ceil((total * needFor(d)) / 100),
    gems,
    sludge,
    lava,
    moles,
    bonks: 0,
    streak: 0,
    tier: 0,
    gap: 0,
    chunks: 0,
    pcts: 0,
    purify: 0,
    double: false,
    bonus: 0,
    pocket: { x: px, y: POCKET_TOP, w: POCKET_W, h: ph },
    drain: { x: dx, y: DRAIN_Y, w: DRAIN_W },
    route,
    released: false,
    still: 0,
    lostAt: -1,
    dug: 0,
    done: false,
  };
}

/** World position → cell coordinates (fractional, cell centres on integers). */
const toCell = (wx: number, wy: number): Pt => ({ x: wx / CELL - 0.5, y: wy / CELL - 0.5 });
/** Cell centre → world position. */
export const toWorld = (p: Pt): Pt => ({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL });

/** Dig a round hole at world (wx, wy): dirt only. Returns the cells removed. */
export function dig(s: State, wx: number, wy: number): number {
  if (s.done) return 0;
  const { x: cx, y: cy } = toCell(wx, wy);
  let n = 0;
  for (let y = Math.ceil(cy - BRUSH); y <= cy + BRUSH; y++)
    for (let x = Math.ceil(cx - BRUSH); x <= cx + BRUSH; x++) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
      const i = at(x, y);
      if (s.cell[i] === DIRT && (x - cx) ** 2 + (y - cy) ** 2 <= BRUSH * BRUSH) {
        s.cell[i] = EMPTY;
        n++;
      }
    }
  if (n) {
    s.dug += n;
    s.still = 0;
  }
  // Digging at a mole bonks it back to its burrow.
  for (const m of s.moles)
    if (!m.gone && m.wait <= 0 && Math.hypot(m.x - cx, m.y - cy) <= BRUSH + 1) {
      if (m.carrying) s.gems[m.target].stolen = false;
      Object.assign(m, { x: m.home.x, y: m.home.y, wait: BONK_S, target: -1, carrying: false });
      s.bonks++;
    }
  return n;
}

/** Dig along a stroke from (ax, ay) to (bx, by), world units. Returns the cells removed. */
export function digLine(s: State, ax: number, ay: number, bx: number, by: number): number {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL * 0.5)));
  let n = 0;
  for (let i = 1; i <= steps; i++) n += dig(s, ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps);
  return n;
}

/** The scripted solution, in world units: dip under each gem, then the route from the pipe up to the water. */
export function solution(s: State): Pt[][] {
  return [...s.gems.map((g) => [toWorld(g.dig)]), s.route.slice().reverse().map(toWorld)];
}

/** Score so far: points per percent delivered, plus each gem, plus the flow combo's double points. */
export const scoreOf = (s: State) =>
  Math.floor((100 * s.delivered) / s.total) * PCT_POINTS + s.gems.filter((g) => g.got).length * GEM_POINTS + s.bonus;

/** Water at `i` touched lava: it's lost, and one lava cell it touched cools into rock. */
function quench(s: State, i: number, ev: Events) {
  const x = i % COLS;
  const y = Math.floor(i / COLS);
  for (const [ox, oy] of [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
  ]) {
    const nx = x + ox;
    const ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || s.cell[at(nx, ny)] !== LAVA) continue;
    s.cell[at(nx, ny)] = ROCK;
    ev.steam.push(at(nx, ny));
    break;
  }
  s.hot = rim(s.cell, LAVA);
}

/** One water step: bottom-up rows, scan direction alternating by row and step (deterministic, no rng). */
function tick(s: State, ev: Events) {
  const { cell, flow, stamp } = s;
  // Purified hazards don't eat water.
  const toxic = s.purify > 0 ? null : s.toxic;
  const t = ++s.ticks;
  const open = (c: number) => c === EMPTY || c === DRAIN;
  const move = (i: number, j: number, right: number) => {
    cell[i] = EMPTY;
    s.released = true;
    if (cell[j] === DRAIN) {
      s.water--;
      s.delivered++;
      ev.delivered++;
      return;
    }
    cell[j] = WATER;
    flow[j] = right;
    stamp[j] = t;
  };
  for (let y = ROWS - 1; y >= 0; y--) {
    const ltr = ((y + t) & 1) === 0;
    const below = y + 1 < ROWS;
    for (let k = 0; k < COLS; k++) {
      const x = ltr ? k : COLS - 1 - k;
      const i = y * COLS + x;
      if (cell[i] !== WATER || stamp[i] === t) continue;
      const burn = toxic && s.hot[i];
      if (toxic?.[i] || burn) {
        if (burn) quench(s, i, ev);
        cell[i] = EMPTY;
        s.water--;
        s.lost++;
        ev.lost++;
        s.released = true;
        s.lostAt = i;
        continue;
      }
      if (below && open(cell[i + COLS])) {
        move(i, i + COLS, flow[i]);
        ev.fell++;
        continue;
      }
      const dir = flow[i] ? 1 : -1;
      let done = false;
      for (let p = 0; p < (below ? 2 : 0) && !done; p++) {
        const dx = p ? -dir : dir;
        const nx = x + dx;
        if (nx < 0 || nx >= COLS || !open(cell[i + dx]) || !open(cell[i + COLS + dx])) continue;
        move(i, i + COLS + dx, dx > 0 ? 1 : 0);
        ev.fell++;
        done = true;
      }
      if (done) continue;
      let to = x;
      for (let st = 1; st <= SPREAD; st++) {
        const nx = x + dir * st;
        if (nx < 0 || nx >= COLS || !open(cell[y * COLS + nx])) break;
        to = nx;
        if (cell[y * COLS + nx] === DRAIN || (below && open(cell[(y + 1) * COLS + nx]))) break;
      }
      if (to !== x) move(i, y * COLS + to, flow[i]);
      else flow[i] ^= 1;
    }
  }
  for (let k = 0; k < s.gems.length; k++) {
    const g = s.gems[k];
    if (g.got || g.stolen) continue;
    for (let y = g.y - 1; y <= g.y + 1 && !g.got; y++)
      for (let x = g.x - 1; x <= g.x + 1; x++)
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS && cell[at(x, y)] === WATER) {
          g.got = true;
          ev.gems.push(k);
          break;
        }
  }
}

/** Moles crawl to the nearest gem left, grab it and carry it home; water washes them away. */
function crawl(s: State, dt: number, ev: Events) {
  if (!s.dug) return;
  for (const [k, m] of s.moles.entries()) {
    if (m.gone) continue;
    // Water around the mole washes it away (a stolen gem it carries drops back in place).
    let wet = false;
    for (let y = Math.round(m.y) - 1; y <= Math.round(m.y) + 1 && !wet; y++)
      for (let x = Math.round(m.x) - 1; x <= Math.round(m.x) + 1; x++)
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS && s.cell[at(x, y)] === WATER) wet = true;
    if (wet) {
      if (m.carrying) s.gems[m.target].stolen = false;
      m.gone = true;
      ev.washed.push(k);
      continue;
    }
    if (m.wait > 0) {
      m.wait -= dt;
      continue;
    }
    if (!m.carrying) {
      let best = -1;
      let bd = Infinity;
      for (const [j, g] of s.gems.entries()) {
        const dd = Math.hypot(g.x - m.x, g.y - m.y);
        if (!g.got && !g.stolen && dd < bd) [best, bd] = [j, dd];
      }
      m.target = best;
    }
    const goal = m.carrying ? m.home : m.target >= 0 ? s.gems[m.target] : m.home;
    const dx = goal.x - m.x;
    const dy = goal.y - m.y;
    const dd = Math.hypot(dx, dy);
    const v = MOLE_SPEED * dt;
    if (dd > v) {
      m.x += (dx / dd) * v;
      m.y += (dy / dd) * v;
      continue;
    }
    m.x = goal.x;
    m.y = goal.y;
    if (m.carrying) {
      // Home with the gem: it's gone for good. Rest, then go after the next one.
      m.carrying = false;
      m.target = -1;
      m.wait = MOLE_WAIT_S;
    } else if (m.target >= 0) {
      s.gems[m.target].stolen = true;
      m.carrying = true;
      ev.stolen.push(m.target);
    }
  }
}

/** Water just arrived: feed the flow combo (a step per 5 % delivered) and the double points. */
function streak(s: State, ev: Events) {
  const pcts = Math.floor((100 * s.delivered) / s.total);
  if (s.double) s.bonus += (pcts - s.pcts) * PCT_POINTS;
  s.pcts = pcts;
  const chunks = Math.floor((20 * s.delivered) / s.total);
  if (chunks <= s.chunks) return;
  s.streak += chunks - s.chunks;
  s.chunks = chunks;
  while (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
    ev.tier = ++s.tier;
    let p = TIER_POWERS[s.tier - 1];
    const left = s.gems.findIndex((g) => !g.got && !g.stolen);
    if (p === 'magnet' && left < 0) p = 'purify';
    ev.unlocked = p;
    if (p === 'purify') s.purify = PURIFY_S;
    else if (p === 'double') s.double = true;
    else {
      s.gems[left].got = true;
      ev.gems.push(left);
      ev.magnet = left;
    }
  }
}

/** Advance the water (and the moles) by `dt` seconds and decide the run. */
export function step(s: State, dt: number): Events {
  const ev: Events = {
    fell: 0,
    delivered: 0,
    lost: 0,
    gems: [],
    steam: [],
    stolen: [],
    washed: [],
    tier: 0,
    unlocked: '',
    magnet: -1,
    broke: 0,
    goal: false,
    won: false,
    over: false,
  };
  if (s.done) return ev;
  const met = s.delivered >= s.need;
  s.acc += dt;
  while (s.acc >= TICK) {
    s.acc -= TICK;
    tick(s, ev);
  }
  s.purify = Math.max(0, s.purify - dt);
  crawl(s, dt, ev);
  if (ev.delivered) {
    s.gap = 0;
    streak(s, ev);
  } else if (s.streak && (s.gap += dt) >= STREAK_GAP) {
    ev.broke = s.streak;
    s.streak = s.tier = 0;
    s.double = false;
  }
  ev.goal = !met && s.delivered >= s.need;
  if (!s.released) return ev;
  if (ev.fell || ev.delivered || ev.lost) s.still = 0;
  else s.still += dt;
  const ok = s.delivered >= s.need;
  if (ok && (s.water === 0 || s.still >= DONE_S)) ev.won = true;
  else if (!ok && (s.water === 0 || s.still >= SETTLE_S || s.delivered + s.water < s.need)) ev.over = true;
  s.done = ev.won || ev.over;
  return ev;
}
