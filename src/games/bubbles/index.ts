import './style.css';
import { L, P } from '../../core/i18n';
import { btn, leftRight } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures, type Point } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { sfx } from '../../kits/sound/sound';
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
  hit?: boolean;
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
  pad: () => ({ left: leftRight(), right: [btn('ArrowDown', 'swap', L('Swap', 'Échanger')), btn(' ', 'fire', L('Shoot', 'Tirer'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());

    let bursts: Burst[] = [];
    let fallers: Faller[] = [];
    /** Ceiling drops as drawn (eases towards the real count). */
    let shownDrops = 0;
    const fx = arena.fx;
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
      const fill = c.p[TONE[k]];
      arena.ball(g, x, y, r, fill);
      g.fillStyle = c.paper;
      g.strokeStyle = arena.tone(fill).edge;
      g.lineWidth = arena.lw * 0.5;
      glyphPath(g, k, x - r * 0.04, y - r * 0.04, r * 0.46);
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
      arena.field(g, 0, 0, W, LINE_Y, 2 * R, 0, false);
      // Launcher zone below the line; the line pulses once a bubble hangs close to it.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, LINE_Y, W, H - LINE_Y);
      const near = !over && s.grid.some((k, i) => k >= 0 && cellY(s, i) + R > LINE_Y - 2 * RH);
      if (near) {
        g.fillStyle = c.bad;
        g.globalAlpha = 0.1 + 0.08 * Math.sin(arena.time * 8);
        g.fillRect(0, LINE_Y - 2 * RH, W, 2 * RH);
        g.globalAlpha = 1;
      }
      g.strokeStyle = c.bad;
      g.lineWidth = near ? arena.lw * (1.2 + 0.4 * Math.sin(arena.time * 8)) : arena.lw;
      g.setLineDash([7, 5]);
      g.beginPath();
      g.moveTo(0, LINE_Y);
      g.lineTo(W, LINE_Y);
      g.stroke();
      g.setLineDash([]);
      // Ceiling slab.
      const cy = ceilingY(s) - lag;
      arena.block(g, -6, -10, W + 12, cy + 10, c.muted, 0, true, 0.6);
      // Rivets along its edge and arrows pointing down: it's coming.
      g.fillStyle = arena.tone(c.muted).lo;
      for (let x = 15; x < W; x += 30) {
        g.beginPath();
        g.arc(x, cy - 4, 1.8, 0, Math.PI * 2);
        g.fill();
      }
      if (cy > 24)
        for (let x = 30; x < W; x += 60) {
          const y = cy / 2 + 2;
          g.beginPath();
          g.moveTo(x - 6, y - 4);
          g.lineTo(x + 6, y - 4);
          g.lineTo(x, y + 3);
          g.closePath();
          g.fill();
        }

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
      arena.overlay(g);
    }

    function landed(ev: Landing) {
      const lag = ev.lowered ? RH : 0;
      if (ev.popped.length) sfx('pop', { pitch: Math.min(8, ev.popped.length) });
      else sfx('hit', { pitch: -2 });
      if (ev.dropped.length) sfx('combo', { step: Math.min(8, ev.dropped.length) });
      if (ev.lowered) sfx('hit', { pitch: -9, vol: 0.7 });
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
      const c = arena.colors;
      if (ev.popped.length) {
        let mx = 0;
        let my = 0;
        for (const i of ev.popped) {
          const x = cellX(i);
          const y = cellY(s, i) - lag;
          mx += x / ev.popped.length;
          my += y / ev.popped.length;
          fx.burst(x, y, c.p[TONE[ev.colour]], 6, 120, 3, 0.45, 'dot', 160);
        }
        const gain = ev.popped.length * POP_POINTS + ev.dropped.length * DROP_POINTS;
        const big = gain >= 100;
        fx.text(Math.max(24, Math.min(W - 24, mx)), my, `+${gain}`, big ? c.accent : c.fg, big ? 17 : 13);
        if (ev.dropped.length >= 3) {
          fx.text(
            Math.max(40, Math.min(W - 40, mx)),
            my + 20,
            L(`${ev.dropped.length} dropped!`, `${ev.dropped.length} tombées!`),
            c.accent,
            12,
            1,
          );
          fx.shake(2 + Math.min(3, ev.dropped.length / 3), 0.25);
        }
      } else if (ev.cell >= 0) fx.ring(cellX(ev.cell), cellY(s, ev.cell) - lag, c.muted, R * 0.6, R * 1.3, 0.25, arena.lw * 0.8);
      if (ev.lowered && !ev.won) {
        fx.shake(3, 0.25);
        for (let x = 20; x < W; x += 52) fx.burst(x, ceilingY(s), c.muted, 3, 60, 2.5, 0.4, 'square', 240, Math.PI / 2, Math.PI * 0.6);
      }
      ctx.score(s.score);
      status();
      if (ev.won || ev.lost) {
        over = true;
        end = ev.won ? 'win' : 'lose';
        if (ev.lost) {
          fx.flash(c.bad, 0.35, 0.5);
          fx.shake(5, 0.4);
        } else {
          for (let i = 0; i < 5; i++) fx.burst(W / 2, LINE_Y / 2, c.p[TONE[i]], 10, 200, 3.5, 0.9, 'square', 220);
          fx.flash(c.good, 0.22, 0.5);
        }
      }
    }

    const nearNext = (p: Point) => Math.hypot(p.x - NEXT.x, p.y - NEXT.y) < NEXT_R + 10;
    const aim = (p: Point) => {
      if (!over) aimAt(s, p.x, p.y);
    };
    const fire = () => {
      if (!over && shoot(s)) {
        sfx('shoot', { vol: 0.8 });
        draw();
      }
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
        if (swapPress) {
          swapNext(s);
          sfx('flip', { vol: 0.6 });
        } else {
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
        arena.update(dt);
        for (const b of bursts) b.t += dt;
        bursts = bursts.filter((b) => b.t < 0.3);
        for (const f of fallers) {
          f.vy += GRAVITY * dt;
          f.x += f.vx * dt;
          f.y += f.vy * dt;
        }
        for (const f of fallers)
          if (f.y >= LINE_Y - R && f.vy > 0 && !f.hit) {
            f.hit = true;
            fx.burst(f.x, LINE_Y, arena.colors.p[TONE[f.k]], 5, 80, 2.5, 0.35, 'dot', 200, -Math.PI / 2, Math.PI * 0.8);
          }
        fallers = fallers.filter((f) => f.y < H + R);
        draw();
        if (end) {
          endT += dt;
          // Let the last fallers drop out of sight first (they'd freeze in mid-air once the card stops).
          if (endT >= END_S && (!fallers.length || endT >= END_S + 1)) {
            arena.linger(1.2);
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
          if (down && !over) {
            swapNext(s);
            sfx('flip', { vol: 0.6 });
          }
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
