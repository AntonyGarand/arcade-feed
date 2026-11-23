import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import type { Dir } from '../src/kits/gesture/gesture';
import {
  BERRY,
  bfs,
  chasersFor,
  CHAIN,
  createLevel,
  DEN,
  DOOR,
  FIRST_OUT,
  frightFor,
  heroCan,
  heroSpeedFor,
  LIVES,
  nb,
  paceFor,
  PATH,
  pos,
  SEED_POINTS,
  seedsFor,
  sizeFor,
  step,
  steer,
  type State,
} from '../src/games/chase/rules';

const DT = 1 / 60;
const DIRS: Dir[] = [0, 1, 2, 3];

/** An independent copy of a run (the maze is shared, it never changes), for looking ahead. */
function clone(s: State): State {
  return {
    ...s,
    items: s.items.slice(),
    hero: { ...s.hero },
    chasers: s.chasers.map((c) => ({ ...c })),
    rng: Object.assign(Object.create(Rng.prototype) as Rng, s.rng),
  };
}

/** Owls that can hurt the hero (or will soon: a scare about to end). */
const hunters = (s: State) => s.chasers.filter((c) => (c.mode === 'run' || c.mode === 'leave') && (!c.fright || s.fright < 1));

/** Straight-line distance from cell `i` to the nearest hunting owl. */
function room(s: State, i: number): number {
  const x = i % s.cols;
  const y = Math.floor(i / s.cols);
  let best = 99;
  for (const c of hunters(s)) {
    const p = pos(s, c);
    let dx = Math.abs(p.x - 0.5 - x);
    if (dx > s.cols / 2) dx = s.cols - dx;
    best = Math.min(best, Math.hypot(dx, p.y - 0.5 - y));
  }
  return best;
}

/** The cell where the hero's next turn happens. */
const turnCell = (s: State) => (s.hero.moving ? nb(s, s.hero.at, s.hero.dir) : s.hero.at);

/** Look-ahead policy: at every turn, head for the open way with the most room from the owls. */
function flee(s: State) {
  const from = turnCell(s);
  let best: Dir | -1 = -1;
  for (const d of DIRS) if (heroCan(s, from, d) && (best < 0 || room(s, nb(s, from, d)) > room(s, nb(s, from, best as Dir)))) best = d;
  if (best >= 0) steer(s, best as Dir);
}

/** Does the hero survive `seconds` after `act`, fleeing at every turn? */
function survives(s0: State, act: (s: State) => void, seconds: number): boolean {
  const s = clone(s0);
  act(s);
  for (let t = 0; t < seconds; t += DT) {
    if (t > 0.3) flee(s);
    const ev = step(s, DT);
    if (ev.lostLife) return false;
    if (ev.won) return true;
  }
  return true;
}

/** Steps from the cell after `first` (taken at `from`) to the nearest seed or berry. */
function toFood(s: State, from: number, first: Dir, berries: boolean): number {
  const j = nb(s, from, first);
  if (s.items[j] && (!berries || s.items[j] === BERRY)) return 1;
  const dist = bfs(s, j, (i, k) => s.grid[k] === PATH && !(i === j && k === from));
  let best = 9999;
  for (let i = 0; i < dist.length; i++) if (dist[i] > 0 && s.items[i] && (!berries || s.items[i] === BERRY)) best = Math.min(best, dist[i]);
  return best + 1;
}

/**
 * The autopilot: once per cell, rank its moves by the shortest way to food (to a berry when an owl is
 * close), then take the best one that a short look-ahead says won't get it caught.
 */
function pilot(s: State, memo: { at: number; dir: number }) {
  const h = s.hero;
  if (s.dying > 0 || (memo.at === h.at && memo.dir === h.dir && h.moving)) return;
  memo.at = h.at;
  memo.dir = h.dir;
  const from = turnCell(s);
  const back = h.moving ? (((h.dir + 2) % 4) as Dir) : -1;
  const close = room(s, h.at) < 5 && s.fright === 0;
  const berries = close && s.items.includes(BERRY);
  const acts: { score: number; act: (x: State) => void }[] = [];
  for (const d of DIRS) {
    if (!heroCan(s, from, d) || (d === back && from !== h.at)) continue;
    acts.push({ score: toFood(s, from, d, berries), act: (x) => steer(x, d) });
  }
  if (back >= 0 && from !== h.at) acts.push({ score: toFood(s, h.at, back as Dir, berries) + 1, act: (x) => steer(x, back as Dir) });
  acts.sort((a, b) => a.score - b.score);
  const pick = acts.find((a) => survives(s, a.act, 2.5)) ?? acts[0];
  pick?.act(s);
}

function autopilot(d: Difficulty, seed: number, seconds = 400) {
  const s = createLevel(d, new Rng(seed));
  let lost = 0;
  let caught = 0;
  const memo = { at: -1, dir: -2 };
  for (let t = 0; t < seconds; t += DT) {
    pilot(s, memo);
    const ev = step(s, DT);
    if (ev.lostLife) lost++;
    caught += ev.caught.length;
    if (ev.won) return { s, win: true, lost, caught, t };
    if (ev.over) return { s, win: false, lost, caught, t };
  }
  return { s, win: false, lost, caught, t: seconds };
}

