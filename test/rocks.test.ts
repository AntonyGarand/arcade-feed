import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { rocks as def } from '../src/games/rocks';
import {
  angleTo,
  bigFor,
  createLevel,
  H,
  LIFE_BONUS,
  LIVES,
  parFor,
  ROCK_R,
  rockPoints,
  type State,
  step,
  TOUCH_THRUST,
  W,
  wrapD,
} from '../src/games/rocks/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * Steer like a player holding a finger down: point at the nearest rock's lead position (close to the
 * ship, so it doesn't thrust), or far away from a rock that gets too close (so it thrusts clear).
 */
function pilot(s: State) {
  if (!s.alive) {
    s.pointer = null;
    return;
  }
  let best = null as null | { dx: number; dy: number; d: number; r: number; vx: number; vy: number };
  for (const r of s.rocks) {
    const dx = wrapD(s.x, r.x, W);
    const dy = wrapD(s.y, r.y, H);
    const d = Math.hypot(dx, dy) - ROCK_R[r.size];
    if (!best || d < best.d) best = { dx, dy, d, r: ROCK_R[r.size], vx: r.vx, vy: r.vy };
  }
  if (!best) return;
  const closing = best.dx * (best.vx - s.vx) + best.dy * (best.vy - s.vy) < 0;
  if (best.d < 22 && closing && s.safe <= 0) {
    const n = Math.hypot(best.dx, best.dy) || 1;
    s.pointer = { x: s.x - (best.dx / n) * 200, y: s.y - (best.dy / n) * 200 };
    return;
  }
  // Lead: where the rock will be when a shot gets there.
  const t = Math.hypot(best.dx, best.dy) / 330;
  const lx = best.dx + (best.vx - s.vx * 0.6) * t;
  const ly = best.dy + (best.vy - s.vy * 0.6) * t;
  const n = Math.hypot(lx, ly) || 1;
  const reach = TOUCH_THRUST * (best.d > 140 ? 1.5 : 0.5);
  s.pointer = { x: s.x + (lx / n) * reach, y: s.y + (ly / n) * reach };
}

/** `react` > 0 plays like a person: the finger only moves every `react` seconds, and lands a bit off. */
function autopilot(d: Difficulty, seed: number, react = 0, seconds = 240) {
  const s = createLevel(d, new Rng(seed));
  const jitter = new Rng(seed * 7);
  let next = 0;
  for (let t = 0; t < seconds; t += DT) {
    if (t >= next) {
      pilot(s);
      next = t + react;
      if (react && s.pointer) {
        const k = (jitter.next() - 0.5) * 50;
        s.pointer = { x: s.pointer.x + k, y: s.pointer.y - k };
      }
    }
    const ev = step(s, DT);
    if (ev.cleared) return { s, win: true };
    if (ev.over) return { s, win: false };
  }
  return { s, win: false };
}

describe('rocks rules', () => {
  it('deals the same field from the same seed', () => {
    const a = createLevel(3, new Rng(42));
    expect(a.rocks).toEqual(createLevel(3, new Rng(42)).rocks);
    expect(a.rocks).not.toEqual(createLevel(3, new Rng(43)).rocks);
    expect(a.rocks.length).toBe(bigFor(3));
    // Nothing starts on top of the ship.
    for (const r of a.rocks) expect(Math.hypot(r.x - W / 2, r.y - H / 2)).toBeGreaterThan(100);
  });

  it('gets harder: more and faster rocks', () => {
    const speed = (s: State) => Math.max(...s.rocks.map((r) => Math.hypot(r.vx, r.vy)));
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(1));
      const hi = createLevel(d, new Rng(1));
      expect(hi.rocks.length).toBeGreaterThanOrEqual(lo.rocks.length);
      expect(speed(hi)).toBeGreaterThan(speed(lo));
    }
  });

  it('turns, thrusts with inertia, wraps and shoots', () => {
    const s = createLevel(1, new Rng(2));
    s.rocks = [];
    s.turn = 1;
    step(s, 0.1);
    expect(s.a).toBeGreaterThan(0);
    s.turn = 0;
    s.thrust = true;
    for (let i = 0; i < 30; i++) step(s, DT);
    s.thrust = false;
    const v = Math.hypot(s.vx, s.vy);
    expect(v).toBeGreaterThan(50);
    step(s, DT);
    expect(Math.hypot(s.vx, s.vy)).toBeGreaterThan(v * 0.9); // still drifting
    for (let i = 0; i < 200; i++) step(s, DT);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x).toBeLessThan(W);
    s.fire = true;
    step(s, DT);
    expect(s.bullets.length).toBe(1);
  });

  it('splits a big rock into two medium ones, then small ones', () => {
    const s = createLevel(1, new Rng(3));
    s.rocks = [s.rocks[0]];
    Object.assign(s.rocks[0], { x: W / 2, y: H / 2 - 60, vx: 0, vy: 0, spin: 0 });
    s.fire = true;
    for (let i = 0; i < 20 && s.rocks.length === 1; i++) step(s, DT);
    expect(s.rocks.map((r) => r.size)).toEqual([2, 2]);
    expect(s.score).toBe(20);
  });

  it('respawns in the centre with a safe time, and loses on the last life', () => {
    const s = createLevel(5, new Rng(4));
    let deaths = 0;
    let over = false;
    const spawns: { safe: number; x: number; y: number }[] = [];
    for (let t = 0; t < 120 && !over; t += DT) {
      // Park on the nearest rock.
      const r = s.rocks[0];
      if (s.alive && s.safe <= 0) Object.assign(s, { x: r.x, y: r.y });
      const ev = step(s, DT);
      if (ev.died) deaths++;
      if (ev.respawned) spawns.push({ safe: s.safe, x: s.x, y: s.y });
      over = ev.over;
    }
    expect(over).toBe(true);
    expect(deaths).toBe(LIVES);
    expect(spawns.length).toBe(LIVES - 1);
    for (const p of spawns) {
      expect(p.safe).toBeGreaterThan(1);
      expect([p.x, p.y]).toEqual([W / 2, H / 2]);
    }
  });

  it('is cleared by a touch autopilot at every level, scoring every rock', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 17 + d));
      const slow = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 17 + d, 0.35));
      // A slower, less precise player still clears most runs.
      expect(slow.filter((r) => r.win).length, `level ${d} slow`).toBeGreaterThanOrEqual(3);
      const wins = runs.filter((r) => r.win);
      expect(wins.length, `level ${d}`).toBeGreaterThanOrEqual(4);
      for (const r of wins) expect(r.s.score).toBeGreaterThanOrEqual(rockPoints(d) + r.s.lives * LIFE_BONUS);
      const [two, three] = def.stars(d);
      const scores = wins.map((r) => r.s.score);
      // The best runs reach three stars, an average one at least two.
      expect(Math.max(...scores), `level ${d}`).toBeGreaterThanOrEqual(three);
      expect(scores.filter((x) => x >= two).length, `level ${d}`).toBeGreaterThanOrEqual(wins.length / 2);
    }
  });

  it('reports turns, thrust and fire from the keyboard when mounted', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(def, d, 9);
      expect(m.score).toBe(0);
      expect(m.lives).toEqual([LIVES, LIVES]);
      expect(m.status).toMatch(/rock/);
      for (const key of ['ArrowLeft', ' ']) m.inst.onKey!(new KeyboardEvent('keydown', { key }));
      m.run(4);
      expect(m.outcome).toBe('');
      expect(m.score).toBeGreaterThan(0);
      for (const key of ['ArrowLeft', ' ']) m.inst.onKey!(new KeyboardEvent('keyup', { key }));
      expect(m.inst.onKey!(new KeyboardEvent('keydown', { key: 'q' }))).toBe(false);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('has par times that grow with the level', () => {
    for (const d of LEVELS.slice(1)) expect(parFor(d)).toBeGreaterThan(parFor((d - 1) as Difficulty));
    expect(Math.abs(angleTo(0.1, Math.PI * 2 - 0.1))).toBeCloseTo(0.2);
  });
});
