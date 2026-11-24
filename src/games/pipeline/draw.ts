import type { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { DX, DY, type Dir, type Point } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { opens, opp, X, type State } from './rules';

/** Pipe drawing for a level: pieces (reservoirs and one-way pipes too), stubs, bolts and coins. */
export function painter(arena: Arena, s: State, CS: number) {
  /** Trace a pipe channel from the edge on side `a` towards side `b` (straight or a quarter bend), `f` of the way. */
  function trace(g: CanvasRenderingContext2D, x: number, y: number, a: Dir, b: Dir, f: number): Point {
    const h = CS / 2;
    g.beginPath();
    if (b === opp(a)) {
      const sx = x + DX[a] * h;
      const sy = y + DY[a] * h;
      const ex = sx + (DX[b] - DX[a]) * h * f;
      const ey = sy + (DY[b] - DY[a]) * h * f;
      g.moveTo(sx, sy);
      g.lineTo(ex, ey);
      return { x: ex, y: ey };
    }
    const ox = x + (DX[a] + DX[b]) * h;
    const oy = y + (DY[a] + DY[b]) * h;
    const a0 = Math.atan2(-DY[b], -DX[b]);
    let dl = Math.atan2(-DY[a], -DX[a]) - a0;
    if (dl > Math.PI) dl -= Math.PI * 2;
    if (dl < -Math.PI) dl += Math.PI * 2;
    g.arc(ox, oy, h, a0, a0 + dl * f, dl < 0);
    return { x: ox + Math.cos(a0 + dl * f) * h, y: oy + Math.sin(a0 + dl * f) * h };
  }

  /** Pipe metal: a neutral between the text and the board, so pipes stand out in every theme. */
  const metal = () => mix(arena.colors.fg, arena.colors.cellAlt, arena.dark ? 0.5 : 0.62);

  /** A flange where a pipe meets the edge of its cell on side `d`. */
  function flange(g: CanvasRenderingContext2D, x: number, y: number, d: Dir) {
    const c = arena.colors;
    const h = CS / 2;
    const along = CS * 0.12;
    const across = CS * 0.6;
    const fx0 = x + DX[d] * (h - along / 2 - 1);
    const fy0 = y + DY[d] * (h - along / 2 - 1);
    const w = DX[d] ? along : across;
    const hh = DX[d] ? across : along;
    g.fillStyle = metal();
    g.strokeStyle = c.ink;
    g.lineWidth = arena.lw * 0.7;
    g.beginPath();
    g.roundRect(fx0 - w / 2, fy0 - hh / 2, w, hh, 1.5);
    g.fill();
    g.stroke();
  }

  /** One channel: ink casing, metal body, flanges, a dark bore, then liquid over `wet` of it (from side `a`). */
  function channel(g: CanvasRenderingContext2D, x: number, y: number, a: Dir, b: Dir, wet: number) {
    const c = arena.colors;
    const m = metal();
    g.lineCap = 'butt';
    trace(g, x, y, a, b, 1);
    g.strokeStyle = c.ink;
    g.lineWidth = CS * 0.48;
    g.stroke();
    g.strokeStyle = m;
    g.lineWidth = CS * 0.48 - arena.lw * 1.6;
    g.stroke();
    flange(g, x, y, a);
    flange(g, x, y, b);
    trace(g, x, y, a, b, 1);
    g.strokeStyle = arena.tone(m).lo;
    g.lineWidth = CS * 0.24;
    g.stroke();
    if (wet <= 0) return;
    const front = trace(g, x, y, a, b, Math.min(1, wet));
    g.strokeStyle = c.accent;
    g.lineWidth = CS * 0.24;
    g.stroke();
    // A light glint running along the liquid.
    trace(g, x, y, a, b, Math.min(1, wet));
    g.strokeStyle = arena.tone(c.accent).hi;
    g.lineWidth = CS * 0.06;
    g.setLineDash([CS * 0.12, CS * 0.2]);
    g.lineDashOffset = -arena.time * CS * 0.8;
    g.stroke();
    g.setLineDash([]);
    g.lineDashOffset = 0;
    if (wet < 1) {
      // A bubbling front.
      g.fillStyle = arena.tone(c.accent).hi;
      g.beginPath();
      g.arc(front.x, front.y, CS * (0.13 + 0.02 * Math.sin(arena.time * 18)), 0, Math.PI * 2);
      g.fill();
    }
  }

  /** The sides of a non-cross piece. */
  const sides = (p: number) => ([0, 1, 2, 3] as Dir[]).filter((d) => opens(p, d));

  /** A piece centred on (x, y); `cell` (when on the board) supplies how wet it is. */
  function piece(g: CanvasRenderingContext2D, x: number, y: number, p: number, cell = -1) {
    const live = cell >= 0 && s.started && s.flow.at === cell;
    const wet = cell >= 0 ? s.wet[cell] : 0;
    const t = live ? Math.min(1, s.flow.t) : 1;
    if (p === X) {
      // Vertical channel under the horizontal one (a little bridge).
      for (const a of [0, 1] as const) {
        const flowing = live && s.flow.from >= 0 && s.flow.from % 2 === a;
        const from = flowing ? (s.flow.from as Dir) : a;
        channel(g, x, y, from, opp(from), flowing ? t : wet & (a ? 1 : 2) ? 1 : 0);
      }
      return;
    }
    const [a, b] = sides(p);
    if (live && s.flow.from >= 0) channel(g, x, y, s.flow.from as Dir, s.flow.from === a ? b : a, t);
    else channel(g, x, y, a, b, wet ? 1 : 0);
    if (cell >= 0 && s.res[cell]) tank(g, x, y, a % 2 === 1, live ? t : wet ? 1 : 0);
    if (cell >= 0 && s.oneway[cell] >= 0) arrows(g, x, y, s.oneway[cell] as Dir);
  }

  /** A reservoir: a wide tank over the pipe, its window filling as the flow goes through. */
  function tank(g: CanvasRenderingContext2D, x: number, y: number, across: boolean, level: number) {
    const c = arena.colors;
    const w = across ? CS * 0.74 : CS * 0.6;
    const h = across ? CS * 0.6 : CS * 0.74;
    arena.block(g, x - w / 2, y - h / 2, w, h, metal(), 5, false, 0.8);
    const iw = w - 8;
    const ih = h - 8;
    g.fillStyle = arena.tone(metal()).lo;
    g.beginPath();
    g.roundRect(x - iw / 2, y - ih / 2, iw, ih, arena.r(3));
    g.fill();
    if (level > 0) {
      const lh = ih * Math.min(1, level);
      g.fillStyle = c.accent;
      g.beginPath();
      g.roundRect(x - iw / 2, y + ih / 2 - lh, iw, lh, arena.r(3));
      g.fill();
      g.strokeStyle = arena.tone(c.accent).hi;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x - iw / 2 + 2, y + ih / 2 - lh + 1.5 + Math.sin(arena.time * 6) * 0.6);
      g.lineTo(x + iw / 2 - 2, y + ih / 2 - lh + 1.5 - Math.sin(arena.time * 6) * 0.6);
      g.stroke();
    }
    // Gauge ticks.
    g.strokeStyle = c.ink;
    g.lineWidth = arena.lw * 0.5;
    g.beginPath();
    for (const k of [0.25, 0.5, 0.75]) {
      g.moveTo(x + iw / 2 - 4, y + ih / 2 - ih * k);
      g.lineTo(x + iw / 2, y + ih / 2 - ih * k);
    }
    g.stroke();
  }

  /** One-way pipe: two chevrons pointing where the flow must go. */
  function arrows(g: CanvasRenderingContext2D, x: number, y: number, d: Dir) {
    const c = arena.colors;
    const k = CS * 0.11;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [col, lw] of [
      [c.ink, 4.2],
      [c.paper, 2.2],
    ] as const) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      for (const o of [-0.7, 0.7]) {
        const px = x + DX[d] * k * o;
        const py = y + DY[d] * k * o;
        // Tip at (px, py) + dir·k, wings back and out.
        g.moveTo(px - DX[d] * k + DY[d] * k * 1.2, py - DY[d] * k + DX[d] * k * 1.2);
        g.lineTo(px + DX[d] * k * 0.4, py + DY[d] * k * 0.4);
        g.lineTo(px - DX[d] * k - DY[d] * k * 1.2, py - DY[d] * k - DX[d] * k * 1.2);
      }
      g.stroke();
    }
    g.lineCap = 'butt';
  }

  /** Bolts in the corners of a fixed piece's tile: it can't be replaced. */
  function bolts(g: CanvasRenderingContext2D, x: number, y: number) {
    const c = arena.colors;
    const o = CS / 2 - 6;
    for (const [bx, by] of [
      [-o, -o],
      [o, -o],
      [-o, o],
      [o, o],
    ])
      arena.disc(g, x + bx, y + by, 2.2, c.muted);
  }

  /** A bonus coin: centred on an empty cell, tucked in the corner of one with a pipe. */
  function coin(g: CanvasRenderingContext2D, x: number, y: number, corner: boolean) {
    const c = arena.colors;
    const r = corner ? CS * 0.14 : CS * 0.22;
    const cx = corner ? x + CS / 2 - r - 3 : x;
    const cy = (corner ? y - CS / 2 + r + 3 : y) + Math.sin(arena.time * 3 + x) * (corner ? 0 : 1.2);
    arena.ball(g, cx, cy, r, c.p[3], !corner);
    g.fillStyle = arena.tone(c.p[3]).lo;
    glyphPath(g, 4, cx, cy, r * 0.55);
    g.fill();
  }

  function stub(g: CanvasRenderingContext2D, x: number, y: number, d: Dir, wet: number) {
    const c = arena.colors;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + DX[d] * (CS / 2), y + DY[d] * (CS / 2));
    g.strokeStyle = c.ink;
    g.lineWidth = CS * 0.48;
    g.stroke();
    g.strokeStyle = metal();
    g.lineWidth = CS * 0.48 - arena.lw * 1.6;
    g.stroke();
    flange(g, x, y, d);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + DX[d] * (CS / 2), y + DY[d] * (CS / 2));
    g.strokeStyle = arena.tone(metal()).lo;
    g.lineWidth = CS * 0.24;
    g.stroke();
    if (wet > 0) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + DX[d] * (CS / 2) * wet, y + DY[d] * (CS / 2) * wet);
      g.strokeStyle = c.accent;
      g.lineWidth = CS * 0.24;
      g.stroke();
    }
  }

  return { piece, stub, bolts, coin, metal };
}
