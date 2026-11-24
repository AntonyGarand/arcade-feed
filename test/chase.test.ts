import { describe, expect, it } from 'vitest';
import { _setLocaleForTests } from '../src/core/i18n';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import type { Dir } from '../src/kits/gesture/gesture';
import { kindsAt } from '../src/core/variety';
import { chase } from '../src/games/chase';
import { DEN, DOOR, KINDS, type KindId, PATH, sizeFor, WALL } from '../src/games/chase/maze';
import {
  BERRY,
  bfs,
  chasersFor,
  CHAIN,
  createLevel,
  DASH_S,
  FIRST_OUT,
  frightFor,
  GHOST,
  grant,
  HAWK,
  heroCan,
  heroSpeedFor,
  LIVES,
  nb,
  owlsFor,
  paceFor,
  pos,
  SEED,
  SEED_POINTS,
  seedsFor,
  step,
  steer,
  STREAK_TIERS,
  STREAK_WINDOW,
  type Power,
  type State,
} from '../src/games/chase/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;
const DIRS: Dir[] = [0, 1, 2, 3];

/** An independent copy of a run (the maze is shared, it never changes), for looking ahead. */
function clone(s: State): State {
  return {
    ...s,
    items: s.items.slice(),
    hero: { ...s.hero },
    chasers: s.chasers.map((c) => ({ ...c })),
    rng: Object.assign(Object.create(Rng.prototype) as Rng, s.rng),
  };
}

/** Owls that can hurt the hero (or will soon: a scare about to end). */
const hunters = (s: State) => s.chasers.filter((c) => (c.mode === 'run' || c.mode === 'leave') && (!c.fright || s.fright < 1));

/** Straight-line distance from cell `i` to the nearest hunting owl. */
function room(s: State, i: number): number {
  const x = i % s.cols;
  const y = Math.floor(i / s.cols);
  let best = 99;
  for (const c of hunters(s)) {
    const p = pos(s, c);
    let dx = Math.abs(p.x - 0.5 - x);
    if (dx > s.cols / 2) dx = s.cols - dx;
    best = Math.min(best, Math.hypot(dx, p.y - 0.5 - y));
  }
  return best;
}

/** The cell where the hero's next turn happens. */
const turnCell = (s: State) => (s.hero.moving ? nb(s, s.hero.at, s.hero.dir) : s.hero.at);

/** Look-ahead policy: at every turn, head for the open way with the most room from the owls. */
function flee(s: State) {
  const from = turnCell(s);
  let best: Dir | -1 = -1;
  for (const d of DIRS) if (heroCan(s, from, d) && (best < 0 || room(s, nb(s, from, d)) > room(s, nb(s, from, best as Dir)))) best = d;
  if (best >= 0) steer(s, best as Dir);
}

/** Does the hero survive `seconds` after `act`, fleeing at every turn? */
function survives(s0: State, act: (s: State) => void, seconds: number): boolean {
  const s = clone(s0);
  act(s);
  for (let t = 0; t < seconds; t += DT) {
    if (t > 0.3) flee(s);
    const ev = step(s, DT);
    if (ev.lostLife) return false;
    if (ev.won) return true;
  }
  return true;
}

/** Steps from the cell after `first` (taken at `from`) to the nearest seed or berry. */
function toFood(s: State, from: number, first: Dir, berries: boolean): number {
  const j = nb(s, from, first);
  if (s.items[j] && (!berries || s.items[j] === BERRY)) return 1;
  const dist = bfs(s, j, (i, k) => s.grid[k] === PATH && !(i === j && k === from));
  let best = 9999;
  for (let i = 0; i < dist.length; i++) if (dist[i] > 0 && s.items[i] && (!berries || s.items[i] === BERRY)) best = Math.min(best, dist[i]);
  return best + 1;
}

/**
 * The autopilot: once per cell, rank its moves by the shortest way to food (to a berry when an owl is
 * close), then take the best one that a short look-ahead says won't get it caught.
 */
