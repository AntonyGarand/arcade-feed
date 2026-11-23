import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import type { Dir } from '../src/kits/gesture/gesture';
import { crates } from '../src/games/crates';
import {
  cratesFor,
  createLevel,
  minPushesFor,
  move,
  onGoal,
  pathTo,
  restart,
  sizeFor,
  slackFor,
  solve,
  undo,
  walk,
  type State,
} from '../src/games/crates/rules';
import { mountGame } from './support/mount';

const KEYS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
const back = (d: Dir) => ((d + 2) % 4) as Dir;

/** A direction the keeper can step in without pushing anything, or -1 if boxed in. */
function freeDir(s: State): Dir | -1 {
  const d = ([0, 1, 2, 3] as Dir[]).find((k) => {
    const to = s.player + (k === 1 ? 1 : k === 3 ? -1 : k === 2 ? s.n : -s.n);
    return !s.wall[to] && !s.crates.includes(to);
  });
  return d ?? -1;
}

/**
 * Play the shortest solution, wasting `extra` moves along the way (a step out and back wherever there
 * is room, so the plan still holds). Returns the state and how the run ended.
 */
function autopilot(d: Difficulty, seed: number, extra = 0) {
  const s = createLevel(d, new Rng(seed));
  let won = false;
  let waste = extra;
  for (const dir of s.solution) {
    const free = freeDir(s);
    if (free !== -1)
      for (; waste > 0 && !s.done; waste -= 2) {
        move(s, free);
        move(s, back(free));
      }
    if (s.done) break;
    won = move(s, dir).won;
  }
  return { s, won };
}

describe('crates rules', () => {
  it('deals the same warehouse from the same seed', () => {
    const a = createLevel(4, new Rng(8));
    const b = createLevel(4, new Rng(8));
    const c = createLevel(4, new Rng(9));
    expect(a.wall).toEqual(b.wall);
    expect(a.crates).toEqual(b.crates);
    expect(a.player).toBe(b.player);
    expect([a.wall, a.crates, a.player]).not.toEqual([c.wall, c.crates, c.player]);
  });

  it('gets harder: bigger rooms, more crates, longer solutions, less slack', () => {
    const avg = (d: Difficulty) => [1, 2, 3, 4, 5, 6].reduce((t, seed) => t + createLevel(d, new Rng(seed)).best, 0) / 6;
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(sizeFor(d)).toBeGreaterThanOrEqual(sizeFor(lo));
      expect(cratesFor(d)).toBeGreaterThanOrEqual(cratesFor(lo));
      expect(minPushesFor(d)).toBeGreaterThan(minPushesFor(lo));
      expect(slackFor(d)).toBeLessThan(slackFor(lo));
    }
    expect(avg(5)).toBeGreaterThan(avg(1) * 1.8);
  });

  it('deals solvable, non-trivial levels with the shortest solution setting the move limit', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 6; seed++) {
        const s = createLevel(d, new Rng(seed * 17));
        expect(s.crates.length).toBe(cratesFor(d));
        expect(onGoal(s), `${d}/${seed}`).toBe(0);
        expect(s.pushes).toBeGreaterThanOrEqual(minPushesFor(d));
        expect(s.limit).toBe(s.best + slackFor(d));
        expect(solve(s.n, s.wall, s.goal, s.crates, s.player)?.length).toBe(s.best);
      }
  });

  it('is cleared by the shortest plan with three stars, two with a few wasted moves, and lost past the slack', () => {
    for (const d of LEVELS)
      for (const seed of [3, 4, 5]) {
        const best = autopilot(d, seed);
        expect(best.won, `${d}/${seed}`).toBe(true);
        expect(best.s.moves).toBe(best.s.best);
        expect(starsFor(crates, d, true, best.s.score)).toBe(3);
        const sloppy = autopilot(d, seed, 4);
        expect(sloppy.won).toBe(true);
        expect(starsFor(crates, d, true, sloppy.s.score)).toBe(2);
        const lost = autopilot(d, seed, slackFor(d) + 2);
        expect(lost.won).toBe(false);
        expect(lost.s.done).toBe(true);
      }
  });

  it('pushes but never pulls, and one crate at a time', () => {
    const s = createLevel(2, new Rng(6));
    // Stand next to a crate and walk away from it: it stays.
    const crate = s.crates[0];
    s.crates = [crate, -100];
    const off = (k: Dir) => (k === 1 ? 1 : k === 3 ? -1 : k === 2 ? s.n : -s.n);
    // A side with room behind the keeper and in front of the crate.
    const k = ([0, 1, 2, 3] as Dir[]).find((d) => !s.wall[crate - off(d)] && !s.wall[crate - 2 * off(d)] && !s.wall[crate + off(d)])!;
    expect(k).toBeDefined();
    const at = crate - off(k);
    s.player = at;
    move(s, back(k));
    expect(s.crates[0]).toBe(crate);
    move(s, k);
    expect(s.player).toBe(at);
    // A second crate right behind the first blocks the push.
    s.crates[1] = crate + (crate - at);
    expect(move(s, k).moved).toBe(false);
    s.crates[1] = -100;
    expect(move(s, k).pushed).toBe(true);
    expect(s.crates[0]).toBe(crate + (crate - at));
  });

  it('undoes for free, restarts, and walks around crates to a tapped cell', () => {
    // A seed where the keeper starts with room to walk.
    let seed = 1;
    while (freeDir(createLevel(3, new Rng(seed))) === -1) seed++;
    const s = createLevel(3, new Rng(seed));
    const start = { player: s.player, crates: [...s.crates] };
    for (const d of s.solution.slice(0, 4)) move(s, d);
    expect(s.moves).toBe(4);
    expect(undo(s)).toBe(true);
    expect(s.moves).toBe(3);
    expect(restart(s)).toBe(true);
    expect(s.moves).toBe(0);
    expect({ player: s.player, crates: s.crates }).toEqual(start);
    expect(undo(s)).toBe(true); // undo the restart
    expect(s.moves).toBe(3);
    restart(s);
    const far = s.wall.findLastIndex((w, i) => !w && !s.crates.includes(i) && pathTo(s, i)?.length);
    const path = pathTo(s, far)!;
    expect(path.length).toBeGreaterThan(0);
    const before = [...s.crates];
    walk(s, path);
    expect(s.player).toBe(far);
    expect(s.crates).toEqual(before);
    expect(s.moves).toBe(path.length);
    undo(s);
    expect(s.player).toBe(start.player);
    expect(pathTo(s, s.crates[0])).toBe(null);
  });
});

