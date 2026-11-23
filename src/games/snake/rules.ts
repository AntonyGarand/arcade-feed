import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { DX, DY, type Dir } from '../../kits/gesture/gesture';

export const COLS = 15;
export const ROWS = 17;
const START_LEN = 3;
/** A pellet is worth this much, plus a bonus for reaching it quickly. */
export const PELLET_POINTS = 10;
/** Fast bonus: QUICK points minus one per step taken since the last pellet. */
export const QUICK = 30;

export const goalFor = (d: Difficulty) => byLevel(d, [8, 10, 12, 14, 16]);
/** Steps per second. */
export const speedFor = (d: Difficulty) => byLevel(d, [5, 6, 7, 8, 9.5]);
/** Inner wall segments on top of the border. */
export const wallsFor = (d: Difficulty) => byLevel(d, [0, 3, 5, 7, 9]);

export interface State {
  d: Difficulty;
  /** Row-major: true = wall. */
  walls: boolean[];
  /** Cells from head to tail. */
  body: number[];
  dir: Dir;
  /** Turns waiting for the next steps (swipes can come faster than steps). */
  turns: Dir[];
  pellet: number;
  eaten: number;
  goal: number;
  /** Segments still to grow. */
  grow: number;
  steps: number;
  sinceLast: number;
  score: number;
  speed: number;
  acc: number;
  rng: Rng;
}

const idx = (c: number, r: number) => r * COLS + c;
export const START_ROW = Math.floor(ROWS / 2);

/** Every open cell reachable from `from` (flood fill). */
function reachable(walls: boolean[], from: number): number {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) {
    const i = todo.pop()!;
    for (let d = 0; d < 4; d++) {
      const c = (i % COLS) + DX[d];
      const r = Math.floor(i / COLS) + DY[d];
      const j = idx(c, r);
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS || walls[j] || seen.has(j)) continue;
      seen.add(j);
      todo.push(j);
    }
  }
  return seen.size;
}

function placePellet(s: State) {
  const taken = new Set(s.body);
  const open = [...Array(COLS * ROWS).keys()].filter((i) => !s.walls[i] && !taken.has(i));
  s.pellet = open.length ? s.rng.pick(open) : -1;
}

/** Deal a map: border, seeded inner walls (never sealing off a pocket, never on the start lane). */
export function createLevel(d: Difficulty, rng: Rng): State {
  const border = (i: number) => {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    return c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1;
  };
  const walls = [...Array(COLS * ROWS).keys()].map(border);
  const open = () => walls.filter((w) => !w).length;
  let placed = 0;
  for (let tries = 0; placed < wallsFor(d) && tries < 400; tries++) {
    const vertical = rng.chance(0.5);
    const len = rng.int(3, 5);
    const c0 = rng.int(2, COLS - 3 - (vertical ? 0 : len - 1));
    const r0 = rng.int(2, ROWS - 3 - (vertical ? len - 1 : 0));
    const cells = Array.from({ length: len }, (_, k) => (vertical ? idx(c0, r0 + k) : idx(c0 + k, r0)));
    // Keep the start lane clear and never stack walls.
    if (cells.some((i) => Math.abs(Math.floor(i / COLS) - START_ROW) <= 1 || walls[i])) continue;
    for (const i of cells) walls[i] = true;
    if (reachable(walls, idx(3, START_ROW)) !== open()) {
      for (const i of cells) walls[i] = false;
      continue;
    }
    placed++;
  }
  const body = Array.from({ length: START_LEN }, (_, k) => idx(3 - k, START_ROW));
  const s: State = {
    d,
    walls,
    body,
    dir: 1,
    turns: [],
    pellet: -1,
    eaten: 0,
    goal: goalFor(d),
    grow: 0,
    steps: 0,
    sinceLast: 0,
    score: 0,
    speed: speedFor(d),
    acc: 0,
    rng,
  };
  placePellet(s);
  return s;
}

/** Queue a turn. Reversing onto yourself or repeating the heading is ignored. */
export function turn(s: State, dir: Dir) {
  const last = s.turns.at(-1) ?? s.dir;
  if (dir === last || (dir + 2) % 4 === last || s.turns.length >= 2) return;
  s.turns.push(dir);
}

export interface StepEvents {
  moved: boolean;
  ate: boolean;
  won: boolean;
  dead: boolean;
}

/** The cell ahead of the head in direction `dir`, or -1 off the grid. */
export function ahead(s: State, dir: Dir, from = s.body[0]): number {
  const c = (from % COLS) + DX[dir];
  const r = Math.floor(from / COLS) + DY[dir];
  return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : idx(c, r);
}

/** One grid step. */
export function tick(s: State): StepEvents {
  const ev: StepEvents = { moved: true, ate: false, won: false, dead: false };
  s.dir = s.turns.shift() ?? s.dir;
  const next = ahead(s, s.dir);
  // The tail moves out of the way this step unless the snake is growing.
  const body = s.grow > 0 ? s.body : s.body.slice(0, -1);
  if (next < 0 || s.walls[next] || body.includes(next)) {
    ev.dead = true;
    return ev;
  }
  s.body.unshift(next);
  if (s.grow > 0) s.grow--;
  else s.body.pop();
  s.steps++;
  s.sinceLast++;
  if (next === s.pellet) {
    ev.ate = true;
    s.eaten++;
    s.score += PELLET_POINTS + Math.max(0, QUICK - s.sinceLast);
    s.sinceLast = 0;
    s.grow += 1;
    if (s.eaten >= s.goal) ev.won = true;
    else placePellet(s);
  }
  return ev;
}

/** Advance by `dt` seconds: as many grid steps as the speed allows. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { moved: false, ate: false, won: false, dead: false };
  s.acc += dt * s.speed;
  while (s.acc >= 1) {
    s.acc -= 1;
    const e = tick(s);
    ev.moved = true;
    ev.ate ||= e.ate;
    if (e.won || e.dead) return { ...ev, won: e.won, dead: e.dead };
  }
  return ev;
}
