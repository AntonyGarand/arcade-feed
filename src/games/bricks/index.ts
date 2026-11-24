import './style.css';
import { L, P } from '../../core/i18n';
import { btn, leftRight } from '../../core/pad';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { sfx } from '../../kits/sound/sound';
import { BALL_R, brickCount, createLevel, H, launch, LIFE_BONUS, LIVES, PADDLE_H, PADDLE_Y, step, W } from './rules';

export const bricks: GameDef = {
  id: 'bricks',
  get name() {
    return L('Bricks', 'Briques');
  },
  get rules() {
    return L('Bounce the ball to break every brick.', 'Faites rebondir la balle pour casser toutes les briques.');
  },
  category: 'aim',
  help: () => ({
    goal: L(
      'Break every brick with the ball before you run out of lives.',
      'Cassez toutes les briques avec la balle avant de manquer de vies.',
    ),
    steps: [
      L('Drag anywhere on the field to move the paddle.', 'Glissez n’importe où sur le terrain pour déplacer la raquette.'),
      L('The ball launches by itself; tap to launch it sooner.', 'La balle part toute seule; touchez pour la lancer plus tôt.'),
      L(
        'Where the ball lands on the paddle sets its angle: the edges send it sideways.',
        'L’endroit où la balle touche la raquette donne son angle : les bords l’envoient de côté.',
      ),
      L('Outlined bricks take two hits.', 'Les briques à double contour demandent deux coups.'),
      L(
        'Keyboard: ← → or A D to move, Space to launch, P to pause.',
        'Clavier : ← → ou A D pour bouger, Espace pour lancer, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Each brick hit before the ball comes back scores more: 10, 20, 30…',
        'Chaque brique touchée avant le retour de la balle rapporte plus : 10, 20, 30…',
      ),
      L(`Lives left at the end are worth ${LIFE_BONUS} points each.`, `Chaque vie restante à la fin vaut ${LIFE_BONUS} points.`),
    ],
  }),
  stars: (d) => {
    const n = brickCount(d);
    return [n * 16 + LIFE_BONUS, n * 24 + 2 * LIFE_BONUS];
  },
  par: (d) => 40 + brickCount(d) * 2,
  pad: () => ({ left: leftRight(), right: [btn(' ', 'launch', L('Launch', 'Lancer'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    type Brick = (typeof s.bricks)[number];
    /** Bricks that started tough: they show a plate, then cracks once hit. */
    const tough = new WeakSet<Brick>(s.bricks.filter((b) => b.hp > 1));
    /** When each brick was last hit (arena time), for its flash. */
    const struck = new WeakMap<Brick, number>();
    let before: Brick[] = s.bricks.slice();
    let beforeHp: number[] = s.bricks.map((b) => b.hp);
    // Ball trail: the last positions, as a ring buffer.
    const TRAIL = 10;
    const trail = new Float32Array(TRAIL * 2);
    let trailN = 0;
    let trailAt = 0;
    /** Paddle squash after a bounce, 1 → 0. */
    let squash = 0;
    let ended = false;

    const status = () =>
      ctx.status(
        [
          P(s.bricks.length, ['brick left', 'bricks left'], ['brique restante', 'briques restantes']),
          s.combo > 1 ? `combo ×${s.combo}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);
      for (const b of s.bricks) {
        const fill = c.p[b.c];
        arena.block(g, b.x, b.y, b.w, b.h, fill, 3);
        if (tough.has(b)) {
          // A riveted plate; cracked once it has taken a hit.
          const t = arena.tone(fill);
          g.strokeStyle = t.edge;
          g.lineWidth = arena.lw * 0.5;
          g.beginPath();
          g.roundRect(b.x + 4, b.y + 3.5, b.w - 8, b.h - 8, arena.r(2));
          g.stroke();
          g.fillStyle = t.edge;
          for (const rx of [b.x + 7, b.x + b.w - 7]) {
            g.beginPath();
            g.arc(rx, b.y + b.h / 2 - 1.5, 1.2, 0, Math.PI * 2);
            g.fill();
          }
          if (b.hp < 2) {
            const mx = b.x + b.w * 0.55;
            g.lineWidth = arena.lw * 0.6;
            g.beginPath();
            g.moveTo(mx - 3, b.y + 1);
            g.lineTo(mx + 1, b.y + b.h * 0.4);
            g.lineTo(mx - 2, b.y + b.h * 0.6);
            g.lineTo(mx + 2, b.y + b.h - 2);
            g.moveTo(mx + 1, b.y + b.h * 0.4);
            g.lineTo(mx + 7, b.y + b.h * 0.3);
            g.stroke();
          }
        }
        const hit = struck.get(b);
        if (hit != null && arena.time - hit < 0.15) {
          g.globalAlpha = 0.75 * (1 - (arena.time - hit) / 0.15);
          g.fillStyle = c.paper;
          g.beginPath();
          g.roundRect(b.x, b.y, b.w, b.h, arena.r(3));
          g.fill();
          g.globalAlpha = 1;
        }
      }

      // Paddle: squashes a little on every bounce.
      const sq = squash * squash;
      const ph = PADDLE_H * (1 - 0.28 * sq);
      const pw = s.pw + 8 * sq;
      arena.block(g, s.px - pw / 2, PADDLE_Y + (PADDLE_H - ph), pw, ph, c.accent, PADDLE_H / 2);

      // Ball and its fading trail.
      const ballFill = arena.dark ? c.fg : c.cell;
      if (!s.held && !ended) {
        const tone = arena.tone(c.accent);
        g.fillStyle = tone.glow;
        for (let i = 0; i < trailN; i++) {
          const k = (trailAt - 1 - i + TRAIL) % TRAIL;
          const f = 1 - i / TRAIL;
          g.globalAlpha = f * 0.8;
          g.beginPath();
          g.arc(trail[k * 2], trail[k * 2 + 1], BALL_R * (0.35 + 0.6 * f), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      if (!ended || s.bricks.length === 0) arena.ball(g, s.bx, s.by, BALL_R, ballFill);
      arena.overlay(g);
    }

    function onHits(gain: number) {
      const c = arena.colors;
      let broke = false;
      for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        if (!s.bricks.includes(b)) {
          broke = true;
          const fill = c.p[b.c];
          fx.burst(cx, cy, fill, 14, 130, 4, 0.6);
          fx.burst(cx, cy, arena.tone(fill).hi, 6, 90, 2.5, 0.45, 'dot');
          fx.ring(cx, cy, fill, 4, b.w * 0.7, 0.3, arena.lw);
        } else if (b.hp < beforeHp[i]) {
          struck.set(b, arena.time);
          fx.burst(s.bx, s.by, c.muted, 5, 80, 2, 0.35, 'spark', 0);
        }
      }
      if (broke) sfx('pop', { pitch: Math.min(12, s.combo * 2) });
      else sfx('hit', { pitch: 4 });
      if (gain > 0) fx.text(s.bx, s.by - 8, `+${gain}`, s.combo >= 3 ? c.accent : c.fg, s.combo >= 3 ? 14 : 11);
      if (s.combo >= 4 && s.combo % 2 === 0) fx.shake(1.5, 0.15);
      before = s.bricks.slice();
      beforeHp = s.bricks.map((b) => b.hp);
    }

    // Drag (or hover with a mouse) to steer; a tap also launches a resting ball.
    const steer = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.type === 'pointermove' && !arena.canvas.matches(':hover')) return;
      s.target = arena.toWorld(e).x;
    };
    arena.canvas.addEventListener('pointerdown', (e) => {
      arena.canvas.setPointerCapture(e.pointerId);
      steer(e);
      launch(s);
    });
    arena.canvas.addEventListener('pointermove', steer);

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const combo = s.combo;
        const score = s.score;
        const vy = s.vy;
        const held = s.held;
        const ev = step(s, dt);
        arena.update(dt);
        squash = Math.max(0, squash - dt * 5);
        const c = arena.colors;
        if (held && !s.held) fx.burst(s.bx, s.by + BALL_R, c.muted, 6, 60, 2, 0.3, 'dot', 0, -Math.PI / 2, Math.PI);
        // Paddle bounce: the ball turned upwards at paddle height.
        if (vy > 0 && s.vy < 0 && !s.held && s.by >= PADDLE_Y - BALL_R - 2) {
          squash = 1;
          sfx('hit', { vol: 0.8 });
          fx.burst(s.bx, PADDLE_Y, arena.tone(c.accent).hi, 6, 70, 2.5, 0.3, 'spark', 0, -Math.PI / 2, Math.PI * 0.8);
        }
        if (ev.hit) {
          ctx.score(s.score);
          onHits(s.score - score);
        }
        if (ev.lostLife) {
          ctx.lives(s.lives, LIVES);
          fx.shake(5, 0.35);
          fx.flash(c.bad, 0.3, 0.35);
          fx.burst(Math.min(W - 10, Math.max(10, s.bx)), H - 4, c.bad, 12, 140, 3.5, 0.5, 'square', 300, -Math.PI / 2, Math.PI * 0.7);
          trailN = 0;
        }
        if (ev.hit || ev.lostLife || combo !== s.combo) status();
        if (!s.held && !ev.lostLife) {
          trail[trailAt * 2] = s.bx;
          trail[trailAt * 2 + 1] = s.by;
          trailAt = (trailAt + 1) % TRAIL;
          trailN = Math.min(TRAIL, trailN + 1);
        } else trailN = 0;
        if (ev.cleared) {
          ended = true;
          for (let i = 0; i < 5; i++) fx.burst(s.bx, s.by, c.p[i], 10, 190, 4, 0.9, 'square', 220);
          fx.ring(s.bx, s.by, c.accent, 6, 90, 0.6, arena.lw * 1.5);
          fx.flash(c.good, 0.25, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          arena.linger();
        }
        draw();
        if (ev.cleared) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = k === 'arrowleft' || k === 'a' ? -1 : k === 'arrowright' || k === 'd' ? 1 : 0;
        if (dir) {
          s.target = null;
          if (e.type === 'keydown') s.dir = dir;
          else if (s.dir === dir) s.dir = 0;
          return true;
        }
        if (k === ' ' && e.type === 'keydown') {
          launch(s);
          return true;
        }
        return false;
      },
      destroy: () => arena.destroy(),
    };
  },
};
