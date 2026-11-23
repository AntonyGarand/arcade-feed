import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import type { Dir } from '../../kits/gesture/gesture';

/** Warehouse side in cells, outer wall included. */
export const sizeFor = (d: Difficulty) => byLevel(d, [7, 7, 8, 8, 9]);
export const cratesFor = (d: Difficulty) => byLevel(d, [1, 2, 2, 3, 3]);
/** Spare moves on top of the shortest solution. */
export const slackFor = (d: Difficulty) => byLevel(d, [24, 20, 16, 12, 10]);
/** Fewest pushes the shortest solution must need, so no level is trivial. */
export const minPushesFor = (d: Difficulty) => byLevel(d, [4, 6, 8, 10, 12]);
/** Longest shortest solution (moves), so a level fits in a card. */
const maxMovesFor = (d: Difficulty) => byLevel(d, [30, 45, 60, 75, 90]);
/** Inner wall blocks scattered in the room. */
const blocksFor = (d: Difficulty) => byLevel(d, [2, 3, 5, 6, 8]);

/** Points per crate on its goal (live, so the header moves as you play). */
export const CRATE_POINTS = 100;
export const CLEAR_BONUS = 300;
/** Points per move left at the end. */
export const MOVE_POINTS = 25;
/** States the solver may visit before a layout is thrown away as too open. */
const SOLVER_CAP = 120_000;

const DIRS: Dir[] = [0, 1, 2, 3];

interface Snapshot {
  player: number;
  crates: number[];
  moves: number;
  facing: Dir;
}

export interface State {
  d: Difficulty;
  n: number;
  wall: boolean[];
  goal: boolean[];
  crates: number[];
  player: number;
  /** Direction the keeper last moved (for drawing). */
  facing: Dir;
  /** Moves made and allowed. */
  moves: number;
  limit: number;
  /** Length of the shortest solution, and the solution itself. */
  best: number;
  solution: Dir[];
  pushes: number;
  start: Snapshot;
  history: Snapshot[];
  score: number;
  done: boolean;
}

/** What a move changed. */
export interface MoveResult {
  moved: boolean;
  pushed: boolean;
  /** A crate just landed on a goal. */
  placed: boolean;
  won: boolean;
  over: boolean;
}

const step = (n: number, i: number, d: Dir) => i + (d === 1 ? 1 : d === 3 ? -1 : d === 2 ? n : -n);

/** Cells a crate can stand on and still be pushed to some goal (simple deadlock check). */
function liveCells(n: number, wall: boolean[], goal: boolean[]): boolean[] {
  const live = goal.map(Boolean);
  const todo = live.flatMap((g, i) => (g ? [i] : []));
  while (todo.length) {
    const y = todo.pop()!;
    for (const d of DIRS) {
      // A crate at x reaches y by a push in d: x = y - d, with the keeper behind it at x - d.
      const back = ((d + 2) % 4) as Dir;
      const x = step(n, y, back);
      const k = step(n, x, back);
      if (live[x] || wall[x] || k < 0 || k >= wall.length || wall[k]) continue;
      live[x] = true;
      todo.push(x);
    }
  }
  return live;
}

/**
 * Shortest solution in moves (walks and pushes alike), by breadth-first search over keeper + crate
 * positions; pushes onto dead cells are pruned. Null if unsolvable or the search grows past `cap`.
 */
export function solve(
  n: number,
  wall: boolean[],
  goal: boolean[],
  crates: readonly number[],
  player: number,
  cap = SOLVER_CAP,
): Dir[] | null {
  const live = liveCells(n, wall, goal);
  const size = n * n;
  const keyOf = (p: number, cs: readonly number[]) => cs.reduce((k, c) => k * size + c, 0) * size + p;
  const first = [...crates].sort((a, b) => a - b);
  const states: { p: number; cs: number[]; from: number; dir: Dir }[] = [{ p: player, cs: first, from: -1, dir: 0 }];
  const seen = new Set<number>([keyOf(player, first)]);
  for (let at = 0; at < states.length; at++) {
    const { p, cs } = states[at];
    if (cs.every((c) => goal[c])) {
      const path: Dir[] = [];
      for (let k = at; states[k].from >= 0; k = states[k].from) path.push(states[k].dir);
      return path.reverse();
    }
    if (states.length > cap) return null;
    for (const d of DIRS) {
      const np = step(n, p, d);
      if (wall[np]) continue;
      let next = cs;
      const hit = cs.indexOf(np);
      if (hit >= 0) {
        const nc = step(n, np, d);
        if (wall[nc] || !live[nc] || cs.includes(nc)) continue;
        next = [...cs];
        next[hit] = nc;
        next.sort((a, b) => a - b);
      }
      const key = keyOf(np, next);
      if (seen.has(key)) continue;
      seen.add(key);
      states.push({ p: np, cs: next, from: at, dir: d });
    }
  }
  return null;
}

