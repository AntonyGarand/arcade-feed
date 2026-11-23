import './style.css';
import { L } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures, type Point } from '../../kits/gesture/gesture';
import { sfx } from '../../kits/sound/sound';
import { BALL_R, createLevel, CUP_R, H, limitFor, putt, setAim, step, STROKE_POINTS, W, WALL } from './rules';

/** Drag length (world units) for a full-power putt. */
const PULL_MAX = 110;
const FONT = "'Space Grotesk Variable', system-ui, sans-serif";

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
}

interface Ring {
  x: number;
  y: number;
  t: number;
}

export const golf: GameDef = {
  id: 'golf',
  get name() {
    return L('Mini Golf', 'Minigolf');
  },
  get rules() {
    return L('Sink the ball in as few putts as you can.', 'Envoyez la balle dans le trou en le moins de coups possible.');
  },
  category: 'aim',
  help: () => ({
    goal: L('Get the ball into the cup before you run out of strokes.', 'Mettez la balle dans le trou avant d’avoir épuisé vos coups.'),
    steps: [
      L(
        'The ball rolls, slows down and bounces off walls; round bumpers kick it back harder.',
        'La balle roule, ralentit et rebondit sur les murs; les butoirs ronds la renvoient plus fort.',
      ),
      L(
        'It drops in only if it’s rolling slowly enough over the cup. Sand slows it right down.',
        'Elle ne tombe que si elle roule assez lentement sur le trou. Le sable la freine net.',
      ),
      L(
        'Water costs a penalty stroke and puts the ball back where it was.',
        'L’eau coûte un coup de pénalité et ramène la balle où elle était.',
      ),
      L(
        'Drag back from anywhere (the ball goes the other way, harder the further you pull), release to putt.',
        'Glissez vers l’arrière n’importe où (la balle part à l’opposé, plus fort si vous tirez loin), relâchez pour frapper.',
      ),
      L(
        'Keyboard: ← → to aim, ↑ ↓ for power, Space to putt, P to pause.',
        'Clavier : ← → pour viser, ↑ ↓ pour la puissance, Espace pour frapper, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Every stroke left under the limit is worth ${STROKE_POINTS} points.`,
        `Chaque coup restant sous la limite vaut ${STROKE_POINTS} points.`,
      ),
      L('Bank shots off the walls often beat going the long way around.', 'Un rebond sur un mur vaut souvent mieux qu’un long détour.'),
    ],
  }),
  // Three stars for par (a hole in one on the easy level), two for one stroke more.
  stars: (d) => {
    const three = byLevel(d, [1, 2, 3, 3, 4]);
    return [STROKE_POINTS * (limitFor(d) - three), STROKE_POINTS * (limitFor(d) - three + 1)];
  },
  par: (d) => byLevel(d, [20, 25, 35, 40, 50]),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    let drag: { from: Point; to: Point } | null = null;
    let sparks: Spark[] = [];
    let rings: Ring[] = [];
    /** Recent ball positions, for a short trail. */
    let trail: Point[] = [];
    /** "Penalty" banner timer. */
    let penalty = 0;
    let time = 0;
    let ended = false;
    /** The ball dropped: the flag comes out and the ball is gone. */
    let sunk = false;

    const status = () => ctx.status(`${L('Strokes', 'Coups')} ${s.strokes}/${s.limit} · ${L('par', 'normale')} ${s.par}`);

    function drawWall(g: CanvasRenderingContext2D, i: number) {
      const c = arena.colors;
      const w = s.walls[i];
      switch (w.kind) {
        case 'rect':
          // The border walls are drawn as one frame.
          if (i >= 4) arena.box(g, w.x, w.y, w.w, w.h, c.cellAlt, 2);
          break;
        case 'disc':
          arena.disc(g, w.x, w.y, w.r, c.p[6]);
          arena.disc(g, w.x, w.y, w.r * 0.45, c.cell);
          break;
        case 'seg':
          g.lineCap = 'round';
          g.strokeStyle = c.ink;
          g.lineWidth = w.r * 2;
          g.beginPath();
          g.moveTo(w.x1, w.y1);
          g.lineTo(w.x2, w.y2);
          g.stroke();
          g.strokeStyle = c.cellAlt;
          g.lineWidth = w.r * 2 - arena.lw * 1.6;
          g.stroke();
          g.lineCap = 'butt';
          break;
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Fairway: a tint of the accent inside the frame.
      g.globalAlpha = 0.28;
      g.fillStyle = c.accent;
      g.fillRect(WALL, WALL, W - 2 * WALL, H - 2 * WALL);
      g.globalAlpha = 1;
      // Sand: yellow with a stipple; water: blue with ripples.
      for (const z of s.sand) {
        arena.box(g, z.x, z.y, z.w, z.h, c.p[3], 10, false);
        g.fillStyle = c.ink;
        g.globalAlpha = 0.35;
        for (let y = z.y + 6; y < z.y + z.h - 3; y += 7)
          for (let x = z.x + 6 + ((y / 7) % 2) * 3; x < z.x + z.w - 3; x += 8) g.fillRect(x, y, 1.4, 1.4);
        g.globalAlpha = 1;
      }
      for (const z of s.water) {
        arena.box(g, z.x, z.y, z.w, z.h, c.p[1], 8, false);
        g.strokeStyle = c.cell;
        g.lineWidth = 1.2;
        g.globalAlpha = 0.7;
        for (let y = z.y + 8; y < z.y + z.h - 4; y += 8) {
          g.beginPath();
          for (let x = z.x + 6; x < z.x + z.w - 6; x += 2) {
            const yy = y + Math.sin(x / 5 + time * 2) * 1.5;
            if (x === z.x + 6) g.moveTo(x, yy);
            else g.lineTo(x, yy);
          }
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      // Frame.
      g.fillStyle = c.muted;
      g.fillRect(0, 0, W, WALL);
      g.fillRect(0, H - WALL, W, WALL);
      g.fillRect(0, 0, WALL, H);
      g.fillRect(W - WALL, 0, WALL, H);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.strokeRect(WALL, WALL, W - 2 * WALL, H - 2 * WALL);
      // Power gauge along the bottom of the frame.
      if (!s.rolling && !s.done) {
        g.fillStyle = c.accent;
        g.fillRect(WALL, H - WALL + 2, (W - 2 * WALL) * s.power, WALL - 4);
      }
      // Tee mark.
      g.fillStyle = c.cell;
      g.globalAlpha = 0.6;
      g.fillRect(s.tee.x - 9, s.tee.y - 2, 18, 4);
      g.globalAlpha = 1;
      for (let i = 0; i < s.walls.length; i++) drawWall(g, i);
      // Cup and flag.
      arena.disc(g, s.cup.x, s.cup.y, CUP_R, c.ink);
      if (!sunk) {
        g.strokeStyle = c.ink;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(s.cup.x, s.cup.y);
        g.lineTo(s.cup.x, s.cup.y - 30);
        g.stroke();
        g.fillStyle = c.p[0];
        g.lineWidth = arena.lw * 0.6;
        g.beginPath();
        g.moveTo(s.cup.x, s.cup.y - 30);
        g.lineTo(s.cup.x + 16, s.cup.y - 25 + Math.sin(time * 3) * 1.5);
        g.lineTo(s.cup.x, s.cup.y - 20);
        g.closePath();
        g.fill();
        g.stroke();
      }
      // Aim guide: dots along the aim, longer with more power, and an arrowhead.
      if (!s.rolling && !s.done) {
        const len = 18 + s.power * 110;
        const ca = Math.cos(s.aim);
        const sa = Math.sin(s.aim);
        g.fillStyle = c.ink;
        for (let d = BALL_R + 6; d < len; d += 7) {
          g.beginPath();
          g.arc(s.bx + ca * d, s.by + sa * d, 1.7, 0, Math.PI * 2);
          g.fill();
        }
        const tx = s.bx + ca * len;
        const ty = s.by + sa * len;
        g.beginPath();
        g.moveTo(tx + ca * 6, ty + sa * 6);
        g.lineTo(tx - sa * 4, ty + ca * 4);
        g.lineTo(tx + sa * 4, ty - ca * 4);
        g.closePath();
        g.fill();
      }
      // Trail and ball.
      g.fillStyle = c.cell;
      for (const [i, p] of trail.entries()) {
        g.globalAlpha = (i / trail.length) * 0.5;
        g.beginPath();
        g.arc(p.x, p.y, BALL_R * (0.5 + (i / trail.length) * 0.4), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      if (!sunk) {
        if (arena.sh) {
          g.fillStyle = c.drop;
          g.beginPath();
          g.arc(s.bx + arena.sh * 0.5, s.by + arena.sh * 0.5, BALL_R, 0, Math.PI * 2);
          g.fill();
        }
        arena.disc(g, s.bx, s.by, BALL_R, c.cell);
      }
      // Effects: rings (splash, sink) and sparks.
      for (const r of rings) {
        g.globalAlpha = r.t;
        g.strokeStyle = c.cell;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(r.x, r.y, 4 + (1 - r.t) * 24, 0, Math.PI * 2);
        g.stroke();
      }
      for (const p of sparks) {
        g.globalAlpha = Math.min(1, p.t * 2);
        g.fillStyle = c.p[3];
        g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      g.globalAlpha = 1;
      if (penalty > 0) {
        g.globalAlpha = Math.min(1, penalty * 2);
        g.font = `700 14px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        arena.box(g, W / 2 - 70, H / 2 - 14, 140, 28, c.bad, 4);
        g.fillStyle = c.ink;
        g.fillText(L('Water! +1 stroke', 'À l’eau! +1 coup'), W / 2, H / 2 + 1);
        g.globalAlpha = 1;
      }
      // Pointer drag band.
      if (drag) {
        g.strokeStyle = c.muted;
        g.lineWidth = 1.5;
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(drag.from.x, drag.from.y);
        g.lineTo(drag.to.x, drag.to.y);
        g.stroke();
        g.setLineDash([]);
        arena.disc(g, drag.from.x, drag.from.y, 3, c.cell);
      }
    }

    const burst = (x: number, y: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const v = 60 + (i % 3) * 30;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 1 });
      }
    };

    const aim = (from: Point, to: Point) => {
      drag = { from, to };
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      if (Math.hypot(dx, dy) >= 6) setAim(s, Math.atan2(dy, dx), Math.hypot(dx, dy) / PULL_MAX);
    };
    const fire = () => {
      if (ended || !putt(s)) return;
      trail = [];
      sfx('hit', { pitch: 5 });
      status();
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onMove: (p, from) => {
        if (from && !s.rolling) aim(from, p);
      },
      onTap: () => {
        drag = null;
      },
      onRelease: (p, from) => {
        drag = null;
        if (s.rolling || Math.hypot(from.x - p.x, from.y - p.y) < 10) return;
        aim(from, p);
        drag = null;
        fire();
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        time += dt;
        const ev = step(s, dt);
        if (s.rolling) {
          trail.push({ x: s.bx, y: s.by });
          if (trail.length > 8) trail.shift();
        } else trail = [];
        if (ev.bump > 60) {
          burst(s.bx, s.by, 4);
          sfx('hit', { pitch: -3, vol: Math.min(1, ev.bump / 200) });
        }
        if (ev.splash) {
          sfx('splash');
          penalty = 1.2;
          rings.push({ x: s.bx, y: s.by, t: 1 });
          status();
        }
        if (ev.stopped) status();
        if (ev.cleared) {
          sunk = true;
          sfx('power');
          rings.push({ x: s.cup.x, y: s.cup.y, t: 1 });
          burst(s.cup.x, s.cup.y, 14);
          ctx.score(s.score);
          status();
        }
        penalty = Math.max(0, penalty - dt);
        for (const r of rings) r.t -= dt * 1.5;
        rings = rings.filter((r) => r.t > 0);
        for (const p of sparks) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.t -= dt * 1.8;
        }
        sparks = sparks.filter((p) => p.t > 0);
        draw();
        if (ended) return;
        if (ev.cleared) {
          ended = true;
          ctx.win();
        } else if (ev.over) {
          ended = true;
          ctx.lose();
        }
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const down = e.type === 'keydown';
        const turn = k === 'arrowright' || k === 'd' ? 1 : k === 'arrowleft' || k === 'a' ? -1 : 0;
        if (turn) {
          if (down) s.turn = turn;
          else if (s.turn === turn) s.turn = 0;
          return true;
        }
        const pump = k === 'arrowup' || k === 'w' ? 1 : k === 'arrowdown' || k === 's' ? -1 : 0;
        if (pump) {
          if (down) s.pump = pump;
          else if (s.pump === pump) s.pump = 0;
          return true;
        }
        if (k === ' ' || k === 'enter') {
          if (down && !e.repeat) fire();
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
