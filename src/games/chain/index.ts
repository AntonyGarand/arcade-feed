import './style.css';
import { L, P } from '../../core/i18n';
import { btn, leftRight } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { outCubic } from '../../kits/arena/ease';
import { gestures, type Point } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { sfx } from '../../kits/sound/sound';
import {
  aimAt,
  createLevel,
  H,
  pointAt,
  POP_POINTS,
  progress,
  R,
  SAFE_BONUS,
  SHOOTER,
  shoot,
  step,
  swapNext,
  trace,
  W,
  type Events,
} from './rules';

/** Palette slot per marble colour (most distinct first: orange, blue, green, yellow, purple, pink). */
const TONE = [0, 1, 2, 3, 4, 6];
/** Radius of the shooter's base; a tap inside it swaps marbles. */
const BASE_R = 19;
const NEXT_R = 7;
/** Seconds a fired marble takes to slide into its slot. */
const SLIDE_S = 0.12;
/** The hole starts pulsing when the head has covered this share of the track. */
const DANGER = 0.78;

export const chain: GameDef = {
  id: 'chain',
  get name() {
    return L('Marble Chain', 'Chaîne de billes');
  },
  get rules() {
    return L('Shoot marbles into the chain: 3 of a kind pop.', 'Tirez des billes dans la chaîne : 3 pareilles éclatent.');
  },
  category: 'match',
  help: () => ({
    goal: L(
      'Pop every marble of the chain before its head rolls into the hole.',
      'Éclatez toutes les billes de la chaîne avant que la première tombe dans le trou.',
    ),
    steps: [
      L(
        'A chain of marbles rolls along the spiral towards the hole in the middle.',
        'Une chaîne de billes roule le long de la spirale vers le trou au centre.',
      ),
      L(
        'Your marble joins the chain where it hits. Three or more touching of the same colour and shape pop.',
        'Votre bille s’insère dans la chaîne là où elle frappe. Trois billes voisines ou plus de même couleur et de même forme éclatent.',
      ),
      L(
        'The front part slides back to close the gap; if the ends match, they pop too, for a combo.',
        'La partie avant recule pour refermer le trou; si les bouts sont pareils, ils éclatent aussi, en combo.',
      ),
      L(
        'Point to aim, tap or release to shoot. Tap the shooter to swap with the next marble.',
        'Pointez pour viser, touchez ou relâchez pour tirer. Touchez le canon pour prendre la bille suivante.',
      ),
      L(
        'Keyboard: ← → or A D to aim, Space to shoot, X to swap, P to pause.',
        'Clavier : ← → ou A D pour viser, Espace pour tirer, X pour échanger, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Each marble is worth ${POP_POINTS}, times the combo: set up gaps whose ends match.`,
        `Chaque bille vaut ${POP_POINTS}, multiplié par le combo : préparez des trous aux bouts pareils.`,
      ),
      L(
        `Pop near the head first: it pulls the whole front back. Staying far from the hole earns up to ${SAFE_BONUS}.`,
        `Éclatez d’abord près de la tête : tout l’avant recule. Rester loin du trou rapporte jusqu’à ${SAFE_BONUS}.`,
      ),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [880, 1000],
      [1000, 1120],
      [1120, 1240],
      [1250, 1380],
      [1350, 1500],
    ] as const),
  par: (d) => byLevel(d, [30, 45, 55, 65, 80]),
  pad: () => ({ left: leftRight(), right: [btn('x', 'swap', L('Swap', 'Échanger')), btn(' ', 'fire', L('Shoot', 'Tirer'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const end = pointAt(s.track, s.track.length);
    const mouth = pointAt(s.track, 0);
    /** Fired marbles sliding from where they hit into their slot. */
    const sliding = new Map<number, { x: number; y: number; t: number }>();
    /** The press started on the shooter (a swap, not an aim). */
    let swapPress = false;
    let ended = false;
    let shown = '';

    const status = () => {
      const text = [
        P(s.chain.length, ['marble left', 'marbles left'], ['bille restante', 'billes restantes']),
        s.combo > 1 ? `combo ×${s.combo}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (text !== shown) ctx.status((shown = text));
    };

    function marble(g: CanvasRenderingContext2D, k: number, x: number, y: number, r: number, shadow = true) {
      const c = arena.colors;
      const fill = c.p[TONE[k] ?? 0];
      arena.ball(g, x, y, r, fill, shadow);
      g.fillStyle = c.paper;
      g.strokeStyle = arena.tone(fill).edge;
      g.lineWidth = arena.lw * 0.45;
      glyphPath(g, k, x - r * 0.04, y - r * 0.04, r * 0.5);
      g.fill();
      g.stroke();
    }

    function trackPath(g: CanvasRenderingContext2D, from = 0) {
      const pts = s.track.pts;
      g.beginPath();
      g.moveTo(pts[from * 2], pts[from * 2 + 1]);
      for (let i = from * 2 + 6; i < pts.length; i += 6) g.lineTo(pts[i], pts[i + 1]);
      g.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);

      // The groove: an inked channel, the last stretch before the hole tinted with danger.
      g.lineCap = 'round';
      g.lineJoin = 'round';
      trackPath(g);
      g.strokeStyle = c.ink;
      g.lineWidth = 2 * R + 6;
      g.stroke();
      g.strokeStyle = c.cell;
      g.lineWidth = 2 * R + 6 - 2 * arena.lw * 0.8;
      g.stroke();
      trackPath(g, Math.floor(s.track.pts.length / 2 - (s.track.length * 0.15) / 2));
      // The danger stretch warms up as the head gets closer.
      g.globalAlpha = 0.1 + 0.3 * Math.max(0, Math.min(1, (progress(s) - 0.45) / 0.45));
      g.strokeStyle = c.bad;
      g.stroke();
      g.globalAlpha = 1;
      g.lineCap = 'butt';

      // Mouth and hole.
      // The mouth: a pipe end the marbles roll out of.
      arena.disc(g, mouth.x, mouth.y, R + 5, c.muted);
      arena.disc(g, mouth.x, mouth.y, R + 1, arena.tone(c.muted).lo);
      const danger = progress(s) > DANGER && !ended;
      const pulse = danger ? 0.5 + 0.5 * Math.sin(arena.time * 10) : 0;
      arena.disc(g, end.x, end.y, R + 5 + pulse * 2, c.coal);
      if (danger) {
        g.strokeStyle = c.bad;
        g.lineWidth = arena.lw * (1 + pulse);
        g.beginPath();
        g.arc(end.x, end.y, R + 9 + pulse * 3, 0, Math.PI * 2);
        g.stroke();
      }

      // The chain.
      for (const m of s.chain) {
        if (m.p < -R || m.p > s.track.length) continue;
        let { x, y } = pointAt(s.track, m.p);
        const sl = sliding.get(m.id);
        if (sl) {
          const f = outCubic(Math.min(1, sl.t / SLIDE_S));
          x = sl.x + (x - sl.x) * f;
          y = sl.y + (y - sl.y) * f;
        }
        // Peeking out of the mouth.
        const r = m.p < 0 ? R * (1 + m.p / R / 2) : R - 0.5;
        marble(g, m.k, x, y, r);
      }

      // Aim guide.
      const dx = Math.cos(s.aim);
      const dy = Math.sin(s.aim);
      if (!s.shot && !ended) {
        const t = trace(s, s.aim);
        const len = Math.hypot(t.x - SHOOTER.x, t.y - SHOOTER.y);
        g.fillStyle = c.fg;
        for (let d = BASE_R + 8; d < len - 4; d += 11) {
          g.beginPath();
          g.arc(SHOOTER.x + dx * d, SHOOTER.y + dy * d, 1.8, 0, Math.PI * 2);
          g.fill();
        }
        if (t.hit >= 0) {
          g.strokeStyle = c.fg;
          g.lineWidth = arena.lw * 0.8;
          g.setLineDash([4, 3]);
          g.beginPath();
          g.arc(t.x, t.y, R - 1, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
      }
      if (s.shot) marble(g, s.shot.k, s.shot.x, s.shot.y, R - 0.5);

      // Shooter: barrel along the aim on a round base, the loaded marble in the middle, the next behind.
      g.lineCap = 'round';
      g.strokeStyle = c.ink;
      g.lineWidth = 13;
      g.beginPath();
      g.moveTo(SHOOTER.x, SHOOTER.y);
      g.lineTo(SHOOTER.x + dx * (BASE_R + 7), SHOOTER.y + dy * (BASE_R + 7));
      g.stroke();
      g.strokeStyle = c.accent;
      g.lineWidth = 13 - 2 * arena.lw * 0.8;
      g.stroke();
      g.lineCap = 'butt';
      arena.disc(g, SHOOTER.x, SHOOTER.y, BASE_R, c.accent);
      if (!ended) {
        marble(g, s.cur, SHOOTER.x + dx * 4, SHOOTER.y + dy * 4, R - 1, false);
        marble(g, s.next, SHOOTER.x - dx * 12, SHOOTER.y - dy * 12, NEXT_R, false);
      }
      arena.overlay(g);
    }

    function react(ev: Events) {
      const c = arena.colors;
      if (ev.landed) {
        sliding.set(ev.landed.id, { x: ev.landed.x, y: ev.landed.y, t: 0 });
        fx.ring(ev.landed.x, ev.landed.y, c.fg, R * 0.6, R * 1.6, 0.22, arena.lw * 0.8);
      }
      if (ev.missed)
        fx.burst(Math.max(4, Math.min(W - 4, ev.missed.x)), Math.max(4, Math.min(H - 4, ev.missed.y)), c.muted, 5, 60, 2.5, 0.35, 'dot', 0);
      if (ev.landed && !ev.pops.length) sfx('hit', { vol: 0.8 });
      for (const pop of ev.pops) {
        if (pop.combo > 1) sfx('combo', { step: pop.combo });
        sfx('pop', { pitch: Math.min(6, pop.marbles.length - 3) });
        let mx = 0;
        let my = 0;
        for (const m of pop.marbles) {
          const fill = c.p[TONE[m.k] ?? 0];
          fx.burst(m.x, m.y, fill, 7, 120, 3.5, 0.55);
          fx.burst(m.x, m.y, arena.tone(fill).hi, 3, 80, 2.5, 0.4, 'dot', 120);
          mx += m.x / pop.marbles.length;
          my += m.y / pop.marbles.length;
        }
        fx.ring(mx, my, c.fg, 6, R * (2 + pop.marbles.length * 0.4), 0.35, arena.lw);
        fx.text(mx, my, `+${pop.gain}`, pop.combo > 1 ? c.accent : c.fg, 12 + Math.min(6, pop.marbles.length - 3) * 1.5);
        if (pop.combo > 1) {
          fx.text(SHOOTER.x, SHOOTER.y - 44, `combo ×${pop.combo}`, c.accent, 14 + pop.combo * 2, 1.1);
          fx.shake(1 + pop.combo * 0.8, 0.25);
        } else if (pop.marbles.length > 3) fx.shake(1.2, 0.15);
      }
      if (ev.landed || ev.pops.length) {
        ctx.score(s.score);
        status();
      }
      if (ev.won) {
        ended = true;
        for (const k of TONE) fx.burst(SHOOTER.x, SHOOTER.y, c.p[k], 10, 190, 4, 0.9, 'square', 220);
        fx.ring(SHOOTER.x, SHOOTER.y, c.accent, 8, 120, 0.6, arena.lw * 1.5);
        fx.flash(c.good, 0.25, 0.5);
        if (ev.bonus) fx.text(SHOOTER.x, SHOOTER.y - 40, `+${ev.bonus}`, c.accent, 18, 1.2);
        ctx.score(s.score);
        arena.linger();
      } else if (ev.lost) {
        ended = true;
        fx.burst(end.x, end.y, c.bad, 16, 150, 4, 0.6);
        fx.ring(end.x, end.y, c.bad, 6, 60, 0.5, arena.lw * 1.5);
        fx.shake(5, 0.4);
        fx.flash(c.bad, 0.3, 0.4);
        arena.linger();
      }
    }

    const nearShooter = (p: Point) => Math.hypot(p.x - SHOOTER.x, p.y - SHOOTER.y) < BASE_R + 6;
    const fire = () => {
      if (!ended && shoot(s)) {
        sfx('shoot');
        fx.burst(
          SHOOTER.x + Math.cos(s.aim) * 26,
          SHOOTER.y + Math.sin(s.aim) * 26,
          arena.colors.fg,
          4,
          70,
          2,
          0.25,
          'spark',
          0,
          s.aim,
          0.8,
        );
      }
    };
    const swap = () => {
      if (ended) return;
      swapNext(s);
      sfx('tick');
      fx.ring(SHOOTER.x, SHOOTER.y, arena.colors.fg, BASE_R * 0.6, BASE_R * 1.3, 0.2, arena.lw * 0.8);
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onDown(p) {
        swapPress = nearShooter(p);
        if (!swapPress) aimAt(s, p.x, p.y);
      },
      onMove(p, from) {
        if (!from || !swapPress) aimAt(s, p.x, p.y);
      },
      onTap(p) {
        if (swapPress) swap();
        else {
          aimAt(s, p.x, p.y);
          fire();
        }
        draw();
      },
      onRelease(p) {
        if (swapPress || nearShooter(p)) return;
        aimAt(s, p.x, p.y);
        fire();
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        if (ended) return;
        const ev = step(s, dt);
        arena.update(dt);
        for (const [id, sl] of sliding) if ((sl.t += dt) >= SLIDE_S) sliding.delete(id);
        react(ev);
        draw();
        if (ev.won) ctx.win();
        else if (ev.lost) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = k === 'arrowleft' || k === 'a' ? -1 : k === 'arrowright' || k === 'd' ? 1 : 0;
        if (dir) {
          if (e.type === 'keydown') s.turn = dir;
          else if (s.turn === dir) s.turn = 0;
          return true;
        }
        const down = e.type === 'keydown';
        if (k === ' ' || k === 'enter' || k === 'arrowup' || k === 'w') {
          if (down) fire();
          return true;
        }
        if (k === 'x' || k === 'arrowdown' || k === 's') {
          if (down) swap();
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
