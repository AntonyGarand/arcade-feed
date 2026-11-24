import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';
import { DX, DY, type Dir } from '../../kits/gesture/gesture';

export const COLS = 15;
export const ROWS = 17;
const START_LEN = 3;
/** A pellet is worth this much, plus a bonus for reaching it quickly. */
export const PELLET_POINTS = 10;
/** Fast bonus: QUICK points minus one per step taken since the last pellet. */
export const QUICK = 30;
/** A golden pellet: worth this much, gone after `GOLD_STEPS` steps. It doesn't count towards the goal. */
export const GOLD_POINTS = 40;
export const GOLD_STEPS = 26;
/** A natural golden pellet shows up after every `GOLD_EVERY` pellets eaten. */
const GOLD_EVERY = 4;
/** Pellets (golden ones too) eaten within this many steps of each other keep a chain going. */
export const CHAIN_STEPS = 16;
/** Chain lengths that fire an event: golden pellet, slow-mo, ghost, then a feast (golden + slow-mo). */
export const CHAIN_TIERS = [3, 5, 8, 12] as const;
/** Seconds of slow motion, and the speed factor while it runs. */
const SLOW_S = 6;
const SLOW_K = 0.6;
/** Steps of ghost: the snake slips through inner walls, beetles and itself. */
export const GHOST_STEPS = 30;
/** Points for squashing a beetle as a ghost. */
export const BEETLE_POINTS = 25;

export const goalFor = (d: Difficulty) => byLevel(d, [8, 10, 12, 14, 16]);
/** Steps per second. */
export const speedFor = (d: Difficulty) => byLevel(d, [5, 6, 7, 8, 9.5]);
/** Inner wall segments on top of the border (classic maps). */
export const wallsFor = (d: Difficulty) => byLevel(d, [0, 3, 5, 7, 9]);

/** The kinds of map a level can deal. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'maze', min: 2 },
  { id: 'portals' },
  { id: 'runaway', min: 2 },
  { id: 'beetles', min: 3 },
  { id: 'shrink', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** What a chain milestone unlocks. */
export type Perk = 'gold' | 'slow' | 'ghost' | 'feast';
const PERKS: readonly Perk[] = ['gold', 'slow', 'ghost', 'feast'];

/** A beetle crawling back and forth along a line: running into it ends the run. */
interface Beetle {
  at: number;
  dir: Dir;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  /** Row-major: true = wall. */
  walls: boolean[];
  /** Portal cells in pairs: entering `portals[2k]` comes out next to `portals[2k + 1]` and back. */
  portals: number[];
  beetles: Beetle[];
  /** Cells from head to tail. */
  body: number[];
  dir: Dir;
  /** Turns waiting for the next steps (swipes can come faster than steps). */
  turns: Dir[];
  pellet: number;
  /** Golden pellet cell (-1: none) and the steps it has left. */
  gold: number;
  goldLeft: number;
  eaten: number;
  goal: number;
  /** Segments still to grow. */
  grow: number;
  steps: number;
  sinceLast: number;
  /** Pellets eaten in a quick chain, steps since the last one, and milestones reached. */
  chain: number;
  sinceChain: number;
  tier: number;
  /** Seconds of slow motion left; steps of ghost left. */
  slow: number;
  ghost: number;
  /** Rings the arena has closed in by (shrink maps), and the pellet counts that close the next ones. */
  ring: number;
  shrinkAt: number[];
  score: number;
  speed: number;
  acc: number;
  rng: Rng;
}

