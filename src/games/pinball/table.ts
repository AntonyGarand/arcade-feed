import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Table in world units: the playfield spans x 4…232 (centre 118), the plunger lane x 232…258. */
export const W = 262;
export const H = 420;
export const BALL_R = 6;
export const BALLS = 3;
/** Playfield centre line: the bottom of the table is symmetric around it. */
export const MID = 118;
const mirror = (x: number) => 2 * MID - x;
/** Plunger lane: the ball rests at (LANE_X, PLUNGER_Y). */
export const LANE_X = 245;
export const LANE_L = 232;
const LANE_TOP = 150;
export const PLUNGER_Y = 398;
/** Top of the table: a half circle over the whole width. */
export const ARC = { x: 131, y: 131, r: 127 };
/** Top rollover lanes: their sensors sit between separator posts. */
export const LANE_Y0 = 38;
export const LANE_Y1 = 58;
export const LANE_GAP = 24;
export const FLIP_REST = 0.52;
/** Flipper capsule radius at the pivot and at the tip. */
export const FLIP_R0 = 7;
export const FLIP_R1 = 4;
/** Seconds the ball waits on the plunger before it launches by itself. */
export const HOLD_S = 1.2;

export const PTS = {
  bumper: 50,
  sling: 10,
  target: 250,
  bank: 1500,
  lane: 100,
  lanes: 1000,
  star: 300,
  stars: 2000,
  saucer: 400,
  jackpot: 2000,
} as const;

/** The kinds of table a level can deal. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'storm' },
  { id: 'gallery' },
  { id: 'stars' },
  { id: 'saucer', min: 2 },
  { id: 'vortex', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Seconds between two scoring hits before the combo runs out. */
export const COMBO_WINDOW = 3;
/** Combo lengths that unlock a reward: frenzy, ball save, drain guard, then jackpots. */
export const COMBO_TIERS = [8, 16, 26, 40, 60] as const;
export type Reward = 'save' | 'frenzy' | 'guard' | 'jackpot';
/** Seconds a frenzy (every hit ×2) and the drain guard post last. */
export const FRENZY_S = 10;
export const GUARD_S = 8;
/** The post that rises between the flippers while the drain guard runs. */
export const GUARD = { x: 118, y: 404, r: 6 };
/** Star pickups: their radius. */
export const STAR_R = 7;
/** Kickout saucer: its catch radius. */
export const SAUCER_R = 9;
/** Black hole: its pull radius and its core radius (it swallows the ball). */
export const VORTEX_R = 62;
export const VORTEX_CORE = 7;
/** Bonus per ball left unplayed when the goal is reached. */
export const BALL_BONUS = 2500;

