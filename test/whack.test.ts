import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { _setLocaleForTests } from '../src/core/i18n';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { whack as game } from '../src/games/whack';
import {
  bop,
  createLevel,
  decoyFor,
  durationFor,
  GOLD_POINTS,
  isUp,
  KINDS,
  LIVES,
  sizeFor,
  SLOW_RATE,
  step,
  STREAK_TIERS,
  upFor,
  WHIFF_S,
  type KindId,
  type State,
} from '../src/games/whack/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * Hit every critter `react` seconds after it shows up, never a decoy; skips a share `skip` of them
 * (a slower player). Returns the end state and the last result.
 */
function autopilot(d: Difficulty, seed: number, react: number, skip: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const rng = new Rng(seed * 7);
  const skipped = new Set<number>();
  const powers: string[] = [];
  let out = '';
  while (!s.done) {
    if (step(s, DT).over) out = 'over';
    s.pops.forEach((p, i) => {
      if (s.done || p.kind === 'decoy' || !isUp(p, s.time) || s.time < p.t + react || skipped.has(i)) return;
      if (rng.chance(skip)) skipped.add(i);
      else {
        // Helmeted critters stay up after the first hit: the next frame hits them again.
        const r = bop(s, p.hole);
        out = r.out || out;
        if (r.power) powers.push(r.power);
      }
    });
  }
  return { s, out, powers };
}

/** The keyboard key for hole `h`. */
const keyOf = (s: State, h: number) => (s.n === 3 ? ['7', '8', '9', '4', '5', '6', '1', '2', '3'][h] : '1234qwerasdfzxcv'[h]);

