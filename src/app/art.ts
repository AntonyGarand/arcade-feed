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
const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string): Part =>
  s('ellipse', { cx, cy, rx, ry, style: `fill:${fill}` });
/** A number drawn in ink, centred on (x, y). */
const num = (x: number, y: number, t: string, size = 9): Part =>
  s(
    'text',
    { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', style: `stroke:none;fill:${INK};font:800 ${size}px var(--font)` },
    t,
  );
/** A blocky invader of the wave shooters, centred on (x, y). */
const alien = (x: number, y: number, fill: string): Part =>
  path(`M${x - 5.5} ${y + 3.5}V${y - 1}L${x - 3} ${y - 4}H${x + 3}L${x + 5.5} ${y - 1}V${y + 3.5}L${x + 3} ${y + 1.5}H${x - 3}Z`, fill);
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
  clusters: () => [
    ...[
      [2, 2, 7, 7, 4],
      [2, 6, 6, 7, 4],
      [6, 6, 4, 4, 4],
      [2, 7, 7, 6, 6],
    ].flatMap((row, r) => row.map((n, c) => block(15, 8, 10, c, r, P(n)))),
    path('M71 50V58M67 54H75', 'none'),
  ],
  bubbles: () => [
    ...[1, 7, 4, 1, 5].map((n, i) => circle(16 + i * 12, 9, 5.5, P(n))),
    ...[4, 7, 5, 1].map((n, i) => circle(22 + i * 12, 19.5, 5.5, P(n))),
    trail('M40 42L54 26'),
    rect(30, 53, 20, 5, PAPER, 2.5),
    circle(40, 47.5, 5.5, P(7)),
  ],
  skyguard: () => [
    trail('M12 2L25 25'),
    circle(26.5, 27, 2.6, P(1)),
    trail('M72 2L61 19'),
    trail('M40 45L54 26'),
    circle(58, 22, 7.5, P(4)),
    circle(58, 22, 3, PAPER),
    rect(8, 46, 8, 8, PAPER, 1),
    rect(18, 42, 6, 12, PAPER, 1),
    rect(56, 44, 7, 10, PAPER, 1),
    rect(65, 40, 6, 14, PAPER, 1),
    path('M34 54L40 45L46 54Z', P(1)),
    path('M3 54H77', 'none', 'stroke-width:2.5'),
  ],
  golf: () => [
    path('M8 40Q8 22 34 22Q62 18 72 32Q78 52 50 54Q16 58 8 40Z', P(3)),
    trail('M23 44Q40 34 54 34'),
    ellipse(58, 35, 4, 2.5, INK),
    path('M58 35V9', 'none', 'stroke-width:2'),
    path('M58 9L71 13.5L58 18Z', P(7)),
    circle(20, 46, 3.6, PAPER),
  ],
  archery: () => [
    path('M4 10H22Q27 10 27 5', 'none'),
    path('M8 17H19', 'none'),
    circle(54, 32, 21, PAPER),
    circle(54, 32, 14.5, P(7)),
    circle(54, 32, 8.5, PAPER),
    circle(54, 32, 3.5, P(4)),
    path('M10 37L52 32', 'none', 'stroke-width:2.6'),
    path('M53.5 31.8L46.5 28.8L47.3 35.4Z', INK),
    path('M10 37L4 32M10 37L5 41M15 36.4L9 31.6M15 36.4L10 40.6', 'none'),
  ],
  whack: () => [
    ellipse(16, 50, 10, 3.5, INK),
    ellipse(64, 50, 10, 3.5, INK),
    ellipse(40, 53, 12, 4, INK),
    path('M9 50L11.5 42L15 47L18.5 41L23 50Z', P(5)),
    path('M30 53V39Q30 28 40 28Q50 28 50 39V53Z', P(1)),
    circle(36.5, 37, 1.9, INK),
    circle(43.5, 37, 1.9, INK),
    circle(40, 41.5, 1.8, P(7)),
    path('M62 18L59 34', 'none', 'stroke-width:3'),
    rect(52, 7, 20, 11, P(4), 2.5),
    path('M51 25L46 22.5M53 30L48 31', 'none'),
  ],
  rocks: () => [
    path('M12 10L24 5L33 13L29 26L15 27L8 18Z', PAPER),
    path('M56 35L66 33L73 41L67 52L56 50L52 42Z', PAPER),
    path('M62 7L69 9L69 16L62 17L58 12Z', PAPER),
    path('M18 15L23 17M25 21L21 22', 'none'),
    trail('M39 34L31 27'),
    path('M40 50L42 56L44 50', P(1)),
    path('M36 51L42 34L48 51L42 46.5Z', P(4)),
  ],
  formation: () => [
    ...[16, 30, 44, 58].map((x) => alien(x, 9, P(7))),
    ...[16, 30, 58].map((x) => alien(x, 21, P(4))),
    path('M41 21H47M44 18V24', 'none'),
    trail('M40 45V31'),
    path('M32 55H48V50.5H43.5L40 45L36.5 50.5H32Z', PAPER),
  ],
  duel: () => [
    path('M40 3V57', 'none', 'stroke-dasharray:4 5;stroke-width:2'),
    trail('M15 27L43 21'),
    rect(7, 16, 6.5, 22, PAPER, 3.25),
    rect(66.5, 26, 6.5, 22, P(4), 3.25),
    circle(48, 20, 4.2, PAPER),
  ],
  flutter: () => [
    rect(50, -2, 12, 18, P(3), 2),
    rect(48, 12, 16, 6, P(3), 2),
    rect(50, 44, 12, 18, P(3), 2),
    rect(48, 40, 16, 6, P(3), 2),
    trail('M3 38Q10 44 17 34'),
    circle(27, 29, 8.5, P(1)),
    path('M20 31Q24 37 29 31', PAPER),
    circle(30, 26, 1.9, INK),
    path('M34.5 28.5L40 30.5L34.5 32.5Z', P(7)),
  ],
  runner: () => [
    path('M3 52H77', 'none', 'stroke-width:2.5'),
    trail('M10 51Q17 30 24 28'),
    rect(48, 42, 10, 10, P(1), 1.5),
    path('M64 52L67.5 43L71 52Z', P(7)),
    path('M30 37L25 44M34 37L39.5 41', 'none', 'stroke-width:2.6'),
    path('M29 31L23 27M35 31L40 26', 'none', 'stroke-width:2.2'),
    rect(28, 27, 8, 11, PAPER, 3.5),
    circle(33, 21, 5, PAPER),
    circle(35, 20.5, 1.3, INK),
  ],
  lander: () => [
    circle(10, 9, 1.3, PAPER),
    circle(66, 6, 1.3, PAPER),
    circle(72, 20, 1.3, PAPER),
    path('M1 58V46L13 40L22 49H46L54 38L66 46L79 40V58Z', P(8)),
    rect(25, 46, 20, 3.5, P(4), 1.5),
    path('M32 29L35 39L38 29Z', P(1)),
    path('M30 28L26 35M40 28L44 35', 'none', 'stroke-width:2'),
    circle(35, 16, 5, PAPER),
    path('M29 20H41L43.5 29H26.5Z', PAPER),
  ],
  crossing: () => [
    rect(-2, 3, 84, 16, P(2), 0),
    rect(6, 7, 24, 8, P(1), 4),
    rect(48, 7, 22, 8, P(1), 4),
    rect(-2, 24, 84, 16, INK, 0),
    path('M3 32H77', 'none', 'stroke:var(--paper);stroke-dasharray:5 5'),
    rect(9, 27, 15, 10, P(7), 3),
    rect(52, 27.5, 15, 10, P(4), 3),
    circle(40, 50, 5.5, P(3)),
    circle(37.3, 46.5, 1.9, PAPER),
    circle(42.7, 46.5, 1.9, PAPER),
  ],
  tower: () => [
    trail('M12 10H36'),
    rect(40, 6, 26, 8, P(1), 1.5),
    trail('M53 16V21'),
    rect(27, 24, 26, 8, P(3), 1.5),
    rect(25, 32, 30, 8, P(6), 1.5),
    rect(23, 40, 34, 8, P(4), 1.5),
    rect(21, 48, 38, 8, P(2), 1.5),
  ],
  doubles: () => [
    rect(14, 4, 52, 52, PAPER, 5),
    ...(
      [
        [0, 0, 2, 4],
        [2, 0, 4, 1],
        [1, 1, 8, 7],
        [0, 2, 2, 4],
        [2, 2, 16, 5],
      ] as const
    ).flatMap(([c, r, v, n]) => [
      rect(17 + c * 16, 7 + r * 16, 14, 14, P(n), 3),
      num(24 + c * 16, 14.5 + r * 16, String(v), v > 9 ? 8 : 10),
    ]),
    path('M72 24V36M68.5 32.5L72 36L75.5 32.5', 'none'),
  ],
  mines: () => [
    ...[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => rect(18 + c * 11, 8 + r * 11, 11, 11, r + c < 3 ? PAPER : P(6), 1.5))),
    num(34.5, 24, '1'),
    num(23.5, 35, '2'),
    num(45.5, 13, '1'),
    path('M54 50.5V42.5', 'none', 'stroke-width:1.6'),
    path('M54 42.5L60 44.8L54 47Z', P(1)),
  ],
  crates: () => [
    rect(2, 3, 76, 7, P(2), 1.5),
    rect(2, 50, 76, 7, P(2), 1.5),
    path('M56 22H72V38H56Z', 'none', 'stroke-dasharray:3 3'),
    trail('M49 30H54'),
    rect(30, 22, 16, 16, P(1), 2),
    path('M30 22L46 38M46 22L30 38', 'none'),
    circle(19, 30, 7, P(4)),
    circle(22, 28, 1.7, INK),
  ],
  echo: () => [
    rect(18, 4, 21, 24, P(2), 5),
    rect(41, 4, 21, 24, P(3), 5),
    rect(18, 32, 21, 24, P(5), 5),
    rect(41, 32, 21, 24, P(4), 5),
    path('M66 37L72 33.5M67 44H74M66 51L72 54.5', 'none'),
    num(51.5, 44, '3', 12),
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
  move: () => [circle(12, 47, 4.5, PAPER), trail('M16 43Q22 30 25 24'), path('M56 18L73 8L67 21L63 16Z', P(4))],
  think: () => [
    block(5, 5, 8, 0, 0, P(4)),
    block(5, 5, 8, 1, 0, PAPER),
    block(5, 5, 8, 0, 1, PAPER),
    block(5, 5, 8, 1, 1, P(7)),
    circle(67, 40, 7.5, P(4)),
    rect(63.5, 47, 7, 6, PAPER, 1.5),
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
    move: ['M4 19Q7 7 20 7', 'M16 3l4 4-4 4'],
    think: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'],
  };
  return s('svg', { viewBox: '0 0 24 24', class: 'cat-icon', 'aria-hidden': 'true' }, ...(d[id] ?? d.all).map((p) => s('path', { d: p })));
}
