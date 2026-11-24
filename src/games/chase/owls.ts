import type { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { DX, DY } from '../../kits/gesture/gesture';
import { type Chaser, GHOST, HAWK, pos, type State } from './rules';

/** One maze cell in world units. */
export const CELL = 16;
/** Owl colours (palette slots), by personality: the four owls, the ghost owl (unused), the hawk. */
const OWL = [4, 1, 0, 5, 7, 7];

/** An owl's own colour (a ghost owl is pale). */
export function owlColor(arena: Arena, kind: number): string {
  const c = arena.colors;
  return kind === GHOST ? mix(c.paper, c.muted, 0.35) : c.p[OWL[kind]];
}

/**
 * Draw one owl (or its eyes flying home): ear tufts, body, belly, eyes and beak. Hawks get swept wings
 * and a hooked beak, with speed lines while they swoop; ghost owls are see-through with a wavy hem.
 * `wrapped` paints it again on the other side while it crosses a side passage.
 */
export function drawOwl(
  arena: Arena,
  s: State,
  g: CanvasRenderingContext2D,
  ch: Chaser,
  n: number,
  wrapped: (x: number, paint: (x: number) => void) => void,
) {
  const c = arena.colors;
  const p = pos(s, ch);
  let x0 = p.x * CELL;
  let y = p.y * CELL;
  const dx = ch.moving ? DX[ch.dir] : 0;
  const dy = ch.moving ? DY[ch.dir] : 1;
  const r = CELL * 0.46;
  if (ch.mode === 'den') {
    // Two owls can share the middle of the nest before the first one leaves.
    if (s.chasers.length === 4 && (n === 0 || n === 3)) x0 += n === 0 ? -4 : 4;
    y += Math.sin(arena.time * 4 + n * 1.7) * 1.6;
  } else if (ch.mode !== 'eyes') y += Math.abs(Math.sin(arena.time * 11 + n)) * -1.2;
  if (ch.kind === GHOST && ch.mode !== 'eyes') y += Math.sin(arena.time * 3 + n) * 1.5;
  const blink = s.fright < 1.6 && Math.floor(arena.time * 6) % 2 === 0;
  const fill = ch.fright ? (blink ? c.paper : arena.dark ? mix(c.muted, c.cell, 0.3) : c.muted) : owlColor(arena, ch.kind);
  const t = arena.tone(fill);
  const hawk = ch.kind === HAWK && !ch.fright;
  const ghost = ch.kind === GHOST;
  wrapped(x0, (x) => {
    if (ch.mode !== 'eyes') {
      if (ch.swoop) {
        // Speed lines streaming behind a swooping hawk.
        g.strokeStyle = t.edge;
        g.lineWidth = arena.lw * 0.6;
        g.globalAlpha = 0.7;
        g.beginPath();
        for (const k of [-0.5, 0, 0.5]) {
          const ox = x - dx * r * 1.3 + -dy * k * r;
          const oy = y - dy * r * 1.3 + dx * k * r;
          g.moveTo(ox, oy);
          g.lineTo(ox - dx * r * (1 + Math.abs(k)), oy - dy * r * (1 + Math.abs(k)));
        }
        g.stroke();
        g.globalAlpha = 1;
      }
      if (ghost) g.globalAlpha = 0.62;
      g.fillStyle = t.lo;
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.5;
      g.lineJoin = 'round';
      for (const side of [-1, 1]) {
        g.beginPath();
        if (hawk) {
          // Swept-back wings.
          const flap = Math.sin(arena.time * (ch.swoop ? 26 : 12) + n) * r * 0.25;
          g.moveTo(x + side * r * 0.6, y - r * 0.2);
          g.lineTo(x + side * r * 1.45, y - r * 0.55 + flap);
          g.lineTo(x + side * r * 0.95, y + r * 0.45);
        } else {
          // Ear tufts.
          g.moveTo(x + side * r * 0.2, y - r * 0.7);
          g.lineTo(x + side * r * 0.85, y - r * 1.2);
          g.lineTo(x + side * r * 0.8, y - r * 0.35);
        }
        g.closePath();
        g.fill();
        g.stroke();
      }
      arena.ball(g, x, y, r, fill);
      if (ghost) {
        // A wavy hem under the see-through body.
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(x - r, y);
        for (let k = 0; k <= 6; k++) g.lineTo(x - r + (k * r) / 3, y + r * (k % 2 ? 1.05 : 1.35) + Math.sin(arena.time * 8 + k) * 0.8);
        g.lineTo(x + r, y);
        g.closePath();
        g.fill();
      }
      g.fillStyle = t.hi;
      g.globalAlpha = ghost ? 0.45 : 0.7;
      g.beginPath();
      g.ellipse(x, y + r * 0.42, r * 0.5, r * 0.36, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    const scared = ch.fright;
    for (const side of [-1, 1]) {
      const ex = x + side * r * 0.36;
      const ey = y - r * 0.12;
      g.fillStyle = c.paper;
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.4;
      g.beginPath();
      g.arc(ex, ey, r * 0.34, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = c.coal;
      g.beginPath();
      if (scared) g.arc(ex, ey, r * 0.09, 0, Math.PI * 2);
      else g.arc(ex + dx * r * 0.13, ey + dy * r * 0.13, r * 0.16, 0, Math.PI * 2);
      g.fill();
      if (hawk && ch.mode !== 'eyes') {
        // A fierce brow.
        g.strokeStyle = t.edge;
        g.lineWidth = arena.lw * 0.6;
        g.beginPath();
        g.moveTo(ex - side * r * 0.3, ey - r * 0.42);
        g.lineTo(ex + side * r * 0.3, ey - r * 0.22);
        g.stroke();
      }
    }
    if (ch.mode === 'eyes') return;
    if (scared) {
      // A wobbly frown instead of the beak.
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.45;
      g.beginPath();
      for (let k = 0; k <= 4; k++) g.lineTo(x - r * 0.4 + k * r * 0.2, y + r * 0.38 + (k % 2 ? -1.2 : 0));
      g.stroke();
      return;
    }
    g.fillStyle = c.p[3];
    g.strokeStyle = arena.tone(c.p[3]).edge;
    g.lineWidth = arena.lw * 0.35;
    g.beginPath();
    g.moveTo(x - r * 0.14, y + r * 0.12);
    g.lineTo(x + r * 0.14, y + r * 0.12);
    if (hawk) g.quadraticCurveTo(x + r * 0.1, y + r * 0.5, x - r * 0.05, y + r * 0.5);
    else g.lineTo(x, y + r * 0.42);
    g.closePath();
    g.fill();
    g.stroke();
  });
}

/** The owls' glowing eyes over the dark of a night maze, so they can be spotted from afar. */
export function drawGlowEyes(
  arena: Arena,
  s: State,
  g: CanvasRenderingContext2D,
  wrapped: (x: number, paint: (x: number) => void) => void,
) {
  const c = arena.colors;
  for (const ch of s.chasers) {
    if (ch.mode === 'den') continue;
    const p = pos(s, ch);
    const y = p.y * CELL - CELL * 0.06;
    const col = ch.fright ? c.paper : ch.mode === 'eyes' ? c.muted : c.p[3];
    wrapped(p.x * CELL, (x) => {
      g.fillStyle = arena.tone(col).glow;
      g.beginPath();
      g.arc(x, y, CELL * 0.45, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = col;
      g.beginPath();
      for (const side of [-1, 1]) {
        g.moveTo(x + side * CELL * 0.16 + 1.8, y);
        g.arc(x + side * CELL * 0.16, y, 1.8, 0, Math.PI * 2);
      }
      g.fill();
    });
  }
}
