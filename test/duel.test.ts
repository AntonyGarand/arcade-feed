import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { duel } from '../src/games/duel';
import { kindsAt } from '../src/core/variety';
import {
  aiFor,
  BALL_R,
  createLevel,
  goalFor,
  grant,
  KINDS,
  POINT,
  predict,
  SMASH_N,
  step,
  STREAK_TIERS,
  H,
  W,
  YOU_Y,
  type KindId,
  type State,
} from '../src/games/duel/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * A tracking player: once the ball heads down it waits `react` seconds, then aims for where the ball
 * will land, off by up to `noise` units (more on fast balls) and angling away from the rival.
 */
function steer(s: State, me: Rng, mind: { wait: number; planned: boolean }, react: number, noise: number) {
  if (s.serve > 0 || s.vy < 0) {
    mind.planned = false;
    mind.wait = react;
    s.target = W / 2;
  } else if (!mind.planned) {
    mind.wait -= DT;
    if (mind.wait <= 0) {
      mind.planned = true;
      const side = s.ax < W / 2 ? 1 : -1;
      s.target = predict(s, YOU_Y - BALL_R) + (me.next() * 2 - 1) * noise * (s.speed / s.base) - side * s.pw * 0.3 * me.next();
    }
  }
}

function autopilot(d: Difficulty, seed: number, react: number, noise: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const me = new Rng(seed * 7 + 1);
  const mind = { wait: react, planned: false };
  for (let t = 0; t < 600 && !s.done; t += DT) {
    steer(s, me, mind, react, noise);
    step(s, DT);
  }
  return { s, won: s.you >= s.goal };
}

const SEEDS = Array.from({ length: 16 }, (_, k) => k + 1);

