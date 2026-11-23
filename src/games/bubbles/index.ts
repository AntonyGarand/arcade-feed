import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures, type Point } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import {
  aimAt,
  along,
  ceilingY,
  cellX,
  cellY,
  createLevel,
  DROP_POINTS,
  H,
  LAUNCH,
  LINE_Y,
  POP_POINTS,
  R,
  RH,
  ROW_BONUS,
  rowsFor,
  shoot,
  step,
  swapNext,
  trace,
  type Landing,
  type Trace,
  W,
} from './rules';

/** Palette slot per bubble colour (most distinct first: orange, blue, green, yellow, purple). */
const TONE = [0, 1, 2, 3, 4];
/** Where the next bubble waits (tap it to swap). */
const NEXT = { x: LAUNCH.x - 64, y: LAUNCH.y + 6 };
const NEXT_R = R * 0.72;
/** The aim guide runs this far past the first wall bounce. */
const AFTER_BOUNCE = 70;
const GRAVITY = 900;
/** Pause after the last bubble lands before the card ends, so the pop is seen. */
const END_S = 0.6;

interface Burst {
  x: number;
  y: number;
  k: number;
  t: number;
}

interface Faller {
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: number;
}

export const bubbles: GameDef = {
  id: 'bubbles',
  get name() {
    return L('Bubble Pop', 'Bulles');
  },
  get rules() {
    return L('Shoot bubbles to pop groups of 3 of a kind.', 'Lancez des bulles pour éclater des groupes de 3 pareilles.');
  },
  category: 'aim',
  help: () => ({
    goal: L(
      'Clear every bubble before the ceiling pushes one past the line.',
      'Videz toutes les bulles avant que le plafond en pousse une sous la ligne.',
    ),
    steps: [
      L(
        'Shoot the bubble from the launcher: it bounces off the side walls and sticks where it touches.',
        'Lancez la bulle du canon : elle rebondit sur les côtés et colle là où elle touche.',
      ),
      L(
        'Three or more touching bubbles of the same colour and shape pop; bubbles left hanging fall.',
        'Trois bulles voisines ou plus de même couleur et de même forme éclatent; celles qui ne tiennent plus tombent.',
      ),
      L(
        'Every few shots the ceiling comes down a row. A bubble below the dashed line ends the run.',
        'À intervalles réguliers, le plafond descend d’une rangée. Une bulle sous la ligne pointillée met fin à la partie.',
      ),
      L(
        'Drag to aim along the guide and release to shoot (tap to shoot right away). Tap the small bubble to swap.',
        'Glissez pour viser selon le guide et relâchez pour tirer (ou touchez pour tirer). Touchez la petite bulle pour l’échanger.',
      ),
      L(
        'Keyboard: ← → or A D to aim, Space to shoot, ↓ to swap, P to pause.',
        'Clavier : ← → ou A D pour viser, Espace pour tirer, ↓ pour échanger, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Popped bubbles are worth ${POP_POINTS}, fallen ones ${DROP_POINTS}: cut big clumps loose.`,
        `Une bulle éclatée vaut ${POP_POINTS}, une bulle tombée ${DROP_POINTS} : détachez de grosses grappes.`,
      ),
      L(
        `Clear fast: each free row above the line at the end is worth ${ROW_BONUS}.`,
        `Videz vite : chaque rangée libre au-dessus de la ligne à la fin vaut ${ROW_BONUS}.`,
      ),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [1800, 1860],
      [1850, 1980],
      [2000, 2080],
      [2000, 2130],
      [2100, 2200],
    ] as const),
  par: (d) => rowsFor(d) * 8,
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());

    let bursts: Burst[] = [];
    let fallers: Faller[] = [];
    /** Ceiling drops as drawn (eases towards the real count). */
    let shownDrops = 0;
    let flash = 0;
    let end: '' | 'win' | 'lose' = '';
    let endT = 0;
    let over = false;
    /** The press started on the next bubble (a swap, not an aim). */
    let swapPress = false;
    let guide: Trace | null = null;
    let guideKey = '';

    const count = () => s.grid.filter((k) => k >= 0).length;
    const status = () =>
      ctx.status(
        [
          P(count(), ['bubble left', 'bubbles left'], ['bulle restante', 'bulles restantes']),
          L(`drop in ${s.untilDrop}`, `descente dans ${s.untilDrop}`),
        ].join(' · '),
      );

    function drawBubble(g: CanvasRenderingContext2D, k: number, x: number, y: number, r: number) {
      const c = arena.colors;
      if (arena.sh) {
        g.fillStyle = c.drop;
        g.beginPath();
        g.arc(x + arena.sh * 0.5, y + arena.sh * 0.5, r, 0, Math.PI * 2);
        g.fill();
      }
      arena.disc(g, x, y, r, c.p[TONE[k]]);
      g.fillStyle = c.cell;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.45;
      glyphPath(g, k, x, y, r * 0.48);
      g.fill();
      g.stroke();
    }

    /** The shot's path for the current aim, recomputed when the aim or the board changes. */
    function aimTrace(): Trace {
      const key = `${s.aim}|${s.shots}|${s.drops}`;
      if (!guide || key !== guideKey) {
        guide = trace(s, s.aim);
        guideKey = key;
      }
      return guide;
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const lag = (s.drops - shownDrops) * RH;
      // Launcher zone below the line.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, LINE_Y, W, H - LINE_Y);
      g.strokeStyle = c.bad;
      g.lineWidth = arena.lw;
      g.setLineDash([7, 5]);
      g.beginPath();
      g.moveTo(0, LINE_Y);
      g.lineTo(W, LINE_Y);
      g.stroke();
      g.setLineDash([]);
      // Ceiling slab.
      arena.box(g, -6, -10, W + 12, ceilingY(s) - lag + 10, c.muted, 0, true);

      // Aim guide: dots up to the first bounce and a little past it.
      if (!s.shot && !over) {
        const t = aimTrace();
        const bounce = t.pts.length > 2 ? Math.hypot(t.pts[1].x - LAUNCH.x, t.pts[1].y - LAUNCH.y) : Infinity;
        const stop = Math.min(t.length, bounce + AFTER_BOUNCE);
        g.fillStyle = c.fg;
        for (let d = 2 * R; d < stop; d += 12) {
          const p = along(t, d);
          g.beginPath();
          g.arc(p.x, p.y, 2, 0, Math.PI * 2);
          g.fill();
        }
        // Where it lands, when the guide reaches it.
        if (stop >= t.length && t.cell >= 0) {
          g.strokeStyle = c.fg;
          g.lineWidth = arena.lw * 0.8;
          g.setLineDash([4, 3]);
          g.beginPath();
          g.arc(cellX(t.cell), cellY(s, t.cell), R - 2, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
      }

      for (let i = 0; i < s.grid.length; i++) {
        const k = s.grid[i];
        if (k >= 0) drawBubble(g, k, cellX(i), cellY(s, i) - lag, R - 1);
      }
      for (const b of bursts) {
        const f = b.t / 0.3;
        g.globalAlpha = Math.max(0, 1 - f);
        drawBubble(g, b.k, b.x, b.y, (R - 1) * (1 - f * 0.6));
        g.strokeStyle = c.p[TONE[b.k]];
        g.lineWidth = arena.lw;
        g.beginPath();
        g.arc(b.x, b.y, R * (1 + f), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      for (const f of fallers) drawBubble(g, f.k, f.x, f.y, R - 1);

      // Launcher: barrel along the aim on a round base, the loaded bubble on top.
      const bx = LAUNCH.x + Math.sin(s.aim) * 26;
      const by = LAUNCH.y - Math.cos(s.aim) * 26;
      g.lineCap = 'round';
      g.strokeStyle = c.ink;
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(LAUNCH.x, LAUNCH.y);
      g.lineTo(bx, by);
      g.stroke();
      g.strokeStyle = c.accent;
      g.lineWidth = 14 - 2 * arena.lw * 0.8;
      g.stroke();
      g.lineCap = 'butt';
      arena.disc(g, LAUNCH.x, LAUNCH.y + 6, R + 5, c.accent);
      if (s.shot) {
        const p = along(s.shot, s.travelled);
        drawBubble(g, s.cur, p.x, p.y, R - 1);
      } else if (!over) drawBubble(g, s.cur, LAUNCH.x, LAUNCH.y, R - 1);
      if (!over) drawBubble(g, s.next, NEXT.x, NEXT.y, NEXT_R);
      // Shots before the ceiling drops: one pip each.
      for (let k = 0; k < s.every; k++) {
        const x = W - 16 - k * 13;
        const y = H - 18;
        if (k < s.untilDrop) arena.disc(g, x, y, 4.5, c.accent);
        else {
          g.strokeStyle = c.muted;
          g.lineWidth = arena.lw * 0.8;
          g.beginPath();
          g.arc(x, y, 4.5, 0, Math.PI * 2);
          g.stroke();
        }
      }
      if (flash > 0) {
        g.globalAlpha = flash * 0.5;
        g.fillStyle = c.bad;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    function landed(ev: Landing) {
      const lag = ev.lowered ? RH : 0;
      // Positions as drawn before the ceiling catches up.
      for (const i of ev.popped) bursts.push({ x: cellX(i), y: cellY(s, i) - lag, k: ev.colour, t: 0 });
      // Fallers scatter a little, varied by cell (the level's rng is kept for the shots).
      for (const [n, i] of ev.dropped.entries())
        fallers.push({
          x: cellX(i),
          y: cellY(s, i) - lag,
          vx: (((i * 37) % 11) - 5) * 9,
          vy: -40 - ((i * 13) % 7) * 9,
          k: ev.droppedColours[n],
        });
      ctx.score(s.score);
      status();
      if (ev.won || ev.lost) {
        over = true;
        end = ev.won ? 'win' : 'lose';
        if (ev.lost) flash = 0.6;
      }
    }

    const nearNext = (p: Point) => Math.hypot(p.x - NEXT.x, p.y - NEXT.y) < NEXT_R + 10;
    const aim = (p: Point) => {
      if (!over) aimAt(s, p.x, p.y);
    };
    const fire = () => {
      if (!over && shoot(s)) draw();
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onDown(p) {
        swapPress = nearNext(p);
        if (!swapPress && p.y < LINE_Y) aim(p);
      },
      onMove(p, from) {
        if (from ? !swapPress && p.y < LINE_Y : p.y < LINE_Y) aim(p);
      },
      onTap(p) {
        if (swapPress) swapNext(s);
        else {
          if (p.y < LINE_Y) aim(p);
          fire();
        }
        draw();
      },
      onRelease(p) {
        // Dragging back down into the launcher zone cancels the shot.
        if (swapPress || p.y >= LINE_Y) return;
        aim(p);
        fire();
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const ev = over ? null : step(s, dt);
        if (ev) landed(ev);
        shownDrops = Math.min(s.drops, shownDrops + dt * 3);
        flash = Math.max(0, flash - dt);
        for (const b of bursts) b.t += dt;
        bursts = bursts.filter((b) => b.t < 0.3);
        for (const f of fallers) {
          f.vy += GRAVITY * dt;
          f.x += f.vx * dt;
          f.y += f.vy * dt;
        }
        fallers = fallers.filter((f) => f.y < H + R);
        draw();
        if (end) {
          endT += dt;
          if (endT >= END_S) {
            if (end === 'win') ctx.win();
            else ctx.lose();
            end = '';
          }
        }
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = k === 'arrowleft' || k === 'a' ? -1 : k === 'arrowright' || k === 'd' ? 1 : 0;
        if (dir) {
          if (e.type === 'keydown') s.turn = dir;
          else if (s.turn === dir) s.turn = 0;
          return true;
        }
        const down = e.type === 'keydown';
        if (k === ' ' || k === 'enter' || k === 'arrowup' || k === 'w') {
          if (down) fire();
          return true;
        }
        if (k === 'arrowdown' || k === 's' || k === 'x') {
          if (down && !over) swapNext(s);
          return true;
        }
        return false;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
