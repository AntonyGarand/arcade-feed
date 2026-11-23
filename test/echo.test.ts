import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { echo } from '../src/games/echo';
import {
  beatFor,
  createLevel,
  IDLE_S,
  lenOf,
  lit,
  livesFor,
  maxScore,
  padsFor,
  press,
  roundsFor,
  runSeconds,
  step,
  type PressResult,
  type State,
} from '../src/games/echo/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Run frames until it's the player's turn (or the run ends); returns the pads seen lit, in order. */
function watch(s: State, frame: (dt: number) => void = (dt) => step(s, dt)): number[] {
  const seen: number[] = [];
  let last = -1;
  for (let i = 0; i < 6000 && s.phase !== 'input' && s.phase !== 'done'; i++) {
    frame(DT);
    const k = lit(s);
    if (k >= 0 && k !== last) seen.push(k);
    last = k;
  }
  return seen;
}

/**
 * Repeat what was played back (seen, not read from the state), slipping on the first tap of a round
 * with chance `slip` (on a different pad).
 */
function autopilot(d: Difficulty, seed: number, slip: number) {
  const s = createLevel(d, new Rng(seed));
  const rng = new Rng(seed + 99);
  let out: PressResult = '';
  while (out !== 'win' && out !== 'lose') {
    const seen = watch(s);
    if (s.phase === 'done') break;
    const wrong = rng.chance(slip);
    for (const [i, k] of seen.entries()) {
      step(s, 0.4); // think, tap
      out = press(s, wrong && i === 0 ? (k + 1) % s.n : k);
      if (out !== 'ok') break;
    }
  }
  return { s, out };
}

describe('echo rules', () => {
  it('deals the same sequence from the same seed, and another from another', () => {
    expect(createLevel(3, new Rng(7)).seq).toEqual(createLevel(3, new Rng(7)).seq);
    expect(createLevel(3, new Rng(7)).seq).not.toEqual(createLevel(3, new Rng(8)).seq);
  });

  it('never plays the same pad three times in a row and uses only the pads on the ring', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 20; seed++) {
        const { seq, n } = createLevel(d, new Rng(seed));
        expect(seq.every((k, i) => k >= 0 && k < n && !(i >= 2 && seq[i - 1] === k && seq[i - 2] === k))).toBe(true);
      }
  });

  it('gets harder: more pads, more rounds, faster playback', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(padsFor(d)).toBeGreaterThanOrEqual(padsFor(lo));
      expect(roundsFor(d)).toBeGreaterThanOrEqual(roundsFor(lo));
      expect(beatFor(d)).toBeLessThan(beatFor(lo));
      expect(maxScore(d)).toBeGreaterThan(maxScore(lo));
    }
    expect(padsFor(5)).toBeGreaterThanOrEqual(6);
    for (const d of LEVELS) {
      expect(runSeconds(d)).toBeGreaterThan(20);
      expect(runSeconds(d)).toBeLessThan(75);
    }
  });

  it('plays the round back in frames, growing by one each round', () => {
    const s = createLevel(2, new Rng(3));
    const first = watch(s);
    expect(first.length).toBe(lenOf(s));
    expect(press(s, s.seq[0])).toBe('ok');
    expect(press(s, s.seq[1])).toBe('round');
    expect(watch(s).length).toBe(lenOf(s));
    expect(lenOf(s)).toBe(first.length + 1);
  });

  it('is cleared by a perfect memory at every level with the top score', () => {
    for (const d of LEVELS) {
      const [two, three] = echo.stars(d);
      for (let seed = 1; seed <= 4; seed++) {
        const r = autopilot(d, seed, 0);
        expect(r.out, `${d}/${seed}`).toBe('win');
        expect(r.s.score).toBe(maxScore(d));
        expect(r.s.score).toBeGreaterThanOrEqual(three);
      }
      // One slip still clears with two stars; more cost the second star.
      const one = createLevel(d, new Rng(1));
      watch(one);
      press(one, (one.seq[0] + 1) % one.n);
      let out: PressResult = '';
      while (out !== 'win') {
        watch(one);
        for (let i = 0; i < lenOf(one) && out !== 'win'; i++) out = press(one, one.seq[i]);
      }
      expect(one.score).toBeGreaterThanOrEqual(two);
      expect(one.score).toBeLessThan(three);
    }
  });

  it('mostly clears with the odd slip', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed, 0.15));
      expect(runs.filter((r) => r.out === 'win').length, `level ${d}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('costs a heart for a wrong pad or a long wait, and replays the round', () => {
    const s = createLevel(1, new Rng(4));
    watch(s);
    expect(press(s, (s.seq[0] + 1) % s.n)).toBe('slip');
    expect(s.lives).toBe(livesFor(1) - 1);
    expect(s.phase).toBe('bad');
    expect(watch(s)).toEqual(s.seq.slice(0, lenOf(s)));
    let timeout: PressResult = '';
    for (let t = 0; t < IDLE_S + 0.1 && !timeout; t += DT) timeout = step(s, DT).timeout;
    expect(timeout).toBe('slip');
    watch(s);
    expect(press(s, (s.seq[0] + 1) % s.n)).toBe('lose');
    expect(s.phase).toBe('done');
  });
});

describe('echo game', () => {
  it('mounts, plays back and reports score, hearts and status', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(echo, d, 2);
      expect(m.lives).toEqual([livesFor(d), livesFor(d)]);
      expect(m.status).toContain(`1/${roundsFor(d)}`);
      m.run(3);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is won with the number keys, repeating what lit up', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(echo, d, 6);
      const s = createLevel(d, new Rng(6)); // the same level, stepped alongside to see the lights
      const key = (k: number) => {
        m.inst.onKey?.(new KeyboardEvent('keydown', { key: String(k + 1) }));
        m.inst.onKey?.(new KeyboardEvent('keyup', { key: String(k + 1) }));
        press(s, k);
      };
      while (!m.outcome) {
        const seen = watch(s, (dt) => {
          step(s, dt);
          m.inst.frame?.(dt);
        });
        for (const k of seen) key(k);
      }
      expect(m.outcome).toBe('win');
      expect(m.score).toBe(maxScore(d));
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is lost by tapping the wrong pads', () => {
    const m = mountGame(echo, 5, 3);
    const s = createLevel(5, new Rng(3));
    while (!m.outcome) {
      watch(s, (dt) => {
        step(s, dt);
        m.inst.frame?.(dt);
      });
      const wrong = (s.seq[0] + 1) % s.n;
      m.inst.onKey?.(new KeyboardEvent('keydown', { key: String(wrong + 1) }));
      press(s, wrong);
    }
    expect(m.outcome).toBe('lose');
    expect(m.lives).toEqual([0, livesFor(5)]);
  });
});
