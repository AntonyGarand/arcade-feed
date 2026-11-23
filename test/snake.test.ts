import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import type { Dir } from '../src/kits/gesture/gesture';
import {
  ahead,
  COLS,
  createLevel,
  goalFor,
  PELLET_POINTS,
  ROWS,
  speedFor,
  START_ROW,
  step,
  tick,
  turn,
  wallsFor,
  type State,
} from '../src/games/snake/rules';

const DIRS: Dir[] = [0, 1, 2, 3];

/** First move of a shortest path to the pellet around walls and the body (or any safe move). */
function bfsMove(s: State): Dir {
  const blocked = new Set(s.body.slice(0, -1));
  const first = new Map<number, Dir>();
  const todo: number[] = [];
  for (const d of DIRS) {
    if ((d + 2) % 4 === s.dir) continue;
    const j = ahead(s, d);
    if (j < 0 || s.walls[j] || blocked.has(j) || first.has(j)) continue;
    first.set(j, d);
    todo.push(j);
  }
  for (let k = 0; k < todo.length; k++) {
    const i = todo[k];
    if (i === s.pellet) return first.get(i)!;
    for (const d of DIRS) {
      const j = ahead(s, d, i);
      if (j < 0 || s.walls[j] || blocked.has(j) || first.has(j)) continue;
      first.set(j, first.get(i)!);
      todo.push(j);
    }
  }
  return first.values().next().value ?? s.dir;
}

function autopilot(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
  for (let i = 0; i < 5000; i++) {
    const want = bfsMove(s);
    if (want !== s.dir) turn(s, want);
    const ev = tick(s);
    if (ev.won) return { s, win: true };
    if (ev.dead) return { s, win: false };
  }
  throw new Error('never ended');
}

describe('snake rules', () => {
  it('deals the same map and pellets from the same seed', () => {
    const a = createLevel(4, new Rng(12));
    const b = createLevel(4, new Rng(12));
    expect(a.walls).toEqual(b.walls);
    expect(a.pellet).toBe(b.pellet);
    expect(autopilot(4, 12).s.steps).toBe(autopilot(4, 12).s.steps);
  });

  it('gets harder: more walls, more pellets, faster', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(wallsFor(d)).toBeGreaterThan(wallsFor(lo));
      expect(goalFor(d)).toBeGreaterThan(goalFor(lo));
      expect(speedFor(d)).toBeGreaterThan(speedFor(lo));
    }
    const border = 2 * COLS + 2 * (ROWS - 2);
    expect(createLevel(1, new Rng(1)).walls.filter(Boolean).length).toBe(border);
    expect(createLevel(5, new Rng(1)).walls.filter(Boolean).length).toBeGreaterThan(border + 20);
  });

  it('keeps the start lane open and the pellet off walls and the snake', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createLevel(5, new Rng(seed));
      for (let c = 1; c < COLS - 1; c++) expect(s.walls[START_ROW * COLS + c]).toBe(false);
      expect(s.walls[s.pellet]).toBe(false);
      expect(s.body).not.toContain(s.pellet);
    }
  });

  it('ignores a turn straight back and moves one cell per step', () => {
    const s = createLevel(1, new Rng(2));
    const head = s.body[0];
    turn(s, 3); // reverse: ignored
    step(s, 1 / speedFor(1) + 0.001);
    expect(s.body[0]).toBe(head + 1);
    turn(s, 2);
    tick(s);
    expect(s.body[0]).toBe(head + 1 + COLS);
  });

  it('is cleared by a shortest-path player at every level (it can trap itself now and then)', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed));
      expect(runs.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(5);
      for (const { s } of runs.filter((r) => r.win)) {
        expect(s.eaten).toBe(goalFor(d));
        expect(s.score).toBeGreaterThanOrEqual(goalFor(d) * PELLET_POINTS);
      }
    }
  });

  it('dies on hitting a wall', () => {
    const s = createLevel(1, new Rng(3));
    s.pellet = -1;
    let dead = false;
    for (let i = 0; i < COLS && !dead; i++) dead = tick(s).dead;
    expect(dead).toBe(true);
  });
});
