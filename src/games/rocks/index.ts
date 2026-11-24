import './style.css';
import { L, P } from '../../core/i18n';
import { btn } from '../../core/pad';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { outBack } from '../../kits/arena/ease';
import { gestures } from '../../kits/gesture/gesture';
import { haptic, sfx } from '../../kits/sound/sound';
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
    const fx = arena.fx;
    /** Seconds since the ship (re)appeared, for its warp-in. */
    let spawn = 0;
    let ended = false;
    /** Arena time each rock was last shot at (it flashes), keyed by the rock. */
    const struck = new WeakMap<Rock, number>();

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

    function rockPath(g: CanvasRenderingContext2D, r: Rock, x: number, y: number, k = 1) {
      const rad = ROCK_R[r.size] * k;
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
      // Stone: a solid grey that reads on the dark sky and on paper alike, shaded on its lower right.
      const t = arena.tone(stone());
      for (const [x, y] of ghosts(r.x, r.y, rad)) {
        if (arena.sh) {
          g.fillStyle = c.drop;
          rockPath(g, r, x + arena.sh * 0.6, y + arena.sh * 0.6);
          g.fill();
        }
        rockPath(g, r, x, y);
        g.fillStyle = t.lo;
        g.fill();
        g.save();
        g.clip();
        rockPath(g, r, x - rad * 0.12, y - rad * 0.12, 0.92);
        g.fillStyle = t.base;
        g.fill();
        // Craters, turning with the rock.
        g.fillStyle = t.lo;
        for (const k of r.size > 1 ? [0, 2, 4] : [0]) {
          const a = r.rot + k * 2.1;
          const cr = rad * (0.13 + (k % 3) * 0.04);
          const qx = x + Math.cos(a) * rad * 0.42;
          const qy = y + Math.sin(a) * rad * 0.42;
          g.beginPath();
          g.arc(qx, qy, cr, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = t.hi;
          g.globalAlpha = 0.5;
          g.beginPath();
          g.arc(qx + cr * 0.35, qy + cr * 0.35, cr * 0.55, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 1;
          g.fillStyle = t.lo;
        }
        g.restore();
        rockPath(g, r, x, y);
        g.strokeStyle = t.edge;
        g.lineWidth = arena.lw * 0.8;
        g.lineJoin = 'round';
        g.stroke();
        const hit = struck.get(r);
        if (hit != null && arena.time - hit < 0.12) {
          g.globalAlpha = 0.7 * (1 - (arena.time - hit) / 0.12);
          g.fillStyle = c.paper;
          g.fill();
          g.globalAlpha = 1;
        }
      }
    }

    const stone = () => mix(arena.colors.fg, arena.colors.cellAlt, arena.dark ? 0.62 : 0.55);

    function shipPath(g: CanvasRenderingContext2D, x: number, y: number, k = 1) {
      const pt = (f: number, back: number) => {
        const a = s.a + f;
        return [x + Math.sin(a) * back * k, y - Math.cos(a) * back * k] as const;
      };
      g.beginPath();
      g.moveTo(...pt(0, SHIP_R * 1.6));
      g.lineTo(...pt(2.4, SHIP_R * 1.2));
      g.lineTo(...pt(Math.PI, SHIP_R * 0.45));
      g.lineTo(...pt(-2.4, SHIP_R * 1.2));
      g.closePath();
    }

    function drawShip(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      if (!s.alive) return;
      const blink = s.safe > 0 && Math.floor(s.safe * 10) % 2 === 1;
      const pop = spawn < 0.4 ? Math.max(0.05, outBack(spawn / 0.4)) : 1;
      for (const [x, y] of ghosts(s.x, s.y, SHIP_R * 2)) {
        if (s.burning) {
          const len = SHIP_R * (1.3 + 0.5 * Math.sin(s.time * 40));
          const bx = x - Math.sin(s.a) * SHIP_R * 0.45;
          const by = y + Math.cos(s.a) * SHIP_R * 0.45;
          for (const [w, l, col] of [
            [4.5, len, c.p[0]],
            [2.4, len * 0.6, c.p[3]],
          ] as const) {
            g.fillStyle = col;
            g.beginPath();
            g.moveTo(bx + Math.cos(s.a) * w, by + Math.sin(s.a) * w);
            g.lineTo(bx - Math.sin(s.a) * l, by + Math.cos(s.a) * l);
            g.lineTo(bx - Math.cos(s.a) * w, by - Math.sin(s.a) * w);
            g.closePath();
            g.fill();
          }
        }
        if (arena.sh) {
          g.fillStyle = c.drop;
          shipPath(g, x + arena.sh * 0.6, y + arena.sh * 0.6, pop);
          g.fill();
        }
        const t = arena.tone(c.accent);
        g.fillStyle = blink ? c.cell : c.accent;
        g.strokeStyle = t.edge;
        g.lineWidth = arena.lw * 0.8;
        g.lineJoin = 'round';
        shipPath(g, x, y, pop);
        g.fill();
        g.stroke();
        // Cockpit.
        arena.disc(g, x + Math.sin(s.a) * SHIP_R * 0.35 * pop, y - Math.cos(s.a) * SHIP_R * 0.35 * pop, 2.2 * pop, c.coal);
        if (s.safe > 0) {
          // Shield bubble while safe.
          g.strokeStyle = c.accent;
          g.globalAlpha = 0.5 + 0.3 * Math.sin(arena.time * 10);
          g.lineWidth = arena.lw * 0.8;
          g.beginPath();
          g.arc(x, y, SHIP_R * 2.1, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = t.glow;
          g.globalAlpha = 0.25;
          g.fill();
          g.globalAlpha = 1;
        }
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Fixed twinkling specks for a sense of space (no randomness: a simple hash).
      g.fillStyle = c.muted;
      for (let i = 0; i < 40; i++) {
        g.globalAlpha = 0.3 + 0.3 * Math.sin(arena.time * (0.7 + (i % 5) * 0.3) + i * 1.3);
        g.beginPath();
        g.arc((i * 97.3) % W, (i * 151.7 + (i % 7) * 23) % H, i % 5 ? 0.8 : 1.3, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      // Where the finger is: a ring, and a faint line from the ship.
      if (s.pointer && s.alive) {
        g.strokeStyle = c.accent;
        g.globalAlpha = 0.5;
        g.lineWidth = arena.lw * 0.6;
        g.setLineDash([3, 5]);
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(s.pointer.x, s.pointer.y);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
        g.beginPath();
        g.arc(s.pointer.x, s.pointer.y, 10, 0, Math.PI * 2);
        g.stroke();
      }
      for (const r of s.rocks) drawRock(g, r);
      // Shots: a glowing streak along their flight.
      const tone = arena.tone(c.accent);
      g.lineCap = 'round';
      for (const b of s.bullets) {
        g.strokeStyle = tone.glow;
        g.lineWidth = BULLET_R * 3;
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - b.vx * 0.025, b.y - b.vy * 0.025);
        g.stroke();
        g.strokeStyle = arena.dark ? tone.hi : tone.edge;
        g.lineWidth = BULLET_R * 1.6;
        g.stroke();
      }
      g.lineCap = 'butt';
      if (!ended || s.rocks.length === 0) drawShip(g);
      arena.overlay(g);
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
        const before = new Set(s.rocks);
        const ev = step(s, dt);
        arena.update(dt);
        spawn += dt;
        const c = arena.colors;
        if (s.cool > cool) {
          sfx('shoot', { vol: 0.5 });
          fx.burst(
            s.x + Math.sin(s.a) * SHIP_R * 1.6,
            s.y - Math.cos(s.a) * SHIP_R * 1.6,
            arena.tone(c.accent).hi,
            2,
            60,
            2,
            0.15,
            'spark',
            0,
            s.a - Math.PI / 2,
            0.6,
          );
        }
        if (s.burning && s.alive) {
          const bx = s.x - Math.sin(s.a) * SHIP_R * 0.8;
          const by = s.y + Math.cos(s.a) * SHIP_R * 0.8;
          fx.burst(bx, by, Math.random() < 0.5 ? c.p[0] : c.p[3], 1, 70, 2.2, 0.25, 'dot', 0, s.a + Math.PI / 2, 0.5);
        }
        // New fragments flash white for a moment as they split off.
        for (const r of s.rocks) if (!before.has(r)) struck.set(r, arena.time);
        for (const b of ev.blasts) {
          if (b.ship) {
            sfx('boom');
            haptic(30);
            fx.burst(b.x, b.y, c.accent, 18, 160, 3.5, 0.8, 'square', 0);
            fx.burst(b.x, b.y, c.p[0], 12, 120, 3, 0.55, 'dot', 0);
            fx.ring(b.x, b.y, c.bad, 6, 50, 0.5, arena.lw * 1.5);
            fx.shake(6, 0.4);
            fx.flash(c.bad, 0.3, 0.35);
            continue;
          }
          const size = b.r >= ROCK_R[3] ? 3 : b.r >= ROCK_R[2] ? 2 : 1;
          sfx('pop', { pitch: size === 3 ? -8 : size === 2 ? -3 : 3 });
          const t = arena.tone(stone());
          fx.burst(b.x, b.y, t.base, 6 + size * 4, 70 + size * 20, 2 + size, 0.6, 'square', 0);
          fx.burst(b.x, b.y, t.hi, 4 + size * 2, 100, 2, 0.4, 'dot', 0);
          fx.ring(b.x, b.y, c.accent, b.r * 0.4, b.r * 1.5, 0.3, arena.lw);
          fx.text(b.x, b.y - b.r * 0.6, `+${POINTS[size]}`, size === 1 ? c.accent : c.fg, size === 1 ? 13 : 11, 0.7);
          if (size === 3) fx.shake(2, 0.15);
        }
        if (ev.died) ctx.lives(s.lives, LIVES);
        if (ev.respawned) {
          spawn = 0;
          fx.ring(s.x, s.y, c.accent, 2, 30, 0.4, arena.lw);
        }
        if (ev.hit || ev.cleared) {
          ctx.score(s.score);
          status();
        }
        if (ev.cleared) {
          ended = true;
          for (let i = 0; i < 5; i++) fx.burst(s.x, s.y, c.p[i], 10, 200, 4, 0.9, 'square', 120);
          fx.ring(s.x, s.y, c.good, 8, 90, 0.6, arena.lw * 1.5);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger(1.4);
        } else if (ev.over) {
          ended = true;
          arena.linger(1.4);
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
