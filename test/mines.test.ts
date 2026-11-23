import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { mines } from '../src/games/mines';
import {
  CLEAN_BONUS,
  createLevel,
  deduce,
  livesFor,
  minesFor,
  minesLeft,
  reveal,
  sizeFor,
  solvable,
  tick,
  TIME_POINTS,
  timeFor,
  toggleFlag,
  type State,
} from '../src/games/mines/rules';
import { mountGame } from './support/mount';

const mid = (s: State) => Math.floor(s.rows / 2) * s.cols + Math.floor(s.cols / 2);

/**
 * Play by logic only (never reading hidden cells): open the middle, then every cell the deductions
 * prove safe, taking `pace` seconds per tap. Returns the end state and the taps made.
 */
function autopilot(d: Difficulty, seed: number, pace: number) {
  const s = createLevel(d, new Rng(seed));
  let ev = reveal(s, mid(s));
  let taps = 1;
  while (!ev.won && !ev.over) {
    const safe = deduce(s, s.open, s.boom);
    if (!safe.length) throw new Error(`stuck on ${d}/${seed}`);
    for (const j of safe) {
      if (s.open[j] || s.done) continue;
      ev = tick(s, pace);
      if (ev.over) break;
      ev = reveal(s, j);
      taps++;
    }
  }
  return { s, won: ev.won, taps };
}

describe('mines rules', () => {
  it('deals the same mines from the same seed and first tap', () => {
    const a = createLevel(3, new Rng(5));
    const b = createLevel(3, new Rng(5));
    const c = createLevel(3, new Rng(6));
    for (const s of [a, b, c]) reveal(s, mid(s));
    expect(a.mine).toEqual(b.mine);
    expect(a.mine).not.toEqual(c.mine);
    expect(a.mine.filter(Boolean).length).toBe(a.count);
  });

  it('gets harder: bigger, denser boards and fewer lives', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      const area = (x: Difficulty) => sizeFor(x)[0] * sizeFor(x)[1];
      expect(area(d)).toBeGreaterThanOrEqual(area(lo));
      expect(minesFor(d) / area(d)).toBeGreaterThan(minesFor(lo) / area(lo));
      expect(livesFor(d)).toBeLessThanOrEqual(livesFor(lo));
      expect(timeFor(d)).toBeGreaterThan(timeFor(lo));
    }
    expect(livesFor(5)).toBeLessThan(livesFor(1));
  });

  it('makes the first tap safe, opens an area there, and needs no guess from it', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 12; seed++) {
        const s = createLevel(d, new Rng(seed));
        const first = (seed * 7) % (s.cols * s.rows); // corners and edges too
        const ev = reveal(s, first);
        expect(ev.boom, `${d}/${seed}`).toBe(false);
        expect(s.num[first]).toBe(0);
        expect(ev.opened).toBeGreaterThan(1);
        expect(solvable(s, first)).toBe(true);
        expect(s.count).toBeGreaterThanOrEqual(minesFor(d) - 1);
      }
  });

  it('is cleared by logic alone at every level; a quick player earns three stars, a slow one two', () => {
    for (const d of LEVELS) {
      const quick = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => autopilot(d, seed * 13 + d, 0.9));
      const slow = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => autopilot(d, seed * 13 + d, 1.9));
      for (const r of [...quick, ...slow]) {
        expect(r.won, `level ${d}`).toBe(true);
        expect(r.s.lives).toBe(livesFor(d));
      }
      const quickStars = quick.map((r) => starsFor(mines, d, true, r.s.score));
      const slowStars = slow.map((r) => starsFor(mines, d, true, r.s.score));
      expect(quickStars.filter((k) => k === 3).length, `level ${d} quick ${quickStars.join()}`).toBeGreaterThanOrEqual(5);
      expect(slowStars.filter((k) => k >= 2).length, `level ${d} slow ${slowStars.join()}`).toBeGreaterThanOrEqual(5);
      expect(slowStars.filter((k) => k === 3).length, `level ${d} slow ${slowStars.join()}`).toBeLessThanOrEqual(2);
    }
  });

  it('flags only hidden cells, counts wrong flags, and opens around a fully flagged number', () => {
    const s = createLevel(1, new Rng(9));
    expect(toggleFlag(s, 0)).toBe(false); // nothing to flag before the first tap
    reveal(s, mid(s));
    expect(toggleFlag(s, mid(s))).toBe(false);
    const safe = s.mine.findIndex((m, i) => !m && !s.open[i]);
    toggleFlag(s, safe);
    expect(s.wrongFlags).toBe(1);
    toggleFlag(s, safe);
    expect(s.flag[safe]).toBe(false);
    // A number touching hidden cells: flag its mines, then tap it to open the rest.
    const num = s.open.findIndex((o, i) => o && s.num[i] > 0 && s.nb[i].some((j) => !s.open[j] && !s.mine[j]));
    expect(num).toBeGreaterThanOrEqual(0);
    for (const j of s.nb[num]) if (s.mine[j]) toggleFlag(s, j);
    expect(minesLeft(s)).toBe(s.count - s.num[num]);
    const ev = reveal(s, num);
    expect(ev.opened).toBeGreaterThan(0);
    expect(ev.boom).toBe(false);
    expect(s.nb[num].every((j) => s.open[j] || s.flag[j])).toBe(true);
  });

  it('takes a life per mine and ends the run on the last one, or when time runs out', () => {
    const s = createLevel(2, new Rng(4));
    reveal(s, mid(s));
    const bombs = s.mine.flatMap((m, i) => (m ? [i] : []));
    const first = reveal(s, bombs[0]);
    expect(first.boom).toBe(true);
    expect(first.over).toBe(false);
    expect(s.lives).toBe(livesFor(2) - 1);
    expect(reveal(s, bombs[1]).over).toBe(true);

    const t = createLevel(1, new Rng(4));
    expect(tick(t, 1000).over).toBe(false); // the clock waits for the first tap
    reveal(t, mid(t));
    expect(tick(t, timeFor(1) - 1).over).toBe(false);
    expect(tick(t, 2).over).toBe(true);
  });

  it('pays the clean bonus only without wrong flags', () => {
    const clean = autopilot(1, 3, 0);
    const s = createLevel(1, new Rng(3));
    reveal(s, mid(s));
    const safe = s.mine.findIndex((m, i) => !m && !s.open[i]);
    toggleFlag(s, safe);
    toggleFlag(s, safe);
    let ev = reveal(s, mid(s));
    while (!ev.won) {
      for (const j of deduce(s, s.open, s.boom)) if (!s.open[j] && !s.done) ev = reveal(s, j);
    }
    expect(clean.s.score - s.score).toBe(CLEAN_BONUS);
  });
});