describe('chase rules', () => {
  it('deals the same maze and run from the same seed', () => {
    const a = createLevel(4, new Rng(21));
    const b = createLevel(4, new Rng(21));
    expect(a.grid).toEqual(b.grid);
    expect(a.items).toEqual(b.items);
    const ra = autopilot(4, 21);
    const rb = autopilot(4, 21);
    expect(ra.s.score).toBe(rb.s.score);
    expect(ra.t).toBe(rb.t);
    expect(createLevel(4, new Rng(22)).grid).not.toEqual(a.grid);
  });

  it('builds a connected, mirrored maze with no dead ends', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 25; seed++) {
        const s = createLevel(d, new Rng(seed));
        const open = (i: number) => s.grid[i] === PATH;
        for (let r = 0; r < s.rows; r++)
          for (let c = 0; c < s.cols; c++) expect(s.grid[r * s.cols + c]).toBe(s.grid[r * s.cols + s.cols - 1 - c]);
        const reach = bfs(s, s.start, (_, j) => open(j));
        for (let i = 0; i < s.grid.length; i++) {
          if (!open(i)) continue;
          expect(reach[i], `level ${d} seed ${seed} cell ${i}`).toBeGreaterThanOrEqual(0);
          expect(DIRS.filter((k) => heroCan(s, i, k)).length).toBeGreaterThanOrEqual(2);
        }
        // The nest opens only through its door, onto the exit cell.
        expect(s.grid[s.door]).toBe(DOOR);
        expect(s.grid[s.den]).toBe(DEN);
        expect(s.toExit[s.den]).toBe(2);
        expect(s.left).toBeGreaterThanOrEqual(seedsFor(d));
      }
  });

  it('gets harder: bigger maze, more and faster owls, shorter scares', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(sizeFor(d)[0] * sizeFor(d)[1]).toBeGreaterThan(sizeFor(lo)[0] * sizeFor(lo)[1]);
      expect(chasersFor(d)).toBeGreaterThanOrEqual(chasersFor(lo));
      expect(heroSpeedFor(d) * paceFor(d)).toBeGreaterThan(heroSpeedFor(lo) * paceFor(lo));
      expect(frightFor(d)).toBeLessThan(frightFor(lo));
      expect(seedsFor(d)).toBeGreaterThan(seedsFor(lo));
    }
    expect(createLevel(5, new Rng(1)).total).toBeGreaterThan(createLevel(1, new Rng(1)).total);
  });

  it('waits for the first turn, then runs and eats seeds; owls stay home for the first seconds', () => {
    const s = createLevel(2, new Rng(4));
    step(s, 2);
    expect(s.hero.at).toBe(s.start);
    expect(s.chasers.every((c) => c.mode === 'den')).toBe(true);
    const way = DIRS.find((d) => heroCan(s, s.start, d))!;
    steer(s, way);
    let seeds = 0;
    for (let k = 0; k < 30; k++) seeds += step(s, DT).seeds;
    expect(s.hero.at).not.toBe(s.start);
    expect(seeds).toBeGreaterThan(0);
    expect(s.score).toBe(seeds * SEED_POINTS);
    step(s, FIRST_OUT);
    expect(s.chasers.some((c) => c.mode !== 'den')).toBe(true);
  });

  it('turns straight back at once and buffers other turns', () => {
    const s = createLevel(1, new Rng(9));
    const h = s.hero;
    const way = DIRS.find((d) => heroCan(s, s.start, d))!;
    steer(s, way);
    step(s, 0.1);
    const was = h.at;
    steer(s, ((way + 2) % 4) as Dir);
    expect(h.dir).toBe((way + 2) % 4);
    expect(h.at).toBe(nb(s, was, way));
  });

  it('scares the owls with a berry, and catching them chains 200, 400…', () => {
    const s = createLevel(1, new Rng(5));
    step(s, 1);
    // Let the owls out at the exit, heading up.
    for (const o of s.chasers) Object.assign(o, { mode: 'run', at: s.exit, dir: 0, moving: true, f: 0 });
    const owls = s.chasers;
    // Put the hero next to a berry and eat it.
    const b = s.items.indexOf(BERRY);
    const d = DIRS.find((k) => heroCan(s, b, k))!;
    Object.assign(s.hero, { at: nb(s, b, d), dir: (d + 2) % 4, moving: true, f: 0.95, want: -1 });
    expect(step(s, DT).berry).toBe(true);
    expect(s.fright).toBeGreaterThan(0);
    expect(owls.every((c) => c.fright)).toBe(true);
    // Drop the hero onto the first scared owl.
    const o = owls[0];
    Object.assign(s.hero, { at: o.at, moving: false, f: 0 });
    Object.assign(o, { f: 0 });
    const ev = step(s, DT);
    expect(ev.caught[0]?.points).toBe(CHAIN[0]);
    expect(o.mode).toBe('eyes');
  });

  for (const d of LEVELS)
    it(`is cleared by an autopilot at level ${d}, for several seeds`, () => {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed));
      const wins = runs.filter((r) => r.win);
      expect(wins.length, runs.map((r) => `${r.win ? 'W' : 'L'}${r.lost}/${r.caught}/${Math.round(r.t)}s/${r.s.score}`).join(' ')).toBe(6);
      for (const { s } of wins) {
        expect(s.left).toBe(0);
        expect(s.score).toBeGreaterThanOrEqual(s.total * SEED_POINTS);
      }
    }, 30_000);

  it('loses every life when the hero never moves', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(d + 30));
      let lost = 0;
      let firstHit = 0;
      let over = false;
      for (let t = 0; t < 240 && !over; t += DT) {
        const ev = step(s, DT);
        if (ev.lostLife) firstHit ||= s.time;
        if (ev.lostLife) lost++;
        over = ev.over;
      }
      expect(over, `level ${d}`).toBe(true);
      expect(lost).toBe(LIVES);
      // Nobody lands a hit in the first seconds.
      expect(firstHit).toBeGreaterThan(FIRST_OUT);
      expect(s.hero.at).toBe(s.start);
    }
  });
});