export const goalFor = (d: Difficulty) => byLevel(d, [7500, 8000, 9000, 9500, 10000]);
const bumpersFor = (d: Difficulty) => byLevel(d, [3, 3, 4, 4, 5]);
const bumperR = (d: Difficulty) => byLevel(d, [15, 14, 13, 12, 11]);
const banksFor = (d: Difficulty) => byLevel(d, [1, 1, 2, 2, 2]);
const bankSize = (d: Difficulty) => byLevel(d, [3, 3, 3, 4, 4]);
const lanesFor = (d: Difficulty) => byLevel(d, [3, 3, 3, 4, 4]);
const flipLen = (d: Difficulty) => byLevel(d, [46, 44, 42, 40, 38]);
const gravityFor = (d: Difficulty) => byLevel(d, [290, 310, 330, 350, 370]);
/** Seconds after a launch during which a drained ball comes back (once per ball). */
export const saveFor = (d: Difficulty) => byLevel(d, [10, 8, 6, 5, 4]);
/** Side outlanes (a drain past the slingshots): closed, one side, then both, with a wider mouth. */
const outlanesFor = (d: Difficulty) => byLevel(d, [0, 0, 1, 2, 2]);
/** Radius of the post that splits the inlane from the outlane: a smaller post leaves a wider mouth. */
const outPostR = (d: Difficulty) => byLevel(d, [3, 3, 3.6, 3.2, 2.4]);

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  kind: 'wall' | 'sling' | 'gate';
  /** Sling side (0 left, 1 right). */
  side: number;
}
export interface Circle {
  x: number;
  y: number;
  r: number;
}
/** A round bumper; drifting ones sway `amp` either side of `x0`. */
interface Bumper extends Circle {
  x0: number;
  amp: number;
  ph: number;
}
/** A star pickup: the ball collects it by rolling through. */
interface Star {
  x: number;
  y: number;
  on: boolean;
  /** Seconds until a collected star shows up again. */
  back: number;
}
/** Kickout saucer: catches the ball, scores more each time, and kicks it back up. */
interface Saucer {
  x: number;
  y: number;
  /** Catches so far. */
  n: number;
  /** Seconds before it can catch again. */
  cool: number;
}
interface Target {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  down: boolean;
  bank: number;
}
interface Bank {
  ids: number[];
  /** Seconds until a cleared bank stands back up (0: standing). */
  reset: number;
}
export interface Flipper {
  px: number;
  py: number;
  len: number;
  /** 1: left flipper (points right), -1: right flipper. */
  side: number;
  a: number;
  /** Angular speed in the last sub-step (radians per second). */
  w: number;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  rng: Rng;
  segs: Seg[];
  posts: Circle[];
  bumpers: Bumper[];
  stars: Star[];
  /** Star hunt: collecting every star scores a set bonus and they all come back. */
  starSet: boolean;
  saucer: Saucer | null;
  /** Black hole in the field: it pulls the ball in and swallows it (the multiplier drops one step). */
  vortex: Circle | null;
  /** Areas new stars keep clear of (target banks). */
  boxes: [number, number, number, number][];
  /** Ball held by the saucer or the black hole for `lock` more seconds, then kicked out at `kick`. */
  lock: number;
  kick: [number, number];
  /** Seconds since the table was dealt (drifting bumpers). */
  t: number;
  /** Scoring hits in a row, each within `COMBO_WINDOW` of the last. */
  combo: number;
  comboLeft: number;
  /** Combo milestones reached (index into `COMBO_TIERS`). */
  tier: number;
  /** Seconds of frenzy (every point ×2) and drain guard left. */
  frenzy: number;
  guard: number;
  /** This ball already got its combo ball save. */
  comboSaved: boolean;
  targets: Target[];
  banks: Bank[];
  /** Rollover lane centres and their lamps. */
  lanes: number[];
  lit: boolean[];
  /** Outlanes open on the left and right (closed ones are capped). */
  outlanes: [boolean, boolean];
  /** Lane the ball is in (-1: none), so a lane lights once per pass. */
  inLaneSensor: number;
  flippers: [Flipper, Flipper];
  /** Flipper buttons held (left, right). */
  press: [boolean, boolean];
  /** Buttons as they were last step (a press flips the lane lamps once). */
  was: [boolean, boolean];
  bx: number;
  by: number;
  vx: number;
  vy: number;
  gravity: number;
  /** Ball resting on the plunger, launching after `hold` seconds unless the plunger is being pulled. */
  held: boolean;
  hold: number;
  charging: boolean;
  charge: number;
  /** Ball still in the plunger lane (the lane gate stays open). */
  inLane: boolean;
  save: number;
  saveUsed: boolean;
  balls: number;
  mult: number;
  score: number;
  goal: number;
  stuck: number;
  done: boolean;
}

const seg = (ax: number, ay: number, bx: number, by: number, kind: Seg['kind'] = 'wall', r = 0, side = 0): Seg => ({
  ax,
  ay,
  bx,
  by,
  r,
  kind,
  side,
});

/** The sling triangle on the left (mirrored for the right): its kick face runs from A to C. */
export const SLING = { ax: 38, ay: 284, bx: 38, by: 318, cx: 58, cy: 336 };
const GUIDE = { x: 20, top: 300, knee: 330, ex: 64, ey: 364 };
const PIVOT = { x: 66, y: 372 };
const DEFLECT = { x: 22, y0: 248, y1: 280 };
/** The post at the top left that stops the orbit and turns the ball back into the field. */
const KICKER = { x: 34, y: 63, r: 9 };

export const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

/** A free spot of radius `r` in the upper field, clear of bumpers (their whole sway), banks, the saucer, the black hole's core and other stars. */
export function freeSpot(
  s: Pick<State, 'rng' | 'bumpers' | 'boxes' | 'saucer' | 'vortex' | 'stars'>,
  r: number,
): { x: number; y: number } | null {
  for (let tries = 0; tries < 200; tries++) {
    const x = s.rng.int(34, 202);
    const y = s.rng.int(LANE_Y1 + 26, 238);
    if (s.bumpers.some((b) => Math.max(0, Math.abs(x - b.x0) - b.amp) ** 2 + (y - b.y) ** 2 < (b.r + r + 6) ** 2)) continue;
    if (s.boxes.some(([x0, y0, x1, y1]) => x > x0 - r - 12 && x < x1 + r + 12 && y > y0 - r - 12 && y < y1 + r + 12)) continue;
    if (s.saucer && dist2(x, y, s.saucer.x, s.saucer.y) < (SAUCER_R + r + 14) ** 2) continue;
    if (s.vortex && dist2(x, y, s.vortex.x, s.vortex.y) < (VORTEX_CORE + r + 18) ** 2) continue;
    if (s.stars.some((q) => q.on && dist2(x, y, q.x, q.y) < (2 * r + 16) ** 2)) continue;
    return { x, y };
  }
  return null;
}

