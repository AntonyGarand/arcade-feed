import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { createLevel, durationFor, H, LIFE_BONUS, livesFor, rateFor, starsOut, step, W, type State } from '../src/games/dodge/rules';

const DT = 1 / 60;

/** Danger of standing at (x, y) over the next half second: how close the hazards pass, nearest soonest. */
function danger(s: State, x: number, y: number): number {
  let sum = 0;
  for (const z of [...s.live, ...s.schedule.slice(s.next, s.next + 8)])
    for (let k = 0; k <= 8; k++) {
      const t = k * 0.07;
      const dt = t - Math.max(0, z.t - s.time);
      if (dt < 0) continue;
      const zx = z.x + z.vx * dt;
      const zy = z.y + z.vy * dt;
      const gap =
        z.kind === 'disc'
          ? Math.hypot(zx + z.w / 2 - x, zy + z.h / 2 - y) - z.w / 2
          : Math.hypot(x - Math.max(zx, Math.min(x, zx + z.w)), y - Math.max(zy, Math.min(y, zy + z.h)));
      const near = Math.max(0, 34 - gap);
      sum += (near * near) / (1 + k);
    }
  return sum / 100;
}

/** Steer to the safest nearby spot, drawn to pickups and the lower middle. */
function autopilot(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
  for (let t = 0; t < 120; t += DT) {
    // Head for the gap of the next bar coming down.
    const bars = [...s.live, ...s.schedule.slice(s.next, s.next + 4)].filter((z) => z.kind === 'bar' && z.y < s.py);
    const left = bars.filter((z) => z.x === 0).sort((a, b) => b.y - a.y)[0];
    const right = left && bars.find((z) => z.t === left.t && z.x > 0);
    const gapX = left && right ? (left.w + right.x) / 2 : null;
    let best = { x: s.px, y: s.py, v: Infinity };
    for (let a = 0; a < 16; a++)
      for (const r of [0, 3, 6]) {
        const x = Math.max(10, Math.min(W - 10, s.px + Math.cos((a * Math.PI) / 8) * r));
        const y = Math.max(10, Math.min(H - 10, s.py + Math.sin((a * Math.PI) / 8) * r));
        const star = starsOut(s)[0];
        const pull = star ? Math.hypot(star.x - x, star.y - y) / 400 : 0;
        const v =
          danger(s, x, y) * 40 +
          (gapX == null ? 0 : Math.abs(x - gapX) / 30) +
          Math.abs(x - W / 2) / 600 +
          Math.abs(y - H * 0.75) / 600 +
          pull;
        if (v < best.v) best = { x, y, v };
      }
    s.target = best;
    const ev = step(s, DT);
    if (ev.won) return { s, win: true };
    if (ev.over) return { s, win: false };
  }
  throw new Error('never ended');
}

describe('dodge rules', () => {
  it('deals the same run from the same seed', () => {
    expect(createLevel(4, new Rng(3)).schedule).toEqual(createLevel(4, new Rng(3)).schedule);
    expect(createLevel(4, new Rng(3)).schedule).not.toEqual(createLevel(4, new Rng(4)).schedule);
  });

  it('gets harder: longer, denser, faster, new hazard kinds, fewer lives', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(durationFor(d)).toBeGreaterThan(durationFor(lo));
      expect(rateFor(d)).toBeGreaterThan(rateFor(lo));
      expect(livesFor(d)).toBeLessThanOrEqual(livesFor(lo));
    }
    const kinds = (d: Difficulty) => new Set(createLevel(d, new Rng(1)).schedule.map((z) => z.kind));
    expect([...kinds(1)]).toEqual(['block']);
    expect(kinds(2).has('disc')).toBe(true);
    expect(kinds(3).has('bar')).toBe(true);
  });

  it('is survived by an evasive autopilot at every level, with the life bonus', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed));
      expect(runs.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(d < 3 ? 5 : 3);
      for (const r of runs.filter((x) => x.win))
        expect(r.s.score).toBeGreaterThanOrEqual(durationFor(d) * 10 + r.s.lives * LIFE_BONUS - 10);
    }
  });

  it('collects pickups', () => {
    const s = createLevel(1, new Rng(2));
    let picked = 0;
    for (let t = 0; t < 10; t += DT) {
      const star = starsOut(s)[0];
      s.target = star ? { x: star.x, y: star.y } : null;
      if (step(s, DT).picked) picked++;
    }
    expect(picked).toBeGreaterThan(0);
    expect(s.pickups).toBe(picked);
  });

  it('loses a life per hit, with a moment of safety, and ends at zero', () => {
    const s = createLevel(5, new Rng(4));
    let hurt = 0;
    let over = false;
    for (let t = 0; t < 60 && !over; t += DT) {
      const z = s.live[0];
      s.target = z ? { x: z.x + z.w / 2, y: z.y + z.h / 2 } : null; // run into the first hazard
      const ev = step(s, DT);
      if (ev.hurt) hurt++;
      over = ev.over;
    }
    expect(over).toBe(true);
    expect(hurt).toBe(livesFor(5));
  });
});
