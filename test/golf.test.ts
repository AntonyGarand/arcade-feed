import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { golf } from '../src/games/golf';
import {
  COIN_POINTS,
  coinsFor,
  createLevel,
  gateRect,
  grantBoon,
  KINDS,
  type KindId,
  distanceField,
  fieldAt,
  gapFor,
  limitFor,
  parFor,
  putt,
  scoreOf,
  step,
  STROKE_POINTS,
  TRICK_TIERS,
  type State,
  type StepEvents,
} from '../src/games/golf/rules';
import { kindsAt } from '../src/core/variety';
import { mountGame } from './support/mount';

/** Roll the putt out. */
function roll(s: State, dt = 1 / 60): StepEvents {
  for (let t = 0; t < 30; t += dt) {
    const ev = step(s, dt);
    if (ev.stopped || ev.cleared) return ev;
  }
  throw new Error('ball never stopped');
}

/**
 * Try a fan of angles and powers on copies of the state; keep the putt that sinks, or else the one that
 * leaves the ball the shortest walk (around the walls) from the cup.
 */
function bestPutt(s: State, field: Float64Array): [number, number] {
  const rate = (a: number, p: number) => {
    const c = structuredClone(s);
    c.aim = a;
    c.power = p;
    putt(c);
    const ev = roll(c, 1 / 30);
    return ev.cleared ? -1000 + p : fieldAt(field, c.bx, c.by) + (c.strokes - s.strokes - 1) * 400;
  };
  const tried: [number, number, number][] = [];
  for (let i = 0; i < 36; i++)
    for (const p of [0.15, 0.32, 0.52, 0.74, 1]) {
      const a = (i / 36) * Math.PI * 2;
      tried.push([rate(a, p), a, p]);
    }
  // Refine around the three best, rating each putt by its worst outcome with the aim a hair off (a chaotic
  // bank shot that only works on an exact line isn't a plan).
  tried.sort((x, y) => x[0] - y[0]);
  const safe: [number, number, number][] = [];
  for (const [, a0, p0] of tried.slice(0, 3))
    for (const da of [-0.06, -0.03, 0, 0.03, 0.06])
      for (const dp of [-0.08, 0, 0.08]) {
        const p = Math.max(0.05, Math.min(1, p0 + dp));
        const a = a0 + da;
        safe.push([Math.max(rate(a - 0.01, p), rate(a, p), rate(a + 0.01, p)), a, p]);
      }
  safe.sort((x, y) => x[0] - y[0]);
  return [safe[0][1], safe[0][2]];
}

const noise = (r: Rng, sd: number) => (r.next() + r.next() + r.next() - 1.5) * sd * 2;

/** Play the hole out with aim and power off by about `sd`. */
function autopilot(d: Difficulty, seed: number, sd: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const field = distanceField(s);
  const hand = new Rng(seed * 13 + 5);
  for (;;) {
    const [a, p] = bestPutt(s, field);
    s.aim = a + noise(hand, sd);
    s.power = Math.max(0, Math.min(1, p * (1 + noise(hand, sd * 1.5))));
    putt(s);
    const ev = roll(s);
    if (ev.cleared || ev.over) return { s, win: ev.cleared };
  }
}

const SEEDS = [1, 2, 3, 4];

