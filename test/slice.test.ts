import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { type Difficulty, LEVELS } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { slice } from '../src/games/slice';
import {
  createLevel,
  crosses,
  drag,
  fruitsFor,
  grant,
  H,
  KINDS,
  type KindId,
  LIFE_BONUS,
  LIVES,
  type Piece,
  press,
  release,
  required,
  SLOW_S,
  type State,
  STREAK_TIERS,
  step,
  toughFor,
  W,
} from '../src/games/slice/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Step until `pred` holds (lives topped up so misses don't end the run). */
function until(s: State, pred: () => boolean) {
  for (let i = 0; i < 6000 && !pred(); i++) {
    s.lives = LIVES;
    step(s, DT);
  }
  expect(pred()).toBe(true);
}

/** A quick swipe through `p` at an angle that keeps clear of every bomb, or false if there is none. */
function swipeThrough(s: State, p: Piece): boolean {
  const len = p.r + 6;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 12;
    const ax = p.x - Math.cos(a) * len;
    const ay = p.y - Math.sin(a) * len;
    const bx = p.x + Math.cos(a) * len;
    const by = p.y + Math.sin(a) * len;
    if (s.live.some((b) => b.kind === 'bomb' && b.hp > 0 && crosses(ax, ay, bx, by, b.x, b.y, b.r + 8))) continue;
    press(s, ax, ay);
    drag(s, bx, by);
    release(s);
    return true;
  }
  return false;
}

/** Slice every fruit near the top of its arc (or before it drops out), never a bomb. */
function autopilot(d: Difficulty, seed: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  let end: 'won' | 'over' | '' = '';
  let booms = 0;
  const unlocked: string[] = [];
  for (let t = 0; t < 300 && !end; t += DT) {
    // Most urgent first: fruit that must be sliced, then the lowest ones.
    const targets = s.live
      .filter((p) => p.kind !== 'bomb' && p.hp > 0 && p.y < H - p.r && (p.vy > -80 || p.y > H - 3 * p.r))
      .filter((p) => p.hitAt < 0 || s.time - p.hitAt > 0.2)
      .sort((a, b) => Number(required(b.kind)) - Number(required(a.kind)) || b.y - a.y);
    for (const p of targets) if (swipeThrough(s, p)) break;
    const ev = step(s, DT);
    booms += ev.booms.length;
    if (ev.unlocked) unlocked.push(ev.unlocked);
    if (ev.won) end = 'won';
    else if (ev.over) end = 'over';
  }
  return { s, end, booms, unlocked };
}

/** Like the autopilot, but waits for fruit to bunch up near their apex and strings them in one stroke. */
function comboPilot(d: Difficulty, seed: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  let end: 'won' | 'over' | '' = '';
  for (let t = 0; t < 300 && !end; t += DT) {
    const ready = s.live.filter((p) => p.kind !== 'bomb' && p.hp > 0 && p.y < H - p.r && (p.hitAt < 0 || s.time - p.hitAt > 0.2));
    const near = ready.filter((p) => p.vy > -60);
    const late = ready.some((p) => p.vy > 150 || p.y > H - 3 * p.r);
    const coming = s.schedule.slice(s.next).some((z) => z.t - s.time < 0.4 && z.kind !== 'bomb');
    if (near.length && (near.length === ready.length || late) && !coming) {
      const pts = near.sort((a, b) => a.x - b.x);
      const safe = pts.every((p, i) => {
        if (!i) return true;
        const q = pts[i - 1];
        return !s.live.some((b) => b.kind === 'bomb' && crosses(q.x, q.y, p.x, p.y, b.x, b.y, b.r + 8));
      });
      if (pts.length > 1 && safe) {
        press(s, pts[0].x - 1, pts[0].y);
        for (const p of pts) drag(s, p.x, p.y);
        release(s);
      } else for (const p of pts) swipeThrough(s, p);
    } else if (late) for (const p of ready.filter((q) => q.vy > 150 || q.y > H - 3 * q.r)) swipeThrough(s, p);
    const ev = step(s, DT);
    if (ev.won) end = 'won';
    else if (ev.over) end = 'over';
  }
  return { s, end };
}

