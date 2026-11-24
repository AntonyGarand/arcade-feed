import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { bubbles } from '../src/games/bubbles';
import {
  aimAt,
  BOMB,
  ceilingY,
  cellY,
  COLS,
  coloursFor,
  createLevel,
  everyFor,
  H,
  KINDS,
  land,
  LAUNCH,
  LINE_Y,
  MAX_AIM,
  POP_POINTS,
  present,
  RAINBOW,
  R,
  rowsFor,
  shoot,
  step,
  STONE,
  STREAK_TIERS,
  swapNext,
  trace,
  type KindId,
  type Landing,
  type State,
  W,
} from '../src/games/bubbles/rules';
import { mountGame, type Mounted } from './support/mount';

const fan = (n: number) => Array.from({ length: n }, (_, k) => ((2 * k) / (n - 1) - 1) * MAX_AIM);
const FINE = fan(61);
const COARSE = fan(13);

/** Score a shot on a copy of the board: pops and falls first, else a spot next to its colour, high up. */
function rate(s: State, aim: number): number {
  const c: State = { ...s, grid: [...s.grid], ice: [...s.ice], rng: new Rng(1) };
  const t = trace(c, aim);
  const ev = land(c, t.cell);
  if (ev.won) return 1e6;
  if (ev.lost) return -1e6;
  if (ev.popped.length || ev.booms.length) return 100 + ev.popped.length * 10 + (ev.dropped.length + ev.blasted.length) * 14;
  const same = [
    t.cell - 1,
    t.cell + 1,
    t.cell - COLS,
    t.cell - COLS - 1,
    t.cell - COLS + 1,
    t.cell + COLS - 1,
    t.cell + COLS,
    t.cell + COLS + 1,
  ];
  return same.filter((j) => j >= 0 && c.grid[j] === ev.colour).length * 3 - Math.floor(t.cell / COLS) * 0.5;
}

/** Plays shot after shot through the pure rules: `aims` is the angles tried, `swaps` lets it use the next bubble. */
function autopilot(d: Difficulty, seed: number, aims = FINE, swaps = true, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const shots: { aim: number; swap: boolean }[] = [];
  for (let n = 0; n < 300; n++) {
    let best = -Infinity;
    let pick = { aim: 0, swap: false };
    for (const swap of swaps ? [false, true] : [false]) {
      if (swap) swapNext(s);
      for (const aim of aims) {
        const v = rate(s, aim);
        if (v > best) [best, pick] = [v, { aim, swap }];
      }
      if (swap) swapNext(s);
    }
    shots.push(pick);
    if (pick.swap) swapNext(s);
    s.aim = pick.aim;
    shoot(s);
    let ev: Landing | null = null;
    while (!ev) ev = step(s, 1 / 60);
    if (ev.won || ev.lost) return { s, win: ev.won, shots };
  }
  throw new Error('never ended');
}

