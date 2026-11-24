import { afterEach, describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { _setLocaleForTests } from '../src/core/i18n';
import { LEVELS } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { snip } from '../src/games/snip';
import {
  act,
  type Action,
  BUBBLE_R,
  catchR,
  CHAIN_TIERS,
  createLevel,
  CRIT_Y,
  cut,
  DELIVER_PTS,
  FPS,
  KINDS,
  MAGNET_R,
  pop,
  ropesFor,
  SPEED_PTS,
  spikesFor,
  SPRINKLE_PTS,
  STAR_PTS,
  type State,
  step,
  swipe,
  tolFor,
} from '../src/games/snip/rules';
import { type Mounted, mountGame } from './support/mount';

const DT = 1 / FPS;

/** Play a plan frame by frame (wait = frames after the previous action); returns how the run ended. */
function replay(s: State, plan: Action[], seconds = 20, tiers: number[] = []): State['phase'] {
  let i = 0;
  let since = 0;
  for (let f = 0; f < seconds * FPS && s.phase === 'play'; f++) {
    while (i < plan.length && since >= plan[i].wait) {
      act(s, plan[i++]);
      since = 0;
    }
    const ev = step(s, DT);
    if (ev.tier) tiers.push(ev.tier);
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
    expect(a.kind).toBe(b.kind);
    expect([a.critter, a.stars, a.spikes, a.plan, a.sprinkles, a.saws, a.wind, a.pace]).toEqual([
      b.critter,
      b.stars,
      b.spikes,
      b.plan,
      b.sprinkles,
      b.saws,
      b.wind,
      b.pace,
    ]);
    expect(createLevel(4, new Rng(43)).plan).not.toEqual(a.plan);
  });

  it('adds ropes and spikes as the levels go up, and deals each kind its own pieces', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const s = createLevel(d, new Rng(3), id);
        const at = `${id} level ${d}`;
        expect(s.kind).toBe(id);
        expect(s.ropes.length, at).toBe(ropesFor(d));
        expect(s.stars.length, at).toBe(3);
        expect(s.sprinkles.length, at).toBeGreaterThanOrEqual(3);
        expect(!!s.bubble, at).toBe(id === 'bubble');
        expect(s.wind !== 0, at).toBe(id === 'breeze');
        expect(!!s.pace, at).toBe(id === 'pacer');
        const saws = id === 'saws';
        expect(s.saws.length, at).toBe(saws ? (d >= 5 ? 3 : 2) : 0);
        expect(s.spikes.length, at).toBe(saws ? Math.max(0, spikesFor(d) - 1) : spikesFor(d));
      }
    expect(ropesFor(5)).toBeGreaterThan(ropesFor(1));
    expect(tolFor(5)).toBeLessThan(tolFor(1));
  });

  it('deals different kinds across seeds, gated by level', () => {
    for (const d of [1, 4] as const) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 40; seed++) seen.add(createLevel(d, new Rng(seed)).kind);
      expect(seen.size, `level ${d}`).toBeGreaterThanOrEqual(3);
      for (const k of seen) expect(kindsAt(d, KINDS).map((x) => x.id)).toContain(k);
    }
  });

  it('clears every kind at every level by replaying its plan, chaining pickups into milestones', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS))
        for (const seed of [4, 8]) {
          const s = createLevel(d, new Rng(seed), id);
          const tiers: number[] = [];
          const at = `${id} level ${d} seed ${seed}`;
          expect(replay(s, s.plan, 20, tiers), at).toBe('won');
          expect(s.got, at).toBe(3);
          expect(
            s.sprinkles.every((p) => p.got),
            at,
          ).toBe(true);
          expect(tiers[0], at).toBe(1);
          expect(s.power, at).toBeGreaterThanOrEqual(2);
          expect(s.score, at).toBeGreaterThanOrEqual(snip.stars(d)[1]);
        }
  });

  it('keeps pacing critters and saws still until the first cut, then moves them', () => {
    const p = createLevel(2, new Rng(6), 'pacer');
    const w = createLevel(4, new Rng(6), 'saws');
    const x0 = p.critter!.x;
    const sw0 = { ...w.saws[0] };
    for (let i = 0; i < 60; i++) {
      step(p, DT);
      step(w, DT);
    }
    expect(p.critter!.x).toBe(x0);
    expect([w.saws[0].x, w.saws[0].y]).toEqual([sw0.x, sw0.y]);
    cut(p, 0);
    cut(w, 0);
    for (let i = 0; i < 30; i++) {
      step(p, DT);
      step(w, DT);
    }
    expect(Math.abs(p.critter!.x - x0)).toBeGreaterThan(1);
    expect(Math.hypot(w.saws[0].x - sw0.x, w.saws[0].y - sw0.y)).toBeGreaterThan(1);
  });

  it('blows the sweet downwind in a breeze', () => {
    const s = createLevel(3, new Rng(2), 'breeze');
    const calm = createLevel(3, new Rng(2), 'breeze');
    calm.wind = 0;
    for (const t of [s, calm]) for (const i of t.ropes.keys()) cut(t, i);
    for (let i = 0; i < 30; i++) {
      step(s, DT);
      step(calm, DT);
    }
    expect(Math.sign(s.x - calm.x)).toBe(Math.sign(s.wind));
  });

  it('unlocks a magnet, a golden sweet and a feast as the chain grows', () => {
    const s = createLevel(1, new Rng(5), 'classic');
    s.stars = [];
    // Drop a pickup on the resting sweet every frame: it scoops each one up.
    const n = CHAIN_TIERS[2];
    s.sprinkles = [];
    const tiers: number[] = [];
    for (let i = 0; i < n; i++) {
      s.sprinkles.push({ x: s.x, y: s.y, got: false });
      const ev = step(s, DT);
      if (ev.tier) tiers.push(ev.tier);
    }
    expect(tiers).toEqual([1, 2, 3]);
    expect(s.power).toBe(3);
    expect(s.chain.mult).toBe(4);
    expect(s.score).toBeGreaterThan(n * SPRINKLE_PTS);
    expect(catchR(s)).toBeGreaterThan(22);
    // The magnet pulls a nearby sprinkle in.
    s.sprinkles.push({ x: s.x + MAGNET_R, y: s.y, got: false });
    for (let i = 0; i < 20; i++) step(s, DT);
    expect(s.sprinkles.at(-1)!.got).toBe(true);
  });

  it('breaks the chain after a pause between pickups', () => {
    const s = createLevel(1, new Rng(5), 'classic');
    s.stars = [];
    s.sprinkles = [{ x: s.x, y: s.y, got: false }];
    step(s, DT);
    expect(s.chain.count).toBe(1);
    cut(s, 0); // the chain's window runs from the first cut
    for (let i = 0; i < 2 * FPS; i++) step(s, DT);
    expect(s.chain.count).toBe(0);
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
        expect(s.score).toBeGreaterThanOrEqual(3 * STAR_PTS + DELIVER_PTS + SPEED_PTS);
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
      expect(m.variant?.name.length, `level ${d}`).toBeGreaterThan(0);
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

  it('names every kind on the start gate, briefly, in both languages', () => {
    for (const locale of ['en', 'fr'] as const) {
      _setLocaleForTests(locale);
      for (let seed = 0; seed < 12; seed++) {
        const m = mountGame(snip, 4, seed);
        expect(m.variant!.name.length).toBeLessThanOrEqual(18);
        expect(m.variant!.blurb!.length).toBeLessThanOrEqual(60);
        m.inst.destroy?.();
        m.root.remove();
      }
    }
    _setLocaleForTests('en');
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
