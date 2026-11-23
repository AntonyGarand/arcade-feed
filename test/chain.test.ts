import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { chain } from '../src/games/chain';
import {
  aimAt,
  coloursFor,
  countFor,
  createLevel,
  D,
  groupAt,
  H,
  insert,
  land,
  pointAt,
  present,
  progress,
  R,
  SHOOTER,
  shoot,
  speedFor,
  step,
  swapNext,
  trace,
  turnsFor,
  W,
  type Events,
  type Pop,
  type State,
} from '../src/games/chain/rules';
import { mountGame, type Mounted } from './support/mount';

const DT = 1 / 60;
const noEvents = (): Events => ({ landed: null, missed: null, pops: [], won: false, lost: false, bonus: 0 });

/** Size of the run a marble of colour `k` would make where a shot at `aim` lands, nudged towards the head. */
function rate(s: State, aim: number, k: number): number {
  const t = trace(s, aim);
  if (t.hit < 0) return 0;
  const copy = s.chain.map((m) => ({ ...m }));
  const i = insert({ ...s, chain: copy }, t.hit, t.after, k);
  const [lo, hi] = groupAt(copy, i);
  // Prefer pops near the hole: they pull the whole front back.
  return (hi - lo + 1) * 10 + s.chain[t.hit].p / s.track.length;
}

interface Shot {
  frame: number;
  aim: number;
  swap: boolean;
}

/**
 * Plays through the pure rules: waits `think` seconds between shots, then aims straight at the marble
 * where the loaded (or, with `swaps`, the next) colour makes the biggest run; with nothing worth a pair,
 * it shoots into empty space to be dealt another colour.
 */
function autopilot(d: Difficulty, seed: number, think = 0.45, swaps = true) {
  const s = createLevel(d, new Rng(seed));
  const shots: Shot[] = [];
  let wait = 1;
  for (let n = 0; n < 600 * 60; n++) {
    wait -= DT;
    if (!s.shot && wait <= 0) {
      let best = -1;
      let pick = { aim: 0, swap: false };
      for (const swap of swaps ? [false, true] : [false]) {
        const k = swap ? s.next : s.cur;
        for (const m of s.chain) {
          if (m.p < 0 || m.p > s.track.length) continue;
          const at = pointAt(s.track, m.p);
          const aim = Math.atan2(at.y - SHOOTER.y, at.x - SHOOTER.x);
          const v = rate(s, aim, k) - (swap ? 0.5 : 0);
          if (v > best) [best, pick] = [v, { aim, swap }];
        }
      }
      if (best < 20)
        for (let a = 0; a < 64; a++) {
          const aim = (a / 64) * Math.PI * 2;
          if (trace(s, aim).hit < 0) {
            pick = { aim, swap: false };
            break;
          }
        }
      shots.push({ frame: n, ...pick });
      if (pick.swap) swapNext(s);
      s.aim = pick.aim;
      shoot(s);
      wait = think;
    }
    const ev = step(s, DT);
    if (ev.won || ev.lost) return { s, win: ev.won, shots, seconds: n * DT };
  }
  throw new Error('never ended');
}

/** A level-5 state with its chain replaced by `kinds`, touching, starting at track distance `from`. */
function rigged(kinds: number[], from = 300): State {
  const s = createLevel(5, new Rng(3));
  s.chain = kinds.map((k, i) => ({ k, p: from + i * D, id: 100 + i }));
  return s;
}

