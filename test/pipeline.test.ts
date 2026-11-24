import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { _setLocaleForTests } from '../src/core/i18n';
import { LEVELS, starsFor, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import type { Dir } from '../src/kits/gesture/gesture';
import { pipeline } from '../src/games/pipeline';
import { KIND_NAMES } from '../src/games/pipeline/names';
import {
  accepts,
  blocksFor,
  CHAIN_TIERS,
  COIN_POINTS,
  COLS,
  countdownFor,
  createLevel,
  CROSS_BONUS,
  DL,
  EARLY_POINTS,
  exitOf,
  coinsFor,
  flowNow,
  FREEZE_S,
  goalFor,
  H,
  KINDS,
  LU,
  neighbour,
  openEnd,
  opens,
  opp,
  perPieceFor,
  place,
  perfectPiece,
  PIPE_POINTS,
  QUEUE,
  RD,
  REPLACE_POINTS,
  RES_COUNT,
  ROWS,
  step,
  UNUSED_POINTS,
  V,
  X,
  type KindId,
  type State,
} from '../src/games/pipeline/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;
const N = COLS * ROWS;

const empty = (s: State, cell: number) => cell >= 0 && !s.block[cell] && cell !== s.source && cell !== s.drain && !s.pipe[cell];

interface Slot {
  cell: number;
  from: Dir;
  /** Side the route leaves by (-1 for the last cell: anything that takes the flow in will do). */
  to: Dir | -1;
}

/**
 * A route of `len` cells from the open end, through empty cells and dry pieces that already fit it,
 * preferring straight runs (straights come up most).
 */
function plan(s: State, end: { cell: number; from: Dir }, len: number, flip = false): Slot[] {
  const route: Slot[] = [];
  const used = new Set<number>();
  let budget = 0;
  let want = len;
  const usable = (c: number) => c >= 0 && !s.block[c] && c !== s.source && c !== s.drain && !s.wet[c] && !used.has(c);
  const dfs = (cell: number, from: Dir): boolean => {
    const p = s.pipe[cell];
    if (p && !accepts(s, cell, from)) return false;
    route.push({ cell, from, to: -1 });
    used.add(cell);
    if (route.length >= want) return true;
    const ahead = opp(from);
    for (const to of p ? [exitOf(p, from)] : ([ahead, (ahead + (flip ? 3 : 1)) % 4, (ahead + (flip ? 1 : 3)) % 4] as Dir[])) {
      if (--budget < 0) break;
      const nb = neighbour(cell, to);
      if (!usable(nb)) continue;
      route[route.length - 1].to = to;
      if (dfs(nb, opp(to))) return true;
    }
    route.pop();
    used.delete(cell);
    return false;
  };
  // The longest route found within the search budget.
  for (; want > 0; want--) {
    budget = 20000;
    if (dfs(end.cell, end.from)) return route;
  }
  return [];
}

const fitsSlot = (p: number, slot: Slot) => opens(p, slot.from) === 1 && (slot.to === -1 || exitOf(p, slot.from) === slot.to);

/**
 * Play like a steady human: one tap every `every` seconds. Plan a route from the open end, lay the
 * head piece on the first route cell it fits (in order, so the flow never catches up with a gap if it
 * can help it), else dump it on a spare cell off the route (or cover an earlier dump). Once the chain is
 * a little past the goal, start and speed up the flow.
 */
function autopilot(d: Difficulty, seed: number, every = 0.6, extra = 2, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  const unlocked: string[] = [];
  const target = s.goal + extra;
  const dumps: number[] = [];
  let route: Slot[] = [];
  let lastEnd = -1;
  let stall = 0;
  let flip = false;
  let wait = every;
  let t = 0;
  for (; t < 600 && !s.done; t += DT) {
    step(s, DT);
    wait -= DT;
    if (wait > 0 || s.done) continue;
    wait = every;
    const end = openEnd(s);
    if (!end || end.length >= target) {
      flowNow(s);
      continue;
    }
    // Replan when the chain's open end left the route, or turn the other way when it stalls.
    stall = end.cell === lastEnd ? stall + 1 : 0;
    lastEnd = end.cell;
    const k = route.findIndex((r) => r.cell === end.cell && r.from === end.from);
    if (stall > 0 && stall % 4 === 0) flip = !flip;
    route =
      k >= 0 && route.length - k >= target - end.length && !(stall > 0 && stall % 4 === 0)
        ? route.slice(k)
        : plan(s, end, target - end.length + 6, flip);
    const piece = s.queue[0];
    // The open end first, if the piece leaves a route on; then any route cell it fits.
    let cell = -1;
    if (opens(piece, end.from)) {
      s.pipe[end.cell] = piece;
      const alt = plan(s, end, target - end.length, flip);
      s.pipe[end.cell] = 0;
      if (alt.length >= target - end.length) [cell, route] = [end.cell, alt];
    }
    if (cell < 0) cell = route.find((r) => !s.pipe[r.cell] && fitsSlot(piece, r))?.cell ?? -1;
    if (cell < 0) {
      const onRoute = new Set(route.map((r) => r.cell));
      const far = (c: number) => Math.abs((c % COLS) - (end.cell % COLS)) + Math.abs(Math.floor(c / COLS) - Math.floor(end.cell / COLS));
      let best = -1;
      let bestScore = -Infinity;
      for (let c = 0; c < N; c++) {
        if (!empty(s, c) || onRoute.has(c) || far(c) < 3) continue;
        let open = 0;
        for (let j = 0; j < 4; j++) open += Number(empty(s, neighbour(c, j as Dir)) && !onRoute.has(neighbour(c, j as Dir)));
        const score = far(c) - open * 2;
        if (score > bestScore) [best, bestScore] = [c, score];
      }
      if (best >= 0) dumps.push(best);
      cell = best >= 0 ? best : (dumps.find((c) => !s.wet[c] && !onRoute.has(c)) ?? end.cell);
    }
    if (place(s, cell) === 'wait') wait = 0;
    if (s.unlocked) unlocked.push(s.unlocked);
  }
  return { s, t, unlocked };
}

describe('pipeline rules', () => {
  it('deals the same board and queue from the same seed', () => {
    const a = createLevel(4, new Rng(8));
    const b = createLevel(4, new Rng(8));
    const c = createLevel(4, new Rng(9));
    const layout = (s: State) => [s.kind, s.block, s.source, s.srcDir, s.drain, s.drainDir, s.queue, s.pipe, s.oneway, s.coin];
    expect(layout(a)).toEqual(layout(b));
    expect(layout(a)).not.toEqual(layout(c));
    expect(a.queue.length).toBe(QUEUE);
    expect(createLevel(4, new Rng(8), 'classic').block.filter(Boolean).length).toBe(blocksFor(4));
  });

  it('gets harder: longer goal, shorter countdown, faster flow, more blocked cells', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(goalFor(d)).toBeGreaterThan(goalFor(lo));
      expect(countdownFor(d)).toBeLessThan(countdownFor(lo));
      expect(perPieceFor(d)).toBeLessThan(perPieceFor(lo));
      expect(blocksFor(d)).toBeGreaterThan(blocksFor(lo));
    }
    expect(countdownFor(5)).toBeGreaterThanOrEqual(8);
    expect(createLevel(1, new Rng(1)).drain).toBe(-1);
    expect(createLevel(3, new Rng(1)).drain).toBeGreaterThanOrEqual(0);
  });

  it('lays the head of the queue; replacing a dry piece costs points and a delay; wet pieces stay', () => {
    const s = createLevel(1, new Rng(3), 'classic');
    const cell = neighbour(s.source, s.srcDir);
    const [first, second] = s.queue;
    s.score = 100;
    expect(place(s, cell)).toBe('placed');
    expect(s.pipe[cell]).toBe(first);
    expect(s.queue[0]).toBe(second);
    expect(s.queue.length).toBe(QUEUE);
    expect(place(s, cell)).toBe('replaced');
    expect(s.pipe[cell]).toBe(second);
    expect(s.score).toBe(100 - REPLACE_POINTS);
    const other = [...Array(N).keys()].find((c) => c !== cell && empty(s, c))!;
    expect(place(s, other)).toBe('wait');
    expect(place(s, s.source)).toBe('no');
    s.wet[cell] = 3;
    s.cool = 0;
    expect(place(s, cell)).toBe('no');
  });

  it('flows through matching pieces, pays a bonus for crossing a cross twice, and spills at an open end', () => {
    const s = createLevel(1, new Rng(1), 'classic');
    const at = (r: number, c: number) => r * COLS + c;
    s.block.fill(false);
    s.coin.fill(false);
    s.source = at(3, 1);
    s.srcDir = 1;
    s.flow = { at: s.source, from: -1, exit: 1, t: 0 };
    // A loop through a cross: right, up, left, down through the cross again, then down to a dead end.
    s.pipe[at(3, 2)] = X;
    s.pipe[at(3, 3)] = LU;
    s.pipe[at(2, 3)] = DL;
    s.pipe[at(2, 2)] = RD;
    s.pipe[at(4, 2)] = V;
    s.pipe[at(0, 0)] = H; // never reached: costs points at the end
    flowNow(s);
    let cross = 0;
    for (let i = 0; i < 2000 && !s.done; i++) cross += Number(step(s, 0.05).cross);
    expect(s.count).toBe(6);
    expect(s.crosses).toBe(1);
    expect(cross).toBe(1);
    expect(s.done).toBe('lose'); // the goal is 8
    expect(s.score).toBe(Math.floor(countdownFor(1)) * EARLY_POINTS + 6 * PIPE_POINTS + CROSS_BONUS - UNUSED_POINTS);
  });

  it('waits for the countdown, and pays for starting early', () => {
    const s = createLevel(2, new Rng(2), 'classic');
    for (let t = 0; t < countdownFor(2) - 0.5; t += DT) step(s, DT);
    expect(s.started).toBe(false);
    const e = createLevel(2, new Rng(2), 'classic');
    for (let t = 0; t < 6.5; t += DT) step(e, DT);
    flowNow(e);
    expect(e.started).toBe(true);
    expect(e.score).toBe((countdownFor(2) - 7) * EARLY_POINTS);
  });

  it('finds the open end of the chain from the source', () => {
    const s = createLevel(1, new Rng(4), 'classic');
    const first = neighbour(s.source, s.srcDir);
    expect(openEnd(s)).toEqual({ cell: first, from: (s.srcDir + 2) % 4, length: 0 });
    s.pipe[first] = s.srcDir % 2 ? H : V;
    expect(openEnd(s)?.length).toBe(1);
    s.pipe[first] = s.srcDir % 2 ? V : H; // doesn't fit
    expect(openEnd(s)).toBeNull();
  });

  it('can be cleared at every level by a steady player, for several seeds', () => {
    for (const d of LEVELS)
      for (let seed = 1; seed <= 8; seed++) {
        const { s } = autopilot(d, seed * 7 + d, 0.5);
        expect(s.done, `level ${d} seed ${seed * 7 + d}: ${s.count}/${s.goal}`).toBe('win');
        expect(s.count).toBeGreaterThanOrEqual(goalFor(d));
      }
  });

  it('reaches every star goal on a clean run, and gives a single star for a scrape', () => {
    for (const d of LEVELS) {
      const best = Math.max(...[1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 11 + d, 0.35, 8).s.score));
      expect(starsFor(pipeline, d, true, best), `level ${d}: ${best}`).toBe(3);
      expect(starsFor(pipeline, d, true, goalFor(d) * PIPE_POINTS)).toBe(1);
    }
  });

  it('is lost when nothing is laid, or the chain is too short', () => {
    for (const d of LEVELS) {
      const s = createLevel(d, new Rng(d));
      for (let t = 0; t < 60 && !s.done; t += DT) step(s, DT);
      expect(s.done).toBe('lose');
      expect(s.count).toBe(0);
    }
    const s = createLevel(1, new Rng(5), 'classic');
    const first = neighbour(s.source, s.srcDir);
    s.pipe[first] = s.srcDir % 2 ? H : V;
    for (let t = 0; t < 60 && !s.done; t += DT) step(s, DT);
    expect(s.done).toBe('lose');
    expect(s.count).toBe(1);
  });
});

