import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';

/** Playfield in world units: anchors near the top, the critter waiting on the floor. */
export const W = 300;
export const H = 400;
export const SWEET_R = 10;
export const STAR_R = 9;
export const SPIKE_R = 11;
export const BUBBLE_R = 21;
/** Height of the critter's mouth, and how close the sweet must come to it. */
export const CRIT_Y = 350;
const CATCH = 22;
/** Links per rope in the drawn (Verlet) chain. */
export const LINKS = 8;
/** Frame rate the generator plays its plan at (the test replays it the same way). */
export const FPS = 60;
const SUB = 1 / 120;
const G = 640;
const LIFT = 320;
const AIR = 0.9995;
const FLOAT_DAMP = 0.96;
export const STAR_PTS = 100;
export const DELIVER_PTS = 50;
/** Quick-clear bonus: full within the plan's time plus a grace, then 5 points less per second. */
export const SPEED_PTS = 50;
const GRACE_S = 3;

export const ropesFor = (d: Difficulty) => byLevel(d, [2, 3, 3, 3, 4]);
const bubbleFor = (d: Difficulty) => byLevel(d, [false, false, true, false, true]);
export const spikesFor = (d: Difficulty) => byLevel(d, [0, 0, 0, 2, 3]);
/** Timing slack (frames, either way) every action of the plan must tolerate. */
export const tolFor = (d: Difficulty) => byLevel(d, [9, 7, 6, 5, 4]);

export interface Pt {
  x: number;
  y: number;
}

/** One step of a plan: wait `wait` frames after the previous action (or the start), then cut rope `rope` (−1: pop). */
export interface Action {
  wait: number;
  rope: number;
}

interface Anchor extends Pt {
  len: number;
}

/** Everything a level is dealt from. */
interface Layout {
  anchors: Anchor[];
  /** The sweet at rest under its ropes. */
  start: Pt;
  bubble: Pt | null;
  /** Critter's x (its mouth is at CRIT_Y), NaN until placed. */
  critter: number;
  stars: Pt[];
  spikes: Pt[];
  plan: Action[];
}

export interface Rope {
  ax: number;
  ay: number;
  len: number;
  cut: boolean;
  /** Link that was cut (the anchor keeps the links before it). */
  seg: number;
  /** Chain nodes (anchor first) and their previous positions. */
  nx: number[];
  ny: number[];
  ox: number[];
  oy: number[];
}

interface Bubble extends Pt {
  held: boolean;
  popped: boolean;
}

export interface State {
  d: Difficulty;
  ropes: Rope[];
  /** Sweet position and previous position (Verlet). */
  x: number;
  y: number;
  ox: number;
  oy: number;
  bubble: Bubble | null;
  stars: (Pt & { got: boolean })[];
  spikes: Pt[];
  critter: Pt | null;
  got: number;
  score: number;
  time: number;
  acc: number;
  phase: 'play' | 'won' | 'lost';
  why: '' | 'spike' | 'out';
  /** The generator's solution, and the time (s) a quick clear takes. */
  plan: Action[];
  par: number;
  /** Simulate the drawn chains (off in the generator). */
  chains: boolean;
}

