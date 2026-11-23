import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

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

export interface State {
  d: Difficulty;
  cols: number;
  rows: number;
  /** Mines on the board (may end one or two lower than `minesFor` if the seed was stubborn). */
  count: number;
  mine: boolean[];
  /** Mines around each cell. */
  num: number[];
  open: boolean[];
  flag: boolean[];
  /** Mines that went off (shown, and count as known mines). */
  boom: boolean[];
  /** Neighbour lists (up to 8 per cell). */
  nb: number[][];
  /** Mines are laid on the first tap, so it is always safe. */
  placed: boolean;
  /** Safe cells opened / to open. */
  opened: number;
  safe: number;
  lives: number;
  limit: number;
  time: number;
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
  won: boolean;
  over: boolean;
}

const none = (): Events => ({ opened: 0, boom: false, won: false, over: false });

/** An empty board: the mines are laid out on the first tap. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const [cols, rows] = sizeFor(d);
  const n = cols * rows;
  const nb: number[][] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const list: number[] = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if ((dc || dr) && cc >= 0 && rr >= 0 && cc < cols && rr < rows) list.push(rr * cols + cc);
      }
    nb.push(list);
  }
  const count = minesFor(d);
  return {
    d,
    cols,
    rows,
    count,
    mine: new Array<boolean>(n).fill(false),
    num: new Array<number>(n).fill(0),
    open: new Array<boolean>(n).fill(false),
    flag: new Array<boolean>(n).fill(false),
    boom: new Array<boolean>(n).fill(false),
    nb,
    placed: false,
    opened: 0,
    safe: n - count,
    lives: livesFor(d),
    limit: timeFor(d),
    time: 0,
    wrongFlags: 0,
    score: 0,
    done: false,
    tries: 0,
    rng,
  };
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

/** Open `i` and, from every blank (0) cell, its neighbours. Returns the cells opened. Skips flags. */
function flood(s: Pick<State, 'num' | 'nb' | 'flag'>, open: boolean[], i: number): number {
  if (open[i]) return 0;
  open[i] = true;
  let k = 1;
  const todo = [i];
  while (todo.length) {
    const j = todo.pop()!;
    if (s.num[j]) continue;
    for (const m of s.nb[j])
      if (!open[m] && !s.flag[m]) {
        open[m] = true;
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

/** Lay the mines away from the first tap, dealing again until the board needs no guess from there. */
function place(s: State, first: number) {
  const n = s.mine.length;
  const fc = first % s.cols;
  const fr = Math.floor(first / s.cols);
  const spots = [...Array(n).keys()].filter((i) => Math.abs((i % s.cols) - fc) > 1 || Math.abs(Math.floor(i / s.cols) - fr) > 1);
  for (let tries = 1; ; tries++) {
    // A very stubborn seed drops a mine now and then rather than dealing forever.
    if (tries % 400 === 0 && s.count > 1) s.count--;
    s.rng.shuffle(spots);
    s.mine.fill(false);
    for (let k = 0; k < s.count; k++) s.mine[spots[k]] = true;
    for (let i = 0; i < n; i++) s.num[i] = s.nb[i].filter((j) => s.mine[j]).length;
    s.safe = n - s.count;
    s.tries = tries;
    if (solvable(s, first)) break;
  }
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

/**
 * Tap a cell: open it (the first tap lays the mines). On an open number whose mines are all flagged,
 * open its other neighbours. A mine costs a life and stays shown.
 */
export function reveal(s: State, i: number): Events {
  const ev = none();
  if (s.done || i < 0 || s.flag[i] || s.boom[i]) return ev;
  if (!s.placed) place(s, i);
  let targets = [i];
  if (s.open[i]) {
    const { hidden, marked } = around(s, i);
    if (!s.num[i] || marked !== s.num[i]) return ev;
    targets = hidden.filter((j) => !s.flag[j]);
  }
  for (const j of targets) {
    if (s.mine[j]) {
      s.boom[j] = true;
      s.lives--;
      ev.boom = true;
      if (s.lives <= 0) {
        s.done = true;
        ev.over = true;
        return ev;
      }
      continue;
    }
    ev.opened += flood(s, s.open, j);
  }
  s.opened += ev.opened;
  s.score += ev.opened * CELL_POINTS;
  finish(s, ev);
  return ev;
}

/** Plant or lift a flag on a hidden cell. True if it changed. */
export function toggleFlag(s: State, i: number): boolean {
  if (s.done || !s.placed || i < 0 || s.open[i] || s.boom[i]) return false;
  s.flag[i] = !s.flag[i];
  if (s.flag[i] && !s.mine[i]) s.wrongFlags++;
  return true;
}

/** Mines not yet flagged or gone off (can go negative with too many flags). */
export const minesLeft = (s: State) => s.count - s.flag.filter(Boolean).length - s.boom.filter(Boolean).length;

/** Run the clock (from the start of the run; the first tap only lays the mines). */
export function tick(s: State, dt: number): Events {
  const ev = none();
  if (s.done) return ev;
  s.time += dt;
  if (s.time >= s.limit) {
    s.time = s.limit;
    s.done = true;
    ev.over = true;
  }
  return ev;
}
