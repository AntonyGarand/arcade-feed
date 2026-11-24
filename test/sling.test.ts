import { describe, expect, it } from 'vitest';
import { _setLocaleForTests } from '../src/core/i18n';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { sling } from '../src/games/sling';
import { createLevel, KINDS, type KindId } from '../src/games/sling/level';
import {
  CHAIN_TIERS,
  fire,
  grant,
  GROUND,
  setAim,
  shotsFor,
  step,
  stoneOf,
  targetsFor,
  type State,
  type StepEvents,
} from '../src/games/sling/rules';
import { mountGame } from './support/mount';

const DT = 1 / 30;

/** Fling a stone and play until the world settles. Returns everything that happened. */
function play(s: State, angle: number, power: number) {
  setAim(s, angle, power);
  expect(fire(s)).toBe(true);
  const all: StepEvents[] = [];
  for (let t = 0; t < 20 && s.phase === 'flight'; t += DT) all.push(step(s, DT));
  expect(s.phase).not.toBe('flight');
  return all;
}

const blocks = (s: State) => s.bodies.filter((b) => b.mat === 'wood' || b.mat === 'stone' || b.mat === 'ice' || b.mat === 'tnt');
const hp = (s: State) => blocks(s).reduce((a, b) => a + b.hp, 0);

/**
 * Brute-force aim: try a grid of angles and pulls on copies of the state, refine around the best few,
 * keep the shot that pops the most blobs (then scores most, then damages most).
 */
function bestShot(s: State): [number, number] {
  const rate = (a: number, p: number): [number, number, number] => {
    const c = structuredClone(s);
    play(c, a, p);
    return [(s.targets - c.targets) * 1000 + c.score - s.score + (hp(s) - hp(c)) * 5, a, p];
  };
  const tried: [number, number, number][] = [];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) tried.push(rate(-0.3 + (i * 1.6) / 15, 0.3 + j * 0.1));
  tried.sort((x, y) => y[0] - x[0]);
  for (const [, a0, p0] of tried.slice(0, 4))
    for (const da of [-0.04, -0.02, 0.02, 0.04]) for (const dp of [-0.05, 0, 0.05]) tried.push(rate(a0 + da, Math.min(1, p0 + dp)));
  tried.sort((x, y) => y[0] - x[0]);
  return [tried[0][1], tried[0][2]];
}

