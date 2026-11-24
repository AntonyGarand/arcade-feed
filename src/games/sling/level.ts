/** Dealing a level: the kind of fort, then huts, perches and hovering blobs, all from the seed. */
import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';
import { add, GROUND, type Mat, shotsFor, type State, targetsFor, W } from './rules';

/** The kinds of fort a level can deal. */
export const KINDS = [
  { id: 'village', weight: 2 },
  { id: 'frozen' },
  { id: 'sky' },
  { id: 'tower', min: 2 },
  { id: 'powder', min: 2 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** A box by its left edge and bottom; returns its top. */
const box = (s: State, x: number, bottom: number, w: number, h: number, mat: Mat) => {
  add(s, false, mat, x + w / 2, bottom - h / 2, w / 2, h / 2);
  return bottom - h;
};
const BLOB_R = 8.5;
const blob = (s: State, cx: number, bottom: number) => {
  add(s, true, 'blob', cx, bottom - BLOB_R, BLOB_R, BLOB_R);
  s.targets++;
};

/** Building blocks of a fort, sized in world units. */
const POST_W = 8;
const POST_H = 28;
const PLANK_H = 8;
const CUBE = 16;

/**
 * A hut of `floors` stacked rooms (two posts and a roof each), a blob sheltered in the rooms listed in
 * `inside`, maybe one on the roof. The top `stone` floors are built of stone: heavy lids that crush
 * what they fall on.
 */
function hut(s: State, x: number, ground: number, w: number, floors: number, inside: boolean[], roof: boolean, stone: number, look: Look) {
  let base = ground;
  for (let f = 0; f < floors; f++) {
    const mat: Mat = f >= floors - stone ? 'stone' : look.wood;
    // Dynamite posts hold up the ground floor of a powder hut.
    const post: Mat = f === 0 && look.tnt ? 'tnt' : mat;
    box(s, x, base, POST_W, POST_H, post);
    box(s, x + w - POST_W, base, POST_W, POST_H, post);
    if (inside[f]) blob(s, x + w / 2, base);
    base = box(s, x, base - POST_H, w, PLANK_H, mat);
  }
  if (roof) blob(s, x + w / 2, base);
}

/** A column of cubes with a blob on top. */
function perch(s: State, x: number, ground: number, n: number, stone: boolean, look: Look) {
  let base = ground;
  for (let i = 0; i < n; i++) base = box(s, x, base, CUBE, CUBE, i === 0 && look.tnt ? 'tnt' : stone && i === 0 ? 'stone' : look.wood);
  blob(s, x + CUBE / 2, base);
}

/** What a kind builds with: the light material, and whether dynamite holds the forts up. */
interface Look {
  wood: Mat;
  tnt: boolean;
}

/** One fort plan: what it needs and how wide it is. */
interface Plan {
  w: number;
  build: (s: State, x: number, ground: number) => void;
}

/**
 * Forts for a level: huts (taller and stonier with the level) and perches, `n` blobs in all. A tower
 * level stacks one tall hut instead; frozen forts are ice; powder forts stand on dynamite.
 */
function plans(d: Difficulty, rng: Rng, kind: KindId, n: number): Plan[] {
  const out: Plan[] = [];
  let left = n;
  const tower = kind === 'tower';
  const huts = tower ? 1 : byLevel(d, [1, 1, 2, 2, 2]);
  const floorsMax = tower ? byLevel(d, [2, 3, 3, 4, 4]) : byLevel(d, [1, 2, 2, 3, 3]);
  // Sky forts are lighter: the hovering blobs are the hard part.
  const stoneMax = Math.max(0, byLevel(d, [0, 0, 1, 1, 2]) - (kind === 'sky' ? 1 : 0));
  const look: Look = { wood: kind === 'frozen' ? 'ice' : 'wood', tnt: false };
  for (let i = 0; i < huts && left > 0; i++) {
    const floors = tower ? floorsMax : rng.int(Math.max(1, floorsMax - 1), floorsMax);
    const w = tower ? rng.int(42, 48) : rng.int(36, 44);
    // Powder: the first hut stands on dynamite.
    const hl: Look = { ...look, tnt: kind === 'powder' && i === 0 };
    const inside = Array.from({ length: floors }, () => false);
    let blobs = 0;
    for (let f = 0; f < floors && left - blobs > 1; f++)
      if (f === 0 || tower || rng.chance(0.6)) {
        inside[f] = true;
        blobs++;
      }
    const roof = left - blobs > (huts - i - 1) * 2 ? true : rng.chance(0.4);
    if (roof) blobs++;
    const stone = Math.min(floors - 1, stoneMax ? rng.int(stoneMax - 1, stoneMax) : 0);
    left -= blobs;
    out.push({ w, build: (st, x, g) => hut(st, x, g, w, floors, inside, roof, stone, hl) });
  }
  while (left > 0) {
    const h = rng.int(1, byLevel(d, [1, 2, 3, 3, 4]));
    const stone = d >= 3 && rng.chance(0.5);
    const pl: Look = { ...look, tnt: kind === 'powder' && rng.chance(0.5) };
    left--;
    out.push({ w: CUBE, build: (st, x, g) => perch(st, x, g, h, stone, pl) });
  }
  return rng.shuffle(out);
}

/** Deal a level: forts side by side on the right, everything at rest, the first stone ready. */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const s: State = {
    d,
    kind,
    bodies: [],
    nextId: 0,
    shots: shotsFor(d),
    used: 0,
    score: 0,
    targets: 0,
    angle: 0.55,
    power: 0.7,
    turn: 0,
    pull: 0,
    phase: 'aim',
    shot: -1,
    flight: 0,
    acc: 0,
    warm: new Map(),
    t: 0,
    chain: 0,
    tier: 0,
    boomNext: false,
    splitNext: false,
  };
  // The ground: one static slab, wider than the field.
  add(s, false, 'ground', W / 2, GROUND + 60, W * 2, 60);
  // A boulder in front of the forts from Medium up: flat shots stop there, lob over it.
  const rock = byLevel(d, [0, 46, 50, 54, 56]);
  if (rock) box(s, rng.int(82, 92), GROUND, rng.int(16, 22), rock + rng.int(0, 6), 'ground');
  // Sky: some blobs hover above the forts instead of hiding in them.
  const floaters = kind === 'sky' ? byLevel(d, [1, 1, 2, 2, 2]) : 0;
  const forts = plans(d, rng, kind, targetsFor(d) - floaters);
  const span = forts.reduce((a, p) => a + p.w, 0);
  const lo = 146;
  const hi = W - 8;
  const room = Math.max(0, hi - lo - span);
  // Gaps between forts: a seeded share of the spare room, at least 10 units each.
  const cuts = forts.map(() => 0.4 + rng.next());
  const total = cuts.reduce((a, c) => a + c, 0) + 0.4;
  let x = lo + (room * 0.4) / total;
  const ledge = byLevel(d, [0, 0.3, 0.45, 0.6, 0.7]);
  for (const [i, p] of forts.entries()) {
    // Some forts stand on a rock ledge (solid, part of the ground).
    let base = GROUND;
    if (rng.chance(ledge)) base = box(s, Math.round(x) - 4, GROUND, p.w + 8, rng.int(1, 3) * 12, 'ground');
    p.build(s, Math.round(x), base);
    x += p.w + Math.max(10, (room * cuts[i]) / total);
  }
  // Each one hovers over the lowest of a few spots, low enough for a stone to reach.
  const topNear = (px: number) =>
    Math.min(GROUND, ...s.bodies.filter((b) => b.inv > 0 && Math.abs(b.x - px) < b.hw + 30).map((b) => b.y - b.hh));
  for (let i = 0; i < floaters; i++) {
    const xs = Array.from({ length: 5 }, () => 160 + ((i + rng.next()) * 110) / floaters);
    const hx = xs.reduce((a, cx) => (topNear(cx) > topNear(a) ? cx : a));
    const ay = rng.int(6, 12);
    const hy = Math.max(140, Math.min(GROUND - 120, topNear(hx) - 26 - ay) - rng.int(0, 20));
    const b = add(s, true, 'blob', hx, hy, BLOB_R, BLOB_R);
    // Held up by its wings: never falls, never sleeps, only pops.
    b.inv = 0;
    b.hover = { x: hx, y: hy, ax: rng.int(4, 14), ay, ph: rng.next() * Math.PI * 2, sp: 0.9 + rng.next() * 0.6 };
    s.targets++;
  }
  return s;
}
