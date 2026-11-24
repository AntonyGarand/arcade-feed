/** Drawing the sling, its stones, the grumps and the fort blocks. */
import type { Arena } from '../../kits/arena/arena';
import type { Point } from '../../kits/gesture/gesture';
import { type Body, GROUND, SLING, STONE_R } from './rules';

export function drawFork(arena: Arena, g: CanvasRenderingContext2D, side: -1 | 1) {
  const c = arena.colors;
  const wood = arena.tone(c.p[0]);
  const top = { x: SLING.x + side * 9, y: SLING.y - 6 };
  const knee = { x: SLING.x, y: SLING.y + 18 };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const [w, col] of [
    [8, wood.edge],
    [4.5, side < 0 ? wood.lo : wood.base],
  ] as const) {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    if (side > 0) {
      g.moveTo(SLING.x, GROUND - 2);
      g.lineTo(knee.x, knee.y);
    } else g.moveTo(knee.x, knee.y);
    g.lineTo(top.x, top.y);
    g.stroke();
  }
  g.lineCap = 'butt';
}

export function drawBand(arena: Arena, g: CanvasRenderingContext2D, side: -1 | 1, p: Point) {
  g.strokeStyle = arena.colors.ink;
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(SLING.x + side * 9, SLING.y - 6);
  g.lineTo(p.x - STONE_R * 0.6, p.y);
  g.stroke();
}

/**
 * The stone: a round pebble with a determined look. An explosive one is red with a lit fuse, a
 * splitting one shows its three parts.
 */