describe('chain rules', () => {
  it('deals the same track and chain from the same seed', () => {
    const a = createLevel(3, new Rng(9));
    const b = createLevel(3, new Rng(9));
    expect(a.track.pts).toEqual(b.track.pts);
    expect(a.chain).toEqual(b.chain);
    expect([a.cur, a.next]).toEqual([b.cur, b.next]);
    const c = createLevel(3, new Rng(10));
    expect(c.track.pts).not.toEqual(a.track.pts);
    expect(c.chain.map((m) => m.k)).not.toEqual(a.chain.map((m) => m.k));
    expect(autopilot(2, 5).shots).toEqual(autopilot(2, 5).shots);
  });

  it('gets harder: a longer chain in more colours, pushed faster along a shorter track', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(countFor(d)).toBeGreaterThan(countFor(lo));
      expect(coloursFor(d)).toBeGreaterThanOrEqual(coloursFor(lo));
      expect(speedFor(d)).toBeGreaterThan(speedFor(lo));
      expect(turnsFor(d)).toBeLessThan(turnsFor(lo));
      expect(createLevel(d, new Rng(1)).track.length).toBeLessThan(createLevel(lo, new Rng(1)).track.length);
    }
    expect(coloursFor(5)).toBeGreaterThan(coloursFor(1));
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(d));
      expect(s.chain.length).toBe(countFor(d));
      expect(present(s.chain).every((k) => k >= 0 && k < coloursFor(d))).toBe(true);
      // The shooter only deals colours that are in the chain.
      expect(present(s.chain)).toContain(s.cur);
      expect(present(s.chain)).toContain(s.next);
      // No run of 4 at the start.
      for (let i = 0; i < s.chain.length; i++) expect(groupAt(s.chain, i)[1] - groupAt(s.chain, i)[0]).toBeLessThan(3);
    }
  });

  it('keeps the spiral inside the field, its loops apart and clear of the shooter', () => {
    for (const d of LEVELS)
      for (const seed of [1, 2, 3]) {
        const { pts, length } = createLevel(d, new Rng(seed)).track;
        expect(length).toBeGreaterThan(800);
        const n = pts.length / 2;
        let edge = Infinity;
        let core = Infinity;
        let loops = Infinity;
        for (let i = 0; i < n; i++) {
          const x = pts[i * 2];
          const y = pts[i * 2 + 1];
          edge = Math.min(edge, x, W - x, y, H - y);
          core = Math.min(core, Math.hypot(x - SHOOTER.x, y - SHOOTER.y));
          // Points far apart along the track are far apart on screen: marbles of two loops never overlap.
          for (let j = i + 60; j < n; j += 3) loops = Math.min(loops, Math.hypot(pts[j * 2] - x, pts[j * 2 + 1] - y));
        }
        expect(edge, `${d}/${seed}`).toBeGreaterThanOrEqual(R);
        expect(core, `${d}/${seed}`).toBeGreaterThan(2 * R + 10);
        expect(loops, `${d}/${seed}`).toBeGreaterThan(2 * R + 4);
      }
  });

  it('rolls in fast, then slowly, and nothing ends in the first seconds', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(7));
      for (let t = 0; t < 3; t += DT) {
        const ev = step(s, DT);
        expect(ev.lost || ev.won).toBe(false);
      }
      expect(progress(s)).toBeGreaterThan(0.2);
      expect(progress(s)).toBeLessThan(0.5);
      expect(s.speed).toBe(speedFor(d));
    }
  });

  it('inserts a shot where it hits and pops 3 of a kind', () => {
    const s = rigged([3, 0, 1, 1, 4]);
    // Next to the pair of 1s: they pop, and the front slides back.
    const ev = noEvents();
    land(s, 2, false, 1, 0, 0, ev);
    expect(ev.pops.length).toBe(1);
    expect(ev.pops[0].marbles.length).toBe(3);
    expect(s.chain.map((m) => m.k)).toEqual([3, 0, 4]);
    expect(s.score).toBe(30);
    // A marble that makes no run just pushes the front forward.
    const t = rigged([3, 0, 1, 4]);
    const head = t.chain[3].p;
    land(t, 1, true, 2, 0, 0, noEvents());
    expect(t.chain.map((m) => m.k)).toEqual([3, 0, 2, 1, 4]);
    expect(t.chain[4].p).toBe(head + D);
  });

  it('closes the gap and chains reactions when the ends match, multiplying the points', () => {
    const s = rigged([3, 0, 0, 1, 1, 2, 2, 1, 0, 4]);
    const pops: Pop[] = [];
    const ev = noEvents();
    land(s, 5, false, 2, 0, 0, ev);
    pops.push(...ev.pops);
    for (let t = 0; t < 3; t += DT) pops.push(...step(s, DT).pops);
    expect(pops.map((p) => p.combo)).toEqual([1, 2, 3]);
    expect(pops.map((p) => p.gain)).toEqual([30, 60, 90]);
    expect(s.chain.map((m) => m.k)).toEqual([3, 4]);
    expect(s.chain[1].p - s.chain[0].p).toBeCloseTo(D);
    // Ends that don't match just close up.
    const u = rigged([3, 0, 1, 1, 2]);
    land(u, 3, true, 1, 0, 0, noEvents());
    for (let t = 0; t < 2; t += DT) step(u, DT);
    expect(u.chain.map((m) => m.k)).toEqual([3, 0, 2]);
    expect(u.combo).toBe(1);
  });

  it('flies the shot to the marble it aims at, and lets it miss', () => {
    const s = createLevel(1, new Rng(4));
    for (let t = 0; t < 3; t += DT) step(s, DT);
    const target = s.chain.findLast((m) => m.p >= 0)!;
    const at = pointAt(s.track, target.p);
    aimAt(s, at.x, at.y);
    const before = s.chain.length;
    expect(trace(s, s.aim).hit).toBeGreaterThanOrEqual(0);
    expect(shoot(s)).toBe(true);
    expect(shoot(s)).toBe(false); // one shot at a time
    let ev = noEvents();
    for (let n = 0; n < 60 && !ev.landed; n++) ev = step(s, DT);
    expect(ev.landed).not.toBeNull();
    expect(s.chain.length).toBe(before + 1 - ev.pops.reduce((a, p) => a + p.marbles.length, 0));
    // Straight at a gap in the spiral: out of the field.
    const free = Array.from({ length: 64 }, (_, a) => (a / 64) * Math.PI * 2).find((a) => trace(s, a).hit < 0)!;
    s.aim = free;
    shoot(s);
    ev = noEvents();
    for (let n = 0; n < 60 && !ev.missed; n++) ev = step(s, DT);
    expect(ev.missed).not.toBeNull();
    expect(s.shot).toBeNull();
  });

  it('is lost when the head rolls into the hole', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(d));
      let ev = noEvents();
      let t = 0;
      for (; t < 300 && !ev.lost; t += DT) ev = step(s, DT);
      expect(ev.lost, `level ${d}`).toBe(true);
      expect(t).toBeGreaterThan(20);
      expect(s.chain.at(-1)!.p).toBeGreaterThanOrEqual(s.track.length);
      // Over: nothing moves any more.
      expect(step(s, DT).lost).toBe(false);
    }
  });

  it('is cleared by the autopilot at every level, with stars for a fast clean run', () => {
    for (const d of LEVELS) {
      const seeds = [1, 2, 3, 4, 5, 6].map((k) => k * 13 + d);
      const fast = seeds.map((seed) => autopilot(d, seed));
      const slow = seeds.map((seed) => autopilot(d, seed, 1.2));
      for (const r of [...fast, ...slow]) {
        expect(r.win, `level ${d}`).toBe(true);
        expect(r.s.popped).toBeGreaterThanOrEqual(countFor(d));
      }
      const stars = fast.map((r) => starsFor(chain, d, true, r.s.score));
      const slowStars = slow.map((r) => starsFor(chain, d, true, r.s.score));
      expect(stars.filter((n) => n >= 2).length, `level ${d}`).toBeGreaterThanOrEqual(4);
      expect(
        stars.some((n) => n === 3),
        `level ${d}`,
      ).toBe(true);
      expect(slowStars.filter((n) => n === 3).length, `level ${d}`).toBeLessThanOrEqual(stars.filter((n) => n === 3).length);
    }
  });
});

