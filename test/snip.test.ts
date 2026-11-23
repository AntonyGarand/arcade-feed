import { afterEach, describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS } from '../src/core/types';
import { snip } from '../src/games/snip';
import {
  act,
  type Action,
  BUBBLE_R,
  createLevel,
  CRIT_Y,
  cut,
  DELIVER_PTS,
  FPS,
  pop,
  ropesFor,
  SPEED_PTS,
  spikesFor,
  STAR_PTS,
  type State,
  step,
  swipe,
  tolFor,
} from '../src/games/snip/rules';
import { type Mounted, mountGame } from './support/mount';

const DT = 1 / FPS;

/** Play a plan frame by frame (wait = frames after the previous action); returns how the run ended. */
function replay(s: State, plan: Action[], seconds = 20): State['phase'] {
  let i = 0;
  let since = 0;
  for (let f = 0; f < seconds * FPS && s.phase === 'play'; f++) {
    while (i < plan.length && since >= plan[i].wait) {
      act(s, plan[i++]);
      since = 0;
    }
    step(s, DT);
    since++;
  }
  return s.phase;
}

const press = (m: Mounted, key: string) => m.inst.onKey?.(new KeyboardEvent('keydown', { key }));

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.inst.destroy?.();
  mounted?.root.remove();
  mounted = null;
});

describe('snip rules', () => {
  it('deals the same level from the same seed', () => {
    const a = createLevel(4, new Rng(42));
    const b = createLevel(4, new Rng(42));
    expect(a.ropes.map((r) => [r.ax, r.ay, r.len])).toEqual(b.ropes.map((r) => [r.ax, r.ay, r.len]));
    expect([a.critter, a.stars, a.spikes, a.plan]).toEqual([b.critter, b.stars, b.spikes, b.plan]);
    expect(createLevel(4, new Rng(43)).plan).not.toEqual(a.plan);
  });

  it('adds ropes, bubbles and spikes as the levels go up', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(3));
      expect(s.ropes.length, `level ${d}`).toBe(ropesFor(d));
      expect(s.spikes.length, `level ${d}`).toBe(spikesFor(d));
      expect(s.stars.length).toBe(3);
      expect(!!s.bubble, `level ${d}`).toBe(d === 3 || d === 5);
    }
    expect(ropesFor(5)).toBeGreaterThan(ropesFor(1));
    expect(tolFor(5)).toBeLessThan(tolFor(1));
  });

  it('keeps the sweet still until the first cut', () => {
    const s = createLevel(2, new Rng(9));
    const { x, y } = s;
    for (let i = 0; i < 10 * FPS; i++) step(s, DT);
    expect(s.phase).toBe('play');
    expect(Math.hypot(s.x - x, s.y - y)).toBeLessThan(0.5);
  });

  it('cuts the ropes a swipe crosses, and only those', () => {
    const s = createLevel(1, new Rng(5));
    for (let i = 0; i < 30; i++) step(s, DT);
    const [r0, r1] = s.ropes;
    const mx = (r0.nx[4] + r0.nx[5]) / 2;
    const my = (r0.ny[4] + r0.ny[5]) / 2;
    const dx = r0.ny[5] - r0.ny[4];
    const dy = r0.nx[4] - r0.nx[5];
    const hits = swipe(s, mx - dx, my - dy, mx + dx, my + dy);
    expect(hits.map((h) => h.rope)).toEqual([0]);
    expect(r0.cut).toBe(true);
    expect(r1.cut).toBe(false);
    expect(swipe(s, 0, 395, 10, 399)).toEqual([]);
  });

  it('swings on the last rope, then falls once every rope is cut', () => {
    const s = createLevel(1, new Rng(8));
    const y = s.y;
    cut(s, 0);
    for (let i = 0; i < 20; i++) step(s, DT);
    expect(Math.hypot(s.x - s.ropes[1].ax, s.y - s.ropes[1].ay)).toBeLessThanOrEqual(s.ropes[1].len + 0.01);
    cut(s, 1);
    for (let i = 0; i < 20; i++) step(s, DT);
    expect(s.y).toBeGreaterThan(y);
  });

  it('floats the sweet up in a bubble until it pops', () => {
    const s = createLevel(3, new Rng(4));
    s.bubble = { x: s.x, y: s.y + 40, held: false, popped: false };
    for (const i of s.ropes.keys()) cut(s, i);
    let captured = false;
    for (let i = 0; i < 40 && !captured; i++) captured = step(s, DT).captured;
    expect(captured).toBe(true);
    const y = s.y;
    for (let i = 0; i < 30; i++) step(s, DT);
    expect(s.y).toBeLessThan(y);
    expect(Math.hypot(s.bubble.x - s.x, s.bubble.y - s.y)).toBeLessThan(BUBBLE_R);
    expect(pop(s)).toBe(true);
    for (let i = 0; i < 30; i++) step(s, DT);
    expect(s.y).toBeGreaterThan(y - 30);
  });

  it('can be cleared at every level by replaying the generator’s plan, stars and all', () => {
    for (const d of LEVELS)
      for (const seed of [1, 2, 3, 7, 11, 19, 23, 42]) {
        const s = createLevel(d, new Rng(seed));
        expect(replay(s, s.plan), `level ${d} seed ${seed}`).toBe('won');
        expect(s.got, `level ${d} seed ${seed}`).toBe(3);
        expect(s.score).toBe(3 * STAR_PTS + DELIVER_PTS + SPEED_PTS);
        expect(s.score).toBeGreaterThanOrEqual(snip.stars(d)[1]);
      }
  });

  it('forgives a little timing slack on every action', () => {
    for (const d of LEVELS)
      for (const seed of [5, 6]) {
        const base = createLevel(d, new Rng(seed));
        for (let j = 1; j < base.plan.length; j++)
          for (const sign of [-1, 1]) {
            const s = createLevel(d, new Rng(seed));
            const plan = s.plan.map((a, k) => (k === j ? { ...a, wait: Math.max(0, a.wait + sign * tolFor(d)) } : a));
            expect(replay(s, plan), `level ${d} seed ${seed} action ${j}`).toBe('won');
          }
      }
  });

  it('is lost when every rope is cut at once', () => {
    for (const d of LEVELS)
      for (const seed of [1, 2, 3]) {
        const s = createLevel(d, new Rng(seed));
        const plan = s.ropes.map((_, i) => ({ rope: i, wait: i ? 0 : 30 }));
        expect(replay(s, plan), `level ${d} seed ${seed}`).toBe('lost');
      }
  });

  it('places the critter on the floor under the solution’s landing point', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(13));
      expect(s.critter!.y).toBe(CRIT_Y);
      expect(s.critter!.x).toBeGreaterThanOrEqual(40);
      expect(s.critter!.x).toBeLessThanOrEqual(260);
    }
  });
});