/** Pushes in a solution played from a position. */
function countPushes(n: number, crates: readonly number[], player: number, path: readonly Dir[]): number {
  const cs = [...crates];
  let p = player;
  let pushes = 0;
  for (const d of path) {
    p = step(n, p, d);
    const hit = cs.indexOf(p);
    if (hit >= 0) {
      cs[hit] = step(n, p, d);
      pushes++;
    }
  }
  return pushes;
}

/** Floor cells reachable from `from`, walking around walls (and `blocked` cells). */
function reach(n: number, wall: boolean[], from: number, blocked: readonly number[] = []): boolean[] {
  const seen = wall.map(() => false);
  seen[from] = true;
  const todo = [from];
  while (todo.length) {
    const i = todo.pop()!;
    for (const d of DIRS) {
      const j = step(n, i, d);
      if (!wall[j] && !seen[j] && !blocked.includes(j)) {
        seen[j] = true;
        todo.push(j);
      }
    }
  }
  return seen;
}

/** A walled room with a few inner blocks; every floor cell reachable. */
function room(n: number, blocks: number, rng: Rng): boolean[] {
  for (;;) {
    const wall = Array.from({ length: n * n }, (_, i) => i % n === 0 || i % n === n - 1 || i < n || i >= n * (n - 1));
    for (let b = 0; b < blocks; b++) {
      const c = rng.int(1, n - 2);
      const r = rng.int(1, n - 2);
      wall[r * n + c] = true;
      // Some blocks are two cells long.
      if (rng.chance(0.5)) {
        const d = rng.pick(DIRS);
        const j = step(n, r * n + c, d);
        if (j % n > 0 && j % n < n - 1 && j > n && j < n * (n - 1)) wall[j] = true;
      }
    }
    const floor = wall.flatMap((w, i) => (w ? [] : [i]));
    if (floor.length < (n - 2) * (n - 2) * 0.6) continue;
    const seen = reach(n, wall, floor[0]);
    if (floor.every((i) => seen[i])) return wall;
  }
}

/**
 * Deal a level by playing backwards: crates start on their goals and the keeper wanders, pulling a
 * crate behind them now and then. Whatever comes out is solvable by pushing them back; the solver then
 * finds the shortest way (which sets the move limit), and layouts that are too easy or too long are
 * dealt again.
 */
export function createLevel(d: Difficulty, rng: Rng): State {
  const n = sizeFor(d);
  const k = cratesFor(d);
  for (;;) {
    const wall = room(n, blocksFor(d), rng);
    const floor = wall.flatMap((w, i) => (w ? [] : [i]));
    const goals = rng.shuffle([...floor]).slice(0, k);
    const goal = wall.map((_, i) => goals.includes(i));
    for (let tryWalk = 0; tryWalk < 6; tryWalk++) {
      const crates = [...goals];
      let p = rng.pick(floor.filter((i) => !goal[i]));
      for (let t = 0; t < 80 + 80 * k; t++) {
        const dir = rng.pick(DIRS);
        const np = step(n, p, dir);
        if (wall[np] || crates.includes(np)) continue;
        const behind = crates.indexOf(step(n, p, ((dir + 2) % 4) as Dir));
        if (behind >= 0 && rng.chance(0.8)) crates[behind] = p;
        p = np;
      }
      if (crates.some((c) => goal[c])) continue;
      const solution = solve(n, wall, goal, crates, p);
      if (!solution || solution.length > maxMovesFor(d)) continue;
      const pushes = countPushes(n, crates, p, solution);
      if (pushes < minPushesFor(d)) continue;
      // Floor the keeper can never reach is drawn (and treated) as wall.
      const open = reach(n, wall, p, []);
      const sealed = wall.map((w, i) => w || !open[i]);
      const start: Snapshot = { player: p, crates: [...crates], moves: 0, facing: 2 };
      return {
        d,
        n,
        wall: sealed,
        goal,
        crates,
        player: p,
        facing: 2,
        moves: 0,
        limit: solution.length + slackFor(d),
        best: solution.length,
        solution,
        pushes,
        start,
        history: [],
        score: 0,
        done: false,
      };
    }
  }
}