describe('chain game', () => {
  const key = (m: Mounted, k: string, type = 'keydown') => m.inst.onKey?.(new KeyboardEvent(type, { key: k }));

  it('mounts at every level and keeps rolling without input', () => {
    for (const d of LEVELS) {
      const m = mountGame(chain, d, 4);
      expect(m.status).toContain(String(countFor(d)));
      m.run(4);
      expect(m.outcome).toBe('');
      expect(m.score).toBe(0);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('is lost by doing nothing', () => {
    const m = mountGame(chain, 3, 4);
    m.run(200);
    expect(m.outcome).toBe('lose');
    m.inst.destroy?.();
    m.root.remove();
  });

  it('aims, swaps and shoots from the keyboard', () => {
    const m = mountGame(chain, 1, 4);
    m.run(2);
    key(m, 'x');
    // Sweep the aim round while firing: some shots join the chain.
    key(m, 'ArrowRight');
    for (let n = 0; n < 12; n++) {
      key(m, ' ');
      m.run(0.25);
    }
    key(m, 'ArrowRight', 'keyup');
    expect(Number(/\d+/.exec(m.status)![0])).not.toBe(countFor(1));
    m.inst.destroy?.();
    m.root.remove();
  });

  it('plays the autopilot’s shots by tapping, to a win', () => {
    for (const d of [1, 5] as const) {
      const { s, shots } = autopilot(d, 3);
      const m = mountGame(chain, d, 3);
      const canvas = m.root.querySelector('canvas')!;
      // The test DOM has no layout: client coordinates map to world units through a 1×1 box.
      const tap = (x: number, y: number) => {
        for (const type of ['pointerdown', 'pointerup'])
          canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x / W, clientY: y / H, bubbles: true }));
      };
      let k = 0;
      for (let n = 0; !m.outcome && n < 600 * 60; n++) {
        const shot = shots[k];
        if (shot?.frame === n) {
          if (shot.swap) key(m, 'x');
          tap(SHOOTER.x + Math.cos(shot.aim) * 120, SHOOTER.y + Math.sin(shot.aim) * 120);
          k++;
        }
        m.inst.frame?.(DT);
      }
      expect(m.outcome).toBe('win');
      expect(m.score).toBe(s.score);
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
