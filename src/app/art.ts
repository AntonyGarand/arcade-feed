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
  mines: () => [
    ...[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => rect(18 + c * 11, 8 + r * 11, 11, 11, r + c < 3 ? PAPER : P(6), 1.5))),
    num(34.5, 24, '1'),
    num(23.5, 35, '2'),
    num(45.5, 13, '1'),
    path('M54 50.5V42.5', 'none', 'stroke-width:1.6'),
    path('M54 42.5L60 44.8L54 47Z', P(1)),
  ],
  memory: () => [
    ...[0, 1, 2, 3].flatMap((r) =>
      [0, 1, 2, 3].map((c) => rect(19 + c * 11, 7 + r * 11, 9.5, 9.5, [1, 6, 7, 13].includes(r * 4 + c) ? P(5) : PAPER, 2)),
    ),
    path('M66 42L66 54M60 48H72', 'none'),
    circle(66, 48, 2.6, P(5)),
  ],
  echo: () => [
    rect(18, 4, 21, 24, P(2), 5),
    rect(41, 4, 21, 24, P(3), 5),
    rect(18, 32, 21, 24, P(5), 5),
    rect(41, 32, 21, 24, P(4), 5),
    path('M66 37L72 33.5M67 44H74M66 51L72 54.5', 'none'),
    num(51.5, 44, '3', 12),
  ],
  snip: () => [
    path('M12 5L35 23M68 5L45 23', 'none', 'stroke-width:2'),
    circle(12, 5, 2.8, PAPER),
    circle(68, 5, 2.8, PAPER),
    path('M35 25L28 21V29Z', P(1)),
    path('M45 25L52 21V29Z', P(1)),
    circle(40, 25, 6.5, P(1)),
    trail('M40 34V41'),
    path('M62 30.5L63.4 34.1L67.2 34.3L64.3 36.7L65.2 40.5L62 38.4L58.8 40.5L59.7 36.7L56.8 34.3L60.6 34.1Z', P(4)),
    path('M18 30.5L19.4 34.1L23.2 34.3L20.3 36.7L21.2 40.5L18 38.4L14.8 40.5L15.7 36.7L12.8 34.3L16.6 34.1Z', P(4)),
    ellipse(40, 51, 15, 8.5, P(3)),
    circle(34.5, 47.5, 2.6, PAPER),
    circle(45.5, 47.5, 2.6, PAPER),
    ellipse(40, 52.5, 4, 2.5, INK),
  ],
  sling: () => [
    path('M2 54H78', 'none', 'stroke-width:2'),
    path('M16 54V41L11 31M16 41L21 31', 'none', 'stroke-width:3.2;stroke-linecap:round'),
    trail('M19 31Q30 6 41 13'),
    circle(43.5, 15, 4, PAPER),
    rect(50, 38, 4, 16, P(1), 1),
    rect(70, 38, 4, 16, P(1), 1),
    rect(48, 34, 28, 4, P(1), 1),
    circle(62, 48.5, 5.5, P(3)),
    circle(62, 28.5, 5.5, P(3)),
    circle(60, 28, 1, INK),
    circle(64, 28, 1, INK),
    path('M58.3 25.6L61 26.8M65.7 25.6L63 26.8', 'none', 'stroke-width:1.2'),
    circle(60, 48, 1, INK),
    circle(64, 48, 1, INK),
    path('M58.3 45.6L61 46.8M65.7 45.6L63 46.8', 'none', 'stroke-width:1.2'),
  ],
  pinball: () => [
    path('M8 58V26Q8 4 40 4Q72 4 72 26V58', 'none', 'stroke-width:2.5'),
    circle(28, 22, 6, P(7)),
    circle(52, 20, 5, P(2)),
    circle(40, 34, 5.5, P(4)),
    rect(13, 30, 3, 8, P(1), 1),
    rect(64, 30, 3, 8, P(1), 1),
    trail('M38 50L46 38L44 28'),
    path('M17 48L33 54', 'none', 'stroke-width:5;stroke-linecap:round'),
    path('M63 48L47 54', 'none', 'stroke-width:5;stroke-linecap:round'),
    circle(36, 49, 3.6, PAPER),
  ],
  chain: () => {
    const track =
      'M28.7 8.4L21.1 11.3L14.7 15.6L10.1 20.9L7.5 26.8L7.1 33.1L9 39.2L13 44.8L18.8 49.4L26.1 52.8L34.3 54.6L42.9 54.9L51.3 53.6L58.9 50.7L65.3 46.4L69 40.8L70.5 34.9L69.9 29.1L67.3 23.8L63 19.3L57.4 15.9L51 13.8L44.4 13L37.9 13.5L32.1 15.2L27.3 17.8L23.8 21.1L21.8 24.8L21.2 28.6L21.9 32.2L23.9 35.3';
    return [
      path(track, 'none', 'stroke-width:10.5;stroke-linecap:round;stroke-linejoin:round'),
      path(track, 'none', `stroke:${PAPER};stroke-width:7;stroke-linecap:round;stroke-linejoin:round`),
      circle(23.9, 35.3, 4.5, INK),
      ...[
        [9, 22.8, 1],
        [7.1, 29.3, 1],
        [7.7, 36, 4],
        [10.9, 42.3, 4],
        [16.3, 47.7, 7],
        [23.5, 51.8, 1],
        [32, 54.3, 4],
        [41.2, 55, 4],
        [50.2, 53.8, 7],
        [58.5, 50.9, 7],
      ].flatMap(([x, y, n]) => [circle(x, y, 4.2, P(n)), circle(x, y, 1.4, PAPER)]),
      trail('M44 37L48 47'),
      circle(42, 32, 6.5, PAPER),
      circle(42, 32, 3, P(7)),
    ];
  },
  slice: () => [
    circle(16, 15, 7, INK),
    path('M16 8Q17 4 21 4', 'none', 'stroke-width:1.8'),
    circle(22, 4, 2.4, P(1)),
    path('M21 39A11 11 0 0 1 36 23Z', P(1)),
    path('M25 37A7 7 0 0 1 34 27Z', PAPER),
    path('M31 44A11 11 0 0 0 46 28Z', P(1)),
    path('M34 41A7 7 0 0 0 43 31Z', PAPER),
    path('M8 54Q40 36 74 8', 'none', 'stroke-width:3;stroke-linecap:round'),
    circle(62, 42, 9, P(4)),
    ellipse(66, 31, 3.5, 1.8, P(3)),
    circle(50, 18, 1.8, P(1)),
    circle(54, 24, 1.3, P(1)),
    circle(20, 46, 1.5, P(1)),
  ],
  chase: () => [
    path('M4 4H76V56H4Z', 'none', 'stroke-width:2.5'),
    rect(14, 14, 18, 10, P(3), 3),
    rect(48, 14, 18, 10, P(3), 3),
    rect(14, 36, 18, 10, P(3), 3),
    rect(48, 36, 18, 10, P(3), 3),
    ...[22, 30, 38].map((x) => ellipse(x, 30, 2, 1.4, P(4))),
    circle(66, 30, 4, P(7)),
    circle(52, 30, 6.5, PAPER),
    circle(50, 24.5, 3, PAPER),
    circle(50, 24.5, 1.6, P(7)),
    circle(55, 29, 1.2, INK),
    path('M45.5 30Q41 26 43 22', 'none', `stroke:${P(7)};stroke-width:1.6`),
    path('M10 4L13 -1L16 4', P(5)),
    circle(13, 9, 6, P(5)),
    circle(10.8, 8.5, 2.2, PAPER),
    circle(15.2, 8.5, 2.2, PAPER),
    circle(11.3, 9, 1, INK),
    circle(15.7, 9, 1, INK),
  ],
  claim: () => [
    path('M6 6H74V54H6Z', 'none', 'stroke-width:2.5'),
    path('M6 6H40V22H26V40H6Z', P(6)),
    path('M58 54V36H74V54Z', P(6)),
    circle(16, 16, 6, P(4)),
    trail('M40 22H52V36H58'),
    path('M40 22H52V30', 'none', 'stroke-width:2.5'),
    path('M52 26L55 30L52 34L49 30Z', PAPER),
    path('M52 44L54 48.5L58.5 50L54 51.5L52 56L50 51.5L45.5 50L50 48.5Z', P(1)),
  ],
  hop: () => [
    rect(8, 50, 26, 5, P(3), 2.5),
    rect(44, 36, 24, 5, P(5), 2.5),
    rect(14, 14, 22, 5, P(3), 2.5),
    path('M53 36V32M51 32H55M51 34H55', 'none', 'stroke-width:1.5'),
    trail('M21 49Q30 18 56 30'),
    circle(66, 18, 4, P(4)),
    path('M64 12L66 8L68 12', 'none'),
    path('M59 22L62 21M73 22L70 21', 'none', 'stroke-width:1.5'),
    rect(17, 33, 12, 14, PAPER, 6),
    circle(21, 38, 1.5, INK),
    circle(25.5, 38, 1.5, INK),
    path('M23 33Q22 28 26 27', 'none', 'stroke-width:1.6'),
    path('M10 4H22V9H10', 'none'),
    path('M10 4V14', 'none', 'stroke-width:2'),
  ],
  dig: () => [
    rect(4, 4, 72, 52, P(1), 4),
    rect(9, 8, 24, 11, P(2), 3),
    path('M21 19V31H58V46', 'none', `stroke:${INK};stroke-width:8.5;stroke-linecap:round;stroke-linejoin:round`),
    path('M21 19V31H58V46', 'none', `stroke:${PAPER};stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round`),
    circle(21, 25, 2.3, P(2)),
    circle(36, 31, 2.3, P(2)),
    circle(47, 31, 2.3, P(2)),
    ellipse(52, 15, 11, 5, P(8)),
    path('M38 36.5L39.6 40H43.4L40.4 42.2L41.5 46L38 43.7L34.5 46L35.6 42.2L32.6 40H36.4Z', P(7)),
    rect(51, 46, 14, 10, PAPER, 1.5),
  ],
  pipeline: () => [
    path('M20 31H38Q46 31 46 23V18Q46 10 54 10H74', 'none', 'stroke-width:9'),
    path('M20 31H38Q46 31 46 23V18Q46 10 54 10H74', 'none', `stroke:${PAPER};stroke-width:5.5`),
    path('M20 31H38Q46 31 46 23V21', 'none', `stroke:${P(2)};stroke-width:3.5`),
    rect(5, 23, 16, 16, P(4), 3),
    circle(13, 31, 3.5, PAPER),
    rect(44, 43, 13, 13, PAPER, 2),
    path('M50.5 43V49.5H57', 'none', 'stroke-width:2.5'),
    rect(61, 43, 13, 13, PAPER, 2),
    path('M61 49.5H74', 'none', 'stroke-width:2.5'),
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
