import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures, keyDir } from '../../kits/gesture/gesture';
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
const FLASH_S = 0.25;

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
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    let done = false;
    let flash: number[] = [];
    let flashT = 0;
    // Drag: the piece follows the finger column by column; going down soft-drops row by row.
    let anchor: { x: number; y: number; col: number } | null = null;

    const status = () => ctx.status(P(Math.max(0, s.goal - s.lines), ['line to go', 'lines to go'], ['ligne à faire', 'lignes à faire']));

    function apply(ev: StepEvents) {
      if (done) return;
      if (ev.locked) {
        anchor = null;
        if (ev.cleared.length) {
          flash = ev.cleared;
          flashT = FLASH_S;
          status();
        }
      }
      ctx.score(s.score);
      if (ev.won) {
        done = true;
        draw();
        ctx.win();
      } else if (ev.over) {
        done = true;
        draw();
        ctx.lose();
      }
    }

    function cell(g: CanvasRenderingContext2D, x: number, y: number, fill: string, shadow = false) {
      arena.box(g, FX + x * CELL, FY + y * CELL, CELL, CELL, fill, 2, shadow);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const tone = (k: number) => (k === GARBAGE ? c.muted : c.p[k]);
      g.fillStyle = c.cellAlt;
      g.fillRect(FX, FY, COLS * CELL, ROWS * CELL);
      for (let i = 0; i < COLS * ROWS; i++) if (s.grid[i] >= 0) cell(g, i % COLS, Math.floor(i / COLS), tone(s.grid[i]));
      if (flashT > 0) {
        g.globalAlpha = flashT / FLASH_S;
        g.fillStyle = c.accent;
        for (const r of flash) g.fillRect(FX, FY + r * CELL, COLS * CELL, CELL);
        g.globalAlpha = 1;
      }
      if (!done) {
        const { k, rot, x, y } = s.piece;
        const ghost = y + dropDistance(s);
        g.strokeStyle = c.fg;
        g.lineWidth = arena.lw * 0.6;
        g.setLineDash([3, 2]);
        for (const [cx, cy] of shapeCells(k, rot))
          if (ghost + cy >= 0) g.strokeRect(FX + (x + cx) * CELL + 2, FY + (ghost + cy) * CELL + 2, CELL - 4, CELL - 4);
        g.setLineDash([]);
        for (const [cx, cy] of shapeCells(k, rot)) if (y + cy >= 0) cell(g, x + cx, y + cy, tone(k), true);
      }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.strokeRect(FX, FY, COLS * CELL, ROWS * CELL);

      // Side panel: the next block, then progress towards the goal.
      g.fillStyle = c.fg;
      g.font = "600 10px 'Space Grotesk Variable', system-ui, sans-serif";
      g.textAlign = 'center';
      g.fillText(L('NEXT', 'SUIVANT'), PANEL + 27, FY + 10);
      const nk = s.queue[0];
      const nc = shapeCells(nk, 0);
      const minX = Math.min(...nc.map(([x]) => x));
      const spanX = Math.max(...nc.map(([x]) => x)) - minX + 1;
      const minY = Math.min(...nc.map(([, y]) => y));
      const sz = 11;
      for (const [x, y] of nc)
        arena.box(g, PANEL + 27 - (spanX * sz) / 2 + (x - minX) * sz, FY + 20 + (y - minY) * sz, sz, sz, tone(nk), 2, false);
      const barTop = FY + 70;
      const barH = ROWS * CELL - 90;
      const fill = Math.min(1, s.lines / s.goal) * barH;
      arena.box(g, PANEL + 17, barTop, 20, barH, c.cell);
      if (fill > 0) arena.box(g, PANEL + 17, barTop + barH - fill, 20, fill, c.accent, 3, false);
      g.fillStyle = c.fg;
      g.font = "700 12px 'Space Grotesk Variable', system-ui, sans-serif";
      g.fillText(`${s.lines}/${s.goal}`, PANEL + 27, barTop + barH + 18);
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
        while (s.piece.x < want && move(s, 1));
        while (s.piece.x > want && move(s, -1));
        while (anchor && p.y - anchor.y > CELL * 1.2) {
          anchor.y += CELL;
          apply(softDrop(s));
        }
        draw();
      },
      onTap() {
        if (!done) rotate(s, 1);
        draw();
      },
      onRelease(p, from, v) {
        if (done) return;
        const dy = p.y - from.y;
        if (v.y > 450 && dy > CELL * 1.5 && Math.abs(dy) > Math.abs(p.x - from.x)) apply(hardDrop(s));
        anchor = null;
        draw();
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        if (flashT > 0) flashT = Math.max(0, flashT - dt);
        if (!done) apply(step(s, dt));
        draw();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = keyDir(e.key);
        if (dir === -1 && k !== 'x' && k !== 'z' && k !== ' ') return false;
        if (e.type !== 'keydown' || done) return true;
        if (k === ' ') apply(hardDrop(s));
        else if (k === 'z') rotate(s, -1);
        else if (dir === 0 || k === 'x') rotate(s, 1);
        else if (dir === 2) apply(softDrop(s));
        else move(s, dir === 1 ? 1 : -1);
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