/** Deal a table of kind `kindId` (or one dealt from the seed): bumpers, banks, lanes and the kind's extras; flippers, slings and walls fixed. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const segs: Seg[] = [];
  const posts: Circle[] = [];
  const open = outlanesFor(d);
  const one = rng.int(0, 1);
  const outlanes: [boolean, boolean] = [open === 2 || (open === 1 && one === 0), open === 2 || (open === 1 && one === 1)];
  // Outer walls, the lane and its gate, then the arched top.
  segs.push(seg(4, ARC.y, 4, H + 30), seg(258, ARC.y, 258, H + 30), seg(LANE_L, LANE_TOP, LANE_L, H + 30));
  segs.push(seg(LANE_L, LANE_TOP, 258, ARC.y, 'gate'));
  const N = 32;
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI + (i / N) * Math.PI;
    const a1 = Math.PI + ((i + 1) / N) * Math.PI;
    segs.push(seg(ARC.x + Math.cos(a0) * ARC.r, ARC.y + Math.sin(a0) * ARC.r, ARC.x + Math.cos(a1) * ARC.r, ARC.y + Math.sin(a1) * ARC.r));
  }
  // Bottom: inlane guides, slings, outlane covers on the easy levels; the left side, then its mirror.
  for (const side of [0, 1]) {
    const m = side ? mirror : (x: number) => x;
    segs.push(seg(m(GUIDE.x), GUIDE.top, m(GUIDE.x), GUIDE.knee), seg(m(GUIDE.x), GUIDE.knee, m(GUIDE.ex), GUIDE.ey));
    posts.push({ x: m(GUIDE.x), y: GUIDE.top, r: outPostR(d) });
    // A rubber on the wall turns balls coming down the side into the inlane, not the outlane.
    segs.push(seg(m(4), DEFLECT.y0, m(DEFLECT.x), DEFLECT.y1));
    posts.push({ x: m(DEFLECT.x), y: DEFLECT.y1, r: 2 });
    if (!outlanes[side]) segs.push(seg(m(4), GUIDE.top - 16, m(GUIDE.x), GUIDE.top - 2));
    const { ax, ay, bx, by, cx, cy } = SLING;
    segs.push(seg(m(ax), ay, m(bx), by), seg(m(bx), by, m(cx), cy), seg(m(ax), ay, m(cx), cy, 'sling', 0, side));
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
      [cx, cy],
    ])
      posts.push({ x: m(x), y, r: 2.5 });
  }
  // Top rollover lanes between separator posts.
  const nl = lanesFor(d);
  const lanes: number[] = [];
  const lx0 = 124 - (nl * LANE_GAP) / 2;
  for (let i = 0; i <= nl; i++) segs.push(seg(lx0 + i * LANE_GAP, LANE_Y0, lx0 + i * LANE_GAP, LANE_Y1, 'wall', 2.5));
  for (let i = 0; i < nl; i++) lanes.push(lx0 + (i + 0.5) * LANE_GAP);

  // Drop-target banks: along the left wall, the right wall or across the middle.
  const targets: Target[] = [];
  const banks: Bank[] = [];
  const boxes: [number, number, number, number][] = [];
  // Kickout saucer and black hole sit in the middle of the field; banks and bumpers keep clear of them.
  const saucer: Saucer | null = kind === 'saucer' ? { x: MID + rng.int(-30, 30), y: rng.int(108, 136), n: 0, cool: 0 } : null;
  const vortex: Circle | null = kind === 'vortex' ? { x: MID + rng.int(-24, 24), y: rng.int(160, 190), r: VORTEX_CORE } : null;
  const nBanks = kind === 'gallery' ? 3 : kind === 'storm' ? Math.min(1, banksFor(d)) : banksFor(d);
  const kinds = rng.shuffle(['L', 'R', 'C']).slice(0, nBanks);
  const n = bankSize(d);
  for (const k of kinds) {
    const bank: Bank = { ids: [], reset: 0 };
    const len = n * 20 - 5;
    if (k === 'C') {
      const y = rng.int(246, 258);
      const x0 = MID - len / 2 + rng.int(-12, 12);
      for (let i = 0; i < n; i++) targets.push({ ax: x0 + i * 20, ay: y, bx: x0 + i * 20 + 15, by: y, down: false, bank: banks.length });
      boxes.push([x0, y, x0 + len, y]);
    } else {
      const x = k === 'L' ? 8 : LANE_L - 4;
      const y0 = rng.int(150, 240 - len);
      for (let i = 0; i < n; i++) targets.push({ ax: x, ay: y0 + i * 20, bx: x, by: y0 + i * 20 + 15, down: false, bank: banks.length });
      boxes.push([x, y0, x, y0 + len]);
    }
    for (let i = 0; i < n; i++) bank.ids.push(targets.length - n + i);
    banks.push(bank);
  }

  // Round bumpers: spread out in the upper field, clear of the banks, lanes, each other and the extras.
  // A bumper storm deals two more (two of them drifting), a target gallery one fewer.
  const bumpers: Bumper[] = [{ ...KICKER, x0: KICKER.x, amp: 0, ph: 0 }];
  const br = bumperR(d);
  const extra = kind === 'storm' ? 2 : kind === 'gallery' ? -1 : 0;
  const want = bumpersFor(d) + extra;
  const drifting = kind === 'storm' ? 2 : kind === 'classic' && d >= 4 ? 1 : 0;
  const keep = [
    saucer && { x: saucer.x, y: saucer.y, r: SAUCER_R + 16 },
    vortex && { x: vortex.x, y: vortex.y, r: VORTEX_CORE + 34 },
  ].filter((k): k is Circle => !!k);
  for (let tries = 0; tries < 600 && bumpers.length < want + 1; tries++) {
    const amp = bumpers.length <= drifting ? rng.int(16, 26) : 0;
    const r = br + (tries % 3 === 0 ? 2 : 0);
    const x = rng.int(50 + amp, 186 - amp);
    const y = rng.int(LANE_Y1 + br + 18, 232);
    // Two sways never meet: the closest their tracks come, plus both radii and room for the ball.
    if (bumpers.some((b) => Math.max(0, Math.abs(x - b.x0) - amp - b.amp) ** 2 + (y - b.y) ** 2 < (b.r + r + 2 * BALL_R + 8) ** 2))
      continue;
    if (boxes.some(([x0, y0, x1, y1]) => x + amp > x0 - r - 18 && x - amp < x1 + r + 18 && y > y0 - r - 18 && y < y1 + r + 18)) continue;
    if (keep.some((k) => Math.max(0, Math.abs(x - k.x) - amp) ** 2 + (y - k.y) ** 2 < (k.r + r) ** 2)) continue;
    const ph = amp ? rng.next() * Math.PI * 2 : 0;
    bumpers.push({ x: x + amp * Math.sin(ph), y, r, x0: x, amp, ph });
  }

  // Star pickups: five to hunt as a set, a few around the black hole, a lone one on a classic table.
  const nStars = kind === 'stars' ? 5 : kind === 'vortex' ? 3 : kind === 'classic' && d >= 2 ? 1 : 0;
  const stars: Star[] = [];
  const table = { rng, bumpers, boxes, saucer, vortex, stars };
  for (let i = 0; i < nStars; i++) {
    const at = freeSpot(table, STAR_R);
    if (at) stars.push({ ...at, on: true, back: 0 });
  }

  const len = flipLen(d);
  const flipper = (side: number): Flipper => ({ px: side > 0 ? PIVOT.x : mirror(PIVOT.x), py: PIVOT.y, len, side, a: FLIP_REST, w: 0 });
  return {
    d,
    kind,
    rng,
    segs,
    posts,
    bumpers,
    stars,
    starSet: kind === 'stars',
    saucer,
    vortex,
    boxes,
    lock: 0,
    kick: [0, 0],
    t: 0,
    combo: 0,
    comboLeft: 0,
    tier: 0,
    frenzy: 0,
    guard: 0,
    comboSaved: false,
    targets,
    banks,
    lanes,
    lit: lanes.map(() => false),
    outlanes,
    inLaneSensor: -1,
    flippers: [flipper(1), flipper(-1)],
    press: [false, false],
    was: [false, false],
    bx: LANE_X,
    by: PLUNGER_Y,
    vx: 0,
    vy: 0,
    gravity: gravityFor(d),
    held: true,
    hold: HOLD_S,
    charging: false,
    charge: 0,
    inLane: true,
    save: 0,
    saveUsed: false,
    balls: BALLS,
    mult: 1,
    score: 0,
    goal: goalFor(d),
    stuck: 0,
    done: false,
  };
}

/** A flipper's tip. */
export function flipperTip(f: Flipper) {
  return { x: f.px + f.side * f.len * Math.cos(f.a), y: f.py + f.len * Math.sin(f.a) };
}