describe('snip game', () => {
  it('wins through the keyboard, reporting the score', () => {
    for (const d of LEVELS) {
      const { plan } = createLevel(d, new Rng(21));
      const m = (mounted = mountGame(snip, d, 21));
      let since = 0;
      let i = 0;
      for (let f = 0; f < 20 * FPS && !m.outcome; f++) {
        while (i < plan.length && since >= plan[i].wait) {
          const a = plan[i++];
          press(m, a.rope < 0 ? ' ' : String(a.rope + 1));
          since = 0;
        }
        m.run(DT);
        since++;
      }
      expect(m.outcome, `level ${d}`).toBe('win');
      expect(m.score).toBeGreaterThanOrEqual(snip.stars(d)[1]);
      mounted.inst.destroy?.();
      mounted.root.remove();
      mounted = null;
    }
  });

  it('loses when the ropes are all cut at once, and reports ropes in the status', () => {
    const m = (mounted = mountGame(snip, 1, 3));
    expect(m.status).toContain('2 ropes left');
    m.run(0.5);
    press(m, '1');
    press(m, '2');
    expect(m.status).toContain('0 ropes left');
    m.run(10);
    expect(m.outcome).toBe('lose');
  });

  it('runs every level for a while without ending on its own', () => {
    for (const d of LEVELS) {
      const m = mountGame(snip, d, 99);
      m.run(5);
      expect(m.outcome, `level ${d}`).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
