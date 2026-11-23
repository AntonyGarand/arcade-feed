import './style.css';
import { L } from '../../core/i18n';
import { byLevel, type Difficulty, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures, keyDir, type Dir } from '../../kits/gesture/gesture';
import {
  COLS,
  createLevel,
  GOAL_ROW,
  HOME_POINTS,
  homesFor,
  hop,
  HOP_S,
  itemX,
  LIFE_BONUS,
  LIVES,
  RESPAWN_S,
  ROW_POINTS,
  ROWS,
  SLOTS,
  START_ROW,
  step,
  TIME_POINTS,
  timeFor,
} from './rules';

const CELL = 32;
const W = COLS * CELL;
const H = ROWS * CELL;

/** Seconds per home for a fast clean run (three stars) and a decent one (two stars, one splash allowed). */
const fastPerHome = (d: Difficulty) => byLevel(d, [4.5, 4.5, 5.5, 6.5, 6.5]);
const okPerHome = (d: Difficulty) => byLevel(d, [8, 9, 10, 11, 11]);
const base = (d: Difficulty) => homesFor(d) * ((START_ROW - GOAL_ROW) * ROW_POINTS + HOME_POINTS) + LIVES * LIFE_BONUS;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  good: boolean;
}

export const crossing: GameDef = {
  id: 'crossing',
  get name() {
    return L('Crossing', 'Traversée');
  },
  get rules() {
    return L('Hop across the road and river to reach home.', 'Sautez par-dessus route et rivière jusqu’à l’abri.');
  },
  category: 'move',
  help: () => ({
    goal: L(
      'Hop your critter into the home slots across the far bank before the time runs out.',
      'Menez votre bestiole jusqu’aux abris de l’autre rive avant la fin du temps.',
    ),
    steps: [
      L(
        'Cross the road between the cars: getting hit costs a heart.',
        'Traversez la route entre les voitures : vous faire frapper coûte un cœur.',
      ),
      L(
        'On the river, ride the logs: they carry you along. The water, or drifting off the edge, costs a heart.',
        'Sur la rivière, montez sur les billots : ils vous emportent. L’eau, ou sortir par le bord, coûte un cœur.',
      ),
      L(
        'Each home slot takes one critter; the hedge between them blocks the way.',
        'Chaque abri accueille une bestiole; la haie entre les abris bloque le passage.',
      ),
      L(
        'Swipe to hop one square. Tap above your critter to hop forward, beside it to hop sideways.',
        'Balayez pour sauter d’une case. Touchez au-dessus de la bestiole pour avancer, à côté pour aller de côté.',
      ),
      L(
        'Keyboard: arrows or WASD to hop, Space to hop forward, P to pause.',
        'Clavier : flèches ou WASD pour sauter, Espace pour avancer, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `New rows are worth ${ROW_POINTS}, a home ${HOME_POINTS}; each second left adds ${TIME_POINTS} and each heart ${LIFE_BONUS}.`,
        `Chaque nouvelle rangée vaut ${ROW_POINTS}, un abri ${HOME_POINTS}; chaque seconde restante ajoute ${TIME_POINTS} et chaque cœur ${LIFE_BONUS}.`,
      ),
      L(
        'Grass strips are safe: wait there for a gap or the right log.',
        'Les bandes de gazon sont sûres : attendez-y une ouverture ou le bon billot.',
      ),
    ],
  }),
  stars: (d) => {
    const n = homesFor(d);
    return [
      base(d) - LIFE_BONUS + Math.round(timeFor(d) - n * okPerHome(d)) * TIME_POINTS,
      base(d) + Math.round(timeFor(d) - n * fastPerHome(d)) * TIME_POINTS,
    ];
  },
  par: (d) => Math.round(homesFor(d) * okPerHome(d) + 5),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    /** Last hop: where it started, for the jump animation, and its direction (the eyes look that way). */
    let from = { x: s.x, row: s.row };
    let facing: Dir = 0;
    let sparks: Spark[] = [];
    /** Where the hopper went down, for the splash/squash mark. */
    let wreck: { x: number; row: number; water: boolean } | null = null;
    /** Seconds left of the flash on a freshly filled slot. */
    let homeFlash = 0;
    let lastSlot = -1;
    let shown = -1;

    const secondsLeft = () => Math.max(0, Math.ceil(s.limit - s.time));
    const status = () => {
      shown = secondsLeft();
      ctx.status(`${L('Home', 'Abris')} ${s.homes}/${s.need} · ${shown} s`);
    };

    const burst = (x: number, row: number, good: boolean) => {
      const cx = (x + 0.5) * CELL;
      const cy = (row + 0.5) * CELL;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const v = 50 + (i % 3) * 30;
        sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, good });
      }
    };

    function drawHopper(g: CanvasRenderingContext2D, cx: number, cy: number, scale: number, dir: Dir) {
      const c = arena.colors;
      const r = CELL * 0.34 * scale;
      if (arena.sh) {
        g.fillStyle = c.drop;
        g.beginPath();
        g.arc(cx + arena.sh * 0.6, cy + arena.sh * 0.6, r, 0, Math.PI * 2);
        g.fill();
      }
      // Feet, then body, then eyes looking where it hops.
      const fx = dir === 1 || dir === 3 ? 0 : 1;
      const fy = 1 - fx;
      for (const k of [-1, 1]) arena.disc(g, cx + k * r * 0.75 * fx, cy + k * r * 0.75 * fy, r * 0.35, c.accent);
      arena.disc(g, cx, cy, r, c.accent);
      const ex = dir === 1 ? 1 : dir === 3 ? -1 : 0;
      const ey = dir === 0 ? -1 : dir === 2 ? 1 : 0;
      for (const k of [-1, 1]) {
        const px = cx + ex * r * 0.35 + k * r * 0.42 * (ey ? 1 : 0);
        const py = cy + ey * r * 0.35 + k * r * 0.42 * (ex ? 1 : 0);
        arena.disc(g, px, py, r * 0.28, c.cell);
        g.fillStyle = c.ink;
        g.beginPath();
        g.arc(px + ex * r * 0.1, py + ey * r * 0.1, r * 0.12, 0, Math.PI * 2);
        g.fill();
      }
    }

    function drawLanes(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      for (let r = 0; r < ROWS; r++) {
        const lane = s.lanes[r];
        const y = r * CELL;
        g.globalAlpha = lane.kind === 'river' ? 0.5 : lane.kind === 'road' ? 0.28 : 0.22;
        g.fillStyle = lane.kind === 'river' ? c.p[1] : lane.kind === 'road' ? c.muted : c.p[2];
        g.fillRect(0, y, W, CELL);
        g.globalAlpha = 1;
        if (lane.kind === 'river') {
          // Ripples drifting with the current.
          g.strokeStyle = c.cell;
          g.lineWidth = 1.2;
          g.globalAlpha = 0.6;
          const off = (((lane.speed * s.time * 0.5) % 2) + 2) % 2;
          for (let k = -1; k < COLS + 1; k += 2) {
            const x = (k + off) * CELL;
            g.beginPath();
            g.moveTo(x + 6, y + CELL * 0.55);
            g.quadraticCurveTo(x + 12, y + CELL * 0.4, x + 18, y + CELL * 0.55);
            g.stroke();
          }
          g.globalAlpha = 1;
        }
        if (lane.kind === 'road' && s.lanes[r + 1].kind === 'road') {
          g.strokeStyle = c.cell;
          g.lineWidth = 2;
          g.setLineDash([10, 10]);
          g.beginPath();
          g.moveTo(0, y + CELL);
          g.lineTo(W, y + CELL);
          g.stroke();
          g.setLineDash([]);
        }
      }
      // Far bank: hedge with home slots.
      g.fillStyle = c.p[2];
      g.fillRect(0, 0, W, CELL);
      SLOTS.forEach((col, k) => {
        const x = col * CELL;
        arena.box(g, x + 3, 4, CELL - 6, CELL - 6, k === lastSlot && homeFlash > 0 ? c.good : c.cellAlt, 6, false);
        if (s.filled[k]) drawHopper(g, x + CELL / 2, CELL / 2, 0.8, 2);
      });
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, CELL);
      g.lineTo(W, CELL);
      g.stroke();
    }

    function drawItems(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      for (let r = 0; r < ROWS; r++) {
        const lane = s.lanes[r];
        const y = r * CELL;
        for (const it of lane.items) {
          const x = itemX(lane, it, s.time) * CELL;
          const w = it.len * CELL;
          if (lane.kind === 'river') {
            arena.box(g, x + 1, y + 5, w - 2, CELL - 10, c.p[0], 8);
            // Wood grain.
            g.strokeStyle = c.ink;
            g.lineWidth = 1;
            g.globalAlpha = 0.35;
            for (let k = 1; k < it.len; k++) {
              g.beginPath();
              g.moveTo(x + k * CELL - 6, y + CELL * 0.42);
              g.lineTo(x + k * CELL + 6, y + CELL * 0.42);
              g.stroke();
            }
            g.globalAlpha = 1;
            continue;
          }
          arena.box(g, x + 3, y + 5, w - 6, CELL - 10, c.p[it.tone], 5);
          // Windscreen at the front, wheels on the sides.
          const front = lane.speed > 0 ? x + w - 13 : x + 6;
          arena.box(g, front, y + 9, 7, CELL - 18, c.cell, 2, false);
          g.fillStyle = c.ink;
          for (const wx of [x + 8, x + w - 14]) {
            g.fillRect(wx, y + 3, 6, 3);
            g.fillRect(wx, y + CELL - 6, 6, 3);
          }
        }
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      drawLanes(g);
      drawItems(g);
      if (wreck && s.dead > 0) {
        const cx = (wreck.x + 0.5) * CELL;
        const cy = (wreck.row + 0.5) * CELL;
        const k = 1 - s.dead / RESPAWN_S;
        g.strokeStyle = wreck.water ? c.cell : c.bad;
        g.lineWidth = arena.lw;
        for (const rr of [0.3, 0.55]) {
          g.beginPath();
          g.arc(cx, cy, CELL * (rr + k * 0.5), 0, Math.PI * 2);
          g.stroke();
        }
        if (!wreck.water) {
          g.fillStyle = c.bad;
          g.beginPath();
          g.ellipse(cx, cy, CELL * 0.38, CELL * 0.18, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (!s.dead) {
        // Hop animation: slide from the last cell with a little bounce.
        const k = s.cool > 0 ? 1 - s.cool / HOP_S : 1;
        const fx = from.x + (s.x - from.x) * k;
        const fy = from.row + (s.row - from.row) * k;
        drawHopper(g, (fx + 0.5) * CELL, (fy + 0.5) * CELL, 1 + Math.sin(Math.PI * k) * 0.25, facing);
      }
      for (const p of sparks) {
        g.globalAlpha = Math.min(1, p.life * 2.5);
        arena.disc(g, p.x, p.y, 2.5 + p.life * 4, p.good ? c.good : c.bad);
      }
      g.globalAlpha = 1;
      // Time left along the bottom.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, H - 4, W, 4);
      g.fillStyle = s.limit - s.time < 10 ? c.bad : c.accent;
      g.fillRect(0, H - 4, W * Math.max(0, 1 - s.time / s.limit), 4);
    }

    function go(dir: Dir) {
      const before = { x: s.x, row: s.row };
      const out = hop(s, dir);
      if (!out) return;
      facing = dir;
      if (out === 'move') from = before;
      else {
        const col = Math.round(before.x);
        lastSlot = SLOTS.indexOf(col);
        burst(col, GOAL_ROW, true);
        homeFlash = 0.6;
        from = { x: s.x, row: s.row };
      }
      ctx.score(s.score);
      status();
      draw();
      if (out === 'win') ctx.win();
    }

    const hx = () => (s.x + 0.5) * CELL;
    const hy = () => (s.row + 0.5) * CELL;
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CELL * 0.5,
      onSwipe: (dir) => go(dir),
      onTap(p) {
        if (p.y < hy() - CELL * 0.5) go(0);
        else if (p.y > hy() + CELL * 0.5) go(2);
        else go(p.x < hx() ? 3 : 1);
      },
    });

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const x = s.x;
        const row = s.row;
        const ev = step(s, dt);
        // Riding a log: the hop start drifts along with it.
        if (s.row === row) from = { x: from.x + (s.x - x), row: from.row };
        homeFlash = Math.max(0, homeFlash - dt);
        for (const p of sparks) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt;
        }
        sparks = sparks.filter((p) => p.life > 0);
        if (ev.died) {
          wreck = { x: s.x, row: s.row, water: s.lanes[s.row].kind === 'river' };
          burst(s.x, s.row, false);
          ctx.lives(s.lives, LIVES);
        }
        if (ev.respawned) from = { x: s.x, row: s.row };
        if (secondsLeft() !== shown) status();
        draw();
        if (ev.over) ctx.lose();
      },
      onKey(e) {
        const dir = e.key === ' ' ? 0 : keyDir(e.key);
        if (dir === -1) return false;
        if (e.type === 'keydown' && !e.repeat) go(dir);
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
