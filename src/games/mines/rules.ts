import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Board size per level: [columns, rows]. */
export const sizeFor = (d: Difficulty) =>
  byLevel(d, [
    [7, 9],
    [8, 10],
    [8, 11],
    [9, 11],
    [9, 12],
  ] as const);
export const minesFor = (d: Difficulty) => byLevel(d, [8, 12, 16, 20, 24]);
export const livesFor = (d: Difficulty) => byLevel(d, [2, 2, 2, 1, 1]);
/** Seconds to clear the board, counted from the first tap. */
export const timeFor = (d: Difficulty) => byLevel(d, [60, 70, 80, 90, 100]);

/** Points per safe cell opened. */
export const CELL_POINTS = 5;
/** Points per second left on the clock when the board is cleared. */
export const TIME_POINTS = 10;
/** Points per life left at the end. */
export const LIFE_BONUS = 150;
/** Bonus for a clear without a single flag on a safe cell. */
export const CLEAN_BONUS = 250;
/** Bonus cells (always safe, marked on the board): an hourglass adds seconds, a gem adds points. */
export const CLOCK_S = 5;
export const GEM_POINTS = 40;
type Bonus = '' | 'clock' | 'gem';

/**
 * Quick reveals in a row (each within STREAK_S of the last, no mine) unlock: a frozen clock, then
 * a scout that opens safe cells for you, then extra time.
 */
export const STREAK_S = 1.6;
export const STREAK_TIERS = [6, 12, 20] as const;
export type Power = 'freeze' | 'scout' | 'time';
const POWERS: readonly Power[] = ['freeze', 'scout', 'time'];
export const FREEZE_S = 5;
export const SCOUT_CELLS = 3;
export const TIME_S = 10;

export type KindId = 'classic' | 'donut' | 'cross' | 'scatter' | 'treasure' | 'sprint';
export const KINDS: readonly (Kind & { id: KindId })[] = [
  { id: 'classic', weight: 1.2 },
  { id: 'donut' },
  { id: 'cross' },
  { id: 'scatter', min: 2 },
  { id: 'treasure' },
  { id: 'sprint', min: 3 },
];
/** Sprint boards start with this share of the clock, and every safe cell opened adds SPRINT_S. */
const SPRINT_SHARE = 0.55;
export const SPRINT_S = 0.5;

export interface State {
  d: Difficulty;
  kind: KindId;
  cols: number;
  rows: number;
  /** Holes in the board's shape: not cells at all (never mines, never counted). */
  hole: boolean[];
  /** Mines on the board (may end one or two lower than planned if the seed was stubborn). */
  count: number;
  mine: boolean[];
  /** Mines around each cell. */
  num: number[];
  open: boolean[];
  flag: boolean[];
  /** Mines that went off (shown, and count as known mines). */
  boom: boolean[];
  /** Bonus on each cell (laid with the mines), and how many of each to lay. */
  bonus: Bonus[];
  clocks: number;
  gems: number;
  /** Neighbour lists (up to 8 per cell, holes left out). */
  nb: number[][];
  /** Mines are laid on the first tap, so it is always safe. */
  placed: boolean;
  /** Safe cells opened / to open. */
  opened: number;
  safe: number;
  lives: number;
  limit: number;
  time: number;
  /** Seconds the clock stays frozen. */
  freeze: number;
  /** Quick reveals in a row, seconds left to extend the streak, and the milestone it reached. */
  streak: number;
  streakLeft: number;
  tier: number;
  /** Flags ever planted on a safe cell. */
  wrongFlags: number;
  score: number;
  done: boolean;
  /** Boards dealt before one could be solved without guessing (for tests). */
  tries: number;
  rng: Rng;
}

/** What a tap or a tick changed, for the card. */
export interface Events {
  opened: number;
  boom: boolean;
  /** Bonus cells opened this time. */
  bonus: { i: number; kind: Bonus }[];
  /** The streak reached milestone `tier` (1-based) and unlocked `power`; cells the scout opened. */
  tier: number;
  power: Power | null;
  scouted: number[];
  won: boolean;
  over: boolean;
}

const none = (): Events => ({ opened: 0, boom: false, bonus: [], tier: 0, power: null, scouted: [], won: false, over: false });

/** Cells reachable from `from` through non-hole cells (8-way). */
function reach(cols: number, rows: number, hole: boolean[], from: number): number {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) {
    const i = todo.pop()!;
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        const j = rr * cols + cc;
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && !hole[j] && !seen.has(j)) {
          seen.add(j);
          todo.push(j);
        }
      }
  }
  return seen.size;
}

