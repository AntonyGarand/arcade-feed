import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { skyguard as def } from '../src/games/skyguard';
import {
  AIM_MIN_Y,
  ammoFor,
  AMMO_POINTS,
  ammoLeft,
  baseFor,
  blastMax,
  blastR,
  citiesLeft,
  CITY_POINTS,
  createLevel,
  fire,
  flightTime,
  GROUND_Y,
  GROW_S,
  incoming,
  type Missile,
  MISSILE_POINTS,
  missilesFor,
  SHOT_V,
  speedFor,
  splitsFor,
  type State,
  step,
  W,
  waveSize,
} from '../src/games/skyguard/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

const at = (m: Missile, t: number) => ({ x: m.x + m.vx * t, y: m.y + m.vy * t });

/** Will a pending interceptor or a live blast catch this missile? */
function covered(s: State, m: Missile): boolean {
  const r = blastMax(s) * 0.8;
  for (const sh of s.shots) {
    const p = at(m, Math.hypot(sh.tx - sh.x, sh.ty - sh.y) / SHOT_V + GROW_S);
    if (Math.hypot(p.x - sh.tx, p.y - sh.ty) < r) return true;
  }
  for (const b of s.blasts) {
    if (b.kind === 'impact') continue;
    const p = at(m, Math.max(0, GROW_S - b.age));
    if (Math.hypot(p.x - b.x, p.y - b.y) < Math.max(blastR(b), b.age < GROW_S ? b.max * 0.8 : 0)) return true;
  }
  return false;
}

/**
 * Defend like a player: take the lowest missile nobody covers yet, lead it so the blast peaks on it,
 * fire from the nearest launcher. `sloppy` waits for a missile to be on screen a while, aims a few
 * units off and fires at most every 0.4 s.
 */
function pilot(s: State, sloppy: boolean, noise: Rng, wait: { t: number }) {
  if (sloppy && s.time < wait.t) return;
  const todo = s.missiles.filter((m) => !covered(s, m) && (!sloppy || m.age > 1)).sort((a, b) => b.y - a.y);
  for (const m of todo) {
    const b = baseFor(s, m.x);
    if (!b) return;
    let t = 0.5;
    for (let i = 0; i < 6; i++) {
      const p = at(m, t);
      t = flightTime(b.x, p.x, p.y) + GROW_S * 0.8;
    }
    let p = at(m, t);
    if (m.splitY && p.y >= m.splitY) continue; // let it split, then take the pieces
    if (p.y > AIM_MIN_Y) continue;
    if (!sloppy) {
      // Nudge the blast to also catch neighbours that will be close by then.
      const others = todo.filter((o) => o !== m).map((o) => at(o, t));
      let most = 0;
      for (const q of [p, ...others.map((o) => ({ x: (o.x + p.x) / 2, y: (o.y + p.y) / 2 }))]) {
        if (Math.hypot(q.x - p.x, q.y - p.y) > blastMax(s) * 0.7) continue;
        const n = others.filter((o) => Math.hypot(o.x - q.x, o.y - q.y) < blastMax(s) * 0.75).length;
        if (n > most) [most, p] = [n, q];
      }
    }
    if (sloppy) {
      // A person leads too little and lands a bit off.
      const q = at(m, t * 0.7);
      p = { x: q.x + (noise.next() - 0.5) * 30, y: q.y + (noise.next() - 0.5) * 20 };
    }
    fire(s, p.x, p.y);
    if (sloppy) {
      wait.t = s.time + 0.4;
      return;
    }
  }
}

function autopilot(d: Difficulty, seed: number, sloppy = false) {
  const s = createLevel(d, new Rng(seed));
  const noise = new Rng(seed * 5);
  const wait = { t: 0 };
  for (let t = 0; t < 120; t += DT) {
    pilot(s, sloppy, noise, wait);
    const ev = step(s, DT);
    if (ev.cleared) return { s, win: true };
    if (ev.over) return { s, win: false };
  }
  return { s, win: false };
}