describe('golf rules', () => {
  it('lays out the same hole from the same seed', () => {
    const a = createLevel(5, new Rng(21));
    expect(createLevel(5, new Rng(21))).toEqual(a);
    expect(createLevel(5, new Rng(22)).walls).not.toEqual(a.walls);
  });

  it('gets harder: more walls and hazards, narrower gaps, a higher par', () => {
    const count = (d: Difficulty) => {
      let n = 0;
      for (let k = 1; k <= 6; k++) {
        const s = createLevel(d, new Rng(k), 'classic');
        n += s.walls.length + s.sand.length + s.water.length * 2;
      }
      return n;
    };
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(count(d)).toBeGreaterThan(count(lo));
      expect(gapFor(d)).toBeLessThan(gapFor(lo));
      expect(parFor(d)).toBeGreaterThanOrEqual(parFor(lo));
    }
    expect(createLevel(5, new Rng(3), 'classic').water.length).toBeGreaterThan(0);
  });

  it('always leaves a way from the tee to the cup', () => {
    for (const d of LEVELS)
      for (let k = 0; k < 12; k++) {
        const s = createLevel(d, new Rng(k * 101 + d));
        expect(fieldAt(distanceField(s), s.tee.x, s.tee.y), `level ${d} seed ${k}`).toBeLessThan(Infinity);
      }
  });

  it('bounces off walls, stops by friction, and costs a stroke in the water', () => {
    const s = createLevel(3, new Rng(4), 'classic');
    s.walls = s.walls.slice(0, 4);
    s.sand = [];
    s.pads = [];
    s.coins = [];
    s.gates = [];
    s.water = [{ x: 100, y: 150, w: 100, h: 40 }];
    s.bx = 150;
    s.by = 300;
    s.aim = Math.PI / 2; // straight down into the bottom wall
    s.power = 1;
    putt(s);
    let bumped = 0;
    let top = 300;
    for (let t = 0; t < 30 && s.rolling; t += 1 / 60) {
      bumped = Math.max(bumped, step(s, 1 / 60).bump);
      if (s.rolling) top = Math.min(top, s.by);
    }
    expect(bumped).toBeGreaterThan(0);
    expect(top).toBeLessThan(200); // came back up the course after the bounce
    expect(s.strokes).toBe(2); // the rebound carried it into the pond
    expect(s.bx).toBe(150);
    expect(s.by).toBe(300);
  });

  it('is lost when the strokes run out', () => {
    const s = createLevel(1, new Rng(5));
    let ev: StepEvents | null = null;
    while (!ev?.over) {
      s.aim = Math.atan2(s.cup.y - s.by, s.cup.x - s.bx) + Math.PI; // away from the cup
      s.power = 0.05;
      expect(putt(s)).toBe(true);
      ev = roll(s);
      expect(ev.cleared).toBe(false);
    }
    expect(s.strokes).toBe(limitFor(1));
    expect(putt(s)).toBe(false);
  });

  it('is holed out at every level by a decent player, and three stars need a sharp one', () => {
    for (const d of LEVELS) {
      const decent = SEEDS.map((k) => autopilot(d, k * 7 + d, 0.035));
      const sharp = SEEDS.map((k) => autopilot(d, k * 7 + d, 0.006));
      const stars = (r: { s: State; win: boolean }) => starsFor(golf, d, r.win, r.s.score);
      expect(decent.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(3);
      expect(
        sharp.every((r) => r.win),
        `level ${d}`,
      ).toBe(true);
      expect(sharp.filter((r) => stars(r) === 3).length, `level ${d}`).toBeGreaterThanOrEqual(2);
      for (const r of decent.filter((x) => x.win))
        expect(r.s.score).toBe(STROKE_POINTS * (limitFor(d) - r.s.strokes + 1) + COIN_POINTS * r.s.coins.filter((c) => c.taken).length);
    }
  }, 20_000);
});

