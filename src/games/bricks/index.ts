import './style.css';
import { L, P } from '../../core/i18n';
import { btn, leftRight } from '../../core/pad';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  BALL_R,
  brickCount,
  createLevel,
  H,
  launch,
  left,
  LIFE_BONUS,
  LIVES,
  PADDLE_H,
  PADDLE_Y,
  step,
  STREAK_WINDOW,
  W,
  type KindId,
  type Power,
} from './rules';

/** What each kind of wall is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  wall: () => [L('Classic wall', 'Mur classique'), L('Rows of bricks, top to bottom.', 'Des rangées de briques, de haut en bas.')],
  pyramid: () => [
    L('Pyramid', 'Pyramide'),
    L('A brick pyramid: chip away at its sides.', 'Une pyramide de briques : grugez-en les côtés.'),
  ],
  diamond: () => [
    L('Diamond', 'Diamant'),
    L('Get above the diamond and let it rattle.', 'Passez au-dessus du diamant et laissez rebondir.'),
  ],
  pillars: () => [L('Pillars', 'Piliers'), L('Tall columns with shafts between them.', 'De hautes colonnes séparées par des puits.')],
  slide: () => [L('Sliding rows', 'Rangées mobiles'), L('The rows glide from side to side.', 'Les rangées glissent d’un côté à l’autre.')],
  fortress: () => [
    L('Fortress', 'Forteresse'),
    L('Steel guards the wall: find the gaps.', 'De l’acier protège le mur : trouvez les brèches.'),
  ],
  minefield: () => [
    L('Minefield', 'Champ de mines'),
    L('Bombs everywhere: set off chain blasts.', 'Des bombes partout : déclenchez des réactions en chaîne.'),
  ],
};

const POWER_NAMES: Record<Power, () => string> = {
  wide: () => L('Wide paddle!', 'Raquette large!'),
  multi: () => L('Multiball!', 'Multibille!'),
  fire: () => L('Fireball!', 'Boule de feu!'),
};

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
      L(
        'Riveted bricks take two hits, grey steel never breaks, bombs blow up their neighbours, gifts drop a power-up.',
        'Les briques rivetées demandent deux coups, l’acier gris est incassable, les bombes font sauter leurs voisines, les cadeaux lâchent un bonus.',
      ),
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
      L(
        'Break bricks in a quick streak to earn a wide paddle, then multiball, then a fireball.',
        'Cassez des briques en série rapide pour gagner une raquette large, puis la multibille, puis une boule de feu.',
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
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    type Brick = (typeof s.bricks)[number];
    /** Bricks that started tough: they show a plate, then cracks once hit. */
    const tough = new WeakSet<Brick>(s.bricks.filter((b) => b.hp > 1 && b.trait !== 'steel'));
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
    /** Broken bricks tumbling away: where they were, their colour and age (seconds). */
    let debris: { x: number; y: number; w: number; h: number; c: number; vx: number; t: number }[] = [];

    const status = () =>
      ctx.status(
        [
          P(left(s), ['brick left', 'bricks left'], ['brique restante', 'briques restantes']),
          s.streak > 1 ? L(`streak ${s.streak}`, `série ${s.streak}`) : '',
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
        const fill = b.trait === 'steel' ? c.muted : b.trait === 'bomb' ? c.coal : c.p[b.c];
        arena.block(g, b.x, b.y, b.w, b.h, fill, 3);
        if (b.trait !== 'plain') drawTrait(g, b);
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

      // Power-up capsules falling towards the paddle.
      for (const cap of s.capsules) {
        const col = cap.power === 'wide' ? c.good : cap.power === 'multi' ? c.p[4] : c.bad;
        arena.block(g, cap.x - 13, cap.y - 6, 26, 12, col, 6);
        g.fillStyle = arena.tone(col).edge;
        g.font = `800 9px ${arena.family}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(cap.power === 'wide' ? '↔' : cap.power === 'multi' ? '×3' : '✦', cap.x, cap.y + 0.5);
        g.textBaseline = 'alphabetic';
      }

      // Broken bricks drop, tip over and fade.
      for (const d of debris) {
        const k = d.t / 0.45;
        g.save();
        g.globalAlpha = 1 - k;
        g.translate(d.x + d.w / 2 + d.vx * d.t, d.y + d.h / 2 + 260 * d.t * d.t);
        g.rotate(d.vx * d.t * 0.04);
        g.scale(1 - 0.4 * k, 1 - 0.4 * k);
        arena.block(g, -d.w / 2, -d.h / 2, d.w, d.h, c.p[d.c], 3, false);
        g.restore();
      }
      g.globalAlpha = 1;

      // The last few bricks glow, so they're easy to find.
      if (left(s) <= 3 && !ended) {
        const pulse = 0.5 + 0.5 * Math.sin(arena.time * 6);
        for (const b of s.bricks) {
          if (b.trait === 'steel') continue;
          g.strokeStyle = arena.tone(c.p[b.c]).glow;
          g.lineWidth = 3 + pulse * 3;
          g.beginPath();
          g.roundRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4, arena.r(4));
          g.stroke();
        }
      }

      // Streak meter along the top: drains until the streak runs out.
      if (s.streak > 1 && !ended) {
        const k = Math.max(0, s.streakLeft / STREAK_WINDOW);
        g.fillStyle = s.fire > 0 ? c.bad : c.accent;
        g.globalAlpha = 0.85;
        g.fillRect(0, 0, W * k, 4);
        g.globalAlpha = 1;
      }

      const ball0 = s.balls[0];
      // Launch guide while the ball rests on the paddle.
      if (s.held && !ended) {
        g.fillStyle = c.fg;
        for (let i = 1; i <= 6; i++) {
          const d = 6 + i * 13 + ((arena.time * 40) % 13);
          g.globalAlpha = 0.7 * (1 - i / 7);
          g.beginPath();
          g.arc(ball0.x + Math.sin(s.aim) * d, ball0.y - Math.cos(s.aim) * d, 1.8, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }

      // Paddle: squashes a little on every bounce.
      const sq = squash * squash;
      const ph = PADDLE_H * (1 - 0.28 * sq);
      const pw = s.pw + 8 * sq;
      arena.block(g, s.px - pw / 2, PADDLE_Y + (PADDLE_H - ph), pw, ph, c.accent, PADDLE_H / 2);

      // Ball and its fading trail.
      const ballFill = s.fire > 0 ? c.bad : arena.dark ? c.fg : c.cell;
      if (!s.held && !ended) {
        const tone = arena.tone(s.fire > 0 ? c.bad : c.accent);
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
      if (!ended || !left(s)) for (const b of s.balls) arena.ball(g, b.x, b.y, BALL_R, ballFill);
      arena.overlay(g);
    }

    /** Marks on special bricks: a fuse for bombs, a bow for gifts, rivets for steel. */
    function drawTrait(g: CanvasRenderingContext2D, b: Brick) {
      const c = arena.colors;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2 - 1;
      g.lineWidth = arena.lw * 0.6;
      if (b.trait === 'bomb') {
        g.fillStyle = c.bad;
        g.beginPath();
        g.arc(cx, cy + 1, 4.5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = c.accent;
        g.beginPath();
        g.moveTo(cx + 3, cy - 2);
        g.quadraticCurveTo(cx + 6, cy - 6, cx + 8, cy - 4);
        g.stroke();
        if (Math.sin(arena.time * 14 + b.x) > 0) {
          g.fillStyle = c.accent;
          g.fillRect(cx + 7, cy - 6, 2.5, 2.5);
        }
      } else if (b.trait === 'gift') {
        g.fillStyle = c.paper;
        g.fillRect(cx - 1.5, b.y + 2, 3, b.h - 6);
        g.fillRect(b.x + 3, cy - 1.5, b.w - 6, 3);
      } else {
        g.fillStyle = arena.tone(c.muted).edge;
        for (const [rx, ry] of [
          [b.x + 4, b.y + 4],
          [b.x + b.w - 4, b.y + 4],
          [b.x + 4, b.y + b.h - 6],
          [b.x + b.w - 4, b.y + b.h - 6],
        ])
          g.fillRect(rx - 1, ry - 1, 2, 2);
      }
    }

    function onHits(gain: number) {
      const c = arena.colors;
      let broke = 0;
      let at = { x: s.balls[0].x, y: s.balls[0].y };
      for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        if (!s.bricks.includes(b)) {
          broke++;
          at = { x: cx, y: cy };
          debris.push({ x: b.x, y: b.y, w: b.w, h: b.h, c: b.c, vx: (cx - s.balls[0].x) * 3 || 20, t: 0 });
          const fill = c.p[b.c];
          fx.burst(cx, cy, fill, 14, 130, 4, 0.6);
          fx.burst(cx, cy, arena.tone(fill).hi, 6, 90, 2.5, 0.45, 'dot');
          fx.ring(cx, cy, fill, 4, b.w * 0.7, 0.3, arena.lw);
        } else if (b.hp < beforeHp[i]) {
          struck.set(b, arena.time);
          fx.burst(cx, cy + b.h / 2, c.muted, 5, 80, 2, 0.35, 'spark', 0);
        }
      }
      if (broke) sfx('pop', { pitch: Math.min(12, s.combo * 2) });
      else sfx('hit', { pitch: 4 });
      const tx = Math.min(W - 16, Math.max(16, at.x));
      if (gain > 0) fx.text(tx, at.y - 8, `+${gain}`, s.combo >= 3 ? c.accent : c.fg, s.combo >= 3 ? 15 + Math.min(4, s.combo - 3) : 12);
      if (broke && s.streak >= 3) comboPop(fx, tx, at.y - 22, s.streak, c.accent);
      if (s.combo >= 4 && s.combo % 2 === 0) fx.shake(1.5, 0.15);
      before = s.bricks.slice();
      beforeHp = s.bricks.map((b) => b.hp);
    }

    function powerUp(p: Power) {
      const c = arena.colors;
      if (p === 'multi') for (const b of s.balls) fx.ring(b.x, b.y, c.p[4], 4, 30, 0.4, arena.lw);
      if (p === 'wide') fx.ring(s.px, PADDLE_Y, c.good, 8, s.pw, 0.4, arena.lw);
      if (p === 'fire') fx.burst(s.balls[0].x, s.balls[0].y, c.bad, 16, 140, 3.5, 0.6, 'spark', 0);
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
        const streak = s.streak;
        const score = s.score;
        const b0 = s.balls[0];
        const vy = b0.vy;
        const held = s.held;
        const bx = b0.x;
        const ev = step(s, dt);
        const ball = s.balls[0];
        arena.update(dt);
        squash = Math.max(0, squash - dt * 5);
        for (const d of debris) d.t += dt;
        debris = debris.filter((d) => d.t < 0.45);
        const c = arena.colors;
        if (held && !s.held) fx.burst(ball.x, ball.y + BALL_R, c.muted, 6, 60, 2, 0.3, 'dot', 0, -Math.PI / 2, Math.PI);
        // Paddle bounce: the ball turned upwards at paddle height.
        if (b0 === ball && vy > 0 && ball.vy < 0 && !s.held && ball.y >= PADDLE_Y - BALL_R - 2) {
          squash = 1;
          sfx('hit', { vol: 0.8 });
          fx.burst(ball.x, PADDLE_Y, arena.tone(c.accent).hi, 6, 70, 2.5, 0.3, 'spark', 0, -Math.PI / 2, Math.PI * 0.8);
        }
        if (ev.hit) {
          ctx.score(s.score);
          onHits(s.score - score);
        }
        for (const b of ev.blasts) {
          fx.ring(b.x, b.y, c.bad, 6, 50, 0.4, arena.lw * 1.5);
          fx.burst(b.x, b.y, c.accent, 18, 170, 3.5, 0.6, 'spark', 0);
          fx.shake(4, 0.25);
        }
        if (ev.blasts.length) {
          sfx('boom');
          haptic(40);
        }
        if (ev.tier && ev.unlocked) {
          comboTier(fx, ev.tier, c.accent, POWER_NAMES[ev.unlocked]());
          powerUp(ev.unlocked);
        }
        if (ev.caught) {
          sfx('power');
          fx.text(s.px, PADDLE_Y - 18, POWER_NAMES[ev.caught](), c.good, 14);
          powerUp(ev.caught);
        }
        if (ev.lostBall) sfx('error');
        if (ev.lostLife) {
          ctx.lives(s.lives, LIVES);
          fx.shake(5, 0.35);
          fx.flash(c.bad, 0.3, 0.35);
          fx.text(Math.min(W - 30, Math.max(30, bx)), H - 30, s.lives > 0 ? L('−1 life', '−1 vie') : L('Out!', 'Perdu!'), c.bad, 14);
          fx.burst(Math.min(W - 10, Math.max(10, bx)), H - 4, c.bad, 12, 140, 3.5, 0.5, 'square', 300, -Math.PI / 2, Math.PI * 0.7);
          trailN = 0;
        }
        if (ev.hit || ev.lostLife || combo !== s.combo || (streak && !s.streak)) status();
        if (!s.held && !ev.lostLife) {
          trail[trailAt * 2] = ball.x;
          trail[trailAt * 2 + 1] = ball.y;
          trailAt = (trailAt + 1) % TRAIL;
          trailN = Math.min(TRAIL, trailN + 1);
        } else trailN = 0;
        if (ev.cleared) {
          ended = true;
          for (let i = 0; i < 5; i++) fx.burst(ball.x, ball.y, c.p[i], 10, 190, 4, 0.9, 'square', 220);
          fx.ring(ball.x, ball.y, c.accent, 6, 90, 0.6, arena.lw * 1.5);
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