describe('skyguard rules', () => {
  it('deals the same wave from the same seed', () => {
    expect(createLevel(4, new Rng(42)).plan).toEqual(createLevel(4, new Rng(42)).plan);
    expect(createLevel(4, new Rng(42)).plan).not.toEqual(createLevel(4, new Rng(43)).plan);
    expect(createLevel(2, new Rng(1)).plan.length).toBe(missilesFor(2));
  });

  it('gets harder: more and faster missiles, and more of them split', () => {
    for (const d of LEVELS.slice(1)) {
      const p = (d - 1) as Difficulty;
      expect(missilesFor(d)).toBeGreaterThan(missilesFor(p));
      expect(speedFor(d)).toBeGreaterThan(speedFor(p));
      expect(splitsFor(d)).toBeGreaterThanOrEqual(splitsFor(p));
      expect(createLevel(d, new Rng(3)).cities.length).toBeLessThanOrEqual(createLevel(p, new Rng(3)).cities.length);
    }
    expect(waveSize(5)).toBeGreaterThan(missilesFor(5));
    expect(createLevel(5, new Rng(3)).plan.filter((p) => p.splitY).length).toBe(splitsFor(5));
  });

  it('fires from the nearest launcher with ammo, and a blast takes out a missile', () => {
    const s = createLevel(1, new Rng(4));
    s.time = 100; // launch the whole wave at once
    step(s, DT);
    const m = s.missiles[0];
    expect(fire(s, 10, 200)).toBe(true);
    expect(s.bases[0].ammo).toBe(ammoFor(1) - 1);
    s.bases[0].ammo = 0;
    fire(s, 10, 200);
    expect(s.bases[1].ammo).toBe(ammoFor(1) - 1);
    s.shots = [];
    s.blasts.push({ x: m.x, y: m.y + m.vy * 0.3, max: 30, age: 0, kind: 'shot' });
    let killed = 0;
    for (let i = 0; i < 40; i++) killed += step(s, DT).killed;
    expect(killed).toBeGreaterThan(0);
    expect(s.score).toBe(killed * MISSILE_POINTS);
  });

  it('is lost when every city falls', () => {
    const s = createLevel(5, new Rng(5));
    let over = false;
    for (let t = 0; t < 120 && !over; t += DT) over = step(s, DT).over;
    expect(over).toBe(true);
    expect(citiesLeft(s)).toBe(0);
  });

  it('is cleared by an autopilot at every level, with cities and ammo left', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 23 + d));
      const slow = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 23 + d, true));
      const wins = runs.filter((r) => r.win);
      expect(wins.length, `level ${d}`).toBeGreaterThanOrEqual(5);
      for (const r of wins) {
        expect(incoming(r.s)).toBe(0);
        expect(r.s.score).toBe(r.s.kills * MISSILE_POINTS + citiesLeft(r.s) * CITY_POINTS + ammoLeft(r.s) * AMMO_POINTS);
        expect(r.s.kills).toBe(waveSize(d));
      }
      const [two, three] = def.stars(d);
      const scores = wins.map((r) => r.s.score);
      expect(Math.max(...scores), `level ${d}`).toBeGreaterThanOrEqual(three);
      expect(scores.filter((x) => x >= two).length, `level ${d}`).toBeGreaterThanOrEqual(wins.length / 2);
      // A player who leads too little still clears up to Expert; from Hard on, it rarely gets three stars.
      expect(slow.filter((r) => r.win).length, `level ${d} slow`).toBeGreaterThanOrEqual(d < 5 ? 3 : 1);
      expect(slow.filter((r) => r.s.score >= three).length, `level ${d} slow`).toBeLessThanOrEqual(d < 3 ? 6 : 2);
    }
  });

  it('aims and fires from the keyboard when mounted', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(def, d, 9);
      expect(m.score).toBe(0);
      expect(m.lives).toBeNull();
      expect(m.status).toMatch(/missile/);
      const key = (k: string, type = 'keydown') => m.inst.onKey!(new KeyboardEvent(type, { key: k }));
      key('ArrowUp');
      m.run(0.5);
      key('ArrowUp', 'keyup');
      expect(key(' ')).toBe(true);
      expect(key('z')).toBe(true);
      m.run(3);
      expect(m.outcome).toBe('');
      expect(m.status).toContain(`${3 * ammoFor(d) - 2} interceptors`);
      expect(key('q')).toBe(false);
      m.inst.destroy?.();
      m.root.remove();
    }
    expect(W).toBeGreaterThan(GROUND_Y - 100);
  });
});
