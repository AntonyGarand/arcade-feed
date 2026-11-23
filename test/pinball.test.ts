import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { byLevel, LEVELS, type Difficulty } from '../src/core/types';
import { pinball } from '../src/games/pinball';
import {
  BALL_BONUS,
  BALL_R,
  BALLS,
  createLevel,
  flipperTip,
  goalFor,
  H,
  LANE_Y1,
  PLUNGER_Y,
  PTS,
  pull,
  release,
  saveFor,
  type State,
  step,
} from '../src/games/pinball/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * Flip like a player with quick hands: press when the ball is about to land on the middle of a flipper
 * (or rolls onto it), hold briefly, let go.
 */
function autopilot(s: State, hold: [number, number]) {
  for (let k = 0; k < 2; k++) {
    const f = s.flippers[k];
    if (hold[k] > 0) {
      hold[k] -= DT;
      s.press[k] = hold[k] > 0.12;
      continue;
    }
    s.press[k] = false;
    const t = ((s.bx - f.px) * f.side) / f.len;
    const tip = flipperTip(f);
    const yAt = f.py + (tip.y - f.py) * Math.max(0, Math.min(1, t));
    const gap = yAt - s.by - 11;
    const eta = gap / Math.max(1, s.vy);
    if (!s.held && t > 0.4 && t < 1.2 && gap > -8 && (eta < 0.05 || gap < 4)) {
      hold[k] = 0.27;
      s.press[k] = true;
    }
  }
}

function play(d: Difficulty, seed: number, flip: boolean, seconds = 600) {
  const s = createLevel(d, new Rng(seed));
  const hold: [number, number] = [0, 0];
  let end: 'won' | 'over' | '' = '';
  for (let t = 0; t < seconds && !end; t += DT) {
    if (flip) autopilot(s, hold);
    const ev = step(s, DT);
    if (ev.won) end = 'won';
    else if (ev.over) end = 'over';
  }
  return { s, end };
}

const table = (s: State) => ({ bumpers: s.bumpers, targets: s.targets, lanes: s.lanes, outlanes: s.outlanes });

