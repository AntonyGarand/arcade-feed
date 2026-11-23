import './style.css';
import { L } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { AI_Y, BALL_R, blockAt, createLevel, goalFor, H, MARGIN_BONUS, PADDLE_H, POINT, RALLY_POINTS, step, W, YOU_Y } from './rules';

const FONT = "'Space Grotesk Variable', system-ui, sans-serif";
/** Ball positions kept for the motion trail. */
const TRAIL = 6;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
}

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
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const trail: { x: number; y: number }[] = [];
    const sparks: Spark[] = [];
    /** Flash on the side that conceded (+1 bottom, -1 top) and how much is left of it. */
    let flashSide = 0;
    let flash = 0;
    let youPop = 0;
    let aiPop = 0;

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

    function burst(x: number, y: number, up: boolean) {
      for (let k = 0; k < 6; k++) {
        const a = (up ? -Math.PI : 0) + ((k + 0.5) / 6) * Math.PI;
        sparks.push({ x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, t: 0 });
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Conceded side flashes.
      if (flash > 0) {
        g.fillStyle = flashSide > 0 ? c.bad : c.good;
        g.globalAlpha = flash * 0.25;
        g.fillRect(0, flashSide > 0 ? H / 2 : 0, W, H / 2);
        g.globalAlpha = 1;
      }
      // Half-way line and the score, big and faint in each half.
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.6;
      g.setLineDash([8, 8]);
      g.beginPath();
      g.moveTo(0, H / 2);
      g.lineTo(W, H / 2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = c.cellAlt;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `700 72px ${FONT}`;
      g.fillText(String(s.them), W / 2, H / 4);
      g.fillText(String(s.you), W / 2, (H * 3) / 4);
      // Points still needed, as pips beside each score.
      for (let k = 0; k < s.goal; k++) {
        const x = W - 16 - k * 13;
        arena.disc(g, x, H / 2 - 14, 4, k < s.them ? c.p[0] : c.cell);
        arena.disc(g, x, H / 2 + 14, 4, k < s.you ? c.accent : c.cell);
      }
      for (const b of s.blocks) {
        const at = blockAt(b, s.time);
        arena.box(g, at.x, at.y, at.w, at.h, c.muted, 4);
      }
      // Paddles: the rival's on top, yours at the bottom (each pops a little on a hit).
      const aw = s.aw * (1 + aiPop * 0.12);
      const pw = s.pw * (1 + youPop * 0.12);
      arena.box(g, s.ax - aw / 2, AI_Y, aw, PADDLE_H, c.p[0], PADDLE_H / 2);
      arena.box(g, s.px - pw / 2, YOU_Y, pw, PADDLE_H, c.accent, PADDLE_H / 2);
      for (const sp of sparks) {
        g.fillStyle = c.fg;
        g.globalAlpha = Math.max(0, 1 - sp.t / 0.35);
        g.beginPath();
        g.arc(sp.x, sp.y, 2, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      if (s.done) return;
      if (s.serve > 0) {
        // Waiting to serve: the ball pulses, an arrow shows which way it goes.
        const pulse = 1 + Math.sin(s.serve * 12) * 0.12;
        const dir = s.serveDown ? 1 : -1;
        g.fillStyle = c.muted;
        g.beginPath();
        g.moveTo(W / 2 - 7, H / 2 + dir * 14);
        g.lineTo(W / 2 + 7, H / 2 + dir * 14);
        g.lineTo(W / 2, H / 2 + dir * 24);
        g.closePath();
        g.fill();
        arena.disc(g, s.bx, s.by, BALL_R * pulse, c.cell);
        return;
      }
      for (const [k, p] of trail.entries()) {
        g.fillStyle = c.muted;
        g.globalAlpha = ((k + 1) / (trail.length + 1)) * 0.35;
        g.beginPath();
        g.arc(p.x, p.y, BALL_R * (0.5 + (0.5 * k) / TRAIL), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      arena.disc(g, s.bx, s.by, BALL_R, c.cell);
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
        const ev = step(s, dt);
        if (ev.hit === 'you') {
          youPop = 1;
          burst(s.bx, YOU_Y, true);
        } else if (ev.hit === 'ai') {
          aiPop = 1;
          burst(s.bx, AI_Y + PADDLE_H, false);
        }
        if (ev.point) {
          flashSide = ev.point === 'ai' ? 1 : -1;
          flash = 1;
          trail.length = 0;
          ctx.score(s.score);
          status();
        } else if (rally !== s.rally) status();
        if (!s.serve) {
          trail.push({ x: s.bx, y: s.by });
          if (trail.length > TRAIL) trail.shift();
        }
        for (const sp of sparks) {
          sp.x += sp.vx * dt;
          sp.y += sp.vy * dt;
          sp.t += dt;
        }
        while (sparks.length && sparks[0].t > 0.35) sparks.shift();
        flash = Math.max(0, flash - dt * 1.8);
        youPop = Math.max(0, youPop - dt * 6);
        aiPop = Math.max(0, aiPop - dt * 6);
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
