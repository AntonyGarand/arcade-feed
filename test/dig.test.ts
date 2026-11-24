import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { _setLocaleForTests } from '../src/core/i18n';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { dig as game } from '../src/games/dig';
import { KIND_NAMES } from '../src/games/dig/names';
import {
  BONK_S,
  BRUSH,
  COLS,
  createLevel,
  dig,
  digLine,
  DIRT,
  EMPTY,
  GEMS,
  KINDS,
  LAVA,
  legsFor,
  molesFor,
  needFor,
  PCT_POINTS,
  PURIFY_S,
  ROCK,
  scoreOf,
  SLUDGE,
  sludgeFor,
  solution,
  step,
  STREAK_GAP,
  STREAK_TIERS,
  toWorld,
  WATER,
  type KindId,
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
function solve(d: Difficulty, seed: number, speed = 160, kind?: KindId, gems = true) {
  const s = createLevel(d, new Rng(seed), kind);
  const unlocked: string[] = [];
  let end = '';
  for (const stroke of gems ? solution(s) : solution(s).slice(-1)) {
    let prev = stroke[0];
    dig(s, prev.x, prev.y);
    for (const p of stroke.slice(1)) {
      const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / (speed * DT)));
      for (let i = 1; i <= n && !end; i++) {
        const f0 = (i - 1) / n;
        const f1 = i / n;
        digLine(s, prev.x + (p.x - prev.x) * f0, prev.y + (p.y - prev.y) * f0, prev.x + (p.x - prev.x) * f1, prev.y + (p.y - prev.y) * f1);
        const ev = step(s, DT);
        if (ev.unlocked) unlocked.push(ev.unlocked);
        end = ev.won ? 'won' : ev.over ? 'over' : '';
      }
      prev = p;
    }
  }
  for (let t = 0; t < 120 && !end; t += DT) {
    const ev = step(s, DT);
    if (ev.unlocked) unlocked.push(ev.unlocked);
    end = ev.won ? 'won' : ev.over ? 'over' : '';
  }
  return { s, end, unlocked };
}