describe('whack rules', () => {
  it('deals the same pop-ups from the same seed, and others from another', () => {
    expect(createLevel(4, new Rng(3)).kind).toBe(createLevel(4, new Rng(3)).kind);
    expect(createLevel(4, new Rng(3)).pops).toEqual(createLevel(4, new Rng(3)).pops);
    expect(createLevel(4, new Rng(3)).pops).not.toEqual(createLevel(4, new Rng(4)).pops);
  });

  it('deals different kinds of round across seeds, gated by level', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBe(kindsAt(4, KINDS).length);
    for (let seed = 0; seed < 40; seed++) expect(['classic', 'goldrush']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('mixes in the critters each kind is about', () => {
    const count = (kind: KindId, what: string) => createLevel(4, new Rng(2), kind).pops.filter((p) => p.kind === what).length;
    expect(count('goldrush', 'gold')).toBeGreaterThan(count('classic', 'gold') * 2);
    expect(count('spiky', 'decoy')).toBeGreaterThan(count('classic', 'decoy') * 1.5);
    expect(count('helmets', 'helmet')).toBeGreaterThan(5);
    expect(count('hoppers', 'hopper')).toBeGreaterThan(5);
    expect(count('classic', 'helmet') + count('classic', 'hopper')).toBeGreaterThan(0);
    expect(createLevel(1, new Rng(2), 'classic').pops.every((p) => p.kind === 'normal' || p.kind === 'gold')).toBe(true);
    // Waves: critters come out in bunches, a few within a split second of each other.
    const w = createLevel(4, new Rng(2), 'waves').pops;
    expect(w.filter((p, i) => i > 0 && p.t - w[i - 1].t < 0.2).length).toBeGreaterThan(10);
  });

  it('gets harder: more holes, quicker critters, more decoys, more hits to land', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(sizeFor(d)).toBeGreaterThanOrEqual(sizeFor(lo));
      expect(upFor(d)).toBeLessThan(upFor(lo));
      expect(decoyFor(d)).toBeGreaterThanOrEqual(decoyFor(lo));
      expect(createLevel(d, new Rng(1), 'classic').target).toBeGreaterThan(createLevel(lo, new Rng(1), 'classic').target);
    }
    expect(createLevel(1, new Rng(2)).pops.some((p) => p.kind === 'decoy')).toBe(false);
    expect(createLevel(5, new Rng(2), 'classic').pops.filter((p) => p.kind === 'decoy').length).toBeGreaterThan(5);
  });

  it('never pops two critters in the same hole at once, and deals enough to win', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS))
        for (let seed = 1; seed <= 6; seed++) {
          const s = createLevel(d, new Rng(seed), id);
          const clash = s.pops.some((a) => s.pops.some((b) => a !== b && a.hole === b.hole && a.t < b.t + b.dur && b.t < a.t + a.dur));
          expect(clash, `${id} ${d}/${seed}`).toBe(false);
          expect(s.pops.filter((p) => p.kind !== 'decoy' && p.last).length).toBeGreaterThan(s.target);
          expect(s.pops.at(-1)!.t).toBeLessThan(durationFor(d));
        }
  });

  it('jams the mallet after a whiff and costs a heart for a decoy', () => {
    const s = createLevel(5, new Rng(6), 'classic');
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

  it('can win every kind of round, quick or steady, with comparable scores', () => {
    for (const d of [3, 5] as const) {
      const [two] = game.stars(d);
      for (const { id } of kindsAt(d, KINDS))
        for (const seed of [1, 2, 3]) {
          const fast = autopilot(d, seed, 0.25, 0, id);
          expect(fast.out, `${id} fast ${d}/${seed}`).toBe('win');
          expect(fast.s.score, `${id} fast ${d}/${seed}`).toBeGreaterThanOrEqual(two);
          expect(autopilot(d, seed, 0.45, 0.15, id).out, `${id} steady ${d}/${seed}`).toBe('win');
        }
    }
  });

  it('a helmeted critter takes two hits, and pays more', () => {
    const s = createLevel(3, new Rng(1), 'helmets');
    const p = s.pops.find((q) => q.kind === 'helmet')!;
    s.time = p.t + 0.05;
    expect(bop(s, p.hole).out).toBe('clank');
    expect(isUp(p, s.time)).toBe(true);
    expect(s.hits).toBe(0);
    const r = bop(s, p.hole);
    expect(r.out).toBe('hit');
    expect(r.points).toBeGreaterThan(20);
    expect(s.hits).toBe(1);
  });

  it('a hopper jumps holes without breaking the streak, and is gone once caught', () => {
    const s = createLevel(3, new Rng(1), 'hoppers');
    const first = s.pops.find((q) => q.kind === 'hopper' && !q.last)!;
    const run = s.pops.filter((q) => q.chain === first.chain);
    expect(run.length).toBeGreaterThan(1);
    expect(new Set(run.map((q) => q.hole)).size).toBeGreaterThan(1);
    s.time = first.t + first.dur - 0.01;
    s.streak = 3;
    const ev = step(s, 0.02);
    expect(ev.hopped).toBe(true);
    expect(s.streak).toBe(3);
    const next = run[1];
    s.time = next.t + 0.05;
    expect(bop(s, next.hole).out).toBe('hit');
    expect(run.filter((q) => q !== next && q.t > s.time).every((q) => q.gone)).toBe(true);
    expect(s.pops.some((q) => q.chain === first.chain && isUp(q, s.time))).toBe(false);
  });

  it('a streak unlocks slow motion, then a frenzy, then a golden mallet', () => {
    const s = createLevel(5, new Rng(3), 'spiky');
    const tiers: [number, string][] = [];
    const seen = { slowed: 0, tamed: false, spawned: 0, goldPoints: 0 };
    // Hit every hittable critter the moment it pops, skipping the time in between.
    for (const p of s.pops) {
      if (p.kind === 'decoy' || p.hit >= 0 || p.gone || s.done || tiers.length >= 3) continue;
      s.time = Math.max(s.time, p.t + 0.01);
      if (!isUp(p, s.time)) continue;
      let r = bop(s, p.hole);
      if (r.out === 'clank') r = bop(s, p.hole);
      if (r.tier) tiers.push([s.streak, r.power!]);
      if (r.power === 'slow') {
        const t0 = s.time;
        step(s, 0.1);
        seen.slowed = s.time - t0;
        s.slow = 0;
      } else if (r.power === 'frenzy') {
        // Decoys about to pop are tamed, and bonus critters spring up.
        seen.tamed = s.pops.some((q) => q.bonus && q.t > s.time && q.kind === 'normal');
        seen.spawned = step(s, DT).spawned.length;
        s.frenzy = 0;
      } else if (r.power === 'golden') {
        const q = s.pops.find((x) => x.kind === 'normal' && x.t > s.time && !x.bonus)!;
        s.time = q.t + 0.01;
        seen.goldPoints = bop(s, q.hole).points;
      }
    }
    expect(tiers).toEqual([
      [STREAK_TIERS[0], 'slow'],
      [STREAK_TIERS[1], 'frenzy'],
      [STREAK_TIERS[2], 'golden'],
    ]);
    expect(seen.slowed).toBeCloseTo(0.1 * SLOW_RATE);
    expect(seen.tamed).toBe(true);
    expect(seen.spawned).toBeGreaterThan(0);
    expect(seen.goldPoints).toBeGreaterThanOrEqual(GOLD_POINTS);
  });

  it('a good player reaches the combo powers in a normal run', () => {
    for (const d of LEVELS) expect(autopilot(d, 2, 0.3, 0).powers.slice(0, 3), `level ${d}`).toEqual(['slow', 'frenzy', 'golden']);
  });

  it('is lost when time runs out, or by hitting decoys', () => {
    const lazy = autopilot(3, 2, 0.25, 0.7);
    expect(lazy.out).toBe('over');
    const s = createLevel(5, new Rng(8), 'classic');
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
      while (!m.outcome && s.time < s.duration) {
        m.inst.frame?.(DT);
        step(s, DT);
        s.pops.forEach((p) => {
          // Anything still up gets hit again (helmets take two).
          if (s.done || p.kind === 'decoy' || !isUp(p, s.time) || s.time < p.t + 0.3) return;
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

  it('names the kind of round it dealt on the start gate, in both languages', () => {
    for (const lang of ['en', 'fr'] as const) {
      _setLocaleForTests(lang);
      for (let seed = 1; seed <= 30; seed++) {
        const m = mountGame(game, 4, seed);
        expect(m.variant?.id).toBe(createLevel(4, new Rng(seed)).kind);
        expect(m.variant!.name.length).toBeLessThanOrEqual(18);
        expect(m.variant!.blurb!.length).toBeLessThanOrEqual(60);
        m.inst.destroy?.();
        m.root.remove();
      }
    }
    _setLocaleForTests('en');
  });

  it('is lost when nothing gets hit', () => {
    const m = mountGame(game, 2, 1);
    m.run(durationFor(2) + 1);
    expect(m.outcome).toBe('lose');
    m.inst.destroy?.();
    m.root.remove();
  });
});
