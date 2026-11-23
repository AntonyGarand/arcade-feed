import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { whack as game } from '../src/games/whack';
import { bop, createLevel, decoyFor, durationFor, isUp, LIVES, sizeFor, step, upFor, WHIFF_S, type State } from '../src/games/whack/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * Hit every critter `react` seconds after it shows up, never a decoy; skips a share `skip` of them
 * (a slower player). Returns the end state and the last result.
 */
function autopilot(d: Difficulty, seed: number, react: number, skip: number) {
  const s = createLevel(d, new Rng(seed));
  const rng = new Rng(seed * 7);
  const skipped = new Set<number>();
  let out = '';
  while (!s.done) {
    if (step(s, DT).over) out = 'over';
    s.pops.forEach((p, i) => {
      if (s.done || p.kind === 'decoy' || !isUp(p, s.time) || s.time < p.t + react || skipped.has(i)) return;
      if (rng.chance(skip)) skipped.add(i);
      else out = bop(s, p.hole).out || out;
    });
  }
  return { s, out };
}

/** The keyboard key for hole `h`. */
const keyOf = (s: State, h: number) => (s.n === 3 ? ['7', '8', '9', '4', '5', '6', '1', '2', '3'][h] : '1234qwerasdfzxcv'[h]);

describe('whack rules', () => {
  it('deals the same pop-ups from the same seed, and others from another', () => {
    expect(createLevel(4, new Rng(3)).pops).toEqual(createLevel(4, new Rng(3)).pops);
    expect(createLevel(4, new Rng(3)).pops).not.toEqual(createLevel(4, new Rng(4)).pops);
  });

  it('gets harder: more holes, quicker critters, more decoys, more hits to land', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(sizeFor(d)).toBeGreaterThanOrEqual(sizeFor(lo));
      expect(upFor(d)).toBeLessThan(upFor(lo));
      expect(decoyFor(d)).toBeGreaterThanOrEqual(decoyFor(lo));
      expect(createLevel(d, new Rng(1)).target).toBeGreaterThan(createLevel(lo, new Rng(1)).target);
    }
    expect(createLevel(1, new Rng(2)).pops.some((p) => p.kind === 'decoy')).toBe(false);
    expect(createLevel(5, new Rng(2)).pops.filter((p) => p.kind === 'decoy').length).toBeGreaterThan(5);
  });

  it('never pops two critters in the same hole at once, and deals enough to win', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 10; seed++) {
        const s = createLevel(d, new Rng(seed));
        const clash = s.pops.some((a) => s.pops.some((b) => a !== b && a.hole === b.hole && a.t < b.t + b.dur && b.t < a.t + a.dur));
        expect(clash).toBe(false);
        expect(s.pops.filter((p) => p.kind !== 'decoy').length).toBeGreaterThan(s.target);
        expect(s.pops.at(-1)!.t).toBeLessThan(durationFor(d));
      }
  });

  it('jams the mallet after a whiff and costs a heart for a decoy', () => {
    const s = createLevel(5, new Rng(6));
    while (!s.pops.some((p) => isUp(p, s.time))) step(s, DT);
    const empty = [...Array(s.n * s.n).keys()].find((h) => !s.pops.some((p) => p.hole === h && isUp(p, s.time)))!;
    expect(bop(s, empty).out).toBe('whiff');
    const up = s.pops.find((p) => isUp(p, s.time))!;
    expect(bop(s, up.hole).out).toBe(''); // jammed
    for (let t = 0; t < WHIFF_S + DT; t += DT) step(s, DT);
    const decoy = s.pops.find((p) => p.kind === 'decoy')!;
    s.time = decoy.t + 0.05;
    expect(bop(s, decoy.hole).out).toBe('decoy');
    expect(s.lives).toBe(LIVES - 1);
  });

  it('is cleared by a quick player at every level, with stars matching the pace', () => {
    for (const d of LEVELS) {
      const [two, three] = game.stars(d);
      for (let seed = 1; seed <= 6; seed++) {
        const fast = autopilot(d, seed, 0.25, 0);
        expect(fast.out, `fast ${d}/${seed}`).toBe('win');
        expect(fast.s.lives).toBe(LIVES);
        expect(fast.s.score, `fast ${d}/${seed}`).toBeGreaterThanOrEqual(three);
      }
      const steady = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed, 0.45, 0.15));
      expect(steady.filter((r) => r.out === 'win').length, `steady ${d}`).toBe(6);
      expect(steady.filter((r) => r.s.score >= two).length, `steady ${d}`).toBeGreaterThanOrEqual(4);
      expect(steady.filter((r) => r.s.score >= three).length, `steady ${d}`).toBeLessThanOrEqual(1);
    }
  });

  it('is lost when time runs out, or by hitting decoys', () => {
    const lazy = autopilot(3, 2, 0.25, 0.7);
    expect(lazy.out).toBe('over');
    const s = createLevel(5, new Rng(8));
    let out = '';
    for (const p of s.pops.filter((q) => q.kind === 'decoy')) {
      s.time = p.t + 0.05;
      out = bop(s, p.hole).out;
      if (s.done) break;
    }
    expect(out).toBe('lose');
    expect(s.lives).toBe(0);
  });
});

describe('whack game', () => {
  it('mounts and reports score, hearts and progress', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(game, d, 4);
      expect(m.lives).toEqual([LIVES, LIVES]);
      expect(m.status).toMatch(/0\/\d+/);
      m.run(3);
      expect(m.outcome).toBe('');
      m.inst.onKey?.(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      m.inst.onKey?.(new KeyboardEvent('keydown', { key: ' ' }));
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is won by pressing each critter’s key', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(game, d, 5);
      const s = createLevel(d, new Rng(5)); // the same level, to see what pops up
      const pressed = new Set<number>();
      while (!m.outcome && s.time < s.duration) {
        m.inst.frame?.(DT);
        step(s, DT);
        s.pops.forEach((p, i) => {
          if (p.kind === 'decoy' || pressed.has(i) || !isUp(p, s.time) || s.time < p.t + 0.3) return;
          pressed.add(i);
          m.inst.onKey?.(new KeyboardEvent('keydown', { key: keyOf(s, p.hole) }));
          bop(s, p.hole);
        });
      }
      expect(m.outcome).toBe('win');
      expect(m.score).toBe(s.score);
      expect(m.score).toBeGreaterThanOrEqual(game.stars(d)[0]);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is lost when nothing gets hit', () => {
    const m = mountGame(game, 2, 1);
    m.run(durationFor(2) + 1);
    expect(m.outcome).toBe('lose');
    m.inst.destroy?.();
    m.root.remove();
  });
});