/** The board's shape for a kind: which cells are holes. */
function shape(kind: KindId, cols: number, rows: number, rng: Rng): boolean[] {
  const hole = new Array<boolean>(cols * rows).fill(false);
  const at = (c: number, r: number) => r * cols + c;
  if (kind === 'donut') {
    // A hole in the middle, about a third of each side.
    const w = Math.max(2, Math.round(cols / 3));
    const h = Math.max(2, Math.round(rows / 3));
    const c0 = Math.floor((cols - w) / 2);
    const r0 = Math.floor((rows - h) / 2);
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) hole[at(c, r)] = true;
  } else if (kind === 'cross') {
    // Corners cut away: a plus-shaped board.
    const w = Math.floor(cols / 4);
    const h = Math.floor(rows / 4);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) if ((c < w || c >= cols - w) && (r < h || r >= rows - h)) hole[at(c, r)] = true;
  } else if (kind === 'scatter') {
    // Scattered single holes, never touching each other, keeping the board in one piece.
    const want = Math.round(cols * rows * 0.1);
    for (let k = 0, tries = 0; k < want && tries < 400; tries++) {
      const c = rng.int(0, cols - 1);
      const r = rng.int(0, rows - 1);
      let near = false;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          const rr = r + dr;
          if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && hole[at(cc, rr)]) near = true;
        }
      if (near) continue;
      hole[at(c, r)] = true;
      const real = hole.filter((h) => !h).length;
      const first = hole.indexOf(false);
      if (reach(cols, rows, hole, first) !== real) hole[at(c, r)] = false;
      else k++;
    }
  }
  return hole;
}

/** An empty board in the kind's shape: the mines are laid out on the first tap. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const [cols, rows] = sizeFor(d);
  const n = cols * rows;
  const hole = shape(kind, cols, rows, rng);
  const nb: number[][] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const list: number[] = [];
    if (!hole[i])
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          const rr = r + dr;
          const j = rr * cols + cc;
          if ((dc || dr) && cc >= 0 && rr >= 0 && cc < cols && rr < rows && !hole[j]) list.push(j);
        }
    nb.push(list);
  }
  const real = n - hole.filter(Boolean).length;
  // The same share of mines as a full board.
  const count = Math.round((minesFor(d) * real) / n);
  const limit =
    kind === 'sprint' ? Math.round(timeFor(d) * SPRINT_SHARE) : kind === 'treasure' ? Math.round(timeFor(d) * 0.92) : timeFor(d);
  return {
    d,
    kind,
    cols,
    rows,
    hole,
    count,
    mine: new Array<boolean>(n).fill(false),
    num: new Array<number>(n).fill(0),
    open: new Array<boolean>(n).fill(false),
    flag: new Array<boolean>(n).fill(false),
    boom: new Array<boolean>(n).fill(false),
    bonus: new Array<Bonus>(n).fill(''),
    clocks: kind === 'treasure' ? 3 : kind === 'sprint' ? 0 : 1,
    gems: kind === 'treasure' ? 3 : 1,
    nb,
    placed: false,
    opened: 0,
    safe: real - count,
    lives: livesFor(d),
    limit,
    time: 0,
    freeze: 0,
    streak: 0,
    streakLeft: 0,
    tier: 0,
    wrongFlags: 0,
    score: 0,
    done: false,
    tries: 0,
    rng,
  };
}

/** The cell nearest the middle of the board that isn't a hole (where the keyboard cursor starts). */
export function startCell(s: Pick<State, 'cols' | 'rows' | 'hole'>): number {
  const mc = (s.cols - 1) / 2;
  const mr = (s.rows - 1) / 2;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < s.hole.length; i++) {
    if (s.hole[i]) continue;
    const d = Math.abs((i % s.cols) - mc) + Math.abs(Math.floor(i / s.cols) - mr);
    if (d < bd) [best, bd] = [i, d];
  }
  return best;
}

/**
 * Safe cells that follow from what is showing: open numbers and mines that went off. Two rules, run
 * until nothing new turns up: a number that already sees all its mines clears the rest of its
 * neighbours (and one with as many hidden neighbours as missing mines marks them all), and when one
 * number's hidden neighbours are a subset of another's, the difference gets the difference in mines.
 * Never reads a hidden cell, so the autopilot can use it too.
 */
