import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import {
  brickCount,
  createLevel,
  grant,
  KINDS,
  launch,
  left,
  LIFE_BONUS,
  LIVES,
  PADDLE_Y,
  step,
  W,
  type KindId,
} from '../src/games/bricks/rules';

const DT = 1 / 60;

/** Play with a paddle that tracks the ball (offset a little, so bounces vary). Returns the end state. */
function autopilot(d: (typeof LEVELS)[number], seed: number, seconds = 900, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  let end: 'cleared' | 'over' | '' = '';
  for (let t = 0; t < seconds && !end; t += DT) {
    // Follow the lowest ball on its way down.
    const ball = s.balls.reduce((a, b) => (b.vy > 0 && (a.vy <= 0 || b.y > a.y) ? b : a));
    s.target = ball.x + Math.sin(t * 3) * s.pw * 0.3;
    const ev = step(s, DT);
    if (ev.cleared) end = 'cleared';
    else if (ev.over) end = 'over';
  }
  return { s, end };
}

describe('bricks rules', () => {
  it('deals the same wall from the same seed', () => {
    const a = createLevel(3, new Rng(42));
    const b = createLevel(3, new Rng(42));
    expect(a.kind).toBe(b.kind);
    expect(a.bricks).toEqual(b.bricks);
    expect(left(a)).toBe(brickCount(3));
  });

  it('gets harder: more rows, a narrower paddle and a faster ball', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as typeof d, new Rng(1));
      const hi = createLevel(d, new Rng(1));
      expect(brickCount(d)).toBeGreaterThanOrEqual(brickCount((d - 1) as typeof d));
      expect(hi.pw).toBeLessThan(lo.pw);
      expect(hi.speed).toBeGreaterThan(lo.speed);
    }
  });

  it('rests the ball on the paddle, then launches it upwards', () => {
    const s = createLevel(1, new Rng(3));
    step(s, DT);
    expect(s.held).toBe(true);
    launch(s);
    expect(s.held).toBe(false);
    expect(s.balls[0].vy).toBeLessThan(0);
  });

  it('can be cleared by a paddle that follows the ball, with the life bonus', () => {
    for (const d of LEVELS) {
      const { s, end } = autopilot(d, 11 + d);
      expect(end, `level ${d}`).toBe('cleared');
      expect(left(s)).toBe(0);
      expect(s.score).toBeGreaterThanOrEqual(brickCount(d) * 10 + s.lives * LIFE_BONUS);
    }
  });

  it('ends the run when the last life drops', () => {
    const s = createLevel(1, new Rng(5));
    s.target = 0; // paddle parked in the corner
    let over = false;
    let lost = 0;
    for (let t = 0; t < 120 && !over; t += DT) {
      s.target = s.held ? W / 2 : s.balls[0].x < W / 2 ? W : 0; // always away from the ball
      const ev = step(s, DT);
      if (ev.lostLife) lost++;
      over = ev.over;
    }
    expect(over).toBe(true);
    expect(lost).toBe(LIVES);
    expect(s.balls[0].y).toBeGreaterThan(PADDLE_Y);
  });

  it('deals every kind of wall with the same number of bricks to clear, and each can be cleared', () => {
    for (const d of [3, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const s0 = createLevel(d, new Rng(9), id);
        expect(left(s0), `${id} ${d}`).toBe(brickCount(d));
        const { end } = autopilot(d, 20 + d, 900, id);
        expect(end, `${id} level ${d}`).toBe('cleared');
      }
  });

  it('deals different kinds across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('a long streak unlocks a wide paddle, then multiball', () => {
    const s = createLevel(2, new Rng(4), 'wall');
    launch(s);
    const tiers: string[] = [];
    for (let t = 0; t < 300 && tiers.length < 2 && left(s); t += DT) {
      s.target = s.balls[0].x + Math.sin(t * 3) * s.pw * 0.3;
      const ev = step(s, DT);
      if (ev.unlocked) tiers.push(ev.unlocked);
    }
    expect(tiers.slice(0, 2)).toEqual(['wide', 'multi']);
  });

  it('only loses a life once every ball has fallen', () => {
    const s = createLevel(1, new Rng(6), 'wall');
    launch(s);
    grant(s, 'multi');
    expect(s.balls.length).toBe(3);
    s.target = 0;
    s.balls[0].y = PADDLE_Y + 40;
    s.balls[0].vy = 300;
    let lostBall = false;
    for (let i = 0; i < 10; i++) lostBall ||= step(s, DT).lostBall;
    expect(lostBall).toBe(true);
    expect(s.lives).toBe(LIVES);
    expect(s.balls.length).toBe(2);
  });
});
