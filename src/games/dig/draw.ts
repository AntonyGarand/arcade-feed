import { L } from '../../core/i18n';
import type { Arena, Trace } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { CELL, PURIFY_S, STREAK_GAP, STREAK_TIERS, type State } from './rules';

/** Moles: a burrow mound at home, the mole (peeking while it waits), a dotted line to the gem it's after. */
export function drawMoles(g: CanvasRenderingContext2D, arena: Arena, s: State, star: Trace) {
  const c = arena.colors;
  const T = arena.time;
  const fur = mix(c.p[0], c.coal, 0.62);
  for (const [k, m] of s.moles.entries()) {
    const hx = (m.home.x + 0.5) * CELL;
    const hy = (m.home.y + 0.5) * CELL;
    // The burrow: a dark hole with a rim of churned earth.
    arena.disc(g, hx, hy, 6, mix(fur, c.coal, 0.5));
    g.strokeStyle = arena.tone(fur).hi;
    g.lineWidth = arena.lw * 0.7;
    g.beginPath();
    g.arc(hx, hy, 7, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
    if (m.gone) continue;
    const x = (m.x + 0.5) * CELL;
    const y = (m.y + 0.5) * CELL;
    const waiting = m.wait > 0;
    // Threat line to the gem it's going for.
    if (!waiting && !m.carrying && m.target >= 0) {
      const gem = s.gems[m.target];
      g.strokeStyle = c.bad;
      g.lineWidth = arena.lw * 0.7;
      g.globalAlpha = 0.6;
      g.setLineDash([2, 4]);
      g.lineDashOffset = -T * 12;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo((gem.x + 0.5) * CELL, (gem.y + 0.5) * CELL);
      g.stroke();
      g.setLineDash([]);
      g.lineDashOffset = 0;
      g.globalAlpha = 1;
    }
    const r = waiting ? 4.2 : 5.5;
    const wob = waiting ? 0 : Math.sin(T * 14 + k) * 0.6;
    const face = (m.carrying ? m.home.x : m.target >= 0 ? s.gems[m.target].x : m.x) >= m.x ? 1 : -1;
    g.save();
    g.translate(x, y + wob);
    if (arena.sh) {
      g.fillStyle = c.drop;
      g.beginPath();
      g.ellipse(arena.sh * 0.5, arena.sh * 0.5, r * 1.25, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = fur;
    g.strokeStyle = arena.tone(fur).edge;
    g.lineWidth = arena.lw * 0.7;
    g.beginPath();
    g.ellipse(0, 0, r * 1.25, r, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // Snout and nose, eyes, and digging claws.
    g.fillStyle = c.p[6];
    g.beginPath();
    g.arc(face * r * 1.25, 0.3, r * 0.32, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.paper;
    g.beginPath();
    g.arc(face * r * 0.55, -r * 0.35, r * 0.22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.coal;
    g.beginPath();
    g.arc(face * r * 0.6, -r * 0.35, r * 0.11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = c.paper;
    g.lineWidth = 0.8;
    g.beginPath();
    for (const o of [-0.25, 0.25]) {
      g.moveTo(face * r * 0.9, r * (0.6 + o * 0.3));
      g.lineTo(face * r * 1.25, r * (0.9 + o * 0.3));
    }
    g.stroke();
    g.restore();
    if (m.carrying) arena.gem(g, x, y - r - 4, 4, c.p[6], star, false, 1, Math.sin(T * 6) * 0.3);
    if (waiting && s.dug) {
      // Zz… while it rests in its burrow.
      g.fillStyle = c.muted;
      g.font = `700 7px ${arena.family}`;
      g.textAlign = 'center';
      g.fillText('z', x + 6, y - 6 - ((T * 4) % 3));
    }
  }
}

/** The flow combo: its count and a bar draining between arrivals, with the ×2 badge while it pays double. */
export function drawStreak(g: CanvasRenderingContext2D, arena: Arena, s: State) {
  if (!s.streak) return;
  const c = arena.colors;
  const x = 6;
  const y = 6;
  const w = 86;
  const next = STREAK_TIERS[s.tier] as number | undefined;
  const prev = s.tier ? STREAK_TIERS[s.tier - 1] : 0;
  arena.box(g, x, y, w, 22, c.cell, 4, false);
  g.fillStyle = s.double ? c.p[3] : c.accent;
  g.font = `800 11px ${arena.family}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(`${L('Flow', 'Flot')} ×${s.streak}`, x + 5, y + 8.5);
  if (s.double) {
    arena.disc(g, x + w - 11, y + 9, 8, c.p[3]);
    g.fillStyle = c.coal;
    g.font = `900 8px ${arena.family}`;
    g.textAlign = 'center';
    g.fillText('×2', x + w - 11, y + 9.5);
  }
  // Progress to the next milestone, and the time before the flow counts as stopped.
  const f = next ? (s.streak - prev) / (next - prev) : 1;
  g.fillStyle = c.cellAlt;
  g.fillRect(x + 5, y + 16, w - 10, 2.5);
  g.fillStyle = s.double ? c.p[3] : c.accent;
  g.fillRect(x + 5, y + 16, (w - 10) * f, 2.5);
  g.fillStyle = c.fg;
  g.globalAlpha = 0.5;
  g.fillRect(x + 5, y + 19, (w - 10) * Math.max(0, 1 - s.gap / STREAK_GAP), 1.2);
  g.globalAlpha = 1;
  g.textBaseline = 'alphabetic';
}

/** Lava's glow and sparks; while purified, sludge and lava frosted over with the time left as a ring. */
export function drawHazards(g: CanvasRenderingContext2D, arena: Arena, s: State) {
  const c = arena.colors;
  const T = arena.time;
  // Lava: a slow glow and rising sparks.
  const lt = arena.tone(c.bad);
  for (const [k, b] of s.lava.entries()) {
    g.globalAlpha = 0.25 + 0.15 * Math.sin(T * 2.4 + k);
    g.fillStyle = lt.glow;
    g.beginPath();
    g.arc((b.x + 0.5) * CELL, (b.y + 0.5) * CELL, (b.r + 1.4) * CELL, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = lt.hi;
    for (let j = 0; j < 2; j++) {
      const f = (T * 0.9 + k * 0.29 + j * 0.5) % 1;
      g.globalAlpha = 1 - f;
      g.fillRect((b.x + 0.5 + (j ? 0.7 : -0.6)) * CELL, (b.y + 0.5 - f * b.r * 1.4) * CELL, 1.4, 1.4);
    }
  }
  g.globalAlpha = 1;
  // Purified (a combo reward): hazards frosted over, with the time left as a ring.
  if (s.purify > 0) {
    const f = s.purify / PURIFY_S;
    for (const b of [...s.sludge, ...s.lava]) {
      const x = (b.x + 0.5) * CELL;
      const y = (b.y + 0.5) * CELL;
      const r = (b.r + 0.9) * CELL;
      g.globalAlpha = 0.55;
      g.fillStyle = c.cell;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = c.p[5];
      g.lineWidth = arena.lw;
      g.beginPath();
      g.arc(x, y, r + 1.5, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      g.stroke();
    }
  }
}
