/** The level kinds' names, streak rewards' names, and drawing for the special pieces. */
import { L } from '../../core/i18n';
import type { Arena } from '../../kits/arena/arena';
import { BOMB, STONE, type KindId, type Reward } from './rules';

/** Palette slot per bubble colour (most distinct first: orange, blue, green, yellow, purple). */
export const TONE = [0, 1, 2, 3, 4];

/** What each kind of board is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [
    L('Classic', 'Classique'),
    L('Rows of bubbles, a few bombs tucked in.', 'Des rangées de bulles, quelques bombes cachées.'),
  ],
  chandelier: () => [
    L('Chandelier', 'Lustre'),
    L('It hangs by three stems: cut one to drop a side.', 'Il pend par trois tiges : coupez-en une pour l’alléger.'),
  ],
  quarry: () => [
    L('Quarry', 'Carrière'),
    L('Stones never pop: blast them or cut them loose.', 'Les roches n’éclatent pas : faites-les sauter ou tomber.'),
  ],
  glacier: () => [
    L('Glacier', 'Glacier'),
    L('Frozen bubbles thaw when a bubble lands nearby.', 'Les bulles gelées dégèlent quand une bulle se pose à côté.'),
  ],
  minefield: () => [
    L('Minefield', 'Champ de mines'),
    L('Bombs everywhere: pop next to one to set it off.', 'Des bombes partout : éclatez à côté pour les faire sauter.'),
  ],
};

/** What a streak milestone unlocked, for its banner. */
export const REWARD_NAMES: Record<Reward, () => string> = {
  bomb: () => L('Bomb shot loaded!', 'Tir bombe chargé!'),
  lift: () => L('Ceiling lifted!', 'Le plafond remonte!'),
  rainbow: () => L('Rainbow shot loaded!', 'Tir arc-en-ciel chargé!'),
};

/** The main colour of a piece (bubble, stone or bomb), for its particles. */
export const pieceFill = (arena: Arena, k: number) => {
  const c = arena.colors;
  return k === STONE ? c.muted : k === BOMB ? c.coal : (c.p[TONE[k]] ?? c.accent);
};

/** A stone: grey, with a couple of cracks. */
export function drawStone(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const c = arena.colors;
  arena.ball(g, x, y, r, c.muted);
  g.strokeStyle = arena.tone(c.muted).edge;
  g.lineWidth = arena.lw * 0.7;
  g.beginPath();
  g.moveTo(x - r * 0.5, y - r * 0.3);
  g.lineTo(x - r * 0.1, y);
  g.lineTo(x - r * 0.3, y + r * 0.45);
  g.moveTo(x + r * 0.15, y - r * 0.55);
  g.lineTo(x + r * 0.4, y - r * 0.1);
  g.stroke();
}

/** A bomb: a dark ball with a red core and a sparking fuse. */
export function drawBomb(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const c = arena.colors;
  arena.ball(g, x, y, r, c.coal);
  g.fillStyle = c.bad;
  g.beginPath();
  g.arc(x, y + r * 0.1, r * 0.38, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = c.accent;
  g.lineWidth = arena.lw * 0.7;
  g.beginPath();
  g.moveTo(x + r * 0.35, y - r * 0.6);
  g.quadraticCurveTo(x + r * 0.7, y - r * 1.05, x + r * 0.95, y - r * 0.8);
  g.stroke();
  if (Math.sin(arena.time * 14 + x) > 0) {
    g.fillStyle = c.accent;
    g.fillRect(x + r * 0.85, y - r * 0.95, 3, 3);
  }
}

/** A rainbow shot: a ball split into every colour of the level. */
export function drawRainbow(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number, r: number, n: number) {
  const c = arena.colors;
  arena.ball(g, x, y, r, c.paper);
  const spin = arena.time * 2;
  for (let i = 0; i < n; i++) {
    g.fillStyle = c.p[TONE[i]];
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, r * 0.8, spin + (i / n) * Math.PI * 2, spin + ((i + 1) / n) * Math.PI * 2);
    g.closePath();
    g.fill();
  }
  g.fillStyle = c.paper;
  g.beginPath();
  g.arc(x, y, r * 0.28, 0, Math.PI * 2);
  g.fill();
}

/** Ice over a frozen bubble: a pale glaze, a hard rim and a glint. */
export function drawIce(arena: Arena, g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const c = arena.colors;
  g.fillStyle = c.paper;
  g.globalAlpha = 0.45;
  g.beginPath();
  g.arc(x, y, r + 1, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = c.p[1];
  g.lineWidth = arena.lw;
  g.stroke();
  g.strokeStyle = c.paper;
  g.lineWidth = arena.lw * 0.8;
  g.beginPath();
  g.moveTo(x - r * 0.55, y - r * 0.15);
  g.lineTo(x - r * 0.15, y - r * 0.55);
  g.stroke();
}
