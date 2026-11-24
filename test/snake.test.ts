import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { snake } from '../src/games/snake';
import type { Dir } from '../src/kits/gesture/gesture';
import {
  ahead,
  CHAIN_STEPS,
  CHAIN_TIERS,
  COLS,
  createLevel,
  GHOST_STEPS,
  goalFor,
  grant,
  KINDS,
  PELLET_POINTS,
  ROWS,
  speedFor,
  START_ROW,
  step,
  tick,
  turn,
  wallsFor,
  type KindId,
  type State,
} from '../src/games/snake/rules';
import { mountGame } from './support/mount';

const DIRS: Dir[] = [0, 1, 2, 3];

/** First move of a shortest path to the pellet around walls and the body (or the roomiest safe move). */
function bfsMove(s: State, wary = true): Dir {
  const blocked = new Set(s.body.slice(0, -1));
  // Beetles and (when wary) the cells they could crawl onto.
  for (const b of s.beetles) {
    blocked.add(b.at);
    if (wary) for (const d of DIRS) blocked.add(ahead(s, d, b.at));
  }
  const first = new Map<number, Dir>();
  const room = [0, 0, 0, 0];
  const todo: number[] = [];
  for (const d of DIRS) {
    if ((d + 2) % 4 === s.dir) continue;
    const j = ahead(s, d);
    if (j < 0 || s.walls[j] || blocked.has(j) || first.has(j)) continue;
    first.set(j, d);
    todo.push(j);
  }
  for (let k = 0; k < todo.length; k++) {
    const i = todo[k];
    const via = first.get(i)!;
    room[via]++;
    if (i === s.pellet) return via;
    for (const d of DIRS) {
      const j = ahead(s, d, i);
      if (j < 0 || s.walls[j] || blocked.has(j) || first.has(j)) continue;
      first.set(j, via);
      todo.push(j);
    }
  }
  if (wary && s.beetles.length) return bfsMove(s, false);
  return first.size ? DIRS.reduce((a, b) => (room[b] > room[a] ? b : a)) : s.dir;
}

function autopilot(d: Difficulty, seed: number, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  for (let i = 0; i < 5000; i++) {
    const want = bfsMove(s);
    if (want !== s.dir) turn(s, want);
    const ev = tick(s);
    if (ev.won) return { s, win: true };
    if (ev.dead) return { s, win: false };
  }
  throw new Error(`never ended ${s.kind} ${d} ${seed} pellet ${s.pellet} eaten ${s.eaten}`);
}