describe('pipeline level kinds', () => {
  it('deals different kinds across seeds, gated by level', () => {
    for (const d of LEVELS) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 80; seed++) seen.add(createLevel(d, new Rng(seed)).kind);
      expect(seen.size, `level ${d}`).toBe(kindsAt(d, KINDS).length);
    }
    for (let seed = 0; seed < 30; seed++) expect(['classic', 'reservoir']).toContain(createLevel(1, new Rng(seed)).kind);
  });

  it('names every kind briefly, in both languages', () => {
    for (const loc of ['en', 'fr'] as const) {
      _setLocaleForTests(loc);
      for (const { id } of KINDS) {
        const [name, blurb] = KIND_NAMES[id]();
        expect(name.length, id).toBeLessThanOrEqual(18);
        expect(blurb.length, id).toBeLessThanOrEqual(60);
      }
    }
    _setLocaleForTests('en');
  });

  it('can clear every kind allowed at every level, steadily, and three-star it on a good run', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const runs = [1, 2, 3, 4, 5].map((k) => autopilot(d, k * 13 + d, 0.5, 2, id));
        const wins = runs.filter((r) => r.s.done === 'win');
        expect(wins.length, `${id} level ${d}`).toBeGreaterThanOrEqual(4);
        const best = Math.max(...[1, 2, 3, 4, 5, 6].map((k) => autopilot(d, k * 11 + d, 0.35, 8, id).s.score));
        expect(starsFor(pipeline, d, true, best), `${id} level ${d}: ${best}`).toBe(3);
      }
  });

  it('shapes each kind: fixed tanks or one-way pipes, walls, a long countdown and a fast flow', () => {
    const res = createLevel(2, new Rng(1), 'reservoir');
    expect(res.res.filter(Boolean).length).toBe(2);
    expect(res.fixed.filter(Boolean).length).toBe(2);
    const one = createLevel(4, new Rng(1), 'oneway');
    expect(one.oneway.filter((d) => d >= 0).length).toBe(3);
    const maze = createLevel(3, new Rng(1), 'maze');
    expect(maze.block.filter(Boolean).length).toBeGreaterThan(blocksFor(3));
    expect(maze.clock).toBeGreaterThan(countdownFor(3));
    const flood = createLevel(3, new Rng(1), 'flood');
    expect(flood.clock).toBeGreaterThan(countdownFor(3));
    expect(flood.per).toBeLessThan(perPieceFor(3));
    for (const { id } of KINDS) expect(createLevel(3, new Rng(2), id).coin.filter(Boolean).length).toBe(coinsFor(3));
  });

  it('fixed pieces can not be replaced; one-way pipes refuse the flow the wrong way', () => {
    const s = createLevel(4, new Rng(3), 'oneway');
    const cell = s.oneway.findIndex((d) => d >= 0);
    expect(place(s, cell)).toBe('no');
    const exit = s.oneway[cell] as Dir;
    expect(accepts(s, cell, opp(exit))).toBe(true);
    expect(accepts(s, cell, exit)).toBe(false);
  });

  it('a reservoir fills slowly and counts double; coins pay as the flow passes', () => {
    const s = createLevel(1, new Rng(1), 'classic');
    const at = (r: number, c: number) => r * COLS + c;
    s.block.fill(false);
    s.coin.fill(false);
    s.pipe.fill(0);
    s.source = at(3, 0);
    s.srcDir = 1;
    s.flow = { at: s.source, from: -1, exit: 1, t: 0 };
    s.pipe[at(3, 1)] = H;
    s.pipe[at(3, 2)] = H;
    s.res[at(3, 2)] = true;
    s.fixed[at(3, 2)] = true;
    s.pipe[at(3, 3)] = H;
    s.coin[at(3, 3)] = true;
    flowNow(s);
    const score = s.score;
    // Into the tank (it counts as two pipes), then out of it: that takes far longer than a pipe.
    let t = 0;
    for (; s.count < 1 + RES_COUNT; t += DT) step(s, DT);
    const into = t;
    for (; s.count < 2 + RES_COUNT; t += DT) step(s, DT);
    expect(t - into).toBeGreaterThan(s.per * 2);
    expect(s.score - score).toBe((2 + RES_COUNT) * PIPE_POINTS + COIN_POINTS);
  });
});