describe('bubbles rules', () => {
  it('deals the same board and shots from the same seed', () => {
    expect(createLevel(3, new Rng(9)).grid).toEqual(createLevel(3, new Rng(9)).grid);
    expect(createLevel(3, new Rng(9)).kind).toBe(createLevel(3, new Rng(9)).kind);
    expect(createLevel(3, new Rng(9)).ice).toEqual(createLevel(3, new Rng(9)).ice);
    expect(createLevel(3, new Rng(9)).grid).not.toEqual(createLevel(3, new Rng(10)).grid);
    expect(autopilot(2, 5).shots).toEqual(autopilot(2, 5).shots);
  });

  it('gets harder: more rows and colours, a ceiling that drops sooner', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(rowsFor(d)).toBeGreaterThan(rowsFor(lo));
      expect(coloursFor(d)).toBeGreaterThanOrEqual(coloursFor(lo));
      expect(everyFor(d)).toBeLessThanOrEqual(everyFor(lo));
    }
    expect(everyFor(5)).toBeLessThan(everyFor(1));
    const s = createLevel(5, new Rng(1));
    expect(present(s.grid)).toEqual([0, 1, 2, 3, 4].slice(0, coloursFor(5)));
    expect(s.grid.filter((k) => k >= 0).length).toBeGreaterThan(createLevel(1, new Rng(1)).grid.filter((k) => k >= 0).length);
    // Shots only come in colours still on the board.
    expect(present(s.grid)).toContain(s.cur);
    expect(present(s.grid)).toContain(s.next);
  });

  it('aims within the cone and bounces off the side walls', () => {
    const s = createLevel(1, new Rng(2));
    aimAt(s, LAUNCH.x - 500, LAUNCH.y);
    expect(s.aim).toBe(-MAX_AIM);
    aimAt(s, LAUNCH.x, 0);
    expect(s.aim).toBe(0);
    expect(trace(s, 0).pts.length).toBe(2); // straight up: no bounce
    const t = trace(s, 0.9);
    expect(t.pts.length).toBeGreaterThan(2);
    expect(t.pts[1].x).toBe(W - R); // the first bounce is on the right wall
    expect(t.cell).toBeGreaterThanOrEqual(0);
  });

  it('pops 3 of a kind and drops what hangs from them', () => {
    const s = createLevel(1, new Rng(3), 'classic');
    s.grid.fill(-1);
    s.ice.fill(false);
    // Row 0: two 0s at columns 4 and 5; row 1 (shifted right) hangs a 1 from them, and row 2 a 2.
    s.grid[4] = 0;
    s.grid[5] = 0;
    s.grid[COLS + 4] = 1;
    s.grid[2 * COLS + 4] = 2;
    s.grid[0] = 2; // something else stays, so the board isn't cleared
    s.cur = 0;
    // Land a 0 next to the pair, at row 0 column 6.
    const ev = land(s, 6);
    expect(ev.popped.sort((a, b) => a - b)).toEqual([4, 5, 6]);
    expect(ev.dropped.sort((a, b) => a - b)).toEqual([COLS + 4, 2 * COLS + 4]);
    expect(s.grid.filter((k) => k >= 0)).toEqual([2]);
    expect(s.score).toBeGreaterThan(0);
    // Only colours left on the board are loaded.
    expect(s.cur).toBe(2);
    expect(s.next).toBe(2);
  });

  it('lowers the ceiling every few shots, and is lost when a bubble crosses the line', () => {
    const s = createLevel(1, new Rng(4), 'classic');
    let ev: Landing | null = null;
    // Always shoot straight up: the pile grows down the middle until it crosses the line.
    for (let n = 0; n < 200 && !ev?.lost && !ev?.won; n++) {
      ev = land(s, trace(s, 0).cell);
      expect(ev.lowered).toBe((n + 1) % everyFor(1) === 0);
    }
    expect(ev?.lost).toBe(true);
    expect(s.drops).toBeGreaterThan(0);
    expect(s.grid.some((k, i) => k >= 0 && cellY(s, i) + R > LINE_Y)).toBe(true);
  });

  it('is cleared by a sharp autopilot at every level, with stars to match (and by a sloppy one)', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 7 + d));
      const sloppy = [1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 7 + d, COARSE, false));
      const won = runs.filter((r) => r.win);
      expect(won.length, `level ${d}`).toBeGreaterThanOrEqual(5);
      const stars = won.map((r) => starsFor(bubbles, d, true, r.s.score));
      expect(stars.filter((n) => n >= 2).length, `level ${d}`).toBeGreaterThanOrEqual(won.length / 2);
      // Coarse aim without swaps still clears, but never earns more three-star runs.
      const loose = sloppy.filter((r) => r.win).map((r) => starsFor(bubbles, d, true, r.s.score));
      expect(loose.length, `level ${d}`).toBeGreaterThanOrEqual(d === 1 ? 6 : 4);
      expect(loose.filter((n) => n === 3).length, `level ${d}`).toBeLessThanOrEqual(stars.filter((n) => n === 3).length);
    }
  });
});

