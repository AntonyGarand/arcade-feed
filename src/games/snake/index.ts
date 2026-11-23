import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { DX, DY, gestures, keyDir } from '../../kits/gesture/gesture';
import { COLS, createLevel, goalFor, PELLET_POINTS, QUICK, ROWS, speedFor, step, turn } from './rules';

const CELL = 20;
const W = COLS * CELL;
const H = ROWS * CELL;

export const snake: GameDef = {
  id: 'snake',
  get name() {
    return L('Snake', 'Serpent');
  },
  get rules() {
    return L('Eat the pellets without hitting a wall or yourself.', 'Mangez les pastilles sans toucher un mur ni vous-même.');
  },
  category: 'reflex',
  help: () => ({
    goal: L('Eat the number of pellets shown without crashing.', 'Mangez le nombre de pastilles demandé sans vous écraser.'),
    steps: [
      L(
        'The snake moves on its own, one square at a time. Each pellet makes it longer.',
        'Le serpent avance tout seul, une case à la fois. Chaque pastille l’allonge.',
      ),
      L('Running into a wall or your own body ends the run.', 'Foncer dans un mur ou dans votre propre corps met fin à la partie.'),
      L('Swipe in the direction you want to turn.', 'Balayez dans la direction où vous voulez tourner.'),
      L('Keyboard: arrows or WASD to turn, P to pause.', 'Clavier : flèches ou WASD pour tourner, P pour la pause.'),
    ],
    tips: [
      L(
        `A pellet is worth ${PELLET_POINTS}, plus up to ${QUICK} more if you reach it in few steps.`,
        `Une pastille vaut ${PELLET_POINTS}, plus jusqu’à ${QUICK} de plus si vous l’atteignez en peu de pas.`,
      ),
      L('You can queue two turns ahead for tight corners.', 'Vous pouvez enchaîner deux virages d’avance dans les coins serrés.'),
    ],
  }),
  stars: (d) => [goalFor(d) * 20, goalFor(d) * 27],
  par: (d) => Math.round((goalFor(d) * 10) / speedFor(d) + 10),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    let dead = false;

    const status = () => ctx.status(P(s.goal - s.eaten, ['pellet to go', 'pellets to go'], ['pastille à manger', 'pastilles à manger']));

    const xy = (i: number) => ({ x: (i % COLS) * CELL, y: Math.floor(i / COLS) * CELL });

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      g.fillStyle = c.cellAlt;
      for (let i = 0; i < COLS * ROWS; i++)
        if (!s.walls[i] && ((i % COLS) + Math.floor(i / COLS)) % 2) {
          const { x, y } = xy(i);
          g.fillRect(x, y, CELL, CELL);
        }
      // Border: one solid frame; inner walls: blocks.
      g.fillStyle = c.muted;
      g.fillRect(0, 0, W, CELL);
      g.fillRect(0, H - CELL, W, CELL);
      g.fillRect(0, 0, CELL, H);
      g.fillRect(W - CELL, 0, CELL, H);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.strokeRect(CELL, CELL, W - 2 * CELL, H - 2 * CELL);
      for (let i = 0; i < COLS * ROWS; i++) {
        const c0 = i % COLS;
        const r0 = Math.floor(i / COLS);
        if (s.walls[i] && c0 > 0 && r0 > 0 && c0 < COLS - 1 && r0 < ROWS - 1) {
          const { x, y } = xy(i);
          arena.box(g, x + 1, y + 1, CELL - 2, CELL - 2, c.muted, 3);
        }
      }
      if (s.pellet >= 0) {
        const { x, y } = xy(s.pellet);
        arena.disc(g, x + CELL / 2, y + CELL / 2, CELL * 0.3, c.p[0]);
      }
      // Body, tail first, with bridges between neighbouring segments so it reads as one snake.
      const fill = dead ? c.bad : c.accent;
      const inset = 2.5;
      g.fillStyle = fill;
      for (let k = s.body.length - 1; k >= 0; k--) {
        const { x, y } = xy(s.body[k]);
        arena.box(g, x + inset, y + inset, CELL - 2 * inset, CELL - 2 * inset, fill, 5, k === 0);
        if (k > 0) {
          const p = xy(s.body[k - 1]);
          g.fillStyle = fill;
          const bx = Math.min(x, p.x) + inset + 1;
          const by = Math.min(y, p.y) + inset + 1;
          g.fillRect(bx, by, Math.abs(x - p.x) + CELL - 2 * inset - 2, Math.abs(y - p.y) + CELL - 2 * inset - 2);
        }
      }
      // Eyes, looking ahead.
      const { x, y } = xy(s.body[0]);
      const cx = x + CELL / 2 + DX[s.dir] * 3;
      const cy = y + CELL / 2 + DY[s.dir] * 3;
      for (const side of [-1, 1]) arena.disc(g, cx + DY[s.dir] * side * 4, cy + DX[s.dir] * side * 4, 2.4, c.cell);
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CELL * 0.7,
      repeat: true,
      onSwipe: (dir) => turn(s, dir),
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const ev = step(s, dt);
        if (ev.ate) {
          ctx.score(s.score);
          status();
        }
        if (ev.dead) dead = true;
        if (ev.moved) draw();
        if (ev.won) ctx.win();
        else if (ev.dead) ctx.lose();
      },
      onKey(e) {
        const dir = keyDir(e.key);
        if (dir === -1) return false;
        if (e.type === 'keydown' && !e.repeat) turn(s, dir);
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
