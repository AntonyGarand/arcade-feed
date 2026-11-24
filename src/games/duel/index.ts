import './style.css';
import { L } from '../../core/i18n';
import { btn } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { alpha } from '../../kits/arena/color';
import { outBack } from '../../kits/arena/ease';
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
  step,
  W,
  YOU_Y,
} from './rules';

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
        'The ball speeds up a little with every hit. Later levels add blocks in mid-field.',
        'La balle accélère un peu à chaque coup. Les niveaux avancés ajoutent des blocs au milieu.',
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
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [560, 720],
      [560, 700],
      [720, 920],
      [760, 950],
      [800, 1050],
    ] as const),
  par: (d) => goalFor(d) * 12 + 10,
  pad: () => ({ left: [btn('ArrowLeft', 'left', L('Left', 'Gauche'))], right: [btn('ArrowRight', 'right', L('Right', 'Droite'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
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

    const status = () =>
      ctx.status(
        [
          L(`You ${s.you} – ${s.them} Rival`, `Vous ${s.you} – ${s.them} Adversaire`),
          L(`first to ${s.goal}`, `premier à ${s.goal}`),
          s.rally > 2 && !s.serve ? L(`rally ${s.rally}`, `échange ${s.rally}`) : '',
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
      paddle(g, s.ax, AI_Y, s.aw, rival, aiPop, true);
      paddle(g, s.px, YOU_Y, s.pw, c.accent, youPop, false);
      const ballFill = arena.dark ? c.fg : c.cell;
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
        const t = arena.tone(last === 'ai' ? rival : last === 'you' ? c.accent : c.muted);
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
          if (s.rally >= 3) fx.text(s.bx, YOU_Y - 18, `×${s.rally}`, s.rally >= 6 ? c.accent : c.fg, 10 + Math.min(4, s.rally / 2), 0.6);
          if (s.speed > s.base * 1.5) fx.shake(1.2, 0.12);
        } else if (ev.hit === 'ai') {
          aiPop = 1;
          last = 'ai';
          sfx('hit', { pitch: -4, vol: 0.7 });
          fx.burst(s.bx, AI_Y + PADDLE_H, arena.tone(rival).hi, 7, 90, 2.5, 0.3, 'spark', 0, Math.PI / 2, Math.PI * 0.8);
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
          }
          flashSide = mine ? -1 : 1;
          flash = 1;
          trail.length = 0;
          last = '';
          ctx.score(s.score);
          status();
        } else if (rally !== s.rally) status();
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
