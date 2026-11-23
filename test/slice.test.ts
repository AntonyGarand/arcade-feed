import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { type Difficulty, LEVELS } from '../src/core/types';
import { slice } from '../src/games/slice';
import {
  createLevel,
  crosses,
  drag,
  fruitsFor,
  H,
  LIFE_BONUS,
  LIVES,
  type Piece,
  press,
  release,
  type State,
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
function autopilot(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
  let end: 'won' | 'over' | '' = '';
  let booms = 0;
  for (let t = 0; t < 300 && !end; t += DT) {
    const target = s.live.find((p) => p.kind !== 'bomb' && p.hp > 0 && p.y < H - p.r && (p.vy > -80 || p.y > H - 3 * p.r));
    if (target && (target.hitAt < 0 || s.time - target.hitAt > 0.2)) swipeThrough(s, target);
    const ev = step(s, DT);
    booms += ev.booms.length;
    if (ev.won) end = 'won';
    else if (ev.over) end = 'over';
  }
  return { s, end, booms };
}

/** Like the autopilot, but waits for fruit to bunch up near their apex and strings them in one stroke. */
function comboPilot(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
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
    expect(a.schedule).toEqual(b.schedule);
    expect(createLevel(3, new Rng(43)).schedule).not.toEqual(a.schedule);
    expect(a.schedule.filter((z) => z.kind !== 'bomb').length).toBe(fruitsFor(3));
    expect(a.schedule.filter((z) => z.kind === 'tough').length).toBe(toughFor(3));
  });

  it('gets harder: more and smaller fruit, faster arcs, more bombs', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(1));
      const hi = createLevel(d, new Rng(1));
      expect(hi.total).toBeGreaterThan(lo.total);
      expect(hi.r).toBeLessThan(lo.r);
      expect(hi.g).toBeGreaterThan(lo.g);
      // Bombs, averaged over a few seeds.
      const bombs = (dd: Difficulty) =>
        [1, 2, 3, 4, 5, 6, 7, 8].reduce(
          (n, seed) => n + createLevel(dd, new Rng(seed)).schedule.filter((z) => z.kind === 'bomb').length,
          0,
        );
      expect(bombs(d)).toBeGreaterThan(bombs((d - 1) as Difficulty));
    }
    expect(createLevel(1, new Rng(1)).schedule.some((z) => z.kind === 'bomb')).toBe(false);
  });

  it('keeps every throw inside the field', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(9));
      for (const z of s.schedule) {
        const land = z.x + (z.vx * 2 * -z.vy) / s.g;
        expect(land).toBeGreaterThan(0);
        expect(land).toBeLessThan(W);
      }
    }
  });

  it('slices a fruit with a fast swipe, but not with a slow drag', () => {
    const s = createLevel(1, new Rng(3));
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
    const s = createLevel(5, new Rng(4));
    until(s, () => s.live.filter((p) => p.kind === 'fruit').length >= 2);
    const [a, b] = s.live.filter((p) => p.kind === 'fruit');
    press(s, a.x, a.y);
    drag(s, b.x, b.y);
    const ev = step(s, DT);
    expect(ev.cuts.map((c) => c.chain)).toEqual([1, 2]);
    expect(ev.cuts[1].points).toBeGreaterThan(ev.cuts[0].points);
  });

  it('needs two cuts for a tough fruit', () => {
    const s = createLevel(3, new Rng(5));
    until(s, () => s.live.some((p) => p.kind === 'tough'));
    const p = s.live.find((q) => q.kind === 'tough')!;
    press(s, p.x - 40, p.y);
    drag(s, p.x + 40, p.y);
    expect(step(s, DT).cracked).toEqual([p]);
    expect(p.hp).toBe(1);
    for (let i = 0; i < 10; i++) step(s, DT);
    press(s, p.x + 40, p.y);
    drag(s, p.x - 40, p.y);
    expect(step(s, DT).cuts.map((c) => c.p)).toEqual([p]);
  });

  it('costs a life for a bomb, and ends the run on Master', () => {
    for (const d of [3, 5] as const) {
      const s = createLevel(d, new Rng(2));
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
      m.run(3);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('gives two stars for a clean clear, and three for one with combos', () => {
    for (const d of LEVELS) {
      const [two, three] = slice.stars(d);
      expect(autopilot(d, 1).s.score).toBeGreaterThanOrEqual(two);
      const best = Math.max(...[1, 2, 3, 4, 5, 6].map((seed) => comboPilot(d, seed).s.score));
      expect(best, `level ${d}`).toBeGreaterThanOrEqual(three);
    }
  });
});
