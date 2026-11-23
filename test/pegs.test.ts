import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import {
  aimAt,
  aimPath,
  BALL_BONUS,
  ballsFor,
  BUCKET_Y,
  createLevel,
  LAUNCH,
  MAX_AIM,
  shoot,
  step,
  targetsFor,
  targetsLeft,
  type State,
  type StepEvents,
} from '../src/games/pegs/rules';

const DT = 1 / 60;

/** Fly the current shot to its end. */
function fly(s: State): StepEvents {
  for (let t = 0; t < 60; t += DT) {
    const ev = step(s, DT);
    if (ev.ended) return ev;
  }
  throw new Error('shot never ended');
}

/** Try a fan of angles on copies of the state and take the one that clears the most targets. */
function bestAim(s: State): number {
  let best = 0;
  let most = -1;
  for (let k = -20; k <= 20; k++) {
    const a = (k / 20) * MAX_AIM;
    const c = structuredClone(s);
    c.aim = a;
    shoot(c);
    const ev = fly(c);
    const v = (targetsLeft(s) - targetsLeft(c)) * 10 + (ev.caught ? 5 : 0) + c.score / 1000;
    if (v > most) [most, best] = [v, a];
  }
  return best;
}

function autopilot(d: Difficulty, seed: number) {
  const s = createLevel(d, new Rng(seed));
  for (;;) {
    s.aim = bestAim(s);
    shoot(s);
    const ev = fly(s);
    if (ev.cleared) return { s, win: true };
    if (ev.over) return { s, win: false };
  }
}

describe('pegs rules', () => {
  it('deals the same field from the same seed', () => {
    expect(createLevel(2, new Rng(5)).pegs).toEqual(createLevel(2, new Rng(5)).pegs);
    expect(createLevel(2, new Rng(5)).pegs).not.toEqual(createLevel(2, new Rng(6)).pegs);
  });

  it('gets harder: more targets, fewer balls, a smaller and faster bucket', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(1));
      const hi = createLevel(d, new Rng(1));
      expect(hi.pegs.filter((p) => p.target).length).toBeGreaterThan(lo.pegs.filter((p) => p.target).length);
      expect(hi.balls).toBeLessThanOrEqual(lo.balls);
      expect(hi.bucketW).toBeLessThan(lo.bucketW);
      expect(Math.abs(hi.bucketV)).toBeGreaterThan(Math.abs(lo.bucketV));
    }
    expect(createLevel(1, new Rng(1)).pegs.filter((p) => p.target).length).toBe(targetsFor(1));
  });

  it('aims within the cone and draws a short guide from the launcher', () => {
    const s = createLevel(1, new Rng(2));
    aimAt(s, LAUNCH.x - 500, LAUNCH.y); // far to the side, level with the launcher
    expect(s.aim).toBe(-MAX_AIM);
    aimAt(s, LAUNCH.x, LAUNCH.y + 100);
    expect(s.aim).toBe(0);
    const path = aimPath(s);
    expect(path.length).toBeGreaterThan(2);
    expect(path.at(-1)!.y).toBeGreaterThan(LAUNCH.y);
  });

  it('removes hit pegs only once the ball leaves play', () => {
    const s = createLevel(1, new Rng(3));
    s.aim = bestAim(s);
    shoot(s);
    let lit = 0;
    for (let t = 0; t < 30 && s.flying; t += DT) {
      step(s, DT);
      if (s.flying) lit = Math.max(lit, s.pegs.filter((p) => p.lit && !p.gone).length);
    }
    expect(lit).toBeGreaterThan(0);
    expect(s.pegs.filter((p) => p.lit && !p.gone).length).toBe(0);
  });

  it('gives the ball back when it lands in the bucket', () => {
    const s = createLevel(1, new Rng(4));
    s.pegs = [];
    s.bucketV = 0;
    s.bucketX = LAUNCH.x;
    s.aim = 0; // straight down into the parked bucket
    shoot(s);
    const ev = fly(s);
    expect(ev.caught).toBe(true);
    expect(s.balls).toBe(ballsFor(1));
    expect(s.by).toBeLessThan(BUCKET_Y + 10);
  });

  it('is cleared by an autopilot at every level, with the ball bonus', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4].map((k) => autopilot(d, k * 13 + d));
      expect(runs.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(d === 1 ? 4 : 3);
      for (const r of runs.filter((x) => x.win)) expect(r.s.score).toBeGreaterThanOrEqual(r.s.balls * BALL_BONUS);
    }
  });

  it('is lost when every ball misses', () => {
    const s = createLevel(5, new Rng(6));
    let ev: StepEvents | null = null;
    while (!ev?.over) {
      s.aim = MAX_AIM; // hug the wall and drop out
      s.bucketX = 20;
      s.bucketV = 0;
      shoot(s);
      ev = fly(s);
      expect(ev.cleared).toBe(false);
    }
    expect(s.balls).toBe(0);
    expect(targetsLeft(s)).toBeGreaterThan(0);
  });
});
