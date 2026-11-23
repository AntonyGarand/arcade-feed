import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena, type Trace } from '../../kits/arena/arena';
import { outBack, outCubic } from '../../kits/arena/ease';
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
/** Each gem's shape, traced around (0, 0) for `Arena.gem`. */
const TRACES: Trace[] = TONE.map((_, k) => (g, r) => glyphPath(g, k, 0, 0, r));

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
      else arena.fx.shake(1.5, 0.2);
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
      const c = arena.colors;
      if (out === 'win') {
        for (let i = 0; i < n * n; i += 3) {
          const { x, y } = centre(i);
          arena.fx.burst(x, y, c.p[TONE[s.grid[i]] ?? 0], 3, 120, 3.5, 0.8, 'square', 160);
        }
        arena.fx.flash(c.good, 0.22, 0.5);
        arena.linger();
        ctx.win();
      } else if (out === 'lose') {
        arena.fx.shake(4, 0.35);
        arena.fx.flash(c.bad, 0.2, 0.4);
        arena.linger();
        ctx.lose();
      }
    }

    function drawGem(g: CanvasRenderingContext2D, k: number, x: number, y: number, scale = 1) {
      arena.gem(g, x, y, CELL * 0.4, arena.colors.p[TONE[k]], TRACES[k], true, scale);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, PAD, PAD, n * CELL, n * CELL, 0, 6);
      // Soft checkerboard on the board.
      g.fillStyle = c.cell;
      g.globalAlpha = 0.45;
      for (let i = 0; i < n * n; i++)
        if (((i % n) + Math.floor(i / n)) % 2) {
          const { x, y } = centre(i);
          g.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
        }
      g.globalAlpha = 1;
      const ring = (i: number, colour: string, width: number, dash = true) => {
        const { x, y } = centre(i);
        g.strokeStyle = colour;
        g.lineWidth = width;
        if (dash) g.setLineDash([5, 3]);
        g.beginPath();
        g.roundRect(x - CELL / 2 + 2, y - CELL / 2 + 2, CELL - 4, CELL - 4, arena.r(6));
        g.stroke();
        g.setLineDash([]);
      };
      if (sel >= 0) {
        const { x, y } = centre(sel);
        arena.block(g, x - CELL / 2 + 2, y - CELL / 2 + 2, CELL - 4, CELL - 4, arena.tone(c.accent).hi, 6, false, 0);
      }
      if (hint && phase === 'idle') {
        g.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(idle * 3.5));
        for (const i of hint) ring(i, c.fg, arena.lw * 1.1, false);
        g.globalAlpha = 1;
      }

      for (let i = 0; i < n * n; i++) {
        const k = s.grid[i];
        if (k < 0) continue;
        let { x, y } = centre(i);
        let scale = 1;
        if ((phase === 'swap' || phase === 'bounce') && (i === sa || i === sb)) {
          // After a valid swap the gems already sit in their new cells: slide them in from the old ones.
          // A refused swap nudges them towards each other and back.
          const o = centre(i === sa ? sb : sa);
          const f = phase === 'swap' ? 1 - outCubic(t / SWAP_S) : Math.sin((Math.PI * Math.min(t, 2 * SWAP_S)) / (2 * SWAP_S)) * 0.45;
          x += (o.x - x) * f;
          y += (o.y - y) * f;
          // The moving gems ride a little larger, as if lifted.
          scale = 1 + 0.12 * Math.sin(Math.PI * Math.min(1, t / (phase === 'swap' ? SWAP_S : 2 * SWAP_S)));
        } else if (phase === 'clear' && popping.has(i)) {
          // Swell, then shrink away.
          const f = t / CLEAR_S;
          scale = f < 0.3 ? 1 + 0.18 * outCubic(f / 0.3) : 1.18 * (1 - outCubic((f - 0.3) / 0.7));
        } else if (phase === 'fall' && s.fell[i]) y -= s.fell[i] * CELL * (1 - outBack(t / FALL_S, 1.2));
        else if (i === sel) scale = 1 + 0.07 * Math.sin(arena.time * 8);
        if (y < PAD - CELL / 2) continue;
        drawGem(g, k, x, y, scale);
        if (phase === 'clear' && popping.has(i) && scale > 0.05) {
          g.globalAlpha = Math.min(1, (t / CLEAR_S) * 1.6) * 0.75;
          g.fillStyle = c.paper;
          glyphPath(g, k, x, y, CELL * 0.4 * scale);
          g.fill();
          g.globalAlpha = 1;
        }
      }
      if (cursor >= 0) ring(cursor, c.ink, arena.lw * 1.2);
      // Gems falling in slide out from under the top edge.
      g.fillStyle = c.cell;
      g.fillRect(-10, -10, size + 20, PAD + 10 - arena.lw * 0.4);
      arena.overlay(g);
    }

    /** Gems just cleared: bursts in their colours, the points at the middle of the match. */
    function popped(cells: number[], kinds: number[], gain: number) {
      if (!cells.length) return;
      const c = arena.colors;
      let mx = 0;
      let my = 0;
      cells.forEach((i, j) => {
        const { x, y } = centre(i);
        mx += x;
        my += y;
        const fill = c.p[TONE[kinds[j]] ?? 0];
        arena.fx.burst(x, y, fill, 6, 110, 3.5, 0.5);
        arena.fx.burst(x, y, arena.tone(fill).hi, 3, 70, 2.5, 0.4, 'dot', 120);
      });
      mx /= cells.length;
      my /= cells.length;
      arena.fx.ring(mx, my, c.fg, 6, CELL * (0.8 + cells.length * 0.15), 0.35, arena.lw);
      arena.fx.text(mx, my, `+${gain}`, s.chain > 1 ? c.accent : c.fg, 13 + Math.min(6, cells.length - 3) * 1.5);
      if (s.chain > 1) {
        arena.fx.text(size / 2, size * 0.42, `cascade ×${s.chain}`, c.accent, 16 + s.chain * 2, 1.1);
        arena.fx.shake(1 + s.chain * 0.8, 0.25);
      }
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
        arena.update(dt);
        if (phase === 'idle') {
          idle += dt;
          if (idle > HINT_S && !hint) hint = validMoves(s.grid, n)[0] ?? null;
        } else if (phase === 'swap' && t >= SWAP_S) startClear();
        else if (phase === 'bounce' && t >= SWAP_S * 2) phase = 'idle';
        else if (phase === 'clear' && t >= CLEAR_S) {
          const before = s.score;
          const cells = [...popping];
          const kinds = cells.map((i) => s.grid[i]);
          clearStep(s);
          popped(cells, kinds, s.score - before);
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
