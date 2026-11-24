import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { memory } from '../src/games/memory';
import { _setLocaleForTests } from '../src/core/i18n';
import { kindsAt } from '../src/core/variety';
import {
  createLevel,
  GOLD_POINTS,
  GOLD_S,
  grant,
  KINDS,
  LIVES,
  LOOK,
  MOVE_S,
  press,
  roundsFor,
  runSeconds,
  showFor,
  sideFor,
  step,
  tileCount,
  tilesIn,
  slide,
  STREAK_TIERS,
  TIME_BONUS,
  TILE_POINTS,
  type KindId,
  type PressResult,
  type State,
} from '../src/games/memory/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * Run frames until the tiles go dark and the board settles (or the run ends); returns where the lit
 * tiles are then (a sliding grid has moved them on since they lit up).
 */
function watch(s: State, frame: (dt: number) => void = (dt) => step(s, dt)): number[] {
  for (let i = 0; i < 6000 && s.phase !== 'input' && s.phase !== 'done'; i++) frame(DT);
  return s.lit.flatMap((on, k) => (on ? [k] : []));
}

/** Wait `t` seconds of game time. */
const wait = (s: State, t: number) => {
  for (let x = 0; x < t - 1e-9; x += DT) step(s, DT);
};

/** Tap back what was seen, one tile every `tap` seconds; `slips` wrong tiles first in round 1. */
function autopilot(d: Difficulty, seed: number, tap: number, slips = 0, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const powers: string[] = [];
  let out: PressResult = '';
  while (out !== 'win' && out !== 'lose') {
    const seen = watch(s);
    if (s.phase === 'done') return { s, out: s.lives > 0 ? 'win' : 'lose', powers };
    if (s.round === 1)
      for (let k = 0, i = 0; k < slips; i++)
        if (!s.lit[i] && !s.hole[i]) {
          press(s, i);
          k++;
        }
    for (const k of seen) {
      wait(s, tap);
      out = press(s, k);
      if (s.unlocked) powers.push(s.unlocked);
    }
  }
  return { s, out, powers };
}

describe('memory rules', () => {
  it('deals the same patterns from the same seed, and others from another', () => {
    expect(createLevel(3, new Rng(7)).patterns).toEqual(createLevel(3, new Rng(7)).patterns);
    expect(createLevel(3, new Rng(7)).patterns).not.toEqual(createLevel(3, new Rng(8)).patterns);
  });

  it('lights one tile more each round, all distinct and on the grid', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 10; seed++) {
        const s = createLevel(d, new Rng(seed));
        expect(s.patterns.length).toBe(roundsFor(d));
        s.patterns.forEach((p, r) => {
          expect(p.length).toBe(tilesIn(d, r + 1));
          expect(new Set(p).size).toBe(p.length);
          expect(p.every((i) => i >= 0 && i < s.side * s.side && !s.hole[i])).toBe(true);
        });
      }
  });

  it('gets harder: bigger grid, more rounds and tiles, a shorter look', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(sideFor(d)).toBeGreaterThanOrEqual(sideFor(lo));
      expect(tileCount(d)).toBeGreaterThan(tileCount(lo));
      expect(showFor(d)).toBeLessThanOrEqual(showFor(lo));
      expect(memory.stars(d)[1]).toBeGreaterThan(memory.stars(lo)[1]);
    }
    for (const d of LEVELS) {
      expect(showFor(d)).toBeGreaterThanOrEqual(1.2);
      expect(runSeconds(d)).toBeGreaterThan(15);
      expect(runSeconds(d)).toBeLessThan(60);
    }
  });

  it('shows the tiles on the clock, and only takes taps once they go dark', () => {
    const s = createLevel(2, new Rng(3), 'classic');
    expect(s.phase).toBe('intro');
    const lit = s.patterns[0][0];
    expect(press(s, lit)).toBe('');
    wait(s, 0.8);
    expect(s.phase).toBe('show');
    expect(press(s, lit)).toBe('');
    wait(s, showFor(2));
    expect(s.phase).toBe('input');
    expect(press(s, lit)).toBe('hit');
    expect(press(s, lit)).toBe('');
  });

  it('is cleared by a perfect, quick memory at every level with three stars', () => {
    for (const d of LEVELS) {
      const [, three] = memory.stars(d);
      for (let seed = 1; seed <= 4; seed++) {
        const r = autopilot(d, seed, 0.45);
        expect(r.out, `${d}/${seed}`).toBe('win');
        expect(r.s.score, `${d}/${seed}`).toBeGreaterThanOrEqual(three);
      }
    }
  });

  it('gives two stars for a quick run with a slip, one for a slow one', () => {
    for (const d of LEVELS) {
      const [two, three] = memory.stars(d);
      const slip = autopilot(d, 2, 0.5, 1);
      expect(slip.out).toBe('win');
      // The slip costs a heart (a long streak afterwards may win it back).
      expect(slip.s.lives).toBeGreaterThanOrEqual(LIVES - 1);
      expect(slip.s.cleared.length).toBe(roundsFor(d));
      expect(slip.s.score, `level ${d}`).toBeGreaterThanOrEqual(two);
      expect(slip.s.score, `level ${d}`).toBeLessThan(three);
      // Slow (some rounds run out at the top levels) with a slip: one star at best.
      const slow = autopilot(d, 2, 1.2, 1);
      expect(slow.s.score, `level ${d}`).toBeLessThan(two);
    }
  });

  it('costs a heart for each wrong tile, and the run ends with the last one', () => {
    const s = createLevel(1, new Rng(4));
    watch(s);
    const wrong = [...s.lit.keys()].filter((i) => !s.lit[i] && !s.hole[i]);
    expect(press(s, wrong[0])).toBe('slip');
    expect(press(s, wrong[0])).toBe(''); // already marked
    expect(press(s, wrong[1])).toBe('slip');
    expect(press(s, wrong[2])).toBe('lose');
    expect(s.lives).toBe(0);
    expect(s.phase).toBe('done');
  });

  it('costs a heart when the clock runs out, shows the missed tiles and moves on', () => {
    const s = createLevel(1, new Rng(5), 'classic');
    watch(s);
    press(s, s.patterns[0][0]);
    let late = '';
    for (let i = 0; i < 2000 && !late; i++) late = step(s, DT).late;
    expect(late).toBe('late');
    expect(s.phase).toBe('late');
    expect(s.lives).toBe(LIVES - 1);
    expect(s.left).toBe(tilesIn(1, 1) - 1);
    watch(s);
    expect(s.round).toBe(2);
    expect(s.cleared).toEqual([false]);
    // Running out twice more ends the run.
    for (let i = 0; i < 2000 && late !== 'lose'; i++) late = step(s, DT).late || late;
    expect(late).toBe('lose');
    expect(s.round).toBe(3);
  });

  it('clears the level when the last round runs out with a heart to spare', () => {
    const s = createLevel(1, new Rng(6));
    for (let r = 1; r < s.rounds; r++) for (const k of watch(s)) press(s, k);
    watch(s);
    expect(s.round).toBe(s.rounds);
    let late = '';
    for (let i = 0; i < 2000 && !late; i++) late = step(s, DT).late;
    expect(late).toBe('win');
    expect(s.phase).toBe('done');
  });
});

