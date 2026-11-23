import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { dig as game } from '../src/games/dig';
import {
  BRUSH,
  COLS,
  createLevel,
  dig,
  digLine,
  DIRT,
  EMPTY,
  GEMS,
  legsFor,
  needFor,
  ROCK,
  scoreOf,
  SLUDGE,
  sludgeFor,
  solution,
  step,
  toWorld,
  WATER,
  type State,
} from '../src/games/dig/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;
const count = (s: State, k: number) => s.cell.filter((c) => c === k).length;

/** Run until the level ends (or `seconds` pass): 'won', 'over' or ''. */
function settle(s: State, seconds: number) {
  for (let t = 0; t < seconds; t += DT) {
    const ev = step(s, DT);
    if (ev.won) return 'won';
    if (ev.over) return 'over';
  }
  return '';
}

/**
 * A scripted digger following the generator's recorded solution: a dip under each gem, then the route
 * from the pipe up to the water, moving `speed` world units per second while the water runs.
 */
function solve(d: Difficulty, seed: number, speed = 160) {
  const s = createLevel(d, new Rng(seed));
  let end = '';
  for (const stroke of solution(s)) {
    let prev = stroke[0];
    dig(s, prev.x, prev.y);
    for (const p of stroke.slice(1)) {
      const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / (speed * DT)));
      for (let i = 1; i <= n && !end; i++) {
        const f0 = (i - 1) / n;
        const f1 = i / n;
        digLine(s, prev.x + (p.x - prev.x) * f0, prev.y + (p.y - prev.y) * f0, prev.x + (p.x - prev.x) * f1, prev.y + (p.y - prev.y) * f1);
        const ev = step(s, DT);
        end = ev.won ? 'won' : ev.over ? 'over' : '';
      }
      prev = p;
    }
  }
  return { s, end: end || settle(s, 120) };
}

describe('dig rules', () => {
  it('deals the same earth from the same seed', () => {
    const a = createLevel(4, new Rng(9));
    const b = createLevel(4, new Rng(9));
    const c = createLevel(4, new Rng(10));
    expect(a.cell).toEqual(b.cell);
    expect(a.route).toEqual(b.route);
    expect(a.gems).toEqual(b.gems);
    expect(a.cell).not.toEqual(c.cell);
    expect(a.gems.length).toBe(GEMS);
  });

  it('gets harder: more rock, longer routes, sludge, a bigger share to deliver', () => {
    const avg = (d: Difficulty, f: (s: State) => number) => {
      let sum = 0;
      for (let seed = 1; seed <= 12; seed++) sum += f(createLevel(d, new Rng(seed)));
      return sum / 12;
    };
    const length = (s: State) => s.route.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - s.route[i].x, p.y - s.route[i].y), 0);
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(
        avg(d, (s) => count(s, ROCK)),
        `rock ${d}`,
      ).toBeGreaterThan(avg(lo, (s) => count(s, ROCK)));
      expect(needFor(d)).toBeGreaterThan(needFor(lo));
      expect(legsFor(d)).toBeGreaterThanOrEqual(legsFor(lo));
      // A route with more turns is longer.
      expect(legsFor(d) === legsFor(lo) || avg(d, length) > avg(lo, length), `route ${d}`).toBe(true);
    }
    for (const d of LEVELS) expect(createLevel(d, new Rng(3)).sludge.length).toBe(sludgeFor(d));
    expect(sludgeFor(1)).toBe(0);
    expect(sludgeFor(5)).toBeGreaterThan(0);
  });

  it('keeps the recorded route clear of rock and sludge', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 10; seed++) {
        const s = createLevel(d, new Rng(seed));
        for (let i = 0; i < s.cell.length; i++) {
          if (s.cell[i] !== ROCK && s.cell[i] !== SLUDGE) continue;
          const x = i % COLS;
          const y = Math.floor(i / COLS);
          for (let k = 1; k < s.route.length; k++) {
            const a = s.route[k - 1];
            const b = s.route[k];
            const l = Math.hypot(b.x - a.x, b.y - a.y);
            const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (l * l)));
            const dd = Math.hypot(x - a.x - (b.x - a.x) * t, y - a.y - (b.y - a.y) * t);
            expect(dd, `${d}/${seed}`).toBeGreaterThan(BRUSH);
          }
        }
      }
  });

  it('holds the water behind the dirt until you dig', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(d));
      const before = s.cell.slice();
      expect(settle(s, 30)).toBe('');
      expect(s.released).toBe(false);
      expect(s.cell).toEqual(before);
      expect(count(s, WATER)).toBe(s.total);
    }
  });

  it('digs dirt but never rock', () => {
    const s = createLevel(3, new Rng(4));
    const rock = s.cell.indexOf(ROCK);
    const p = toWorld({ x: rock % COLS, y: Math.floor(rock / COLS) });
    dig(s, p.x, p.y);
    expect(s.cell[rock]).toBe(ROCK);
    const dirt = s.cell.indexOf(DIRT, COLS * 40);
    const q = toWorld({ x: dirt % COLS, y: Math.floor(dirt / COLS) });
    expect(dig(s, q.x, q.y)).toBeGreaterThan(0);
    expect(s.cell[dirt]).toBe(EMPTY);
    expect(s.dug).toBeGreaterThan(0);
  });

  it('loses water that touches sludge, and the run once the goal is out of reach', () => {
    const s = createLevel(3, new Rng(2));
    const b = s.sludge[0];
    const i = (b.y - Math.ceil(b.r) - 1) * COLS + b.x;
    s.toxic[i] = 1;
    s.cell[i] = WATER;
    s.total++;
    s.water++;
    step(s, DT);
    expect(s.lost).toBe(1);
    expect(s.cell[i]).toBe(EMPTY);
    s.toxic.fill(1);
    expect(settle(s, 1)).toBe('over');
    expect(s.water).toBe(0);
  });

  it('can be cleared at every level by digging the recorded route, gems and all, for three stars', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 6; seed++) {
        const { s, end } = solve(d, seed);
        expect(end, `${d}/${seed}`).toBe('won');
        expect(s.delivered).toBeGreaterThanOrEqual(s.need);
        expect(s.gems.every((g) => g.got)).toBe(true);
        expect(s.lost).toBe(0);
        expect(starsFor(game, d, true, scoreOf(s)), `${d}/${seed} score ${scoreOf(s)}`).toBe(3);
      }
  });

  it('loses when the water settles in a dead end', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(20 + d));
      const a = toWorld(s.route[0]);
      digLine(s, a.x, a.y, a.x, a.y + 30); // a short shaft under the pocket, going nowhere
      expect(settle(s, 30), `level ${d}`).toBe('over');
      expect(s.delivered).toBe(0);
    }
  });

  it('never wins without digging', () => {
    const m = mountGame(game, 2, 5);
    m.run(60);
    expect(m.outcome).toBe('');
    expect(m.score).toBe(0);
  });

  it('digs with the keyboard and reports progress', () => {
    const m = mountGame(game, 1, 3);
    expect(m.status).toContain('goal');
    m.inst.onKey?.(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    m.run(0.5);
    m.inst.onKey?.(new KeyboardEvent('keyup', { key: 'ArrowUp' }));
    expect(m.status).toContain('water 0% of 50%');
    expect(m.outcome).toBe('');
    m.inst.destroy?.();
    m.root.remove();
  });
});