describe('pinball rules', () => {
  it('deals the same table from the same seed', () => {
    for (const d of LEVELS) {
      expect(table(createLevel(d, new Rng(42)))).toEqual(table(createLevel(d, new Rng(42))));
    }
    expect(table(createLevel(3, new Rng(1)))).not.toEqual(table(createLevel(3, new Rng(2))));
  });

  it('gets harder: more bumpers and targets, open outlanes, shorter flippers, a steeper table', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(1));
      const hi = createLevel(d, new Rng(1));
      expect(hi.bumpers.length).toBeGreaterThanOrEqual(lo.bumpers.length);
      expect(hi.targets.length).toBeGreaterThanOrEqual(lo.targets.length);
      expect(hi.outlanes.filter(Boolean).length).toBeGreaterThanOrEqual(lo.outlanes.filter(Boolean).length);
      expect(hi.flippers[0].len).toBeLessThan(lo.flippers[0].len);
      expect(hi.gravity).toBeGreaterThan(lo.gravity);
      expect(saveFor(d)).toBeLessThan(saveFor((d - 1) as Difficulty));
      expect(goalFor(d)).toBeGreaterThan(goalFor((d - 1) as Difficulty));
    }
    expect(createLevel(1, new Rng(1)).outlanes).toEqual([false, false]);
    expect(createLevel(5, new Rng(1)).outlanes).toEqual([true, true]);
  });

  it('places every bumper apart from the others, inside the field and below the lanes', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 20; seed++) {
        const s = createLevel(d, new Rng(seed));
        // The kicker post at the top left, then the dealt bumpers.
        expect(s.bumpers.length, `level ${d} seed ${seed}`).toBe(byLevel(d, [4, 4, 5, 5, 6]));
        let slack = Infinity;
        for (const a of s.bumpers)
          for (const b of s.bumpers.filter((q) => q !== a)) slack = Math.min(slack, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
        expect(slack).toBeGreaterThan(2 * BALL_R);
        for (const b of s.bumpers.slice(1)) {
          expect(b.y - b.r).toBeGreaterThan(LANE_Y1 + 2 * BALL_R);
          expect(b.x - b.r).toBeGreaterThan(4 + 2 * BALL_R);
          expect(b.x + b.r).toBeLessThan(232 - 2 * BALL_R);
        }
      }
  });

  it('rests the ball on the plunger, then launches it by itself', () => {
    const s = createLevel(1, new Rng(3));
    step(s, 0.5);
    expect(s.held).toBe(true);
    let launched = false;
    for (let t = 0; t < 1 && !launched; t += DT) launched = step(s, DT).launched;
    expect(launched).toBe(true);
    expect(s.vy).toBeLessThan(-500);
  });

  it('launches harder the longer the plunger is pulled', () => {
    const speed = (hold: number) => {
      const s = createLevel(1, new Rng(3));
      pull(s);
      for (let t = 0; t < hold; t += DT) step(s, DT);
      expect(s.held).toBe(true);
      release(s);
      return -s.vy;
    };
    expect(speed(0.8)).toBeGreaterThan(speed(0.1) + 100);
  });

  it('flips a ball resting on a flipper up the table', () => {
    const s = createLevel(2, new Rng(1));
    s.held = false;
    s.inLane = false;
    const f = s.flippers[0];
    const tip = flipperTip(f);
    s.bx = f.px + (tip.x - f.px) * 0.6;
    s.by = f.py + (tip.y - f.py) * 0.6 - BALL_R - 6;
    s.vx = s.vy = 0;
    s.press[0] = true;
    for (let i = 0; i < 6; i++) step(s, DT);
    expect(s.vy).toBeLessThan(-400);
    expect(f.a).toBeLessThan(0);
  });

  it('scores a bumper and fires the ball away from it', () => {
    const s = createLevel(1, new Rng(1));
    s.held = false;
    s.inLane = false;
    const b = s.bumpers[1];
    s.bx = b.x;
    s.by = b.y - b.r - BALL_R - 2;
    s.vx = 0;
    s.vy = 200;
    const ev = step(s, DT);
    expect(ev.hits.some((h) => h.kind === 'bumper')).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(PTS.bumper);
    expect(s.vy).toBeLessThan(-200);
  });

  it('raises the multiplier when a whole bank drops, then stands the bank back up', () => {
    const s = createLevel(1, new Rng(1));
    s.held = false;
    s.inLane = false;
    const ids = s.banks[0].ids;
    for (const i of ids.slice(1)) s.targets[i].down = true;
    const t = s.targets[ids[0]];
    s.bx = (t.ax + t.bx) / 2 + (t.ax === t.bx ? (t.ax < 118 ? 7 : -7) : 0);
    s.by = (t.ay + t.by) / 2 + (t.ax === t.bx ? 0 : 7);
    s.vx = s.vy = 0;
    const ev = step(s, DT);
    expect(ev.hits.map((h) => h.kind)).toContain('bank');
    expect(s.mult).toBe(2);
    expect(s.score).toBeGreaterThanOrEqual(PTS.target + PTS.bank);
    // Park the ball far away: the bank comes back.
    s.held = true;
    for (let i = 0; i < 180; i++) step(s, DT);
    expect(ids.every((i) => !s.targets[i].down)).toBe(true);
  });

  it('gives back a ball lost right after launch, once', () => {
    const s = createLevel(1, new Rng(1));
    pull(s);
    release(s);
    s.inLane = false;
    s.bx = 118;
    s.by = H + 20;
    s.vy = 300;
    expect(step(s, DT).saved).toBe(true);
    expect(s.balls).toBe(BALLS);
    expect(s.held).toBe(true);
    pull(s);
    release(s);
    s.inLane = false;
    s.bx = 118;
    s.by = H + 20;
    expect(step(s, DT).drained).toBe(true);
    expect(s.balls).toBe(BALLS - 1);
    expect(s.by).toBe(PLUNGER_Y);
  });

  it('reaches the goal at every level with a flipping autopilot, with the unplayed-ball bonus', () => {
    for (const d of LEVELS)
      for (const seed of [1, 2, 4, 5]) {
        const { s, end } = play(d, seed, true);
        expect(end, `level ${d} seed ${seed}`).toBe('won');
        expect(s.score).toBeGreaterThanOrEqual(goalFor(d) + (s.balls - 1) * BALL_BONUS);
      }
  });

  it('loses every ball without flipping', () => {
    for (const d of LEVELS)
      for (const seed of [1, 2, 3]) {
        const { s, end } = play(d, seed, false);
        expect(end, `level ${d} seed ${seed}`).toBe('over');
        expect(s.balls).toBe(0);
        expect(s.score).toBeLessThan(goalFor(d));
      }
  });

  it('never ends in the first seconds without input', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 10; seed++) {
        const { s, end } = play(d, seed, false, 4);
        expect(end, `level ${d} seed ${seed}`).toBe('');
        expect(s.balls).toBe(BALLS);
      }
  });
});

describe('pinball card', () => {
  it('reports score, balls and status, and flips from the keyboard', () => {
    const m = mountGame(pinball, 3, 5);
    expect(m.lives).toEqual([BALLS, BALLS]);
    expect(m.status).toMatch(/points to go/);
    const key = (type: string, k: string) => m.inst.onKey?.(new KeyboardEvent(type, { key: k }));
    expect(key('keydown', 'ArrowLeft')).toBe(true);
    m.run(0.1);
    expect(key('keyup', 'ArrowLeft')).toBe(true);
    expect(key('keydown', ' ')).toBe(true);
    m.run(0.5);
    expect(key('keyup', ' ')).toBe(true);
    m.run(3);
    expect(m.outcome).toBe('');
    expect(key('keydown', 'q')).toBe(false);
    m.inst.destroy?.();
    m.root.remove();
  });

  it('has rising star goals that need balls to spare', () => {
    for (const d of LEVELS) {
      const [two, three] = pinball.stars(d);
      expect(two).toBe(goalFor(d) + BALL_BONUS);
      expect(three).toBe(goalFor(d) + 2 * BALL_BONUS);
    }
  });
});