describe('dig level kinds', () => {
  it('deals different kinds across seeds, gated by level', () => {
    for (const d of LEVELS) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 80; seed++) seen.add(createLevel(d, new Rng(seed)).kind);
      expect(seen.size, `level ${d}`).toBe(kindsAt(d, KINDS).length);
    }
    for (let seed = 0; seed < 30; seed++) expect(['classic', 'zigzag', 'caverns']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('shapes each kind differently', () => {
    const avg = (kind: KindId, f: (s: State) => number, d: Difficulty = 3) => {
      let sum = 0;
      for (let seed = 1; seed <= 8; seed++) sum += f(createLevel(d, new Rng(seed), kind));
      return sum / 8;
    };
    expect(avg('zigzag', (s) => s.route.length)).toBeGreaterThan(avg('classic', (s) => s.route.length));
    expect(avg('caverns', (s) => count(s, EMPTY))).toBeGreaterThan(avg('classic', (s) => count(s, EMPTY)) * 2);
    expect(avg('bedrock', (s) => count(s, ROCK))).toBeGreaterThan(avg('classic', (s) => count(s, ROCK)) * 1.3);
    expect(avg('volcano', (s) => s.lava.length)).toBeGreaterThanOrEqual(2);
    expect(avg('classic', (s) => s.lava.length)).toBe(0);
    expect(avg('classic', (s) => s.lava.length, 5)).toBe(1); // a pool mixed in from Hard up
    expect(createLevel(4, new Rng(1), 'moles').moles.length).toBe(molesFor(4));
    expect(createLevel(4, new Rng(1), 'classic').moles.length).toBe(0);
  });

  it('lava eats water, and hardens into rock where it was hit', () => {
    const s = createLevel(3, new Rng(1), 'volcano');
    // The top of a lava pool: water lands right on it.
    const top = s.cell.findIndex((c, j) => c === LAVA && s.cell[j - COLS] === DIRT);
    const i = top - COLS;
    const lava = count(s, LAVA);
    s.cell[i] = WATER;
    s.total++;
    s.water++;
    const ev = step(s, 1 / 60);
    expect(s.lost).toBe(1);
    expect(count(s, LAVA)).toBeLessThan(lava);
    expect(ev.steam.length).toBeGreaterThan(0);
    expect(s.cell[ev.steam[0]]).toBe(ROCK);
  });

  it('moles steal gems the water hasn’t reached, unless dug at or washed away', () => {
    const s = createLevel(3, new Rng(1), 'moles');
    const m = s.moles[0];
    const far = toWorld({ x: 30, y: 75 });
    dig(s, far.x, far.y); // somewhere harmless, so the moles wake up
    const stolen: number[] = [];
    for (let t = 0; t < 40 && !stolen.length; t += DT) stolen.push(...step(s, DT).stolen);
    expect(stolen.length).toBe(1);
    expect(m.carrying).toBe(true);
    expect(s.gems[stolen[0]].stolen).toBe(true);
    // Dig at it: it drops the gem and runs home.
    const p = toWorld(m);
    dig(s, p.x, p.y);
    expect(s.bonks).toBe(1);
    expect(s.gems[stolen[0]].stolen).toBe(false);
    expect(m.wait).toBe(BONK_S);
    expect([m.x, m.y]).toEqual([m.home.x, m.home.y]);
    // Water around it washes it away for good.
    s.cell[Math.round(m.y) * COLS + Math.round(m.x) + 1] = WATER;
    const ev = step(s, DT);
    expect(ev.washed).toEqual([0]);
    expect(m.gone).toBe(true);
  });
});

describe('dig flow combo', () => {
  it('a clean pour reaches the milestones: purify, then double water points', () => {
    const { s, unlocked } = solve(3, 1, 160, 'classic');
    expect(unlocked.slice(0, 2)).toEqual(['purify', 'double']);
    expect(s.bonus).toBeGreaterThan(0);
  });

  it('the gem magnet pulls in a gem the water missed', () => {
    const { s, unlocked } = solve(2, 2, 160, 'classic', false);
    expect(unlocked).toContain('magnet');
    expect(s.gems.filter((g) => g.got).length).toBeGreaterThanOrEqual(1);
  });

  it('purified hazards don’t eat water', () => {
    const s = createLevel(3, new Rng(2), 'classic');
    const b = s.sludge[0];
    const i = (b.y - Math.ceil(b.r) - 1) * COLS + b.x;
    s.toxic[i] = 1;
    s.cell[i] = WATER;
    s.purify = PURIFY_S;
    step(s, DT);
    expect(s.lost).toBe(0);
  });

  it('breaks when the flow stops, and the double points with it', () => {
    const s = createLevel(1, new Rng(3), 'classic');
    Object.assign(s, { released: true, streak: STREAK_TIERS[1], tier: 2, double: true });
    let broke = 0;
    for (let t = 0; t < STREAK_GAP + 0.2; t += DT) broke ||= step(s, DT).broke;
    expect(broke).toBe(STREAK_TIERS[1]);
    expect(s.streak).toBe(0);
    expect(s.double).toBe(false);
  });
});

describe('dig rules', () => {
  it('deals the same earth from the same seed', () => {
    const a = createLevel(4, new Rng(9));
    const b = createLevel(4, new Rng(9));
    const c = createLevel(4, new Rng(10));
    expect(a.kind).toBe(b.kind);
    expect(a.moles).toEqual(b.moles);
    expect(a.cell).toEqual(b.cell);
    expect(a.route).toEqual(b.route);
    expect(a.gems).toEqual(b.gems);
    expect(a.cell).not.toEqual(c.cell);
    expect(a.gems.length).toBe(GEMS);
  });

  it('gets harder: more rock, longer routes, sludge, a bigger share to deliver', () => {
    const avg = (d: Difficulty, f: (s: State) => number) => {
      let sum = 0;
      for (let seed = 1; seed <= 12; seed++) sum += f(createLevel(d, new Rng(seed), 'classic'));
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
    for (const d of LEVELS) expect(createLevel(d, new Rng(3), 'classic').sludge.length).toBe(sludgeFor(d));
    expect(sludgeFor(1)).toBe(0);
    expect(sludgeFor(5)).toBeGreaterThan(0);
  });

  it('keeps the recorded route clear of rock, sludge and lava in every kind', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS))
        for (let seed = 1; seed <= 4; seed++) {
          const s = createLevel(d, new Rng(seed), id);
          for (let i = 0; i < s.cell.length; i++) {
            if (s.cell[i] !== ROCK && s.cell[i] !== SLUDGE && s.cell[i] !== LAVA) continue;
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
    const s = createLevel(3, new Rng(4), 'classic');
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
    const s = createLevel(3, new Rng(2), 'classic');
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

  it('clears every kind allowed at every level for three stars, with comparable scores', () => {
    for (const d of LEVELS) {
      const [two, three] = game.stars(d);
      for (const { id } of kindsAt(d, KINDS))
        for (let seed = 1; seed <= 4; seed++) {
          const { s, end } = solve(d, seed, 160, id);
          const at = `${id} ${d}/${seed}`;
          expect(end, at).toBe('won');
          expect(
            s.gems.every((g) => g.got),
            at,
          ).toBe(true);
          expect(scoreOf(s), at).toBeGreaterThanOrEqual(three);
          expect(scoreOf(s), at).toBeLessThan(three + 600);
        }
      // Just the goal, gems skipped and no flow combo: one star or two, never three.
      expect(starsFor(game, d, true, (needFor(d) + 2) * PCT_POINTS)).toBe(1);
      expect(two).toBeLessThan(three);
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

  it('names every kind briefly, in both languages', () => {
    for (const loc of ['en', 'fr'] as const) {
      _setLocaleForTests(loc);
      for (const { id } of KINDS) {
        const [name, blurb] = KIND_NAMES[id]();
        expect(name.length, id).toBeLessThanOrEqual(18);
        expect(blurb.length, id).toBeLessThanOrEqual(60);
      }
    }
    _setLocaleForTests('en');
  });

  it('never wins without digging', () => {
    const m = mountGame(game, 2, 5);
    m.run(60);
    expect(m.outcome).toBe('');
    expect(m.score).toBe(0);
  });

  it('digs with the keyboard and reports progress', () => {
    const m = mountGame(game, 1, 3);
    expect(m.variant?.id).toBe(createLevel(1, new Rng(3)).kind);
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