export interface StepEvents {
  /** Stars picked up this step (indices). */
  stars: number[];
  captured: boolean;
  won: boolean;
  lost: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function build(l: Layout, chains: boolean): State {
  const ropes = l.anchors.map((a): Rope => {
    const nx: number[] = [];
    const ny: number[] = [];
    for (let i = 0; i <= LINKS; i++) {
      nx.push(a.x + ((l.start.x - a.x) * i) / LINKS);
      ny.push(a.y + ((l.start.y - a.y) * i) / LINKS);
    }
    return { ax: a.x, ay: a.y, len: a.len, cut: false, seg: -1, nx, ny, ox: nx.slice(), oy: ny.slice() };
  });
  const s: State = {
    d: 1,
    ropes,
    x: l.start.x,
    y: l.start.y,
    ox: l.start.x,
    oy: l.start.y,
    bubble: l.bubble ? { ...l.bubble, held: false, popped: false } : null,
    stars: l.stars.map((p) => ({ ...p, got: false })),
    spikes: l.spikes,
    critter: Number.isNaN(l.critter) ? null : { x: l.critter, y: CRIT_Y },
    got: 0,
    score: 0,
    time: 0,
    acc: 0,
    phase: 'play',
    why: '',
    plan: l.plan,
    par: l.plan.reduce((t, a) => t + a.wait, 0) / FPS + GRACE_S,
    chains,
  };
  // Let the chains sag into place before the first frame.
  if (chains) for (let i = 0; i < 90; i++) chainStep(s);
  return s;
}

/** Keep the sweet within reach of every rope still attached. */
function constrain(s: State) {
  for (let it = 0; it < 4; it++)
    for (const r of s.ropes) {
      if (r.cut) continue;
      const dx = s.x - r.ax;
      const dy = s.y - r.ay;
      const d = Math.hypot(dx, dy);
      if (d > r.len) {
        s.x = r.ax + (dx / d) * r.len;
        s.y = r.ay + (dy / d) * r.len;
      }
    }
}

/** One Verlet step of the drawn chains: pinned to the anchor, and to the sweet until cut. */
function chainStep(s: State) {
  for (const r of s.ropes) {
    const rest = r.len / LINKS;
    for (let i = 1; i <= LINKS; i++) {
      const vx = (r.nx[i] - r.ox[i]) * 0.98;
      const vy = (r.ny[i] - r.oy[i]) * 0.98;
      r.ox[i] = r.nx[i];
      r.oy[i] = r.ny[i];
      r.nx[i] += vx;
      r.ny[i] += vy + G * SUB * SUB;
    }
    for (let it = 0; it < 6; it++) {
      r.nx[0] = r.ax;
      r.ny[0] = r.ay;
      if (!r.cut) {
        r.nx[LINKS] = s.x;
        r.ny[LINKS] = s.y;
      }
      for (let i = 0; i < LINKS; i++) {
        if (r.cut && i === r.seg) continue;
        const dx = r.nx[i + 1] - r.nx[i];
        const dy = r.ny[i + 1] - r.ny[i];
        const d = Math.hypot(dx, dy);
        if (d <= rest || d === 0) continue;
        const a = i === 0 ? 0 : 1;
        const b = !r.cut && i + 1 === LINKS ? 0 : 1;
        if (!a && !b) continue;
        const k = (d - rest) / d / (a + b);
        r.nx[i] += dx * k * a;
        r.ny[i] += dy * k * a;
        r.nx[i + 1] -= dx * k * b;
        r.ny[i + 1] -= dy * k * b;
      }
    }
    r.nx[0] = r.ax;
    r.ny[0] = r.ay;
  }
}

function sub(s: State, ev: StepEvents) {
  const b = s.bubble && !s.bubble.popped ? s.bubble : null;
  const floating = !!b?.held;
  const k = floating ? FLOAT_DAMP : AIR;
  const vx = (s.x - s.ox) * k;
  const vy = (s.y - s.oy) * k;
  s.ox = s.x;
  s.oy = s.y;
  s.x += vx;
  s.y += vy + (floating ? -LIFT : G) * SUB * SUB;
  constrain(s);
  if (s.chains) chainStep(s);
  if (b) {
    if (b.held) {
      b.x = s.x;
      b.y = s.y;
    } else if (Math.hypot(s.x - b.x, s.y - b.y) < BUBBLE_R) {
      b.held = true;
      ev.captured = true;
      s.oy = s.y - (s.y - s.oy) * 0.3;
    }
  }
  for (const [i, st] of s.stars.entries())
    if (!st.got && Math.hypot(s.x - st.x, s.y - st.y) < STAR_R + SWEET_R) {
      st.got = true;
      s.got++;
      s.score += STAR_PTS;
      ev.stars.push(i);
    }
  for (const sp of s.spikes)
    if (Math.hypot(s.x - sp.x, s.y - sp.y) < SPIKE_R + SWEET_R - 2) {
      s.phase = 'lost';
      s.why = 'spike';
      ev.lost = true;
      return;
    }
  if (s.critter && Math.hypot(s.x - s.critter.x, s.y - s.critter.y) < CATCH) {
    s.phase = 'won';
    s.score += DELIVER_PTS + speedBonus(s);
    ev.won = true;
    return;
  }
  if (s.x < -2 * SWEET_R || s.x > W + 2 * SWEET_R || s.y > H + 2 * SWEET_R || s.y < -3 * SWEET_R) {
    s.phase = 'lost';
    s.why = 'out';
    ev.lost = true;
  }
}

const speedBonus = (s: State) => clamp(Math.round(SPEED_PTS - 5 * Math.max(0, s.time - s.par)), 0, SPEED_PTS);

/** Advance by `dt` seconds in fixed sub-steps (the same path at any frame rate). */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = { stars: [], captured: false, won: false, lost: false };
  if (s.phase !== 'play') return ev;
  s.time += dt;
  s.acc += dt;
  while (s.acc >= SUB - 1e-9 && s.phase === 'play') {
    s.acc -= SUB;
    sub(s, ev);
  }
  return ev;
}

/** Cut rope `i` (at link `seg`, the middle by default). */
export function cut(s: State, i: number, seg = LINKS / 2): boolean {
  const r = s.ropes[i];
  if (!r || r.cut || s.phase !== 'play') return false;
  r.cut = true;
  r.seg = clamp(Math.floor(seg), 0, LINKS - 1);
  return true;
}

