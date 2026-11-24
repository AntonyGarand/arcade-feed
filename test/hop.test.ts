import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { hop } from '../src/games/hop';
import {
  CAM_START,
  createLevel,
  grant,
  KINDS,
  REGROW_S,
  solid,
  crittersFor,
  goalFor,
  JUMP_H,
  LIVES,
  pilot,
  SPRING,
  springsFor,
  step,
  W,
  wdelta,
  widthFor,
  type KindId,
  type State,
} from '../src/games/hop/rules';

import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Play with `steer` choosing the direction each frame. Returns the end state. */
function play(d: Difficulty, seed: number, steer: (s: State) => -1 | 0 | 1, seconds = 240, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  let hurt = 0;
  for (let t = 0; t < seconds && !s.won && !s.over; t += DT) {
    s.dir = steer(s);
    if (step(s, DT).hurt) hurt++;
  }
  return { s, hurt };
}

describe('hop rules', () => {
  it('deals the same climb from the same seed', () => {
    const a = createLevel(4, new Rng(42));
    const b = createLevel(4, new Rng(42));
    expect(a.plats).toEqual(b.plats);
    expect(a.critters).toEqual(b.critters);
    expect(a.coins).toEqual(b.coins);
    expect(createLevel(4, new Rng(43)).plats).not.toEqual(a.plats);
  });

  it('gets harder: higher goals, narrower platforms, new platform kinds and critters', () => {
    const kinds = (d: Difficulty) => new Set(createLevel(d, new Rng(5)).plats.map((p) => p.kind));
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(goalFor(d)).toBeGreaterThan(goalFor(lo));
      expect(widthFor(d)).toBeLessThan(widthFor(lo));
      expect(crittersFor(d)).toBeGreaterThanOrEqual(crittersFor(lo));
    }
    expect([...kinds(1)].sort()).toEqual(['ground', 'normal']);
    expect(kinds(2).has('moving')).toBe(true);
    expect(kinds(3).has('crumble')).toBe(true);
    for (const d of LEVELS) expect(createLevel(d, new Rng(5), 'classic').plats.filter((p) => p.spring != null).length).toBe(springsFor(d));
    expect(springsFor(3)).toBeGreaterThan(0);
    expect(createLevel(5, new Rng(5)).critters.length).toBeGreaterThan(0);
  });

  it('keeps every gap of the path inside one bounce', () => {
    for (const d of LEVELS)
      for (const seed of [1, 2, 3]) {
        const path = createLevel(d, new Rng(seed)).plats.filter((p) => p.path);
        for (let i = 1; i < path.length; i++) expect(path[i].alt - path[i - 1].alt).toBeLessThan(JUMP_H * 0.7);
        expect(path.at(-1)!.alt + JUMP_H * 0.9).toBeGreaterThan(goalFor(d));
      }
  });

  it('bounces in place on the wide ground when left alone', () => {
    for (const d of LEVELS) {
      const { s, hurt } = play(d, 9, () => 0, 10);
      expect(hurt).toBe(0);
      expect(s.over || s.won).toBe(false);
      expect(s.cam).toBe(CAM_START);
    }
  });

  it('wraps around the sides', () => {
    const s = createLevel(1, new Rng(1));
    s.x = W - 1;
    s.vx = 200;
    step(s, DT);
    expect(s.x).toBeLessThan(10);
    expect(wdelta(W - 2, 2)).toBe(4);
  });

  it('launches higher off a spring and crumbles a fragile platform after one bounce', () => {
    const s = createLevel(3, new Rng(5));
    const spring = s.plats.find((p) => p.spring != null)!;
    s.x = spring.x + spring.spring!;
    s.alt = spring.alt + 1;
    s.vy = -100;
    const ev = step(s, DT);
    expect(ev.spring).toBe(true);
    expect(s.vy).toBe(SPRING);

    const crumble = s.plats.find((p) => p.kind === 'crumble')!;
    s.x = crumble.x;
    s.alt = crumble.alt + 1;
    s.vy = -100;
    expect(step(s, DT).crumbled).toBe(crumble);
    expect(crumble.gone).toBe(true);
  });

  it('stomps a critter from above but loses a heart bumping into it', () => {
    const s = createLevel(5, new Rng(5));
    const c = s.critters[0];
    s.x = c.x;
    s.alt = c.alt + 4;
    s.vy = -200;
    expect(step(s, DT).stomped).toBe(c);
    expect(s.stomps).toBe(1);

    const k = s.critters[1];
    s.x = k.x;
    s.alt = k.alt - 18;
    s.vy = 300;
    expect(step(s, DT).hurt).toBe('bump');
    expect(s.lives).toBe(LIVES - 1);
    expect(s.invulnerable).toBeGreaterThan(0);
  });

  it('can be climbed to the finish by a pilot that steers to the next platform, earning stars', () => {
    for (const d of LEVELS) {
      const scores: number[] = [];
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const { s } = play(d, seed * 7 + d, pilot);
        expect(s.won, `level ${d} seed ${seed}`).toBe(true);
        scores.push(s.score);
      }
      const [two, three] = hop.stars(d);
      // A tidy climb earns two stars; the fastest, richest ones reach three.
      expect(Math.min(...scores), `level ${d}`).toBeGreaterThanOrEqual(two);
      expect(Math.max(...scores), `level ${d}`).toBeGreaterThanOrEqual(three);
    }
  });

  it('deals the same kind from the same seed, and different kinds across seeds', () => {
    expect(createLevel(3, new Rng(12)).kind).toBe(createLevel(3, new Rng(12)).kind);
    const seen = new Set<string>();
    for (let seed = 0; seed < 50; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    const easy = kindsAt(1, KINDS).map((k) => k.id);
    for (let seed = 0; seed < 20; seed++) expect(easy).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('twists each kind: springs, crumbling ledges, clouds, wind, bats', () => {
    const count = (kind: KindId, f: (s: State) => number) => f(createLevel(4, new Rng(2), kind));
    const springs = (s: State) => s.plats.filter((p) => p.spring != null).length;
    expect(count('springs', springs)).toBeGreaterThan(count('classic', springs));
    const crumbles = (s: State) => s.plats.filter((p) => p.path && p.kind === 'crumble').length;
    expect(count('crumbly', crumbles)).toBeGreaterThan(count('classic', crumbles));
    expect(count('clouds', (s) => s.plats.filter((p) => p.kind === 'cloud').length)).toBeGreaterThan(0);
    expect(count('windy', (s) => Math.abs(s.wind))).toBeGreaterThan(0);
    expect(count('swarm', (s) => s.critters.filter((c) => c.v).length)).toBeGreaterThan(0);
    // No more gems in a spring park than usual, so its score stays in line.
    const gems = (s: State) => s.coins.filter((c) => c.gem).length;
    expect(count('springs', gems)).toBeLessThanOrEqual(springsFor(4) + 1);
  });

  it('clouds come and go; crumbled platforms grow back', () => {
    const s = createLevel(3, new Rng(4), 'clouds');
    const cloud = s.plats.find((p) => p.kind === 'cloud')!;
    const states = new Set(Array.from({ length: 40 }, (_, k) => solid(cloud, k * 0.1)));
    expect(states).toEqual(new Set([true, false]));
    // A cloud never follows another cloud or a crumbling platform on the path.
    const path = s.plats.filter((p) => p.path);
    const before = path.slice(1).flatMap((p, i) => (p.kind === 'cloud' ? [path[i].kind] : []));
    expect(before.length).toBeGreaterThan(0);
    expect(before.filter((k) => k === 'cloud' || k === 'crumble')).toEqual([]);
    const c = createLevel(3, new Rng(4), 'crumbly');
    const p = c.plats.find((q) => q.kind === 'crumble')!;
    c.x = p.x;
    c.alt = p.alt + 1;
    c.vy = -100;
    step(c, DT);
    expect(p.gone).toBe(true);
    for (let t = 0; t < REGROW_S + 0.1; t += DT) step(c, DT);
    expect(p.gone).toBe(false);
  });

  it('every kind can be climbed by the pilot at every level it is dealt', () => {
    for (const d of [2, 3, 5] as const) {
      const [two] = hop.stars(d);
      for (const { id } of kindsAt(d, KINDS)) {
        const runs = [1, 2, 3, 4].map((seed) => play(d, seed * 11 + d, pilot, 240, id));
        expect(runs.filter((r) => r.s.won).length, `${id} level ${d}`).toBeGreaterThanOrEqual(id === 'swarm' ? 3 : 4);
        expect(Math.max(...runs.map((r) => r.s.score)), `${id} level ${d}`).toBeGreaterThanOrEqual(two);
      }
    }
  });

  it('a chain of climbs grants super jumps, then a shield, then a rocket', () => {
    const s = createLevel(3, new Rng(6), 'classic');
    const rewards: string[] = [];
    const boosts: string[] = [];
    for (let t = 0; t < 120 && rewards.length < 3 && !s.won && !s.over; t += DT) {
      s.dir = pilot(s);
      const ev = step(s, DT);
      if (ev.reward) rewards.push(ev.reward);
      if (ev.boost) boosts.push(ev.boost);
    }
    expect(rewards).toEqual(['super', 'shield', 'rocket']);
    expect(boosts).toContain('super');
    expect(boosts.at(-1)).toBe('rocket');
    expect(s.shield || s.lives === LIVES).toBe(true);
  });

  it('a shield takes a fall without costing a heart', () => {
    const s = createLevel(2, new Rng(3), 'classic');
    grant(s, 'shield');
    s.cam = 400;
    s.alt = 100;
    s.vy = -50;
    const ev = step(s, DT);
    expect(ev.shielded).toBe(true);
    expect(ev.hurt).toBe(null);
    expect(s.lives).toBe(LIVES);
    expect(s.shield).toBe(false);
  });

  it('ends the run when a hopper climbs a little, then keeps running off to one side', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(3));
      let hurt = 0;
      for (let t = 0; t < 300 && !s.over && !s.won; t += DT) {
        s.dir = s.best < 600 ? pilot(s) : 1;
        if (step(s, DT).hurt) hurt++;
      }
      expect(s.over, `level ${d}`).toBe(true);
      expect(s.won).toBe(false);
      expect(hurt).toBe(LIVES);
    }
  });

  it('mounts, reports lives and plays a few seconds without ending', () => {
    for (const d of LEVELS) {
      const m = mountGame(hop, d, 3);
      expect(m.lives).toEqual([LIVES, LIVES]);
      expect(m.variant?.id).toBe(createLevel(d, new Rng(3)).kind);
      m.run(3);
      expect(m.outcome).toBe('');
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
