import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { skyguard as def } from '../src/games/skyguard';
import {
  AIM_MIN_Y,
  ammoFor,
  AMMO_POINTS,
  ammoLeft,
  baseFor,
  BIG_S,
  CRATE_AMMO,
  blastMax,
  blastR,
  citiesLeft,
  CITY_POINTS,
  createLevel,
  fire,
  grant,
  flightTime,
  GROUND_Y,
  GROW_S,
  incoming,
  KINDS,
  type KindId,
  type Missile,
  MISSILE_POINTS,
  missilesFor,
  predict,
  SHOT_V,
  SLOW_S,
  STREAK_TIERS,
  SUPPLY_AMMO,
  speedFor,
  splitsFor,
  type State,
  step,
  W,
  waveSize,
} from '../src/games/skyguard/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Will a pending interceptor or a live blast catch this missile? */
function covered(s: State, m: Missile): boolean {
  const r = blastMax(s) * 0.8;
  for (const sh of s.shots) {
    const p = predict(s, m, Math.hypot(sh.tx - sh.x, sh.ty - sh.y) / SHOT_V + GROW_S);
    if (Math.hypot(p.x - sh.tx, p.y - sh.ty) < r) return true;
  }
  for (const b of s.blasts) {
    if (b.kind === 'impact') continue;
    const p = predict(s, m, Math.max(0, GROW_S - b.age));
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
      const p = predict(s, m, t);
      t = flightTime(b.x, p.x, p.y) + GROW_S * 0.8;
    }
    let p = predict(s, m, t);
    if (m.splitY && p.y >= m.splitY) continue; // let it split, then take the pieces
    if (p.y > AIM_MIN_Y) continue;
    if (!sloppy) {
      // Nudge the blast to also catch neighbours that will be close by then.
      const others = todo.filter((o) => o !== m).map((o) => predict(s, o, t));
      let most = 0;
      for (const q of [p, ...others.map((o) => ({ x: (o.x + p.x) / 2, y: (o.y + p.y) / 2 }))]) {
        if (Math.hypot(q.x - p.x, q.y - p.y) > blastMax(s) * 0.7) continue;
        const n = others.filter((o) => Math.hypot(o.x - q.x, o.y - q.y) < blastMax(s) * 0.75).length;
        if (n > most) [most, p] = [n, q];
      }
    }
    if (sloppy) {
      // A person leads too little and lands a bit off.
      const q = predict(s, m, t * 0.7);
      p = { x: q.x + (noise.next() - 0.5) * 30, y: q.y + (noise.next() - 0.5) * 20 };
    }
    fire(s, p.x, p.y);
    if (sloppy) {
      wait.t = s.time + 0.4;
      return;
    }
  }
}

