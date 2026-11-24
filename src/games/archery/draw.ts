/** Drawing helpers for Archery: arrows, wind streaks, the palisade and balloons. */
import type { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { ARROW_LEN, BALLOON_R, balloonY, GROUND, W, type State } from './rules';

/** The palisade: a row of pointed logs with a cross-beam. */
export function drawWall(arena: Arena, g: CanvasRenderingContext2D, s: State) {
  const wl = s.wall;
  if (!wl) return;
  const c = arena.colors;
  const wood = mix(c.p[3], c.coal, 0.35);
  const logs = 3;
  const lw = (wl.w + 6) / logs;
  const x0 = wl.x - 3;
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.6;
  for (let i = 0; i < logs; i++) {
    const x = x0 + i * lw;
    const top = wl.top + (i % 2) * 4;
    g.fillStyle = i % 2 ? arena.tone(wood).lo : wood;
    g.beginPath();
    g.moveTo(x, GROUND);
    g.lineTo(x, top + 5);
    g.lineTo(x + lw / 2, top - 3);
    g.lineTo(x + lw, top + 5);
    g.lineTo(x + lw, GROUND);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.fillStyle = arena.tone(wood).hi;
  for (const y of [wl.top + 18, GROUND - 16]) {
    g.fillRect(x0 - 2, y, wl.w + 10, 4);
    g.strokeRect(x0 - 2, y, wl.w + 10, 4);
  }
}

/** Balloons rising on a string, with a shine. */
export function drawBalloons(arena: Arena, g: CanvasRenderingContext2D, s: State) {
  const c = arena.colors;
  for (const b of s.balloons) {
    if (b.popped) continue;
    const y = balloonY(b, s.time);
    const sway = Math.sin(arena.time * 2 + b.x) * 1.5;
    g.strokeStyle = c.muted;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(b.x + sway, y + BALLOON_R + 2);
    g.quadraticCurveTo(b.x - 3, y + BALLOON_R + 9, b.x + sway, y + BALLOON_R + 16);
    g.stroke();
    const fill = c.p[b.c];
    g.fillStyle = fill;
    g.strokeStyle = c.ink;
    g.lineWidth = arena.lw * 0.6;
    g.beginPath();
    g.ellipse(b.x + sway, y, BALLOON_R * 0.85, BALLOON_R, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(b.x + sway - 2, y + BALLOON_R + 2.5);
    g.lineTo(b.x + sway + 2, y + BALLOON_R + 2.5);
    g.lineTo(b.x + sway, y + BALLOON_R - 0.5);
    g.closePath();
    g.fill();
    g.fillStyle = arena.tone(fill).hi;
    g.beginPath();
    g.ellipse(b.x + sway - 3, y - 3.5, 1.8, 3, -0.4, 0, Math.PI * 2);
    g.fill();
  }
}

export function drawArrow(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number, a: number) {
  const c = arena.colors;
  const tx = x - Math.cos(a) * ARROW_LEN;
  const ty = y - Math.sin(a) * ARROW_LEN;
  g.strokeStyle = c.ink;
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(tx, ty);
  g.lineTo(x - Math.cos(a) * 3, y - Math.sin(a) * 3);
  g.stroke();
  g.lineCap = 'butt';
  // Head.
  g.fillStyle = c.ink;
  g.beginPath();
  g.moveTo(x + Math.cos(a) * 1.5, y + Math.sin(a) * 1.5);
  g.lineTo(x - Math.cos(a) * 5 - Math.sin(a) * 3, y - Math.sin(a) * 5 + Math.cos(a) * 3);
  g.lineTo(x - Math.cos(a) * 5 + Math.sin(a) * 3, y - Math.sin(a) * 5 - Math.cos(a) * 3);
  g.closePath();
  g.fill();
  // Fletching.
  g.fillStyle = c.accent;
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.4;
  for (const k of [-1, 1]) {
    g.beginPath();
    g.moveTo(tx + Math.cos(a) * 8, ty + Math.sin(a) * 8);
    g.lineTo(tx - Math.sin(a) * 4.5 * k, ty + Math.cos(a) * 4.5 * k);
    g.lineTo(tx, ty);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

/** Wind streaks drifting across the sky: their speed and side show the wind at a glance. */
export function drawWind(arena: Arena, g: CanvasRenderingContext2D, w: number) {
  if (!w) return;
  const c = arena.colors;
  const speed = 40 + Math.abs(w) * 1.6;
  const len = 10 + Math.min(30, Math.abs(w) / 4);
  g.strokeStyle = c.muted;
  g.lineWidth = 1.2;
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const span = W + 80;
    const off = (i * 97.3 + arena.time * speed * (0.75 + (i % 3) * 0.15)) % span;
    const x = w > 0 ? off - 40 : W + 40 - off;
    const y = 70 + ((i * 53) % 230);
    g.globalAlpha = 0.18 + (i % 3) * 0.07;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - Math.sign(w) * len, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.lineCap = 'butt';
}