describe('slice rules', () => {
  it('deals the same throws from the same seed', () => {
    const a = createLevel(3, new Rng(42));
    const b = createLevel(3, new Rng(42));
    expect(a.kind).toBe(b.kind);
    expect(a.schedule).toEqual(b.schedule);
    expect(createLevel(3, new Rng(43)).schedule).not.toEqual(a.schedule);
    expect(a.schedule.filter((z) => required(z.kind)).length).toBe(fruitsFor(3));
    expect(a.schedule.filter((z) => z.kind === 'tough').length).toBe(toughFor(3));
  });

  it('gets harder: more and smaller fruit, faster arcs, more bombs', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(1), 'toss');
      const hi = createLevel(d, new Rng(1), 'toss');
      expect(hi.total).toBeGreaterThan(lo.total);
      expect(hi.r).toBeLessThan(lo.r);
      expect(hi.g).toBeGreaterThan(lo.g);
      // Bombs, averaged over a few seeds.
      const bombs = (dd: Difficulty) =>
        [...Array(24).keys()].reduce(
          (n, seed) => n + createLevel(dd, new Rng(seed), 'toss').schedule.filter((z) => z.kind === 'bomb').length,
          0,
        );
      expect(bombs(d)).toBeGreaterThan(bombs((d - 1) as Difficulty));
    }
    for (let seed = 0; seed < 10; seed++) expect(createLevel(1, new Rng(seed)).schedule.some((z) => z.kind === 'bomb')).toBe(false);
  });

  it('keeps every throw inside the field, in every kind', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const s = createLevel(d, new Rng(9), id);
        for (const z of s.schedule) {
          // Where it leaves past the bottom edge.
          const fall = H + s.r - z.y0;
          const t = (-z.vy + Math.sqrt(z.vy * z.vy + 2 * s.g * fall)) / s.g;
          const land = z.x + z.vx * t;
          expect(land, `${id} ${d}`).toBeGreaterThan(0);
          expect(land, `${id} ${d}`).toBeLessThan(W);
        }
      }
  });

  it('slices a fruit with a fast swipe, but not with a slow drag', () => {
    const s = createLevel(1, new Rng(3), 'toss');
    until(s, () => s.live.length > 0);
    const p = s.live[0];
    // Slow: a few units per frame.
    press(s, p.x - 2, p.y);
    drag(s, p.x + 1, p.y);
    expect(step(s, DT).cuts.length).toBe(0);
    release(s);
    for (let i = 0; i < 12; i++) step(s, DT);
    press(s, p.x - 40, p.y);
    drag(s, p.x + 40, p.y);
    const ev = step(s, DT);
    expect(ev.cuts.length).toBe(1);
    expect(s.sliced).toBe(1);
    expect(s.score).toBeGreaterThan(0);
  });

  it('pays a combo for several fruit in one stroke', () => {
    const s = createLevel(5, new Rng(4), 'toss');
    until(s, () => s.live.filter((p) => p.kind === 'fruit').length >= 2);
    const [a, b] = s.live.filter((p) => p.kind === 'fruit');
    press(s, a.x, a.y);
    drag(s, b.x, b.y);
    const ev = step(s, DT);
    expect(ev.cuts.map((c) => c.chain)).toEqual([1, 2]);
    expect(ev.cuts[1].points).toBeGreaterThan(ev.cuts[0].points);
  });

  it('needs two cuts for a tough fruit', () => {
    const s = createLevel(3, new Rng(5), 'toss');
    until(s, () => s.live.some((p) => p.kind === 'tough'));
    const p = s.live.find((q) => q.kind === 'tough')!;
    press(s, p.x - p.r, p.y);
    drag(s, p.x + p.r, p.y);
    expect(step(s, DT).cracked).toContain(p);
    expect(p.hp).toBe(1);
    for (let i = 0; i < 10; i++) step(s, DT);
    press(s, p.x + p.r, p.y);
    drag(s, p.x - p.r, p.y);
    expect(step(s, DT).cuts.map((c) => c.p)).toContain(p);
  });

  it('costs a life for a bomb, and ends the run on Master', () => {
    for (const d of [3, 5] as const) {
      const s = createLevel(d, new Rng(2), 'bombs');
      until(s, () => s.live.some((p) => p.kind === 'bomb'));
      const b = s.live.find((p) => p.kind === 'bomb')!;
      press(s, b.x - 40, b.y);
      drag(s, b.x + 40, b.y);
      const ev = step(s, DT);
      expect(ev.booms).toEqual([b]);
      expect(s.lives).toBe(d === 5 ? 0 : LIVES - 1);
      expect(ev.over).toBe(d === 5);
    }
  });

  it('can be cleared at every level by slicing each fruit and dodging bombs', () => {
    for (const d of LEVELS)
      for (const seed of [1, 2, 3, 7, 11, 23]) {
        const { s, end, booms } = autopilot(d, seed);
        expect(end, `level ${d} seed ${seed}`).toBe('won');
        expect(booms).toBe(0);
        expect(s.sliced).toBe(fruitsFor(d));
        expect(s.score).toBeGreaterThanOrEqual(fruitsFor(d) * 10 + LIVES * LIFE_BONUS);
      }
  });

  it('deals different kinds across seeds, gated by level', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    for (let seed = 0; seed < 40; seed++) expect(['toss', 'rain', 'festival']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('can clear every kind at every level, with a streak that unlocks its rewards', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS))
        for (const seed of [3, 17]) {
          const { s, end, booms, unlocked } = autopilot(d, seed, id);
          expect(end, `${id} level ${d} seed ${seed}`).toBe('won');
          expect(booms).toBe(0);
          expect(s.sliced).toBe(fruitsFor(d));
          expect(unlocked.slice(0, 2), `${id} level ${d}`).toEqual(['slow', 'frenzy']);
        }
  });

  it('keeps every kind about as long as a classic toss', () => {
    for (const d of LEVELS) {
      const end = (id: KindId) => createLevel(d, new Rng(5), id).schedule.at(-1)!.t;
      for (const { id } of kindsAt(d, KINDS)) {
        expect(end(id), `${id} ${d}`).toBeGreaterThan(end('toss') * 0.6);
        expect(end(id), `${id} ${d}`).toBeLessThan(end('toss') * 1.5);
      }
    }
  });

  it('fires streak milestones: slow motion, then a frenzy of bonus fruit', () => {
    const s = createLevel(2, new Rng(1), 'toss');
    s.streak = STREAK_TIERS[0] - 1;
    until(s, () => s.live.some((p) => required(p.kind)));
    const p = s.live.find((q) => required(q.kind))!;
    press(s, p.x - 40, p.y);
    drag(s, p.x + 40, p.y);
    const ev = step(s, DT);
    expect(ev.tier).toBe(1);
    expect(ev.unlocked).toBe('slow');
    expect(s.slow).toBeGreaterThan(SLOW_S - 0.1);
    // Slow motion: the world runs slower than the clock.
    const t0 = s.time;
    step(s, 0.1);
    expect(s.time - t0).toBeLessThan(0.06);
    const before = s.live.length;
    grant(s, 'frenzy', 2);
    expect(s.live.filter((q) => q.kind === 'bonus').length).toBe(5);
    expect(s.live.length).toBe(before + 5);
  });

  it('a shield defuses the next bomb instead of costing a heart', () => {
    const s = createLevel(3, new Rng(2), 'bombs');
    grant(s, 'shield');
    until(s, () => s.live.some((p) => p.kind === 'bomb'));
    const b = s.live.find((p) => p.kind === 'bomb')!;
    press(s, b.x - 40, b.y);
    drag(s, b.x + 40, b.y);
    const ev = step(s, DT);
    expect(ev.defused).toEqual([b]);
    expect(ev.booms).toEqual([]);
    expect(s.lives).toBe(LIVES);
    expect(s.shield).toBe(0);
  });

  it('slows time when a frost fruit is sliced, and lets specials go without a penalty', () => {
    const s = createLevel(3, new Rng(4), 'festival');
    expect(s.schedule.filter((z) => z.kind === 'gold').length).toBe(3);
    expect(s.schedule.filter((z) => z.kind === 'frost').length).toBe(2);
    until(s, () => s.live.some((p) => p.kind === 'frost'));
    const f = s.live.find((p) => p.kind === 'frost')!;
    press(s, f.x - 40, f.y);
    drag(s, f.x + 40, f.y);
    step(s, DT);
    expect(s.slow).toBeGreaterThan(SLOW_S - 0.1);
    const g = createLevel(3, new Rng(4), 'festival');
    let missed = 0;
    for (let t = 0; t < 200 && !g.done; t += DT) {
      g.lives = LIVES;
      missed += step(g, DT).missed.filter((p) => !required(p.kind)).length;
    }
    expect(missed).toBe(0);
  });

  it('is lost by letting the fruit fall, but never in the first 3 s', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(8));
      for (let t = 0; t < 3.1; t += DT) step(s, DT);
      expect(s.lives, `level ${d}`).toBe(LIVES);
      let over = false;
      for (let t = 0; t < 120 && !over; t += DT) over = step(s, DT).over;
      expect(over).toBe(true);
      expect(s.lives).toBe(0);
    }
  });

  it('keeps the keyboard blade inside the field', () => {
    const s = createLevel(1, new Rng(6));
    s.kx = 1;
    for (let i = 0; i < 120; i++) step(s, DT);
    expect(s.bx).toBe(W);
  });
});

describe('slice game', () => {
  it('reports lives and status, then plays 3 s without ending', () => {
    for (const d of LEVELS) {
      const m = mountGame(slice, d, 5);
      expect(m.lives).toEqual([LIVES, LIVES]);
      expect(m.status).not.toBe('');
      expect(m.variant?.name).toBeTruthy();
      expect(m.variant!.name.length).toBeLessThanOrEqual(18);
      expect((m.variant!.blurb ?? '').length).toBeLessThanOrEqual(60);
      m.run(3);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('gives two stars for a clean clear, and three for one with combos', () => {
    for (const d of LEVELS) {
      const [two, three] = slice.stars(d);
      for (const { id } of kindsAt(d, KINDS)) {
        expect(autopilot(d, 1, id).s.score, `${id} ${d}`).toBeGreaterThanOrEqual(two);
        const best = Math.max(...[1, 2, 3, 4, 5, 6].map((seed) => comboPilot(d, seed, id).s.score));
        expect(best, `${id} level ${d}`).toBeGreaterThanOrEqual(three);
      }
    }
  });
});
