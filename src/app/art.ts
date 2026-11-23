import type { CategoryId } from '../core/categories';
import type { GameDef } from '../core/types';
import { s } from '../ui/dom';

/**
 * Little illustrations of each game for the Games tab, the start gate and the Profile list. Drawn in an
 * 80×60 box on the game's accent colour, outlined with --on-tone (dark on every bright fill, in every
 * theme) and filled from the shared palette, so they follow the four styles × light / dark.
 *
 * To give a new game its own art, add an entry to ART keyed by its id. Games without one get their
 * category's motif with their initial on top (see `gameArt`).
 */
type Part = SVGElement;

const P = (n: number) => `var(--p${n})`;
const PAPER = 'var(--paper)';
const INK = 'var(--on-tone)';

const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 2): Part =>
  s('rect', { x, y, width: w, height: h, rx, style: `fill:${fill}` });
const circle = (cx: number, cy: number, r: number, fill: string): Part => s('circle', { cx, cy, r, style: `fill:${fill}` });
const path = (d: string, fill = 'none', extra = ''): Part => s('path', { d, style: `fill:${fill};${extra}` });
/** A dotted motion / aim line. */
const trail = (d: string): Part => path(d, 'none', 'stroke-dasharray:1 4.5;stroke-width:2.2');
/** A gem of the match games: shape `k` in palette colour `n`, centred on (x, y). */
function gem(x: number, y: number, k: number, n: number, r = 6): Part {
  const f = P(n);
  if (k === 0) return circle(x, y, r, f);
  if (k === 1) return path(`M${x} ${y - r - 1}L${x + r + 1} ${y}L${x} ${y + r + 1}L${x - r - 1} ${y}Z`, f);
  if (k === 2) return rect(x - r + 0.5, y - r + 0.5, 2 * r - 1, 2 * r - 1, f, 2.5);
  return path(`M${x} ${y - r}L${x + r} ${y + r - 1}L${x - r} ${y + r - 1}Z`, f);
}
/** A square block of the stacking games, `u` wide, with its top-left corner at column `c`, row `r`. */
const block = (x0: number, y0: number, u: number, c: number, r: number, fill: string) => rect(x0 + c * u, y0 + r * u, u, u, fill, 1.5);

const ART: Partial<Record<string, () => Part[]>> = {
  bricks: () => [
    ...[P(7), P(1), P(4)].flatMap((f, row) =>
      [0, 1, 2, 3].filter((i) => !(row === 2 && i === 1)).map((i) => rect(7 + i * 17, 6 + row * 8, 15, 6, f)),
    ),
    trail('M40 49L50 36L57 29'),
    circle(52, 34, 3.8, PAPER),
    rect(27, 49, 26, 5.5, PAPER, 2.75),
  ],
  swap: () => [
    ...[
      [0, 4, 1, 2, 2, 3],
      [3, 6, 1, 2, 1, 5],
      [2, 3, 0, 4, 1, 2],
    ].flatMap(([k1, n1, k2, n2, k3, n3], row) => [
      gem(25, 14 + row * 16, k1, n1),
      gem(40, 14 + row * 16, k2, n2),
      gem(55, 14 + row * 16, k3, n3),
    ]),
    path('M33 23.5Q40 19.5 47 23.5', 'none', 'stroke-width:2.2'),
    path('M44.5 20.5L47 23.5L43.4 24.6', 'none', 'stroke-width:2.2'),
  ],
  pegs: () => [
    path('M34 4H46L43 11H37Z', PAPER),
    trail('M40 11Q46 22 50 30Q53 38 47 46'),
    ...[
      [16, 20, 0],
      [30, 20, 1],
      [58, 18, 0],
      [66, 24, 1],
      [22, 33, 1],
      [36, 34, 0],
      [62, 38, 0],
      [14, 46, 0],
      [28, 48, 1],
      [58, 52, 1],
    ].map(([x, y, hit]) => circle(x, y, 3.6, hit ? P(1) : PAPER)),
    circle(47, 46, 3.4, P(7)),
  ],
  'falling-blocks': () => {
    const u = 7;
    const x0 = 19;
    const y0 = 4;
    const cells: [number, number, string][] = [
      [2, 0, P(5)],
      [3, 0, P(5)],
      [4, 0, P(5)],
      [3, 1, P(5)],
      [0, 5, P(1)],
      [0, 6, P(1)],
      [1, 6, P(1)],
      [2, 6, P(4)],
      [3, 6, P(4)],
      [3, 5, P(4)],
      [4, 6, P(7)],
      [5, 6, P(7)],
      [5, 5, P(7)],
      [6, 5, P(3)],
      [6, 6, P(3)],
      [5, 4, P(3)],
      [6, 4, P(3)],
    ];
    return [
      path(`M${x0 - 3} ${y0}V${y0 + 7 * u + 3}H${x0 + 6 * u + u + 3}V${y0}`, 'none', 'stroke-width:2.5'),
      trail(`M${x0 + 3.5 * u} ${y0 + 2 * u + 3}V${y0 + 4 * u - 2}`),
      ...cells.map(([c, r, f]) => block(x0, y0, u, c, r, f)),
    ];
  },
  dodge: () => [
    trail('M14 4V20'),
    trail('M62 2V14'),
    trail('M74 30H62'),
    circle(14, 25, 4.5, P(1)),
    path('M57 16L62 25L67 16Z', P(7)),
    circle(57, 31, 3.5, P(4)),
    path('M27 44L33 50M33 44L27 50', 'none', 'stroke-width:2.5'),
    circle(40, 38, 11, PAPER),
    circle(36.5, 36, 1.9, INK),
    circle(44, 36, 1.9, INK),
    path('M36 42Q40 44.5 44 42', 'none', 'stroke-width:2'),
  ],
  merge: () => [
    path('M40 3V10', 'none', 'stroke-width:2'),
    path('M37 7.5L40 10.5L43 7.5', 'none', 'stroke-width:2'),
    circle(40, 16, 4, P(3)),
    circle(30, 43, 11, P(4)),
    circle(51.5, 46, 8, P(1)),
    circle(48, 31, 6, P(7)),
    circle(36, 27, 4.5, P(6)),
    path('M16 22V52Q16 57 21 57H59Q64 57 64 52V22', 'none', 'stroke-width:3'),
  ],
  snake: () => [
    path('M12 46H28V30H52V16H66', 'none', `stroke:${INK};stroke-width:10;stroke-linecap:round`),
    path('M12 46H28V30H52V16H66', 'none', `stroke:${P(3)};stroke-width:5.5;stroke-linecap:round`),
    circle(66, 16, 6.5, P(3)),
    circle(68, 14, 1.6, INK),
    circle(68, 42, 4, P(7)),
    path('M68 38Q70 35 72.5 35.5', 'none', 'stroke-width:2'),
  ],
};