function pilot(s: State, memo: { at: number; dir: number }) {
  const h = s.hero;
  if (s.dying > 0 || (memo.at === h.at && memo.dir === h.dir && h.moving)) return;
  memo.at = h.at;
  memo.dir = h.dir;
  const from = turnCell(s);
  const back = h.moving ? (((h.dir + 2) % 4) as Dir) : -1;
  const close = room(s, h.at) < 5 && s.fright === 0;
  const berries = close && s.items.includes(BERRY);
  const acts: { score: number; act: (x: State) => void }[] = [];
  for (const d of DIRS) {
    if (!heroCan(s, from, d) || (d === back && from !== h.at)) continue;
    acts.push({ score: toFood(s, from, d, berries), act: (x) => steer(x, d) });
  }
  if (back >= 0 && from !== h.at) acts.push({ score: toFood(s, h.at, back as Dir, berries) + 1, act: (x) => steer(x, back as Dir) });
  acts.sort((a, b) => a.score - b.score);
  const pick = acts.find((a) => survives(s, a.act, 2.5)) ?? acts[0];
  pick?.act(s);
}

function autopilot(d: Difficulty, seed: number, seconds = 400, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  let lost = 0;
  let caught = 0;
  const powers: Power[] = [];
  const memo = { at: -1, dir: -2 };
  for (let t = 0; t < seconds; t += DT) {
    pilot(s, memo);
    const ev = step(s, DT);
    if (ev.lostLife) lost++;
    caught += ev.caught.length;
    if (ev.unlocked) powers.push(ev.unlocked);
    if (ev.won) return { s, win: true, lost, caught, t, powers };
    if (ev.over) return { s, win: false, lost, caught, t, powers };
  }
  return { s, win: false, lost, caught, t: seconds, powers };
}

