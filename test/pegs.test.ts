import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { pegs } from '../src/games/pegs';
import {
  aimAt,
  aimPath,
  BALL_BONUS,
  ballsFor,
  BUCKET_Y,
  createLevel,
  KINDS,
  LAUNCH,
  MAX_AIM,
  shoot,
  SHOT_TIERS,
  step,
  targetsFor,
  targetsLeft,
  type KindId,
  type State,
  type StepEvents,
} from '../src/games/pegs/rules';
import { mountGame } from './support/mount';

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

function autopilot(d: Difficulty, seed: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
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
    expect(createLevel(4, new Rng(5)).kind).toBe(createLevel(4, new Rng(5)).kind);
    expect(createLevel(4, new Rng(5)).bumpers).toEqual(createLevel(4, new Rng(5)).bumpers);
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

  it('deals different kinds across seeds, each named on the start gate', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(4);
    const m = mountGame(pegs, 4, 3);
    expect(m.variant?.id).toBe(createLevel(4, new Rng(3)).kind);
    expect(m.variant!.name.length).toBeLessThanOrEqual(18);
    expect(m.variant!.blurb!.length).toBeLessThanOrEqual(60);
    m.inst.destroy?.();
  });

  it('deals every kind with the same targets and pegs, and the autopilot clears each', () => {
    for (const d of [3, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const s = createLevel(d, new Rng(7), id);
        expect(s.kind).toBe(id);
        expect(s.pegs.filter((p) => p.target).length, `${id} ${d}`).toBe(targetsFor(d));
        expect(s.pegs.length, `${id} ${d}`).toBe(createLevel(d, new Rng(7), 'scatter').pegs.length);
        expect(autopilot(d, 30 + d, id).win, `${id} level ${d}`).toBe(true);
      }
  });

  it('gives each kind its twist: bumpers, spinning wheels, bombs, armour', () => {
    expect(createLevel(3, new Rng(1), 'rings').bumpers.length).toBe(3);
    const w = createLevel(3, new Rng(1), 'wheels');
    const spinner = w.pegs.find((p) => p.orbit)!;
    const at = { x: spinner.x, y: spinner.y };
    step(w, 0.5);
    expect(Math.hypot(spinner.x - at.x, spinner.y - at.y)).toBeGreaterThan(5);
    const bombs = (k: KindId) => createLevel(3, new Rng(1), k).pegs.filter((p) => p.trait === 'bomb').length;
    expect(bombs('mines')).toBeGreaterThan(bombs('scatter'));
    const f = createLevel(3, new Rng(1), 'fortress');
    expect(f.pegs.filter((p) => p.hp > 1).length).toBe(Math.ceil(targetsFor(3) / 2));
    expect(f.pegs.filter((p) => p.target).every((p) => p.y >= 230)).toBe(true);
  });

  it('cracks armour on the first hit and lights it on the second', () => {
    const s = createLevel(1, new Rng(4));
    s.pegs = [{ x: LAUNCH.x + 6, y: 160, target: true, trait: 'plain', hp: 2, orbit: null, lit: false, gone: false }];
    s.bucketX = 20;
    s.bucketV = 0;
    s.aim = 0;
    shoot(s);
    fly(s);
    expect(s.pegs[0].gone).toBe(false);
    expect(s.pegs[0].hp).toBe(1);
    shoot(s);
    const ev = fly(s);
    expect(s.pegs[0].gone).toBe(true);
    expect(ev.cleared).toBe(true);
  });

  it('kicks the ball off a bumper', () => {
    const s = createLevel(1, new Rng(4));
    s.pegs = [];
    s.bumpers = [{ x: LAUNCH.x, y: 200 }];
    s.aim = 0;
    shoot(s);
    let bumped = false;
    for (let t = 0; t < 2 && !bumped; t += DT) bumped = step(s, DT).bumps.length > 0;
    expect(bumped).toBe(true);
    expect(s.vy).toBeLessThan(-200);
    expect(s.vx).not.toBe(0);
  });

  it('a big combo shot widens the bucket, then sets off a blast and gives a free ball', () => {
    const s = createLevel(3, new Rng(2), 'mines');
    for (const p of s.pegs) if (!p.target) p.trait = 'bomb';
    s.aim = bestAim(s);
    shoot(s);
    const unlocked: string[] = [];
    let wide = 0;
    let free = 0;
    for (let t = 0; t < 30 && s.flying; t += DT) {
      const ev = step(s, DT);
      for (const u of ev.unlocks) unlocked.push(u.power);
      free += ev.free;
      if (s.flying) wide = Math.max(wide, s.bucketW);
    }
    expect(s.hits).toBeGreaterThanOrEqual(SHOT_TIERS[2]);
    expect(unlocked.slice(0, 3)).toEqual(['bucket', 'blast', 'ball']);
    expect(wide).toBeGreaterThan(s.bucketW0);
    expect(s.bucketW).toBe(s.bucketW0);
    expect(free).toBeGreaterThanOrEqual(1);
  });

  it('gives a ball back for a gold peg', () => {
    const s = createLevel(1, new Rng(4));
    s.pegs = [
      { x: LAUNCH.x, y: 160, target: false, trait: 'gold', hp: 1, orbit: null, lit: false, gone: false },
      { x: 20, y: 300, target: true, trait: 'plain', hp: 1, orbit: null, lit: false, gone: false },
    ];
    s.balls = 5;
    s.bucketX = 280;
    s.bucketV = 0;
    s.aim = 0;
    shoot(s);
    const ev = fly(s);
    expect(ev.lost).toBe(true);
    expect(s.balls).toBe(5); // one lost, one given back
  });
});
