import './style.css';
import { L } from '../../core/i18n';
import { btn } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { alpha } from '../../kits/arena/color';
import { outBack } from '../../kits/arena/ease';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { glyphPath } from '../../kits/glyph/glyph';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  AI_Y,
  BALL_R,
  blockAt,
  createLevel,
  goalFor,
  H,
  MARGIN_BONUS,
  PADDLE_H,
  POINT,
  RALLY_POINTS,
  SERVE_S,
  SHRINK_S,
  SMASH_N,
  step,
  STREAK_TIERS,
  TARGET_POINTS,
  W,
  WIDE_S,
  YOU_Y,
  type KindId,
  type Power,
} from './rules';

/** What each kind of match is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [
    L('Classic duel', 'Duel classique'),
    L('A straight match: first to the target wins.', 'Un match simple : le premier au but gagne.'),
  ],
  wall: () => [
    L('The Wall', 'Le Mur'),
    L('A wide, slow rival: angle it past the edges.', 'Un adversaire large mais lent : visez les côtés.'),
  ],
  smasher: () => [
    L('Smasher', 'Cogneur'),
    L('Its returns fly faster, but it misreads more.', 'Ses retours filent plus vite, mais il se trompe plus.'),
  ],
  bumpers: () => [
    L('Bumpers', 'Bumpers'),
    L('Round bumpers in mid-field kick the ball off.', 'Des bumpers au milieu font dévier la balle.'),
  ],
  shrink: () => [
    L('Shrinking', 'Rétrécissement'),
    L('Paddles shrink with every hit of a rally.', 'Les raquettes rapetissent à chaque coup d’un échange.'),
  ],
  bullseye: () => [
    L('Bullseye', 'Dans le mille'),
    L('Send the ball through stars for bonus points.', 'Envoyez la balle dans les étoiles pour des points.'),
  ],
};

const POWER_NAMES: Record<Power, () => string> = {
  wide: () => L('Wide paddle!', 'Raquette large!'),
  smash: () => L(`${SMASH_N} smash shots!`, `${SMASH_N} coups smash!`),
  shrink: () => L('Rival shrinks!', 'Adversaire rapetissé!'),
  double: () => L('Next point ×2!', 'Prochain point ×2!'),
};

const star = (g: CanvasRenderingContext2D, r: number) => glyphPath(g, 4, 0, 0, r);

/** Ball positions kept for the motion trail. */
const TRAIL = 6;