/** Pop the bubble carrying the sweet. */
export function pop(s: State): boolean {
  const b = s.bubble;
  if (!b || b.popped || !b.held || s.phase !== 'play') return false;
  b.popped = true;
  return true;
}

/** Pop a bubble tapped at (x, y), carrying the sweet or not. */
export function popAt(s: State, x: number, y: number): boolean {
  const b = s.bubble;
  if (!b || b.popped || s.phase !== 'play' || Math.hypot(x - b.x, y - b.y) > BUBBLE_R + 8) return false;
  b.popped = true;
  return true;
}

export const act = (s: State, a: Action) => (a.rope < 0 ? pop(s) : cut(s, a.rope));

const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number => {
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (!den) return -1;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
};

/** A swipe from (x0, y0) to (x1, y1): cuts every rope it crosses. Returns the cuts and where they happened. */
export function swipe(s: State, x0: number, y0: number, x1: number, y1: number): (Pt & { rope: number })[] {
  const out: (Pt & { rope: number })[] = [];
  if (s.phase !== 'play') return out;
  for (const [i, r] of s.ropes.entries()) {
    if (r.cut) continue;
    for (let j = 0; j < LINKS; j++) {
      const t = cross(x0, y0, x1, y1, r.nx[j], r.ny[j], r.nx[j + 1], r.ny[j + 1]);
      if (t < 0) continue;
      cut(s, i, j);
      out.push({ rope: i, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
      break;
    }
  }
  return out;
}

/* ---------- Generator: deal a level, solve it, and build the level around the solution. ---------- */

interface Run {
  /** Sweet position after every frame, flattened (x, y). */
  path: number[];
  won: boolean;
  /** Frame each action happened on, and the frame the bubble caught the sweet (−1: never). */
  acts: number[];
  capture: number;
}

/** Play `plan` on a fresh copy of the layout, a frame at a time. */
function simulate(l: Layout, plan: Action[], max = 900): Run {
  const s = build(l, false);
  const run: Run = { path: [], won: false, acts: [], capture: -1 };
  let i = 0;
  let since = 0;
  for (let f = 0; f < max && s.phase === 'play'; f++) {
    while (i < plan.length && since >= plan[i].wait) {
      act(s, plan[i++]);
      run.acts.push(f);
      since = 0;
    }
    const ev = step(s, 1 / FPS);
    since++;
    run.path.push(s.x, s.y);
    if (ev.captured) run.capture = f;
  }
  run.won = s.phase === 'won';
  return run;
}

/** Let the sweet come to rest under its ropes. */
function settle(anchors: Anchor[], p: Pt): Pt {
  const s = build({ anchors, start: p, bubble: null, critter: NaN, stars: [], spikes: [], plan: [] }, false);
  for (let i = 0; i < 480; i++) {
    const vx = (s.x - s.ox) * 0.9;
    const vy = (s.y - s.oy) * 0.9;
    s.ox = s.x;
    s.oy = s.y;
    s.x += vx;
    s.y += vy + G * SUB * SUB;
    constrain(s);
  }
  return { x: s.x, y: s.y };
}

/** Anchors fanned out above a resting point, ropes nearly taut. */
function randomLayout(d: Difficulty, rng: Rng): Layout | null {
  const n = ropesFor(d);
  const p = { x: rng.int(100, 200), y: rng.int(115, 175) };
  const anchors: Anchor[] = [];
  const span = 1.35;
  for (let i = 0; i < n; i++) {
    const a = -span + ((i + 0.15 + rng.next() * 0.7) * 2 * span) / n;
    const dist = rng.int(55, 140);
    const x = Math.round(p.x + Math.sin(a) * dist);
    const y = Math.round(p.y - Math.cos(a) * dist);
    const len = Math.hypot(x - p.x, y - p.y) * (1 + rng.next() * 0.04);
    if (x < 14 || x > W - 14 || y < 14 || y + len > CRIT_Y - 50) return null;
    if (anchors.some((o) => Math.hypot(o.x - x, o.y - y) < 26)) return null;
    anchors.push({ x, y, len });
  }
  anchors.sort((a, b) => a.x - b.x);
  return { anchors, start: settle(anchors, p), bubble: null, critter: NaN, stars: [], spikes: [], plan: [] };
}

/** Where the sweet first falls through the critter's height after frame `from`. */
function landing(run: Run, from: number): number | null {
  for (let f = Math.max(1, from); f < run.path.length / 2; f++) {
    const y0 = run.path[f * 2 - 1];
    const y1 = run.path[f * 2 + 1];
    if (y0 < CRIT_Y && y1 >= CRIT_Y) {
      const x0 = run.path[f * 2 - 2];
      return x0 + ((run.path[f * 2] - x0) * (CRIT_Y - y0)) / (y1 - y0);
    }
  }
  return null;
}

/** Up to `n` points along the path from frame `from` to `to`, well apart from each other and from `avoid`. */
function alongPath(run: Run, from: number, to: number, n: number, avoid: Pt[]): Pt[] {
  const pts: Pt[] = [];
  const fracs = [0.3, 0.55, 0.8, 0.42, 0.68, 0.2, 0.9, 0.12];
  for (const f of fracs) {
    if (pts.length >= n) break;
    const i = Math.round(from + (to - from) * f);
    const p = { x: run.path[i * 2], y: run.path[i * 2 + 1] };
    if (p.x < 14 || p.x > W - 14 || p.y < 14) continue;
    if ([...pts, ...avoid].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 34)) continue;
    pts.push(p);
  }
  return pts.sort((a, b) => a.y - b.y);
}

/** Spikes off every tested path (so the solution clears them) but close enough to punish a wrong cut. */
function placeSpikes(rng: Rng, n: number, runs: Run[], avoid: Pt[]): Pt[] {
  const out: Pt[] = [];
  const clear = SPIKE_R + SWEET_R + 10;
  for (let t = 0; t < 120 && out.length < n; t++) {
    const p = { x: rng.int(24, W - 24), y: rng.int(70, CRIT_Y - 40) };
    let near = Infinity;
    let ok = true;
    for (const [k, r] of runs.entries())
      for (let i = 0; i < r.path.length && ok; i += 2) {
        const d = Math.hypot(r.path[i] - p.x, r.path[i + 1] - p.y);
        if (d < clear) ok = false;
        if (k === 0) near = Math.min(near, d);
      }
    if (!ok || near > 70) continue;
    if ([...out, ...avoid].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 40)) continue;
    out.push(p);
  }
  return out;
}

