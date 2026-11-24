import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { rocks as def } from '../src/games/rocks';
import { kindsAt } from '../src/core/variety';
import {
  angleTo,
  bigFor,
  BOMB_R,
  COMBO_TIERS,
  CORE_R,
  createLevel,
  grant,
  H,
  KINDS,
  type KindId,
  LIFE_BONUS,
  LIVES,
  MINE_BLAST,
  parFor,
  type Power,
  ROCK_R,
  rockPoints,
  type State,
  step,
  targetsLeft,
  TOUCH_THRUST,
  UFO_R,
  W,
  worth,
  wrapD,
} from '../src/games/rocks/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * Steer like a player holding a finger down: point at the nearest rock's lead position (close to the
 * ship, so it doesn't thrust), or far away from a rock that gets too close (so it thrusts clear).
 */
function pilot(s: State) {
  if (!s.alive) {
    s.pointer = null;
    return;
  }
  // Keep clear of a gravity well's core.
  if (s.well) {
    const dx = wrapD(s.x, s.well.x, W);
    const dy = wrapD(s.y, s.well.y, H);
    const n = Math.hypot(dx, dy) || 1;
    if (n < 55) {
      s.pointer = { x: s.x - (dx / n) * 200, y: s.y - (dy / n) * 200 };
      return;
    }
  }
  let best = null as null | { dx: number; dy: number; d: number; r: number; vx: number; vy: number };
  const targets = [
    ...s.rocks.map((r) => ({ x: r.x, y: r.y, r: ROCK_R[r.size], vx: r.vx, vy: r.vy })),
    ...s.mines.map((m) => ({ x: m.x, y: m.y, r: 6, vx: 0, vy: 0 })),
    ...(s.ufo ? [{ x: s.ufo.x, y: s.ufo.y, r: UFO_R, vx: s.ufo.vx, vy: 0 }] : []),
  ];
  for (const r of targets) {
    const dx = wrapD(s.x, r.x, W);
    const dy = wrapD(s.y, r.y, H);
    const d = Math.hypot(dx, dy) - r.r;
    if (!best || d < best.d) best = { dx, dy, d, r: r.r, vx: r.vx, vy: r.vy };
  }
  if (!best) {
    s.pointer = null;
    return;
  }
  const closing = best.dx * (best.vx - s.vx) + best.dy * (best.vy - s.vy) < 0;
  if (best.d < 22 && closing && s.safe <= 0) {
    const n = Math.hypot(best.dx, best.dy) || 1;
    s.pointer = { x: s.x - (best.dx / n) * 200, y: s.y - (best.dy / n) * 200 };
    return;
  }
  // Lead: where the rock will be when a shot gets there.
  const t = Math.hypot(best.dx, best.dy) / 330;
  const lx = best.dx + (best.vx - s.vx * 0.6) * t;
  const ly = best.dy + (best.vy - s.vy * 0.6) * t;
  const n = Math.hypot(lx, ly) || 1;
  const reach = TOUCH_THRUST * (best.d > 140 ? 1.5 : 0.5);
  s.pointer = { x: s.x + (lx / n) * reach, y: s.y + (ly / n) * reach };
}

/** `react` > 0 plays like a person: the finger only moves every `react` seconds, and lands a bit off. */
function autopilot(d: Difficulty, seed: number, react = 0, seconds = 240, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const start = worth(s);
  const jitter = new Rng(seed * 7);
  let next = 0;
  for (let t = 0; t < seconds; t += DT) {
    if (t >= next) {
      pilot(s);
      next = t + react;
      if (react && s.pointer) {
        const k = (jitter.next() - 0.5) * 50;
        s.pointer = { x: s.pointer.x + k, y: s.pointer.y - k };
      }
    }
    const ev = step(s, DT);
    if (ev.cleared) return { s, win: true, start };
    if (ev.over) return { s, win: false, start };
  }
  return { s, win: false, start };
}

describe('rocks rules', () => {
  it('deals the same field from the same seed', () => {
    const a = createLevel(3, new Rng(42), 'belt');
    expect(a.rocks).toEqual(createLevel(3, new Rng(42), 'belt').rocks);
    expect(a.rocks).not.toEqual(createLevel(3, new Rng(43), 'belt').rocks);
    expect(a.rocks.length).toBe(bigFor(3));
    // Nothing starts on top of the ship.
    for (const r of a.rocks) expect(Math.hypot(r.x - W / 2, r.y - H / 2)).toBeGreaterThan(100);
  });

  it('gets harder: more and faster rocks', () => {
    const speed = (s: State) => Math.max(...s.rocks.map((r) => Math.hypot(r.vx, r.vy)));
    for (const d of LEVELS.slice(1)) {
      const lo = createLevel((d - 1) as Difficulty, new Rng(1), 'belt');
      const hi = createLevel(d, new Rng(1), 'belt');
      expect(hi.rocks.length).toBeGreaterThanOrEqual(lo.rocks.length);
      expect(speed(hi)).toBeGreaterThan(speed(lo));
    }
  });

  it('turns, thrusts with inertia, wraps and shoots', () => {
    const s = createLevel(1, new Rng(2), 'belt');
    s.rocks = [];
    s.turn = 1;
    step(s, 0.1);
    expect(s.a).toBeGreaterThan(0);
    s.turn = 0;
    s.thrust = true;
    for (let i = 0; i < 30; i++) step(s, DT);
    s.thrust = false;
    const v = Math.hypot(s.vx, s.vy);
    expect(v).toBeGreaterThan(50);
    step(s, DT);
    expect(Math.hypot(s.vx, s.vy)).toBeGreaterThan(v * 0.9); // still drifting
    for (let i = 0; i < 200; i++) step(s, DT);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x).toBeLessThan(W);
    s.fire = true;
    step(s, DT);
    expect(s.bullets.length).toBe(1);
  });

  it('splits a big rock into two medium ones, then small ones', () => {
    const s = createLevel(1, new Rng(3), 'belt');
    s.rocks = [s.rocks[0]];
    Object.assign(s.rocks[0], { x: W / 2, y: H / 2 - 60, vx: 0, vy: 0, spin: 0 });
    s.fire = true;
    for (let i = 0; i < 20 && s.rocks.length === 1; i++) step(s, DT);
    expect(s.rocks.map((r) => r.size)).toEqual([2, 2]);
    expect(s.score).toBe(20);
  });

  it('respawns in the centre with a safe time, and loses on the last life', () => {
    const s = createLevel(5, new Rng(4), 'belt');
    let deaths = 0;
    let over = false;
    const spawns: { safe: number; x: number; y: number }[] = [];
    for (let t = 0; t < 120 && !over; t += DT) {
      // Park on the nearest rock.
      const r = s.rocks[0];
      if (s.alive && s.safe <= 0) Object.assign(s, { x: r.x, y: r.y });
      const ev = step(s, DT);
      if (ev.died) deaths++;
      if (ev.respawned) spawns.push({ safe: s.safe, x: s.x, y: s.y });
      over = ev.over;
    }
    expect(over).toBe(true);
    expect(deaths).toBe(LIVES);
    expect(spawns.length).toBe(LIVES - 1);
    for (const p of spawns) {
      expect(p.safe).toBeGreaterThan(1);
      expect([p.x, p.y]).toEqual([W / 2, H / 2]);
    }
  });

  it('is cleared by a touch autopilot at every level, scoring every rock', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 17 + d));
      const slow = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 17 + d, 0.35));
      // A slower, less precise player still clears most runs.
      expect(slow.filter((r) => r.win).length, `level ${d} slow`).toBeGreaterThanOrEqual(3);
      const wins = runs.filter((r) => r.win);
      expect(wins.length, `level ${d}`).toBeGreaterThanOrEqual(4);
      for (const r of wins) expect(r.s.score).toBeGreaterThanOrEqual(r.start + r.s.lives * LIFE_BONUS);
      const [two, three] = def.stars(d);
      const scores = wins.map((r) => r.s.score);
      // The best runs reach three stars, an average one at least two.
      expect(Math.max(...scores), `level ${d}`).toBeGreaterThanOrEqual(three);
      expect(scores.filter((x) => x >= two).length, `level ${d}`).toBeGreaterThanOrEqual(wins.length / 2);
    }
  });

  it('reports turns, thrust and fire from the keyboard when mounted', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(def, d, 9);
      expect(m.score).toBe(0);
      expect(m.lives).toEqual([LIVES, LIVES]);
      expect(m.status).toMatch(/rock/);
      for (const key of ['ArrowLeft', ' ']) m.inst.onKey!(new KeyboardEvent('keydown', { key }));
      m.run(4);
      expect(m.outcome).toBe('');
      expect(m.score).toBeGreaterThan(0);
      for (const key of ['ArrowLeft', ' ']) m.inst.onKey!(new KeyboardEvent('keyup', { key }));
      expect(m.inst.onKey!(new KeyboardEvent('keydown', { key: 'q' }))).toBe(false);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('has par times that grow with the level', () => {
    for (const d of LEVELS.slice(1)) expect(parFor(d)).toBeGreaterThan(parFor((d - 1) as Difficulty));
    expect(Math.abs(angleTo(0.1, Math.PI * 2 - 0.1))).toBeCloseTo(0.2);
  });

  it('deals the same kind and field from the same seed, and several kinds across seeds', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const a = createLevel(4, new Rng(seed));
      const b = createLevel(4, new Rng(seed));
      expect(a.kind).toBe(b.kind);
      expect(a.rocks).toEqual(b.rocks);
      expect(a.mines).toEqual(b.mines);
      expect(a.well).toEqual(b.well);
    }
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBe(KINDS.length);
    const easy = new Set<string>();
    for (let seed = 0; seed < 60; seed++) easy.add(createLevel(1, new Rng(seed)).kind);
    expect([...easy].sort()).toEqual(['belt', 'swarm']);
  });

  it('deals each kind with its own pieces and about the same points', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const s = createLevel(d, new Rng(5), id);
        expect(Math.abs(worth(s) - rockPoints(d)) / rockPoints(d), `${id} ${d}`).toBeLessThan(0.05);
        expect(s.mines.length > 0, id).toBe(id === 'minefield');
        expect(s.well != null, id).toBe(id === 'well');
        expect(s.ufoDue >= 0, id).toBe(id === 'hunter');
        expect(
          s.rocks.some((r) => r.iron),
          id,
        ).toBe(id === 'iron');
        expect(
          s.rocks.every((r) => r.size === 2),
          id,
        ).toBe(id === 'swarm');
        // Nothing deadly starts near the ship.
        for (const m of s.mines) expect(Math.hypot(m.x - W / 2, m.y - H / 2)).toBeGreaterThan(70);
        const well = s.well ?? { x: 0, y: 0 };
        expect(Math.hypot(well.x - W / 2, well.y - H / 2)).toBeGreaterThan(100);
      }
  });

  it('clears every kind at every level with a touch autopilot, reaching the star goals', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const runs = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 31 + d, 0, 240, id));
        const wins = runs.filter((r) => r.win);
        expect(wins.length, `${id} level ${d}`).toBeGreaterThanOrEqual(4);
        for (const r of wins) expect(r.s.score).toBeGreaterThanOrEqual(r.start + r.s.lives * LIFE_BONUS);
        const [two] = def.stars(d);
        expect(wins.filter((r) => r.s.score >= two).length, `${id} level ${d} two stars`).toBeGreaterThanOrEqual(2);
      }
  });

  it('iron rocks take two hits a piece', () => {
    const s = createLevel(3, new Rng(3), 'iron');
    s.rocks = [s.rocks.find((r) => r.iron)!];
    Object.assign(s.rocks[0], { x: W / 2, y: H / 2 - 60, vx: 0, vy: 0, spin: 0 });
    s.fire = true;
    let dents = 0;
    for (let i = 0; i < 60 && s.rocks.length === 1; i++) dents += step(s, 1 / 60).dents.length;
    expect(dents).toBe(1);
    expect(s.rocks.map((r) => [r.size, r.iron, r.hp])).toEqual([
      [2, true, 2],
      [2, true, 2],
    ]);
    expect(s.score).toBe(30);
  });

  it('the saucer shows up, fires at the ship, and must be shot down to clear', () => {
    const s = createLevel(2, new Rng(8), 'hunter');
    s.rocks = [];
    s.safe = 0;
    let came = false;
    let fired = false;
    for (let i = 0; i < 60 * 6 && !fired; i++) {
      const ev = step(s, 1 / 60);
      came ||= ev.ufoIn;
      fired ||= ev.ufoFired;
      expect(ev.cleared).toBe(false);
    }
    expect(came).toBe(true);
    expect(fired).toBe(true);
    expect(s.shots.length).toBeGreaterThan(0);
    // Park the ship's gun under it.
    let cleared = false;
    for (let i = 0; i < 60 * 20 && !cleared; i++) {
      s.shots = [];
      if (s.ufo) Object.assign(s, { x: s.ufo.x, y: (s.ufo.y + 70) % H, a: 0, vx: 0, vy: 0, fire: true, alive: true, safe: 1 });
      cleared = step(s, 1 / 60).cleared;
    }
    expect(cleared).toBe(true);
    expect(targetsLeft(s)).toBe(0);
  });

  it('a mine blast breaks the rocks around it and chains', () => {
    const s = createLevel(3, new Rng(4), 'minefield');
    const [m1, m2] = s.mines;
    s.mines = [m1, { ...m2, x: m1.x + MINE_BLAST * 0.8, y: m1.y }];
    s.rocks = [s.rocks[0]];
    Object.assign(s.rocks[0], { x: m1.x, y: m1.y + 20, vx: 0, vy: 0 });
    Object.assign(s, { x: m1.x, y: m1.y + 120 > H ? m1.y - 60 : m1.y + 60, a: m1.y + 120 > H ? Math.PI : 0, safe: 5, fire: true });
    s.a = Math.atan2(wrapD(s.x, m1.x, W), -wrapD(s.y, m1.y, H));
    let mines = 0;
    for (let i = 0; i < 60 && s.mines.length; i++) mines += step(s, 1 / 60).blasts.filter((b) => b.what === 'mine').length;
    expect(mines).toBe(2);
    expect(s.rocks.every((r) => r.size === 2)).toBe(true);
  });

  it('the well pulls the ship in and its core is deadly', () => {
    const s = createLevel(3, new Rng(6), 'well');
    s.rocks = [];
    s.safe = 0;
    Object.assign(s, { x: s.well!.x + 40, y: s.well!.y });
    let died = false;
    for (let i = 0; i < 120 && !died; i++) died = step(s, 1 / 60).died;
    expect(died).toBe(true);
    expect(CORE_R).toBeGreaterThan(0);
  });

  it('a combo of quick hits unlocks rapid fire, then the spread shot', () => {
    const s = createLevel(3, new Rng(12), 'belt');
    const got: Power[] = [];
    let rapid = 0;
    for (let t = 0; t < 120 && got.length < 2 && s.rocks.length; t += DT) {
      pilot(s);
      const ev = step(s, DT);
      if (ev.power) got.push(ev.power);
      if (ev.power === 'rapid') rapid = s.rapid;
    }
    expect(got).toEqual(['rapid', 'spread']);
    expect(rapid).toBeGreaterThan(0);
    expect(s.combo).toBeGreaterThanOrEqual(COMBO_TIERS[1]);
    // Spread fires three shots at once.
    s.bullets = [];
    s.cool = 0;
    Object.assign(s, { pointer: null, fire: true, alive: true });
    step(s, DT);
    expect(s.bullets.length).toBe(3);
  });

  it('a combo ends when the window runs out', () => {
    const s = createLevel(1, new Rng(1), 'belt');
    s.combo = 4;
    s.comboLeft = 0.1;
    const ev = step(s, 0.2);
    expect(ev.comboEnd).toBe(4);
    expect(s.combo).toBe(0);
  });

  it('the shield soaks a hit and the smart bomb breaks every rock nearby', () => {
    const s = createLevel(2, new Rng(3), 'belt');
    grant(s, 'shield');
    s.safe = 0;
    Object.assign(s, { x: s.rocks[0].x, y: s.rocks[0].y });
    const ev = step(s, DT);
    expect(ev.shielded).toBe(true);
    expect(ev.died).toBe(false);
    expect(s.lives).toBe(LIVES);
    expect(s.shield).toBe(false);

    const b = createLevel(4, new Rng(3), 'belt');
    b.rocks[0].x = W / 2 + BOMB_R * 0.5;
    b.rocks[0].y = H / 2;
    const near = b.rocks.filter((r) => Math.hypot(wrapD(r.x, W / 2, W), wrapD(r.y, H / 2, H)) < BOMB_R + ROCK_R[r.size]).length;
    const n = b.rocks.length;
    grant(b, 'bomb');
    expect(near).toBeGreaterThan(0);
    expect(b.rocks.length).toBe(n + near);
    expect(b.score).toBe(near * 20);
  });

  it('names the kind on the start gate', () => {
    for (let seed = 1; seed < 30; seed++) {
      const m = mountGame(def, 5, seed);
      expect(m.variant).not.toBeNull();
      expect(m.variant!.name.length).toBeLessThanOrEqual(18);
      expect((m.variant!.blurb ?? '').length).toBeLessThanOrEqual(60);
      m.run(3);
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