export function deduce(s: Pick<State, 'num' | 'nb' | 'cols'>, open: readonly boolean[], known: readonly boolean[]): number[] {
  const n = open.length;
  const isMine = [...known];
  const isSafe = new Array<boolean>(n).fill(false);
  const mark = (cells: number[], mine: boolean) => {
    let any = false;
    for (const j of cells)
      if (!isMine[j] && !isSafe[j]) {
        if (mine) isMine[j] = true;
        else isSafe[j] = true;
        any = true;
      }
    return any;
  };
  for (;;) {
    const cons: { at: number; cells: number[]; need: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (!open[i]) continue;
      const cells = s.nb[i].filter((j) => !open[j] && !isMine[j] && !isSafe[j]);
      if (!cells.length) continue;
      cons.push({ at: i, cells, need: s.num[i] - s.nb[i].filter((j) => isMine[j]).length });
    }
    let changed = false;
    for (const k of cons) {
      if (k.need === 0) changed = mark(k.cells, false) || changed;
      else if (k.need === k.cells.length) changed = mark(k.cells, true) || changed;
    }
    if (!changed)
      for (const a of cons) {
        for (const b of cons) {
          if (a === b || a.cells.length >= b.cells.length) continue;
          // Only numbers within two cells of each other can share hidden neighbours.
          if (Math.abs((a.at % s.cols) - (b.at % s.cols)) > 2 || Math.abs(Math.floor(a.at / s.cols) - Math.floor(b.at / s.cols)) > 2)
            continue;
          if (!a.cells.every((j) => b.cells.includes(j))) continue;
          const rest = b.cells.filter((j) => !a.cells.includes(j));
          const need = b.need - a.need;
          if (need === 0) changed = mark(rest, false) || changed;
          else if (need === rest.length) changed = mark(rest, true) || changed;
          if (changed) break;
        }
        if (changed) break;
      }
    if (!changed) break;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (isSafe[i] && !open[i]) out.push(i);
  return out;
}

/**
 * Open `i` and, from every blank (0) cell, its neighbours. Returns the cells opened (and lists them
 * in `into`). Skips flags.
 */
function flood(s: Pick<State, 'num' | 'nb' | 'flag'>, open: boolean[], i: number, into?: number[]): number {
  if (open[i]) return 0;
  open[i] = true;
  into?.push(i);
  let k = 1;
  const todo = [i];
  while (todo.length) {
    const j = todo.pop()!;
    if (s.num[j]) continue;
    for (const m of s.nb[j])
      if (!open[m] && !s.flag[m]) {
        open[m] = true;
        into?.push(m);
        k++;
        todo.push(m);
      }
  }
  return k;
}

/** True if opening `first` and then only deduced cells clears the whole board. */
export function solvable(s: State, first: number): boolean {
  const open = new Array<boolean>(s.mine.length).fill(false);
  const noFlags = { ...s, flag: open.map(() => false) };
  let opened = flood(noFlags, open, first);
  const known = open.map(() => false);
  for (;;) {
    const safe = deduce(s, open, known);
    if (!safe.length) break;
    for (const j of safe) opened += flood(noFlags, open, j);
  }
  return opened === s.safe;
}

/** Lay the mines away from the first tap, dealing again until the board needs no guess from there; then the bonus cells. */
function place(s: State, first: number) {
  const n = s.mine.length;
  const fc = first % s.cols;
  const fr = Math.floor(first / s.cols);
  const near = (i: number) => Math.abs((i % s.cols) - fc) <= 1 && Math.abs(Math.floor(i / s.cols) - fr) <= 1;
  const spots = [...Array(n).keys()].filter((i) => !s.hole[i] && !near(i));
  for (let tries = 1; ; tries++) {
    // A very stubborn seed drops a mine now and then rather than dealing forever.
    if (tries % 400 === 0 && s.count > 1) s.count--;
    s.rng.shuffle(spots);
    s.mine.fill(false);
    for (let k = 0; k < s.count; k++) s.mine[spots[k]] = true;
    for (let i = 0; i < n; i++) s.num[i] = s.nb[i].filter((j) => s.mine[j]).length;
    s.safe = n - s.hole.filter(Boolean).length - s.count;
    s.tries = tries;
    if (solvable(s, first)) break;
  }
  // Bonus cells on safe cells beyond the area the first tap opens, so they're found along the way.
  const first0 = new Array<boolean>(n).fill(false);
  flood({ ...s, flag: first0.map(() => false) }, first0, first);
  const free = s.rng.shuffle([...Array(n).keys()].filter((i) => !s.hole[i] && !s.mine[i] && !first0[i]));
  for (let k = 0; k < s.clocks + s.gems && k < free.length; k++) s.bonus[free[k]] = k < s.clocks ? 'clock' : 'gem';
  s.placed = true;
}

/** Hidden neighbours of an open number, and how many of its neighbours are flagged or went off. */
function around(s: State, i: number) {
  const hidden = s.nb[i].filter((j) => !s.open[j] && !s.boom[j]);
  return { hidden, marked: s.nb[i].filter((j) => s.flag[j] || s.boom[j]).length };
}

function finish(s: State, ev: Events) {
  if (s.opened === s.safe) {
    const left = Math.max(0, Math.ceil(s.limit - s.time));
    s.score += left * TIME_POINTS + s.lives * LIFE_BONUS + (s.wrongFlags ? 0 : CLEAN_BONUS);
    s.done = true;
    ev.won = true;
  }
}

/** Score cells just opened: points, bonuses, sprint seconds. */
function collect(s: State, cells: number[], ev: Events) {
  ev.opened += cells.length;
  s.opened += cells.length;
  s.score += cells.length * CELL_POINTS;
  if (s.kind === 'sprint') s.limit += cells.length * SPRINT_S;
  for (const j of cells) {
    const b = s.bonus[j];
    if (!b) continue;
    s.bonus[j] = '';
    ev.bonus.push({ i: j, kind: b });
    if (b === 'clock') s.limit += CLOCK_S;
    else s.score += GEM_POINTS;
  }
}

/** Turn on a streak power (also used by tests). */
export function grant(s: State, p: Power, ev: Events = none()) {
  if (p === 'freeze') s.freeze = FREEZE_S;
  else if (p === 'time') s.limit += TIME_S;
  else {
    // The scout opens a few cells that the board already proves safe.
    for (const j of deduce(s, s.open, s.boom).slice(0, SCOUT_CELLS)) {
      if (s.open[j] || s.flag[j]) continue;
      const cells: number[] = [];
      flood(s, s.open, j, cells);
      ev.scouted.push(j);
      collect(s, cells, ev);
    }
  }
}

/**
 * Tap a cell: open it (the first tap lays the mines). On an open number whose mines are all flagged,
 * open its other neighbours. A mine costs a life and stays shown.
 */
export function reveal(s: State, i: number): Events {
  const ev = none();
  if (s.done || i < 0 || s.hole[i] || s.flag[i] || s.boom[i]) return ev;
  if (!s.placed) place(s, i);
  let targets = [i];
  if (s.open[i]) {
    const { hidden, marked } = around(s, i);
    if (!s.num[i] || marked !== s.num[i]) return ev;
    targets = hidden.filter((j) => !s.flag[j]);
  }
  const cells: number[] = [];
  for (const j of targets) {
    if (s.mine[j]) {
      s.boom[j] = true;
      s.lives--;
      ev.boom = true;
      s.streak = s.tier = 0;
      if (s.lives <= 0) {
        s.done = true;
        ev.over = true;
        return ev;
      }
      continue;
    }
    flood(s, s.open, j, cells);
  }
  collect(s, cells, ev);
  if (cells.length && !ev.boom) {
    // A quick reveal: the streak goes on, and may reach a milestone.
    s.streak = s.streakLeft > 0 ? s.streak + 1 : 1;
    s.streakLeft = STREAK_S;
    if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
      ev.tier = ++s.tier;
      ev.power = POWERS[s.tier - 1];
      grant(s, ev.power, ev);
    }
  }
  finish(s, ev);
  return ev;
}

/** Plant or lift a flag on a hidden cell. True if it changed. */
export function toggleFlag(s: State, i: number): boolean {
  if (s.done || !s.placed || i < 0 || s.hole[i] || s.open[i] || s.boom[i]) return false;
  s.flag[i] = !s.flag[i];
  if (s.flag[i] && !s.mine[i]) s.wrongFlags++;
  return true;
}

/** Mines not yet flagged or gone off (can go negative with too many flags). */
export const minesLeft = (s: State) => s.count - s.flag.filter(Boolean).length - s.boom.filter(Boolean).length;

/** Run the clock (from the start of the run; the first tap only lays the mines), unless it's frozen. */
export function tick(s: State, dt: number): Events {
  const ev = none();
  if (s.done) return ev;
  if (s.streakLeft > 0) {
    s.streakLeft -= dt;
    if (s.streakLeft <= 0) s.streak = s.tier = 0;
  }
  // A frozen clock stands still; what's left of `dt` once it thaws runs as usual.
  const run = Math.max(0, dt - s.freeze);
  s.freeze = Math.max(0, s.freeze - dt);
  s.time += run;
  if (s.time >= s.limit) {
    s.time = s.limit;
    s.done = true;
    ev.over = true;
  }
  return ev;
}
