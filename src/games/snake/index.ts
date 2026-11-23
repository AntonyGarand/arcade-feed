import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { outBack, outCubic } from '../../kits/arena/ease';
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
    const fx = arena.fx;
    let dead = false;
    /** The tail cell before the last step, and when that step happened: the snake glides between cells. */
    let prevTail = -1;
    let moveAt = 0;
    /** When the last pellet was eaten (a bulge travels down the body) and when the current one appeared. */
    let eatAt = -10;
    let pelletAt = -10;
    let pellet = s.pellet;
    // Path points (cell centres, plus the gliding head and tail), reused every frame.
    let px = new Float32Array(64);
    let py = new Float32Array(64);

    const status = () => ctx.status(P(s.goal - s.eaten, ['pellet to go', 'pellets to go'], ['pastille à manger', 'pastilles à manger']));

    const cx = (i: number) => (i % COLS) * CELL + CELL / 2;
    const cy = (i: number) => Math.floor(i / COLS) * CELL + CELL / 2;

    /** Trace the body path built by `draw` (n points), shifted by (dx, dy). */
    function trace(g: CanvasRenderingContext2D, n: number, dx = 0, dy = 0) {
      g.beginPath();
      g.moveTo(px[0] + dx, py[0] + dy);
      for (let i = 1; i < n; i++) g.lineTo(px[i] + dx, py[i] + dy);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Border wall: one solid frame with mortar lines; the field inside.
      // Dark mode's muted grey is light: sink the walls towards the surface so they don't glare.
      const wallFill = arena.dark ? mix(c.muted, c.cell, 0.55) : c.muted;
      const wall = arena.tone(wallFill);
      g.fillStyle = wall.base;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = wall.lo;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = CELL; x < W; x += CELL) {
        g.moveTo(x, 0);
        g.lineTo(x, CELL);
        g.moveTo(x, H - CELL);
        g.lineTo(x, H);
      }
      for (let y = CELL; y < H; y += CELL) {
        g.moveTo(0, y);
        g.lineTo(CELL, y);
        g.moveTo(W - CELL, y);
        g.lineTo(W, y);
      }
      g.stroke();
      arena.field(g, CELL, CELL, W - 2 * CELL, H - 2 * CELL, 0, 0, false);
      g.fillStyle = c.cell;
      g.globalAlpha = 0.4;
      for (let i = 0; i < COLS * ROWS; i++)
        if (!s.walls[i] && ((i % COLS) + Math.floor(i / COLS)) % 2) g.fillRect((i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL);
      g.globalAlpha = 1;
      for (let i = 0; i < COLS * ROWS; i++) {
        const c0 = i % COLS;
        const r0 = Math.floor(i / COLS);
        if (s.walls[i] && c0 > 0 && r0 > 0 && c0 < COLS - 1 && r0 < ROWS - 1)
          arena.block(g, c0 * CELL + 1, r0 * CELL + 1, CELL - 2, CELL - 2, wallFill, 3);
      }

      // Pellet: a bobbing fruit with a stem and a leaf; it pops in when it appears.
      if (s.pellet >= 0 && s.eaten < s.goal) {
        const age = arena.time - pelletAt;
        const pop = age < 0.3 ? outBack(age / 0.3, 2.4) : 1;
        const x = cx(s.pellet);
        const y = cy(s.pellet) + Math.sin(arena.time * 4) * 0.8;
        const r = CELL * 0.36 * pop;
        if (r > 0.5) {
          g.fillStyle = arena.tone(c.p[0]).glow;
          g.beginPath();
          g.arc(x, y, r * (1.5 + 0.15 * Math.sin(arena.time * 6)), 0, Math.PI * 2);
          g.fill();
          arena.ball(g, x, y, r, c.p[0]);
          g.strokeStyle = arena.tone(c.p[0]).edge;
          g.lineWidth = 1.2;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(x, y - r * 0.8);
          g.lineTo(x + r * 0.2, y - r * 1.3);
          g.stroke();
          g.lineCap = 'butt';
          g.fillStyle = c.p[2];
          g.beginPath();
          g.ellipse(x + r * 0.55, y - r * 1.15, r * 0.4, r * 0.2, -0.5, 0, Math.PI * 2);
          g.fill();
        }
      }

      // Body: a smooth tube through the cell centres, the head and tail gliding between cells.
      const len = s.body.length;
      const f = dead || prevTail < 0 ? 1 : outCubic((arena.time - moveAt) * s.speed * 2.2);
      if (px.length < len + 2) {
        px = new Float32Array(len * 2 + 4);
        py = new Float32Array(len * 2 + 4);
      }
      let n = 0;
      const h0 = s.body[0];
      const h1 = len > 1 ? s.body[1] : h0;
      px[n] = cx(h1) + (cx(h0) - cx(h1)) * f;
      py[n++] = cy(h1) + (cy(h0) - cy(h1)) * f;
      for (let k = 1; k < len; k++) {
        px[n] = cx(s.body[k]);
        py[n++] = cy(s.body[k]);
      }
      if (prevTail >= 0 && len > 1) {
        const t = s.body[len - 1];
        px[n] = cx(prevTail) + (cx(t) - cx(prevTail)) * f;
        py[n++] = cy(prevTail) + (cy(t) - cy(prevTail)) * f;
      }
      if (n === 1) {
        px[n] = px[0];
        py[n++] = py[0];
      }
      const fill = dead ? c.bad : c.accent;
      const tone = arena.tone(fill);
      const bw = CELL * 0.74;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      if (arena.sh && arena.look === 'neo') {
        g.strokeStyle = c.drop;
        g.lineWidth = bw;
        trace(g, n, arena.sh * 0.5, arena.sh * 0.5);
        g.stroke();
      } else if (arena.look === 'soft') {
        g.strokeStyle = c.drop;
        g.lineWidth = bw;
        trace(g, n, 0, arena.sh * 0.7);
        g.stroke();
      }
      trace(g, n);
      g.strokeStyle = tone.edge;
      g.lineWidth = bw;
      g.stroke();
      g.strokeStyle = fill;
      g.lineWidth = bw - arena.lw * 1.5;
      g.stroke();
      // Scales: a darker diamond on every other segment.
      g.fillStyle = tone.lo;
      for (let k = 2; k < len - 1; k += 2) {
        const x = cx(s.body[k]);
        const y = cy(s.body[k]);
        g.beginPath();
        g.moveTo(x, y - 2.6);
        g.lineTo(x + 2.6, y);
        g.lineTo(x, y + 2.6);
        g.lineTo(x - 2.6, y);
        g.closePath();
        g.fill();
      }
      if (arena.look !== 'newsprint') {
        g.strokeStyle = tone.hi;
        g.globalAlpha = 0.55;
        g.lineWidth = bw * 0.2;
        trace(g, n, -bw * 0.12, -bw * 0.16);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.lineCap = 'butt';
      // A swallowed pellet travels down the body.
      const bulge = Math.floor((arena.time - eatAt) * s.speed * 1.5);
      if (bulge >= 1 && bulge < len - 1) arena.ball(g, cx(s.body[bulge]), cy(s.body[bulge]), CELL * 0.45, fill, false);

      // Head: a rounder ball with eyes that look ahead, blink now and then, and a flicking tongue.
      const hx = px[0];
      const hy = py[0];
      const dx = DX[s.dir];
      const dy = DY[s.dir];
      if (!dead && Math.sin(arena.time * 2.3) > 0.82) {
        g.strokeStyle = c.bad;
        g.lineWidth = 1.3;
        g.lineCap = 'round';
        const tx = hx + dx * CELL * 0.8;
        const ty = hy + dy * CELL * 0.8;
        g.beginPath();
        g.moveTo(hx + dx * CELL * 0.4, hy + dy * CELL * 0.4);
        g.lineTo(tx, ty);
        g.lineTo(tx + (dx - dy) * 2.5, ty + (dy + dx) * 2.5);
        g.moveTo(tx, ty);
        g.lineTo(tx + (dx + dy) * 2.5, ty + (dy - dx) * 2.5);
        g.stroke();
        g.lineCap = 'butt';
      }
      arena.ball(g, hx, hy, CELL * 0.5, fill);
      const blink = !dead && arena.time % 3.2 > 3.05;
      for (const side of [-1, 1]) {
        const ex = hx + dx * 3 + dy * side * 4.2;
        const ey = hy + dy * 3 + dx * side * 4.2;
        if (dead) {
          g.strokeStyle = tone.edge;
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(ex - 2, ey - 2);
          g.lineTo(ex + 2, ey + 2);
          g.moveTo(ex + 2, ey - 2);
          g.lineTo(ex - 2, ey + 2);
          g.stroke();
          continue;
        }
        g.fillStyle = c.paper;
        g.strokeStyle = tone.edge;
        g.lineWidth = arena.lw * 0.4;
        g.beginPath();
        g.ellipse(ex, ey, 3, blink ? 0.6 : 3, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        if (!blink) {
          g.fillStyle = c.coal;
          g.beginPath();
          g.arc(ex + dx * 1.2, ey + dy * 1.2, 1.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      arena.overlay(g);
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
        const tail = s.body[s.body.length - 1];
        const score = s.score;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        if (ev.moved && !ev.dead) {
          prevTail = tail;
          moveAt = arena.time;
        }
        if (ev.ate) {
          ctx.score(s.score);
          status();
          const x = cx(s.body[0]);
          const y = cy(s.body[0]);
          eatAt = arena.time;
          fx.burst(x, y, c.p[0], 10, 100, 3, 0.45);
          fx.ring(x, y, c.p[0], 4, CELL * 1.4, 0.3, arena.lw);
          fx.text(x, y - 12, `+${s.score - score}`, c.fg, 12);
        }
        if (s.pellet !== pellet) {
          pellet = s.pellet;
          pelletAt = arena.time;
        }
        if (ev.dead) {
          dead = true;
          fx.shake(5, 0.4);
          fx.flash(c.bad, 0.28, 0.4);
          fx.burst(cx(s.body[0]) + DX[s.dir] * CELL * 0.5, cy(s.body[0]) + DY[s.dir] * CELL * 0.5, c.muted, 12, 120, 3, 0.5);
          arena.linger();
        } else if (ev.won) {
          for (let k = 0; k < s.body.length; k += 2) fx.burst(cx(s.body[k]), cy(s.body[k]), c.p[k % 5], 3, 120, 3.5, 0.8, 'square', 160);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
        }
        draw();
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
