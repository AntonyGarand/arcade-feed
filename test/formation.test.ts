import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { formation as def } from '../src/games/formation';
import {
  aliveCount,
  CANNON_HW,
  CANNON_Y,
  colsFor,
  createLevel,
  critterAt,
  fireGapFor,
  formationPoints,
  LIFE_BONUS,
  LIVES,
  rowsFor,
  shooters,
  type State,
  step,
  tickFor,
  tickNow,
  W,
} from '../src/games/formation/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Is the cannon at `x` in the path of an enemy shot that lands within `soon` seconds? */
const danger = (s: State, x: number, soon: number) =>
  s.bombs.some((m) => Math.abs(m.x - x) < CANNON_HW + 7 && (CANNON_Y - 10 - m.y) / m.vy < soon && m.y < CANNON_Y + 6);

/**
 * Drag like a player: under the nearest shooting critter (leading the march), fire when lined up, and
 * step aside from shots about to land. `sloppy` aims up to that many units off and sees shots later.
 */
function pilot(s: State, sloppy: number, off: number) {
  const can = shooters(s);
  if (!can.length) return;
  // Lead each critter by the march during the shot's flight (6 units per tick, shots at 400 units/s).
  const xs = can.map((k) => {
    const p = critterAt(s, k);
    return p.x + off * sloppy + s.dir * 6 * Math.floor((CANNON_Y - p.y) / 400 / tickNow(s) + 0.5);
  });
  const look = sloppy ? 0.55 : 0.9;
  let want = xs.reduce((a, b) => (Math.abs(b - s.px) < Math.abs(a - s.px) ? b : a));
  if (danger(s, want, look)) {
    let best = want;
    for (let dx = 4; dx < W; dx += 4)
      for (const x of [want - dx, want + dx]) if (x > 15 && x < W - 15 && !danger(s, x, look) && best === want) best = x;
    want = best;
  }
  s.target = want;
  s.fire = !danger(s, s.px, look * 0.6) && xs.some((x) => Math.abs(x - s.px) < 6);
}

function autopilot(d: Difficulty, seed: number, sloppy = 0, seconds = 200) {
  const s = createLevel(d, new Rng(seed));
  const noise = new Rng(seed * 3);
  let off = 0;
  for (let t = 0, f = 0; t < seconds; t += DT, f++) {
    if (f % 24 === 0) off = noise.next() * 2 - 1;
    pilot(s, sloppy, off);
    const ev = step(s, DT);
    if (ev.cleared) return { s, win: true };
    if (ev.over) return { s, win: false };
  }
  return { s, win: false };
}

describe('formation rules', () => {
  it('deals the same formation from the same seed', () => {
    const a = createLevel(3, new Rng(42));
    const b = createLevel(3, new Rng(42));
    expect([a.ox, a.dir, a.critters]).toEqual([b.ox, b.dir, b.critters]);
    const kinds = (s: State) => s.critters.map((k) => k.k);
    expect([1, 2, 3, 4, 5].some((k) => kinds(createLevel(3, new Rng(42 + k))).join() !== kinds(a).join())).toBe(true);
    expect(a.critters.length).toBe(rowsFor(3) * colsFor(3));
  });

  it('gets harder: more critters, a faster march and more fire', () => {
    for (const d of LEVELS.slice(1)) {
      const p = (d - 1) as Difficulty;
      expect(rowsFor(d) * colsFor(d)).toBeGreaterThanOrEqual(rowsFor(p) * colsFor(p));
      expect(tickFor(d)).toBeLessThan(tickFor(p));
      expect(fireGapFor(d)).toBeLessThan(fireGapFor(p));
    }
  });

  it('marches faster as it thins out, and steps down at the edges', () => {
    const s = createLevel(1, new Rng(3));
    const full = tickNow(s);
    for (const k of s.critters.slice(0, -3)) k.alive = false;
    expect(tickNow(s)).toBeLessThan(full / 2);
    const y = s.oy;
    s.fire = false;
    for (let t = 0; t < 10; t += DT) step(s, DT);
    expect(s.oy).toBeGreaterThan(y);
  });

  it('shoots a critter straight above the cannon', () => {
    const s = createLevel(1, new Rng(4));
    s.bombIn = 99;
    s.shields = [];
    const k = shooters(s)[0];
    s.px = critterAt(s, k).x;
    s.tick = 99;
    s.fire = true;
    for (let t = 0; t < 1.5 && aliveCount(s) === s.critters.length; t += DT) step(s, DT);
    expect(k.alive).toBe(false);
    expect(s.score).toBeGreaterThan(0);
  });

  it('is lost when the cannon sits under fire, or when the formation lands', () => {
    const s = createLevel(5, new Rng(5));
    let over = false;
    let hurt = 0;
    for (let t = 0; t < 120 && !over; t += DT) {
      s.target = s.bombs.at(-1)?.x ?? s.px;
      const ev = step(s, DT);
      if (ev.hurt) hurt++;
      over = ev.over;
    }
    expect(over).toBe(true);
    expect(hurt).toBe(LIVES);
    const l = createLevel(1, new Rng(6));
    l.bombIn = 1e9;
    let landed = false;
    for (let t = 0; t < 300 && !landed; t += DT) landed = step(l, DT).over;
    expect(landed).toBe(true);
    expect(l.lives).toBe(LIVES);
  });

  it('is cleared by an autopilot at every level, scoring every critter', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 31 + d));
      const slow = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 31 + d, 9));
      const wins = runs.filter((r) => r.win);
      expect(wins.length, `level ${d}`).toBeGreaterThanOrEqual(4);
      for (const r of wins) expect(r.s.score).toBeGreaterThanOrEqual(formationPoints(d) + r.s.lives * LIFE_BONUS);
      const [two, three] = def.stars(d);
      const scores = wins.map((r) => r.s.score);
      expect(Math.max(...scores), `level ${d}`).toBeGreaterThanOrEqual(three);
      expect(scores.filter((x) => x >= two).length, `level ${d}`).toBeGreaterThanOrEqual(wins.length / 2);
      expect(slow.filter((r) => r.win).length, `level ${d} slow`).toBeGreaterThanOrEqual(3);
    }
  });

  it('plays from the keyboard when mounted', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(def, d, 9);
      expect(m.score).toBe(0);
      expect(m.lives).toEqual([LIVES, LIVES]);
      expect(m.status).toMatch(/left/);
      m.inst.onKey!(new KeyboardEvent('keydown', { key: ' ' }));
      // Sweep left and right while firing.
      for (let i = 0; i < 6 && !m.outcome; i++) {
        const key = i % 2 ? 'ArrowRight' : 'ArrowLeft';
        m.inst.onKey!(new KeyboardEvent('keydown', { key }));
        m.run(0.7);
        m.inst.onKey!(new KeyboardEvent('keyup', { key }));
      }
      expect(m.outcome).toBe('');
      expect(m.score).toBeGreaterThan(0);
      expect(m.inst.onKey!(new KeyboardEvent('keydown', { key: 'q' }))).toBe(false);
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
