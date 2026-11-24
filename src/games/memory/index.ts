import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { outBack } from '../../kits/arena/ease';
import { DX, DY, gestures, keyDir } from '../../kits/gesture/gesture';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { haptic, sfx } from '../../kits/sound/sound';
import { KIND_NAMES, POWER_NAMES } from './names';
import {
  clockLeft,
  createLevel,
  FLICK_ON,
  flickAt,
  GOLD_POINTS,
  GOLD_S,
  INTRO_S,
  LIVES,
  MOVE_S,
  STREAK_TIERS,
  TIME_BONUS,
  PERFECT_POINTS,
  press,
  roundsFor,
  runSeconds,
  scoreAt,
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
      L(
        `Golden tiles add ${GOLD_S} s and ${GOLD_POINTS} points. Red crossed decoys must not be tapped; a sliding grid moves the tiles one step.`,
        `Les cases dorées ajoutent ${GOLD_S} s et ${GOLD_POINTS} points. Ne touchez pas les leurres rouges barrés; une grille glissante déplace les cases d’un cran.`,
      ),
      L(
        'Tap a tile to pick it. Keyboard: arrows or WASD move the cursor, Space or Enter picks, P to pause.',
        'Touchez une case pour la choisir. Clavier : flèches ou WASD pour le curseur, Espace ou Entrée pour choisir, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Right tiles in a row unlock rewards: ${STREAK_TIERS[0]} add ${TIME_BONUS} s, ${STREAK_TIERS[1]} give a longer look at the next round, ${STREAK_TIERS[2]} win a heart back.`,
        `Des bonnes cases d’affilée débloquent des récompenses : ${STREAK_TIERS[0]} ajoutent ${TIME_BONUS} s, ${STREAK_TIERS[1]} allongent le coup d’œil de la ronde suivante, ${STREAK_TIERS[2]} redonnent un cœur.`,
      ),
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
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
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
      const text = [`${L('Round', 'Ronde')} ${s.round}/${s.rounds}`, what, s.streak > 1 ? L(`streak ${s.streak}`, `série ${s.streak}`) : '']
        .filter(Boolean)
        .join(' · ');
      if (text !== shown) ctx.status((shown = text));
    };

    /** The sliding grid's offset while it moves (world units), and the tile drawn at a grid spot. */
    const DIRS = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    function drawTile(g: CanvasRenderingContext2D, i: number, dx = 0, dy = 0) {
      if (s.hole[i]) return;
      const c = arena.colors;
      const x = tileX(i) + gap / 2 + dx;
      const y = tileY(i) + gap / 2 + dy;
      const w = cs - gap;
      const since = arena.time - struck[i];
      const pop = since < 0.3 && !s.miss[i] ? 1 + 0.12 * Math.sin((since / 0.3) * Math.PI) : 1;
      // A wrong tile shakes its head.
      const wob = since < 0.35 && s.miss[i] ? Math.sin(since * 60) * 3 * (1 - since / 0.35) : 0;
      const order = s.lit[i] ? (s.patterns[s.round - 1]?.indexOf(i) ?? 0) : 0;
      // Flicker rounds light each tile for a moment, one after another, in the dealt (shuffled) order.
      const turn = s.lit[i] ? (s.flicks[s.round - 1]?.indexOf(i) ?? 0) : 0;
      const on = s.kind !== 'flicker' || (s.t >= flickAt(turn) && s.t < flickAt(turn) + FLICK_ON);
      const showing = s.phase === 'show' && (s.lit[i] || s.decoy[i]) && on;
      const lightC = s.decoy[i] && !s.lit[i] ? c.bad : s.gold[i] ? c.p[3] : c.accent;
      // Just after the show the lit tiles flip over, face down.
      // (Not on a sliding grid: its tiles went dark before the slide, and flipping now would show where they went.)
      const flip =
        s.phase === 'input' && s.shifts[s.round - 1] < 0 && s.lit[i] && !s.found[i] && s.t < 0.18
          ? Math.abs(Math.cos((s.t / 0.18) * Math.PI))
          : 1;
      const over = s.phase === 'late' || (s.phase === 'done' && s.left > 0);
      let k = pop;
      let fill = c.cellAlt;
      if (showing) {
        // The tiles pop in one after another as they light up, and pulse while lit.
        const from = s.kind === 'flicker' ? flickAt(turn) : order * 0.05;
        k = Math.min(1.04, Math.max(0.02, outBack((s.t - from) / 0.18))) * (1 + 0.025 * Math.sin(s.t * 14));
        fill = lightC;
      } else if (flip < 1 && s.t < 0.09) fill = s.gold[i] ? c.p[3] : c.accent;
      else if (s.found[i]) fill = s.gold[i] ? c.p[3] : s.phase === 'good' || (s.phase === 'done' && !s.left) ? c.good : c.accent;
      else if (s.miss[i]) fill = c.bad;
      const kw = w * k;
      const kx = kw * flip;
      const ox = x + (w - kx) / 2 + wob;
      const oy = y + (w - kw) / 2;
      if (showing) {
        g.fillStyle = arena.tone(lightC).glow;
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
      if (showing && s.decoy[i] && !s.lit[i]) {
        // A decoy: crossed out, so it doesn't rely on colour alone.
        g.strokeStyle = c.coal;
        g.lineWidth = arena.lw * 1.4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(mx - m, my - m);
        g.lineTo(mx + m, my + m);
        g.moveTo(mx + m, my - m);
        g.lineTo(mx - m, my + m);
        g.stroke();
        g.lineCap = 'butt';
      } else if (showing && s.gold[i]) {
        // A golden tile: a star.
        g.fillStyle = c.paper;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.6;
        g.beginPath();
        for (let p = 0; p < 10; p++) {
          const a = -Math.PI / 2 + (p * Math.PI) / 5;
          const rr = p % 2 ? m * 0.55 : m * 1.3;
          g.lineTo(mx + Math.cos(a) * rr, my + Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
        g.stroke();
      }
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

    /** The sliding grid on its way over: every tile moves one step, wrapping round, under a big arrow. */
    function drawSlide(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const dir = s.shifts[s.round - 1];
      const [ux, uy] = DIRS[dir];
      const k = Math.min(1, s.t / MOVE_S);
      const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2;
      g.save();
      g.beginPath();
      g.rect(GX, GY, GS, GS);
      g.clip();
      for (let i = 0; i < n; i++) for (const w of [0, -1]) drawTile(g, i, (e + w * s.side) * ux * cs, (e + w * s.side) * uy * cs);
      g.restore();
      const cx = W / 2;
      const cy = GY + GS / 2;
      const len = GS * 0.22;
      g.globalAlpha = Math.min(1, s.t / 0.1) * 0.9;
      g.strokeStyle = c.ink;
      g.fillStyle = c.accent;
      g.lineWidth = arena.lw;
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.atan2(uy, ux));
      g.beginPath();
      g.moveTo(-len, -8);
      g.lineTo(len * 0.3, -8);
      g.lineTo(len * 0.3, -20);
      g.lineTo(len, 0);
      g.lineTo(len * 0.3, 20);
      g.lineTo(len * 0.3, 8);
      g.lineTo(-len, 8);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
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
      const frac = s.phase === 'show' ? 1 - s.t / s.show : s.phase === 'move' ? 1 : left / s.limit;
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
      if (s.phase === 'move') drawSlide(g);
      else for (let i = 0; i < n; i++) drawTile(g, i);
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
        const col = s.gold[i] ? c.p[3] : c.accent;
        sfx(s.gold[i] ? 'coin' : 'combo', { step: s.found.filter(Boolean).length });
        fx.burst(x, y, col, 10, 120, 3, 0.5);
        fx.ring(x, y, col, cs * 0.2, cs * 0.6, 0.3, arena.lw);
        fx.text(
          x,
          y - cs * 0.3,
          s.gold[i] ? `+${TILE_POINTS + GOLD_POINTS} · +${GOLD_S} s` : `+${TILE_POINTS}`,
          s.gold[i] ? col : c.fg,
          12,
        );
        comboPop(fx, x + cs * 0.3, y - cs * 0.55, s.streak, c.accent);
      }
      if (s.unlocked) {
        comboTier(fx, s.tier, s.unlocked === 'heart' ? c.bad : s.unlocked === 'look' ? c.p[5] : c.accent, POWER_NAMES[s.unlocked]());
        if (s.unlocked === 'heart') ctx.lives(s.lives, LIVES);
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
