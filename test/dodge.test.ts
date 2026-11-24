import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { dodge } from '../src/games/dodge';
import {
  CHAIN_TIERS,
  createLevel,
  durationFor,
  grant,
  H,
  isRound,
  KINDS,
  LIFE_BONUS,
  livesFor,
  rateFor,
  starsOut,
  step,
  W,
  type KindId,
  type State,
} from '../src/games/dodge/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Danger of standing at (x, y) over the next half second: how close the hazards pass, nearest soonest. */
function danger(s: State, x: number, y: number): number {
  let sum = 0;
  for (const z of [...s.live, ...s.schedule.slice(s.next, s.next + 8)])
    for (let k = 0; k <= 8; k++) {
      const t = k * 0.07;
      const dt = t - Math.max(0, z.t - s.clock);
      if (dt < 0) continue;
      const zx = z.x + z.vx * dt;
      const zy = z.y + z.vy * dt;
      const gap = isRound(z.kind)
        ? Math.hypot(zx + z.w / 2 - x, zy + z.h / 2 - y) - z.w / 2
        : Math.hypot(x - Math.max(zx, Math.min(x, zx + z.w)), y - Math.max(zy, Math.min(y, zy + z.h)));
      const near = Math.max(0, 34 - gap);
      sum += (near * near) / (1 + k);
    }
  return sum / 100;
}