describe('memory kinds', () => {
  it('deals the same kind from the same seed, and several kinds across seeds', () => {
    expect(createLevel(4, new Rng(3)).kind).toBe(createLevel(4, new Rng(3)).kind);
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    for (let seed = 0; seed < 30; seed++) expect(createLevel(1, new Rng(seed)).kind).toMatch(/classic|shapes|quick/);
  });

  it('every kind allowed at a level is won by a sharp memory, with three stars', () => {
    for (const d of [2, 3, 5] as const) {
      const [, three] = memory.stars(d);
      for (const { id } of kindsAt(d, KINDS))
        for (const seed of [1, 2, 3]) {
          const r = autopilot(d, seed, 0.45, 0, id);
          expect(r.out, `${id} ${d}/${seed}`).toBe('win');
          expect(r.s.kind).toBe(id);
          expect(r.s.score, `${id} ${d}/${seed}`).toBeGreaterThanOrEqual(three);
          // ...and a slow one doesn't get them.
          expect(autopilot(d, seed, 1.2, 1, id).s.score, `${id} ${d}/${seed} slow`).toBeLessThan(three);
        }
    }
  });

  it('shaped grids cut their corners; nothing lights up in a hole and a hole takes no tap', () => {
    const s = createLevel(3, new Rng(2), 'shapes');
    expect(s.side).toBe(sideFor(3) + 1);
    expect(s.hole[0]).toBe(true);
    expect(s.hole[s.side * s.side - 1]).toBe(true);
    expect(s.patterns.flat().some((i) => s.hole[i])).toBe(false);
    watch(s);
    expect(press(s, 0)).toBe('');
    expect(s.lives).toBe(LIVES);
  });

  it('a sliding grid moves the lit tiles one step over before the clock runs', () => {
    const s = createLevel(3, new Rng(5), 'shift');
    const lit = s.patterns[0];
    for (let i = 0; i < 600 && s.phase !== 'move'; i++) step(s, DT);
    expect(s.phase).toBe('move');
    expect(press(s, lit[0])).toBe('');
    wait(s, MOVE_S + DT);
    expect(s.phase).toBe('input');
    const moved = lit.map((i) => slide(s.side, i, s.shifts[0])).sort((a, b) => a - b);
    expect(s.lit.flatMap((on, i) => (on ? [i] : []))).toEqual(moved);
    expect(slide(4, 3, 1)).toBe(0); // wraps around
    expect(slide(4, 1, 0)).toBe(13);
  });

  it('decoys flash too but are not to be tapped; flicker rounds show longer', () => {
    const s = createLevel(3, new Rng(5), 'decoys');
    expect(s.decoys.every((dc) => dc.length >= 1)).toBe(true);
    for (const [r, p] of s.patterns.entries()) for (const i of s.decoys[r]) expect(p).not.toContain(i);
    watch(s);
    expect(press(s, s.decoys[0][0])).toBe('slip');
    const f = createLevel(5, new Rng(5), 'flicker');
    expect(f.show).toBeGreaterThan(showFor(5));
  });

  it('golden tiles (one a round from the second) pay points and seconds; quick looks are short', () => {
    const s = createLevel(2, new Rng(6), 'classic');
    expect(s.golds.map((g) => g.length)).toEqual([0, 1, 1, 1, 1]);
    for (const [r, g] of s.golds.entries()) for (const i of g) expect(s.patterns[r]).toContain(i);
    for (const k of watch(s)) press(s, k);
    watch(s);
    const limit = s.limit;
    const score = s.score;
    expect(press(s, s.golds[1][0])).toBe('hit');
    expect(s.score).toBe(score + TILE_POINTS + GOLD_POINTS);
    expect(s.limit).toBe(limit + GOLD_S);
    expect(createLevel(2, new Rng(6), 'quick').show).toBeLessThan(showFor(2) * 0.8);
  });

  it('a long streak adds time, then a longer look, then a heart back', () => {
    const r = autopilot(5, 3, 0.45, 0, 'classic');
    expect(r.powers).toEqual(['time', 'look', 'heart']);
    expect(STREAK_TIERS[2]).toBeLessThanOrEqual(tileCount(3));

    const s = createLevel(2, new Rng(1), 'classic');
    watch(s);
    const limit = s.limit;
    grant(s, 'time');
    expect(s.limit).toBe(limit + TIME_BONUS);
    grant(s, 'look');
    for (const k of watch(s)) press(s, k);
    watch(s);
    expect(s.round).toBe(2);
    expect(s.show).toBeCloseTo(showFor(2) * LOOK);
    s.lives = 1;
    grant(s, 'heart');
    expect(s.lives).toBe(2);
  });
});