describe('bubbles level kinds and pieces', () => {
  /** An empty level-3 board with one spare bubble in the corner, so landings never clear it. */
  const blank = () => {
    const s = createLevel(3, new Rng(1), 'classic');
    s.grid.fill(-1);
    s.ice.fill(false);
    s.grid[9] = 4;
    return s;
  };

  it('deals different kinds across seeds, each only from its level', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBeGreaterThanOrEqual(4);
    for (let seed = 0; seed < 30; seed++) expect(['classic', 'chandelier']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('deals each kind with its pieces, and a sharp autopilot clears every kind', () => {
    for (const d of [3, 5] as const)
      for (const { id } of kindsAt(d, KINDS)) {
        const s = createLevel(d, new Rng(5), id);
        const stones = s.grid.filter((k) => k === STONE).length;
        const bombs = s.grid.filter((k) => k === BOMB).length;
        expect(stones > 0, id).toBe(id === 'quarry');
        expect(s.ice.filter(Boolean).length > 5, id).toBe(id === 'glacier');
        expect(bombs >= 5, id).toBe(id === 'minefield');
        expect(s.grid.slice(0, COLS).filter((k) => k >= 0).length === 3, id).toBe(id === 'chandelier');
        // The top row is plain bubbles, so the board always hangs from something that pops.
        for (let c = 0; c < COLS; c++) expect(s.grid[c] < STONE, id).toBe(true);
        const wins = [1, 2, 3].filter((k) => autopilot(d, k * 11 + d, FINE, true, id).win).length;
        expect(wins, `${id} level ${d}`).toBeGreaterThanOrEqual(2);
      }
  });

  it('stones never pop, but fall when cut loose', () => {
    const s = blank();
    s.grid[3] = 1;
    s.grid[4] = 1;
    s.grid[COLS + 3] = STONE; // hangs from 3 and 4
    s.grid[7] = 4;
    s.grid[COLS + 6] = STONE; // hangs from 6 and 7
    s.cur = 1;
    const ev = land(s, 5);
    expect(ev.popped.sort((a, b) => a - b)).toEqual([3, 4, 5]);
    expect(ev.dropped).toEqual([COLS + 3]);
    expect(ev.droppedColours).toEqual([STONE]);
    expect(s.grid[COLS + 6]).toBe(STONE);
  });

  it('a bomb next to a popped group blows up its neighbours, stones included', () => {
    const s = blank();
    s.grid[3] = 2;
    s.grid[4] = 2;
    s.grid[6] = BOMB;
    s.grid[COLS + 6] = STONE;
    s.cur = 2;
    const ev = land(s, 5);
    expect(ev.popped.sort((a, b) => a - b)).toEqual([3, 4, 5]);
    expect(ev.booms).toEqual([6]);
    expect(ev.blasted).toContain(COLS + 6);
    expect(s.grid[6]).toBe(-1);
    expect(s.grid[COLS + 6]).toBe(-1);
  });

  it('frozen bubbles don’t match until a bubble lands next to them', () => {
    const s = blank();
    s.grid[3] = 1;
    s.grid[4] = 1;
    s.ice[4] = true;
    s.cur = 1;
    const ev = land(s, 5);
    expect(ev.popped).toEqual([]);
    expect(ev.melted).toEqual([4]);
    expect(s.ice[4]).toBe(false);
    s.cur = 1;
    expect(land(s, 2).popped.sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  /** Land `n` popping shots in a row, each on a fresh pair (special shots are used as loaded). */
  function streak(s: State, n: number): Landing[] {
    const out: Landing[] = [];
    for (let k = 0; k < n; k++) {
      s.grid.fill(-1);
      s.grid[9] = 4;
      s.grid[1] = 1;
      s.grid[2] = 1;
      if (s.cur < STONE) s.cur = 1;
      out.push(land(s, 3));
    }
    return out;
  }

  it('popping shots in a row reach milestones: a bomb shot, a ceiling lift, then a rainbow shot', () => {
    const s = blank();
    s.drops = 2;
    s.untilDrop = 99;
    const first = streak(s, STREAK_TIERS[0]).at(-1)!;
    expect(first.streak).toBe(STREAK_TIERS[0]);
    expect(first.tier).toBe(1);
    expect(first.reward).toBe('bomb');
    expect(s.cur).toBe(BOMB);
    // The bomb shot blows up where it lands, and keeps the streak going.
    s.grid[1] = 1;
    s.grid[2] = 1;
    const boom = land(s, 3);
    expect(boom.booms).toEqual([3]);
    expect(boom.blasted.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(boom.streak).toBe(STREAK_TIERS[0] + 1);
    const top = ceilingY(s);
    const lift = streak(s, STREAK_TIERS[1] - STREAK_TIERS[0] - 1).at(-1)!;
    expect(lift.reward).toBe('lift');
    expect(s.drops).toBe(1);
    expect(ceilingY(s)).toBeLessThan(top);
    const rainbow = streak(s, STREAK_TIERS[2] - STREAK_TIERS[1]).at(-1)!;
    expect(rainbow.reward).toBe('rainbow');
    expect(s.cur).toBe(RAINBOW);
    // A rainbow shot takes the colour of the group it touches, so it pops a pair of anything.
    s.grid.fill(-1);
    s.grid[9] = 4;
    s.grid[1] = 3;
    s.grid[2] = 3;
    const rb = land(s, 3);
    expect(rb.colour).toBe(3);
    expect(rb.popped.length).toBe(3);
  });

  it('points grow with the streak, and a shot that pops nothing ends it', () => {
    const s = blank();
    s.untilDrop = 99;
    const evs = streak(s, STREAK_TIERS[1]);
    expect(evs[0].gain).toBe(3 * POP_POINTS);
    expect(evs.at(-1)!.gain).toBe(3 * POP_POINTS * 2);
    expect(s.tier).toBe(2);
    const before = s.score;
    s.cur = 4;
    const miss = land(s, COLS + 5);
    expect(miss.streak).toBe(0);
    expect(s.tier).toBe(0);
    expect(s.score).toBe(before);
  });
});

describe('bubbles game', () => {
  const key = (m: Mounted, k: string, type = 'keydown') => m.inst.onKey?.(new KeyboardEvent(type, { key: k }));

  it('mounts at level 1 and 5, names its kind, and waits for the first shot', () => {
    for (const d of [1, 5] as const) {
      const m = mountGame(bubbles, d, 4);
      expect(m.variant?.id).toBe(createLevel(d, new Rng(4)).kind);
      expect(m.variant?.name.length).toBeLessThanOrEqual(18);
      expect(m.variant?.blurb?.length).toBeLessThanOrEqual(60);
      expect(m.status).toContain(String(everyFor(d)));
      m.run(5);
      expect(m.outcome).toBe('');
      expect(m.score).toBe(0);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('aims and shoots from the keyboard', () => {
    const m = mountGame(bubbles, 1, 4);
    key(m, 'ArrowLeft');
    m.run(0.3);
    key(m, 'ArrowLeft', 'keyup');
    key(m, ' ');
    m.run(1.5);
    expect(m.status).toContain(String(everyFor(1) - 1));
    m.inst.destroy?.();
    m.root.remove();
  });

  it('plays the autopilot’s shots by tapping, to a win', () => {
    for (const d of [1, 5] as const) {
      const seed = [1, 2, 3, 4].find((k) => autopilot(d, k).win)!;
      const { s, shots } = autopilot(d, seed);
      const m = mountGame(bubbles, d, seed);
      const canvas = m.root.querySelector('canvas')!;
      // The test DOM has no layout: client coordinates map to world units through a 1×1 box.
      const tap = (x: number, y: number) => {
        for (const type of ['pointerdown', 'pointerup'])
          canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x / W, clientY: y / H, bubbles: true }));
      };
      for (const shot of shots) {
        if (shot.swap) key(m, 'ArrowDown');
        tap(LAUNCH.x + Math.sin(shot.aim) * 200, LAUNCH.y - Math.cos(shot.aim) * 200);
        m.run(3);
      }
      expect(m.score).toBe(s.score);
      m.run(1);
      expect(m.outcome).toBe('win');
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
