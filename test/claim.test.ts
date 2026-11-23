import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import type { Dir } from '../src/kits/gesture/gesture';
import {
  CLAIMED,
  COLS,
  createLevel,
  crawlersFor,
  goalFor,
  idx,
  isEdge,
  LIVES,
  next,
  OPEN,
  percent,
  ROWS,
  sparksFor,
  sparkSpeedFor,
  starGoals,
  START,
  step,
  stop,
  TRAIL,
  turn,
  type State,
  WALL,
} from '../src/games/claim/rules';

const DT = 1 / 60;
const DIRS: Dir[] = [0, 1, 2, 3];

type Plan =
  | { kind: 'bite'; d: Dir; depth: number; l: Dir; width: number }
  | { kind: 'walk'; w: Dir; k: number }
  | { kind: 'wait'; t: number };
type Result = 'ok' | 'hit' | 'won' | 'fail';

/** Play one plan on `s` (mutates it): a rectangular bite, a walk along the edge, or a short wait. */
function execute(s: State, p: Plan): Result {
  const t0 = s.time;
  const s0 = s.steps;
  if (p.kind === 'bite') turn(s, p.d);
  let leg = 0;
  let legAt = s.steps;
  for (let f = 0; f < 60 * 12; f++) {
    if (p.kind === 'walk') {
      const j = next(s.pos, p.w);
      if (s.steps - s0 >= p.k || j < 0 || s.grid[j] === OPEN || (s.dir < 0 && s.steps > s0)) {
        stop(s);
        return 'ok';
      }
      if (s.dir < 0) turn(s, p.w);
    } else if (p.kind === 'wait' && s.time - t0 >= p.t) return 'ok';
    const ev = step(s, DT);
    if (ev.won) return 'won';
    if (ev.lostLife) return 'hit';
    if (ev.fresh.length) return 'ok';
    if (p.kind === 'bite' && s.steps - legAt >= (leg === 0 ? p.depth : p.width) && leg < 2) {
      leg++;
      legAt = s.steps;
      turn(s, leg === 1 ? p.l : (((p.d + 2) % 4) as Dir));
    }
  }
  return 'fail';
}

const trial = (s: State, p: Plan) => {
  const c = structuredClone(s);
  return { r: execute(c, p), c };
};

function bites(s: State): Plan[] {
  const out: Plan[] = [];
  for (const d of DIRS) {
    if (s.grid[next(s.pos, d)] !== OPEN) continue;
    for (const depth of [16, 10, 6, 3])
      for (const width of [16, 10, 6, 3])
        for (const l of [(d + 1) % 4, (d + 3) % 4] as Dir[]) out.push({ kind: 'bite', d, depth, l, width });
  }
  return out.sort((a, b) => (b.kind === 'bite' && a.kind === 'bite' ? b.depth * b.width - a.depth * a.width : 0));
}

/** The first bite from here that a dry run proves safe. */
function safeBite(s: State): Plan | null {
  for (const p of bites(s)) {
    const { r } = trial(s, p);
    if (r === 'ok' || r === 'won') return p;
  }
  return null;
}

/** Choose the next move by trying it on a copy first (the rules are deterministic). */
function decide(s: State, turnNo: number): Plan {
  const bite = safeBite(s);
  if (bite) return bite;
  const walks: Plan[] = [];
  for (const k of [4, 10, 20])
    for (const w of turnNo % 2 ? DIRS : [...DIRS].reverse()) if (isEdge(s, next(s.pos, w))) walks.push({ kind: 'walk', w, k });
  let fallback: Plan = { kind: 'wait', t: 0.25 };
  let found = false;
  for (const p of walks) {
    const { r, c } = trial(s, p);
    if (r !== 'ok' || c.pos === s.pos) continue;
    if (!found) {
      fallback = p;
      found = true;
    }
    if (safeBite(c)) return p;
  }
  if (found) return fallback;
  return { kind: 'wait', t: 0.25 };
}

function autopilot(d: Difficulty, seed: number, seconds = 400) {
  const s = createLevel(d, new Rng(seed));
  let lost = 0;
  for (let n = 0; s.time < seconds && !s.won && !s.over; n++) {
    const r = execute(s, decide(s, n));
    if (r === 'hit') lost++;
  }
  return { s, lost };
}

