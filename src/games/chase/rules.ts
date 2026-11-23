import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { DX, DY, type Dir } from '../../kits/gesture/gesture';

/**
 * A hedge maze on a cell grid: nodes sit on odd rows and columns, the cells between two nodes are open
 * or hedge. The maze is mirrored left-right, every corridor cell has at least two exits, and one row
 * has a side passage that wraps around. The owls' nest sits in the middle with a door on top: only
 * owls go through it (leaving, or coming back as eyes).
 */
export const WALL = 0;
export const PATH = 1;
export const DOOR = 2;
export const DEN = 3;
/** What lies on a cell. */
export const SEED = 1;
export const BERRY = 2;

export const LIVES = 3;
export const SEED_POINTS = 10;
export const BERRY_POINTS = 50;
/** Scared owls caught in a row, per berry. */
export const CHAIN = [200, 400, 800, 1600];
export const LIFE_BONUS = 300;
/** Seconds of the caught animation before the hero comes back, then of blinking safety. */
export const RESPAWN_S = 1.4;
const SAFE_S = 2;
/** Seconds the acorn stays out, and the share of seeds eaten when each of the two appears. */
const BONUS_S = 9;
const BONUS_AT = [0.3, 0.7];
/** The first owl leaves the nest after this many seconds. */
export const FIRST_OUT = 3.2;
const CHASE_S = 20;

/** Owl personalities, in release order (0 chases directly). */
const RANDOM = 1;
const AMBUSH = 2;
const PATROL = 3;
type Kind = 0 | 1 | 2 | 3;

/** Maze nodes across and down (the grid is twice as big, plus one). */
export const sizeFor = (d: Difficulty) =>
  byLevel(d, [
    [5, 7],
    [5, 8],
    [7, 8],
    [7, 9],
    [7, 10],
  ] as const);
export const chasersFor = (d: Difficulty) => byLevel(d, [2, 3, 3, 4, 4]);
/** Hero speed in cells per second, and the owls' speed as a share of it. */
export const heroSpeedFor = (d: Difficulty) => byLevel(d, [5, 5.3, 5.6, 5.9, 6.2]);
export const paceFor = (d: Difficulty) => byLevel(d, [0.72, 0.78, 0.83, 0.87, 0.9]);
/** Seconds a berry scares the owls. */
export const frightFor = (d: Difficulty) => byLevel(d, [7, 6, 5, 4, 3.2]);
/** Seconds between two owls leaving the nest. */
const gapFor = (d: Difficulty) => byLevel(d, [7, 6, 5, 4.5, 4]);
/** Seconds of each scatter phase (owls head for their corners), between the chase phases. */
const scatterFor = (d: Difficulty) => byLevel(d, [7, 7, 6, 5, 5]);
/** Chance to open each extra corridor (more loops, more escape routes). */
const loopsFor = (d: Difficulty) => byLevel(d, [0.34, 0.3, 0.28, 0.25, 0.22]);
const bonusFor = (d: Difficulty) => byLevel(d, [100, 200, 300, 500, 700]);
/** About the fewest seeds (and berries) a level deals, for the star goals. */
export const seedsFor = (d: Difficulty) => byLevel(d, [74, 86, 122, 139, 153]);

export interface Mover {
  /** The cell it is at or leaving. */
  at: number;
  /** Heading, and whether it's moving at all. */
  dir: Dir;
  moving: boolean;
  /** How far along towards the next cell, 0 to 1. */
  f: number;
}

interface Hero extends Mover {
  /** Buffered turn, taken at the next cell where it's open. */
  want: Dir | -1;
  /** Last heading, for drawing and the ambusher. */
  face: Dir;
}

type Mode = 'den' | 'leave' | 'run' | 'eyes';

export interface Chaser extends Mover {
  kind: Kind;
  mode: Mode;
  fright: boolean;
  /** When it leaves the nest (mode 'den'). */
  out: number;
  /** Its spot in the nest and the corner it heads for when scattering (column, row). */
  home: number;
  corner: [number, number];
}

export interface State {
  d: Difficulty;
  cols: number;
  rows: number;
  grid: Uint8Array;
  items: Uint8Array;
  /** Seeds and berries left, and how many there were. */
  left: number;
  total: number;
  tunnelRow: number;
  start: number;
  door: number;
  exit: number;
  den: number;
  /** Steps to the cell above the door and to the nest, over cells the owls can use. */
  toExit: Int16Array;
  toDen: Int16Array;
  hero: Hero;
  chasers: Chaser[];
  time: number;
  /** 0 and 2 scatter, 1 chase, 3 chase for good. */
  phase: number;
  phaseT: number;
  /** Seconds of scare left, and owls caught during it. */
  fright: number;
  chain: number;
  lives: number;
  score: number;
  /** Seconds of the caught animation left (everything waits), then seconds of safety. */
  dying: number;
  safe: number;
  /** Seconds the acorn stays out (0 = none) and acorns dealt so far. */
  bonus: number;
  drops: number;
  heroSpeed: number;
  done: boolean;
  rng: Rng;
}

