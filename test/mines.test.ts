import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { mines } from '../src/games/mines';
import { _setLocaleForTests } from '../src/core/i18n';
import { kindsAt } from '../src/core/variety';
import {
  CLEAN_BONUS,
  CLOCK_S,
  createLevel,
  deduce,
  FREEZE_S,
  GEM_POINTS,
  grant,
  KINDS,
  livesFor,
  minesFor,
  minesLeft,
  reveal,
  SCOUT_CELLS,
  sizeFor,
  solvable,
  SPRINT_S,
  startCell,
  STREAK_S,
  STREAK_TIERS,
  tick,
  TIME_POINTS,
  TIME_S,
  timeFor,
  toggleFlag,
  type KindId,
  type State,
} from '../src/games/mines/rules';
import { mountGame } from './support/mount';

/** Where to start: the cell nearest the middle that isn't a hole. */
const mid = (s: State) => startCell(s);

/**
 * Play by logic only (never reading hidden cells): open the middle, then every cell the deductions
 * prove safe, taking `pace` seconds per tap. Returns the end state and the taps made.
 */
function autopilot(d: Difficulty, seed: number, pace: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  let ev = reveal(s, mid(s));
  const powers: string[] = ev.power ? [ev.power] : [];
  let taps = 1;
  while (!ev.won && !ev.over) {
    const safe = deduce(s, s.open, s.boom);
    if (!safe.length) throw new Error(`stuck on ${d}/${seed}`);
    for (const j of safe) {
      if (s.open[j] || s.done) continue;
      ev = tick(s, pace);
      if (ev.over) break;
      ev = reveal(s, j);
      if (ev.power) powers.push(ev.power);
      taps++;
    }
  }
  return { s, won: ev.won, taps, powers };
}

describe('mines rules', () => {
  it('deals the same kind, shape and mines from the same seed and first tap', () => {
    const a = createLevel(3, new Rng(5));
    const b = createLevel(3, new Rng(5));
    const c = createLevel(3, new Rng(6));
    for (const s of [a, b, c]) reveal(s, mid(s));
    expect(a.kind).toBe(b.kind);
    expect(a.hole).toEqual(b.hole);
    expect(a.mine).toEqual(b.mine);
    expect(a.bonus).toEqual(b.bonus);
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
        let first = (seed * 7) % (s.cols * s.rows); // corners and edges too
        while (s.hole[first]) first = (first + 1) % (s.cols * s.rows);
        const planned = s.count;
        const ev = reveal(s, first);
        expect(ev.boom, `${d}/${seed}`).toBe(false);
        expect(s.num[first]).toBe(0);
        expect(ev.opened).toBeGreaterThan(1);
        expect(solvable(s, first)).toBe(true);
        expect(s.count).toBeGreaterThanOrEqual(planned - 1);
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
    const s = createLevel(1, new Rng(9), 'classic');
    expect(toggleFlag(s, mid(s))).toBe(false); // nothing to flag before the first tap
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

    const t = createLevel(1, new Rng(4), 'classic');
    expect(tick(t, 1).over).toBe(false); // the clock runs before the first tap too
    reveal(t, mid(t));
    expect(tick(t, timeFor(1) - 2).over).toBe(false);
    expect(tick(t, 2).over).toBe(true);
  });

  it('pays the clean bonus only without wrong flags', () => {
    const clean = autopilot(1, 3, 0);
    const s = createLevel(1, new Rng(3));
    reveal(s, mid(s));
    const safe = s.mine.findIndex((m, i) => !m && !s.open[i] && !s.hole[i]);
    toggleFlag(s, safe);
    toggleFlag(s, safe);
    let ev = reveal(s, mid(s));
    while (!ev.won) {
      for (const j of deduce(s, s.open, s.boom)) if (!s.open[j] && !s.done) ev = reveal(s, j);
    }
    expect(clean.s.score - s.score).toBe(CLEAN_BONUS);
  });
});

