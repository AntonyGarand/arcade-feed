import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures, keyDir } from '../../kits/gesture/gesture';
import { haptic, sfx } from '../../kits/sound/sound';
import { createLevel, MOVE_BONUS, movesFor, play, type Move, type Outcome } from './rules';

const W = 300;
const GAP = 7;
const FONT = "'Space Grotesk Variable', system-ui, sans-serif";
/** Tiles slide for this long, then merged tiles pop and the new tile grows in. */
const SLIDE_S = 0.1;
const POP_S = 0.16;
/** Palette slot per tile value: 2 → p1, 4 → p2, … 256 → p8. */
const tone = (v: number) => (Math.round(Math.log2(v)) - 1) % 8;

export const doubles: GameDef = {
  id: 'doubles',
  get name() {
    return L('Doubles', 'Doublés');
  },
  get rules() {
    return L('Slide equal tiles together to reach the target tile.', 'Glissez les tuiles égales ensemble jusqu’à la tuile visée.');
  },
  category: 'think',
  help: () => ({
    goal: L(
      'Make the target tile (64, 128 or 256) before you run out of moves.',
      'Formez la tuile visée (64, 128 ou 256) avant d’épuiser vos coups.',
    ),
    steps: [
      L(
        'Each move slides every tile as far as it goes in one direction.',
        'Chaque coup fait glisser toutes les tuiles le plus loin possible dans une direction.',
      ),
      L(
        'Two equal tiles that collide merge into one tile worth double.',
        'Deux tuiles égales qui se rencontrent fusionnent en une tuile qui vaut le double.',
      ),
      L(
        'After every move a new 2 (sometimes a 4) appears. Hatched stones never move.',
        'Après chaque coup, un 2 (parfois un 4) apparaît. Les pierres hachurées ne bougent jamais.',
      ),
      L('Swipe anywhere on the board to slide the tiles.', 'Balayez n’importe où sur le plateau pour faire glisser les tuiles.'),
      L('Keyboard: arrows or WASD to slide, P to pause.', 'Clavier : flèches ou WASD pour glisser, P pour la pause.'),
    ],
    tips: [
      L(
        'Keep your biggest tile in a corner and build a chain of halves next to it.',
        'Gardez votre plus grosse tuile dans un coin et alignez ses moitiés à côté.',
      ),
      L(
        `Merges score their new value; each move left at the end is worth ${MOVE_BONUS}.`,
        `Une fusion vaut sa nouvelle valeur; chaque coup restant à la fin vaut ${MOVE_BONUS}.`,
      ),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [740, 800],
      [1000, 1080],
      [1040, 1120],
      [1450, 1620],
      [1450, 1600],
    ] as const),
  par: (d) => movesFor(d),
  pad: () => ({ left: 'dpad' }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const n = s.n;
    const cell = (W - GAP * (n + 1)) / n;
    const arena = new Arena(ctx.root, W, W, () => draw());

    let last: Move | null = null;
    let t = SLIDE_S + POP_S;
    let pending: Outcome = '';
    let over = false;
    /** A refused move nudges the board. */
    let shake = 0;

    const pos = (i: number) => ({ x: GAP + (i % n) * (cell + GAP), y: GAP + Math.floor(i / n) * (cell + GAP) });

    const status = () =>
      ctx.status(
        [
          P(s.moves, ['move left', 'moves left'], ['coup restant', 'coups restants']),
          L(`goal ${s.target}`, `objectif ${s.target}`),
          L(`top tile ${s.best}`, `tuile max ${s.best}`),
        ].join(' · '),
      );

    function drawTile(g: CanvasRenderingContext2D, v: number, x: number, y: number, scale = 1) {
      const c = arena.colors;
      const sz = cell * scale;
      const ox = x + (cell - sz) / 2;
      const oy = y + (cell - sz) / 2;
      arena.box(g, ox, oy, sz, sz, c.p[tone(v)], 8, true);
      if (v >= s.target) {
        g.strokeStyle = c.fg;
        g.lineWidth = arena.lw * 1.4;
        g.beginPath();
        g.roundRect(ox + 4, oy + 4, sz - 8, sz - 8, 5);
        g.stroke();
      }
      const digits = String(v).length;
      g.font = `700 ${Math.round(sz * (digits < 3 ? 0.44 : 0.34))}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 4;
      g.strokeStyle = c.cell;
      g.strokeText(String(v), x + cell / 2, y + cell / 2 + 1);
      g.fillStyle = c.fg;
      g.fillText(String(v), x + cell / 2, y + cell / 2 + 1);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      g.save();
      if (shake > 0) g.translate(Math.sin(shake * 70) * shake * 20, 0);
      for (let i = 0; i < n * n; i++) {
        const { x, y } = pos(i);
        if (s.grid[i] < 0) {
          arena.box(g, x, y, cell, cell, c.muted, 8, true);
          // Hatching marks a stone.
          g.save();
          g.beginPath();
          g.roundRect(x, y, cell, cell, 8);
          g.clip();
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.5;
          for (let k = -cell; k < cell; k += 9) {
            g.beginPath();
            g.moveTo(x + k, y + cell);
            g.lineTo(x + k + cell, y);
            g.stroke();
          }
          g.restore();
        } else {
          g.fillStyle = c.cellAlt;
          g.beginPath();
          g.roundRect(x, y, cell, cell, 8);
          g.fill();
        }
      }
      const ease = (k: number) => 1 - (1 - Math.min(1, k)) ** 2;
      if (last && t < SLIDE_S) {
        // Tiles on their way: drawn from the move's slides with their old values.
        const f = ease(t / SLIDE_S);
        for (const m of last.slides) {
          const a = pos(m.from);
          const b = pos(m.to);
          drawTile(g, m.v, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        }
      } else {
        const k = last ? Math.min(1, (t - SLIDE_S) / POP_S) : 1;
        for (let i = 0; i < n * n; i++) {
          const v = s.grid[i];
          if (v <= 0) continue;
          const { x, y } = pos(i);
          let scale = 1;
          if (last?.spawn === i) scale = ease(k);
          else if (last?.merged.includes(i)) scale = 1 + Math.sin(Math.PI * k) * 0.14;
          if (scale > 0.02) drawTile(g, v, x, y, scale);
        }
      }
      if (over && t >= SLIDE_S + POP_S) {
        // The run is over: veil the board.
        g.globalAlpha = 0.35;
        g.fillStyle = s.best >= s.target ? c.good : c.cell;
        g.fillRect(-20, -20, W + 40, W + 40);
        g.globalAlpha = 1;
      }
      g.restore();
    }

    function move(dir: 0 | 1 | 2 | 3) {
      if (over) return;
      const m = play(s, dir);
      if (!m) {
        shake = 0.15;
        sfx('error');
        return;
      }
      last = m;
      t = 0;
      if (m.merged.length) {
        const top = Math.max(...m.merged.map((i) => s.grid[i]));
        sfx('pop', { pitch: Math.min(14, Math.log2(top) - 1) * 1.5 });
        if (top >= 64) haptic(20);
      } else sfx('tick');
      if (m.out) {
        over = true;
        pending = m.out;
      }
      ctx.score(s.score);
      status();
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 18,
      onSwipe: (dir) => move(dir),
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const busy = t < SLIDE_S + POP_S || shake > 0;
        t += dt;
        shake = Math.max(0, shake - dt);
        if (busy || over) draw();
        if (pending && t >= SLIDE_S + POP_S) {
          const out = pending;
          pending = '';
          if (out === 'win') ctx.win();
          else ctx.lose();
        }
      },
      onKey(e) {
        const dir = keyDir(e.key);
        if (dir === -1) return false;
        if (e.type === 'keydown') move(dir);
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