/** The cell next to `i` in `dir` (wrapping sideways), or -1 off the top or bottom. */
export function nb(s: State, i: number, dir: Dir): number {
  let c = (i % s.cols) + DX[dir];
  const r = Math.floor(i / s.cols) + DY[dir];
  if (r < 0 || r >= s.rows) return -1;
  if (c < 0) c = s.cols - 1;
  else if (c >= s.cols) c = 0;
  return r * s.cols + c;
}

export const heroCan = (s: State, i: number, dir: Dir) => {
  const j = nb(s, i, dir);
  return j >= 0 && s.grid[j] === PATH;
};

/** Owl moves: corridors when running; also the nest and its door when leaving or going home. */
function chaserCan(s: State, ch: Chaser, i: number, dir: Dir): boolean {
  const j = nb(s, i, dir);
  if (j < 0) return false;
  const a = s.grid[i];
  const b = s.grid[j];
  if (b === WALL) return false;
  if (ch.mode === 'run') return b === PATH;
  return !((a === DEN && b === PATH) || (a === PATH && b === DEN));
}

const isTunnel = (s: State, i: number) => s.grid[i] === PATH && (i % s.cols === 0 || i % s.cols === s.cols - 1);

/** Steps from `from` to every cell, moving only where `ok(i, j)` allows (-1 = unreachable). */
export function bfs(s: State, from: number, ok: (i: number, j: number) => boolean): Int16Array {
  const dist = new Int16Array(s.grid.length).fill(-1);
  dist[from] = 0;
  const todo = [from];
  for (let k = 0; k < todo.length; k++) {
    const i = todo[k];
    for (let d = 0; d < 4; d++) {
      const j = nb(s, i, d as Dir);
      if (j < 0 || dist[j] >= 0 || !ok(i, j)) continue;
      dist[j] = dist[i] + 1;
      todo.push(j);
    }
  }
  return dist;
}

const owlWay = (s: State) => (i: number, j: number) => {
  const a = s.grid[i];
  const b = s.grid[j];
  return b !== WALL && !((a === DEN && b === PATH) || (a === PATH && b === DEN));
};

/** Carve a mirrored, loopy maze with no dead ends; returns the grid. */
function carve(d: Difficulty, rng: Rng) {
  const [nx, ny] = sizeFor(d);
  const cols = 2 * nx + 1;
  const rows = 2 * ny + 1;
  const grid = new Uint8Array(cols * rows);
  const ic = (nx - 1) / 2;
  const jm = Math.floor(ny / 2);
  const cell = (i: number, j: number) => (2 * j + 1) * cols + 2 * i + 1;
  const isDen = (i: number, j: number) => i === ic && j === jm;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!isDen(i, j)) grid[cell(i, j)] = PATH;

  interface Edge {
    i: number;
    j: number;
    h: boolean;
  }
  const at = (e: Edge) => (e.h ? (2 * e.j + 1) * cols + 2 * e.i + 2 : (2 * e.j + 2) * cols + 2 * e.i + 1);
  const mirror = (e: Edge): Edge => ({ i: e.h ? nx - 2 - e.i : nx - 1 - e.i, j: e.j, h: e.h });
  const ends = (e: Edge) => [e.j * nx + e.i, e.h ? e.j * nx + e.i + 1 : (e.j + 1) * nx + e.i];
  const open = (e: Edge) => {
    grid[at(e)] = PATH;
    grid[at(mirror(e))] = PATH;
  };
  const edges: Edge[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (isDen(i, j)) continue;
      if (i + 1 < nx && !isDen(i + 1, j)) edges.push({ i, j, h: true });
      if (j + 1 < ny && !isDen(i, j + 1)) edges.push({ i, j, h: false });
    }
  rng.shuffle(edges);

  // A spanning tree, opened in mirrored pairs (Kruskal).
  const parent = [...Array(nx * ny).keys()];
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (const e of edges) {
    const [a, b] = ends(e);
    const [ma, mb] = ends(mirror(e));
    if (find(a) !== find(b) || find(ma) !== find(mb)) {
      open(e);
      parent[find(a)] = find(b);
      parent[find(ma)] = find(mb);
    }
  }
  // No dead ends: give every node with one exit a second one.
  const degree = (i: number, j: number) => [0, 1, 2, 3].filter((k) => grid[cell(i, j) + DX[k] + DY[k] * cols] === PATH).length;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (isDen(i, j) || degree(i, j) >= 2) continue;
      const shut = edges.filter((e) => grid[at(e)] === WALL && ends(e).includes(j * nx + i));
      open(rng.pick(shut));
    }
  // Extra loops.
  const p = loopsFor(d);
  for (const e of edges) if (grid[at(e)] === WALL && rng.chance(p)) open(e);

  // The nest (three cells) and its door on top; a side passage on one row.
  const den = cell(ic, jm);
  grid[den - 1] = grid[den] = grid[den + 1] = DEN;
  grid[den - cols] = DOOR;
  const rowsOk = [...Array(ny).keys()].filter((j) => j > 0 && j < ny - 1 && j !== jm);
  const tunnelRow = 2 * rng.pick(rowsOk) + 1;
  grid[tunnelRow * cols] = grid[tunnelRow * cols + cols - 1] = PATH;
  return { cols, rows, grid, den, nx, ny, ic, jm, cell, tunnelRow };
}

