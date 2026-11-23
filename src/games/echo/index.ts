import './style.css';
import { L } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import {
  createLevel,
  IDLE_S,
  lenOf,
  lit,
  livesFor,
  maxScore,
  PERFECT_POINTS,
  press,
  ROUND_POINTS,
  runSeconds,
  step,
  TAP_POINTS,
  type PressResult,
} from './rules';

const SIZE = 300;
const MID = SIZE / 2;
/** Palette slot (and glyph) per pad, most distinct first: orange, blue, green, yellow, purple, pink, cyan, lime. */
const TONE = [0, 1, 2, 3, 4, 6, 5, 7];
/** Seconds a pad glows after you tap it. */
const TAP_S = 0.22;

export const echo: GameDef = {
  id: 'echo',
  get name() {
    return L('Echo', 'Écho');
  },
  get rules() {
    return L('Watch the pads light up, then repeat the sequence.', 'Regardez les pastilles s’allumer, puis répétez la suite.');
  },
  category: 'think',
  help: () => ({
    goal: L(
      'Repeat a growing sequence of lit pads, round after round, until the last round.',
      'Répétez une suite de pastilles qui s’allonge, ronde après ronde, jusqu’à la dernière.',
    ),
    steps: [
      L(
        'Watch: the pads light up one after the other. Each pad has its own colour and shape.',
        'Regardez : les pastilles s’allument l’une après l’autre. Chacune a sa couleur et sa forme.',
      ),
      L(
        'Then tap them back in the same order. Each round adds one more step.',
        'Touchez-les ensuite dans le même ordre. Chaque ronde ajoute une étape.',
      ),
      L(
        `A wrong pad (or waiting over ${IDLE_S} s) costs a heart, and the round plays again.`,
        `Une mauvaise pastille (ou plus de ${IDLE_S} s d’attente) coûte un cœur, et la ronde rejoue.`,
      ),
      L('Tap a pad to press it.', 'Touchez une pastille pour l’appuyer.'),
      L(
        'Keyboard: number keys 1 to 8 press the numbered pads, P to pause.',
        'Clavier : les touches 1 à 8 appuient sur les pastilles numérotées, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Each new step is worth ${TAP_POINTS}, each round ${ROUND_POINTS} × its number, plus ${PERFECT_POINTS} if you got it right the first time.`,
        `Chaque nouvelle étape vaut ${TAP_POINTS}, chaque ronde ${ROUND_POINTS} × son numéro, plus ${PERFECT_POINTS} si vous la réussissez du premier coup.`,
      ),
      L(
        'Say the shapes (or hum the colours) under your breath: it helps you remember.',
        'Nommez les formes (ou les couleurs) à voix basse : ça aide à retenir.',
      ),
    ],
  }),
  stars: (d) => [maxScore(d) - PERFECT_POINTS, maxScore(d)],
  par: (d) => Math.round(runSeconds(d)),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const n = s.n;
    const max = livesFor(ctx.difficulty);
    const arena = new Arena(ctx.root, SIZE, SIZE, () => draw());
    const ring = n <= 4 ? 82 : n <= 6 ? 92 : 104;
    const padR = Math.min(56, ring * Math.sin(Math.PI / n) * 0.86);
    const hubR = ring - padR - 8;
    // Pads clockwise around the ring from the top (just left of it for an even count).
    const pads = Array.from({ length: n }, (_, k) => {
      const a = -Math.PI / 2 - (n % 2 ? 0 : Math.PI / n) + (k * Math.PI * 2) / n;
      return { x: MID + Math.cos(a) * ring, y: MID + Math.sin(a) * ring };
    });
    let tapped = { pad: -1, t: 0 };
    let shown = '';

    const status = () => {
      const turn =
        s.phase === 'input'
          ? `${L('your turn', 'à vous')} ${s.pos}/${lenOf(s)}`
          : s.phase === 'show' || s.phase === 'intro'
            ? L('watch', 'regardez')
            : '';
      const text = [`${L('Round', 'Ronde')} ${s.round}/${s.rounds}`, turn].filter(Boolean).join(' · ');
      if (text !== shown) ctx.status((shown = text));
    };

    function drawPad(g: CanvasRenderingContext2D, k: number, on: boolean) {
      const c = arena.colors;
      const { x, y } = pads[k];
      const tone = c.p[TONE[k]];
      const r = padR * (on ? 1.06 : 1);
      if (arena.sh) {
        g.fillStyle = c.drop;
        g.beginPath();
        g.arc(x + arena.sh * 0.6, y + arena.sh * 0.6, r, 0, Math.PI * 2);
        g.fill();
      }
      arena.disc(g, x, y, r, c.cellAlt);
      g.globalAlpha = on ? 1 : 0.38;
      g.fillStyle = tone;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      if (on) {
        // Glow rings.
        g.strokeStyle = tone;
        g.lineWidth = arena.lw * 1.5;
        g.beginPath();
        g.arc(x, y, r + 6, 0, Math.PI * 2);
        g.stroke();
      }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = on ? c.cell : tone;
      glyphPath(g, TONE[k], x, y - r * 0.08, r * 0.44);
      g.fill();
      g.stroke();
      g.fillStyle = c.ink;
      g.font = `700 ${Math.round(r * 0.26)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(k + 1), x, y + r * 0.68);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const on = lit(s);
      for (let k = 0; k < n; k++) drawPad(g, k, k === on || (k === tapped.pad && tapped.t > 0));
      // Hub: the round, and the steps of your turn as dots around it.
      const hub = s.phase === 'good' ? c.good : s.phase === 'bad' ? c.bad : s.phase === 'input' ? c.accent : c.cellAlt;
      arena.box(g, MID - hubR, MID - hubR, hubR * 2, hubR * 2, hub, hubR);
      g.fillStyle = c.ink;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `800 ${Math.round(hubR * 0.62)}px system-ui, sans-serif`;
      g.fillText(String(s.round), MID, MID - hubR * 0.08);
      const len = lenOf(s);
      for (let i = 0; i < len; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / len;
        const done = s.phase === 'input' ? i < s.pos : s.phase === 'show' ? i <= Math.floor(s.t / s.beat) : s.phase === 'good';
        const dx = MID + Math.cos(a) * hubR * 0.78;
        const dy = MID + Math.sin(a) * hubR * 0.78;
        g.globalAlpha = done ? 1 : 0.35;
        arena.disc(g, dx, dy, Math.min(4, (hubR * 1.2) / len), done ? c.ink : c.cell);
        g.globalAlpha = 1;
      }
      // After a slip, ring the pad you should have tapped.
      if (s.phase === 'bad' && s.want >= 0) {
        const { x, y } = pads[s.want];
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 1.2;
        g.setLineDash([6, 4]);
        g.beginPath();
        g.arc(x, y, padR + 7, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      if (s.phase === 'bad' && s.got >= 0) {
        const { x, y } = pads[s.got];
        g.strokeStyle = c.bad;
        g.lineWidth = arena.lw * 1.6;
        const k = padR * 0.3;
        g.beginPath();
        g.moveTo(x - k, y - k);
        g.lineTo(x + k, y + k);
        g.moveTo(x + k, y - k);
        g.lineTo(x - k, y + k);
        g.stroke();
      }
    }

    function report(out: PressResult) {
      if (!out) return;
      ctx.score(s.score);
      if (out === 'slip' || out === 'lose') ctx.lives(s.lives, max);
      status();
      draw();
      if (out === 'win') ctx.win();
      else if (out === 'lose') ctx.lose();
    }

    function tap(k: number) {
      if (s.phase !== 'input') return;
      tapped = { pad: k, t: TAP_S };
      report(press(s, k));
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 12,
      onDown(p) {
        const k = pads.findIndex((q) => Math.hypot(p.x - q.x, p.y - q.y) <= padR * 1.12);
        if (k >= 0) tap(k);
      },
    });

    ctx.score(0);
    ctx.lives(s.lives, max);
    status();
    return {
      draw,
      frame(dt) {
        const ev = step(s, dt);
        tapped.t = Math.max(0, tapped.t - dt);
        if (ev.phase) status();
        report(ev.timeout);
        draw();
      },
      onKey(e) {
        const k = Number(e.key) - 1;
        if (!/^[1-9]$/.test(e.key) || k >= n) return false;
        if (e.type === 'keydown' && !e.repeat) tap(k);
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
