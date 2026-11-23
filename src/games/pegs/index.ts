import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { outCubic } from '../../kits/arena/ease';
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
    const fx = arena.fx;
    const n = s.pegs.length;
    /** Arena time each peg lit up (-1: not lit), and which pegs have already popped. */
    const litAt = new Float32Array(n).fill(-1);
    const popped = new Uint8Array(n);
    const TRAIL = 9;
    const trail = new Float32Array(TRAIL * 2);
    let trailN = 0;
    let trailAt = 0;
    let shotStart = 0;
    let lastMult = 1;
    let ended = false;

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
      arena.field(g, 0, 0, W, H, 20, 0, false);
      // Aim guide: a dotted arc, fading out, while waiting to shoot.
      if (!s.flying && !ended) {
        g.fillStyle = c.fg;
        const path = aimPath(s);
        for (let i = 0; i < path.length; i += 2) {
          g.globalAlpha = 0.65 * (1 - i / path.length);
          g.beginPath();
          g.arc(path[i].x, path[i].y, 2 - i / path.length, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      for (let i = 0; i < n; i++) {
        const p = s.pegs[i];
        if (p.gone) continue;
        // Targets are orange rounded squares, plain pegs blue balls; lit pegs glow and turn light.
        const base = p.target ? c.p[0] : c.p[1];
        let r = PEG_R;
        let fill = base;
        if (p.lit) {
          const age = arena.time - litAt[i];
          r = PEG_R * (1 + 0.45 * (1 - outCubic(age / 0.25)));
          fill = arena.tone(base).hi;
          g.fillStyle = arena.tone(base).glow;
          g.beginPath();
          g.arc(p.x, p.y, PEG_R * (1.9 + 0.15 * Math.sin(arena.time * 10 + i)), 0, Math.PI * 2);
          g.fill();
        }
        if (p.target) arena.block(g, p.x - r - 1, p.y - r - 1, r * 2 + 2, r * 2 + 2, fill, 3, !p.lit, 0.8);
        else arena.ball(g, p.x, p.y, r, fill, !p.lit);
      }
      // Bucket: a tub with a dark opening and a rim.
      const bl = s.bucketX - s.bucketW / 2;
      arena.block(g, bl, BUCKET_Y, s.bucketW, BUCKET_H, c.accent, 4);
      g.fillStyle = arena.tone(c.accent).lo;
      g.beginPath();
      g.roundRect(bl + 4, BUCKET_Y + 2.5, s.bucketW - 8, 3.5, 2);
      g.fill();
      // Launcher: a barrel along the aim on a round base.
      const bx = LAUNCH.x + Math.sin(s.aim) * 18;
      const by = LAUNCH.y + Math.cos(s.aim) * 18;
      g.lineCap = 'round';
      g.strokeStyle = arena.tone(c.accent).edge;
      g.lineWidth = 11;
      g.beginPath();
      g.moveTo(LAUNCH.x, LAUNCH.y);
      g.lineTo(bx, by);
      g.stroke();
      g.strokeStyle = c.accent;
      g.lineWidth = 11 - 2 * arena.lw * 0.8;
      g.stroke();
      g.strokeStyle = arena.tone(c.accent).hi;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(LAUNCH.x - Math.cos(s.aim) * 2, LAUNCH.y + Math.sin(s.aim) * 2);
      g.lineTo(bx - Math.cos(s.aim) * 2, by + Math.sin(s.aim) * 2);
      g.stroke();
      g.lineCap = 'butt';
      arena.ball(g, LAUNCH.x, LAUNCH.y, 12, c.accent);
      // Ball, with a trail while it flies.
      const ballFill = arena.dark ? c.fg : c.cell;
      if (s.flying) {
        g.fillStyle = arena.tone(c.accent).glow;
        for (let i = 0; i < trailN; i++) {
          const k = (trailAt - 1 - i + TRAIL) % TRAIL;
          const f = 1 - i / TRAIL;
          g.globalAlpha = f;
          g.beginPath();
          g.arc(trail[k * 2], trail[k * 2 + 1], BALL_R * (0.3 + 0.6 * f), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      if (!ended) arena.ball(g, s.flying ? s.bx : bx, s.flying ? s.by : by, BALL_R, ballFill);
      arena.overlay(g);
    }

    /** Effects for what changed this frame: newly lit pegs, popped pegs, a rising multiplier. */
    function react(gain: number) {
      const c = arena.colors;
      for (let i = 0; i < n; i++) {
        const p = s.pegs[i];
        const base = p.target ? c.p[0] : c.p[1];
        if (p.lit && litAt[i] < 0) {
          litAt[i] = arena.time;
          fx.ring(p.x, p.y, base, PEG_R, PEG_R * 3, 0.3, arena.lw);
          fx.burst(p.x, p.y, arena.tone(base).hi, p.target ? 6 : 3, 80, 2.2, 0.35, 'spark', 0);
          if (p.target) fx.text(p.x, p.y - 10, `+${gain}`, c.p[0], 12);
        }
        if (p.gone && !popped[i]) {
          popped[i] = 1;
          fx.burst(p.x, p.y, base, p.target ? 10 : 6, 100, 3, 0.5);
        }
      }
      if (multiplier(s) > lastMult) {
        lastMult = multiplier(s);
        fx.text(s.bx, s.by - 14, `×${lastMult}`, c.accent, 15);
      }
    }

    const aim = (p: { x: number; y: number }) => aimAt(s, p.x, p.y);
    const fire = () => {
      if (!shoot(s)) return;
      status();
      shotStart = s.score;
      lastMult = 1;
      trailN = 0;
      const c = arena.colors;
      fx.burst(
        LAUNCH.x + Math.sin(s.aim) * 20,
        LAUNCH.y + Math.cos(s.aim) * 20,
        c.muted,
        6,
        90,
        2.5,
        0.3,
        'dot',
        0,
        Math.PI / 2 - s.aim,
        0.9,
      );
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
        const score = s.score;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        if (s.flying) {
          trail[trailAt * 2] = s.bx;
          trail[trailAt * 2 + 1] = s.by;
          trailAt = (trailAt + 1) % TRAIL;
          trailN = Math.min(TRAIL, trailN + 1);
        }
        if (ev.hit) {
          ctx.score(s.score);
          status();
        }
        react(s.score - score);
        if (ev.ended) {
          ctx.score(s.score);
          ctx.lives(s.balls, max);
          status();
          const shot = s.score - shotStart;
          if (shot > 0) fx.text(W / 2, H * 0.45, `+${shot}`, lastMult > 1 ? c.accent : c.fg, 14 + Math.min(8, lastMult * 2), 1.1);
          if (ev.caught) {
            fx.burst(s.bucketX, BUCKET_Y, c.accent, 12, 120, 3, 0.55, 'square', 260, -Math.PI / 2, Math.PI * 0.8);
            fx.text(s.bucketX, BUCKET_Y - 16, L('+1 ball', '+1 balle'), c.good, 12);
          } else fx.burst(Math.max(8, Math.min(W - 8, s.bx)), H - 2, c.muted, 6, 80, 2.5, 0.35, 'dot', 200, -Math.PI / 2, 1);
        }
        if (ev.cleared) {
          ended = true;
          for (let i = 0; i < 4; i++) fx.burst(W / 2, H * 0.4, c.p[i], 12, 200, 4, 0.9, 'square', 200);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          fx.shake(4, 0.35);
          fx.flash(c.bad, 0.22, 0.4);
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