describe('claim rules', () => {
  it('deals the same field and enemies from the same seed', () => {
    const a = createLevel(5, new Rng(21));
    const b = createLevel(5, new Rng(21));
    expect(a.grid).toEqual(b.grid);
    expect(a.sparks).toEqual(b.sparks);
    expect(a.crawlers).toEqual(b.crawlers);
    expect(autopilot(3, 21).s.time).toBe(autopilot(3, 21).s.time);
  });

  it('gets harder: higher goal, more and faster enemies', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(goalFor(d)).toBeGreaterThan(goalFor(lo));
      expect(sparkSpeedFor(d)).toBeGreaterThan(sparkSpeedFor(lo));
      expect(sparksFor(d) + crawlersFor(d)).toBeGreaterThan(sparksFor(lo) + crawlersFor(lo));
    }
    const s = createLevel(5, new Rng(3));
    expect(s.sparks.length).toBe(3);
    expect(s.crawlers.length).toBe(2);
    expect(s.open0).toBeLessThan(createLevel(1, new Rng(3)).open0);
  });

  it('starts the marker on the edge, enemies far from it and every spark in the open', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createLevel(5, new Rng(seed));
      expect(s.pos).toBe(START);
      expect(isEdge(s, s.pos)).toBe(true);
      for (const k of s.sparks) expect(s.grid[idx(Math.floor(k.x), Math.floor(k.y))]).toBe(OPEN);
      for (const cr of s.crawlers) {
        expect(isEdge(s, cr.pos)).toBe(true);
        expect(Math.floor(cr.pos / COLS)).toBeLessThan(ROWS / 2);
      }
    }
  });

  it('is harmless when left alone for a while', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(7));
      for (let t = 0; t < 5; t += DT) expect(step(s, DT).lostLife, `level ${d}`).toBe(false);
    }
  });

  it('draws a trail into the open and claims the side with no spark when it closes', () => {
    const s = createLevel(1, new Rng(4));
    // Park the spark in the top-right corner so the bottom-left pocket is free.
    s.sparks[0] = { x: COLS - 3.5, y: 3.5, vx: 0, vy: 0 };
    s.pos = idx(1, ROWS - 1);
    turn(s, 0);
    for (let i = 0; i < 10; i++) step(s, 1 / 15);
    expect(s.drawing).toBe(true);
    expect(s.trail.length).toBe(10);
    expect(s.grid[s.trail[0]]).toBe(TRAIL);
    turn(s, 2); // straight back: ignored
    expect(s.dir).toBe(0);
    turn(s, 3); // left: closes on the left wall at once
    let ev = step(s, 1 / 15);
    expect(ev.fresh.length).toBe(10);
    expect(s.drawing).toBe(false);
    expect(s.grid[idx(1, ROWS - 2)]).toBe(CLAIMED);

    // A wider pocket: up 8, right 6, back down. The 6 × 7 inside is claimed with the trail.
    s.pos = idx(10, ROWS - 1);
    turn(s, 0);
    const go = (n: number) => {
      for (let i = 0; i < n; i++) ev = step(s, 1 / 15);
    };
    go(8);
    turn(s, 1);
    go(6);
    turn(s, 2);
    go(8);
    expect(ev.fresh.length).toBe(8 + 6 + 7 + 5 * 7);
    expect(ev.gain).toBeGreaterThan(0);
    for (let r = ROWS - 8; r < ROWS - 1; r++) for (let c = 10; c <= 16; c++) expect(s.grid[idx(c, r)]).toBe(CLAIMED);
    expect(s.grid[idx(17, ROWS - 2)]).toBe(OPEN);
    expect(percent(s)).toBeCloseTo(((10 + 56) / s.open0) * 100, 5);
  });

  it('never claims the side that holds a spark', () => {
    const s = createLevel(1, new Rng(5));
    s.sparks[0] = { x: 5.5, y: ROWS - 4.5, vx: 0, vy: 0 };
    // A full-height wall of trail at column 20: the spark's left side stays open, the right is claimed.
    s.pos = idx(20, ROWS - 1);
    turn(s, 0);
    let ev = step(s, 0);
    for (let i = 0; i < ROWS - 1 && !ev.fresh.length; i++) ev = step(s, 1 / 15);
    expect(ev.fresh.length).toBeGreaterThan(0);
    expect(s.grid[idx(5, ROWS - 5)]).toBe(OPEN);
    expect(s.grid[idx(10, 10)]).toBe(OPEN);
    expect(s.grid[idx(40, 10)]).toBe(CLAIMED);
    expect(s.grid[idx(0, 0)]).toBe(WALL);
  });

  it('moves along the edge and stops where it ends', () => {
    const s = createLevel(1, new Rng(6));
    turn(s, 3);
    for (let t = 0; t < 5; t += DT) step(s, DT);
    expect(s.pos).toBe(idx(0, ROWS - 1));
    expect(s.dir).toBe(-1);
    expect(s.drawing).toBe(false);
  });

  it('can be cleared at every level by a careful player, three stars for a clean fast run', () => {
    for (const d of LEVELS) {
      const [two, top] = starGoals(d);
      const runs = [1, 2, 3, 4].map((seed) => autopilot(d, seed * 13 + d));
      for (const { s, lost } of runs) {
        expect(s.won, `level ${d}`).toBe(true);
        expect(lost).toBeLessThan(LIVES);
        expect(percent(s)).toBeGreaterThanOrEqual(goalFor(d));
      }
      // A clean run earns at least two stars; most of these quick ones earn three.
      expect(runs.filter((r) => r.lost === 0 && r.s.score < two)).toEqual([]);
      expect(runs.filter((r) => r.s.score >= top).length, `level ${d}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('loses lives, then the run, when drawing straight into a spark', () => {
    for (const d of [1, 5] as Difficulty[]) {
      const s = createLevel(d, new Rng(9));
      let lost = 0;
      for (let t = 0; t < 120 && !s.over; t += DT) {
        const k = s.sparks[0];
        const dx = k.x - (s.pos % COLS) - 0.5;
        const dy = k.y - Math.floor(s.pos / COLS) - 0.5;
        if (!s.drawing && s.safe === 0) turn(s, 0);
        else if (s.drawing) turn(s, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
        if (step(s, DT).lostLife) lost++;
      }
      expect(s.over, `level ${d}`).toBe(true);
      expect(lost).toBe(LIVES);
      expect(s.lives).toBe(0);
    }
  });
});