describe('memory game', () => {
  it('names its kind on the start gate, in both languages', () => {
    for (const locale of ['en', 'fr'] as const) {
      _setLocaleForTests(locale);
      for (let seed = 0; seed < 30; seed++) {
        const m = mountGame(memory, 4, seed);
        expect(m.variant?.id).toBe(createLevel(4, new Rng(seed)).kind);
        expect(m.variant!.name.length).toBeLessThanOrEqual(18);
        expect(m.variant!.blurb!.length, m.variant!.blurb).toBeLessThanOrEqual(60);
        m.inst.destroy?.();
        m.root.remove();
      }
    }
    _setLocaleForTests('en');
  });

  it('mounts at every level and reports score, hearts and rounds', () => {
    for (const d of LEVELS) {
      const m = mountGame(memory, d, 2);
      expect(m.lives).toEqual([LIVES, LIVES]);
      expect(m.status).toContain(`1/${roundsFor(d)}`);
      m.run(2);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is won from the keyboard, moving the cursor to the tiles that lit up', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(memory, d, 6);
      const s = createLevel(d, new Rng(6)); // the same level, stepped alongside to see the lights
      const key = (k: string) => {
        expect(m.inst.onKey?.(new KeyboardEvent('keydown', { key: k }))).toBe(true);
        m.inst.onKey?.(new KeyboardEvent('keyup', { key: k }));
      };
      key('ArrowUp'); // shows the cursor in the middle
      let at = Math.floor(s.side / 2) * s.side + Math.floor(s.side / 2);
      while (!m.outcome) {
        const seen = watch(s, (dt) => {
          step(s, dt);
          m.inst.frame?.(dt);
        });
        for (const k of seen) {
          for (; at % s.side < k % s.side; at++) key('ArrowRight');
          for (; at % s.side > k % s.side; at--) key('a');
          for (; Math.floor(at / s.side) < Math.floor(k / s.side); at += s.side) key('s');
          for (; Math.floor(at / s.side) > Math.floor(k / s.side); at -= s.side) key('ArrowUp');
          key(k % 2 ? ' ' : 'Enter');
          press(s, k);
        }
      }
      expect(m.outcome).toBe('win');
      expect(m.score).toBe(s.score);
      expect(m.inst.onKey?.(new KeyboardEvent('keydown', { key: 'x' }))).toBe(false);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is lost by running out the clock', () => {
    const m = mountGame(memory, 3, 3);
    m.run(120);
    expect(m.outcome).toBe('lose');
    expect(m.lives).toEqual([0, LIVES]);
  });
});
