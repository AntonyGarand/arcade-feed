import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import type { Kind } from '../../core/variety';
import { DX, DY } from '../../kits/gesture/gesture';

/**
 * A hedge maze on a cell grid: nodes sit on odd rows and columns, the cells between two nodes are open
 * or hedge. The maze is mirrored left-right, every corridor cell has at least two exits, and one row
 * (three in a tunnel maze) has a side passage that wraps around. The owls' nest sits in the middle
 * with a door on top: only owls go through it (leaving, or coming back as eyes).
 */
export const WALL = 0;
export const PATH = 1;
export const DOOR = 2;
export const DEN = 3;

/** The kinds of maze a level can deal. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'meadow' },
  { id: 'tunnels' },
  { id: 'night', min: 2 },
  { id: 'hawks', min: 2 },
  { id: 'ghosts', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Maze nodes across and down (the grid is twice as big, plus one). */
export const sizeFor = (d: Difficulty) =>
  byLevel(d, [
    [5, 7],
    [5, 8],
    [7, 8],
    [7, 9],
    [7, 10],
  ] as const);

/** Chance to open each extra corridor (more loops, more escape routes); a meadow is far more open. */
const loopsFor = (d: Difficulty, kind: KindId) =>
  kind === 'meadow' ? byLevel(d, [0.6, 0.58, 0.55, 0.52, 0.5]) : byLevel(d, [0.34, 0.3, 0.28, 0.25, 0.22]);

/** Carve a mirrored, loopy maze with no dead ends; returns the grid. */
export function carve(d: Difficulty, rng: Rng, kind: KindId) {
  const [nx, ny] = sizeFor(d);
  const cols = 2 * nx + 1;
  const rows = 2 * ny + 1;
  const grid = new Uint8Array(cols * rows);
  const ic = (nx - 1) / 2;
  const jm = Math.floor(ny / 2);
  const cell = (i: number, j: number) => (2 * j + 1) * cols + 2 * i + 1;
  const isDen = (i: number, j: number) => i === ic && j === jm;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!isDen(i, j)) grid[cell(i, j)] = PATH;

  interface Edge {
    i: number;
    j: number;
    h: boolean;
  }
  const at = (e: Edge) => (e.h ? (2 * e.j + 1) * cols + 2 * e.i + 2 : (2 * e.j + 2) * cols + 2 * e.i + 1);
  const mirror = (e: Edge): Edge => ({ i: e.h ? nx - 2 - e.i : nx - 1 - e.i, j: e.j, h: e.h });
  const ends = (e: Edge) => [e.j * nx + e.i, e.h ? e.j * nx + e.i + 1 : (e.j + 1) * nx + e.i];
  const open = (e: Edge) => {
    grid[at(e)] = PATH;
    grid[at(mirror(e))] = PATH;
  };
  const edges: Edge[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (isDen(i, j)) continue;
      if (i + 1 < nx && !isDen(i + 1, j)) edges.push({ i, j, h: true });
      if (j + 1 < ny && !isDen(i, j + 1)) edges.push({ i, j, h: false });
    }
  rng.shuffle(edges);

  // A spanning tree, opened in mirrored pairs (Kruskal).
  const parent = [...Array(nx * ny).keys()];
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (const e of edges) {
    const [a, b] = ends(e);
    const [ma, mb] = ends(mirror(e));
    if (find(a) !== find(b) || find(ma) !== find(mb)) {
      open(e);
      parent[find(a)] = find(b);
      parent[find(ma)] = find(mb);
    }
  }
  // No dead ends: give every node with one exit a second one.
  const degree = (i: number, j: number) => [0, 1, 2, 3].filter((k) => grid[cell(i, j) + DX[k] + DY[k] * cols] === PATH).length;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (isDen(i, j) || degree(i, j) >= 2) continue;
      const shut = edges.filter((e) => grid[at(e)] === WALL && ends(e).includes(j * nx + i));
      open(rng.pick(shut));
    }
  // Extra loops.
  const p = loopsFor(d, kind);
  for (const e of edges) if (grid[at(e)] === WALL && rng.chance(p)) open(e);

  // The nest (three cells) and its door on top; a side passage on one row.
  const den = cell(ic, jm);
  grid[den - 1] = grid[den] = grid[den + 1] = DEN;
  grid[den - cols] = DOOR;
  const rowsOk = rng.shuffle([...Array(ny).keys()].filter((j) => j > 0 && j < ny - 1 && j !== jm));
  const tunnels = rowsOk.slice(0, kind === 'tunnels' ? 3 : 1).map((j) => 2 * j + 1);
  for (const r of tunnels) grid[r * cols] = grid[r * cols + cols - 1] = PATH;
  return { cols, rows, grid, den, nx, ny, ic, jm, cell, tunnels };
}
