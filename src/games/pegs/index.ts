import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures } from '../../kits/gesture/gesture';
import {
  aimAt,
  aimPath,
  BALL_BONUS,
  BALL_R,
  ballsFor,
  BUCKET_H,
  BUCKET_Y,
  createLevel,
  H,
  LAUNCH,
  multiplier,
  PEG_R,
  shoot,
  step,
  targetsFor,
  targetsLeft,
  W,
} from './rules';

export const pegs: GameDef = {
  id: 'pegs',
  get name() {
    return L('Pegs', 'Chevilles');
  },
  get rules() {
    return L('Shoot the ball to clear every orange peg.', 'Lancez la balle pour retirer les chevilles orange.');
  },
  category: 'aim',
  help: () => ({
    goal: L('Clear every orange peg before you run out of balls.', 'Retirez toutes les chevilles orange avant de manquer de balles.'),
    steps: [
      L(
        'Aim from the top and shoot: the ball bounces off the pegs as it falls.',
        'Visez du haut et tirez : la balle rebondit sur les chevilles en tombant.',
      ),
      L(
        'Every peg the ball hits lights up and vanishes once the ball leaves play.',
        'Chaque cheville touchée s’allume et disparaît quand la balle sort du jeu.',
      ),
      L(
        'Orange pegs are the square ones. A ball that lands in the moving bucket comes back.',
        'Les chevilles orange sont carrées. Une balle qui tombe dans le panier mobile vous est rendue.',
      ),
      L(
        'Touch and drag to aim along the guide, release to shoot (with a mouse: point, click).',
        'Touchez et glissez pour viser selon le guide, relâchez pour tirer (à la souris : pointez, cliquez).',
      ),
      L('Keyboard: ← → or A D to aim, Space to shoot, P to pause.', 'Clavier : ← → ou A D pour viser, Espace pour tirer, P pour la pause.'),
    ],
    tips: [
      L(
        'Every 4 pegs hit in one shot raise its multiplier: long rallies pay.',
        'Toutes les 4 chevilles touchées d’un même tir, le multiplicateur monte : les longs rebonds paient.',
      ),
      L(`Each ball left at the end is worth ${BALL_BONUS} points.`, `Chaque balle restante à la fin vaut ${BALL_BONUS} points.`),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [2300, 3200],
      [2500, 3500],
      [2800, 3900],
      [3100, 4300],
      [3400, 4800],
    ] as const),
  par: (d) => 30 + targetsFor(d) * 5,
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const max = ballsFor(ctx.difficulty);
    const arena = new Arena(ctx.root, W, H, () => draw());

    const status = () =>
      ctx.status(
        [
          P(targetsLeft(s), ['orange peg left', 'orange pegs left'], ['cheville orange restante', 'chevilles orange restantes']),
          s.flying && multiplier(s) > 1 ? `×${multiplier(s)}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Aim guide: a short dotted arc while waiting to shoot.
      if (!s.flying) {
        g.fillStyle = c.muted;
        for (const [i, p] of aimPath(s).entries())
          if (i % 2 === 0) {
            g.beginPath();
            g.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
            g.fill();
          }
      }
      for (const p of s.pegs) {
        if (p.gone) continue;
        // Targets are orange rounded squares, plain pegs blue discs; lit pegs turn the text colour.
        const fill = p.lit ? c.fg : p.target ? c.p[0] : c.p[1];
        if (p.target) arena.box(g, p.x - PEG_R - 1, p.y - PEG_R - 1, PEG_R * 2 + 2, PEG_R * 2 + 2, fill, 3, !p.lit);
        else arena.disc(g, p.x, p.y, PEG_R, fill);
      }
      // Bucket.
      arena.box(g, s.bucketX - s.bucketW / 2, BUCKET_Y, s.bucketW, BUCKET_H, c.accent, 4);
      // Launcher: a barrel along the aim on a round base.
      const bx = LAUNCH.x + Math.sin(s.aim) * 18;
      const by = LAUNCH.y + Math.cos(s.aim) * 18;
      g.lineCap = 'round';
      g.strokeStyle = c.ink;
      g.lineWidth = 11;
      g.beginPath();
      g.moveTo(LAUNCH.x, LAUNCH.y);
      g.lineTo(bx, by);
      g.stroke();
      g.strokeStyle = c.accent;
      g.lineWidth = 11 - 2 * arena.lw * 0.8;
      g.stroke();
      g.lineCap = 'butt';
      arena.disc(g, LAUNCH.x, LAUNCH.y, 12, c.accent);
      arena.disc(g, s.flying ? s.bx : bx, s.flying ? s.by : by, BALL_R, c.cell);
    }

    const aim = (p: { x: number; y: number }) => aimAt(s, p.x, p.y);
    const fire = () => {
      if (shoot(s)) status();
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onDown: aim,
      onMove: aim,
      onTap: (p) => {
        aim(p);
        fire();
      },
      onRelease: (p) => {
        aim(p);
        fire();
      },
    });

    ctx.score(0);
    ctx.lives(s.balls, max);
    status();
    return {
      draw,
      frame(dt) {
        const ev = step(s, dt);
        if (ev.hit) {
          ctx.score(s.score);
          status();
        }
        if (ev.ended) {
          ctx.score(s.score);
          ctx.lives(s.balls, max);
          status();
        }
        draw();
        if (ev.cleared) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = k === 'arrowleft' || k === 'a' ? -1 : k === 'arrowright' || k === 'd' ? 1 : 0;
        if (dir) {
          if (e.type === 'keydown') s.turn = dir;
          else if (s.turn === dir) s.turn = 0;
          return true;
        }
        if (k === ' ' || k === 'enter' || k === 'arrowdown' || k === 's') {
          if (e.type === 'keydown') fire();
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
