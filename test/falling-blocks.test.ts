import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import {
  COLS,
  createLevel,
  dropDistance,
  fits,
  GARBAGE,
  garbageFor,
  goalFor,
  gravityFor,
  hardDrop,
  move,
  rotate,
  ROWS,
  shapeCells,
  step,
  type State,
} from '../src/games/falling-blocks/rules';

/** Board quality after a placement: fewer holes, lower and flatter is better, cleared lines best. */
function evaluate(grid: number[], lines: number): number {
  let holes = 0;
  let agg = 0;
  let bump = 0;
  let prev = -1;
  for (let c = 0; c < COLS; c++) {
    let h = 0;
    let seen = false;
    for (let r = 0; r < ROWS; r++) {
      const filled = grid[r * COLS + c] >= 0;
      if (filled && !seen) {
        seen = true;
        h = ROWS - r;
      } else if (!filled && seen) holes++;
    }
    agg += h;
    if (prev >= 0) bump += Math.abs(h - prev);
    prev = h;
  }
  return lines * 0.76 - agg * 0.51 - holes * 0.36 - bump * 0.18;
}

/** Place the current piece at the best rotation and column (straight drop), returns the hard-drop events. */
function placeBest(s: State) {
  let best = { rot: 0, x: s.piece.x, v: -Infinity };
  for (let rot = 0; rot < 4; rot++)
    for (let x = -2; x < COLS; x++) {
      const p = { ...s.piece, rot, x };
      if (!fits(s, p)) continue;
      const c = structuredClone({ ...s, rng: undefined }) as unknown as State;
      c.piece = p;
      c.piece.y += dropDistance(c);
      for (const [cx, cy] of shapeCells(p.k, rot)) if (c.piece.y + cy >= 0) c.grid[(c.piece.y + cy) * COLS + x + cx] = p.k;
      const full = [...Array(ROWS).keys()].filter((r) => c.grid.slice(r * COLS, r * COLS + COLS).every((v) => v >= 0));
      for (const r of full) {
        c.grid.splice(r * COLS, COLS);
        c.grid.unshift(...Array<number>(COLS).fill(-1));
      }
      const v = evaluate(c.grid, full.length);
      if (v > best.v) best = { rot, x, v };
    }
  s.piece = { ...s.piece, rot: best.rot, x: best.x };
  return hardDrop(s);
}

function autopilot(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
  for (let i = 0; i < 1000; i++) {
    const ev = placeBest(s);
    if (ev.won) return { s, win: true, pieces: i + 1 };
    if (ev.over) return { s, win: false, pieces: i + 1 };
  }
  throw new Error('never ended');
}

describe('falling blocks rules', () => {
  it('deals the same garbage and pieces from the same seed', () => {
    const a = createLevel(3, new Rng(21));
    const b = createLevel(3, new Rng(21));
    expect(a.grid).toEqual(b.grid);
    expect(a.piece).toEqual(b.piece);
    expect(a.queue).toEqual(b.queue);
  });

  it('gets harder: more garbage, more lines to clear, faster fall', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(garbageFor(d)).toBeGreaterThan(garbageFor(lo));
      expect(goalFor(d)).toBeGreaterThan(goalFor(lo));
      expect(gravityFor(d)).toBeLessThan(gravityFor(lo));
    }
    const s = createLevel(4, new Rng(2));
    const rows = new Set(s.grid.flatMap((v, i) => (v === GARBAGE ? [Math.floor(i / COLS)] : [])));
    expect(rows.size).toBe(garbageFor(4));
    // No garbage row starts out full.
    for (const r of rows) expect(s.grid.slice(r * COLS, r * COLS + COLS).some((v) => v < 0)).toBe(true);
  });

  it('moves, turns against the wall and falls with gravity', () => {
    const s = createLevel(1, new Rng(5));
    while (move(s, -1));
    expect(s.piece.x + Math.min(...shapeCells(s.piece.k, s.piece.rot).map(([x]) => x))).toBe(0);
    expect(rotate(s, 1)).toBe(true);
    expect(fits(s, s.piece)).toBe(true);
    const y = s.piece.y;
    step(s, gravityFor(1) + 0.01);
    expect(s.piece.y).toBe(y + 1);
  });

  it('locks a grounded piece after the lock delay', () => {
    const s = createLevel(1, new Rng(6));
    s.piece.y += dropDistance(s);
    const k = s.piece;
    let locked = false;
    for (let t = 0; t < 1 && !locked; t += 1 / 60) locked = step(s, 1 / 60).locked;
    expect(locked).toBe(true);
    expect(s.piece).not.toEqual(k);
  });

  it('is cleared by a placement autopilot at every level', () => {
    for (const d of LEVELS)
      for (const seed of [1, 2, 3]) {
        const r = autopilot(d, seed * 7 + d);
        expect(r.win, `level ${d} seed ${seed}`).toBe(true);
        expect(r.s.lines).toBeGreaterThanOrEqual(goalFor(d));
      }
  });

  it('tops out when pieces pile up in the middle', () => {
    const s = createLevel(5, new Rng(8));
    let over = false;
    for (let i = 0; i < 200 && !over; i++) over = hardDrop(s).over;
    expect(over).toBe(true);
    expect(s.lines).toBeLessThan(goalFor(5));
  });
});
