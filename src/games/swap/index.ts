import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { DX, DY, gestures, keyDir, type Point } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { adjacent, clearStep, collapse, createLevel, findMatches, MOVE_BONUS, movesFor, settle, trySwap, validMoves } from './rules';

const CELL = 40;
const PAD = 8;
/** Palette slot per gem colour (most distinct first: orange, blue, green, yellow, purple, pink, cyan). */
const TONE = [0, 1, 2, 3, 4, 6, 5];
const SWAP_S = 0.14;
const CLEAR_S = 0.2;
const FALL_S = 0.22;
/** Seconds without a move before a valid swap starts blinking. */
const HINT_S = 7;

type Phase = 'idle' | 'swap' | 'bounce' | 'clear' | 'fall' | 'done';

export const swap: GameDef = {
  id: 'swap',
  get name() {
    return L('Swap', 'Échange');
  },
  get rules() {
    return L('Swap gems to line up 3 or more of a kind.', 'Échangez des gemmes pour en aligner 3 pareilles.');
  },
  category: 'match',
  help: () => ({
    goal: L('Reach the target score before you run out of moves.', 'Atteignez le pointage visé avant d’épuiser vos coups.'),
    steps: [
      L(
        'Swap two neighbouring gems to line up 3 or more of the same colour and shape.',
        'Échangez deux gemmes voisines pour aligner 3 gemmes ou plus de même couleur et de même forme.',
      ),
      L(
        'Lined-up gems vanish; the ones above fall and new ones drop in. Chains score more.',
        'Les gemmes alignées disparaissent; celles du dessus tombent et d’autres arrivent. Les cascades rapportent plus.',
      ),
      L('A swap that makes no line is undone and costs nothing.', 'Un échange qui n’aligne rien est annulé et ne coûte rien.'),
      L(
        'Drag a gem onto its neighbour, or tap one gem and then the other.',
        'Glissez une gemme vers sa voisine, ou touchez une gemme puis l’autre.',
      ),
      L(
        'Keyboard: arrows move the cursor, Space picks a gem, then an arrow swaps it.',
        'Clavier : les flèches déplacent le curseur, Espace choisit une gemme, puis une flèche l’échange.',
      ),
    ],
    tips: [
      L('Lines of 4 or 5 are worth much more than three lines of 3.', 'Une ligne de 4 ou 5 vaut bien plus que trois lignes de 3.'),
      L(`Each move left at the end is worth ${MOVE_BONUS} points.`, `Chaque coup restant à la fin vaut ${MOVE_BONUS} points.`),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [2000, 2600],
      [1900, 2500],
      [1400, 1900],
      [1250, 1700],
      [900, 1300],
    ] as const),
  par: (d) => movesFor(d) * 4,
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const n = s.n;
    const size = n * CELL + 2 * PAD;
    const arena = new Arena(ctx.root, size, size, () => draw());

    let phase: Phase = 'idle';
    let t = 0;
    let idle = 0;
    /** Swap being animated. */
    let sa = -1;
    let sb = -1;
    /** Cells popping in the clear phase. */
    let popping = new Set<number>();
    let sel = -1;
    let press = -1;
    let deselect = false;
    let cursor = -1;
    let hint: [number, number] | null = null;

    const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < n && r < n;
    const cellAt = (p: Point) => {
      const c = Math.floor((p.x - PAD) / CELL);
      const r = Math.floor((p.y - PAD) / CELL);
      return inside(c, r) ? r * n + c : -1;
    };
    const centre = (i: number) => ({ x: PAD + (i % n) * CELL + CELL / 2, y: PAD + Math.floor(i / n) * CELL + CELL / 2 });
    const step = (i: number, dir: 0 | 1 | 2 | 3) => {
      const c = (i % n) + DX[dir];
      const r = Math.floor(i / n) + DY[dir];
      return inside(c, r) ? r * n + c : -1;
    };

    const status = () =>
      ctx.status(
        [
          P(s.moves, ['move left', 'moves left'], ['coup restant', 'coups restants']),
          L(`goal ${s.target}`, `objectif ${s.target}`),
          s.chain > 1 ? `cascade ×${s.chain}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );

    function attempt(a: number, b: number) {
      if (phase !== 'idle' || a < 0 || b < 0 || !adjacent(n, a, b)) return;
      sel = -1;
      sa = a;
      sb = b;
      t = 0;
      idle = 0;
      hint = null;
      phase = trySwap(s, a, b) ? 'swap' : 'bounce';
      if (phase === 'swap') status();
    }

    function startClear(): boolean {
      popping = findMatches(s.grid, n);
      if (!popping.size) return false;
      phase = 'clear';
      t = 0;
      return true;
    }

    function finishMove() {
      const out = settle(s);
      ctx.score(s.score);
      s.chain = 0;
      status();
      phase = out ? 'done' : 'idle';
      if (out === 'win') ctx.win();
      else if (out === 'lose') ctx.lose();
    }

    function drawGem(g: CanvasRenderingContext2D, k: number, x: number, y: number, scale = 1) {
      const c = arena.colors;
      const r = CELL * 0.4 * scale;
      if (arena.sh) {
        g.fillStyle = c.drop;
        glyphPath(g, k, x + arena.sh * 0.5, y + arena.sh * 0.5, r);
        g.fill();
      }
      g.fillStyle = c.p[TONE[k]];
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      glyphPath(g, k, x, y, r);
      g.fill();
      g.stroke();
    }

    const ease = (x: number) => 1 - (1 - Math.min(1, x)) ** 2;

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      g.fillStyle = c.cellAlt;
      for (let i = 0; i < n * n; i++)
        if (((i % n) + Math.floor(i / n)) % 2) {
          const { x, y } = centre(i);
          g.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
        }
      const ring = (i: number, colour: string, width: number) => {
        const { x, y } = centre(i);
        g.strokeStyle = colour;
        g.lineWidth = width;
        g.setLineDash([5, 3]);
        g.beginPath();
        g.roundRect(x - CELL / 2 + 2, y - CELL / 2 + 2, CELL - 4, CELL - 4, 6);
        g.stroke();
        g.setLineDash([]);
      };
      if (sel >= 0) {
        const { x, y } = centre(sel);
        arena.box(g, x - CELL / 2 + 2, y - CELL / 2 + 2, CELL - 4, CELL - 4, c.accent, 6, false);
      }
      if (hint && phase === 'idle' && Math.sin(idle * 6) > 0) for (const i of hint) ring(i, c.fg, arena.lw);

      for (let i = 0; i < n * n; i++) {
        const k = s.grid[i];
        if (k < 0) continue;
        let { x, y } = centre(i);
        let scale = 1;
        if ((phase === 'swap' || phase === 'bounce') && (i === sa || i === sb)) {
          // After a valid swap the gems already sit in their new cells: slide them in from the old ones.
          // A refused swap nudges them towards each other and back.
          const o = centre(i === sa ? sb : sa);
          const f = phase === 'swap' ? 1 - ease(t / SWAP_S) : Math.sin((Math.PI * Math.min(t, 2 * SWAP_S)) / (2 * SWAP_S)) * 0.45;
          x += (o.x - x) * f;
          y += (o.y - y) * f;
        } else if (phase === 'clear' && popping.has(i)) scale = 1 - ease(t / CLEAR_S) * 0.9;
        else if (phase === 'fall' && s.fell[i]) y -= s.fell[i] * CELL * (1 - ease(t / FALL_S));
        if (y < PAD - CELL / 2) continue;
        drawGem(g, k, x, y, scale);
      }
      if (cursor >= 0) ring(cursor, c.ink, arena.lw * 1.2);
      // Gems falling in slide out from under the top edge.
      g.fillStyle = c.cell;
      g.fillRect(0, 0, size, PAD);
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CELL * 0.35,
      onDown(p) {
        const i = cellAt(p);
        press = i;
        deselect = false;
        if (i < 0 || phase !== 'idle') return;
        if (sel >= 0 && sel !== i && adjacent(n, sel, i)) {
          attempt(sel, i);
          press = -1;
        } else if (sel === i) deselect = true;
        else sel = i;
        draw();
      },
      onSwipe(dir) {
        if (press >= 0) attempt(press, step(press, dir));
        press = -1;
      },
      onTap() {
        if (deselect) sel = -1;
        draw();
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        t += dt;
        if (phase === 'idle') {
          idle += dt;
          if (idle > HINT_S && !hint) hint = validMoves(s.grid, n)[0] ?? null;
        } else if (phase === 'swap' && t >= SWAP_S) startClear();
        else if (phase === 'bounce' && t >= SWAP_S * 2) phase = 'idle';
        else if (phase === 'clear' && t >= CLEAR_S) {
          clearStep(s);
          collapse(s);
          ctx.score(s.score);
          status();
          phase = 'fall';
          t = 0;
        } else if (phase === 'fall' && t >= FALL_S) {
          s.fell.fill(0);
          if (!startClear()) finishMove();
        }
        draw();
      },
      onKey(e) {
        const dir = keyDir(e.key);
        const select = e.key === ' ' || e.key === 'Enter';
        if (dir === -1 && !select) return false;
        if (e.type !== 'keydown') return true;
        const mid = Math.floor(n / 2) * (n + 1);
        if (dir !== -1) {
          if (cursor < 0) cursor = sel >= 0 ? sel : mid;
          const to = step(cursor, dir);
          if (to >= 0) {
            if (sel >= 0) attempt(sel, to);
            cursor = to;
          }
        } else if (cursor < 0) cursor = mid;
        else if (sel === cursor) sel = -1;
        else if (sel >= 0 && adjacent(n, sel, cursor)) attempt(sel, cursor);
        else if (phase === 'idle') sel = cursor;
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
