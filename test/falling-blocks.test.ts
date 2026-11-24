import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { fallingBlocks } from '../src/games/falling-blocks';
import {
  BOMB,
  BOMB_PIECE,
  COLS,
  grant,
  KINDS,
  riseFor,
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
  type KindId,
  type State,
} from '../src/games/falling-blocks/rules';
import { mountGame } from './support/mount';

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

function autopilot(d: Difficulty, seed: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const rewards: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const ev = placeBest(s);
    if (ev.reward) rewards.push(ev.reward);
    if (ev.won) return { s, win: true, pieces: i + 1, rewards };
    if (ev.over) return { s, win: false, pieces: i + 1, rewards };
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
    const s = createLevel(4, new Rng(2), 'classic');
    const rows = new Set(s.grid.flatMap((v, i) => (v === GARBAGE || v === BOMB ? [Math.floor(i / COLS)] : [])));
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

  it('deals the same kind from the same seed, and different kinds across seeds', () => {
    const a = createLevel(4, new Rng(30));
    expect(a.kind).toBe(createLevel(4, new Rng(30)).kind);
    expect(a.grid).toEqual(createLevel(4, new Rng(30)).grid);
    const seen = new Set<string>();
    for (let seed = 0; seed < 50; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBe(KINDS.length);
    const easy = kindsAt(1, KINDS).map((k) => k.id);
    for (let seed = 0; seed < 20; seed++) expect(easy).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('every kind can be cleared by the autopilot at every level it is dealt', () => {
    for (const d of [2, 3, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const wins = [1, 2, 3, 4].filter((seed) => autopilot(d, seed * 5 + d, id).win).length;
        expect(wins, `${id} level ${d}`).toBeGreaterThanOrEqual(3);
      }
  });

  it('lines a well up in one column, three rows at a time', () => {
    const s = createLevel(3, new Rng(4), 'well');
    const holes = (r: number) => [...Array(COLS).keys()].filter((c) => s.grid[r * COLS + c] < 0);
    expect(holes(ROWS - 1)).toHaveLength(1);
    expect(holes(ROWS - 1)).toEqual(holes(ROWS - 2));
    expect(holes(ROWS - 1)).toEqual(holes(ROWS - 3));
  });

  it('a bomb in a cleared row blows up the rows next to it', () => {
    const s = createLevel(2, new Rng(3), 'classic');
    s.grid.fill(-1);
    // Two rows of rubble with a gap at column 0, a bomb in the upper one; a ragged row above them.
    for (const r of [ROWS - 2, ROWS - 1]) for (let c = 1; c < COLS; c++) s.grid[r * COLS + c] = GARBAGE;
    s.grid[(ROWS - 2) * COLS + 5] = BOMB;
    for (let c = 5; c < COLS; c++) s.grid[(ROWS - 3) * COLS + c] = GARBAGE;
    // An upright bar dropped in column 0 fills both gaps.
    s.piece = { k: 0, rot: 1, x: -2, y: 0 };
    const ev = hardDrop(s);
    expect(ev.cleared).toEqual([ROWS - 2, ROWS - 1]);
    expect(ev.blasted).toEqual([ROWS - 3]);
    expect(ev.booms).toEqual([{ x: 5, y: ROWS - 2 }]);
    expect(s.lines).toBe(3);
  });

  it('a bomb piece blows away the rows where it lands', () => {
    const s = createLevel(3, new Rng(5), 'classic');
    grant(s, 'bomb');
    // The bomb is next in line, after the current piece.
    expect(s.queue[0]).toBe(BOMB_PIECE);
    hardDrop(s);
    expect(s.piece.k).toBe(BOMB_PIECE);
    const lines = s.lines;
    const ev = hardDrop(s);
    expect(ev.booms).toHaveLength(1);
    expect(ev.blasted.length).toBeGreaterThanOrEqual(1);
    expect(s.lines).toBe(lines + ev.cleared.length + ev.blasted.length);
  });

  it('rising rubble pushes a row up every few pieces', () => {
    const s = createLevel(3, new Rng(6), 'rising');
    const count = () => s.grid.filter((v) => v === GARBAGE || v === BOMB).length;
    let rose = 0;
    for (let i = 0; i < riseFor(3); i++) if (hardDrop(s).rose) rose++;
    expect(rose).toBe(1);
    expect(count()).toBeGreaterThan(0);
  });

  it('speeds up with every line in a speed-up level', () => {
    const s = createLevel(3, new Rng(7), 'speed');
    const g0 = s.gravity;
    expect(g0).toBeGreaterThan(gravityFor(3));
    for (let i = 0; i < 40 && s.lines < 2; i++) placeBest(s);
    expect(s.gravity).toBeLessThan(g0);
  });

  it('clears in a row slow the fall, then bring bomb pieces', () => {
    const rewards: string[] = [];
    for (let seed = 1; seed < 40 && !rewards.includes('bomb'); seed++) rewards.push(...autopilot(5, seed, 'classic').rewards);
    expect(rewards).toContain('slow');
    expect(rewards).toContain('bomb');
    const s = createLevel(2, new Rng(8), 'classic');
    grant(s, 'slow');
    s.piece.y = 0;
    const y = s.piece.y;
    step(s, gravityFor(2) * 1.5);
    expect(s.piece.y).toBe(y);
    step(s, gravityFor(2) * 0.6);
    expect(s.piece.y).toBe(y + 1);
  });

  it('tops out when pieces pile up in the middle', () => {
    const s = createLevel(5, new Rng(8));
    let over = false;
    for (let i = 0; i < 200 && !over; i++) over = hardDrop(s).over;
    expect(over).toBe(true);
    expect(s.lines).toBeLessThan(goalFor(5));
  });
});

describe('falling blocks game', () => {
  it('mounts, names the kind of level and plays a few seconds', () => {
    for (const d of LEVELS) {
      const m = mountGame(fallingBlocks, d, 4);
      expect(m.variant?.id).toBe(createLevel(d, new Rng(4)).kind);
      expect(m.status).not.toBe('');
      m.run(3);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
