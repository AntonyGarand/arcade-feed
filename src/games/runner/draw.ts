/** Drawing for Runner's track pieces: coins, the finish flag, birds, tunnels and springs. */
import type { Arena } from '../../kits/arena/arena';
import { BAR_GAP, BIRD_H, COIN_R, GROUND, SPRING_W } from './rules';

export function drawCoin(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number) {
  const c = arena.colors;
  const spin = Math.cos(arena.time * 4 + x * 0.05);
  const rx = COIN_R * (0.3 + 0.7 * Math.abs(spin));
  const t = arena.tone(c.p[3]);
  g.fillStyle = t.lo;
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.7;
  g.beginPath();
  g.ellipse(x, y, rx, COIN_R, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = t.base;
  g.beginPath();
  g.ellipse(x - rx * 0.12, y, rx * 0.78, COIN_R * 0.82, 0, 0, Math.PI * 2);
  g.fill();
  if (Math.abs(spin) > 0.5) {
    g.fillStyle = t.hi;
    g.fillRect(x - rx * 0.2, y - COIN_R * 0.5, rx * 0.35, COIN_R);
  }
  g.beginPath();
  g.ellipse(x, y, rx, COIN_R, 0, 0, Math.PI * 2);
  g.stroke();
}

export function drawFinish(arena: Arena, g: CanvasRenderingContext2D, fl: number) {
  const c = arena.colors;
  g.fillStyle = c.ink;
  g.fillRect(fl - 2, GROUND - 120, 4, 120);
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 4; k++) {
      g.fillStyle = (k + r) % 2 ? c.coal : c.paper;
      g.fillRect(fl + 2 + k * 7, GROUND - 120 + r * 7, 7, 7);
    }
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.6;
  g.strokeRect(fl + 2, GROUND - 120, 28, 21);
}

/** A bird flapping along, beak forward (it flies your way, slower than you run). */
export function drawBird(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number) {
  const c = arena.colors;
  const flap = Math.sin(arena.time * 16 + x * 0.1);
  const t = arena.tone(c.p[5]);
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.6;
  const wing = (fill: string, dx: number, lift: number) => {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x - 3 + dx, y);
    g.lineTo(x - 8 + dx, y - 3 - lift);
    g.lineTo(x + 4 + dx, y - 1);
    g.closePath();
    g.fill();
    g.stroke();
  };
  wing(t.lo, 2, flap * 7 + 2);
  g.fillStyle = t.base;
  g.beginPath();
  g.ellipse(x, y, 10, BIRD_H / 2, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = c.p[3];
  g.beginPath();
  g.moveTo(x + 9, y - 2);
  g.lineTo(x + 15, y);
  g.lineTo(x + 9, y + 2);
  g.closePath();
  g.fill();
  g.stroke();
  wing(t.hi, 0, flap * 6);
  arena.disc(g, x + 5, y - 2, 2.4, c.paper);
  g.fillStyle = c.coal;
  g.fillRect(x + 5.5, y - 2.8, 1.4, 1.4);
}

/** A long low tunnel: a concrete roof down to ducking height, hung from posts, a shadow under it. */
export function drawTunnel(arena: Arena, g: CanvasRenderingContext2D, x: number, w: number) {
  const c = arena.colors;
  const bottom = GROUND - BAR_GAP;
  g.fillStyle = c.ink;
  g.globalAlpha = 0.12;
  g.fillRect(x, bottom, w, BAR_GAP);
  g.globalAlpha = 1;
  g.fillStyle = c.muted;
  for (const px of [x + 6, x + w - 10]) g.fillRect(px, 0, 4, bottom - 30);
  arena.block(g, x, bottom - 32, w, 32, c.cellAlt, 4);
  // Hazard stripes along the lower edge.
  g.save();
  g.beginPath();
  g.rect(x + 1, bottom - 9, w - 2, 7);
  g.clip();
  g.fillStyle = c.p[4];
  g.fillRect(x, bottom - 9, w, 7);
  g.fillStyle = c.coal;
  g.globalAlpha = 0.45;
  for (let k = -10; k < w + 10; k += 12) {
    g.beginPath();
    g.moveTo(x + k, bottom - 2);
    g.lineTo(x + k + 6, bottom - 2);
    g.lineTo(x + k + 13, bottom - 9);
    g.lineTo(x + k + 7, bottom - 9);
    g.fill();
  }
  g.restore();
}

/** A spring pad: base, coil and a top plate under a pulsing up arrow (it pops up after a launch). */
export function drawSpring(arena: Arena, g: CanvasRenderingContext2D, x: number, pop: number) {
  const c = arena.colors;
  const h = 9 + pop * 8;
  g.fillStyle = c.muted;
  g.fillRect(x, GROUND - 3, SPRING_W, 3);
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.8;
  g.beginPath();
  for (let k = 0; k <= 4; k++) g.lineTo(x + (k % 2 ? 5 : SPRING_W - 5), GROUND - 3 - (k * (h - 3)) / 4);
  g.stroke();
  arena.block(g, x - 2, GROUND - h - 5, SPRING_W + 4, 5, c.p[1], 2);
  g.fillStyle = c.p[1];
  g.globalAlpha = 0.6 + 0.4 * Math.sin(arena.time * 6);
  g.beginPath();
  g.moveTo(x + SPRING_W / 2, GROUND - h - 18);
  g.lineTo(x + SPRING_W / 2 + 6, GROUND - h - 10);
  g.lineTo(x + SPRING_W / 2 - 6, GROUND - h - 10);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
}
