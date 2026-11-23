import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS } from '../src/core/types';
import { brickCount, createLevel, launch, LIFE_BONUS, LIVES, PADDLE_Y, step, W } from '../src/games/bricks/rules';

const DT = 1 / 60;

/** Play with a paddle that tracks the ball (offset a little, so bounces vary). Returns the end state. */
function autopilot(d: (typeof LEVELS)[number], seed: number, seconds = 600) {
  const s = createLevel(d, new Rng(seed));
  let end: 'cleared' | 'over' | '' = '';
  for (let t = 0; t < seconds && !end; t += DT) {
    s.target = s.bx + Math.sin(t * 3) * s.pw * 0.3;
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
    expect(a.bricks).toEqual(b.bricks);
    expect(a.bricks.length).toBe(brickCount(3));
  });

  it('gets harder: more rows, a narrower paddle and a faster ball', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as typeof d, new Rng(1));
      const hi = createLevel(d, new Rng(1));
      expect(hi.bricks.length).toBeGreaterThanOrEqual(lo.bricks.length);
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
    expect(s.vy).toBeLessThan(0);
  });

  it('can be cleared by a paddle that follows the ball, with the life bonus', () => {
    for (const d of LEVELS) {
      const { s, end } = autopilot(d, 11 + d);
      expect(end, `level ${d}`).toBe('cleared');
      expect(s.bricks.length).toBe(0);
      expect(s.score).toBeGreaterThanOrEqual(brickCount(d) * 10 + s.lives * LIFE_BONUS);
    }
  });

  it('ends the run when the last life drops', () => {
    const s = createLevel(1, new Rng(5));
    s.target = 0; // paddle parked in the corner
    let over = false;
    let lost = 0;
    for (let t = 0; t < 120 && !over; t += DT) {
      s.target = s.held ? W / 2 : s.bx < W / 2 ? W : 0; // always away from the ball
      const ev = step(s, DT);
      if (ev.lostLife) lost++;
      over = ev.over;
    }
    expect(over).toBe(true);
    expect(lost).toBe(LIVES);
    expect(s.by).toBeGreaterThan(PADDLE_Y);
  });
});