describe('chase rules', () => {
  it('deals the same maze and run from the same seed', () => {
    const a = createLevel(4, new Rng(21));
    const b = createLevel(4, new Rng(21));
    expect(a.kind).toBe(b.kind);
    expect(a.chasers.map((c) => c.kind)).toEqual(b.chasers.map((c) => c.kind));
    expect(a.grid).toEqual(b.grid);
    expect(a.items).toEqual(b.items);
    const ra = autopilot(4, 21);
    const rb = autopilot(4, 21);
    expect(ra.s.score).toBe(rb.s.score);
    expect(ra.t).toBe(rb.t);
    expect(createLevel(4, new Rng(22)).grid).not.toEqual(a.grid);
  });

  it('builds a connected, mirrored maze with no dead ends', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 25; seed++) {
        // Every kind allowed at the level, in turn.
        const ok = kindsAt(d, KINDS);
        const s = createLevel(d, new Rng(seed), ok[seed % ok.length].id);
        const open = (i: number) => s.grid[i] === PATH;
        for (let r = 0; r < s.rows; r++)
          for (let c = 0; c < s.cols; c++) expect(s.grid[r * s.cols + c]).toBe(s.grid[r * s.cols + s.cols - 1 - c]);
        const reach = bfs(s, s.start, (_, j) => open(j));
        for (let i = 0; i < s.grid.length; i++) {
          if (!open(i)) continue;
          expect(reach[i], `level ${d} seed ${seed} cell ${i}`).toBeGreaterThanOrEqual(0);
          expect(DIRS.filter((k) => heroCan(s, i, k)).length).toBeGreaterThanOrEqual(2);
        }
        // The nest opens only through its door, onto the exit cell.
        expect(s.grid[s.door]).toBe(DOOR);
        expect(s.grid[s.den]).toBe(DEN);
        expect(s.toExit[s.den]).toBe(2);
        expect(s.left).toBeGreaterThanOrEqual(seedsFor(d));
        expect(s.tunnels.length, s.kind).toBe(s.kind === 'tunnels' ? 3 : 1);
      }
  });

  it('deals different kinds of maze across seeds, each only from its level', () => {
    for (const d of LEVELS) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 80; seed++) seen.add(createLevel(d, new Rng(seed)).kind);
      expect([...seen].sort(), `level ${d}`).toEqual(
        kindsAt(d, KINDS)
          .map((k) => k.id)
          .sort(),
      );
    }
  });

  it('gives each kind its twist: open meadows, night sight, hawks and ghost owls', () => {
    const open = (k: KindId) => createLevel(3, new Rng(7), k).grid.filter((v) => v === PATH).length;
    expect(open('meadow')).toBeGreaterThan(open('classic'));
    expect(createLevel(3, new Rng(7), 'night').sight).toBeGreaterThan(0);
    expect(createLevel(3, new Rng(7), 'classic').sight).toBe(0);
    expect(owlsFor(4, 'hawks').filter((o) => o === HAWK)).toHaveLength(2);
    expect(owlsFor(3, 'ghosts')).toContain(GHOST);
    expect(owlsFor(4, 'classic')).not.toContain(HAWK);
    // Master: a hawk joins the plain mazes.
    expect(owlsFor(5, 'classic')).toContain(HAWK);
    for (const d of LEVELS) for (const { id } of kindsAt(d, KINDS)) expect(owlsFor(d, id)).toHaveLength(chasersFor(d));
  });

  it('a hawk swoops faster when it sees the mouse down a corridor', () => {
    const s = createLevel(3, new Rng(3), 'hawks');
    s.phase = 3; // chasing for good
    const hawk = s.chasers.find((c) => c.kind === HAWK)!;
    // Find a straight open run of three cells for the hawk and the mouse.
    let from = -1;
    let dir: Dir = 1;
    for (let i = 0; i < s.grid.length && from < 0; i++)
      for (const d of DIRS) {
        const j = nb(s, i, d);
        const k = j >= 0 ? nb(s, j, d) : -1;
        if (s.grid[i] === PATH && j >= 0 && s.grid[j] === PATH && k >= 0 && s.grid[k] === PATH && Math.abs(k - i) <= 2 * s.cols) {
          from = i;
          dir = d;
          break;
        }
      }
    Object.assign(hawk, { mode: 'run', at: from, dir, moving: true, f: 0 });
    Object.assign(s.hero, { at: nb(s, nb(s, from, dir), dir), moving: false, f: 0 });
    s.safe = 99;
    step(s, 1 / 120);
    expect(hawk.swoop).toBe(true);
    // Off its row and column, the mouse is out of sight: no swoop.
    const away = [...s.grid.keys()].find(
      (i) => s.grid[i] === PATH && i % s.cols !== from % s.cols && Math.floor(i / s.cols) !== Math.floor(from / s.cols),
    )!;
    Object.assign(s.hero, { at: away });
    Object.assign(hawk, { at: from, f: 0 });
    step(s, 1 / 120);
    expect(hawk.swoop).toBe(false);
  });

  it('a ghost owl drifts through the hedges', () => {
    const s = createLevel(3, new Rng(8), 'ghosts');
    s.safe = 999;
    const ghost = s.chasers.find((c) => c.kind === GHOST)!;
    let inHedge = false;
    for (let t = 0; t < 60 && !inHedge; t += DT) {
      step(s, DT);
      inHedge = s.grid[ghost.at] === WALL;
    }
    expect(inHedge).toBe(true);
  });

  it('gets harder: bigger maze, more and faster owls, shorter scares', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(sizeFor(d)[0] * sizeFor(d)[1]).toBeGreaterThan(sizeFor(lo)[0] * sizeFor(lo)[1]);
      expect(chasersFor(d)).toBeGreaterThanOrEqual(chasersFor(lo));
      expect(heroSpeedFor(d) * paceFor(d)).toBeGreaterThan(heroSpeedFor(lo) * paceFor(lo));
      expect(frightFor(d)).toBeLessThan(frightFor(lo));
      expect(seedsFor(d)).toBeGreaterThan(seedsFor(lo));
    }
    expect(createLevel(5, new Rng(1)).total).toBeGreaterThan(createLevel(1, new Rng(1)).total);
  });

  it('waits for the first turn, then runs and eats seeds; owls stay home for the first seconds', () => {
    const s = createLevel(2, new Rng(4));
    step(s, 2);
    expect(s.hero.at).toBe(s.start);
    expect(s.chasers.every((c) => c.mode === 'den')).toBe(true);
    const way = DIRS.find((d) => heroCan(s, s.start, d))!;
    steer(s, way);
    let seeds = 0;
    for (let k = 0; k < 30; k++) seeds += step(s, DT).seeds;
    expect(s.hero.at).not.toBe(s.start);
    expect(seeds).toBeGreaterThan(0);
    expect(s.score).toBe(seeds * SEED_POINTS);
    step(s, FIRST_OUT);
    expect(s.chasers.some((c) => c.mode !== 'den')).toBe(true);
  });

  it('turns straight back at once and buffers other turns', () => {
    const s = createLevel(1, new Rng(9));
    const h = s.hero;
    const way = DIRS.find((d) => heroCan(s, s.start, d))!;
    steer(s, way);
    step(s, 0.1);
    const was = h.at;
    steer(s, ((way + 2) % 4) as Dir);
    expect(h.dir).toBe((way + 2) % 4);
    expect(h.at).toBe(nb(s, was, way));
  });

  it('scares the owls with a berry, and catching them chains 200, 400…', () => {
    const s = createLevel(1, new Rng(5));
    step(s, 1);
    // Let the owls out at the exit, heading up.
    for (const o of s.chasers) Object.assign(o, { mode: 'run', at: s.exit, dir: 0, moving: true, f: 0 });
    const owls = s.chasers;
    // Put the hero next to a berry and eat it.
    const b = s.items.indexOf(BERRY);
    const d = DIRS.find((k) => heroCan(s, b, k))!;
    Object.assign(s.hero, { at: nb(s, b, d), dir: (d + 2) % 4, moving: true, f: 0.95, want: -1 });
    expect(step(s, DT).berry).toBe(true);
    expect(s.fright).toBeGreaterThan(0);
    expect(owls.every((c) => c.fright)).toBe(true);
    // Drop the hero onto the first scared owl.
    const o = owls[0];
    Object.assign(s.hero, { at: o.at, moving: false, f: 0 });
    Object.assign(o, { f: 0 });
    const ev = step(s, DT);
    expect(ev.caught[0]?.points).toBe(CHAIN[0]);
    expect(o.mode).toBe('eyes');
  });

  it('every kind allowed at a level is cleared by the autopilot', () => {
    for (const d of [2, 4, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const runs = [1, 2, 3].map((seed) => autopilot(d, seed + d, 400, id));
        expect(runs.filter((r) => r.win).length, `${id} level ${d}`).toBe(3);
      }
  }, 120_000);

  it('a munch streak unlocks a dash, then a seed magnet, in a normal run', () => {
    const runs = [1, 2, 3, 4].map((seed) => autopilot(1, seed, 400, 'classic'));
    for (const r of runs) {
      expect(r.win).toBe(true);
      expect(r.powers[0]).toBe('dash');
    }
    expect(runs.some((r) => r.powers.includes('magnet'))).toBe(true);
  });

  it('the streak ends after a pause, and resets its milestones', () => {
    const s = createLevel(1, new Rng(2), 'classic');
    const way = DIRS.find((d) => heroCan(s, s.start, d))!;
    steer(s, way);
    let streak = 0;
    for (let k = 0; k < 20; k++) streak = Math.max(streak, step(s, DT).streak);
    expect(streak).toBeGreaterThan(0);
    s.hero.moving = false;
    step(s, STREAK_WINDOW + 0.05);
    expect(s.streak).toBe(0);
    expect(s.tier).toBe(0);
  });

  it('streak powers: a dash speeds the mouse up, a magnet pulls seeds in, a scare frightens the owls', () => {
    const run = (power?: Power) => {
      const s = createLevel(2, new Rng(12), 'classic');
      if (power) grant(s, power);
      steer(
        s,
        DIRS.find((d) => heroCan(s, s.start, d))!,
      );
      let seeds = 0;
      let pulled = 0;
      for (let k = 0; k < 30; k++) {
        const ev = step(s, DT);
        seeds += ev.seeds;
        pulled += ev.pulled.length;
      }
      return { s, seeds, pulled };
    };
    const plain = run();
    const dash = run('dash');
    expect(dash.s.dash).toBeGreaterThan(0);
    expect(dash.s.dash).toBeLessThan(DASH_S);
    expect(dash.seeds).toBeGreaterThanOrEqual(plain.seeds);
    const magnet = run('magnet');
    expect(magnet.pulled).toBeGreaterThan(0);
    expect(magnet.seeds).toBeGreaterThan(plain.seeds);
    // A scare frightens every owl out hunting.
    const s = createLevel(2, new Rng(12), 'classic');
    for (const o of s.chasers) Object.assign(o, { mode: 'run', at: s.exit, dir: 0, moving: true, f: 0 });
    grant(s, 'scare');
    expect(s.fright).toBeGreaterThan(0);
    expect(s.chasers.every((c) => c.fright)).toBe(true);
  });

  it('streak milestones fire in order at their counts', () => {
    const s = createLevel(5, new Rng(4), 'classic');
    // Eat seed after seed without a pause by dropping the mouse onto them one by one.
    const seeds = [...s.items.keys()].filter((i) => s.items[i] === SEED);
    const fired: [number, Power][] = [];
    s.safe = 999;
    for (const i of seeds.slice(0, STREAK_TIERS[3])) {
      const from = DIRS.map((d) => nb(s, i, d)).find((j) => j >= 0 && s.grid[j] === PATH)!;
      const d = DIRS.find((k) => nb(s, from, k) === i)!;
      Object.assign(s.hero, { at: from, dir: d, moving: true, f: 0.99, want: -1 });
      const ev = step(s, 1 / 120);
      if (ev.unlocked) fired.push([s.streak, ev.unlocked]);
    }
    expect(fired.map(([, p]) => p)).toEqual(['dash', 'magnet', 'scare', 'frenzy']);
    // The magnet may pull extra seeds, so a milestone can land a little past its count.
    fired.forEach(([n], k) => expect(n).toBeGreaterThanOrEqual(STREAK_TIERS[k]));
  });

  it('names every kind of maze on the card, short enough for the gate', () => {
    for (const lang of ['en', 'fr'] as const) {
      _setLocaleForTests(lang);
      const seen = new Set<string>();
      for (let seed = 1; seed <= 40; seed++) {
        const m = mountGame(chase, 4, seed);
        const v = m.variant!;
        seen.add(v.id);
        expect(v.name.length, v.name).toBeLessThanOrEqual(18);
        expect(v.blurb!.length, v.blurb).toBeLessThanOrEqual(60);
        m.inst.destroy?.();
      }
      expect(seen.size).toBe(kindsAt(4, KINDS).length);
    }
    _setLocaleForTests('en');
  });

  for (const d of LEVELS)
    it(`is cleared by an autopilot at level ${d}, for several seeds`, () => {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed));
      const wins = runs.filter((r) => r.win);
      expect(wins.length, runs.map((r) => `${r.win ? 'W' : 'L'}${r.lost}/${r.caught}/${Math.round(r.t)}s/${r.s.score}`).join(' ')).toBe(6);
      for (const { s } of wins) {
        expect(s.left).toBe(0);
        expect(s.score).toBeGreaterThanOrEqual(s.total * SEED_POINTS);
      }
    }, 30_000);

  it('loses every life when the hero never moves', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(d + 30));
      let lost = 0;
      let firstHit = 0;
      let over = false;
      for (let t = 0; t < 240 && !over; t += DT) {
        const ev = step(s, DT);
        if (ev.lostLife) firstHit ||= s.time;
        if (ev.lostLife) lost++;
        over = ev.over;
      }
      expect(over, `level ${d}`).toBe(true);
      expect(lost).toBe(LIVES);
      // Nobody lands a hit in the first seconds.
      expect(firstHit).toBeGreaterThan(FIRST_OUT);
      expect(s.hero.at).toBe(s.start);
    }
  });
});