describe('golf level kinds', () => {
  it('deals the same kind and hole from the same seed, and several kinds across seeds', () => {
    for (const d of LEVELS) {
      const a = createLevel(d, new Rng(77));
      expect(createLevel(d, new Rng(77))).toEqual(a);
      const seen = new Set<string>();
      for (let k = 0; k < 40; k++) seen.add(createLevel(d, new Rng(k)).kind);
      expect(seen.size, `level ${d}`).toBeGreaterThanOrEqual(d === 1 ? 2 : 3);
      for (const id of seen) expect(kindsAt(d, KINDS).map((x) => x.id)).toContain(id);
    }
  });

  it('gives every kind its own features, the same coins, and a way to the cup', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS))
        for (let k = 0; k < 4; k++) {
          const s = createLevel(d, new Rng(k * 31 + d), id);
          expect(s.kind).toBe(id);
          expect(s.coins.length, `${id} ${d}`).toBe(coinsFor(d));
          expect(fieldAt(distanceField(s), s.tee.x, s.tee.y), `${id} ${d}`).toBeLessThan(Infinity);
          const features = {
            gates: s.gates.length,
            pads: s.pads.length,
            bumpers: s.walls.filter((w) => w.kind === 'disc').length,
            ponds: s.water.length,
          };
          expect(features.gates > 0, `${id} ${d}`).toBe(id === 'gates');
          expect(features.pads >= 2 || id !== 'speedway').toBe(true);
          expect(features.bumpers >= 3 || id !== 'pinball').toBe(true);
          expect(features.ponds >= 2 || id !== 'lakes').toBe(true);
        }
  });

  it('every kind can be holed out by a sharp player', () => {
    for (const d of [2, 4, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const runs = [1, 2].map((k) => autopilot(d, k * 5 + d, 0.006, id));
        expect(
          runs.every((r) => r.win),
          `${id} level ${d}`,
        ).toBe(true);
      }
  }, 30_000);

  it('a sliding gate never closes its gap, and nudges a resting ball out of its way', () => {
    const s = createLevel(3, new Rng(8), 'gates');
    for (const g of s.gates)
      for (let t = 0; t < 10; t += 0.1) {
        const r = gateRect(g, t);
        expect(r.x).toBeGreaterThanOrEqual(g.lo - 1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(g.hi + 1e-9);
        expect(g.hi - g.lo - r.w).toBeGreaterThan(30);
      }
    const g = s.gates[0];
    const r = gateRect(g, s.t);
    s.bx = r.x + r.w / 2;
    s.by = g.y + 2;
    step(s, 0);
    expect(Math.abs(s.by - g.y)).toBeGreaterThan(5);
  });

  it('a boost pad speeds up a ball rolling along its arrow', () => {
    const s = createLevel(2, new Rng(3), 'classic');
    s.walls = s.walls.slice(0, 4);
    Object.assign(s, { sand: [], water: [], coins: [], gates: [] });
    s.pads = [{ x: 140, y: 250, w: 28, h: 28, dir: -Math.PI / 2 }];
    const plain = structuredClone({ ...s, pads: [] });
    for (const x of [s, plain]) {
      x.bx = 154;
      x.by = 330;
      x.aim = -Math.PI / 2;
      x.power = 0.3;
      putt(x);
    }
    let boosts = 0;
    for (let i = 0; i < 600 && (s.rolling || plain.rolling); i++) {
      boosts += step(s, 1 / 60).boosts.length;
      step(plain, 1 / 60);
    }
    expect(boosts).toBe(1);
    expect(s.by).toBeLessThan(plain.by - 40);
  });

  it('tricks in one putt unlock the aim guide, then the magnet cup, then a free putt', () => {
    const s = createLevel(1, new Rng(2), 'classic');
    s.walls = s.walls.slice(0, 4);
    Object.assign(s, { sand: [], water: [], pads: [], gates: [] });
    s.bx = 150;
    s.by = 360;
    s.cup = { x: 40, y: 40 };
    // A line of coins straight up the course: each one picked up is a trick.
    s.coins = [330, 300, 270, 240, 210, 180, 150, 120].map((y) => ({ x: 150, y, taken: false }));
    s.aim = -Math.PI / 2;
    s.power = 0.75;
    putt(s);
    const unlocked: string[] = [];
    let tricks = 0;
    while (s.rolling) {
      const ev = step(s, 1 / 60);
      tricks += ev.tricks;
      if (ev.unlocked) unlocked.push(ev.unlocked);
    }
    expect(tricks).toBeGreaterThanOrEqual(TRICK_TIERS[2]);
    expect(unlocked).toEqual(['guide', 'magnet', 'free']);
    expect(s.guide && s.magnet).toBe(true);
    // The free putt doesn't count as a stroke.
    expect(s.free).toBe(1);
    const strokes = s.strokes;
    s.aim = 0;
    s.power = 0.1;
    putt(s);
    expect(s.strokes).toBe(strokes);
    expect(s.free).toBe(0);
    // A new putt starts a new trick count, and a milestone fires only once per hole.
    expect(s.tricks).toBe(0);
    grantBoon(s, 'free');
    expect(s.free).toBe(1);
  });

  it('pays coins on top of the strokes left', () => {
    const s = createLevel(3, new Rng(5), 'classic');
    s.coins[0].taken = true;
    s.strokes = 2;
    expect(scoreOf(s)).toBe(STROKE_POINTS * (limitFor(3) - 1) + COIN_POINTS);
  });
});