/** Deal a level: the maze, its seeds and berries, the hero at the bottom and the owls in the nest. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const { cols, rows, grid, den, nx, ny, ic, jm, cell, tunnelRow } = carve(d, rng);
  const start = cell(ic, ny - 1);
  const items = new Uint8Array(grid.length);
  const s: State = {
    d,
    cols,
    rows,
    grid,
    items,
    left: 0,
    total: 0,
    tunnelRow,
    start,
    door: den - cols,
    exit: cell(ic, jm - 1),
    den,
    toExit: new Int16Array(0),
    toDen: new Int16Array(0),
    hero: { at: start, dir: 3, moving: false, f: 0, want: -1, face: 3 },
    chasers: [],
    time: 0,
    phase: 0,
    phaseT: 0,
    fright: 0,
    chain: 0,
    lives: LIVES,
    score: 0,
    dying: 0,
    safe: 0,
    bonus: 0,
    drops: 0,
    heroSpeed: heroSpeedFor(d),
    done: false,
    rng,
  };
  for (let i = 0; i < grid.length; i++) if (grid[i] === PATH && i !== start && !isTunnel(s, i)) items[i] = SEED;
  for (const [i, j] of [
    [0, 1],
    [nx - 1, 1],
    [0, ny - 2],
    [nx - 1, ny - 2],
  ])
    items[cell(i, j)] = BERRY;
  s.total = s.left = items.reduce((n, v) => n + (v ? 1 : 0), 0);
  s.toExit = bfs(s, s.exit, owlWay(s));
  s.toDen = bfs(s, s.den, owlWay(s));
  const corners: [number, number][] = [
    [cols - 1, -2],
    [0, rows + 1],
    [0, -2],
    [cols - 1, rows + 1],
  ];
  const homes = chasersFor(d) === 2 ? [den - 1, den + 1] : [den, den - 1, den + 1, den];
  for (let k = 0; k < chasersFor(d); k++)
    s.chasers.push({
      at: homes[k],
      dir: 0,
      moving: false,
      f: 0,
      kind: k as Kind,
      mode: 'den',
      fright: false,
      out: 0,
      home: homes[k],
      corner: corners[k],
    });
  releaseAll(s, FIRST_OUT, gapFor(d));
  return s;
}

function releaseAll(s: State, first: number, gap: number) {
  s.chasers.forEach((ch, k) => {
    Object.assign(ch, { at: ch.home, dir: 0, moving: false, f: 0, mode: 'den', fright: false, out: s.time + first + k * gap });
  });
}

/** Where a mover is, in cells (centre of cell (c, r) = (c + 0.5, r + 0.5)); x runs past the edges in the side passage. */
export function pos(s: State, m: Mover): { x: number; y: number } {
  const d = m.moving ? m.f : 0;
  const k = m.dir;
  return { x: (m.at % s.cols) + 0.5 + DX[k] * d, y: Math.floor(m.at / s.cols) + 0.5 + DY[k] * d };
}

/** Distance between two movers, across the side passage. */
function apart(s: State, a: Mover, b: Mover): number {
  const p = pos(s, a);
  const q = pos(s, b);
  let dx = Math.abs(p.x - q.x);
  if (dx > s.cols / 2) dx = s.cols - dx;
  return Math.hypot(dx, p.y - q.y);
}

/**
 * Steer the hero: from a standstill it sets off at once if it can; a turn straight back is taken at
 * once; any other turn waits for the next cell where it's open.
 */