describe('crates card', () => {
  const key = (k: string) => new KeyboardEvent('keydown', { key: k });

  for (const d of [1, 5] as const)
    it(`solves level ${d} with the keyboard for three stars`, () => {
      const m = mountGame(crates, d, 33);
      const s = createLevel(d, new Rng(33));
      expect(m.status).toMatch(/moves left/);
      m.run(3);
      expect(m.outcome).toBe('');
      // A wasted step, taken back with U: free.
      const dir = freeDir(s);
      expect(dir).not.toBe(-1);
      m.inst.onKey!(key(KEYS[dir]));
      expect(m.status).toContain(`${s.limit - 1} moves left`);
      expect(m.inst.onKey!(key('u'))).toBe(true);
      expect(m.status).toContain(`${s.limit} moves left`);
      for (const k of s.solution) {
        m.inst.onKey!(key(KEYS[k]));
        m.run(0.05);
      }
      expect(m.outcome).toBe('win');
      expect(starsFor(crates, d, true, m.score)).toBe(3);
      m.inst.destroy?.();
      m.root.remove();
    });

  it('loses when the moves run out', () => {
    const m = mountGame(crates, 2, 4);
    const s = createLevel(2, new Rng(4));
    const dir = freeDir(s);
    expect(dir).not.toBe(-1);
    for (let k = 0; k < s.limit && !m.outcome; k++) m.inst.onKey!(key(KEYS[k % 2 ? back(dir as Dir) : dir]));
    expect(m.outcome).toBe('lose');
    expect(m.inst.onKey!(key('x'))).toBe(false);
    m.inst.destroy?.();
    m.root.remove();
  });
});