export const duel: GameDef = {
  id: 'duel',
  get name() {
    return L('Paddle Duel', 'Duel de raquettes');
  },
  get rules() {
    return L('Get the ball past the rival paddle to score.', 'Faites passer la balle derrière l’adversaire pour marquer.');
  },
  category: 'reflex',
  help: () => ({
    goal: L(
      'Be the first to reach the target score against the paddle at the top.',
      'Atteignez le pointage visé avant la raquette adverse, en haut.',
    ),
    steps: [
      L(
        'Your paddle is at the bottom. A ball that gets past a paddle is a point for the other side.',
        'Votre raquette est en bas. Une balle qui passe derrière une raquette donne un point à l’autre camp.',
      ),
      L(
        'Where the ball meets your paddle sets its angle: the edges send it off steeply.',
        'L’endroit où la balle touche votre raquette donne son angle : les bords l’envoient en biais.',
      ),
      L(
        'The ball speeds up with every hit. Some matches add blocks, bumpers or bonus stars in mid-field, or a rival with its own style.',
        'La balle accélère à chaque coup. Certains matchs ajoutent des blocs, des bumpers ou des étoiles bonus au milieu, ou un adversaire au style bien à lui.',
      ),
      L(
        `Return the ball ${STREAK_TIERS[0]}, ${STREAK_TIERS[1]}, ${STREAK_TIERS[2]}, ${STREAK_TIERS[3]} times in a row without conceding: a wide paddle, smash shots the rival misreads, a shrunken rival, then a doubled point.`,
        `Renvoyez la balle ${STREAK_TIERS[0]}, ${STREAK_TIERS[1]}, ${STREAK_TIERS[2]}, ${STREAK_TIERS[3]} fois de suite sans concéder : raquette large, coups smash que l’adversaire lit mal, adversaire rapetissé, puis point doublé.`,
      ),
      L('Drag anywhere on the field to move your paddle.', 'Glissez n’importe où sur le terrain pour déplacer votre raquette.'),
      L('Keyboard: ← → or A D to move, P to pause.', 'Clavier : ← → ou A D pour bouger, P pour la pause.'),
    ],
    tips: [
      L(
        'Hit with an edge to send the ball where the rival is not.',
        'Frappez avec un bord pour envoyer la balle là où l’adversaire n’est pas.',
      ),
      L(
        `${POINT} per point, +${RALLY_POINTS} per hit of the rally that won it, +${MARGIN_BONUS} per point of margin at the end.`,
        `${POINT} par point, +${RALLY_POINTS} par coup de l’échange gagnant, +${MARGIN_BONUS} par point d’écart à la fin.`,
      ),
      L(
        `A bonus star is worth ${TARGET_POINTS} and counts as a combo step, but only if you sent the ball.`,
        `Une étoile bonus vaut ${TARGET_POINTS} et compte dans le combo, mais seulement si la balle vient de vous.`,
      ),
      L('Conceding a point ends the combo.', 'Concéder un point met fin au combo.'),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [560, 720],
      [560, 700],
      [720, 920],
      [780, 930],
      [850, 1100],
    ] as const),
  par: (d) => goalFor(d) * 12 + 10,
  pad: () => ({ left: [btn('ArrowLeft', 'left', L('Left', 'Gauche'))], right: [btn('ArrowRight', 'right', L('Right', 'Droite'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const trail: { x: number; y: number }[] = [];
    /** Flash on the side that conceded (+1 bottom, -1 top) and how much is left of it. */
    let flashSide = 0;
    let flash = 0;
    /** Paddle squash after a hit, 1 → 0. */
    let youPop = 0;
    let aiPop = 0;
    /** When each side last scored (arena time, so the pop also plays out after the match). */
    let youGainAt = -9;
    let aiGainAt = -9;
    const fade = (at: number) => Math.max(0, 1 - (arena.time - at) * 1.5);
    /** Who touched the ball last (colours its trail). */
    let last: 'you' | 'ai' | '' = '';
    let ended = false;
    /** When each bumper was last hit (arena time), for its flash. */
    const bumpedAt = new Map<object, number>();

    const status = () =>
      ctx.status(
        [
          L(`You ${s.you} – ${s.them} Rival`, `Vous ${s.you} – ${s.them} Adversaire`),
          L(`first to ${s.goal}`, `premier à ${s.goal}`),
          s.rally > 2 && !s.serve ? L(`rally ${s.rally}`, `échange ${s.rally}`) : '',
          s.streak > 1 ? `combo ×${s.streak}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );

    /** A paddle: bevelled and squashed by a hit; the rival's has eyes that follow the ball. */
    function paddle(g: CanvasRenderingContext2D, x: number, y: number, w: number, fill: string, pop: number, top: boolean) {
      const sq = pop * pop;
      const ph = PADDLE_H * (1 - 0.3 * sq);
      const pw = w + 10 * sq;
      const py = top ? y : y + (PADDLE_H - ph);
      arena.block(g, x - pw / 2, py, pw, ph, fill, PADDLE_H / 2);
      if (!top) return;
      const c = arena.colors;
      const look = Math.max(-1, Math.min(1, (s.bx - x) / 80));
      const down = s.vy > 0 || s.serve > 0 ? 0.3 : 1;
      for (const dx of [-7, 7]) {
        const ex = x + dx + look * 2;
        g.fillStyle = c.paper;
        g.strokeStyle = arena.tone(fill).edge;
        g.lineWidth = arena.lw * 0.4;
        g.beginPath();
        g.arc(ex, py + ph / 2, 3, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = c.coal;
        g.beginPath();
        g.arc(ex + look * 1.2, py + ph / 2 + down, 1.5, 0, Math.PI * 2);
        g.fill();
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const rival = c.p[0];
      arena.field(g, 0, 0, W, H, 20, 0, false);
      // Each end is tinted in its owner's colour: that's the line to defend.
      const ZONE = 46;
      const top = g.createLinearGradient(0, 0, 0, ZONE);
      top.addColorStop(0, arena.tone(rival).glow);
      top.addColorStop(1, alpha(rival, 0));
      g.fillStyle = top;
      g.fillRect(0, 0, W, ZONE);
      const bottom = g.createLinearGradient(0, H, 0, H - ZONE);
      bottom.addColorStop(0, arena.tone(c.accent).glow);
      bottom.addColorStop(1, alpha(c.accent, 0));
      g.fillStyle = bottom;
      g.fillRect(0, H - ZONE, W, ZONE);
      // Conceded side flashes.
      if (flash > 0) {
        g.fillStyle = flashSide > 0 ? c.bad : c.good;
        g.globalAlpha = flash * 0.25;
        g.fillRect(0, flashSide > 0 ? H / 2 : 0, W, H / 2);
        g.globalAlpha = 1;
      }
      // Half-way line, and the score in each half: tinted, popping when it goes up.
      g.strokeStyle = c.muted;
      g.globalAlpha = 0.6;
      g.lineWidth = arena.lw * 0.6;
      g.setLineDash([8, 8]);
      g.beginPath();
      g.moveTo(0, H / 2);
      g.lineTo(W, H / 2);
      g.stroke();
      g.setLineDash([]);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [n, y, fill, p] of [
        [s.them, H / 4 + 6, rival, fade(aiGainAt)],
        [s.you, (H * 3) / 4 - 6, c.accent, fade(youGainAt)],
      ] as const) {
        g.globalAlpha = (arena.dark ? 0.32 : 0.25) + 0.5 * p;
        g.fillStyle = fill;
        g.font = `800 ${(60 * (1 + 0.3 * p)).toFixed(1)}px ${arena.family}`;
        g.fillText(String(n), W / 2, y);
      }
      g.globalAlpha = 1;
      g.textBaseline = 'alphabetic';
      // Points still needed, as pips beside the half-way line.
      for (let k = 0; k < s.goal; k++) {
        const x = W - 16 - k * 15;
        arena.disc(g, x, H / 2 - 15, 5, k < s.them ? rival : c.cellAlt);
        arena.disc(g, x, H / 2 + 15, 5, k < s.you ? c.accent : c.cellAlt);
      }
      for (const b of s.blocks) {
        const at = blockAt(b, s.time);
        arena.block(g, at.x, at.y, at.w, at.h, c.muted, 4);
      }
      // Bumpers: a ringed knob that swells and lights up when the ball kicks off it.
      for (const b of s.bumpers) {
        const k = Math.max(0, 1 - (arena.time - (bumpedAt.get(b) ?? -9)) * 4);
        const fill = c.p[4];
        g.fillStyle = arena.tone(fill).glow;
        g.globalAlpha = 0.5 + 0.5 * k;
        g.beginPath();
        g.arc(b.x, b.y, b.r + 4 + 5 * k, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        arena.ball(g, b.x, b.y, b.r * (1 + 0.15 * k), fill);
        arena.disc(g, b.x, b.y, b.r * 0.42, k > 0 ? c.paper : arena.tone(fill).hi);
      }
      // Bonus stars: swaying while up, popping back in after being taken.
      for (const t of s.targets) {
        const k = t.cool > 0 ? Math.max(0, 1 - t.cool / 0.4) : 1;
        if (k <= 0) continue;
        const pulse = 1 + 0.08 * Math.sin(arena.time * 5 + t.x);
        arena.gem(g, t.x, t.y, t.r, c.p[3], star, true, k * pulse, Math.sin(arena.time * 1.5 + t.y) * 0.3);
      }
      // Wide paddle: a glow around it while the power lasts (blinking near the end).
      if (s.wide > 0 && (s.wide > 1.5 || Math.sin(arena.time * 20) > 0)) {
        g.fillStyle = arena.tone(c.good).glow;
        g.fillRect(s.px - s.pw / 2 - 4, YOU_Y - 4, s.pw + 8, PADDLE_H + 8);
      }
      paddle(g, s.ax, AI_Y, s.aw, s.shrink > 0 ? c.muted : rival, aiPop, true);
      paddle(g, s.px, YOU_Y, s.pw, c.accent, youPop, false);
      // Smash shots in hand: pips over your paddle.
      for (let k = 0; k < s.smash; k++) arena.disc(g, s.px + (k - (s.smash - 1) / 2) * 9, YOU_Y - 8, 3, c.bad);
      powerHud(g);
      const ballFill = s.hot ? c.bad : arena.dark ? c.fg : c.cell;
      if (!s.done && s.serve > 0) {
        // Waiting to serve: the ball pops back in, a ring counts down, an arrow points at who receives.
        const k = 1 - s.serve / SERVE_S;
        const dir = s.serveDown ? 1 : -1;
        const fill = s.serveDown ? c.accent : rival;
        g.fillStyle = fill;
        g.strokeStyle = arena.tone(fill).edge;
        g.lineWidth = arena.lw * 0.5;
        g.lineJoin = 'round';
        const ay = H / 2 + dir * (17 + 4 * Math.abs(Math.sin(arena.time * 6)));
        g.beginPath();
        g.moveTo(W / 2 - 8, ay);
        g.lineTo(W / 2 + 8, ay);
        g.lineTo(W / 2, ay + dir * 10);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = c.fg;
        g.globalAlpha = 0.5;
        g.lineWidth = arena.lw * 0.7;
        g.beginPath();
        g.arc(s.bx, s.by, BALL_R + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - k));
        g.stroke();
        g.globalAlpha = 1;
        arena.ball(g, s.bx, s.by, (BALL_R + 1) * outBack(Math.min(1, k * 3)), ballFill);
      } else if (!s.done) {
        // Trail in the colour of whoever hit it last, longer as the ball speeds up.
        const t = arena.tone(s.hot ? c.bad : last === 'ai' ? rival : last === 'you' ? c.accent : c.muted);
        g.fillStyle = t.glow;
        for (const [k, p] of trail.entries()) {
          const f = (k + 1) / (trail.length + 1);
          g.globalAlpha = f * 0.9;
          g.beginPath();
          g.arc(p.x, p.y, BALL_R * (0.35 + 0.65 * f), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
        arena.ball(g, s.bx, s.by, BALL_R + 1, ballFill);
      }
      arena.overlay(g);
    }

    /**
     * Combo meter along the bottom edge (filling towards the next milestone), timers for the powers
     * that run out, and a ×2 badge while the next point is doubled.
     */
    function powerHud(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      if (s.streak > 0 && s.tier < STREAK_TIERS.length) {
        const lo = s.tier ? STREAK_TIERS[s.tier - 1] : 0;
        const k = (s.streak - lo) / (STREAK_TIERS[s.tier] - lo);
        g.fillStyle = c.cellAlt;
        g.fillRect(0, H - 4, W, 4);
        g.fillStyle = c.accent;
        g.fillRect(0, H - 4, W * k, 4);
      }
      const bars: [number, string][] = [];
      if (s.wide > 0) bars.push([s.wide / WIDE_S, c.good]);
      if (s.shrink > 0) bars.push([s.shrink / SHRINK_S, c.p[0]]);
      g.globalAlpha = 0.85;
      bars.forEach(([k, fill], i) => {
        g.fillStyle = fill;
        g.fillRect(8, H / 2 - 10 + i * 7, 46 * k, 4);
      });
      g.globalAlpha = 1;
      if (s.double) {
        const x = 30;
        const y = (H * 3) / 4 - 6;
        arena.disc(g, x, y, 14 + Math.sin(arena.time * 6), c.accent);
        g.fillStyle = arena.tone(c.accent).edge;
        g.font = `900 12px ${arena.family}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('×2', x, y + 0.5);
        g.textBaseline = 'alphabetic';
      }
    }

    // Drag (or hover with a mouse) to steer.
    const steer = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.type === 'pointermove' && !arena.canvas.matches(':hover')) return;
      s.target = arena.toWorld(e).x;
    };
    const down = (e: PointerEvent) => {
      arena.canvas.setPointerCapture?.(e.pointerId);
      steer(e);
    };
    arena.canvas.addEventListener('pointerdown', down);
    arena.canvas.addEventListener('pointermove', steer);

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const rally = s.rally;
        const streak = s.streak;
        const score = s.score;
        const bx = s.bx;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        const rival = c.p[0];
        if (ev.hit === 'you') {
          youPop = 1;
          last = 'you';
          sfx('hit', { pitch: Math.min(s.rally, 10) });
          fx.burst(s.bx, YOU_Y, arena.tone(c.accent).hi, 7, 90, 2.5, 0.3, 'spark', 0, -Math.PI / 2, Math.PI * 0.8);
          comboPop(fx, Math.max(16, Math.min(W - 16, s.bx)), YOU_Y - 12, s.streak, s.streak >= STREAK_TIERS[0] ? c.accent : c.fg);
          if (s.hot) {
            // A smash shot leaves the paddle in a shower of sparks.
            fx.burst(s.bx, YOU_Y, c.bad, 14, 180, 3, 0.4, 'spark', 0, -Math.PI / 2, Math.PI * 0.5);
            fx.shake(2.5, 0.15);
            sfx('shoot');
          }
          if (s.speed > s.base * 1.5) fx.shake(1.2, 0.12);
        } else if (ev.hit === 'ai') {
          aiPop = 1;
          last = 'ai';
          sfx('hit', { pitch: -4, vol: 0.7 });
          fx.burst(s.bx, AI_Y + PADDLE_H, arena.tone(rival).hi, 7, 90, 2.5, 0.3, 'spark', 0, Math.PI / 2, Math.PI * 0.8);
        }
        if (ev.bump) {
          bumpedAt.set(ev.bump, arena.time);
          sfx('flip', { pitch: 5 });
          fx.ring(ev.bump.x, ev.bump.y, c.p[4], ev.bump.r, ev.bump.r * 2.6, 0.3, arena.lw);
        }
        if (ev.star) {
          sfx('coin', { pitch: 7 });
          fx.burst(ev.star.x, ev.star.y, c.p[3], 14, 140, 3, 0.5, 'spark', 0);
          fx.ring(ev.star.x, ev.star.y, c.p[3], 6, 34, 0.35, arena.lw);
          fx.text(ev.star.x, ev.star.y - 14, `+${TARGET_POINTS}`, c.p[3], 13, 0.8);
          ctx.score(s.score);
        }
        if (ev.tier && ev.unlocked) {
          comboTier(fx, ev.tier, c.accent, POWER_NAMES[ev.unlocked]());
          if (ev.unlocked === 'wide') fx.ring(s.px, YOU_Y, c.good, 8, s.pw, 0.4, arena.lw);
          if (ev.unlocked === 'shrink') fx.burst(s.ax, AI_Y + PADDLE_H / 2, rival, 16, 120, 3, 0.5, 'square', 0);
          if (ev.unlocked === 'smash') fx.burst(s.px, YOU_Y, c.bad, 16, 140, 3.5, 0.5, 'spark', 0, -Math.PI / 2, Math.PI);
        }
        if (ev.wall) {
          sfx('tick', { vol: 0.6 });
          fx.burst(s.bx, s.by, c.muted, 4, 60, 2, 0.25, 'dot', 0);
        }
        if (ev.point) {
          // Burst where the ball left the field.
          const x = Math.max(16, Math.min(W - 16, bx));
          const mine = ev.point === 'you';
          const y = mine ? 6 : H - 6;
          const fill = mine ? c.accent : rival;
          fx.burst(x, y, fill, 16, 160, 3.5, 0.6, 'square', mine ? 260 : -260, mine ? Math.PI / 2 : -Math.PI / 2, Math.PI * 0.9);
          fx.ring(x, y, fill, 6, 50, 0.4, arena.lw * 1.4);
          if (mine) {
            youGainAt = arena.time;
            sfx('coin');
            fx.text(x, 54, `+${s.score - score}`, c.accent, 15, 1);
          } else {
            aiGainAt = arena.time;
            sfx('error');
            haptic(50);
            fx.shake(4, 0.3);
            fx.text(x, H - 58, L('Rival +1', 'Adversaire +1'), c.bad, 12, 1);
            if (streak >= STREAK_TIERS[0]) fx.text(W / 2, H - 76, L('Combo lost', 'Combo perdu'), c.muted, 11, 1);
          }
          flashSide = mine ? -1 : 1;
          flash = 1;
          trail.length = 0;
          last = '';
          ctx.score(s.score);
          status();
        } else if (rally !== s.rally || streak !== s.streak) status();
        if (!s.serve && !ev.point) {
          trail.push({ x: s.bx, y: s.by });
          const n = Math.round(TRAIL * (s.speed / s.base));
          while (trail.length > n) trail.shift();
        }
        flash = Math.max(0, flash - dt * 1.8);
        youPop = Math.max(0, youPop - dt * 5);
        aiPop = Math.max(0, aiPop - dt * 5);
        if ((ev.won || ev.over) && !ended) {
          ended = true;
          if (ev.won) {
            for (let i = 0; i < 4; i++) fx.burst(W / 2, H * 0.75, c.p[i], 10, 200, 4, 0.9, 'square', 220);
            fx.ring(W / 2, H * 0.75, c.accent, 10, 110, 0.6, arena.lw * 1.5);
            fx.flash(c.good, 0.22, 0.5);
          }
          arena.linger(1.6);
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = k === 'arrowleft' || k === 'a' ? -1 : k === 'arrowright' || k === 'd' ? 1 : 0;
        if (!dir) return false;
        s.target = null;
        if (e.type === 'keydown') s.dir = dir;
        else if (s.dir === dir) s.dir = 0;
        return true;
      },
      destroy() {
        arena.canvas.removeEventListener('pointerdown', down);
        arena.canvas.removeEventListener('pointermove', steer);
        arena.destroy();
      },
    };
  },
};