function generate(d: Difficulty, rng: Rng): Layout {
  for (let attempt = 0; ; attempt++) {
    const strict = attempt < 80;
    const tol = attempt < 40 ? tolFor(d) : attempt < 70 ? Math.ceil(tolFor(d) / 2) : 0;
    const l = randomLayout(d, rng);
    if (!l) continue;
    const plan: Action[] = rng.shuffle(l.anchors.map((_, i) => i)).map((rope, i) => ({ rope, wait: i ? rng.int(12, 80) : 30 }));
    let run = simulate(l, plan);
    const last = run.acts.at(-1) ?? 0;
    if (bubbleFor(d)) {
      const spots: number[] = [];
      for (let f = last + 8; f < last + 40 && f < run.path.length / 2; f++) {
        const x = run.path[f * 2];
        const y = run.path[f * 2 + 1];
        if (x > 50 && x < W - 50 && y > 110 && y < 260) spots.push(f);
      }
      if (!spots.length) continue;
      const f = rng.pick(spots);
      l.bubble = { x: Math.round(run.path[f * 2]), y: Math.round(run.path[f * 2 + 1]) };
      run = simulate(l, plan);
      if (run.capture < 0) continue;
      plan.push({ rope: -1, wait: run.capture - last + rng.int(25, 60) });
      run = simulate(l, plan);
      const popped = run.acts.at(-1) ?? 0;
      if (run.acts.length < plan.length || run.path[popped * 2 + 1] < 60) continue;
    }
    const x = landing(run, run.acts.at(-1) ?? 0);
    if (x == null || x < 40 || x > W - 40) continue;
    l.critter = x;
    const runs = [simulate(l, plan)];
    if (!runs[0].won) continue;
    let ok = true;
    if (tol)
      for (let j = 1; j < plan.length && ok; j++)
        for (const sign of [-1, 1]) {
          const p = plan.map((a, k) => (k === j ? { ...a, wait: Math.max(0, a.wait + sign * tol) } : a));
          const r = simulate(l, p);
          runs.push(r);
          if (!r.won) ok = false;
        }
    if (!ok) continue;
    // Cutting everything at once must not work: the order and the timing matter.
    if (
      strict &&
      simulate(
        l,
        plan.filter((a) => a.rope >= 0).map((a, i) => ({ rope: a.rope, wait: i ? 0 : 30 })),
      ).won
    )
      continue;
    const mouth = { x, y: CRIT_Y };
    const end = runs[0].path.length / 2 - 1;
    l.stars = alongPath(runs[0], runs[0].acts[0], end, 3, [mouth, l.start]);
    if (l.stars.length < 3 && strict) continue;
    l.spikes = placeSpikes(rng, spikesFor(d), runs, [mouth, ...l.stars, ...l.anchors, ...(l.bubble ? [l.bubble] : [])]);
    if (l.spikes.length < spikesFor(d) && strict) continue;
    l.plan = plan;
    return l;
  }
}

/** Deal a level: anchors and ropes, then a solution played out to place the critter, stars, bubble and spikes. */
export function createLevel(d: Difficulty, rng: Rng): State {
  const s = build(generate(d, rng), true);
  s.d = d;
  return s;
}