const idx = (c: number, r: number) => r * COLS + c;
export const START_ROW = Math.floor(ROWS / 2);
const START = idx(3, START_ROW);
/** How deep a cell sits from the outer edge (0: the border). */
const depth = (i: number) => Math.min(i % COLS, Math.floor(i / COLS), COLS - 1 - (i % COLS), ROWS - 1 - Math.floor(i / COLS));
const manhattan = (a: number, b: number) => Math.abs((a % COLS) - (b % COLS)) + Math.abs(Math.floor(a / COLS) - Math.floor(b / COLS));
const inStartLane = (i: number) => Math.abs(Math.floor(i / COLS) - START_ROW) <= 1;
const neighbour = (i: number, dir: Dir) => {
  const c = (i % COLS) + DX[dir];
  const r = Math.floor(i / COLS) + DY[dir];
  return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : idx(c, r);
};

/** Every open cell reachable from `from` (flood fill). */
function reachable(walls: boolean[], from: number): number {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) {
    const i = todo.pop()!;
    for (let d = 0; d < 4; d++) {
      const j = neighbour(i, d as Dir);
      if (j < 0 || walls[j] || seen.has(j)) continue;
      seen.add(j);
      todo.push(j);
    }
  }
  return seen.size;
}
const connected = (walls: boolean[]) => reachable(walls, START) === walls.filter((w) => !w).length;

/** Cells nothing stands on: no wall, snake, portal, beetle or other pellet (and inside the closing ring). */
function freeCells(s: State): number[] {
  const taken = new Set([...s.body, ...s.portals, ...s.beetles.map((b) => b.at), s.pellet, s.gold]);
  return [...Array(COLS * ROWS).keys()].filter((i) => !s.walls[i] && !taken.has(i) && depth(i) > s.ring);
}

function placePellet(s: State) {
  s.pellet = -1;
  const open = freeCells(s);
  s.pellet = open.length ? s.rng.pick(open) : -1;
}

/** Put a golden pellet down (if there isn't one yet), away from the head. */
function placeGold(s: State) {
  if (s.gold >= 0) return;
  const head = s.body[0];
  const far = freeCells(s).filter((i) => manhattan(i, head) >= 4);
  if (!far.length) return;
  s.gold = s.rng.pick(far);
  s.goldLeft = GOLD_STEPS;
}

/** Random wall segments (never sealing off a pocket, never on the start lane), only `deep` cells in. */
function scatterWalls(walls: boolean[], rng: Rng, count: number, deep = 2) {
  let placed = 0;
  for (let tries = 0; placed < count && tries < 400; tries++) {
    const vertical = rng.chance(0.5);
    const len = rng.int(3, 5);
    const c0 = rng.int(deep, COLS - 1 - deep - (vertical ? 0 : len - 1));
    const r0 = rng.int(deep, ROWS - 1 - deep - (vertical ? len - 1 : 0));
    const cells = Array.from({ length: len }, (_, k) => (vertical ? idx(c0, r0 + k) : idx(c0 + k, r0)));
    if (cells.some((i) => inStartLane(i) || walls[i])) continue;
    for (const i of cells) walls[i] = true;
    if (!connected(walls)) {
      for (const i of cells) walls[i] = false;
      continue;
    }
    placed++;
  }
}

/** A symmetric maze of bars, pillars or corner hooks (mirrored left-right and top-bottom). */
function mazeWalls(walls: boolean[], rng: Rng, d: Difficulty) {
  const quarter: [number, number][] = rng.pick([
    // Bars: a vertical and a horizontal one per quarter.
    [
      [4, 2],
      [4, 3],
      [4, 4],
      [4, 5],
      [6, 4],
      [7, 4],
    ],
    // Pillars on a grid.
    [
      [3, 3],
      [6, 3],
      [3, 6],
      [6, 6],
      [5, 2],
    ],
    // Corner hooks.
    [
      [3, 3],
      [4, 3],
      [5, 3],
      [3, 4],
      [3, 5],
      [6, 6],
    ],
  ]);
  // Harder levels add a pillar row next to the start lane.
  if (d >= 4) quarter.push([5, 5]);
  for (const [c, r] of quarter)
    for (const cc of [c, COLS - 1 - c]) for (const rr of [r, ROWS - 1 - r]) if (!inStartLane(idx(cc, rr))) walls[idx(cc, rr)] = true;
}

