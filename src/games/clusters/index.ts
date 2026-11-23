import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { DX, DY, gestures, keyDir, type Point } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { CLEAR_BONUS, colsFor, createLevel, goalFor, groupAt, groupPoints, LEFT_BONUS, pop, rowsFor, settle, type Outcome } from './rules';

const CELL = 30;
const PAD = 8;
/** Palette slot per block colour (most distinct first: orange, blue, green, yellow, purple). */
const TONE = [0, 1, 2, 3, 4];
/** Blocks slide into place over this long after a pop. */
const SLIDE_S = 0.2;
const GRAVITY = 600;

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: number;
  life: number;
}

export const clusters: GameDef = {
  id: 'clusters',
  get name() {
    return L('Clusters', 'Grappes');
  },
  get rules() {
    return L('Pop groups of same-colour blocks to clear the board.', 'Éclatez les groupes de blocs pareils pour vider le jeu.');
  },
  category: 'match',
  help: () => ({
    goal: L(
      'Pop groups until no move is left, with no more blocks on the board than the goal.',
      'Éclatez des groupes jusqu’à ce qu’il ne reste aucun coup, avec au plus le nombre de blocs visé.',
    ),
    steps: [
      L(
        'Tap a group of 2 or more touching blocks of the same colour and shape to pop it.',
        'Touchez un groupe de 2 blocs voisins ou plus, de même couleur et de même forme, pour l’éclater.',
      ),
      L(
        'Blocks above fall into the gap, and empty columns close up to the left.',
        'Les blocs du dessus tombent dans le vide et les colonnes vides se referment vers la gauche.',
      ),
      L(
        'When no group is left, you win if the blocks remaining are within the goal.',
        'Quand il ne reste aucun groupe, vous gagnez si les blocs restants respectent l’objectif.',
      ),
      L(
        'Hover or press a block to see its group before popping it.',
        'Survolez ou appuyez sur un bloc pour voir son groupe avant de l’éclater.',
      ),
      L(
        'Keyboard: arrows move the cursor, Space or Enter pops, P to pause.',
        'Clavier : les flèches déplacent le curseur, Espace ou Entrée éclate, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'A group of n blocks scores n × (n − 1): let groups grow before you pop them.',
        'Un groupe de n blocs vaut n × (n − 1) : laissez les groupes grossir avant de les éclater.',
      ),
      L(
        `Each block under the goal is worth ${LEFT_BONUS}, and an empty board ${CLEAR_BONUS} more.`,
        `Chaque bloc sous l’objectif vaut ${LEFT_BONUS}, et un jeu vide ${CLEAR_BONUS} de plus.`,
      ),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [1250, 1900],
      [700, 1100],
      [800, 1350],
      [500, 700],
      [500, 750],
    ] as const),
  par: (d) => Math.round((colsFor(d) * rowsFor(d)) / 2.2) + goalFor(d),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const { cols, rows } = s;
    const W = cols * CELL + 2 * PAD;
    const H = rows * CELL + 2 * PAD;
    const arena = new Arena(ctx.root, W, H, () => draw());

    let over = false;
    /** Ends the run once the slide finishes. */
    let pending: Outcome = '';
    /** Slide animation: per cell, where its block came from. */
    let from: number[] = [];
    let slide = SLIDE_S;
    let hover = -1;
    let cursor = -1;
    let bits: Bit[] = [];
    /** Floating "+points" label. */
    let gain = { x: 0, y: 0, n: 0, t: 0 };

    const centre = (i: number) => ({ x: PAD + (i % cols) * CELL + CELL / 2, y: PAD + Math.floor(i / cols) * CELL + CELL / 2 });
    const cellAt = (p: Point) => {
      const c = Math.floor((p.x - PAD) / CELL);
      const r = Math.floor((p.y - PAD) / CELL);
      return c >= 0 && r >= 0 && c < cols && r < rows ? r * cols + c : -1;
    };
    const focus = () => (cursor >= 0 ? cursor : hover);
    const focused = () => {
      const i = focus();
      const g = i >= 0 && !over ? groupAt(s.grid, cols, rows, i) : [];
      return g.length > 1 ? g : [];
    };

    const status = () => {
      const g = focused();
      ctx.status(
        [
          P(s.left, ['block left', 'blocks left'], ['bloc restant', 'blocs restants']),
          L(`goal ≤ ${s.goal}`, `objectif ≤ ${s.goal}`),
          g.length ? `+${groupPoints(g.length)}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
    };

    function tap(i: number) {
      if (over || slide < SLIDE_S || i < 0) return;
      const k = s.grid[i];
      const out = pop(s, i);
      if (!out) return;
      from = out.from;
      slide = 0;
      let sx = 0;
      let sy = 0;
      for (const j of out.removed) {
        const p = centre(j);
        sx += p.x;
        sy += p.y;
        for (let n = 0; n < 3; n++)
          bits.push({
            x: p.x,
            y: p.y,
            vx: (ctx.rng.next() - 0.5) * 160,
            vy: -60 - ctx.rng.next() * 120,
            k,
            life: 0.5 + ctx.rng.next() * 0.3,
          });
      }
      gain = { x: sx / out.removed.length, y: sy / out.removed.length, n: groupPoints(out.removed.length), t: 0.8 };
      pending = settle(s);
      if (pending) over = true;
      if (cursor >= 0 && s.grid[cursor] < 0) cursor = nearest(cursor);
      ctx.score(s.score);
      status();
    }

    /** The occupied cell closest to `i` (for the cursor after its block left). */
    function nearest(i: number) {
      let best = i;
      let dist = Infinity;
      for (let j = 0; j < s.grid.length; j++) {
        if (s.grid[j] < 0) continue;
        const d = Math.abs((j % cols) - (i % cols)) + Math.abs(Math.floor(j / cols) - Math.floor(i / cols));
        if (d < dist) [dist, best] = [d, j];
      }
      return best;
    }

    function drawBlock(g: CanvasRenderingContext2D, k: number, x: number, y: number, lift: number, scale = 1) {
      const c = arena.colors;
      const h = (CELL - 4) * scale;
      arena.box(g, x - h / 2 - lift, y - h / 2 - lift, h, h, c.p[TONE[k]], 5, true);
      g.fillStyle = c.cell;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.5;
      glyphPath(g, k, x - lift, y - lift, h * 0.26);
      g.fill();
      g.stroke();
    }

    const ease = (x: number) => 1 - (1 - Math.min(1, x)) ** 3;

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      g.fillStyle = c.cellAlt;
      for (let i = 0; i < cols * rows; i++)
        if (((i % cols) + Math.floor(i / cols)) % 2) {
          const { x, y } = centre(i);
          g.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
        }
      const lit = new Set(slide >= SLIDE_S ? focused() : []);
      const f = ease(slide / SLIDE_S);
      for (let i = 0; i < s.grid.length; i++) {
        const k = s.grid[i];
        if (k < 0) continue;
        let { x, y } = centre(i);
        const o = slide < SLIDE_S ? from[i] : -1;
        if (o >= 0 && o !== i) {
          const p = centre(o);
          x = p.x + (x - p.x) * f;
          y = p.y + (y - p.y) * f;
        }
        drawBlock(g, k, x, y, lit.has(i) ? 2 : 0);
      }
      // The focused group: an outline on each of its blocks.
      if (lit.size) {
        g.strokeStyle = c.fg;
        g.lineWidth = arena.lw * 1.2;
        for (const i of lit) {
          const { x, y } = centre(i);
          g.beginPath();
          g.roundRect(x - CELL / 2 - 1, y - CELL / 2 - 1, CELL, CELL, 6);
          g.stroke();
        }
      }
      if (cursor >= 0) {
        const { x, y } = centre(cursor);
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw;
        g.setLineDash([5, 3]);
        g.beginPath();
        g.roundRect(x - CELL / 2 + 1, y - CELL / 2 + 1, CELL - 2, CELL - 2, 6);
        g.stroke();
        g.setLineDash([]);
      }
      for (const b of bits) {
        g.globalAlpha = Math.min(1, b.life * 2);
        arena.box(g, b.x - 3, b.y - 3, 6, 6, c.p[TONE[b.k]], 1.5, false);
      }
      g.globalAlpha = 1;
      if (gain.t > 0) {
        g.globalAlpha = Math.min(1, gain.t * 2);
        g.font = '700 16px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 3;
        g.strokeStyle = c.cell;
        const y = gain.y - (0.8 - gain.t) * 30;
        g.strokeText(`+${gain.n}`, gain.x, y);
        g.fillStyle = c.fg;
        g.fillText(`+${gain.n}`, gain.x, y);
        g.globalAlpha = 1;
      }
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CELL * 0.5,
      onDown(p) {
        cursor = -1;
        hover = cellAt(p);
        status();
        draw();
      },
      onMove(p) {
        const i = cellAt(p);
        if (i === hover) return;
        hover = i;
        cursor = -1;
        status();
        draw();
      },
      onTap(p) {
        tap(cellAt(p));
        draw();
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const busy = slide < SLIDE_S || bits.length > 0 || gain.t > 0;
        slide = Math.min(SLIDE_S, slide + dt);
        gain.t = Math.max(0, gain.t - dt);
        for (const b of bits) {
          b.vy += GRAVITY * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.life -= dt;
        }
        bits = bits.filter((b) => b.life > 0);
        if (busy) draw();
        if (pending && slide >= SLIDE_S) {
          const out = pending;
          pending = '';
          if (out === 'win') ctx.win();
          else ctx.lose();
        }
      },
      onKey(e) {
        const dir = keyDir(e.key);
        const select = e.key === ' ' || e.key === 'Enter';
        if (dir === -1 && !select) return false;
        if (e.type !== 'keydown') return true;
        if (cursor < 0) cursor = nearest(hover >= 0 ? hover : (rows - 1) * cols);
        else if (dir !== -1) {
          const c = (cursor % cols) + DX[dir];
          const r = Math.floor(cursor / cols) + DY[dir];
          if (c >= 0 && r >= 0 && c < cols && r < rows) cursor = r * cols + c;
        } else tap(cursor);
        status();
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
