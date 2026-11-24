import './style.css';
import { L, P } from '../../core/i18n';
import { btn } from '../../core/pad';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures } from '../../kits/gesture/gesture';
import { sfx } from '../../kits/sound/sound';
import {
  BULLET_R,
  createLevel,
  H,
  LIFE_BONUS,
  LIVES,
  parFor,
  POINTS,
  ROCK_R,
  type Rock,
  rockPoints,
  SHIP_R,
  step,
  TIME_POINTS,
  W,
} from './rules';

/** A bit of flying debris from a broken rock or the ship. */
interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ship: boolean;
}

/** Copies of a thing near an edge, so it shows on both sides while it wraps. */
function ghosts(x: number, y: number, r: number): [number, number][] {
  const xs = [x, ...(x < r ? [x + W] : x > W - r ? [x - W] : [])];
  const ys = [y, ...(y < r ? [y + H] : y > H - r ? [y - H] : [])];
  return xs.flatMap((gx) => ys.map((gy): [number, number] => [gx, gy]));
}

export const rocks: GameDef = {
  id: 'rocks',
  get name() {
    return L('Rocks', 'Rochers');
  },
  get rules() {
    return L('Fly the ship and shoot every rock to dust.', 'Pilotez le vaisseau et pulvérisez tous les rochers.');
  },
  category: 'reflex',
  help: () => ({
    goal: L(
      'Shoot every rock, and every piece of it, without losing all your ships.',
      'Détruisez tous les rochers, et chacun de leurs morceaux, sans perdre tous vos vaisseaux.',
    ),
    steps: [
      L(
        'A big rock splits into two medium ones, a medium one into two small ones; small ones vanish.',
        'Un gros rocher se brise en deux moyens, un moyen en deux petits; les petits disparaissent.',
      ),
      L(
        'The field wraps around: leave by one edge, come back by the other. The ship drifts until it slows down.',
        'Le terrain boucle : sortez d’un côté, revenez de l’autre. Le vaisseau glisse avant de ralentir.',
      ),
      L(
        'A rock that hits you costs a ship. The next one appears in the centre, safe for a moment (it blinks).',
        'Un rocher qui vous touche coûte un vaisseau. Le suivant apparaît au centre, protégé un instant (il clignote).',
      ),
      L(
        'Touch and hold anywhere: the ship turns toward your finger and fires; hold far from it to fly that way.',
        'Touchez et maintenez n’importe où : le vaisseau se tourne vers votre doigt et tire; loin de lui, il avance.',
      ),
      L(
        'Keyboard: ← → to turn, ↑ to thrust, Space to shoot, P to pause.',
        'Clavier : ← → pour tourner, ↑ pour avancer, Espace pour tirer, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Small rocks are worth ${POINTS[1]}, medium ${POINTS[2]}, big ${POINTS[3]}. Each ship left adds ${LIFE_BONUS}, each second under par ${TIME_POINTS}.`,
        `Petit rocher : ${POINTS[1]}, moyen : ${POINTS[2]}, gros : ${POINTS[3]}. Chaque vaisseau restant ajoute ${LIFE_BONUS}, chaque seconde sous la normale ${TIME_POINTS}.`,
      ),
      L('Keep your finger close to the ship to aim without moving.', 'Gardez le doigt près du vaisseau pour viser sans bouger.'),
    ],
  }),
  stars: (d) => {
    // Two: lose up to two ships at a fair pace. Three: a fast run without losing a ship (one at Expert+).
    const base = rockPoints(d);
    const par = parFor(d);
    return [
      base + LIFE_BONUS + Math.round(par * 0.3) * TIME_POINTS,
      base + (d >= 4 ? 2 : 3) * LIFE_BONUS + Math.round(par * 0.65) * TIME_POINTS,
    ];
  },
  par: (d) => parFor(d),
  pad: () => ({
    left: [btn('ArrowLeft', 'ccw', L('Turn left', 'Tourner à gauche')), btn('ArrowRight', 'cw', L('Turn right', 'Tourner à droite'))],
    right: [btn('ArrowUp', 'thrust', L('Thrust', 'Avancer')), btn(' ', 'fire', L('Fire', 'Tirer'))],
  }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const bits: Bit[] = [];
    let flash = 0;

    const status = () => {
      const big = s.rocks.filter((r) => r.size === 3).length;
      ctx.status(
        [
          P(s.rocks.length, ['rock left', 'rocks left'], ['rocher restant', 'rochers restants']),
          big ? P(big, ['big', 'big'], ['gros', 'gros']) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
    };

    function rockPath(g: CanvasRenderingContext2D, r: Rock, x: number, y: number) {
      const rad = ROCK_R[r.size];
      g.beginPath();
      r.shape.forEach((f, i) => {
        const a = r.rot + (i * Math.PI * 2) / r.shape.length;
        const px = x + Math.cos(a) * rad * f;
        const py = y + Math.sin(a) * rad * f;
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      });
      g.closePath();
    }

    function drawRock(g: CanvasRenderingContext2D, r: Rock) {
      const c = arena.colors;
      const rad = ROCK_R[r.size];
      for (const [x, y] of ghosts(r.x, r.y, rad)) {
        if (arena.sh) {
          g.fillStyle = c.drop;
          rockPath(g, r, x + arena.sh * 0.6, y + arena.sh * 0.6);
          g.fill();
        }
        g.fillStyle = c.cellAlt;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.8;
        rockPath(g, r, x, y);
        g.fill();
        g.stroke();
        // A couple of craters, turning with the rock.
        g.strokeStyle = c.muted;
        g.lineWidth = arena.lw * 0.5;
        for (const k of r.size > 1 ? [0, 2] : [0]) {
          const a = r.rot + k * 2.1;
          g.beginPath();
          g.arc(x + Math.cos(a) * rad * 0.38, y + Math.sin(a) * rad * 0.38, rad * (0.16 + k * 0.03), 0, Math.PI * 2);
          g.stroke();
        }
      }
    }

    function shipPath(g: CanvasRenderingContext2D, x: number, y: number) {
      const pt = (f: number, back: number) => {
        const a = s.a + f;
        return [x + Math.sin(a) * back, y - Math.cos(a) * back] as const;
      };
      g.beginPath();
      g.moveTo(...pt(0, SHIP_R * 1.5));
      g.lineTo(...pt(2.45, SHIP_R * 1.1));
      g.lineTo(...pt(Math.PI, SHIP_R * 0.45));
      g.lineTo(...pt(-2.45, SHIP_R * 1.1));
      g.closePath();
    }

    function drawShip(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      if (!s.alive) return;
      const blink = s.safe > 0 && Math.floor(s.safe * 10) % 2 === 1;
      for (const [x, y] of ghosts(s.x, s.y, SHIP_R * 2)) {
        if (s.burning) {
          const len = SHIP_R * (1.3 + 0.5 * Math.sin(s.time * 40));
          g.fillStyle = c.p[3];
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.6;
          g.beginPath();
          g.moveTo(x - Math.sin(s.a) * SHIP_R * 0.4 + Math.cos(s.a) * 4, y + Math.cos(s.a) * SHIP_R * 0.4 + Math.sin(s.a) * 4);
          g.lineTo(x - Math.sin(s.a) * (SHIP_R * 0.4 + len), y + Math.cos(s.a) * (SHIP_R * 0.4 + len));
          g.lineTo(x - Math.sin(s.a) * SHIP_R * 0.4 - Math.cos(s.a) * 4, y + Math.cos(s.a) * SHIP_R * 0.4 - Math.sin(s.a) * 4);
          g.closePath();
          g.fill();
          g.stroke();
        }
        if (arena.sh) {
          g.fillStyle = c.drop;
          shipPath(g, x + arena.sh * 0.6, y + arena.sh * 0.6);
          g.fill();
        }
        g.fillStyle = blink ? c.cell : c.accent;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.8;
        shipPath(g, x, y);
        g.fill();
        g.stroke();
        if (s.safe > 0) {
          // Shield ring while safe.
          g.strokeStyle = c.accent;
          g.lineWidth = arena.lw * 0.7;
          g.setLineDash([3, 3]);
          g.beginPath();
          g.arc(x, y, SHIP_R * 2.1, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Faint fixed specks for a sense of space (no randomness: a simple hash).
      g.fillStyle = c.cellAlt;
      for (let i = 0; i < 40; i++) g.fillRect((i * 97.3) % W, (i * 151.7 + (i % 7) * 23) % H, 2, 2);
      if (flash > 0) {
        g.globalAlpha = Math.min(1, flash) * 0.25;
        g.fillStyle = c.bad;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
      for (const r of s.rocks) drawRock(g, r);
      for (const b of s.bullets) arena.disc(g, b.x, b.y, BULLET_R, c.fg);
      for (const b of bits) {
        g.globalAlpha = Math.min(1, b.life * 2);
        g.fillStyle = b.ship ? c.accent : c.muted;
        g.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
      }
      g.globalAlpha = 1;
      drawShip(g);
      if (s.pointer) {
        g.strokeStyle = c.muted;
        g.lineWidth = arena.lw * 0.6;
        g.beginPath();
        g.arc(s.pointer.x, s.pointer.y, 9, 0, Math.PI * 2);
        g.stroke();
      }
    }

    const hold = (p: { x: number; y: number }) => (s.pointer = p);
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onDown: hold,
      onMove: (p, from) => from && hold(p),
      onTap: () => (s.pointer = null),
      onRelease: () => (s.pointer = null),
    });

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const cool = s.cool;
        const ev = step(s, dt);
        if (s.cool > cool) sfx('shoot', { vol: 0.5 });
        for (const b of ev.blasts) {
          if (!b.ship) sfx('pop', { pitch: b.r >= 30 ? -8 : b.r >= 17 ? -3 : 3 });
          const n = b.ship ? 14 : 4 + Math.round(b.r / 3);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + b.x * 0.1;
            const sp = 40 + ((i * 37) % 50);
            bits.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, ship: b.ship });
          }
        }
        for (let i = bits.length - 1; i >= 0; i--) {
          const b = bits[i];
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.life -= dt;
          if (b.life <= 0) bits.splice(i, 1);
        }
        flash = Math.max(0, flash - dt * 2);
        if (ev.died) {
          flash = 1;
          ctx.lives(s.lives, LIVES);
        }
        if (ev.hit || ev.cleared) {
          ctx.score(s.score);
          status();
        }
        draw();
        if (ev.cleared) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const down = e.type === 'keydown';
        switch (e.key.toLowerCase()) {
          case 'arrowleft':
          case 'a':
            if (down) s.turn = -1;
            else if (s.turn === -1) s.turn = 0;
            return true;
          case 'arrowright':
          case 'd':
            if (down) s.turn = 1;
            else if (s.turn === 1) s.turn = 0;
            return true;
          case 'arrowup':
          case 'w':
            s.thrust = down;
            return true;
          case ' ':
          case 'enter':
            s.fire = down;
            return true;
          default:
            return false;
        }
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