export function steer(s: State, dir: Dir) {
  const h = s.hero;
  if (s.done) return;
  if (s.dying > 0 || !h.moving) {
    if (s.dying <= 0 && heroCan(s, h.at, dir)) {
      Object.assign(h, { dir, moving: true, f: 0, face: dir, want: -1 });
    } else h.want = dir;
    return;
  }
  if (dir === h.dir) h.want = -1;
  else if (dir === (h.dir + 2) % 4) {
    h.at = nb(s, h.at, h.dir);
    h.f = 1 - h.f;
    h.dir = h.face = dir;
    h.want = -1;
  } else h.want = dir;
}

const reverse = (s: State, m: Mover) => {
  if (!m.moving) return;
  m.at = nb(s, m.at, m.dir);
  m.f = 1 - m.f;
  m.dir = ((m.dir + 2) % 4) as Dir;
};

const scattering = (s: State) => s.phase === 0 || s.phase === 2;

/** Where a running owl is heading: its corner when scattering, else its own idea of the hero. */
function target(s: State, ch: Chaser): [number, number] {
  const h = s.hero;
  const hc = h.at % s.cols;
  const hr = Math.floor(h.at / s.cols);
  if (scattering(s)) return ch.corner;
  if (ch.kind === AMBUSH) return [hc + DX[h.face] * 4, hr + DY[h.face] * 4];
  if (ch.kind === PATROL) {
    const dc = (ch.at % s.cols) - hc;
    const dr = Math.floor(ch.at / s.cols) - hr;
    return dc * dc + dr * dr > 64 ? [hc, hr] : ch.corner;
  }
  return [hc, hr];
}

const ORDER: Dir[] = [0, 3, 2, 1];

/** An owl reached a cell: pick its next heading (never straight back while running). */
function choose(s: State, ch: Chaser) {
  const was = ch.moving;
  ch.moving = true;
  const opts = ORDER.filter((d) => chaserCan(s, ch, ch.at, d));
  if (ch.mode === 'leave' || ch.mode === 'eyes') {
    const map = ch.mode === 'leave' ? s.toExit : s.toDen;
    let best = opts[0];
    for (const d of opts) if (map[nb(s, ch.at, d)] < map[nb(s, ch.at, best)]) best = d;
    ch.dir = best;
    return;
  }
  const fwd = !was ? opts : opts.filter((d) => d !== (ch.dir + 2) % 4);
  const ways = fwd.length ? fwd : opts;
  if (ch.fright || (ch.kind === RANDOM && !scattering(s))) {
    ch.dir = s.rng.pick(ways);
    return;
  }
  const [tc, tr] = target(s, ch);
  let best = ways[0];
  let bestD = Infinity;
  for (const d of ways) {
    const j = nb(s, ch.at, d);
    const dc = (j % s.cols) - tc;
    const dr = Math.floor(j / s.cols) - tr;
    if (dc * dc + dr * dr < bestD) {
      bestD = dc * dc + dr * dr;
      best = d;
    }
  }
  ch.dir = best;
}

function chaserSpeed(s: State, ch: Chaser): number {
  if (ch.mode === 'eyes') return s.heroSpeed * 1.7;
  const base = s.heroSpeed * paceFor(s.d);
  if (ch.mode === 'leave') return base * 0.6;
  let v = ch.fright ? base * 0.6 : base;
  if (isTunnel(s, ch.at) || (ch.moving && isTunnel(s, nb(s, ch.at, ch.dir)))) v *= 0.5;
  return v;
}

interface Caught {
  kind: Kind;
  x: number;
  y: number;
  points: number;
}

export interface StepEvents {
  /** Seeds eaten this step. */
  seeds: number;
  berry: boolean;
  caught: Caught[];
  /** Points from an acorn picked up, and whether one appeared. */
  bonus: number;
  bonusUp: boolean;
  /** Owls that just left the nest. */
  released: number;
  lostLife: boolean;
  /** The hero is back at the start after being caught. */
  respawned: boolean;
  /** Points from the lives left, on a clear. */
  lifeBonus: number;
  won: boolean;
  over: boolean;
}

const noEvents = (): StepEvents => ({
  seeds: 0,
  berry: false,
  caught: [],
  bonus: 0,
  bonusUp: false,
  released: 0,
  lostLife: false,
  respawned: false,
  lifeBonus: 0,
  won: false,
  over: false,
});

