import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { DX, DY, gestures, keyDir, type Point } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { sfx } from '../../kits/sound/sound';
import {
  CLEAR_BONUS,
  CRATE_POINTS,
  cratesFor,
  createLevel,
  dirTo,
  move,
  MOVE_POINTS,
  type MoveResult,
  onGoal,
  pathTo,
  restart,
  slackFor,
  undo,
  walk,
} from './rules';

const W = 300;
/** Toolbar under the warehouse (undo, moves left, restart). */
const BAR = 56;
const H = W + BAR;
const PAD = 6;
/** Seconds per cell of the keeper's slide. */
const STEP_S = 0.07;
/** Glyph drawn on goals (a diamond). */
const GOAL = 1;
const FONT = "'Space Grotesk Variable', system-ui, sans-serif";

export const crates: GameDef = {
  id: 'crates',
  get name() {
    return L('Crates', 'Caisses');
  },
  get rules() {
    return L('Push every crate onto a goal within the moves.', 'Poussez chaque caisse sur une cible sans épuiser vos coups.');
  },
  category: 'think',
  help: () => ({
    goal: L(
      'Push every crate onto a diamond goal before you run out of moves.',
      'Poussez chaque caisse sur une cible en losange avant d’épuiser vos coups.',
    ),
    steps: [
      L(
        'Walk into a crate to push it one cell. You can push only one at a time, and never pull.',
        'Marchez contre une caisse pour la pousser d’une case. Une seule à la fois, et jamais en tirant.',
      ),
      L(
        'Every step counts as a move. A crate on a goal turns green with a check mark.',
        'Chaque pas compte comme un coup. Une caisse sur une cible devient verte avec un crochet.',
      ),
      L(
        'Undo is free: it takes the move back. Restart returns to the start (and can be undone).',
        'Annuler est gratuit : le coup vous est rendu. Recommencer revient au départ (et peut s’annuler).',
      ),
      L(
        'Swipe to step (keep dragging to keep going), or tap a cell to walk there.',
        'Balayez pour faire un pas (continuez de glisser pour avancer), ou touchez une case pour vous y rendre.',
      ),
      L(
        'Keyboard: arrows or WASD to move, U or Z to undo, R to restart, P to pause.',
        'Clavier : flèches ou WASD pour bouger, U ou Z pour annuler, R pour recommencer, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'A crate pushed into a corner without a goal is stuck for good: undo it.',
        'Une caisse poussée dans un coin sans cible est coincée pour de bon : annulez.',
      ),
      L(
        `${CRATE_POINTS} per crate placed, ${CLEAR_BONUS} for the clear and ${MOVE_POINTS} per move left.`,
        `${CRATE_POINTS} par caisse placée, ${CLEAR_BONUS} pour la réussite et ${MOVE_POINTS} par coup restant.`,
      ),
    ],
  }),
  stars: (d) => {
    const base = CLEAR_BONUS + cratesFor(d) * CRATE_POINTS;
    return [base + Math.ceil(slackFor(d) / 2) * MOVE_POINTS, base + (slackFor(d) - 2) * MOVE_POINTS];
  },
  par: (d) => 20 + cratesFor(d) * 12,
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const n = s.n;
    const cs = (W - 2 * PAD) / n;
    const arena = new Arena(ctx.root, W, H, () => draw());

    /** Cells the keeper slides through (from the previous one), and how far along. */
    let route: number[] = [];
    let routeT = 0;
    /** A pushed crate sliding in: which one and from where. */
    let slide = -1;
    let slideFrom = 0;
    /** Rings popping on goals that just got a crate. */
    const pops: { at: number; t: number }[] = [];
    let bump = 0;

    const undoBtn = { x: PAD + 2, y: W + 8, w: 92, h: BAR - 18 };
    const restartBtn = { x: W - PAD - 2 - 104, y: W + 8, w: 104, h: BAR - 18 };
    const hitBtn = (b: typeof undoBtn, p: Point) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

    const cx = (i: number) => PAD + (i % n) * cs + cs / 2;
    const cy = (i: number) => PAD + Math.floor(i / n) * cs + cs / 2;
    const cellAt = (p: Point) => {
      const c = Math.floor((p.x - PAD) / cs);
      const r = Math.floor((p.y - PAD) / cs);
      return c >= 0 && r >= 0 && c < n && r < n ? r * n + c : -1;
    };

    const status = () =>
      ctx.status(
        [
          P(s.limit - s.moves, ['move left', 'moves left'], ['coup restant', 'coups restants']),
          L(`${onGoal(s)}/${s.crates.length} crates`, `${onGoal(s)}/${s.crates.length} caisses`),
        ].join(' · '),
      );

    function after(res: MoveResult, from: number[], pushed: number) {
      if (!res.moved) {
        bump = 0.15;
        sfx('error');
        draw();
        return;
      }
      if (res.placed && pushed >= 0) sfx('coin');
      else if (res.pushed) sfx('hit');
      else sfx('tick', { vol: 0.4 });
      route = from;
      routeT = 0;
      slide = res.pushed ? pushed : -1;
      if (res.placed && pushed >= 0) pops.push({ at: s.crates[pushed], t: 0 });
      ctx.score(s.score);
      status();
      draw();
      if (res.won) ctx.win();
      else if (res.over) ctx.lose();
    }

    function stepDir(dir: 0 | 1 | 2 | 3) {
      if (s.done) return;
      const from = s.player;
      const ahead = from + DX[dir] + DY[dir] * n;
      const pushed = s.crates.indexOf(ahead);
      slideFrom = ahead;
      after(move(s, dir), [from, s.player], pushed);
    }

    function walkTo(to: number) {
      if (s.done) return;
      const d = dirTo(s, to);
      if (d !== -1) {
        stepDir(d);
        return;
      }
      const path = pathTo(s, to);
      if (!path?.length) {
        bump = 0.15;
        sfx('error');
        return;
      }
      const cells = [s.player];
      for (const k of path) cells.push(cells.at(-1)! + DX[k] + DY[k] * n);
      after(walk(s, path), cells, -1);
    }

    function back(fn: () => boolean) {
      if (!fn()) return;
      route = [];
      slide = -1;
      ctx.score(s.score);
      status();
      draw();
    }

    function keeperPos() {
      if (route.length < 2) return { x: cx(s.player), y: cy(s.player) };
      const f = Math.min(route.length - 1, routeT / STEP_S);
      const k = Math.min(route.length - 2, Math.floor(f));
      const t = f - k;
      return { x: cx(route[k]) + (cx(route[k + 1]) - cx(route[k])) * t, y: cy(route[k]) + (cy(route[k + 1]) - cy(route[k])) * t };
    }

    function drawButton(g: CanvasRenderingContext2D, b: typeof undoBtn, label: string, enabled: boolean) {
      const c = arena.colors;
      arena.box(g, b.x, b.y, b.w, b.h, enabled ? c.cell : c.cellAlt, 8, enabled);
      g.fillStyle = enabled ? c.fg : c.muted;
      g.font = `700 13px ${FONT}`;
      g.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Floor, then only the walls that touch it (the room's outline).
      for (let i = 0; i < n * n; i++) {
        if (s.wall[i]) continue;
        g.fillStyle = ((i % n) + Math.floor(i / n)) % 2 ? c.cellAlt : c.cell;
        g.fillRect(cx(i) - cs / 2, cy(i) - cs / 2, cs, cs);
      }
      for (let i = 0; i < n * n; i++) {
        if (!s.wall[i]) continue;
        const col = i % n;
        const row = Math.floor(i / n);
        let touches = false;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = row + dr;
            const cc = col + dc;
            if (rr >= 0 && cc >= 0 && rr < n && cc < n && !s.wall[rr * n + cc]) touches = true;
          }
        if (touches) arena.box(g, cx(i) - cs / 2 + 1, cy(i) - cs / 2 + 1, cs - 2, cs - 2, c.muted, 4);
      }
      for (let i = 0; i < n * n; i++) {
        if (!s.goal[i]) continue;
        g.fillStyle = c.accent;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.7;
        glyphPath(g, GOAL, cx(i), cy(i), cs * 0.3);
        g.globalAlpha = 0.55;
        g.fill();
        g.globalAlpha = 1;
        g.stroke();
      }
      const won = s.done && onGoal(s) === s.crates.length;
      const slideF = route.length >= 2 ? Math.min(1, routeT / STEP_S) : 1;
      for (const [k, at] of s.crates.entries()) {
        let x = cx(at);
        let y = cy(at);
        if (k === slide && slideF < 1) {
          x = cx(slideFrom) + (x - cx(slideFrom)) * slideF;
          y = cy(slideFrom) + (y - cy(slideFrom)) * slideF;
        }
        const placed = s.goal[at] && slideF >= 1;
        const hop = won ? Math.abs(Math.sin(routeT * 9 + k)) * 3 : 0;
        const m = cs * 0.1;
        arena.box(g, x - cs / 2 + m, y - cs / 2 + m - hop, cs - 2 * m, cs - 2 * m, placed ? c.good : c.accent, 4);
        g.strokeStyle = c.ink;
        g.lineCap = 'round';
        if (placed) {
          // A check mark.
          g.lineWidth = arena.lw * 1.3;
          g.beginPath();
          g.moveTo(x - cs * 0.18, y - hop);
          g.lineTo(x - cs * 0.04, y + cs * 0.14 - hop);
          g.lineTo(x + cs * 0.2, y - cs * 0.14 - hop);
          g.stroke();
        } else {
          // Planks: an inner frame with a cross brace.
          const q = cs / 2 - m - cs * 0.1;
          g.lineWidth = arena.lw * 0.6;
          g.strokeRect(x - q, y - q - hop, 2 * q, 2 * q);
          g.beginPath();
          g.moveTo(x - q, y - q - hop);
          g.lineTo(x + q, y + q - hop);
          g.stroke();
        }
        g.lineCap = 'butt';
      }
      for (const p of pops) {
        g.strokeStyle = c.good;
        g.lineWidth = arena.lw * 1.4 * (1 - p.t / 0.4);
        g.beginPath();
        g.arc(cx(p.at), cy(p.at), cs * (0.45 + p.t * 1.4), 0, Math.PI * 2);
        g.stroke();
      }
      // The keeper, looking the way they last moved (a little nudge when bumping into something).
      const k = keeperPos();
      const nudge = bump > 0 ? Math.sin(bump * 40) * 2 : 0;
      const kx = k.x + DX[s.facing] * nudge;
      const ky = k.y + DY[s.facing] * nudge;
      arena.disc(g, kx, ky, cs * 0.34, s.done && !won ? c.bad : c.p[1]);
      for (const side of [-1, 1]) {
        const ex = kx + DX[s.facing] * cs * 0.12 + DY[s.facing] * side * cs * 0.12;
        const ey = ky + DY[s.facing] * cs * 0.12 + DX[s.facing] * side * cs * 0.12;
        g.fillStyle = c.ink;
        g.beginPath();
        g.arc(ex, ey, cs * 0.055, 0, Math.PI * 2);
        g.fill();
      }
      // Toolbar.
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      drawButton(g, undoBtn, L('Undo', 'Annuler'), s.history.length > 0 && !s.done);
      drawButton(g, restartBtn, L('Restart', 'Recommencer'), s.moves > 0 && !s.done);
      const left = s.limit - s.moves;
      g.fillStyle = left <= 3 ? c.bad : c.fg;
      g.font = `700 22px ${FONT}`;
      const mid = (undoBtn.x + undoBtn.w + restartBtn.x) / 2;
      g.fillText(String(left), mid, W + 20);
      g.fillStyle = c.muted;
      g.font = `600 10px ${FONT}`;
      g.fillText(L('moves left', 'coups restants'), mid, W + 40);
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: cs * 0.6,
      repeat: true,
      onSwipe: (dir, from) => {
        if (from.y < W) stepDir(dir);
      },
      onTap(p) {
        if (hitBtn(undoBtn, p)) back(() => undo(s));
        else if (hitBtn(restartBtn, p)) back(() => restart(s));
        else walkTo(cellAt(p));
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const moving = route.length >= 2 && routeT < (route.length - 1) * STEP_S;
        if (route.length >= 2) routeT += dt;
        if (s.done) routeT += dt; // keeps the win hop going
        for (const p of pops) p.t += dt;
        while (pops.length && pops[0].t > 0.4) pops.shift();
        bump = Math.max(0, bump - dt);
        if (moving || pops.length || bump > 0 || s.done) draw();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = keyDir(e.key);
        const isUndo = k === 'u' || k === 'z' || k === 'backspace';
        if (dir === -1 && !isUndo && k !== 'r') return false;
        if (e.type !== 'keydown') return true;
        if (dir !== -1) stepDir(dir);
        else if (isUndo) back(() => undo(s));
        else back(() => restart(s));
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
