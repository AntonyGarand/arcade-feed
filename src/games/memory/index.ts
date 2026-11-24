import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { outBack } from '../../kits/arena/ease';
import { DX, DY, gestures, keyDir } from '../../kits/gesture/gesture';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  clockLeft,
  createLevel,
  INTRO_S,
  LIVES,
  PERFECT_POINTS,
  press,
  roundsFor,
  runSeconds,
  scoreAt,
  showFor,
  SPEED_POINTS,
  step,
  TILE_POINTS,
  type PressResult,
} from './rules';

const W = 300;
const H = 336;
/** The bar on top: round dots and the clock. */
const BAR = 36;
const GX = 8;
const GY = BAR + 8;
const GS = W - 2 * GX;

export const memory: GameDef = {
  id: 'memory',
  get name() {
    return L('Memory', 'Mémoire');
  },
  get rules() {
    return L('Tiles flash: tap them back before the clock runs out.', 'Des cases s’allument : retouchez-les avant la fin du temps.');
  },
  category: 'think',
  help: () => ({
    goal: L(
      'Remember the tiles that light up, then tap them all back, round after round.',
      'Retenez les cases qui s’allument, puis retouchez-les toutes, ronde après ronde.',
    ),
    steps: [
      L(
        'Some tiles light up for a moment, then go dark. Each round lights one more.',
        'Quelques cases s’allument un instant, puis s’éteignent. Chaque ronde en allume une de plus.',
      ),
      L(
        'Tap every tile that was lit before the clock on top runs out.',
        'Touchez chaque case qui était allumée avant la fin du temps, en haut.',
      ),
      L(
        'A wrong tile costs a heart; so does running out of time, and the missed tiles are shown.',
        'Une mauvaise case coûte un cœur, tout comme manquer de temps; les cases oubliées sont alors montrées.',
      ),
      L('Tap a tile to pick it.', 'Touchez une case pour la choisir.'),
      L(
        'Keyboard: arrows or WASD move the cursor, Space or Enter picks, P to pause.',
        'Clavier : flèches ou WASD pour le curseur, Espace ou Entrée pour choisir, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `${TILE_POINTS} points per tile, ${PERFECT_POINTS} for a round without a wrong tile, and ${SPEED_POINTS} per second left on the clock.`,
        `${TILE_POINTS} points par case, ${PERFECT_POINTS} pour une ronde sans erreur, et ${SPEED_POINTS} par seconde restante.`,
      ),
      L(
        'See the lit tiles as one shape rather than one by one, and tap the ones you’re sure of first.',
        'Voyez les cases allumées comme une seule forme plutôt qu’une par une, et touchez d’abord celles dont vous êtes sûr.',
      ),
    ],
  }),
  stars: (d) => [scoreAt(d, 1, roundsFor(d) - 1), scoreAt(d, 0.5)],
  par: (d) => Math.round(runSeconds(d)),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const n = s.side * s.side;
    const cs = GS / s.side;
    const gap = s.side >= 6 ? 4 : 5;
    let cursor = -1;
    /** When each tile was last found or tapped wrong (arena time), for its pop. */
    const struck = new Array<number>(n).fill(-9);
    let shown = '';
    /** Whole seconds left on the clock at the last tick sound. */
    let ticked = -1;

    const tileX = (i: number) => GX + (i % s.side) * cs;
    const tileY = (i: number) => GY + Math.floor(i / s.side) * cs;
    const centre = (i: number) => ({ x: tileX(i) + cs / 2, y: tileY(i) + cs / 2 });

    const status = () => {
      const what =
        s.phase === 'show' || s.phase === 'intro'
          ? L('watch', 'regardez')
          : s.phase === 'input'
            ? P(s.left, ['tile left', 'tiles left'], ['case restante', 'cases restantes'])
            : '';
      const text = [`${L('Round', 'Ronde')} ${s.round}/${s.rounds}`, what].filter(Boolean).join(' · ');
      if (text !== shown) ctx.status((shown = text));
    };

    function drawTile(g: CanvasRenderingContext2D, i: number) {
      const c = arena.colors;
      const x = tileX(i) + gap / 2;
      const y = tileY(i) + gap / 2;
      const w = cs - gap;
      const since = arena.time - struck[i];
      const pop = since < 0.3 && !s.miss[i] ? 1 + 0.12 * Math.sin((since / 0.3) * Math.PI) : 1;
      // A wrong tile shakes its head.
      const wob = since < 0.35 && s.miss[i] ? Math.sin(since * 60) * 3 * (1 - since / 0.35) : 0;
      const order = s.lit[i] ? (s.patterns[s.round - 1]?.indexOf(i) ?? 0) : 0;
      const showing = s.phase === 'show' && s.lit[i];
      // Just after the show the lit tiles flip over, face down.
      const flip = s.phase === 'input' && s.lit[i] && !s.found[i] && s.t < 0.18 ? Math.abs(Math.cos((s.t / 0.18) * Math.PI)) : 1;
      const over = s.phase === 'late' || (s.phase === 'done' && s.left > 0);
      let k = pop;
      let fill = c.cellAlt;
      if (showing) {
        // The tiles pop in one after another as they light up, and pulse while lit.
        k = Math.min(1.04, Math.max(0.02, outBack((s.t - order * 0.05) / 0.18))) * (1 + 0.025 * Math.sin(s.t * 14));
        fill = c.accent;
      } else if (flip < 1 && s.t < 0.09) fill = c.accent;
      else if (s.found[i]) fill = s.phase === 'good' || (s.phase === 'done' && !s.left) ? c.good : c.accent;
      else if (s.miss[i]) fill = c.bad;
      const kw = w * k;
      const kx = kw * flip;
      const ox = x + (w - kx) / 2 + wob;
      const oy = y + (w - kw) / 2;
      if (showing) {
        g.fillStyle = arena.tone(c.accent).glow;
        g.beginPath();
        g.roundRect(ox - 4, oy - 4, kx + 8, kw + 8, 10);
        g.fill();
      }
      if (kx > 1) arena.block(g, ox, oy, kx, kw, fill, 6);
      const mx = ox + kx / 2;
      const my = oy + kw / 2;
      const m = kw * 0.2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      if (s.miss[i]) {
        g.strokeStyle = c.coal;
        g.lineWidth = arena.lw * 1.6;
        g.beginPath();
        g.moveTo(mx - m, my - m);
        g.lineTo(mx + m, my + m);
        g.moveTo(mx + m, my - m);
        g.lineTo(mx - m, my + m);
        g.stroke();
      } else if (s.found[i]) {
        // A tick, so found tiles don't rely on colour alone; it draws itself in.
        const d = Math.min(1, since / 0.2);
        g.strokeStyle = c.coal;
        g.lineWidth = arena.lw * 1.6;
        g.beginPath();
        g.moveTo(mx - m, my);
        if (d < 0.4) g.lineTo(mx - m + (m * 0.7 * d) / 0.4, my + (m * 0.7 * d) / 0.4);
        else {
          g.lineTo(mx - m * 0.3, my + m * 0.7);
          g.lineTo(mx - m * 0.3 + m * 1.3 * ((d - 0.4) / 0.6), my + m * 0.7 - m * 1.5 * ((d - 0.4) / 0.6));
        }
        g.stroke();
      }
      g.lineCap = 'butt';
      // After the clock ran out (or the last heart went), ring the tiles that were missed: marching dashes.
      if (over && s.lit[i] && !s.found[i]) {
        g.strokeStyle = c.accent;
        g.lineWidth = arena.lw * 1.6;
        g.setLineDash([5, 4]);
        g.lineDashOffset = -arena.time * 20;
        g.globalAlpha = 0.75 + 0.25 * Math.sin(arena.time * 10);
        g.beginPath();
        g.roundRect(x + 3, y + 3, w - 6, w - 6, 5);
        g.stroke();
        g.setLineDash([]);
        g.lineDashOffset = 0;
        g.globalAlpha = 1;
      }
    }

    function drawBar(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      // One dot per round: done, current, to come.
      const dr = 5;
      for (let r = 1; r <= s.rounds; r++) {
        const x = GX + dr + 2 + (r - 1) * (dr * 2 + 5);
        const y = BAR / 2 + 2;
        const fill = r <= s.cleared.length ? (s.cleared[r - 1] ? c.good : c.bad) : r === s.round ? c.accent : c.cellAlt;
        arena.disc(g, x, y, r === s.round ? dr + 1 : dr, fill);
      }
      // The clock: full while the tiles show, then it drains; red near the end.
      const tx = GX + s.rounds * (dr * 2 + 5) + 12;
      const tw = W - GX - tx;
      const y = BAR / 2 + 2;
      const left = clockLeft(s);
      const frac = s.phase === 'show' ? 1 - s.t / showFor(s.d) : left / s.limit;
      arena.box(g, tx, y - 7, tw, 14, c.cellAlt, 7, false);
      g.fillStyle = s.phase === 'show' ? c.muted : left < 2 && s.phase === 'input' ? c.bad : c.accent;
      g.beginPath();
      g.roundRect(tx + 2, y - 5, Math.max(0, (tw - 4) * Math.min(1, frac)), 10, 5);
      g.fill();
      // Seconds left, once the clock runs.
      if (s.phase === 'input') {
        g.font = `800 10px ${arena.family}`;
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        g.fillStyle = c.fg;
        g.fillText(left.toFixed(1), tx + tw - 7, y + 0.5);
        g.textBaseline = 'alphabetic';
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      drawBar(g);
      for (let i = 0; i < n; i++) drawTile(g, i);
      if (cursor >= 0) {
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 1.2;
        g.setLineDash([5, 3]);
        g.beginPath();
        g.roundRect(tileX(cursor) + 1, tileY(cursor) + 1, cs - 2, cs - 2, 7);
        g.stroke();
        g.setLineDash([]);
      }
      // The round banner.
      if (s.phase === 'intro') {
        const a = Math.min(1, s.t / 0.15, (INTRO_S - s.t) / 0.15);
        const k = outBack(s.t / 0.3);
        g.globalAlpha = Math.max(0, a);
        arena.box(g, W / 2 - 90 * k, GY + GS / 2 - 34, 180 * k, 68, c.cell, 12);
        g.fillStyle = c.fg;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `800 24px ${arena.family}`;
        g.fillText(`${L('Round', 'Ronde')} ${s.round}`, W / 2, GY + GS / 2 - 9);
        g.font = `600 13px ${arena.family}`;
        g.fillStyle = c.muted;
        g.fillText(P(s.left, ['tile', 'tiles'], ['case', 'cases']), W / 2, GY + GS / 2 + 16);
        g.globalAlpha = 1;
      }
      arena.overlay(g);
    }

    function report(out: PressResult, i: number) {
      if (!out) return;
      const c = arena.colors;
      const { x, y } = centre(i);
      struck[i] = arena.time;
      if (out === 'slip' || out === 'lose') {
        sfx('error');
        haptic(25);
        fx.shake(4, 0.25);
        fx.flash(c.bad, 0.22, 0.3);
        fx.burst(x, y, c.bad, 10, 110, 3, 0.45);
        ctx.lives(s.lives, LIVES);
      } else {
        sfx('combo', { step: s.found.filter(Boolean).length });
        fx.burst(x, y, c.accent, 10, 120, 3, 0.5);
        fx.ring(x, y, c.accent, cs * 0.2, cs * 0.6, 0.3, arena.lw);
        fx.text(x, y - cs * 0.3, `+${TILE_POINTS}`, c.fg, 12);
      }
      if (out === 'round' || out === 'win') {
        sfx(s.perfect ? 'power' : 'coin');
        const cx = W / 2;
        const cy = GY + GS / 2;
        if (s.perfect) {
          fx.ring(cx, cy, c.good, 10, GS * 0.55, 0.5, arena.lw * 1.5);
          fx.text(cx, cy - 14, `${L('Perfect', 'Parfait')} +${s.perfect}`, c.good, 16, 1);
        }
        if (s.speed) fx.text(cx, cy + 12, `${L('Speed', 'Vitesse')} +${s.speed}`, c.accent, 14, 1);
        for (let k = 0; k < n; k++) if (s.found[k]) fx.burst(centre(k).x, centre(k).y, c.good, 4, 80, 2.5, 0.4, 'dot', 0);
      }
      ctx.score(s.score);
      status();
      draw();
      if (out === 'win') {
        fx.flash(c.good, 0.2, 0.4);
        arena.linger();
        ctx.win();
      } else if (out === 'lose') {
        arena.linger();
        ctx.lose();
      }
    }

    const tap = (i: number) => {
      if (i >= 0) report(press(s, i), i);
    };

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 12,
      onDown(p) {
        const c = Math.floor((p.x - GX) / cs);
        const r = Math.floor((p.y - GY) / cs);
        if (c < 0 || r < 0 || c >= s.side || r >= s.side) return;
        cursor = -1;
        tap(r * s.side + c);
      },
    });

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const before = s.phase;
        const ev = step(s, dt);
        arena.update(dt);
        if (ev.phase) {
          if (s.phase === 'show') sfx('flip', { pitch: 4 });
          else if (s.phase === 'input' && before === 'show') sfx('flip', { pitch: -2 });
          else if (s.phase === 'intro') sfx('tick');
          ticked = -1;
          status();
        }
        if (s.phase === 'input') {
          const left = Math.ceil(s.limit - s.t);
          if (left <= 3 && left !== ticked) {
            ticked = left;
            sfx('tick', { pitch: 3 - left });
          }
        }
        if (ev.late) {
          const c = arena.colors;
          sfx('boom', { vol: 0.5 });
          fx.shake(5, 0.3);
          fx.flash(c.bad, 0.25, 0.4);
          fx.text(W / 2, GY + GS / 2, L('Time’s up!', 'Temps écoulé!'), c.bad, 20, 1.2);
          ctx.lives(s.lives, LIVES);
        }
        draw();
        if (ev.late === 'win') {
          arena.linger();
          ctx.win();
        } else if (ev.late === 'lose') {
          arena.linger();
          ctx.lose();
        }
      },
      onKey(e) {
        const dir = keyDir(e.key);
        if (dir === -1 && e.key !== ' ' && e.key !== 'Enter') return false;
        if (e.type !== 'keydown') return true;
        if (cursor < 0) cursor = Math.floor(s.side / 2) * s.side + Math.floor(s.side / 2);
        else if (dir !== -1) {
          const c = Math.min(s.side - 1, Math.max(0, (cursor % s.side) + DX[dir]));
          const r = Math.min(s.side - 1, Math.max(0, Math.floor(cursor / s.side) + DY[dir]));
          if (r * s.side + c !== cursor) sfx('tick', { vol: 0.4 });
          cursor = r * s.side + c;
        } else if (!e.repeat) tap(cursor);
        draw();
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
