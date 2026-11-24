import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { runner } from '../src/games/runner';
import {
  APEX_S,
  coinsFor,
  createLevel,
  duck,
  lengthFor,
  LIFE_BONUS,
  livesFor,
  press,
  PW,
  release,
  slackFor,
  speedAt,
  speedFor,
  step,
  type State,
} from '../src/games/runner/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Next obstacle not yet behind the runner. */
const ahead = (s: State) => s.obstacles.find((o) => o.x + o.w > s.x - PW / 2);

/**
 * Jump so the top of a full jump is over the middle of each block or pit, duck under bars. `late`
 * reacts this many seconds late (a sloppy player).
 */
function autopilot(d: Difficulty, seed: number, late = 0) {
  const s = createLevel(d, new Rng(seed));
  for (let t = 0; t < 200; t += DT) {
    const o = ahead(s);
    const v = speedAt(d, s.x);
    s.duckKey = false;
    if (o?.kind === 'bar') s.duckKey = o.x - (s.x + PW / 2) < v * (0.1 - late);
    else if (o && s.grounded && o.x + o.w / 2 - s.x <= v * (APEX_S - late)) press(s);
    if (s.grounded && s.holding) release(s);
    const ev = step(s, DT);
    if (ev.won) return { s, win: true };
    if (ev.over) return { s, win: false };
  }
  throw new Error('never ended');
}

describe('runner rules', () => {
  it('deals the same track from the same seed', () => {
    const a = createLevel(3, new Rng(8));
    expect(a.obstacles).toEqual(createLevel(3, new Rng(8)).obstacles);
    expect(a.coins).toEqual(createLevel(3, new Rng(8)).coins);
    expect(a.obstacles).not.toEqual(createLevel(3, new Rng(9)).obstacles);
    expect(a.coins.length).toBe(coinsFor(3));
  });

  it('gets harder: longer, faster, denser, fewer lives, new obstacle kinds', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(lengthFor(d)).toBeGreaterThan(lengthFor(lo));
      expect(speedFor(d)).toBeGreaterThan(speedFor(lo));
      expect(slackFor(d)).toBeLessThan(slackFor(lo));
      expect(livesFor(d)).toBeLessThanOrEqual(livesFor(lo));
    }
    const kinds = (d: Difficulty) => new Set(createLevel(d, new Rng(1)).obstacles.map((o) => o.kind));
    expect([...kinds(1)]).toEqual(['block']);
    expect(kinds(2).has('pit')).toBe(true);
    expect(kinds(4).has('bar')).toBe(true);
    // Speed also ramps within the run.
    expect(speedAt(1, lengthFor(1))).toBeGreaterThan(speedAt(1, 0));
  });

  it('jumps higher when held than when tapped', () => {
    const peak = (hold: boolean) => {
      const s = createLevel(1, new Rng(1));
      press(s);
      if (!hold) release(s);
      let top = 0;
      for (let i = 0; i < 40; i++) {
        step(s, DT);
        top = Math.max(top, s.y);
      }
      return top;
    };
    expect(peak(true)).toBeGreaterThan(peak(false) * 2);
  });

  it('is cleared by a well-timed autopilot at every level, a sloppy one scoring less', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed));
      const [two, three] = runner.stars(d);
      for (const r of runs) {
        expect(r.win, `level ${d}`).toBe(true);
        expect(r.s.score, `level ${d}`).toBeGreaterThanOrEqual(three);
        expect(r.s.score).toBeGreaterThanOrEqual(r.s.lives * LIFE_BONUS);
      }
      // Jumping a little early is forgiven: every obstacle leaves some slack.
      for (const seed of [1, 2, 3]) expect(autopilot(d, seed, -0.08).win, `level ${d} early`).toBe(true);
      // A tenth of a second late misses coins (or worse): never three stars.
      const sloppy = [1, 2, 3].map((seed) => autopilot(d, seed, 0.1)).filter((r) => r.win);
      expect(sloppy.filter((r) => r.s.score >= three)).toEqual([]);
      expect(two).toBeLessThan(three);
    }
  });

  it('costs a heart for a block, a pit or a bar, and ends at zero', () => {
    for (const d of [1, 3, 5] as const) {
      const s = createLevel(d, new Rng(2));
      let hurt = 0;
      let over = false;
      for (let t = 0; t < 120 && !over; t += DT) {
        const ev = step(s, DT); // never jump
        if (ev.hurt) hurt++;
        over = ev.over;
      }
      expect(over, `level ${d}`).toBe(true);
      expect(hurt).toBe(livesFor(d));
    }
  });

  it('cancels the hop a swipe starts with, so a swipe down under a bar never lifts you into it', () => {
    const s = createLevel(5, new Rng(3));
    const bar = s.obstacles.find((o) => o.kind === 'bar')!;
    s.x = bar.x - 30;
    press(s); // the press that starts the swipe jumps…
    step(s, DT);
    step(s, DT);
    duck(s); // …and the swipe down undoes it
    expect(s.grounded).toBe(true);
    expect(s.y).toBe(0);
    let hurt = false;
    for (let i = 0; i < 20; i++) hurt ||= step(s, DT).hurt;
    expect(hurt).toBe(false);
  });

  it('ducks under a bar with a swipe', () => {
    const s = createLevel(5, new Rng(3));
    const bar = s.obstacles.find((o) => o.kind === 'bar')!;
    s.x = bar.x - 40;
    duck(s);
    let hurt = false;
    for (let i = 0; i < 20; i++) hurt ||= step(s, DT).hurt;
    expect(hurt).toBe(false);
    expect(s.x).toBeGreaterThan(bar.x + bar.w);
  });
});

describe('runner card', () => {
  const key = (m: ReturnType<typeof mountGame>, type: 'keydown' | 'keyup', k: string) =>
    m.inst.onKey?.(new KeyboardEvent(type, { key: k }));

  for (const d of [1, 5] as const)
    it(`mounts at level ${d}, runs and jumps with the keyboard`, () => {
      const m = mountGame(runner, d, 4);
      expect(m.lives).toEqual([livesFor(d), livesFor(d)]);
      expect(m.status).not.toBe('');
      expect(key(m, 'keydown', ' ')).toBe(true);
      m.run(0.2);
      expect(key(m, 'keyup', ' ')).toBe(true);
      expect(key(m, 'keydown', 'ArrowDown')).toBe(true);
      m.run(0.3);
      key(m, 'keyup', 'ArrowDown');
      const before = m.status;
      m.run(1.5);
      expect(m.outcome).toBe('');
      expect(m.status).not.toBe(before);
      // Never jumping again: the obstacles take every heart.
      m.run(90);
      expect(m.outcome).toBe('lose');
      m.inst.destroy?.();
      m.root.remove();
    });
});