/** The motif of a category, for games without their own art. */
const CATEGORY_ART: Partial<Record<CategoryId, () => Part[]>> = {
  match: () => [gem(14, 14, 0, 4), gem(66, 14, 1, 2), gem(14, 46, 2, 3), gem(66, 46, 3, 6)],
  aim: () => [circle(66, 14, 8, PAPER), circle(66, 14, 3.5, P(1)), trail('M14 48Q22 30 30 24'), circle(14, 48, 4, PAPER)],
  reflex: () => [path('M17 5L8 27H15L11 46L26 21H18L22 5Z', P(4)), path('M66 14L59 30H64L62 44L72 26H66L69 14Z', P(1))],
  stack: () => [
    block(5, 30, 8, 0, 2, P(1)),
    block(5, 30, 8, 1, 2, P(1)),
    block(5, 30, 8, 1, 1, P(4)),
    block(59, 30, 8, 0, 2, P(5)),
    block(59, 30, 8, 1, 2, P(3)),
    block(59, 30, 8, 0, 1, P(3)),
  ],
};

/**
 * Art for a game: its own if it has one, else its category's motif with the game's initial in the
 * middle. Decorative: hidden from screen readers.
 */
export function gameArt(def: Pick<GameDef, 'id' | 'name' | 'category'>, cls = 'art'): SVGSVGElement {
  const own = ART[def.id];
  const parts = own ? own() : [...(CATEGORY_ART[def.category]?.() ?? []), letter(def.name)];
  return s('svg', { viewBox: '0 0 80 60', class: `${cls} ${own ? '' : 'art-generic'}`.trim(), 'aria-hidden': 'true' }, ...parts);
}

function letter(name: string): Part {
  const ch = [...name.trim()][0]?.toUpperCase() ?? '?';
  return s('text', { x: 40, y: 31, class: 'art-letter', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, ch);
}

/** Small line icon for a category (filter chips, section titles), stroked with currentColor. */
export function categoryIcon(id: CategoryId | 'all'): SVGSVGElement {
  const d: Partial<Record<CategoryId | 'all', string[]>> & { all: string[] } = {
    all: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
    match: ['M12 3l8 9-8 9-8-9z', 'M4 12h16'],
    aim: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 12h.01'],
    reflex: ['M13 2L4 14h7l-1 8 9-12h-7z'],
    stack: ['M4 14h8v7H4z', 'M12 14h8v7h-8z', 'M8 7h8v7H8z'],
  };
  return s('svg', { viewBox: '0 0 24 24', class: 'cat-icon', 'aria-hidden': 'true' }, ...(d[id] ?? d.all).map((p) => s('path', { d: p })));
}