describe('pipeline chain combo', () => {
  /** Lay the perfect piece at the open end `n` times (forced to the head of the queue). */
  function chain(s: State, n: number) {
    const fired: string[] = [];
    for (let i = 0; i < n; i++) {
      const end = openEnd(s);
      s.queue[0] = perfectPiece(s);
      if (!end || !s.queue[0] || place(s, end.cell) !== 'placed') break;
      if (s.unlocked) fired.push(s.unlocked);
    }
    return fired;
  }

  it('counts pieces joined in a row and fires the milestones', () => {
    const s = createLevel(2, new Rng(4), 'classic');
    s.block.fill(false);
    const clock = s.countdown;
    expect(chain(s, CHAIN_TIERS[0])).toEqual(['freeze']);
    expect(s.countdown).toBe(clock + FREEZE_S); // before the flow: more time
    expect(chain(s, CHAIN_TIERS[1] - CHAIN_TIERS[0])).toEqual(['perfect']);
    // The perfect piece is now the head of the queue: it fits the open end.
    expect(opens(s.queue[0], openEnd(s)!.from)).toBe(1);
    expect(chain(s, CHAIN_TIERS[2] - CHAIN_TIERS[1])).toEqual(['double']);
    expect(s.double).toBe(true);
    expect(s.chain).toBe(CHAIN_TIERS[2]);
  });

  it('a piece off the chain breaks it', () => {
    const s = createLevel(2, new Rng(5), 'classic');
    s.block.fill(false);
    chain(s, 2);
    expect(s.chain).toBe(2);
    const end = openEnd(s)!;
    const far = [...Array(N).keys()].find(
      (c) => empty(s, c) && Math.abs((c % COLS) - (end.cell % COLS)) + Math.abs(Math.floor(c / COLS) - Math.floor(end.cell / COLS)) > 2,
    )!;
    place(s, far);
    expect(s.chain).toBe(0);
  });

  it('a freeze during the flow holds it still, and double points pay twice', () => {
    const s = createLevel(1, new Rng(6), 'classic');
    s.block.fill(false);
    s.coin.fill(false);
    chain(s, 2);
    flowNow(s);
    s.freeze = FREEZE_S;
    for (let t = 0; t < FREEZE_S - 0.1; t += DT) step(s, DT);
    expect(s.count).toBe(0);
    s.double = true;
    const before = s.score;
    while (s.count < 1) step(s, DT);
    expect(s.score - before).toBe(PIPE_POINTS * 2);
  });
});

describe('pipeline card', () => {
  it('runs a few seconds at every level without the flow starting', () => {
    for (const d of LEVELS) {
      const m = mountGame(pipeline, d, 3);
      m.run(3);
      expect(m.outcome).toBe('');
      expect(m.status).toMatch(/\d+ s/);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  it('lays a piece with Space and starts the flow early with F, then ends the run', () => {
    const m = mountGame(pipeline, 1, 5);
    expect(m.variant?.id).toBe(createLevel(1, new Rng(5)).kind);
    const key = (k: string) => m.inst.onKey?.(new KeyboardEvent('keydown', { key: k }));
    expect(key('ArrowRight')).toBe(true);
    expect(key(' ')).toBe(true);
    expect(key('f')).toBe(true);
    expect(m.score).toBeGreaterThan(0);
    m.run(60);
    expect(m.outcome).toBe('lose');
    m.inst.destroy?.();
    m.root.remove();
  });
});