export const onGoal = (s: State) => s.crates.filter((c) => s.goal[c]).length;

const snapshot = (s: State): Snapshot => ({ player: s.player, crates: [...s.crates], moves: s.moves, facing: s.facing });

function load(s: State, snap: Snapshot) {
  s.player = snap.player;
  s.crates = [...snap.crates];
  s.moves = snap.moves;
  s.facing = snap.facing;
  s.score = onGoal(s) * CRATE_POINTS;
}

/** Step the keeper one cell, pushing a crate if one is in the way (never pulling). */
export function move(s: State, dir: Dir, record = true): MoveResult {
  const res: MoveResult = { moved: false, pushed: false, placed: false, won: false, over: false };
  if (s.done) return res;
  s.facing = dir;
  const np = step(s.n, s.player, dir);
  if (s.wall[np]) return res;
  const hit = s.crates.indexOf(np);
  if (hit >= 0) {
    const nc = step(s.n, np, dir);
    if (s.wall[nc] || s.crates.includes(nc)) return res;
    if (record) s.history.push(snapshot(s));
    s.crates[hit] = nc;
    res.pushed = true;
    res.placed = s.goal[nc] && !s.goal[np];
  } else if (record) s.history.push(snapshot(s));
  s.player = np;
  s.moves++;
  res.moved = true;
  s.score = onGoal(s) * CRATE_POINTS;
  if (onGoal(s) === s.crates.length) {
    s.score += CLEAR_BONUS + (s.limit - s.moves) * MOVE_POINTS;
    s.done = true;
    res.won = true;
  } else if (s.moves >= s.limit) {
    s.done = true;
    res.over = true;
  }
  return res;
}

/** Walk along `path` as one undoable action (a tap to walk). Stops at the first blocked step. */
export function walk(s: State, path: readonly Dir[]): MoveResult {
  const snap = snapshot(s);
  let res: MoveResult = { moved: false, pushed: false, placed: false, won: false, over: false };
  for (const d of path) {
    res = move(s, d, false);
    if (!res.moved || s.done) break;
  }
  if (s.moves !== snap.moves) s.history.push(snap);
  return res;
}

/** Take back the last action. Undo is free: the moves it made are given back. */
export function undo(s: State): boolean {
  const snap = s.history.pop();
  if (!snap || s.done) return false;
  load(s, snap);
  return true;
}

/** Back to the start (the moves come back too; it can be undone). */
export function restart(s: State): boolean {
  if (s.done || !s.moves) return false;
  s.history.push(snapshot(s));
  load(s, s.start);
  return true;
}

/** Shortest walk to `to` around walls and crates (no pushing), or null if there is none. */
export function pathTo(s: State, to: number): Dir[] | null {
  if (to === s.player) return [];
  if (to < 0 || s.wall[to] || s.crates.includes(to)) return null;
  const from = new Map<number, [number, Dir]>([[s.player, [-1, 0]]]);
  const todo = [s.player];
  for (let at = 0; at < todo.length; at++) {
    const i = todo[at];
    for (const d of DIRS) {
      const j = step(s.n, i, d);
      if (s.wall[j] || s.crates.includes(j) || from.has(j)) continue;
      from.set(j, [i, d]);
      if (j === to) {
        const path: Dir[] = [];
        for (let k = j; k !== s.player; k = from.get(k)![0]) path.push(from.get(k)![1]);
        return path.reverse();
      }
      todo.push(j);
    }
  }
  return null;
}

/** The direction from the keeper to a neighbouring cell, or -1. */
export function dirTo(s: State, to: number): Dir | -1 {
  for (const d of DIRS) if (step(s.n, s.player, d) === to) return d;
  return -1;
}