describe('golf game', () => {
  it('names the kind of hole on the start gate', () => {
    const m = mountGame(golf, 3, 4);
    expect(m.variant?.id).toBe(createLevel(3, new Rng(4)).kind);
    expect(m.variant?.name.length).toBeLessThanOrEqual(18);
    expect((m.variant?.blurb ?? '').length).toBeLessThanOrEqual(60);
    m.inst.destroy?.();
    m.root.remove();
  });

  const key = (m: ReturnType<typeof mountGame>, k: string, type = 'keydown') => m.inst.onKey?.(new KeyboardEvent(type, { key: k }));

  it('mounts, putts with Space and counts the stroke', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(golf, d, 2);
      expect(m.status).toContain(`0/${limitFor(d)}`);
      m.run(2);
      expect(m.outcome).toBe('');
      expect(key(m, 'ArrowLeft')).toBe(true);
      m.run(0.2);
      key(m, 'ArrowLeft', 'keyup');
      expect(key(m, ' ')).toBe(true);
      m.run(10);
      // One stroke (two if the putt found the water).
      expect(m.status).toMatch(new RegExp(`Strokes [12]/${limitFor(d)}`));
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('can be holed out from the keyboard', () => {
    const m = mountGame(golf, 2, 9);
    const twin = createLevel(2, new Rng(9));
    const field = distanceField(twin);
    // Plan each putt on the twin, dial it in with the keys, then roll both in lockstep.
    for (let shot = 0; shot < 8 && !twin.done; shot++) {
      const [a, p] = bestPutt(twin, field);
      const target = twin.aim + Math.atan2(Math.sin(a - twin.aim), Math.cos(a - twin.aim));
      for (let f = 0; f < 4000; f++) {
        const turn = Math.abs(twin.aim - target) > 0.002 ? Math.sign(target - twin.aim) : 0;
        const pump = Math.abs(twin.power - p) > 0.002 ? Math.sign(p - twin.power) : 0;
        if (!turn && !pump) break;
        for (const [k, on] of [
          ['ArrowRight', turn > 0],
          ['ArrowLeft', turn < 0],
          ['ArrowUp', pump > 0],
          ['ArrowDown', pump < 0],
        ] as const)
          key(m, k, on ? 'keydown' : 'keyup');
        twin.turn = turn;
        twin.pump = pump;
        m.inst.frame?.(1 / 1000);
        step(twin, 1 / 1000);
      }
      for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) key(m, k, 'keyup');
      twin.turn = twin.pump = 0;
      key(m, ' ');
      putt(twin);
      while (twin.rolling) {
        m.inst.frame?.(1 / 60);
        step(twin, 1 / 60);
      }
    }
    // The result comes once the sink has played out.
    expect(m.outcome).toBe('');
    m.run(1);
    expect(m.outcome).toBe('win');
    expect(m.score).toBe(twin.score);
    expect(m.score).toBeGreaterThan(0);
  });
});
