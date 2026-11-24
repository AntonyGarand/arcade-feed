import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { byLevel, LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { pinball } from '../src/games/pinball';
import { pull, release, step } from '../src/games/pinball/rules';
import {
  BALL_BONUS,
  BALL_R,
  BALLS,
  COMBO_TIERS,
  COMBO_WINDOW,
  createLevel,
  flipperTip,
  goalFor,
  GUARD,
  H,
  KINDS,
  type KindId,
  LANE_Y1,
  PLUNGER_Y,
  PTS,
  saveFor,
  type State,
  VORTEX_R,
} from '../src/games/pinball/table';
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

function play(d: Difficulty, seed: number, flip: boolean, seconds = 600, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
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

const table = (s: State) => ({
  kind: s.kind,
  bumpers: s.bumpers,
  targets: s.targets,
  lanes: s.lanes,
  outlanes: s.outlanes,
  stars: s.stars,
  saucer: s.saucer,
  vortex: s.vortex,
});

/** A ball in play at (x, y) with speed (vx, vy). */
function at(s: State, x: number, y: number, vx = 0, vy = 0) {
  s.held = false;
  s.inLane = false;
  s.bx = x;
  s.by = y;
  s.vx = vx;
  s.vy = vy;
}

/** Drop the ball onto bumper `i` from just above. */
function onBumper(s: State, i: number) {
  const b = s.bumpers[i];
  at(s, b.x, b.y - b.r - BALL_R - 2, 0, 200);
  return step(s, DT);
}

describe('pinball rules', () => {
  it('deals the same table from the same seed', () => {
    for (const d of LEVELS) {
      expect(table(createLevel(d, new Rng(42)))).toEqual(table(createLevel(d, new Rng(42))));
    }
    expect(table(createLevel(3, new Rng(1)))).not.toEqual(table(createLevel(3, new Rng(2))));
  });

  it('gets harder: more bumpers and targets, open outlanes, shorter flippers, a steeper table', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(1), 'classic');
      const hi = createLevel(d, new Rng(1), 'classic');
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

  it('places every bumper apart from the others (all along their sway), inside the field and below the lanes', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS))
        for (let seed = 1; seed <= 12; seed++) {
          const s = createLevel(d, new Rng(seed), id);
          // The kicker post at the top left, then the dealt bumpers (a target gallery deals one fewer).
          const fewer = id === 'gallery' ? 1 : 0;
          expect(s.bumpers.length, `${id} level ${d} seed ${seed}`).toBeGreaterThanOrEqual(byLevel(d, [4, 4, 5, 5, 6]) - fewer);
          let slack = Infinity;
          for (const a of s.bumpers)
            for (const b of s.bumpers.filter((q) => q !== a)) {
              const dx = Math.max(0, Math.abs(a.x0 - b.x0) - a.amp - b.amp);
              slack = Math.min(slack, Math.hypot(dx, a.y - b.y) - a.r - b.r);
            }
          expect(slack, `${id} level ${d} seed ${seed}`).toBeGreaterThan(2 * BALL_R);
          for (const b of s.bumpers.slice(1)) {
            expect(b.y - b.r).toBeGreaterThan(LANE_Y1 + 2 * BALL_R);
            expect(b.x0 - b.amp - b.r).toBeGreaterThan(4 + 2 * BALL_R);
            expect(b.x0 + b.amp + b.r).toBeLessThan(232 - 2 * BALL_R);
          }
          // Stars sit clear of every bumper.
          for (const q of s.stars)
            for (const b of s.bumpers) expect(Math.hypot(Math.max(0, Math.abs(q.x - b.x0) - b.amp), q.y - b.y)).toBeGreaterThan(b.r);
        }
  });

  it('deals the kind from the seed, several kinds across seeds, and gates the harder ones', () => {
    expect(createLevel(4, new Rng(9)).kind).toBe(createLevel(4, new Rng(9)).kind);
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(5, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    const easy = new Set<string>();
    for (let seed = 0; seed < 60; seed++) easy.add(createLevel(1, new Rng(seed)).kind);
    expect(easy.has('vortex')).toBe(false);
    expect(easy.has('saucer')).toBe(false);
  });

  it('deals each kind its own extras', () => {
    const k = (id: KindId) => createLevel(4, new Rng(3), id);
    expect(k('storm').bumpers.filter((b) => b.amp > 0).length).toBe(2);
    expect(k('storm').bumpers.length).toBeGreaterThan(k('classic').bumpers.length);
    expect(k('gallery').banks.length).toBe(3);
    expect(k('stars').stars.length).toBe(5);
    expect(k('saucer').saucer).not.toBeNull();
    expect(k('vortex').vortex).not.toBeNull();
    expect(k('classic').saucer).toBeNull();
    expect(k('classic').vortex).toBeNull();
  });

  it('can reach the goal on every kind of table', () => {
    for (const d of [1, 3, 5] as const)
      for (const { id } of kindsAt(d, KINDS))
        for (const seed of [1, 2]) {
          const { end } = play(d, seed, true, 600, id);
          expect(end, `${id} level ${d} seed ${seed}`).toBe('won');
        }
  });

  it('a drifting bumper sways and scores double', () => {
    const s = createLevel(3, new Rng(2), 'storm');
    const i = s.bumpers.findIndex((b) => b.amp > 0);
    const x = s.bumpers[i].x;
    s.held = true;
    for (let k = 0; k < 30; k++) step(s, DT);
    expect(s.bumpers[i].x).not.toBeCloseTo(x, 1);
    const ev = onBumper(s, i);
    expect(ev.hits.find((h) => h.kind === 'bumper')?.pts).toBe(PTS.bumper * 2);
  });

  it('collects stars, and a whole set in a star hunt scores the bonus', () => {
    const s = createLevel(2, new Rng(4), 'stars');
    let bonus = false;
    for (const q of s.stars) {
      at(s, q.x, q.y);
      const ev = step(s, DT);
      expect(ev.hits.map((h) => h.kind)).toContain('star');
      bonus ||= ev.hits.some((h) => h.kind === 'stars');
    }
    expect(bonus).toBe(true);
    expect(s.stars.every((q) => !q.on)).toBe(true);
    // They all come back, somewhere new.
    s.held = true;
    pull(s);
    for (let k = 0; k < 120; k++) step(s, DT);
    expect(s.stars.every((q) => q.on)).toBe(true);
  });

  it('the saucer catches the ball, pays more each time, and kicks it back up', () => {
    const s = createLevel(3, new Rng(5), 'saucer');
    const sc = s.saucer!;
    const pays: number[] = [];
    for (let n = 0; n < 2; n++) {
      at(s, sc.x, sc.y - 4, 0, 60);
      const ev = step(s, DT);
      pays.push(ev.hits.find((h) => h.kind === 'saucer')?.pts ?? 0);
      expect(s.lock).toBeGreaterThan(0);
      let kicked = false;
      for (let k = 0; k < 90 && !kicked; k++) kicked = step(s, DT).kicked;
      expect(kicked).toBe(true);
      expect(s.vy).toBeLessThan(-300);
      for (let k = 0; k < 60; k++) step(s, DT); // let the cooldown run out
    }
    expect(pays[0]).toBe(PTS.saucer);
    expect(pays[1]).toBe(PTS.saucer * 2);
  });

  it('the black hole pulls the ball in, swallows a multiplier step and spits the ball back up', () => {
    const s = createLevel(4, new Rng(6), 'vortex');
    const v = s.vortex!;
    s.mult = 3;
    s.combo = 5;
    // Resting just inside its pull, above it: drawn into the core.
    at(s, v.x, v.y - VORTEX_R * 0.5);
    let swallowed = false;
    for (let k = 0; k < 120 && !swallowed; k++) swallowed = step(s, DT).swallowed;
    expect(swallowed).toBe(true);
    expect(s.mult).toBe(2);
    expect(s.combo).toBe(0);
    let kicked = false;
    for (let k = 0; k < 60 && !kicked; k++) kicked = step(s, DT).kicked;
    expect(kicked).toBe(true);
    expect(s.vy).toBeLessThan(0);
  });

  it('combo milestones unlock a frenzy, a ball save, the drain guard, then a jackpot', () => {
    const s = createLevel(1, new Rng(1), 'classic');
    const unlocked: string[] = [];
    for (const n of COMBO_TIERS.slice(0, 4)) {
      s.combo = n - 1;
      s.comboLeft = COMBO_WINDOW;
      const ev = onBumper(s, 1);
      expect(ev.tier, `at ${n}`).toBe(unlocked.length + 1);
      unlocked.push(ev.unlocked!);
    }
    expect(unlocked).toEqual(['frenzy', 'save', 'guard', 'jackpot']);
    expect(s.frenzy).toBeGreaterThan(0);
    expect(s.save).toBeGreaterThan(0);
    expect(s.guard).toBeGreaterThan(0);
    expect(s.mult).toBe(2);
    // The frenzy doubles plain hits.
    const ev = onBumper(s, 1);
    expect(ev.hits.find((h) => h.kind === 'bumper')?.pts).toBe(PTS.bumper * 2 * 2);
  });

  it('the drain guard post stops a ball falling between the flippers', () => {
    const s = createLevel(1, new Rng(1), 'classic');
    s.guard = 5;
    at(s, GUARD.x, GUARD.y - 30, 0, 300);
    for (let k = 0; k < 10; k++) step(s, DT);
    expect(s.vy).toBeLessThan(0);
  });

  it('a combo runs out when the hits stop, and a drain ends it', () => {
    const s = createLevel(1, new Rng(1), 'classic');
    onBumper(s, 1);
    expect(s.combo).toBeGreaterThan(0);
    s.held = true;
    pull(s); // hold the plunger so the ball stays put
    for (let t = 0; t < COMBO_WINDOW + 0.1; t += DT) step(s, DT);
    expect(s.combo).toBe(0);
    onBumper(s, 1);
    at(s, 118, H + 20, 0, 300);
    s.saveUsed = true;
    step(s, DT);
    expect(s.combo).toBe(0);
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
    for (const d of LEVELS) {
      let won = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const { s, end } = play(d, seed, true);
        if (end !== 'won') continue;
        won++;
        expect(s.score).toBeGreaterThanOrEqual(goalFor(d) + (s.balls - 1) * BALL_BONUS);
      }
      // Whatever kind of table each seed deals, a good flipper nearly always gets there.
      expect(won, `level ${d}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('loses every ball without flipping (bar a rare lucky bounce)', () => {
    for (const d of LEVELS) {
      let lost = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const { s, end } = play(d, seed, false);
        if (end !== 'over') continue;
        lost++;
        expect(s.balls).toBe(0);
        expect(s.score).toBeLessThan(goalFor(d));
      }
      expect(lost, `level ${d}`).toBeGreaterThanOrEqual(7);
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
    expect(m.variant?.id).toBe(createLevel(3, new Rng(5)).kind);
    expect(m.variant?.name.length).toBeLessThanOrEqual(18);
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