/** Deal a map: border, seeded inner walls and the kind's twist (portals, beetles…), all from the seed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const walls = [...Array(COLS * ROWS).keys()].map((i) => depth(i) === 0);
  if (kind === 'maze') {
    mazeWalls(walls, rng, d);
    if (!connected(walls)) for (let i = 0; i < walls.length; i++) walls[i] = depth(i) === 0;
  } else if (kind === 'portals' || kind === 'runaway') scatterWalls(walls, rng, Math.max(0, wallsFor(d) - 2));
  else if (kind === 'beetles') scatterWalls(walls, rng, Math.max(0, wallsFor(d) - 4));
  else if (kind === 'shrink') scatterWalls(walls, rng, Math.max(0, wallsFor(d) - 7), 4);
  else scatterWalls(walls, rng, wallsFor(d));

  const body = Array.from({ length: START_LEN }, (_, k) => idx(3 - k, START_ROW));
  const goal = goalFor(d);
  const s: State = {
    d,
    kind,
    walls,
    portals: [],
    beetles: [],
    body,
    dir: 1,
    turns: [],
    pellet: -1,
    gold: -1,
    goldLeft: 0,
    eaten: 0,
    goal,
    grow: 0,
    steps: 0,
    sinceLast: 0,
    chain: 0,
    sinceChain: 0,
    tier: 0,
    slow: 0,
    ghost: 0,
    ring: 0,
    // Shrinking maps close in once (twice from level 5) as pellets are eaten.
    shrinkAt: kind !== 'shrink' ? [] : d >= 5 ? [Math.round(goal / 3), Math.round((goal * 2) / 3)] : [Math.round(goal / 2)],
    score: 0,
    speed: speedFor(d),
    acc: 0,
    rng,
  };

  if (kind === 'portals') {
    // Portals sit in open cells whose four neighbours are open too, off the start lane, apart.
    const pairs = d >= 3 ? 2 : 1;
    const spots = rng.shuffle(
      [...Array(COLS * ROWS).keys()].filter(
        (i) => !walls[i] && depth(i) >= 2 && !inStartLane(i) && ([0, 1, 2, 3] as Dir[]).every((k) => !walls[neighbour(i, k)]),
      ),
    );
    for (const i of spots) {
      if (s.portals.length >= pairs * 2) break;
      // At least 3 cells from any other portal, and a pair's two ends far apart.
      const partner = s.portals.length % 2 ? s.portals.at(-1)! : -1;
      if (s.portals.some((p) => manhattan(p, i) < 3) || (partner >= 0 && manhattan(partner, i) < 8)) continue;
      s.portals.push(i);
    }
    if (s.portals.length % 2) s.portals.pop();
  }

  if (kind === 'beetles') {
    // Each beetle patrols a stretch of open cells, off the start lane.
    const count = byLevel(d, [1, 1, 2, 2, 2]);
    const spots = rng.shuffle(
      [...Array(COLS * ROWS).keys()].filter((i) => !walls[i] && depth(i) >= 2 && Math.abs(Math.floor(i / COLS) - START_ROW) >= 3),
    );
    for (const at of spots) {
      if (s.beetles.length >= count) break;
      if (s.beetles.some((b) => manhattan(b.at, at) < 5)) continue;
      s.beetles.push({ at, dir: rng.pick([0, 1, 2, 3] as Dir[]) });
    }
  }

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
  /** A golden pellet was eaten, or ran out uneaten. */
  goldAte: boolean;
  goldGone: boolean;
  /** Went through a portal this step (the portal cell entered). */
  warped: number;
  /** The pellet hopped away (runaway maps). */
  hopped: boolean;
  /** A beetle squashed by a ghost (its cell), or -1. */
  squashed: number;
  /** The arena closed in by one ring. */
  shrank: boolean;
  /** Chain length after this step's bite (0: no bite), and a milestone reached with what it unlocked. */
  chain: number;
  tier: number;
  perk: Perk | null;
  /** The chain ran out (after at least 2). */
  chainEnd: boolean;
  won: boolean;
  dead: boolean;
}

