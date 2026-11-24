import type { Arena } from '../../kits/arena/arena';
import { alpha } from '../../kits/arena/color';
import { BALL_R, CUP_R, gateRect, type State } from './rules';

/** Boost pads, on the grass under everything else. */
export function drawPads(arena: Arena, g: CanvasRenderingContext2D, s: State) {
  const c = arena.colors;
  // Boost pads: a plate with chevrons running along the arrow.
  for (const p of s.pads) {
    const col = c.p[4];
    arena.box(g, p.x, p.y, p.w, p.h, col, 6, false);
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate(p.dir);
    g.strokeStyle = c.paper;
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const x = -5 + i * 8 + ((arena.time * 14) % 8) - 4;
      g.globalAlpha = 0.95 - i * 0.25;
      g.beginPath();
      g.moveTo(x - 4, -6);
      g.lineTo(x + 2, 0);
      g.lineTo(x - 4, 6);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
    g.lineCap = 'butt';
  }
}

/** Sliding gates, coins and the magnet cup's pull, over the walls. */
export function drawExtras(arena: Arena, g: CanvasRenderingContext2D, s: State, magnet: boolean) {
  const c = arena.colors;
  // Sliding gates: striped barriers in their track.
  for (const gate of s.gates) {
    g.fillStyle = alpha(c.coal, 0.18);
    g.fillRect(gate.lo, gate.y - 1.5, gate.hi - gate.lo, 3);
    const r = gateRect(gate, s.t);
    arena.block(g, r.x, r.y, r.w, r.h, c.p[0], 3);
    g.save();
    g.beginPath();
    g.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    g.clip();
    g.fillStyle = c.paper;
    g.globalAlpha = 0.75;
    for (let x = r.x - r.h; x < r.x + r.w; x += 10) {
      g.beginPath();
      g.moveTo(x, r.y + r.h);
      g.lineTo(x + 4, r.y + r.h);
      g.lineTo(x + 4 + r.h, r.y);
      g.lineTo(x + r.h, r.y);
      g.fill();
    }
    g.restore();
    g.globalAlpha = 1;
  }
  // Coins: spinning gold discs.
  for (const coin of s.coins) {
    if (coin.taken) continue;
    const spin = Math.abs(Math.cos(arena.time * 3 + coin.x * 0.1));
    const t = arena.tone(c.p[3]);
    g.fillStyle = t.edge;
    g.beginPath();
    g.ellipse(coin.x, coin.y, 6 * Math.max(0.25, spin) + 0.8, 6.8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.p[3];
    g.beginPath();
    g.ellipse(coin.x, coin.y, 6 * Math.max(0.2, spin), 6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = t.hi;
    g.fillRect(coin.x - 0.8 * spin, coin.y - 3, 1.6 * spin, 6);
  }
  // Magnet cup: rings drawn in towards the hole.
  if (s.magnet && magnet) {
    g.strokeStyle = c.p[4];
    g.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
      const f = (arena.time * 0.8 + i / 2) % 1;
      g.globalAlpha = 0.7 * f;
      g.beginPath();
      g.arc(s.cup.x, s.cup.y, CUP_R + (1 - f) * (CUP_R + BALL_R) * 1.4, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
}
