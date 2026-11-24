/** Drawing for Rocks' level pieces: the gravity well, mines, the saucer and its shots, iron, the power HUD. */
import { L } from '../../core/i18n';
import type { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { COMBO_WINDOW, CORE_R, H, MINE_R, POWER_S, SHOT_R, type State, UFO_R, type Ufo, W } from './rules';

/** Copies of a thing near an edge, so it shows on both sides while it wraps. */
export function ghosts(x: number, y: number, r: number): [number, number][] {
  const xs = [x, ...(x < r ? [x + W] : x > W - r ? [x - W] : [])];
  const ys = [y, ...(y < r ? [y + H] : y > H - r ? [y - H] : [])];
  return xs.flatMap((gx) => ys.map((gy): [number, number] => [gx, gy]));
}

/** Stone: a solid grey that reads on the dark sky and on paper alike. */
export const stone = (arena: Arena) => mix(arena.colors.fg, arena.colors.cellAlt, arena.dark ? 0.62 : 0.55);
/** Iron: darker and bluer than stone. */
export const iron = (arena: Arena) => mix(mix(stone(arena), arena.colors.coal, arena.dark ? 0.2 : 0.4), arena.colors.p[4], 0.3);

/** Iron marks on a rock already clipped to its outline: two bands across, and a crack once hit. */
export function ironMarks(g: CanvasRenderingContext2D, arena: Arena, x: number, y: number, rad: number, rot: number, cracked: boolean) {
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  g.strokeStyle = arena.tone(iron(arena)).hi;
  g.lineWidth = Math.max(1.5, rad * 0.14);
  for (const k of [-0.35, 0.35]) {
    g.beginPath();
    g.moveTo(x - ca * rad - sa * k * rad, y - sa * rad + ca * k * rad);
    g.lineTo(x + ca * rad - sa * k * rad, y + sa * rad + ca * k * rad);
    g.stroke();
  }
  if (!cracked) return;
  g.strokeStyle = arena.colors.bad;
  g.lineWidth = arena.lw * 0.8;
  g.beginPath();
  g.moveTo(x - rad * 0.5, y - rad * 0.4);
  g.lineTo(x - rad * 0.1, y - rad * 0.05);
  g.lineTo(x - rad * 0.25, y + rad * 0.2);
  g.lineTo(x + rad * 0.35, y + rad * 0.5);
  g.stroke();
}

/** The gravity well: rings closing in on a dark core. */
export function drawWell(g: CanvasRenderingContext2D, arena: Arena, s: State) {
  if (!s.well) return;
  const c = arena.colors;
  const col = c.p[5];
  for (const [x, y] of ghosts(s.well.x, s.well.y, 70)) {
    g.lineWidth = arena.lw * 0.7;
    g.strokeStyle = col;
    for (let i = 0; i < 4; i++) {
      const k = (i + ((arena.time * 0.6) % 1)) / 4;
      g.globalAlpha = 0.45 * k;
      g.beginPath();
      g.arc(x, y, CORE_R + (1 - k) * 58, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = arena.tone(col).glow;
    g.beginPath();
    g.arc(x, y, CORE_R * 1.8, 0, Math.PI * 2);
    g.fill();
    arena.disc(g, x, y, CORE_R, c.coal);
    g.lineWidth = arena.lw;
    g.beginPath();
    g.arc(x, y, CORE_R, arena.time * 3, arena.time * 3 + Math.PI * 1.3);
    g.stroke();
  }
}

/** Mines: dark spiked balls with a blinking red light. */
export function drawMines(g: CanvasRenderingContext2D, arena: Arena, s: State) {
  const c = arena.colors;
  const bad = arena.tone(c.bad);
  for (const m of s.mines)
    for (const [x, y] of ghosts(m.x, m.y, MINE_R * 2)) {
      g.strokeStyle = arena.tone(c.coal).edge;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = m.ph * 0.6 + (i * Math.PI) / 3;
        g.moveTo(x + Math.cos(a) * MINE_R * 0.8, y + Math.sin(a) * MINE_R * 0.8);
        g.lineTo(x + Math.cos(a) * MINE_R * 1.55, y + Math.sin(a) * MINE_R * 1.55);
      }
      g.stroke();
      arena.disc(g, x, y, MINE_R, c.coal);
      const on = Math.sin(m.ph * 5) > 0;
      if (on) {
        g.fillStyle = bad.glow;
        g.beginPath();
        g.arc(x, y, MINE_R * 1.9, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = on ? c.bad : bad.lo;
      g.beginPath();
      g.arc(x, y, MINE_R * 0.38, 0, Math.PI * 2);
      g.fill();
    }
}

/** The saucer: a hull with a glass dome, running lights, and pips for the hits it can still take. */
export function drawUfo(g: CanvasRenderingContext2D, arena: Arena, u: Ufo) {
  const c = arena.colors;
  const t = arena.tone(c.p[6]);
  for (const [x, y] of ghosts(u.x, u.y, UFO_R * 2)) {
    g.lineWidth = arena.lw * 0.7;
    g.strokeStyle = t.edge;
    g.fillStyle = arena.tone(c.p[4]).glow;
    g.beginPath();
    g.ellipse(x, y - UFO_R * 0.25, UFO_R * 0.55, UFO_R * 0.6, 0, Math.PI, 0);
    g.fill();
    g.stroke();
    g.fillStyle = t.base;
    g.beginPath();
    g.ellipse(x, y, UFO_R * 1.2, UFO_R * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    for (let i = 0; i < 5; i++) {
      g.fillStyle = Math.floor(arena.time * 8 + i) % 5 === 0 ? c.accent : t.hi;
      g.beginPath();
      g.arc(x - UFO_R * 0.8 + i * UFO_R * 0.4, y + 1, 1.4, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < u.max; i++) {
      g.fillStyle = i < u.hp ? c.bad : c.muted;
      g.fillRect(x - u.max * 2.5 + i * 5, y - UFO_R * 1.3, 3.5, 2.5);
    }
  }
}

/** Saucer shots: pulsing red sparks. */
export function drawShots(g: CanvasRenderingContext2D, arena: Arena, s: State) {
  const c = arena.colors;
  const glow = arena.tone(c.bad).glow;
  for (const b of s.shots) {
    g.fillStyle = glow;
    g.beginPath();
    g.arc(b.x, b.y, SHOT_R * (1.8 + 0.4 * Math.sin(arena.time * 20)), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.bad;
    g.beginPath();
    g.arc(b.x, b.y, SHOT_R, 0, Math.PI * 2);
    g.fill();
  }
}

/** The combo shield around the ship: a steady ring that soaks the next hit. */
export function drawShield(g: CanvasRenderingContext2D, arena: Arena, x: number, y: number, r: number) {
  g.strokeStyle = arena.colors.good;
  g.lineWidth = arena.lw;
  g.globalAlpha = 0.8;
  g.beginPath();
  g.arc(x, y, r + Math.sin(arena.time * 4), 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;
}

/** Combo meter along the top (drains with the window), and the timers of the powers running. */
export function drawHud(g: CanvasRenderingContext2D, arena: Arena, s: State) {
  const c = arena.colors;
  if (s.combo > 1) {
    g.globalAlpha = 0.85;
    g.fillStyle = c.accent;
    g.fillRect(0, 0, W * Math.max(0, s.comboLeft / COMBO_WINDOW), 3.5);
    g.globalAlpha = 1;
  }
  let y = 12;
  g.font = `800 9px ${arena.family}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const timers = [
    [s.rapid, L('RAPID', 'RAPIDE'), c.p[3]],
    [s.spread, L('TRIPLE', 'TRIPLE'), c.p[4]],
  ] as const;
  for (const [left, label, col] of timers) {
    if (left <= 0) continue;
    g.fillStyle = col;
    g.fillText(label, 6, y);
    g.globalAlpha = 0.85;
    g.fillRect(48, y - 2, 40 * (left / POWER_S), 4);
    g.globalAlpha = 1;
    y += 11;
  }
  if (s.shield) {
    g.fillStyle = c.good;
    g.fillText(L('SHIELD', 'BOUCLIER'), 6, y);
  }
  g.textBaseline = 'alphabetic';
}