const noEvents = (): StepEvents => ({
  moved: false,
  ate: false,
  goldAte: false,
  goldGone: false,
  warped: -1,
  hopped: false,
  squashed: -1,
  shrank: false,
  chain: 0,
  tier: 0,
  perk: null,
  chainEnd: false,
  won: false,
  dead: false,
});

/**
 * The cell the head lands on moving `dir` from `from`, or -1 off the grid. Walking into a portal comes
 * out on the far side of its partner.
 */
export function ahead(s: State, dir: Dir, from = s.body[0]): number {
  const j = neighbour(from, dir);
  const p = j < 0 ? -1 : s.portals.indexOf(j);
  return p < 0 ? j : neighbour(s.portals[p ^ 1], dir);
}

/** Turn on what a chain milestone unlocks. */
export function grant(s: State, perk: Perk) {
  if (perk === 'gold' || perk === 'feast') placeGold(s);
  if (perk === 'slow' || perk === 'feast') s.slow = SLOW_S;
  if (perk === 'ghost') s.ghost = GHOST_STEPS;
}

/** One bite (pellet or golden): counts the chain and fires its milestones. */
function bite(s: State, ev: StepEvents) {
  s.chain = s.chain > 0 && s.sinceChain <= CHAIN_STEPS ? s.chain + 1 : 1;
  s.sinceChain = 0;
  ev.chain = s.chain;
  if (s.tier < CHAIN_TIERS.length && s.chain >= CHAIN_TIERS[s.tier]) {
    const perk = PERKS[s.tier];
    s.tier++;
    ev.tier = s.tier;
    ev.perk = perk;
    grant(s, perk);
  }
}

/**
 * Close the arena in by one ring: every free cell on it becomes wall, except under the snake and
 * right around its head (so it always has a way inwards); the pellets move inside.
 */
function shrink(s: State, ev: StepEvents) {
  s.ring++;
  const body = new Set(s.body);
  const head = s.body[0];
  for (let i = 0; i < s.walls.length; i++) if (depth(i) === s.ring && !body.has(i) && manhattan(i, head) > 2) s.walls[i] = true;
  s.beetles = s.beetles.filter((b) => !s.walls[b.at]);
  if (s.pellet >= 0 && depth(s.pellet) <= s.ring) placePellet(s);
  if (s.gold >= 0 && depth(s.gold) <= s.ring) s.gold = -1;
  ev.shrank = true;
}

/** Runaway pellets: when the head comes close, hop to the open neighbour farthest from it. */
function hop(s: State, ev: StepEvents) {
  if (s.kind !== 'runaway' || s.pellet < 0 || s.steps % 3) return;
  const head = s.body[0];
  const dist = (i: number) => manhattan(i, head);
  if (dist(s.pellet) > 4) return;
  const taken = new Set([...s.body, s.gold]);
  let best = s.pellet;
  for (let k = 0; k < 4; k++) {
    const j = neighbour(s.pellet, k as Dir);
    if (j < 0 || s.walls[j] || taken.has(j) || depth(j) <= s.ring) continue;
    if (dist(j) > dist(best)) best = j;
  }
  if (best !== s.pellet) {
    s.pellet = best;
    ev.hopped = true;
  }
}

/**
 * Beetles take a step every other tick, turning back when blocked. They never walk onto a pellet, into
 * the snake or right next to its head, so a beetle never cuts in front of you without warning.
 */