/** Steer to the safest nearby spot, drawn to pickups and the lower middle. */
function autopilot(d: Difficulty, seed: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  for (let t = 0, f = 0; t < 120; t += DT, f++) {
    // Think every third frame (a human doesn't react faster either).
    if (f % 3) {
      const ev = step(s, DT);
      if (ev.won) return { s, win: true };
      if (ev.over) return { s, win: false };
      continue;
    }
    // Head for the gap of the next bar coming down.
    const bars = [...s.live, ...s.schedule.slice(s.next, s.next + 4)].filter((z) => z.kind === 'bar' && z.y < s.py);
    const left = bars.filter((z) => z.x === 0).sort((a, b) => b.y - a.y)[0];
    const right = left && bars.find((z) => z.t === left.t && z.x > 0);
    const gapX = left && right ? (left.w + right.x) / 2 : null;
    // And for the gap of the next sweep sliding in.
    const sweeps = [...s.live, ...s.schedule.slice(s.next, s.next + 4)].filter((z) => z.kind === 'sweep');
    const top = sweeps.filter((z) => z.y === 0).sort((a, b) => Math.abs(a.x - s.px) - Math.abs(b.x - s.px))[0];
    const low = top && sweeps.find((z) => z.t === top.t && z.y > 0);
    const gapY = top && low ? (top.h + low.y) / 2 : null;
    let best = { x: s.px, y: s.py, v: Infinity };
    for (let a = 0; a < 16; a++)
      for (const r of [0, 6, 12]) {
        const x = Math.max(10, Math.min(W - 10, s.px + Math.cos((a * Math.PI) / 8) * r));
        const y = Math.max(10, Math.min(H - 10, s.py + Math.sin((a * Math.PI) / 8) * r));
        const star = starsOut(s)[0];
        const pull = star ? Math.hypot(star.x - x, star.y - y) / 400 : 0;
        const v =
          danger(s, x, y) * 40 +
          (gapX == null ? 0 : Math.abs(x - gapX) / 30) +
          (gapY == null ? Math.abs(x - W / 2) / 600 + Math.abs(y - H * 0.75) / 600 : Math.abs(y - gapY) / 15) +
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
    const kinds = (d: Difficulty) => new Set(createLevel(d, new Rng(1), 'classic').schedule.map((z) => z.kind));
    expect([...kinds(1)]).toEqual(['block']);
    expect(kinds(2).has('disc')).toBe(true);
    expect(kinds(3).has('bar')).toBe(true);
  });

  it('is survived by an evasive autopilot at every level, with the life bonus', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed, 'classic'));
      expect(runs.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(d < 3 ? 5 : 3);
      for (const r of runs.filter((x) => x.win))
        expect(r.s.score).toBeGreaterThanOrEqual(durationFor(d) * 10 + r.s.lives * LIFE_BONUS - 10);
    }
  }, 20_000);

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

  it('deals the same kind from the same seed, and different kinds across seeds', () => {
    for (let seed = 0; seed < 10; seed++) expect(createLevel(4, new Rng(seed)).kind).toBe(createLevel(4, new Rng(seed)).kind);
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(kindsAt(1, KINDS).map((k) => k.id)).toEqual(['classic', 'rain']);
  });

  it('each kind deals its own hazards', () => {
    const shapes = (k: KindId) => new Set(createLevel(4, new Rng(2), k).schedule.map((z) => z.kind));
    expect(shapes('sweep').has('sweep')).toBe(true);
    expect(shapes('seekers').has('seeker')).toBe(true);
    expect(shapes('bouncers').has('bouncer')).toBe(true);
    expect(shapes('shrapnel').has('bomb')).toBe(true);
    expect([...shapes('rain')].every((k) => k === 'block' || k === 'bar')).toBe(true);
  });

  it('every kind allowed at a level is survived by the autopilot', () => {
    for (const d of [2, 3, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed, id));
        expect(runs.filter((r) => r.win).length, `${id} level ${d}`).toBeGreaterThanOrEqual(3);
      }
  }, 60_000);

  it('bombs burst into shards, seekers turn towards the player', () => {
    const s = createLevel(3, new Rng(5), 'shrapnel');
    let bursts = 0;
    s.target = { x: 10, y: 10 };
    for (let t = 0; t < 15 && !bursts; t += DT) bursts += step(s, DT).bursts.length;
    expect(bursts).toBeGreaterThan(0);
    expect(s.live.some((z) => z.kind === 'shard')).toBe(true);

    const k = createLevel(3, new Rng(5), 'seekers');
    k.target = { x: 20, y: H - 20 };
    for (let t = 0; t < 12 && !k.live.some((z) => z.kind === 'seeker' && z.y > 40); t += DT) step(k, DT);
    const z = k.live.find((q) => q.kind === 'seeker')!;
    expect(z.vx).toBeLessThan(0); // steering left, towards the player
  });

  it('a chain of near misses unlocks a shield, then slow-mo, then a magnet and a blast', () => {
    const s = createLevel(2, new Rng(3), 'classic');
    s.time = s.clock = 5;
    const unlocked: string[] = [];
    const stars = s.stars.length;
    let blastLeft = -1;
    // Hazards parked just out of reach, one at a time: each is a near miss.
    for (let i = 0; i < CHAIN_TIERS[3]; i++) {
      s.live.push({ kind: 'block', id: 1000 + i, t: s.clock, x: s.px + 14, y: s.py - 5, vx: 0, vy: 0, w: 10, h: 10, life: 0 });
      const ev = step(s, DT);
      if (ev.unlocked) unlocked.push(ev.unlocked);
      if (ev.unlocked === 'blast') blastLeft = s.live.length;
      s.live = [];
    }
    expect(unlocked).toEqual(['shield', 'slow', 'magnet', 'blast']);
    expect(s.shield).toBe(true);
    expect(s.grazes).toBe(CHAIN_TIERS[3]);
    expect(blastLeft).toBe(0);
    expect(s.slow).toBeGreaterThan(0);
    expect(s.magnet).toBeGreaterThan(0);
    expect(s.stars.length).toBe(stars + 4); // the magnet's star shower
  });

  it('the shield soaks up a hit, slow-mo slows hazards, a blast clears them for points', () => {
    const s = createLevel(3, new Rng(7), 'classic');
    grant(s, 'shield');
    s.live.push({ kind: 'block', id: 999, t: 0, x: s.px - 5, y: s.py - 5, vx: 0, vy: 100, w: 10, h: 10, life: 0 });
    const ev = step(s, DT);
    expect(ev.shielded).toBe(true);
    expect(ev.hurt).toBe(false);
    expect(s.lives).toBe(livesFor(3));
    expect(s.shield).toBe(false);

    grant(s, 'slow');
    const clock = s.clock;
    step(s, 1);
    expect(s.clock - clock).toBeLessThan(0.5);

    s.live.push({ kind: 'block', id: 998, t: 0, x: 10, y: 10, vx: 0, vy: 0, w: 10, h: 10, life: 0 });
    const score = s.score;
    grant(s, 'blast');
    expect(s.live.length).toBe(0);
    expect(s.score).toBeGreaterThan(score);
  });

  it('a hit breaks the chain', () => {
    const s = createLevel(3, new Rng(7), 'classic');
    s.chain = 4;
    s.tier = 1;
    s.live.push({ kind: 'block', id: 999, t: 0, x: s.px - 5, y: s.py - 5, vx: 0, vy: 0, w: 10, h: 10, life: 0 });
    expect(step(s, DT).hurt).toBe(true);
    expect(s.chain).toBe(0);
  });

  it('names the kind it dealt on the start gate', () => {
    const m = mountGame(dodge, 3, 5);
    expect(m.variant?.id).toBe(createLevel(3, new Rng(5)).kind);
    expect(m.variant!.name.length).toBeLessThanOrEqual(18);
    expect((m.variant!.blurb ?? '').length).toBeLessThanOrEqual(60);
    m.inst.destroy?.();
  });
});
