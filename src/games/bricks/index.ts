import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
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
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());

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
      for (const b of s.bricks) {
        arena.box(g, b.x, b.y, b.w, b.h, c.p[b.c]);
        if (b.hp > 1) {
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.6;
          g.strokeRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
        }
      }
      arena.box(g, s.px - s.pw / 2, PADDLE_Y, s.pw, PADDLE_H, c.accent, PADDLE_H / 2);
      arena.disc(g, s.bx, s.by, BALL_R, c.cell);
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
        const before = s.combo;
        const ev = step(s, dt);
        if (ev.hit) ctx.score(s.score);
        if (ev.lostLife) ctx.lives(s.lives, LIVES);
        if (ev.hit || ev.lostLife || before !== s.combo) status();
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