function crawl(s: State) {
  if (s.steps % 2) return;
  const head = s.body[0];
  const body = new Set(s.body);
  for (const b of s.beetles) {
    for (const dir of [b.dir, ((b.dir + 2) % 4) as Dir]) {
      const j = neighbour(b.at, dir);
      if (
        j < 0 ||
        j === s.pellet ||
        j === s.gold ||
        s.walls[j] ||
        body.has(j) ||
        manhattan(j, head) <= 1 ||
        s.portals.includes(j) ||
        s.beetles.some((o) => o.at === j)
      )
        continue;
      b.at = j;
      b.dir = dir;
      break;
    }
  }
}

/** One grid step. */
export function tick(s: State): StepEvents {
  const ev = noEvents();
  ev.moved = true;
  s.dir = s.turns.shift() ?? s.dir;
  const raw = neighbour(s.body[0], s.dir);
  const next = ahead(s, s.dir);
  // The tail moves out of the way this step unless the snake is growing.
  const body = s.grow > 0 ? s.body : s.body.slice(0, -1);
  const ghost = s.ghost > 0;
  const beetle = s.beetles.findIndex((b) => b.at === next);
  const inner = next >= 0 && depth(next) > s.ring;
  if (next < 0 || (s.walls[next] && !(ghost && inner)) || (!ghost && (body.includes(next) || beetle >= 0))) {
    ev.dead = true;
    return ev;
  }
  if (next !== raw) ev.warped = raw;
  if (beetle >= 0) {
    s.beetles.splice(beetle, 1);
    s.score += BEETLE_POINTS;
    ev.squashed = next;
  }
  s.body.unshift(next);
  if (s.grow > 0) s.grow--;
  else s.body.pop();
  s.steps++;
  s.sinceLast++;
  s.sinceChain++;
  if (s.ghost > 0) s.ghost--;
  if (next === s.gold) {
    ev.goldAte = true;
    s.score += GOLD_POINTS;
    s.gold = -1;
    s.grow += 1;
    bite(s, ev);
  } else if (s.gold >= 0 && --s.goldLeft <= 0) {
    s.gold = -1;
    ev.goldGone = true;
  }
  if (next === s.pellet) {
    ev.ate = true;
    s.eaten++;
    s.score += PELLET_POINTS + Math.max(0, QUICK - s.sinceLast);
    s.sinceLast = 0;
    s.grow += 1;
    if (s.eaten >= s.goal) {
      ev.won = true;
      return ev;
    }
    bite(s, ev);
    if (s.shrinkAt[s.ring] === s.eaten) shrink(s, ev);
    placePellet(s);
    if (s.eaten % GOLD_EVERY === 0) placeGold(s);
  }
  if (!ev.chain && s.chain && s.sinceChain > CHAIN_STEPS) {
    ev.chainEnd = s.chain >= 2;
    s.chain = s.tier = 0;
  }
  hop(s, ev);
  crawl(s);
  return ev;
}

/** Advance by `dt` seconds: as many grid steps as the speed allows (fewer in slow motion). */
export function step(s: State, dt: number): StepEvents {
  const ev = noEvents();
  s.acc += dt * s.speed * (s.slow > 0 ? SLOW_K : 1);
  s.slow = Math.max(0, s.slow - dt);
  while (s.acc >= 1) {
    s.acc -= 1;
    const e = tick(s);
    ev.moved = true;
    ev.ate ||= e.ate;
    ev.goldAte ||= e.goldAte;
    ev.goldGone ||= e.goldGone;
    ev.hopped ||= e.hopped;
    ev.shrank ||= e.shrank;
    ev.chainEnd ||= e.chainEnd;
    if (e.warped >= 0) ev.warped = e.warped;
    if (e.squashed >= 0) ev.squashed = e.squashed;
    if (e.chain) ev.chain = e.chain;
    if (e.tier) {
      ev.tier = e.tier;
      ev.perk = e.perk;
    }
    if (e.won || e.dead) return { ...ev, won: e.won, dead: e.dead };
  }
  return ev;
}