describe('duel rules', () => {
  it('plays out the same match from the same seed', () => {
    const a = autopilot(4, 12, 0.12, 30).s;
    const b = autopilot(4, 12, 0.12, 30).s;
    expect([a.you, a.them, a.score, a.time]).toEqual([b.you, b.them, b.score, b.time]);
    expect(createLevel(5, new Rng(3)).kind).toBe(createLevel(5, new Rng(3)).kind);
    expect(createLevel(5, new Rng(3), 'classic').blocks).toEqual(createLevel(5, new Rng(3), 'classic').blocks);
    expect(createLevel(5, new Rng(3), 'classic').blocks).not.toEqual(createLevel(5, new Rng(4), 'classic').blocks);
    expect(createLevel(4, new Rng(5), 'bumpers').bumpers).toEqual(createLevel(4, new Rng(5), 'bumpers').bumpers);
  });

  it('gets harder: longer matches, a quicker and sharper rival, a faster ball, then blocks', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(goalFor(d)).toBeGreaterThanOrEqual(goalFor(lo));
      expect(aiFor(d).react).toBeLessThan(aiFor(lo).react);
      expect(aiFor(d).speed).toBeGreaterThan(aiFor(lo).speed);
      expect(aiFor(d).error).toBeLessThan(aiFor(lo).error);
      expect(createLevel(d, new Rng(1)).base).toBeGreaterThan(createLevel(lo, new Rng(1)).base);
      expect(createLevel(d, new Rng(1)).pw).toBeLessThan(createLevel(lo, new Rng(1)).pw);
    }
    expect(createLevel(3, new Rng(1), 'classic').blocks).toHaveLength(0);
    expect(createLevel(4, new Rng(1), 'classic').blocks).toHaveLength(1);
    expect(createLevel(5, new Rng(1), 'classic').blocks).toHaveLength(2);
  });

  it('serves after a pause, angles off the paddle edge and speeds up per hit', () => {
    const s = createLevel(1, new Rng(2), 'classic');
    step(s, DT);
    expect(s.vy).toBe(0);
    for (let t = 0; t < 1.2; t += DT) step(s, DT);
    expect(s.vy).toBeGreaterThan(0); // the first serve comes to you
    const hit = (offset: number) => {
      const o = createLevel(1, new Rng(2), 'classic');
      Object.assign(o, { serve: 0, bx: W / 2 + offset, by: YOU_Y - BALL_R - 1, vx: 0, vy: 200, px: W / 2, speed: o.base });
      expect(step(o, DT).hit).toBe('you');
      return o;
    };
    const centre = hit(0);
    const edge = hit(centre.pw * 0.45);
    expect(centre.vy).toBeLessThan(0);
    expect(Math.abs(centre.vx)).toBeLessThan(1);
    expect(edge.vx).toBeGreaterThan(Math.abs(edge.vy) * 0.8);
    expect(edge.speed).toBeGreaterThan(edge.base);
    expect(edge.rally).toBe(1);
  });

  it('is won by a tracking player on most seeds at every level; three stars only for strong runs', () => {
    for (const d of LEVELS) {
      const strong = SEEDS.map((seed) => autopilot(d, seed, 0.12, 30));
      const casual = SEEDS.map((seed) => autopilot(d, seed, 0.2, 45));
      const wins = strong.filter((r) => r.won);
      expect(wins.length, `level ${d}`).toBeGreaterThanOrEqual(13);
      for (const r of wins) expect(r.s.score).toBeGreaterThanOrEqual(r.s.goal * POINT);
      const three = wins.filter((r) => starsFor(duel, d, true, r.s.score) === 3).length;
      const twoUp = wins.filter((r) => starsFor(duel, d, true, r.s.score) >= 2).length;
      expect(three, `level ${d}`).toBeGreaterThanOrEqual(2);
      expect(three, `level ${d}`).toBeLessThanOrEqual(wins.length * 0.6);
      expect(twoUp, `level ${d}`).toBeGreaterThanOrEqual(wins.length * 0.5);
      const casualThree = casual.filter((r) => r.won && starsFor(duel, d, true, r.s.score) === 3).length;
      expect(casualThree, `level ${d}`).toBeLessThan(three);
      expect(casual.some((r) => r.won)).toBe(true);
    }
  });

  it('deals different kinds across seeds, gated by level', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    for (let seed = 0; seed < 40; seed++) expect(['classic', 'wall', 'bullseye']).toContain(createLevel(1, new Rng(seed)).kind);
    expect(createLevel(3, new Rng(1), 'bumpers').bumpers.length).toBeGreaterThanOrEqual(2);
    expect(createLevel(3, new Rng(1), 'bullseye').targets).toHaveLength(2);
    expect(createLevel(3, new Rng(1), 'wall').aw).toBeGreaterThan(createLevel(3, new Rng(1), 'classic').aw);
  });

  it('every kind allowed at a level is won by a strong tracking player on most seeds', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const wins = SEEDS.slice(0, 8).filter((seed) => autopilot(d, seed, 0.12, 30, id).won).length;
        expect(wins, `${id} level ${d}`).toBeGreaterThanOrEqual(6);
      }
  });

  it('a run of returns unlocks a wide paddle, then smash shots that fool the rival', () => {
    const s = createLevel(2, new Rng(4), 'classic');
    const me = new Rng(5);
    const mind = { wait: 0.1, planned: false };
    const got: [string, number, number][] = [];
    for (let t = 0; t < 300 && got.length < 2 && !s.done; t += DT) {
      steer(s, me, mind, 0.1, 10);
      const ev = step(s, DT);
      if (ev.unlocked) got.push([ev.unlocked, ev.tier, s.streak]);
    }
    expect(got).toEqual([
      ['wide', 1, STREAK_TIERS[0]],
      ['smash', 2, STREAK_TIERS[1]],
    ]);
    expect(s.smash).toBeGreaterThan(0);
  });

  it('powers: wide paddle grows, smash speeds the return, double scores twice, conceding ends the combo', () => {
    const s = createLevel(3, new Rng(2), 'classic');
    grant(s, 'wide');
    grant(s, 'shrink');
    for (let t = 0; t < 0.5; t += DT) step(s, DT);
    expect(s.pw).toBeGreaterThan(s.pw0 * 1.3);
    expect(s.aw).toBeLessThan(s.aw0 * 0.75);
    grant(s, 'smash');
    expect(s.smash).toBe(SMASH_N);
    Object.assign(s, { serve: 0, bx: s.px, by: YOU_Y - BALL_R - 1, vx: 0, vy: 200, speed: s.base, streak: 5, tier: 1 });
    expect(step(s, DT).hit).toBe('you');
    expect(s.hot).toBe(true);
    expect(s.speed).toBeGreaterThan(s.base * 1.9);
    expect(s.smash).toBe(SMASH_N - 1);
    grant(s, 'double');
    Object.assign(s, { bx: W / 2, by: -BALL_R + 1, vx: 0, vy: -200, ax: 20, rally: 1 });
    const before = s.score;
    expect(step(s, DT).point).toBe('you');
    expect(s.score - before).toBe(2 * (POINT + 10));
    expect(s.double).toBe(false);
    Object.assign(s, { serve: 0, bx: 10, by: H + BALL_R - 1, vx: 0, vy: 200, px: W - 40 });
    expect(step(s, DT).point).toBe('ai');
    expect([s.streak, s.tier]).toEqual([0, 0]);
  });

  it('a bonus star only counts for a ball you sent', () => {
    const s = createLevel(2, new Rng(8), 'bullseye');
    const t0 = s.targets[0];
    Object.assign(s, { serve: 0, bx: t0.x, by: t0.y + 20, vx: 0, vy: -150, last: 'ai' });
    for (let i = 0; i < 12; i++) expect(step(s, DT).star).toBeNull();
    Object.assign(s, { bx: s.targets[0].x, by: s.targets[0].y + 20, vx: 0, vy: -150, last: 'you', streak: 0 });
    let star = false;
    for (let i = 0; i < 12; i++) star ||= !!step(s, DT).star;
    expect(star).toBe(true);
    expect(s.streak).toBe(1);
  });

  it('bumpers bounce the ball and the rival still reads it', () => {
    const s = createLevel(3, new Rng(3), 'bumpers');
    const b = s.bumpers[0];
    Object.assign(s, { serve: 0, bx: b.x, by: b.y + 30, vx: 0, vy: -200 });
    let bumped = false;
    for (let i = 0; i < 20; i++) bumped ||= !!step(s, DT).bump;
    expect(bumped).toBe(true);
    expect(s.vy).toBeGreaterThan(0);
  });

  it('is lost when the paddle stays away from the ball', () => {
    const s = createLevel(5, new Rng(6), 'classic');
    for (let t = 0; t < 120 && !s.done; t += DT) {
      s.target = s.bx < W / 2 ? W : 0;
      step(s, DT);
    }
    expect(s.done).toBe(true);
    expect(s.them).toBe(goalFor(5));
    expect(s.you).toBe(0);
  });
});

describe('duel card', () => {
  const key = (type: string, k: string) => new KeyboardEvent(type, { key: k });

  for (const d of [1, 5] as const)
    it(`starts level ${d} with a serve, moves on the keys and reports points`, () => {
      const m = mountGame(duel, d, 9);
      expect(m.variant?.name.length).toBeGreaterThan(0);
      expect(m.variant!.name.length).toBeLessThanOrEqual(18);
      expect(m.variant!.blurb!.length).toBeLessThanOrEqual(60);
      expect(m.status).toMatch(/You 0 – 0 Rival · first to \d/);
      expect(m.inst.onKey!(key('keydown', 'ArrowLeft'))).toBe(true);
      m.run(3);
      expect(m.outcome).toBe('');
      expect(m.inst.onKey!(key('keyup', 'ArrowLeft'))).toBe(true);
      expect(m.inst.onKey!(key('keydown', 'x'))).toBe(false);
      // Parked in the left corner, the paddle lets balls by: the rival wins in the end.
      m.inst.onKey!(key('keydown', 'a'));
      m.run(120);
      expect(m.outcome).toBe('lose');
      expect(m.status).toContain(`${goalFor(d)} Rival`);
      m.inst.destroy?.();
      m.root.remove();
    });
});
