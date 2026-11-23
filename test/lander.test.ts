import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { lander } from '../src/games/lander';
import {
  createLevel,
  fuelFor,
  gravityFor,
  groundAt,
  livesFor,
  roughFor,
  step,
  THRUST,
  W,
  windFor,
  windNow,
  type Pad,
  type State,
} from '../src/games/lander/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Highest ground (smallest y) between two x positions, with a margin either side. */
function peak(s: State, from: number, to: number): number {
  let top = Infinity;
  for (let x = Math.min(from, to) - 16; x <= Math.max(from, to) + 16; x += 5) top = Math.min(top, groundAt(s, Math.max(0, Math.min(W, x))));
  return top;
}

/**
 * Fly to a pad with a speed controller: climb over the ground in the way, slide over the pad, then
 * sink slowly. The engine is pulsed to give the push it wants.
 */
function autopilot(d: Difficulty, seed: number, choose: (pads: Pad[]) => Pad = (p) => p.reduce((a, b) => (b.mult > a.mult ? b : a))) {
  const s = createLevel(d, new Rng(seed));
  const pad = choose(s.pads);
  const px = (pad.x0 + pad.x1) / 2;
  let duty = 0;
  for (let t = 0; t < 120; t += DT) {
    if (s.phase === 'fly') {
      const dx = px - s.x;
      const over = Math.abs(dx) < (pad.x1 - pad.x0) / 2 - 9;
      const clear = peak(s, s.x, px) - 40;
      const h = pad.y - (s.y + 11);
      const vxWant = over ? dx * 1.2 : Math.max(-45, Math.min(45, dx * 0.7));
      let vyWant: number;
      if (!over && s.y > clear) vyWant = -25;
      else if (!over) vyWant = Math.min(20, (clear - s.y) * 0.5);
      else vyWant = Math.max(9, Math.min(50, h * 0.45));
      const fx = (vxWant - s.vx) * 1.6 - windNow(s);
      const fy = s.gravity - (vyWant - s.vy) * 1.6;
      const near = h < 26;
      const angle = Math.atan2(fx, Math.max(fy, 8));
      s.tilt = Math.max(near ? -0.2 : -0.8, Math.min(near ? 0.2 : 0.8, angle));
      const need = fy > 0 ? Math.hypot(fx, fy) / THRUST : 0;
      duty += Math.min(1, need);
      s.thrust = duty >= 1 && Math.abs(s.angle - s.tilt) < 0.35;
      if (s.thrust) duty -= 1;
    }
    const ev = step(s, DT);
    if (ev.landed) return { s, win: true };
    if (ev.over) return { s, win: false };
    if (ev.retry) duty = 0;
  }
  return { s, win: false };
}

describe('lander rules', () => {
  it('deals the same ground and pads from the same seed', () => {
    const a = createLevel(4, new Rng(6));
    expect(a.ground).toEqual(createLevel(4, new Rng(6)).ground);
    expect(a.pads).toEqual(createLevel(4, new Rng(6)).pads);
    expect(a.ground).not.toEqual(createLevel(4, new Rng(7)).ground);
  });

  it('gets harder: stronger gravity, less fuel, rougher ground, wind, fewer pads', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(gravityFor(d)).toBeGreaterThan(gravityFor(lo));
      expect(fuelFor(d)).toBeLessThan(fuelFor(lo));
      expect(roughFor(d)).toBeGreaterThan(roughFor(lo));
      expect(windFor(d)).toBeGreaterThanOrEqual(windFor(lo));
      expect(livesFor(d)).toBeLessThanOrEqual(livesFor(lo));
    }
    expect(createLevel(1, new Rng(1)).pads.length).toBeGreaterThan(createLevel(5, new Rng(1)).pads.length);
    expect(windFor(5)).toBeGreaterThan(0);
  });

  it('flattens the ground under every pad', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = createLevel(5, new Rng(seed));
      for (const p of s.pads) for (let x = p.x0; x <= p.x1; x += 3) expect(groundAt(s, x)).toBe(p.y);
    }
  });

  it('is landed by an autopilot at every level; the best pad scores three stars', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed));
      const easy = [1, 2, 3].map((seed) => autopilot(d, seed, (p) => p.reduce((a, b) => (b.mult < a.mult ? b : a))));
      const [two, three] = lander.stars(d);
      expect(runs.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(5);
      expect(runs.filter((r) => r.s.score >= three).length, `level ${d} three stars`).toBeGreaterThanOrEqual(3);
      // The widest pad is safe but pays less: never three stars, and only one where it's a ×1.
      expect(easy.every((r) => r.win)).toBe(true);
      expect(easy.filter((r) => r.s.score >= (r.s.pad?.mult === 1 ? two : three))).toEqual([]);
    }
  });

  it('crashes when falling without the engine, then retries with a full tank, then ends', () => {
    const s = createLevel(3, new Rng(2));
    let crashes = 0;
    let retries = 0;
    let over = false;
    const refills: number[] = [];
    s.fuel = 1;
    for (let t = 0; t < 60 && !over; t += DT) {
      s.thrust = true;
      const ev = step(s, DT);
      if (ev.crashed) crashes++;
      if (ev.retry) {
        retries++;
        refills.push(s.fuel);
        s.fuel = 0;
      }
      over = ev.over;
    }
    expect(over).toBe(true);
    expect(crashes).toBe(livesFor(3));
    expect(retries).toBe(livesFor(3) - 1);
    expect(refills).toEqual([fuelFor(3), fuelFor(3)]);
  });
});

describe('lander card', () => {
  const key = (m: ReturnType<typeof mountGame>, type: 'keydown' | 'keyup', k: string) =>
    m.inst.onKey?.(new KeyboardEvent(type, { key: k }));

  for (const d of [1, 5] as const)
    it(`mounts at level ${d}, flies with the keyboard and reports fuel`, () => {
      const m = mountGame(lander, d, 5);
      expect(m.lives).toEqual([livesFor(d), livesFor(d)]);
      const before = m.status;
      expect(before).not.toBe('');
      expect(key(m, 'keydown', 'ArrowUp')).toBe(true);
      expect(key(m, 'keydown', 'ArrowLeft')).toBe(true);
      m.run(0.5);
      key(m, 'keyup', 'ArrowLeft');
      key(m, 'keyup', 'ArrowUp');
      expect(m.status).not.toBe(before);
      expect(m.outcome).toBe('');
      // Hands off: it falls and crashes until the attempts run out.
      m.run(80);
      expect(m.outcome).toBe('lose');
      expect(m.lives?.[0]).toBe(0);
      m.inst.destroy?.();
      m.root.remove();
    });
});
