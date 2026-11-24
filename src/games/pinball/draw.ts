import { L } from '../../core/i18n';
import type { Arena } from '../../kits/arena/arena';
import { COMBO_WINDOW, FRENZY_S, GUARD, GUARD_S, H, LANE_X, MID, SAUCER_R, SLING, STAR_R, type State, VORTEX_R } from './table';

/** Palette slot for the slingshots. */
export const SLING_P = 3;

/** The two slingshots; `kickL` / `kickR` (0…1) flash the one that just kicked. */
export function drawSlings(arena: Arena, g: CanvasRenderingContext2D, kickL: number, kickR: number) {
  const c = arena.colors;
  // Slingshots: a rubber face that flashes when it kicks.
  for (const side of [0, 1]) {
    const m = (x: number) => (side ? 2 * MID - x : x);
    const fill = c.p[SLING_P];
    const tone = arena.tone(fill);
    const k = side ? kickR : kickL;
    g.beginPath();
    g.moveTo(m(SLING.ax), SLING.ay);
    g.lineTo(m(SLING.bx), SLING.by);
    g.lineTo(m(SLING.cx), SLING.cy);
    g.closePath();
    g.fillStyle = k > 0 ? tone.hi : fill;
    g.fill();
    g.strokeStyle = tone.edge;
    g.lineWidth = arena.lw * 0.8;
    g.lineJoin = 'round';
    g.stroke();
    const bulge = 3 * k;
    const nx = side ? -0.92 : 0.92;
    g.strokeStyle = k > 0 ? c.paper : tone.hi;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(m(SLING.ax) + nx * 1.5, SLING.ay + 3);
    g.quadraticCurveTo(
      (m(SLING.ax) + m(SLING.cx)) / 2 + nx * (2 + bulge),
      (SLING.ay + SLING.cy) / 2 - 1,
      m(SLING.cx) - nx * 1,
      SLING.cy - 3,
    );
    g.stroke();
  }
}

/** The kind's extras: the black hole, the kickout saucer and the stars (`saucerK` / `swallowK` flash them). */
export function drawExtras(arena: Arena, g: CanvasRenderingContext2D, s: State, saucerK: number, swallowK: number) {
  const c = arena.colors;
  const t = arena.time;
  // Black hole: a dark swirl whose arms turn towards the core.
  if (s.vortex) {
    const v = s.vortex;
    const k = swallowK;
    g.fillStyle = arena.tone(c.bad).glow;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.arc(v.x, v.y, VORTEX_R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = c.bad;
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    g.globalAlpha = 0.7;
    for (let arm = 0; arm < 4; arm++) {
      g.beginPath();
      for (let j = 0; j <= 12; j++) {
        const r = v.r + 2 + (j / 12) * (VORTEX_R * 0.7);
        const a = -t * 2.4 + arm * (Math.PI / 2) + j * 0.32;
        const x = v.x + Math.cos(a) * r;
        const y = v.y + Math.sin(a) * r;
        if (j) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.lineCap = 'butt';
    arena.disc(g, v.x, v.y, v.r + 2 + k * 4, c.coal);
    arena.disc(g, v.x, v.y, v.r * 0.45, c.bad);
  }

  // Kickout saucer: a sunken cup with a lamp per catch so far (it pays more each time).
  if (s.saucer) {
    const sc = s.saucer;
    const k = saucerK;
    const fill = c.p[4];
    if (k > 0) {
      g.fillStyle = arena.tone(fill).glow;
      g.beginPath();
      g.arc(sc.x, sc.y, SAUCER_R + 4 + 6 * k, 0, Math.PI * 2);
      g.fill();
    }
    arena.disc(g, sc.x, sc.y, SAUCER_R + 3, arena.tone(fill).edge);
    arena.disc(g, sc.x, sc.y, SAUCER_R, c.coal);
    for (let j = 0; j < 4; j++) arena.disc(g, sc.x - 9 + j * 6, sc.y + SAUCER_R + 8, 2, j < sc.n ? fill : c.cellAlt);
  }

  // Stars to roll over: a slowly turning five-point star.
  for (const q of s.stars) {
    if (!q.on) continue;
    const pulse = 1 + 0.08 * Math.sin(t * 5 + q.x);
    g.fillStyle = arena.tone(c.accent).glow;
    g.beginPath();
    g.arc(q.x, q.y, STAR_R + 3, 0, Math.PI * 2);
    g.fill();
    arena.gem(
      g,
      q.x,
      q.y,
      STAR_R * pulse,
      c.accent,
      (p, r) => {
        p.beginPath();
        for (let j = 0; j < 10; j++) {
          const a = t * 0.8 + (j * Math.PI) / 5 - Math.PI / 2;
          const rr = j % 2 ? r * 0.45 : r;
          p.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        p.closePath();
      },
      false,
    );
  }
}

/** Combo rewards in play: the drain guard post, the combo / frenzy / guard meters and the frenzy sign. */
export function drawPowers(arena: Arena, g: CanvasRenderingContext2D, s: State) {
  const c = arena.colors;
  const t = arena.time;
  // Drain guard: a post between the flippers, blinking as it runs out.
  if (s.guard > 0 && (s.guard > 2 || Math.sin(t * 16) > 0)) {
    g.fillStyle = arena.tone(c.good).glow;
    g.beginPath();
    g.arc(GUARD.x, GUARD.y, GUARD.r + 3, 0, Math.PI * 2);
    g.fill();
    arena.ball(g, GUARD.x, GUARD.y, GUARD.r, c.good, false);
  }

  // Meters along the bottom: the combo window, then the frenzy and drain guard timers.
  const meters: [number, string][] = [];
  if (s.combo > 1) meters.push([s.comboLeft / COMBO_WINDOW, c.accent]);
  if (s.frenzy > 0) meters.push([s.frenzy / FRENZY_S, c.bad]);
  if (s.guard > 0) meters.push([s.guard / GUARD_S, c.good]);
  g.globalAlpha = 0.85;
  for (let j = 0; j < meters.length; j++) {
    const [k, col] = meters[j];
    g.fillStyle = col;
    g.fillRect(8, H - 5 - j * 5, (LANE_X - 24) * Math.max(0, Math.min(1, k)), 3);
  }
  g.globalAlpha = 1;
  if (s.frenzy > 0) {
    g.fillStyle = c.bad;
    g.font = `800 10px ${arena.family}`;
    g.globalAlpha = 0.65 + 0.35 * Math.sin(t * 10);
    g.fillText(L('FRENZY ×2', 'FRÉNÉSIE ×2'), MID, 302);
    g.globalAlpha = 1;
  }
}