describe('mines card', () => {
  const key = (k: string) => new KeyboardEvent('keydown', { key: k });

  for (const d of [1, 5] as const)
    it(`plays a level ${d} board to a win with the keyboard`, () => {
      const m = mountGame(mines, d, 21);
      expect(m.status).toMatch(/tap/i);
      expect(m.lives).toEqual([livesFor(d), livesFor(d)]);
      m.run(3);
      expect(m.outcome).toBe('');
      // The same seed and first cell deal the same board: replay it alongside to know where to go.
      const s = createLevel(d, new Rng(21));
      let cur = mid(s);
      expect(m.inst.onKey!(key('ArrowUp'))).toBe(true); // shows the cursor in the middle
      m.inst.onKey!(key(' '));
      reveal(s, cur);
      expect(m.score).toBe(s.score);
      expect(m.status).toMatch(/mines? left/);
      m.run(1);
      while (!s.done) {
        for (const j of deduce(s, s.open, s.boom)) {
          if (s.open[j]) continue;
          const dc = (j % s.cols) - (cur % s.cols);
          const dr = Math.floor(j / s.cols) - Math.floor(cur / s.cols);
          for (let k = 0; k < Math.abs(dc); k++) m.inst.onKey!(key(dc > 0 ? 'ArrowRight' : 'ArrowLeft'));
          for (let k = 0; k < Math.abs(dr); k++) m.inst.onKey!(key(dr > 0 ? 'ArrowDown' : 'ArrowUp'));
          cur = j;
          m.inst.onKey!(key(' '));
          reveal(s, j);
        }
      }
      expect(m.outcome).toBe('win');
      // The card's clock ran a second longer (the frames above).
      expect(m.score).toBeLessThan(s.score);
      expect(m.score).toBeGreaterThanOrEqual(s.score - 2 * TIME_POINTS);
      expect(m.inst.onKey!(key('q'))).toBe(false);
      m.inst.destroy?.();
      m.root.remove();
    });

  it('loses when the clock runs out', () => {
    const m = mountGame(mines, 3, 2);
    m.inst.onKey!(key('Enter'));
    m.inst.onKey!(key('Enter'));
    m.inst.onKey!(key('f'));
    m.run(timeFor(3) - 1);
    expect(m.outcome).toBe('');
    m.run(2);
    expect(m.outcome).toBe('lose');
    m.inst.destroy?.();
    m.root.remove();
  });
});