function heroArrive(s: State, ev: StepEvents) {
  const h = s.hero;
  const it = s.items[h.at];
  if (it) {
    s.items[h.at] = 0;
    s.left--;
    if (it === SEED) {
      s.score += SEED_POINTS;
      ev.seeds++;
    } else {
      s.score += BERRY_POINTS;
      ev.berry = true;
      s.fright = frightFor(s.d);
      s.chain = 0;
      for (const ch of s.chasers)
        if (ch.mode === 'run') {
          if (!ch.fright) reverse(s, ch);
          ch.fright = true;
        }
    }
    const eaten = s.total - s.left;
    if (s.drops < BONUS_AT.length && eaten >= s.total * BONUS_AT[s.drops]) {
      s.drops++;
      s.bonus = BONUS_S;
      ev.bonusUp = true;
    }
  }
  if (h.want >= 0 && heroCan(s, h.at, h.want as Dir)) {
    h.dir = h.face = h.want as Dir;
    h.want = -1;
  }
  if (h.moving && !heroCan(s, h.at, h.dir)) {
    h.moving = false;
    h.f = 0;
  }
}

function tick(s: State, dt: number, ev: StepEvents) {
  if (s.dying > 0) {
    s.dying -= dt;
    if (s.dying <= 0) {
      s.dying = 0;
      Object.assign(s.hero, { at: s.start, dir: 3, moving: false, f: 0, face: 3 });
      s.fright = 0;
      s.bonus = 0;
      s.safe = SAFE_S;
      releaseAll(s, 1.5, 1.5);
      ev.respawned = true;
      // A turn pressed during the animation sets off at once.
      const want = s.hero.want;
      s.hero.want = -1;
      if (want >= 0) steer(s, want as Dir);
    }
    return;
  }
  s.time += dt;
  s.safe = Math.max(0, s.safe - dt);
  s.bonus = Math.max(0, s.bonus - dt);
  if (s.fright > 0) {
    s.fright -= dt;
    if (s.fright <= 0) {
      s.fright = 0;
      for (const ch of s.chasers) ch.fright = false;
    }
  } else if (s.phase < 3 && (s.phaseT += dt) >= (s.phase % 2 ? CHASE_S : scatterFor(s.d))) {
    s.phase++;
    s.phaseT = 0;
    for (const ch of s.chasers) if (ch.mode === 'run') reverse(s, ch);
  }

  const h = s.hero;
  if (h.moving) {
    h.f += s.heroSpeed * dt;
    while (h.f >= 1 && h.moving) {
      h.f -= 1;
      h.at = nb(s, h.at, h.dir);
      heroArrive(s, ev);
    }
  }

  for (const ch of s.chasers) {
    if (ch.mode === 'den') {
      if (s.time < ch.out) continue;
      ch.mode = 'leave';
      ev.released++;
      choose(s, ch);
    }
    ch.f += chaserSpeed(s, ch) * dt;
    while (ch.f >= 1 && ch.moving) {
      ch.f -= 1;
      ch.at = nb(s, ch.at, ch.dir);
      if (ch.mode === 'leave' && ch.at === s.exit) ch.mode = 'run';
      if (ch.mode === 'eyes' && ch.at === s.den) {
        Object.assign(ch, { mode: 'den', moving: false, f: 0, out: s.time + 0.8 });
        break;
      }
      choose(s, ch);
    }
  }

  for (const ch of s.chasers) {
    if ((ch.mode !== 'run' && ch.mode !== 'leave') || apart(s, h, ch) > 0.6) continue;
    const p = pos(s, ch);
    if (ch.fright) {
      const points = CHAIN[Math.min(s.chain, CHAIN.length - 1)];
      s.chain++;
      s.score += points;
      ch.fright = false;
      ch.mode = 'eyes';
      choose(s, ch);
      ev.caught.push({ kind: ch.kind, x: p.x, y: p.y, points });
    } else if (s.safe <= 0) {
      s.lives--;
      ev.lostLife = true;
      if (s.lives <= 0) {
        s.done = true;
        ev.over = true;
      } else s.dying = RESPAWN_S;
      return;
    }
  }

  if (s.bonus > 0 && h.at === s.start && h.f < 0.5) {
    s.bonus = 0;
    s.score += bonusFor(s.d);
    ev.bonus = bonusFor(s.d);
  }
  if (s.left === 0) {
    ev.lifeBonus = s.lives * LIFE_BONUS;
    s.score += ev.lifeBonus;
    s.done = true;
    ev.won = true;
  }
}

/** Advance by `dt` seconds, in small slices so nothing slips past anything. */
export function step(s: State, dt: number): StepEvents {
  const ev = noEvents();
  const n = Math.max(1, Math.ceil(dt * 120));
  for (let k = 0; k < n && !s.done; k++) tick(s, dt / n, ev);
  return ev;
}
