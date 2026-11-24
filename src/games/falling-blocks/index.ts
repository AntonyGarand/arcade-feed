import './style.css';
import { L, P } from '../../core/i18n';
import { btn } from '../../core/pad';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { alpha } from '../../kits/arena/color';
import { outBack, outCubic } from '../../kits/arena/ease';
import { gestures, keyDir } from '../../kits/gesture/gesture';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  COLS,
  createLevel,
  dropDistance,
  GARBAGE,
  goalFor,
  hardDrop,
  LINE_POINTS,
  move,
  rotate,
  ROWS,
  shapeCells,
  softDrop,
  step,
  type StepEvents,
} from './rules';

const CELL = 15;
const FX = 8;
const FY = 8;
const PANEL = FX + COLS * CELL + 10;
const W = PANEL + 64;
const H = FY * 2 + ROWS * CELL;
const CLEAR_S = 0.3;
/** The stack's top row from which the spawn area starts to glow red (lower rows: worse). */
const DANGER = 7;

export const fallingBlocks: GameDef = {
  id: 'falling-blocks',
  get name() {
    return L('Falling Blocks', 'Blocs tombants');
  },
  get rules() {
    return L('Fill rows with falling blocks to clear them.', 'Remplissez des rangées de blocs pour les effacer.');
  },
  category: 'stack',
  help: () => ({
    goal: L(
      'Clear the number of lines shown before the stack reaches the top.',
      'Effacez le nombre de lignes demandé avant que la pile atteigne le haut.',
    ),
    steps: [
      L(
        'Blocks of four fall one at a time. A full row of cells vanishes.',
        'Des blocs de quatre tombent un à la fois. Une rangée pleine disparaît.',
      ),
      L(
        'The level starts with rows of grey rubble: fill their gaps to clear them.',
        'Le niveau commence avec des rangées de débris gris : comblez leurs trous pour les effacer.',
      ),
      L('If a block can’t enter at the top, the run is over.', 'Si un bloc ne peut plus entrer par le haut, la partie est finie.'),
      L(
        'Drag left or right to move, tap to turn, swipe down to drop.',
        'Glissez à gauche ou à droite pour déplacer, touchez pour tourner, balayez vers le bas pour lâcher.',
      ),
      L(
        'Keyboard: ← → or A D move, ↑ W or X turn (Z the other way), ↓ S soft drop, Space drop.',
        'Clavier : ← → ou A D déplacent, ↑ W ou X tournent (Z dans l’autre sens), ↓ S descend, Espace lâche.',
      ),
    ],
    tips: [
      L(
        `Clearing several rows at once pays more: ${LINE_POINTS.slice(1).join(', ')}.`,
        `Effacer plusieurs rangées d’un coup rapporte plus : ${LINE_POINTS.slice(1).join(', ')}.`,
      ),
      L('Dropping a block early earns 2 points per row.', 'Lâcher un bloc tôt rapporte 2 points par rangée.'),
    ],
  }),
  stars: (d) => [goalFor(d) * 110 + 350, goalFor(d) * 160 + 450],
  par: (d) => goalFor(d) * 7 + 20,
  pad: () => ({
    left: [
      btn('ArrowLeft', 'left', L('Left', 'Gauche'), true),
      btn('ArrowDown', 'down', L('Soft drop', 'Descendre'), true),
      btn('ArrowRight', 'right', L('Right', 'Droite'), true),
    ],
    right: [btn('x', 'cw', L('Turn', 'Tourner')), btn(' ', 'drop', L('Drop', 'Lâcher'))],
  }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    let done = false;
    let won = false;
    /** Arena time the run ended (the stack greys out row by row on a loss). */
    let endAt = 0;
    // Drag: the piece follows the finger column by column; going down soft-drops row by row.
    let anchor: { x: number; y: number; col: number } | null = null;
    /** The board and piece just before the last action, to know what a lock or a clear removed. */
    const snap = new Int8Array(COLS * ROWS);
    let prePiece = s.piece;
    /** Rows being cleared: their cells' colours (row-major), drawn fading out over CLEAR_S. */
    let clearRows: number[] = [];
    let clearCells: number[] = [];
    let clearAt = -1;
    /** Cells of the piece that just locked, flashing white. */
    let lockCells: number[] = [];
    let lockAt = -1;
    /** Hard-drop streak: the piece's columns and the rows it fell through. */
    let streak: { cols: number[]; from: number; to: number; at: number } | null = null;
    /** Lines shown on the side bar (it catches up with the count), and when the count last went up. */
    let barLines = 0;
    let linesAt = -10;

    const status = () => ctx.status(P(Math.max(0, s.goal - s.lines), ['line to go', 'lines to go'], ['ligne à faire', 'lignes à faire']));

    function remember() {
      snap.set(s.grid);
      prePiece = s.piece;
    }

    function apply(ev: StepEvents, dropped = 0) {
      if (done) return;
      const c = arena.colors;
      if (ev.locked) {
        if (ev.cleared.length) {
          sfx('combo', { step: ev.cleared.length + 1 });
          sfx('pop', { vol: 0.6 });
          if (ev.cleared.length >= 4) haptic(30);
        } else sfx('hit', { vol: 0.7 });
        anchor = null;
        const p = prePiece;
        const y0 = p.y + dropped;
        lockCells = [];
        for (const [cx, cy] of shapeCells(p.k, p.rot)) if (y0 + cy >= 0) lockCells.push((y0 + cy) * COLS + p.x + cx);
        lockAt = arena.time;
        if (ev.cleared.length) {
          clearRows = ev.cleared.slice();
          clearCells = [];
          for (const r of clearRows)
            for (let col = 0; col < COLS; col++) {
              const i = r * COLS + col;
              const k = lockCells.includes(i) ? p.k : snap[i];
              clearCells.push(k);
              const fill = k === GARBAGE ? c.muted : (c.p[k] ?? c.muted);
              fx.burst(FX + (col + 0.5) * CELL, FY + (r + 0.5) * CELL, fill, 3, 120, 3, 0.55);
            }
          clearAt = arena.time;
          lockCells = [];
          const n = ev.cleared.length;
          const my = FY + (clearRows.reduce((a, r) => a + r, 0) / n + 0.5) * CELL;
          fx.text(FX + (COLS * CELL) / 2, my, `+${LINE_POINTS[n]}`, n > 1 ? c.accent : c.fg, 13 + n * 2);
          if (n > 1) {
            const word = ['', '', L('Double!', 'Double!'), L('Triple!', 'Triple!'), L('Quadruple!', 'Quadruple!')][Math.min(4, n)];
            fx.text(FX + (COLS * CELL) / 2, my - 22, word, c.accent, 15 + n * 2, 1.1);
          }
          fx.shake(1 + n, 0.25);
          if (n > 1) {
            fx.ring(FX + (COLS * CELL) / 2, my, c.accent, 10, COLS * CELL * 0.7, 0.45, arena.lw * (1 + n * 0.3));
            fx.flash(n >= 4 ? c.accent : c.paper, n >= 4 ? 0.3 : 0.14, 0.3);
          }
          linesAt = arena.time;
          status();
        }
      }
      ctx.score(s.score);
      if (ev.won || ev.over) {
        done = true;
        won = ev.won;
        barLines = s.lines;
        endAt = arena.time;
        if (won) {
          for (let i = 0; i < 4; i++) fx.burst(FX + (COLS * CELL) / 2, FY + ROWS * CELL * 0.5, c.p[i], 10, 200, 4, 0.9, 'square', 200);
          fx.flash(c.good, 0.22, 0.5);
        } else {
          fx.shake(4, 0.4);
          fx.flash(c.bad, 0.2, 0.4);
        }
        arena.linger(1.4);
        draw();
        if (won) ctx.win();
        else ctx.lose();
      }
    }

    function hard() {
      remember();
      const n = dropDistance(s);
      const p = s.piece;
      const cols = [...new Set(shapeCells(p.k, p.rot).map(([cx]) => p.x + cx))];
      const top = Math.min(...shapeCells(p.k, p.rot).map(([, cy]) => p.y + cy));
      streak = { cols, from: top, to: top + n, at: arena.time };
      const ev = hardDrop(s);
      if (n > 0) {
        fx.shake(1.5, 0.15);
        haptic(15);
        const bottom = Math.max(...shapeCells(p.k, p.rot).map(([, cy]) => p.y + cy)) + n + 1;
        for (const col of cols)
          fx.burst(FX + (col + 0.5) * CELL, FY + bottom * CELL, arena.colors.muted, 2, 60, 2.5, 0.35, 'dot', 120, -Math.PI / 2, 2.4);
      }
      apply(ev, n);
    }

    function nudge(dx: number) {
      const ok = move(s, dx);
      if (ok) sfx('tick', { vol: 0.3 });
      return ok;
    }

    function turn(dir: 1 | -1) {
      if (rotate(s, dir)) sfx('tick', { vol: 0.4, pitch: 5 });
    }

    function soft() {
      remember();
      apply(softDrop(s));
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const tone = (k: number) => (k === GARBAGE ? c.muted : c.p[k]);
      arena.field(g, FX, FY, COLS * CELL, ROWS * CELL, CELL, 3);
      // On a loss, the stack greys out from the bottom up.
      const grey = done && !won ? Math.floor(((arena.time - endAt) / 0.9) * ROWS) : -1;
      for (let i = 0; i < COLS * ROWS; i++) {
        const k = s.grid[i];
        if (k < 0) continue;
        const row = Math.floor(i / COLS);
        const x = FX + (i % COLS) * CELL;
        const y = FY + row * CELL;
        const dead = grey >= 0 && ROWS - row <= grey;
        arena.block(g, x, y, CELL, CELL, dead ? c.muted : tone(k), 2.5, false);
        if (k === GARBAGE && !dead) {
          // Rubble: a couple of pits.
          g.fillStyle = arena.tone(c.muted).lo;
          g.beginPath();
          g.arc(x + CELL * 0.32, y + CELL * 0.36, 1.2, 0, Math.PI * 2);
          g.arc(x + CELL * 0.66, y + CELL * 0.58, 1, 0, Math.PI * 2);
          g.fill();
        }
      }
      // The piece that just locked flashes white.
      const la = arena.time - lockAt;
      if (lockCells.length && la < 0.16) {
        g.globalAlpha = 0.7 * (1 - la / 0.16);
        g.fillStyle = c.paper;
        for (const i of lockCells) g.fillRect(FX + (i % COLS) * CELL, FY + Math.floor(i / COLS) * CELL, CELL, CELL);
        g.globalAlpha = 1;
      }
      // Cleared rows: their cells shrink away inside a white band that closes up.
      const ca = (arena.time - clearAt) / CLEAR_S;
      if (clearRows.length && ca < 1) {
        const e = outCubic(ca);
        clearRows.forEach((r, j) => {
          const y = FY + r * CELL;
          for (let col = 0; col < COLS; col++) {
            const k = clearCells[j * COLS + col];
            const sz = CELL * (1 - e);
            if (sz > 0.5) arena.block(g, FX + col * CELL + (CELL - sz) / 2, y + (CELL - sz) / 2, sz, sz, tone(k), 2, false, 0.6);
          }
          g.globalAlpha = 0.85 * (1 - ca);
          g.fillStyle = c.paper;
          const bh = CELL * (1 - e * 0.8);
          g.fillRect(FX, y + (CELL - bh) / 2, COLS * CELL, bh);
          g.globalAlpha = 1;
        });
      }
      // Hard-drop streak.
      // Hard-drop streak: a trail in the piece's colour, solid where it landed, fading up to where it fell from.
      if (streak && arena.time - streak.at < 0.22 && streak.to > streak.from) {
        const f = 1 - (arena.time - streak.at) / 0.22;
        const y0 = FY + Math.max(0, streak.from) * CELL;
        const y1 = FY + streak.to * CELL + CELL;
        const trail = g.createLinearGradient(0, y0, 0, y1);
        trail.addColorStop(0, alpha(tone(prePiece.k), 0));
        trail.addColorStop(1, alpha(tone(prePiece.k), 0.55));
        g.fillStyle = trail;
        g.globalAlpha = f;
        for (const col of streak.cols) g.fillRect(FX + col * CELL + 2.5, y0, CELL - 5, y1 - y0);
        g.globalAlpha = 1;
      }
      // Danger: the stack is near the top, so the spawn rows glow red and pulse.
      if (!done) {
        let top = ROWS;
        for (let i = 0; i < COLS * ROWS; i++)
          if (s.grid[i] >= 0) {
            top = Math.floor(i / COLS);
            break;
          }
        const risk = Math.min(1, Math.max(0, (DANGER - top) / (DANGER - 1)));
        if (risk > 0) {
          const beat = 0.65 + 0.35 * Math.sin(arena.time * (5 + risk * 5));
          const band = g.createLinearGradient(0, FY, 0, FY + 5 * CELL);
          band.addColorStop(0, alpha(c.bad, 0.45 * risk * beat));
          band.addColorStop(1, alpha(c.bad, 0));
          g.fillStyle = band;
          g.fillRect(FX, FY, COLS * CELL, 5 * CELL);
          g.strokeStyle = c.bad;
          g.globalAlpha = 0.5 + 0.5 * risk * beat;
          g.lineWidth = arena.lw * 0.6;
          g.setLineDash([4, 3]);
          g.beginPath();
          g.moveTo(FX, FY + 2 * CELL);
          g.lineTo(FX + COLS * CELL, FY + 2 * CELL);
          g.stroke();
          g.setLineDash([]);
          g.globalAlpha = 1;
        }
      }
      if (!done) {
        const { k, rot, x, y } = s.piece;
        const ghost = y + dropDistance(s);
        const t = arena.tone(tone(k));
        g.fillStyle = t.glow;
        g.strokeStyle = t.edge;
        g.lineWidth = arena.lw * 0.5;
        g.setLineDash([3, 2]);
        for (const [cx, cy] of shapeCells(k, rot))
          if (ghost + cy >= 0) {
            g.beginPath();
            g.roundRect(FX + (x + cx) * CELL + 1.5, FY + (ghost + cy) * CELL + 1.5, CELL - 3, CELL - 3, arena.r(2));
            g.globalAlpha = 0.55;
            g.fill();
            g.globalAlpha = 1;
            g.stroke();
          }
        g.setLineDash([]);
        for (const [cx, cy] of shapeCells(k, rot))
          if (y + cy >= 0) arena.block(g, FX + (x + cx) * CELL, FY + (y + cy) * CELL, CELL, CELL, tone(k), 2.5, true);
      }

      // Side panel: the next block in a tray, then progress towards the goal.
      const px = PANEL + 2;
      const pw = 50;
      g.fillStyle = c.muted;
      g.font = `700 9px ${arena.family}`;
      g.textAlign = 'center';
      g.fillText(L('NEXT', 'SUIVANT'), px + pw / 2, FY + 9);
      arena.block(g, px, FY + 14, pw, 40, c.cellAlt, 6, true, 0);
      const nk = s.queue[0];
      const nc = shapeCells(nk, 0);
      const minX = Math.min(...nc.map(([x]) => x));
      const spanX = Math.max(...nc.map(([x]) => x)) - minX + 1;
      const minY = Math.min(...nc.map(([, y]) => y));
      const spanY = Math.max(...nc.map(([, y]) => y)) - minY + 1;
      const sz = 10;
      const bob = Math.sin(arena.time * 3) * 0.8;
      for (const [x, y] of nc)
        arena.block(
          g,
          px + pw / 2 - (spanX * sz) / 2 + (x - minX) * sz,
          FY + 34 - (spanY * sz) / 2 + (y - minY) * sz + bob,
          sz,
          sz,
          tone(nk),
          2,
          false,
        );
      const barTop = FY + 74;
      const barH = ROWS * CELL - 96;
      // The bar fills up smoothly after a clear, with a notch per line to go.
      const inner = barH - 6;
      const fill = Math.min(1, barLines / s.goal) * inner;
      g.fillStyle = c.muted;
      g.fillText(L('LINES', 'LIGNES'), px + pw / 2, barTop - 6);
      arena.block(g, PANEL + 15, barTop, 24, barH, c.cellAlt, 8, true, 0);
      if (fill > 1) arena.block(g, PANEL + 18, barTop + barH - 3 - fill, 18, fill, c.accent, 6, false);
      g.strokeStyle = alpha(c.ink, 0.35);
      g.lineWidth = arena.lw * 0.45;
      g.beginPath();
      for (let i = 1; i < s.goal; i++) {
        const y = barTop + barH - 3 - (inner * i) / s.goal;
        g.moveTo(PANEL + 20, y);
        g.lineTo(PANEL + 34, y);
      }
      g.stroke();
      const bump = 1 + 0.35 * (1 - outBack(Math.min(1, (arena.time - linesAt) * 3)));
      g.save();
      g.translate(px + pw / 2, barTop + barH + 14);
      g.scale(bump, bump);
      g.fillStyle = bump > 1.02 ? c.accent : c.fg;
      g.font = `800 13px ${arena.family}`;
      g.textBaseline = 'middle';
      g.fillText(`${s.lines}/${s.goal}`, 0, 0);
      g.restore();
      g.textBaseline = 'alphabetic';
      arena.overlay(g);
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CELL * 0.6,
      onDown(p) {
        anchor = { x: p.x, y: p.y, col: s.piece.x };
      },
      onMove(p, from) {
        if (!from || done) return;
        anchor ??= { x: p.x, y: p.y, col: s.piece.x };
        const want = anchor.col + Math.round((p.x - anchor.x) / CELL);
        while (s.piece.x < want && nudge(1));
        while (s.piece.x > want && nudge(-1));
        // A lock clears the anchor (`apply`): the next piece starts a fresh drag.
        for (let a: typeof anchor = anchor; a && p.y - a.y > CELL * 1.2; a = anchor) {
          a.y += CELL;
          soft();
        }
        draw();
      },
      onTap() {
        if (!done) turn(1);
        draw();
      },
      onRelease(p, from, v) {
        if (done) return;
        const dy = p.y - from.y;
        if (v.y > 450 && dy > CELL * 1.5 && Math.abs(dy) > Math.abs(p.x - from.x)) hard();
        anchor = null;
        draw();
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        arena.update(dt);
        barLines += (s.lines - barLines) * Math.min(1, dt * 8);
        if (!done) {
          remember();
          apply(step(s, dt));
        }
        draw();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = keyDir(e.key);
        if (dir === -1 && k !== 'x' && k !== 'z' && k !== ' ') return false;
        if (e.type !== 'keydown' || done) return true;
        if (k === ' ') hard();
        else if (k === 'z') turn(-1);
        else if (dir === 0 || k === 'x') turn(1);
        else if (dir === 2) soft();
        else nudge(dir === 1 ? 1 : -1);
        draw();
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
