import type { Arena } from '../../kits/arena/arena';

/** A bonus on a hidden cell: an hourglass (time) or a gem (points), bobbing a little. */
export function drawBonus(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number, size: number, clock: boolean) {
  const c = arena.colors;
  const r = size * 0.24;
  const yy = y + Math.sin(arena.time * 3 + x) * size * 0.03;
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.7;
  g.lineJoin = 'round';
  if (clock) {
    g.fillStyle = c.p[5];
    g.beginPath();
    g.moveTo(x - r, yy - r * 1.1);
    g.lineTo(x + r, yy - r * 1.1);
    g.lineTo(x, yy);
    g.lineTo(x + r, yy + r * 1.1);
    g.lineTo(x - r, yy + r * 1.1);
    g.lineTo(x, yy);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = c.p[3];
    g.beginPath();
    g.moveTo(x - r * 0.5, yy + r * 1.05);
    g.lineTo(x + r * 0.5, yy + r * 1.05);
    g.lineTo(x, yy + r * 0.4);
    g.closePath();
    g.fill();
  } else {
    const t = arena.tone(c.p[3]);
    g.fillStyle = c.p[3];
    g.beginPath();
    g.moveTo(x, yy - r * 1.1);
    g.lineTo(x + r, yy - r * 0.3);
    g.lineTo(x, yy + r * 1.1);
    g.lineTo(x - r, yy - r * 0.3);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = t.hi;
    g.beginPath();
    g.moveTo(x, yy - r * 1.1);
    g.lineTo(x + r * 0.4, yy - r * 0.3);
    g.lineTo(x - r * 0.4, yy - r * 0.3);
    g.closePath();
    g.fill();
  }
}

export function drawFlag(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string, k = 1) {
  const c = arena.colors;
  if (k <= 0.01) return;
  const foot = y + size * 0.36;
  g.save();
  g.translate(x, foot);
  g.scale(k, k);
  g.translate(-x, -foot);
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.8;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - size * 0.22, foot);
  g.lineTo(x - size * 0.22, y - size * 0.36);
  g.moveTo(x - size * 0.34, foot);
  g.lineTo(x + size * 0.1, foot);
  g.stroke();
  g.lineCap = 'butt';
  // The cloth flutters a little.
  const f = Math.sin(arena.time * 6 + x) * size * 0.03;
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(x - size * 0.22, y - size * 0.36);
  g.quadraticCurveTo(x + size * 0.05, y - size * 0.3 + f, x + size * 0.32, y - size * 0.18 + f);
  g.lineTo(x - size * 0.22, y);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

export function drawMine(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string) {
  const c = arena.colors;
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw;
  g.lineCap = 'round';
  g.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 4;
    g.moveTo(x - Math.cos(a) * size * 0.36, y - Math.sin(a) * size * 0.36);
    g.lineTo(x + Math.cos(a) * size * 0.36, y + Math.sin(a) * size * 0.36);
  }
  g.stroke();
  g.lineCap = 'butt';
  arena.ball(g, x, y, size * 0.25, fill, false);
}
