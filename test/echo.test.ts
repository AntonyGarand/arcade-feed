import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { echo } from '../src/games/echo';
import {
  beatFor,
  beatOf,
  COMBO_TIERS,
  createLevel,
  ghost,
  IDLE_S,
  KINDS,
  lenOf,
  lit,
  livesFor,
  maxScore,
  padsFor,
  playback,
  press,
  roundsFor,
  runSeconds,
  step,
  TAP_POINTS,
  wanted,
  type KindId,
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

/** The taps that answer what was seen: backwards on a reverse level. */
const answer = (s: State, seen: number[]) => (s.kind === 'reverse' ? seen.slice().reverse() : seen);

/**
 * Repeat what was played back (seen, not read from the state), slipping on the first tap of a round
 * with chance `slip` (on a different pad).
 */
function autopilot(d: Difficulty, seed: number, slip: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const rng = new Rng(seed + 99);
  let out: PressResult = '';
  while (out !== 'win' && out !== 'lose') {
    const seen = answer(s, watch(s));
    if (s.phase === 'done') break;
    const wrong = rng.chance(slip);
    for (const [i, k] of seen.entries()) {
      step(s, 0.4); // think, tap
      out = press(s, wrong && i === 0 ? (k + 1) % s.n : k);
      if (out === 'shield') out = press(s, k); // the shield took it: tap the right one
      if (out !== 'ok') break;
    }
  }
  return { s, out };
}

describe('echo rules', () => {
  it('deals the same sequence from the same seed, and another from another', () => {
    expect(createLevel(3, new Rng(7)).kind).toBe(createLevel(3, new Rng(7)).kind);
    expect(createLevel(3, new Rng(7)).fakes).toEqual(createLevel(3, new Rng(7)).fakes);
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
    const s = createLevel(2, new Rng(3), 'classic');
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
      // One slip still clears with two stars; more cost the third.
      const one = createLevel(d, new Rng(1), 'classic');
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
    const s = createLevel(1, new Rng(4), 'classic');
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

describe('echo level kinds', () => {
  it('deals different kinds across seeds, gated by level', () => {
    for (const d of LEVELS) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 80; seed++) seen.add(createLevel(d, new Rng(seed)).kind);
      expect(seen.size, `level ${d}`).toBe(kindsAt(d, KINDS).length);
    }
    for (let seed = 0; seed < 30; seed++) expect(['classic', 'rush', 'wide']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('clears every kind allowed at every level with a perfect memory, for the same top score', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS))
        for (const seed of [1, 2, 3]) {
          const r = autopilot(d, seed, 0, id);
          expect(r.out, `${id} ${d}/${seed}`).toBe('win');
          expect(r.s.score, `${id} ${d}/${seed}`).toBe(maxScore(d));
          expect(r.s.score).toBeGreaterThanOrEqual(echo.stars(d)[1]);
        }
  });

  it('mostly clears every kind with the odd slip', () => {
    for (const d of [2, 4, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const wins = [1, 2, 3, 4, 5, 6].filter((seed) => autopilot(d, seed, 0.15, id).out === 'win').length;
        expect(wins, `${id} level ${d}`).toBeGreaterThanOrEqual(4);
      }
  });

  it('makes each kind play differently', () => {
    // Big ring: more pads. Rush: the playback quickens round after round.
    expect(createLevel(2, new Rng(1), 'wide').n).toBe(padsFor(2) + 2);
    const rush = createLevel(3, new Rng(1), 'rush');
    const first = beatOf(rush);
    rush.round = 4;
    expect(beatOf(rush)).toBeLessThan(first * 0.8);
    // Backwards: the last step comes first.
    const rev = createLevel(3, new Rng(2), 'reverse');
    watch(rev);
    expect(press(rev, rev.seq[lenOf(rev) - 1])).toBe('ok');
    // Shuffle: after a round, pads trade places (still one pad per slot).
    const sw = createLevel(4, new Rng(3), 'swap');
    watch(sw);
    for (let i = 0; i < lenOf(sw); i++) press(sw, sw.seq[i]);
    expect(sw.slot).not.toEqual([...Array(sw.n).keys()]);
    expect([...sw.slot].sort((a, b) => a - b)).toEqual([...Array(sw.n).keys()]);
    // Tricksters: decoy flashes play from round 2, but aren't part of what you repeat.
    const tr = createLevel(5, new Rng(4), 'tricks');
    tr.round = 3;
    expect(playback(tr).filter((b) => b.fake).length).toBeGreaterThan(0);
    tr.phase = 'show';
    let ghosts = 0;
    const real: number[] = [];
    let last = -1;
    for (let i = 0; i < 2000 && tr.phase === 'show'; i++) {
      step(tr, DT);
      if (ghost(tr) >= 0) ghosts++;
      const k = lit(tr);
      if (k >= 0 && k !== last) real.push(k);
      last = k;
    }
    expect(ghosts).toBeGreaterThan(0);
    expect(real).toEqual(tr.seq.slice(0, lenOf(tr)));
  });

  it('pays each golden step once', () => {
    const s = createLevel(2, new Rng(5), 'classic');
    expect(s.gold.length).toBeGreaterThan(0);
    s.round = s.rounds; // the whole sequence in one go
    s.phase = 'input';
    let gold = 0;
    for (let i = 0; i < lenOf(s); i++) {
      const before = s.score;
      press(s, s.seq[i]);
      if (i < lenOf(s) - 1 && s.score - before > TAP_POINTS * 2) gold++;
    }
    expect(gold).toBe(s.gold.filter((i) => i < lenOf(s) - 1).length);
    expect(s.goldGot.every(Boolean)).toBe(true);
  });
});

describe('echo combos', () => {
  /** Tap the next step right until the combo reaches `n` (stepping playbacks as needed); returns what unlocked. */
  function tapUntil(s: State, n: number) {
    const fired: string[] = [];
    for (let i = 0; i < 20000 && s.combo < n && s.phase !== 'done'; i++) {
      if (s.phase !== 'input') step(s, DT);
      else {
        press(s, wanted(s));
        if (s.unlocked) fired.push(s.unlocked);
      }
    }
    return fired;
  }

  it('fires each milestone once, in order, on a long clean run', () => {
    const s = createLevel(5, new Rng(1), 'classic');
    expect(tapUntil(s, 99)).toEqual(['shield', 'double', 'hint', 'slow', 'heart']);
    expect(s.phase).toBe('done');
  });

  it('a shield forgives one wrong tap: no heart lost, same step, combo reset', () => {
    const s = createLevel(3, new Rng(2), 'classic');
    tapUntil(s, COMBO_TIERS[0]);
    expect(s.shield).toBe(true);
    while (s.phase !== 'input') step(s, DT);
    const pos = s.pos;
    expect(press(s, (wanted(s) + 1) % s.n)).toBe('shield');
    expect(s.lives).toBe(livesFor(3));
    expect(s.pos).toBe(pos);
    expect(s.combo).toBe(0);
    expect(s.shield).toBe(false);
    expect(press(s, (wanted(s) + 1) % s.n)).toBe('slip');
    expect(s.lives).toBe(livesFor(3) - 1);
  });

  it('doubles points, shows hints and slows the replay while they last', () => {
    const s = createLevel(4, new Rng(3), 'classic');
    tapUntil(s, COMBO_TIERS[1]);
    expect(s.dbl).toBeGreaterThan(0);
    while (s.phase !== 'input') step(s, DT);
    const before = s.score;
    press(s, wanted(s));
    expect(s.score - before).toBeGreaterThanOrEqual(TAP_POINTS * 2);
    tapUntil(s, COMBO_TIERS[2]);
    expect(s.hint).toBeGreaterThan(0);
    const plain = beatOf(s);
    tapUntil(s, COMBO_TIERS[3]);
    expect(s.slow).toBeGreaterThan(0);
    expect(beatOf(s)).toBeGreaterThan(plain);
  });

  it('a wrong tap breaks the combo', () => {
    const s = createLevel(2, new Rng(4), 'classic');
    tapUntil(s, 3);
    while (s.phase !== 'input') step(s, DT);
    press(s, (wanted(s) + 1) % s.n);
    expect(s.combo).toBe(0);
  });
});

describe('echo game', () => {
  it('mounts, names its kind, plays back and reports score, hearts and status', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(echo, d, 2);
      expect(m.variant?.id).toBe(createLevel(d, new Rng(2)).kind);
      expect(m.variant?.name.length).toBeLessThanOrEqual(18);
      expect(m.variant?.blurb?.length).toBeLessThanOrEqual(60);
      expect(m.lives).toEqual([livesFor(d), livesFor(d)]);
      expect(m.status).toContain(`1/${roundsFor(d)}`);
      m.run(3);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is won with the number keys, repeating what lit up', () => {
    for (const d of [1, 3, 5] as const)
      for (const seed of [6, 7]) {
        const m = mountGame(echo, d, seed);
        const s = createLevel(d, new Rng(seed)); // the same level, stepped alongside to see the lights
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
          for (const k of answer(s, seen)) key(k);
        }
        expect(m.outcome, `${s.kind} ${d}/${seed}`).toBe('win');
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
      const wrong = (wanted(s) + 1) % s.n;
      m.inst.onKey?.(new KeyboardEvent('keydown', { key: String(wrong + 1) }));
      press(s, wrong);
    }
    expect(m.outcome).toBe('lose');
    expect(m.lives).toEqual([0, livesFor(5)]);
  });
});