export function drawStone(
  arena: Arena,
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  live: boolean,
  spin: number,
  mark: { boom?: boolean; split?: boolean } = {},
  r = STONE_R,
) {
  const c = arena.colors;
  arena.ball(g, x, y, r, live ? (mark.boom ? c.bad : c.accent) : arena.tone(c.muted).hi, live);
  if (!live) {
    // A pebble's notch, rolling with it.
    g.strokeStyle = arena.tone(c.muted).edge;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(x, y, r * 0.55, spin, spin + 1.4);
    g.stroke();
    return;
  }
  if (mark.boom) {
    g.strokeStyle = c.ink;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x + 2, y - r + 1);
    g.quadraticCurveTo(x + 5, y - r - 4, x + 7, y - r - 2);
    g.stroke();
    if (Math.sin(arena.time * 20) > -0.3) arena.disc(g, x + 7, y - r - 2, 1.8, c.accent);
  }
  if (mark.split) {
    g.strokeStyle = arena.tone(c.accent).edge;
    g.lineWidth = 1;
    g.beginPath();
    for (const a of [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6]) {
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.stroke();
  }
  for (const dx of [-2.4, 2.4]) {
    g.fillStyle = c.paper;
    g.beginPath();
    g.arc(x + dx + 1, y - 1, 1.9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.coal;
    g.beginPath();
    g.arc(x + dx + 1.8, y - 1, 1, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = c.ink;
  g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(x - 3.6, y - 4.4);
  g.lineTo(x + 4.6, y - 3.4);
  g.stroke();
}

/** A grumpy blob: squat, scowling, eyes on the stone. */
export function drawBlob(arena: Arena, g: CanvasRenderingContext2D, b: Body, look: Point) {
  const c = arena.colors;
  const r = b.hw;
  const breathe = Math.sin(arena.time * 2.2 + b.id * 1.7) * 0.04;
  g.save();
  g.translate(b.x, b.y + r);
  if (b.hover) {
    // Little flapping wings keep a sky grump up.
    const flap = Math.sin(arena.time * 16 + b.id) * 0.5;
    g.fillStyle = c.paper;
    g.strokeStyle = c.ink;
    g.lineWidth = 1;
    for (const k of [-1, 1]) {
      g.beginPath();
      g.ellipse(k * r * 1.15, -r * 1.25, r * 0.75, r * 0.38, k * (0.5 + flap), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
  g.scale(1 + breathe, 1 - breathe);
  arena.ball(g, 0, -r, r, c.p[2]);
  const a = Math.atan2(look.y - b.y, look.x - b.x);
  const blink = (arena.time + b.id * 0.9) % 3.4 < 0.12;
  for (const k of [-1, 1]) {
    const ex = k * r * 0.36;
    const ey = -r * 1.08;
    if (blink) {
      g.strokeStyle = c.coal;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ex - 2, ey);
      g.lineTo(ex + 2, ey);
      g.stroke();
    } else {
      g.fillStyle = c.paper;
      g.beginPath();
      g.arc(ex, ey, r * 0.27, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = c.coal;
      g.beginPath();
      g.arc(ex + Math.cos(a) * 1.1, ey + Math.sin(a) * 1.1, r * 0.13, 0, Math.PI * 2);
      g.fill();
    }
    // Brows slanting down to the middle: grumpy.
    g.strokeStyle = c.ink;
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ex + k * r * 0.32, ey - r * 0.42);
    g.lineTo(ex - k * r * 0.22, ey - r * 0.22);
    g.stroke();
  }
  // Frown.
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(0, -r * 0.42, r * 0.3, Math.PI * 1.2, Math.PI * 1.8);
  g.stroke();
  g.lineCap = 'butt';
  g.restore();
}

export function drawBox(arena: Arena, g: CanvasRenderingContext2D, b: Body) {
  const c = arena.colors;
  const x = b.x - b.hw;
  const y = b.y - b.hh;
  const w = b.hw * 2;
  const h = b.hh * 2;
  if (b.mat === 'ground') {
    arena.block(g, x, y, w, h, c.muted, 5);
    return;
  }
  if (b.mat === 'tnt') {
    drawTnt(arena, g, b, x, y, w, h);
    return;
  }
  const fill = b.mat === 'wood' ? c.p[0] : b.mat === 'ice' ? c.p[5] : arena.tone(c.muted).hi;
  arena.block(g, x, y, w, h, fill, 2);
  const t = arena.tone(fill);
  if (b.mat === 'ice') {
    // A glassy glint across the corner.
    g.strokeStyle = c.paper;
    g.lineWidth = arena.lw * 0.5;
    g.globalAlpha = 0.7;
    g.beginPath();
    g.moveTo(x + 2.5, y + Math.min(h, w) * 0.6);
    g.lineTo(x + Math.min(h, w) * 0.6, y + 2.5);
    g.stroke();
    g.globalAlpha = 1;
    return;
  }
  g.strokeStyle = t.edge;
  g.lineWidth = arena.lw * 0.35;
  g.globalAlpha = 0.45;
  g.beginPath();
  if (b.mat === 'wood') {
    // Grain along the long side.
    if (w >= h) {
      g.moveTo(x + 4, y + h * 0.45);
      g.lineTo(x + w - 6, y + h * 0.45);
    } else {
      g.moveTo(x + w * 0.5, y + 4);
      g.lineTo(x + w * 0.5, y + h - 6);
    }
  } else {
    // Speckles, and a crack once hit.
    g.arc(x + w * 0.3, y + h * 0.35, 0.8, 0, Math.PI * 2);
    g.moveTo(x + w * 0.7 + 0.8, y + h * 0.6);
    g.arc(x + w * 0.7, y + h * 0.6, 0.8, 0, Math.PI * 2);
  }
  g.stroke();
  g.globalAlpha = 1;
  if (b.mat === 'stone' && b.hp < 2) {
    g.lineWidth = arena.lw * 0.6;
    g.beginPath();
    g.moveTo(x + w * 0.35, y);
    g.lineTo(x + w * 0.55, y + h * 0.45);
    g.lineTo(x + w * 0.42, y + h * 0.7);
    g.lineTo(x + w * 0.6, y + h);
    g.stroke();
  }
}

/** Dynamite: a red stick or crate with a band, and a fuse that sparks now and then. */
function drawTnt(arena: Arena, g: CanvasRenderingContext2D, b: Body, x: number, y: number, w: number, h: number) {
  const c = arena.colors;
  arena.block(g, x, y, w, h, c.bad, 2);
  const t = arena.tone(c.bad);
  g.fillStyle = t.hi;
  if (h > w) g.fillRect(x + 1, y + h * 0.42, w - 2, h * 0.16);
  else g.fillRect(x + 1, y + h * 0.36, w - 2, h * 0.28);
  if (w >= 12) {
    g.fillStyle = t.edge;
    g.font = `900 ${(h * 0.32).toFixed(1)}px ${arena.family}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('TNT', x + w / 2, y + h / 2 + 0.5);
    g.textBaseline = 'alphabetic';
  }
  g.strokeStyle = c.ink;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + w / 2, y);
  g.quadraticCurveTo(x + w / 2 + 2, y - 4, x + w / 2 + 4, y - 3);
  g.stroke();
  if (Math.sin(arena.time * 9 + b.id * 2.3) > 0.4) arena.disc(g, x + w / 2 + 4, y - 3, 1.5, c.accent);
}