describe('snake rules', () => {
  it('deals the same map and pellets from the same seed', () => {
    const a = createLevel(4, new Rng(12));
    const b = createLevel(4, new Rng(12));
    expect(a.kind).toBe(b.kind);
    expect(a.walls).toEqual(b.walls);
    expect(a.portals).toEqual(b.portals);
    expect(a.beetles).toEqual(b.beetles);
    expect(a.pellet).toBe(b.pellet);
    expect(autopilot(4, 12).s.steps).toBe(autopilot(4, 12).s.steps);
  });

  it('gets harder: more walls, more pellets, faster', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(wallsFor(d)).toBeGreaterThan(wallsFor(lo));
      expect(goalFor(d)).toBeGreaterThan(goalFor(lo));
      expect(speedFor(d)).toBeGreaterThan(speedFor(lo));
    }
    const border = 2 * COLS + 2 * (ROWS - 2);
    expect(createLevel(1, new Rng(1), 'classic').walls.filter(Boolean).length).toBe(border);
    expect(createLevel(5, new Rng(1), 'classic').walls.filter(Boolean).length).toBeGreaterThan(border + 20);
  });

  it('keeps the start lane open and the pellet off walls and the snake', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createLevel(5, new Rng(seed));
      for (let c = 1; c < COLS - 1; c++) expect(s.walls[START_ROW * COLS + c]).toBe(false);
      expect(s.walls[s.pellet]).toBe(false);
      expect(s.body).not.toContain(s.pellet);
    }
  });

  it('ignores a turn straight back and moves one cell per step', () => {
    const s = createLevel(1, new Rng(2), 'classic');
    const head = s.body[0];
    turn(s, 3); // reverse: ignored
    step(s, 1 / speedFor(1) + 0.001);
    expect(s.body[0]).toBe(head + 1);
    turn(s, 2);
    tick(s);
    expect(s.body[0]).toBe(head + 1 + COLS);
  });

  it('is cleared by a shortest-path player at every level (it can trap itself now and then)', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed, 'classic'));
      expect(runs.filter((r) => r.win).length, `level ${d}`).toBeGreaterThanOrEqual(5);
      for (const { s } of runs.filter((r) => r.win)) {
        expect(s.eaten).toBe(goalFor(d));
        expect(s.score).toBeGreaterThanOrEqual(goalFor(d) * PELLET_POINTS);
      }
    }
  });

  it('dies on hitting a wall', () => {
    const s = createLevel(1, new Rng(3), 'classic');
    s.pellet = -1;
    let dead = false;
    for (let i = 0; i < COLS && !dead; i++) dead = tick(s).dead;
    expect(dead).toBe(true);
  });

  it('deals different kinds across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    for (let seed = 0; seed < 40; seed++) expect(['classic', 'portals']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('deals every kind allowed at a level, and a shortest-path player can clear each', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const s0 = createLevel(d, new Rng(7), id);
        expect(s0.kind).toBe(id);
        for (let c = 1; c < COLS - 1; c++) expect(s0.walls[START_ROW * COLS + c], `${id} lane`).toBe(false);
        const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed, id));
        expect(runs.filter((r) => r.win).length, `${id} level ${d}`).toBeGreaterThanOrEqual(4);
      }
  });

  it('kinds bring their own twist', () => {
    const p = createLevel(3, new Rng(5), 'portals');
    expect(p.portals.length).toBe(4);
    const b = createLevel(5, new Rng(5), 'beetles');
    expect(b.beetles.length).toBe(2);
    const m = createLevel(3, new Rng(5), 'maze');
    expect(m.walls.filter(Boolean).length).toBeGreaterThan(2 * COLS + 2 * (ROWS - 2));
    // A shrinking arena closes in as pellets are eaten.
    expect(autopilot(4, 3, 'shrink').s.ring).toBe(1);
    expect(autopilot(5, 3, 'shrink').s.ring).toBe(2);
  });

  it('a portal carries the head to its partner, same heading', () => {
    const s = createLevel(3, new Rng(5), 'portals');
    const [a, b] = s.portals;
    expect(ahead(s, 1, a - 1)).toBe(b + 1);
    expect(ahead(s, 2, b - COLS)).toBe(a + COLS);
  });

  it('runaway pellets hop away from a close head', () => {
    const s = createLevel(3, new Rng(5), 'runaway');
    let hops = 0;
    for (let i = 0; i < 3000 && s.eaten < s.goal; i++) {
      const want = bfsMove(s);
      if (want !== s.dir) turn(s, want);
      const ev = tick(s);
      if (ev.hopped) hops++;
      if (ev.dead || ev.won) break;
    }
    expect(hops).toBeGreaterThan(0);
  });

  it('a quick chain unlocks a golden pellet, then slow motion, then ghost', () => {
    const s = createLevel(2, new Rng(4), 'classic');
    const perks: string[] = [];
    for (let i = 0; i < 400 && perks.length < 3; i++) {
      // Keep the next pellet right in front of the head so every bite is quick.
      if (s.pellet >= 0 && i % 3 === 0) {
        const j = ahead(s, s.dir);
        if (j >= 0 && !s.walls[j] && !s.body.includes(j)) s.pellet = j;
      }
      const want = bfsMove(s);
      if (want !== s.dir) turn(s, want);
      const ev = tick(s);
      expect(ev.dead).toBe(false);
      if (ev.perk) perks.push(ev.perk);
      if (ev.won) {
        s.eaten = 0;
        s.pellet = -1;
      }
    }
    expect(perks).toEqual(['gold', 'slow', 'ghost']);
    expect(s.chain).toBeGreaterThanOrEqual(CHAIN_TIERS[2]);
  });

  it('a chain breaks after too many steps without a bite', () => {
    const s = createLevel(1, new Rng(2), 'classic');
    s.chain = 4;
    s.tier = 1;
    s.pellet = -1;
    s.gold = -1;
    let ended = false;
    for (let i = 0; i <= CHAIN_STEPS && !ended; i++) {
      turn(s, bfsMove(s));
      ended = tick(s).chainEnd;
    }
    expect(ended).toBe(true);
    expect(s.chain).toBe(0);
  });

  it('slow motion slows the steps; a ghost slips through inner walls and squashes beetles', () => {
    const a = createLevel(3, new Rng(1), 'classic');
    const b = createLevel(3, new Rng(1), 'classic');
    grant(b, 'slow');
    step(a, 1);
    step(b, 1);
    expect(b.steps).toBeLessThan(a.steps);

    const s = createLevel(3, new Rng(1), 'beetles');
    grant(s, 'ghost');
    expect(s.ghost).toBe(GHOST_STEPS);
    const head = s.body[0];
    s.walls[head + 1] = true;
    s.beetles = [{ at: head + 2, dir: 0 }];
    s.pellet = -1;
    expect(tick(s).dead).toBe(false);
    const ev = tick(s);
    expect(ev.dead).toBe(false);
    expect(ev.squashed).toBe(head + 2);
    expect(s.beetles.length).toBe(0);
  });
});

describe('snake card', () => {
  it('names the kind of map on the start gate', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const m = mountGame(snake, 4, seed);
      expect(m.variant).not.toBeNull();
      const v = m.variant!;
      seen.add(v.id);
      expect(v.name.length).toBeLessThanOrEqual(18);
      expect((v.blurb ?? '').length).toBeLessThanOrEqual(60);
      m.inst.destroy?.();
      m.root.remove();
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
});
