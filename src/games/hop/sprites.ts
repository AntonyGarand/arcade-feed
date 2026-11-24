/** Hop's sprites that don't need the run's state: clouds, bats and critters. */
import type { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { BAT_R, CLOUD_CYCLE, CLOUD_ON, CRIT_R, PLAT_H, type Plat } from './rules';

/** Draws a shape at x and at its wrapped twin when it crosses a side. */
type Wrap = (x: number, hw: number, fn: (x: number) => void) => void;

/** A cloud platform: puffy while solid, blinking just before it vanishes, a dotted outline while gone. */
export function drawCloud(arena: Arena, g: CanvasRenderingContext2D, p: Plat, y: number, time: number, wrapped: Wrap) {
  const c = arena.colors;
  const t = (((time + p.phase) % CLOUD_CYCLE) + CLOUD_CYCLE) % CLOUD_CYCLE;
  const on = t < CLOUD_ON;
  const fading = on && t > CLOUD_ON - 0.5;
  wrapped(p.x, p.w / 2, (x) => {
    if (!on) {
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.6;
      g.setLineDash([3, 4]);
      g.beginPath();
      g.roundRect(x - p.w / 2, y, p.w, PLAT_H, 5);
      g.stroke();
      g.setLineDash([]);
      return;
    }
    g.globalAlpha = fading && Math.sin(arena.time * 30) > 0 ? 0.45 : 1;
    const fill = arena.dark ? mix(c.fg, c.cell, 0.35) : c.paper;
    g.fillStyle = fill;
    g.strokeStyle = c.ink;
    g.lineWidth = arena.lw * 0.7;
    g.beginPath();
    for (const k of [-0.3, 0, 0.3]) g.ellipse(x + k * p.w, y + PLAT_H / 2 - (k ? 0 : 3), p.w * 0.26, PLAT_H * 0.8, 0, 0, Math.PI * 2);
    g.stroke();
    g.fill();
    g.globalAlpha = 1;
  });
}

/** A bat: flapping wings, beady eyes, flying the way it faces. */
export function drawBat(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number, v: number) {
  const c = arena.colors;
  const flap = Math.sin(arena.time * 16 + x * 0.1) * 5;
  g.fillStyle = c.p[6];
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.6;
  for (const k of [-1, 1]) {
    g.beginPath();
    g.moveTo(x + k * 4, y);
    g.lineTo(x + k * (BAT_R + 7), y - 4 - flap);
    g.lineTo(x + k * (BAT_R + 3), y + 3);
    g.lineTo(x + k * (BAT_R - 2), y + 1);
    g.closePath();
    g.fill();
    g.stroke();
  }
  arena.ball(g, x, y, BAT_R * 0.65, c.p[6]);
  const look = Math.sign(v) * 1.5;
  for (const k of [-1, 1]) arena.disc(g, x + k * 2.5 + look, y - 1, 1.6, c.bad);
}

/** A spiky critter: spikes all round the sides and bottom, a smooth shell on top. */
export function drawCritter(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number) {
  const c = arena.colors;
  const wob = Math.sin(arena.time * 8 + x) * 1.2;
  // Spikes all round the sides and bottom; the top is a smooth shell, safe to stomp.
  g.fillStyle = c.ink;
  for (let k = 0; k < 7; k++) {
    const a = -0.2 + (k / 6) * (Math.PI + 0.4);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.beginPath();
    g.moveTo(x + ca * (CRIT_R + 5), y + sa * (CRIT_R + 5) + wob);
    g.lineTo(x + Math.cos(a - 0.3) * CRIT_R, y + Math.sin(a - 0.3) * CRIT_R);
    g.lineTo(x + Math.cos(a + 0.3) * CRIT_R, y + Math.sin(a + 0.3) * CRIT_R);
    g.closePath();
    g.fill();
  }
  arena.ball(g, x, y, CRIT_R, c.bad);
  for (const k of [-1, 1]) {
    arena.disc(g, x + k * 4, y - 1, 2.6, c.paper);
    g.fillStyle = c.coal;
    g.beginPath();
    g.arc(x + k * 4, y - 0.5, 1.2, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = c.ink;
  g.lineWidth = arena.lw * 0.6;
  g.beginPath();
  g.moveTo(x - 6, y - 5.5);
  g.lineTo(x - 2, y - 4);
  g.moveTo(x + 6, y - 5.5);
  g.lineTo(x + 2, y - 4);
  g.stroke();
}