describe('mines kinds', () => {
  it('deals several kinds across seeds, each from its level up', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    for (let seed = 0; seed < 30; seed++) expect(createLevel(1, new Rng(seed)).kind).not.toMatch(/scatter|sprint/);
  });

  it('shapes the board: a hole in the middle, cut corners, scattered holes; same share of mines', () => {
    const [cols, rows] = sizeFor(4);
    const donut = createLevel(4, new Rng(1), 'donut');
    expect(donut.hole[Math.floor(rows / 2) * cols + Math.floor(cols / 2)]).toBe(true);
    const cross = createLevel(4, new Rng(1), 'cross');
    expect(cross.hole[0]).toBe(true);
    expect(cross.hole[cols * rows - 1]).toBe(true);
    expect(cross.hole[Math.floor(rows / 2) * cols]).toBe(false);
    for (let seed = 0; seed < 5; seed++) {
      const sc = createLevel(4, new Rng(seed), 'scatter');
      expect(sc.hole.filter(Boolean).length).toBeGreaterThan(3);
      // Holes take no part in the numbers or the neighbour lists.
      for (const list of sc.nb) for (const j of list) expect(sc.hole[j]).toBe(false);
    }
    const full = createLevel(4, new Rng(1), 'classic');
    expect(full.hole.some(Boolean)).toBe(false);
    for (const s of [donut, cross]) {
      const real = s.hole.filter((h) => !h).length;
      expect(Math.abs(s.count / real - minesFor(4) / (cols * rows))).toBeLessThan(0.02);
    }
    expect(reveal(donut, donut.hole.indexOf(true)).opened).toBe(0); // a hole isn't a cell
    expect(donut.placed).toBe(false);
  });

  it('every kind allowed at a level is cleared by logic alone, quickly enough for three stars', () => {
    for (const d of [2, 3, 5] as const)
      for (const { id } of kindsAt(d, KINDS))
        for (const seed of [3, 4, 5, 6]) {
          const r = autopilot(d, seed * 17 + d, 0.9, id);
          expect(r.won, `${id} ${d}/${seed}`).toBe(true);
          expect(r.s.kind).toBe(id);
          expect(r.s.opened).toBe(r.s.safe);
          expect(starsFor(mines, d, true, r.s.score), `${id} ${d}/${seed} ${r.s.score}`).toBeGreaterThanOrEqual(seed === 3 ? 2 : 3);
        }
  });

  it('lays bonus cells on safe cells: an hourglass adds time, a gem adds points', () => {
    const s = createLevel(3, new Rng(8), 'treasure');
    expect(s.limit).toBeLessThan(timeFor(3));
    reveal(s, mid(s));
    const clocks = s.bonus.flatMap((b, i) => (b === 'clock' ? [i] : []));
    const gems = s.bonus.flatMap((b, i) => (b === 'gem' ? [i] : []));
    expect(clocks.length).toBe(3);
    expect(gems.length).toBe(3);
    for (const i of [...clocks, ...gems]) expect(s.mine[i]).toBe(false);
    const limit = s.limit;
    const ev = reveal(s, clocks[0]);
    expect(ev.bonus.map((b) => b.kind)).toContain('clock');
    expect(s.limit).toBeGreaterThanOrEqual(limit + CLOCK_S);
    expect(s.bonus[clocks[0]]).toBe('');
    const score = s.score;
    const gem = gems.find((i) => !s.open[i])!;
    const ev2 = reveal(s, gem);
    expect(s.score).toBeGreaterThanOrEqual(score + GEM_POINTS + ev2.opened * 5);
  });

  it('a sprint board starts with about half the clock and earns seconds per cell', () => {
    const s = createLevel(3, new Rng(2), 'sprint');
    const limit = s.limit;
    expect(limit).toBeLessThan(timeFor(3) * 0.6);
    const ev = reveal(s, mid(s));
    expect(s.limit).toBeCloseTo(limit + ev.opened * SPRINT_S);
  });

  it('quick reveals in a row freeze the clock, then scout safe cells, then add time; a pause ends the streak', () => {
    const r = autopilot(4, 7, 0.5, 'classic');
    expect(r.powers).toEqual(['freeze', 'scout', 'time']);
    const slow = autopilot(4, 7, STREAK_S + 0.1, 'classic');
    expect(slow.powers).toEqual([]);

    const s = createLevel(2, new Rng(3), 'classic');
    reveal(s, mid(s));
    grant(s, 'freeze');
    expect(s.freeze).toBe(FREEZE_S);
    tick(s, FREEZE_S - 0.5);
    expect(s.time).toBe(0);
    tick(s, 1);
    expect(s.time).toBeGreaterThan(0);
    const opened = s.opened;
    const ev = reveal(s, -1); // nothing happens: an empty set of events to fill
    expect(ev.opened).toBe(0);
    grant(s, 'scout', ev);
    expect(ev.scouted.length).toBeGreaterThan(0);
    expect(ev.scouted.length).toBeLessThanOrEqual(SCOUT_CELLS);
    expect(s.opened).toBeGreaterThan(opened);
    for (const j of ev.scouted) expect(s.mine[j]).toBe(false);
    const limit = s.limit;
    grant(s, 'time');
    expect(s.limit).toBe(limit + TIME_S);
    expect(STREAK_TIERS[0]).toBeLessThan(STREAK_TIERS[2]);
  });
});

describe('mines card', () => {
  it('names its kind on the start gate, in both languages', () => {
    for (const locale of ['en', 'fr'] as const) {
      _setLocaleForTests(locale);
      for (let seed = 0; seed < 30; seed++) {
        const m = mountGame(mines, 4, seed);
        expect(m.variant?.id).toBe(createLevel(4, new Rng(seed)).kind);
        expect(m.variant!.name.length).toBeLessThanOrEqual(18);
        expect(m.variant!.blurb!.length, m.variant!.blurb).toBeLessThanOrEqual(60);
        m.inst.destroy?.();
        m.root.remove();
      }
    }
    _setLocaleForTests('en');
  });

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
      // The card's clock ran about 4 s longer (the frames above, before and after the first tap).
      expect(m.score).toBeLessThan(s.score);
      expect(m.score).toBeGreaterThanOrEqual(s.score - 5 * TIME_POINTS);
      expect(m.inst.onKey!(key('q'))).toBe(false);
      m.inst.destroy?.();
      m.root.remove();
    });

  it('loses when the clock runs out', () => {
    const m = mountGame(mines, 3, 2);
    const s = createLevel(3, new Rng(2));
    m.inst.onKey!(key('Enter'));
    m.inst.onKey!(key('Enter'));
    reveal(s, mid(s));
    m.inst.onKey!(key('f'));
    m.run(s.limit - 1);
    expect(m.outcome).toBe('');
    m.run(2);
    expect(m.outcome).toBe('lose');
    m.inst.destroy?.();
    m.root.remove();
  });
});