describe('sling rules', () => {
  it('deals the same forts from the same seed', () => {
    const a = createLevel(4, new Rng(42));
    const b = createLevel(4, new Rng(42));
    expect(a.kind).toBe(b.kind);
    expect(a.bodies).toEqual(b.bodies);
    expect(createLevel(4, new Rng(43)).bodies).not.toEqual(a.bodies);
  });

  it('gets harder: more blobs and blocks, a boulder, then stone', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(5), 'village');
      expect(s.targets).toBe(targetsFor(d));
      expect(s.shots).toBe(shotsFor(d));
      expect(s.shots).toBeLessThanOrEqual(s.targets + 1);
      // The boulder: a rock standing between the sling and the forts.
      expect(
        s.bodies.some((b) => b.mat === 'ground' && b.x < 120 && b.y < GROUND),
        `boulder ${d}`,
      ).toBe(d >= 2);
      expect(s.bodies.some((b) => b.mat === 'stone') && d < 3, `stone ${d}`).toBe(false);
    }
    const avg = (d: Difficulty) => [1, 2, 3, 4].reduce((a, seed) => a + blocks(createLevel(d, new Rng(seed), 'village')).length, 0);
    for (const d of LEVELS.slice(1)) expect(avg(d)).toBeGreaterThan(avg((d - 1) as Difficulty));
    expect([1, 2, 3, 4].some((seed) => createLevel(5, new Rng(seed), 'village').bodies.some((b) => b.mat === 'stone'))).toBe(true);
  });

  it('keeps every kind of fort standing still, even when everything is woken', () => {
    // Hovering blobs drift on purpose: only what stands on the ground has to keep still.
    const where = (s: State) => s.bodies.filter((b) => !b.hover).map((b) => [b.x, b.y]);
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS))
        for (const seed of [1, 2, 3]) {
          const s = createLevel(d, new Rng(seed), id);
          const at = where(s);
          for (let t = 0; t < 3; t += DT) step(s, DT);
          expect(where(s)).toEqual(at);
          for (const b of s.bodies) b.awake = b.inv > 0;
          s.phase = 'flight';
          for (let t = 0; t < 3; t += DT) step(s, DT);
          expect(s.targets, `${id} ${d}/${seed}`).toBe(targetsFor(d));
          expect(s.score).toBe(0);
          const now = where(s);
          const moved = Math.max(...now.map((p, i) => Math.hypot(p[0] - at[i][0], p[1] - at[i][1])));
          expect(moved, `${id} ${d}/${seed}`).toBeLessThan(1.5);
        }
  });

  it('deals different kinds of fort across seeds, only easy ones at level 1', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBe(KINDS.length);
    for (let seed = 0; seed < 30; seed++) expect(['village', 'frozen', 'sky']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('builds each kind its own way', () => {
    const mats = (k: KindId) => new Set(createLevel(4, new Rng(2), k).bodies.map((b) => b.mat));
    expect(mats('frozen').has('ice')).toBe(true);
    expect(mats('frozen').has('wood')).toBe(false);
    expect(mats('powder').has('tnt')).toBe(true);
    expect(mats('village').has('tnt')).toBe(false);
    const sky = createLevel(4, new Rng(2), 'sky');
    expect(sky.bodies.filter((b) => b.hover).length).toBe(2);
    // A tower: one hut far taller than a village's.
    const top = (k: KindId) =>
      Math.min(
        ...createLevel(4, new Rng(2), k)
          .bodies.filter((b) => b.inv > 0 && !b.hover)
          .map((b) => b.y - b.hh),
      );
    expect(top('tower')).toBeLessThan(GROUND - 140);
  });

  it('aims with the keys and fires one stone at a time', () => {
    const s = createLevel(2, new Rng(3));
    const a0 = s.angle;
    s.turn = 1;
    step(s, 0.25);
    expect(s.angle).toBeGreaterThan(a0);
    s.turn = 0;
    expect(fire(s)).toBe(true);
    expect(fire(s)).toBe(false);
    expect(stoneOf(s)?.vx).toBeGreaterThan(0);
    expect(s.used).toBe(1);
  });

  it('lets a stone into the dirt pop nothing, then crumbles it and readies the next', () => {
    const s = createLevel(3, new Rng(8));
    const evs = play(s, -0.5, 0);
    expect(s.targets).toBe(targetsFor(3));
    expect(evs.some((e) => e.ready)).toBe(true);
    expect(evs.flatMap((e) => e.crumbled)).toHaveLength(1);
    expect(s.bodies.some((b) => b.mat === 'shot')).toBe(false);
    expect(s.phase).toBe('aim');
  });

  it('pops a blob that is dropped, breaks wood and cracks stone first', () => {
    const s = createLevel(1, new Rng(1), 'village');
    const blob = s.bodies.find((b) => b.mat === 'blob')!;
    // Dropped from high up, in the open.
    blob.x = 110;
    blob.y = GROUND - 80;
    blob.awake = true;
    s.phase = 'flight';
    const evs: StepEvents[] = [];
    for (let t = 0; t < 1.5; t += DT) evs.push(step(s, DT));
    expect(evs.flatMap((e) => e.popped).length).toBeGreaterThanOrEqual(1);
    expect(s.targets).toBeLessThan(targetsFor(1));

    const w = createLevel(5, new Rng(2), 'village');
    const wood = w.bodies.find((b) => b.mat === 'wood')!;
    const stone = w.bodies.find((b) => b.mat === 'stone')!;
    for (const b of [wood, stone]) {
      b.awake = true;
      b.vy = 420; // slammed into what is below
    }
    w.phase = 'flight';
    const hits: StepEvents[] = [];
    for (let i = 0; i < 3; i++) hits.push(step(w, 1 / 120));
    expect(hits.some((e) => e.broken.some((h) => h.mat === 'wood'))).toBe(true);
    expect(hits.some((e) => e.cracked.some((h) => h.mat === 'stone'))).toBe(true);
  });

  it('can clear every level by aiming well, for several seeds', () => {
    for (const d of LEVELS) {
      let best = 0;
      for (const seed of [1, 2, 3]) {
        const s = createLevel(d, new Rng(seed));
        while (s.phase !== 'done') {
          const [a, p] = bestShot(s);
          play(s, a, p);
        }
        expect(s.targets, `level ${d} seed ${seed}`).toBe(0);
        expect(s.used).toBeLessThanOrEqual(s.shots);
        best = Math.max(best, starsFor(sling, d, true, s.score));
      }
      // Three stars are within reach of a clean run.
      expect(best, `level ${d}`).toBe(3);
    }
  }, 120_000);

  it('can clear every kind of fort by aiming well', () => {
    for (const d of [3, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const s = createLevel(d, new Rng(3), id);
        while (s.phase !== 'done') {
          const [a, p] = bestShot(s);
          play(s, a, p);
        }
        expect(s.targets, `${id} level ${d}`).toBe(0);
      }
  }, 120_000);

  it('sets off dynamite with a hard knock: it pops the blobs and blows up the dynamite near it', () => {
    const s = createLevel(3, new Rng(4), 'powder');
    const tnt = s.bodies.filter((b) => b.mat === 'tnt');
    expect(tnt.length).toBeGreaterThan(0);
    const near = s.bodies.filter((b) => b.mat === 'blob' && Math.hypot(b.x - tnt[0].x, b.y - tnt[0].y) < 25);
    tnt[0].awake = true;
    tnt[0].vy = 420;
    s.phase = 'flight';
    const evs: StepEvents[] = [];
    for (let i = 0; i < 4; i++) evs.push(step(s, 1 / 120));
    expect(evs.flatMap((e) => e.blasts).length).toBeGreaterThanOrEqual(1);
    for (const b of near) expect(s.bodies).not.toContain(b);
    expect(s.score).toBeGreaterThan(0);
  });

  it('keeps sky grumps hovering, and pops one at a touch', () => {
    const s = createLevel(3, new Rng(5), 'sky');
    const fly = s.bodies.find((b) => b.hover)!;
    const at = [fly.x, fly.y];
    step(s, 0.5);
    expect(Math.hypot(fly.x - at[0], fly.y - at[1])).toBeGreaterThan(0.5);
    setAim(s, 0, 0);
    fire(s);
    const stone = stoneOf(s)!;
    Object.assign(stone, { x: fly.x - 22, y: fly.y, vx: 320, vy: 0 });
    const popped = [];
    for (let i = 0; i < 20; i++) popped.push(...step(s, 1 / 120).popped);
    expect(popped.length).toBe(1);
    expect(s.targets).toBe(targetsFor(3) - 1);
  });

  it('a big smash with one stone unlocks an explosive stone, then a stone more', () => {
    const s = createLevel(4, new Rng(3), 'frozen');
    const shots = s.shots;
    setAim(s, -0.5, 0);
    fire(s);
    // Slam every ice block into what is below it: they all shatter on this one shot.
    for (const b of s.bodies)
      if (b.mat === 'ice') {
        b.awake = true;
        b.vy = 420;
      }
    const rewards: string[] = [];
    for (let t = 0; t < 20 && s.phase === 'flight'; t += DT) rewards.push(...step(s, DT).rewards.map((r) => r.reward));
    expect(s.chain).toBeGreaterThanOrEqual(CHAIN_TIERS[1]);
    expect(rewards.slice(0, 2)).toEqual(['boom', 'stone']);
    expect(s.shots).toBe(shots + 1);
    expect(s.boomNext).toBe(true);
  });

  it('an explosive stone goes off at its first touch, and each stone starts a new chain', () => {
    const s = createLevel(2, new Rng(3), 'village');
    grant(s, 'boom');
    s.chain = 3;
    setAim(s, -0.5, 0);
    fire(s);
    expect(s.chain).toBe(0);
    expect(s.boomNext).toBe(false);
    expect(stoneOf(s)?.boom).toBe(true);
    const evs = flyOut(s);
    expect(evs.some((e) => e.blasts.length)).toBe(true);
  });

  it('a triple stone splits in three at the top of its arc', () => {
    const s = createLevel(2, new Rng(3), 'village');
    grant(s, 'split');
    setAim(s, 0.8, 0.6);
    fire(s);
    let split = false;
    for (let t = 0; t < 2 && !split; t += DT) split = !!step(s, DT).split;
    expect(split).toBe(true);
    expect(s.bodies.filter((b) => b.mat === 'shot').length).toBe(3);
  });

  it('loses when the stones run out with blobs left', () => {
    const s = createLevel(1, new Rng(4), 'village');
    let over = false;
    for (let i = 0; i < s.shots; i++) over = play(s, -0.5, 0).some((e) => e.over);
    expect(over).toBe(true);
    expect(s.phase).toBe('done');
    expect(s.targets).toBe(targetsFor(1));
    expect(fire(s)).toBe(false);
  });
});

/** Play out the stone already in flight. */
function flyOut(s: State) {
  const all: StepEvents[] = [];
  for (let t = 0; t < 20 && s.phase === 'flight'; t += DT) all.push(step(s, DT));
  return all;
}

describe('sling game', () => {
  it('names the kind of fort it dealt on the start gate, in both languages', () => {
    for (const lang of ['en', 'fr'] as const) {
      _setLocaleForTests(lang);
      for (let seed = 0; seed < 30; seed++) {
        const m = mountGame(sling, 4, seed);
        expect(m.variant?.id).toBeTruthy();
        expect(m.variant!.name.length).toBeLessThanOrEqual(18);
        expect(m.variant!.blurb!.length).toBeLessThanOrEqual(60);
        m.inst.destroy?.();
        m.root.remove();
      }
    }
    _setLocaleForTests('en');
  });

  it('waits at every level until a stone is flung, then fires on Space', () => {
    for (const d of LEVELS) {
      const m = mountGame(sling, d, 9);
      m.run(3);
      expect(m.outcome).toBe('');
      expect(m.status).toContain(`${targetsFor(d)} grumps left`);
      m.inst.onKey?.(new KeyboardEvent('keydown', { key: ' ' }));
      expect(m.status).toContain(`${shotsFor(d) - 1} stones`);
      m.run(10);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('has star goals above the blobs alone', () => {
    for (const d of LEVELS) {
      const [two, three] = sling.stars(d);
      expect(three).toBeGreaterThan(two);
      expect(two).toBeGreaterThan(targetsFor(d) * 100);
    }
  });
});