function autopilot(d: Difficulty, seed: number, sloppy = false, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
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
    expect(createLevel(5, new Rng(3), 'barrage').plan.filter((p) => p.splitY).length).toBe(splitsFor(5));
  });

  it('fires from the nearest launcher with ammo, and a blast takes out a missile', () => {
    const s = createLevel(1, new Rng(4), 'barrage');
    s.clock = 100; // launch the whole wave at once
    step(s, DT);
    const m = s.missiles[0];
    expect(fire(s, 10, 200)).toBe(true);
    expect(s.bases[0].ammo).toBe(ammoFor(1) - 1);
    s.bases[0].ammo = 0;
    fire(s, 10, 200);
    expect(s.bases[1].ammo).toBe(ammoFor(1) - 1);
    s.shots = [];
    s.blasts.push({ id: 1000, x: m.x, y: m.y + m.vy * 0.3, max: 30, age: 0, kind: 'shot', hits: 0 });
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

  it('deals the same kind of wave from the same seed, and several kinds across seeds', () => {
    for (const seed of [3, 42, 77]) {
      const a = createLevel(4, new Rng(seed));
      const b = createLevel(4, new Rng(seed));
      expect(a.kind).toBe(b.kind);
      expect(a.plan).toEqual(b.plan);
      expect(a.crates).toEqual(b.crates);
    }
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBe(kindsAt(4, KINDS).length);
    for (let seed = 0; seed < 40; seed++) expect(['barrage', 'weavers', 'swarm']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('deals every kind with the same number of pieces, its twist, and an autopilot clears it', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const s = createLevel(d, new Rng(7), id);
        const pieces = s.plan.reduce((n, p) => n + (p.splitY ? p.kids.length : 1), 0);
        expect(pieces, `${id} ${d}`).toBe(waveSize(d));
        const twist = {
          barrage: true,
          swarm: true,
          weavers: s.plan.some((p) => p.wob > 0),
          heavy: s.plan.filter((p) => p.hp > 1).length > 2 && s.crates.length === 2,
          mirv: s.plan.filter((p) => p.splitY).length > splitsFor(d),
        }[id];
        expect(twist, `${id} ${d}`).toBe(true);
        const runs = [1, 2, 3, 4].map((k) => autopilot(d, k * 31 + d, false, id));
        const wins = runs.filter((r) => r.win);
        expect(wins.length, `${id} level ${d}`).toBeGreaterThanOrEqual(3);
        const [two, three] = def.stars(d);
        for (const r of wins) expect(r.s.score, `${id} level ${d}`).toBeGreaterThanOrEqual(two);
        expect(Math.max(...wins.map((r) => r.s.score)), `${id} level ${d}`).toBeGreaterThanOrEqual(three - 60);
      }
  });

  it('a heavy warhead shrugs off its first blast and falls to the second', () => {
    const s = createLevel(3, new Rng(2), 'heavy');
    s.clock = 100;
    step(s, DT);
    const m = s.missiles.find((x) => x.hp > 1)!;
    s.blasts.push({ id: 1000, x: m.x, y: m.y, max: 30, age: GROW_S, kind: 'shot', hits: 0 });
    const ev = step(s, DT);
    expect(ev.cracked.length).toBeGreaterThan(0);
    expect(s.missiles).toContain(m);
    expect(m.hp).toBe(1);
    s.blasts.push({ id: 1001, x: m.x, y: m.y, max: 30, age: GROW_S, kind: 'shot', hits: 0 });
    step(s, DT);
    expect(s.missiles).not.toContain(m);
  });

  it('weavers swing from side to side but still land on their mark', () => {
    const s = createLevel(2, new Rng(5), 'weavers');
    s.clock = 100;
    step(s, DT);
    const m = s.missiles.find((x) => x.wob > 0)!;
    let off = 0;
    let landed = false;
    for (let t = 0; t < 30 && !landed; t += DT) {
      off = Math.max(off, Math.abs(m.x - m.px));
      landed = step(s, DT).impacts.some((i) => i.x === m.tx);
    }
    expect(off).toBeGreaterThan(8);
    expect(landed).toBe(true);
  });

  it('a blasted supply crate hands out interceptors', () => {
    const s = createLevel(3, new Rng(8), 'barrage');
    const c = s.crates[0];
    s.clock = c.t;
    for (let i = 0; i < 120; i++) step(s, DT);
    const before = ammoLeft(s);
    s.blasts.push({ id: 1000, x: c.x, y: c.y, max: 30, age: GROW_S, kind: 'shot', hits: 0 });
    const ev = step(s, DT);
    expect(ev.crates.length).toBe(1);
    expect(ammoLeft(s)).toBe(before + CRATE_AMMO);
    expect(s.crates.length).toBe(0);
  });

  it('a clean streak unlocks big blasts, then a resupply, and a wasted shot ends it', () => {
    const s = createLevel(2, new Rng(4), 'barrage');
    s.clock = 100;
    step(s, DT);
    const ammo = ammoLeft(s);
    const powers: string[] = [];
    let bigAtTier1 = 0;
    while (s.missiles.length && powers.length < 2) {
      const m = s.missiles[0];
      s.blasts.push({ id: 1000, x: m.x, y: m.y, max: 4, age: GROW_S, kind: 'shot', hits: 0 });
      const ev = step(s, DT);
      if (ev.power) powers.push(`${ev.tier}:${ev.power}`);
      if (ev.power === 'big') bigAtTier1 = s.big;
    }
    expect(powers).toEqual(['1:big', '2:supply']);
    expect(bigAtTier1).toBeCloseTo(BIG_S, 0);
    expect(s.streak).toBeGreaterThanOrEqual(STREAK_TIERS[1]);
    expect(ammoLeft(s)).toBe(ammo + 3 * SUPPLY_AMMO);
    expect(blastMax(s)).toBeGreaterThan(40);
    // A shot into empty sky: when its blast fades, the streak is over.
    s.missiles = [];
    s.crates = [];
    fire(s, 150, 40);
    let broke = 0;
    for (let i = 0; i < 180 && !broke; i++) broke = step(s, DT).broke;
    expect(broke).toBeGreaterThanOrEqual(STREAK_TIERS[1]);
    expect(s.streak).toBe(0);
    expect(s.tier).toBe(0);
  });

  it('slow motion slows the missiles, and a rebuild brings back a wrecked city', () => {
    const s = createLevel(3, new Rng(6), 'barrage');
    s.clock = 100;
    step(s, DT);
    const m = s.missiles[0];
    const y0 = m.y;
    step(s, DT);
    const fast = m.y - y0;
    grant(s, 'slow');
    expect(s.slow).toBe(SLOW_S);
    const y1 = m.y;
    step(s, DT);
    expect(m.y - y1).toBeCloseTo(fast / 2, 5);
    s.cities[2].alive = false;
    expect(grant(s, 'rebuild')).toBe(2);
    expect(s.cities[2].alive).toBe(true);
  });

  it('names the kind of wave on the start gate', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = mountGame(def, 4, seed);
      expect(m.variant?.id).toBe(createLevel(4, new Rng(seed)).kind);
      expect(m.variant!.name.length).toBeLessThanOrEqual(18);
      expect(m.variant!.blurb!.length).toBeLessThanOrEqual(60);
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
