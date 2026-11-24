import './style.css';
import { L } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { outBack } from '../../kits/arena/ease';
import { gestures } from '../../kits/gesture/gesture';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { glyphPath } from '../../kits/glyph/glyph';
import { haptic, sfx } from '../../kits/sound/sound';
import { KIND_NAMES, POWER_NAMES } from './names';
import {
  beatIndex,
  COMBO_TIERS,
  createLevel,
  ghost,
  GOLD_POINTS,
  IDLE_S,
  lenOf,
  lit,
  livesFor,
  maxScore,
  multOf,
  PERFECT_POINTS,
  playback,
  press,
  ROUND_POINTS,
  runSeconds,
  step,
  TAP_POINTS,
  wanted,
  wantIndex,
  type PressResult,
} from './rules';

/** Field: the pad ring in a square, a prompt above it and the round's step pips below. */
const W = 300;
const H = 372;
const MID = W / 2;
/** Centre of the pad ring. */
const CY = 194;
/** Seconds into your turn before the idle clock shows around the hub. */
const IDLE_WARN = 3;
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
      L(
        'Levels vary: quicker playbacks, answering backwards, pads that trade places, grey decoy flashes to ignore.',
        'Les niveaux varient : lectures plus rapides, réponse à rebours, pastilles qui changent de place, leurres gris à ignorer.',
      ),
      L(
        `Right taps in a row unlock rewards: ${COMBO_TIERS[0]} a shield, ${COMBO_TIERS[1]} points ×2, ${COMBO_TIERS[2]} hints, ${COMBO_TIERS[3]} a slow replay, ${COMBO_TIERS[4]} a heart.`,
        `Les bonnes touches d’affilée débloquent des primes : ${COMBO_TIERS[0]} un bouclier, ${COMBO_TIERS[1]} points ×2, ${COMBO_TIERS[2]} des indices, ${COMBO_TIERS[3]} une lecture lente, ${COMBO_TIERS[4]} un cœur.`,
      ),
      L(
        'Tap a pad to press it. Keyboard: number keys 1 to 8 press the numbered pads, P to pause.',
        'Touchez une pastille pour l’appuyer. Clavier : les touches 1 à 8 appuient sur les pastilles numérotées, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Each new step is worth ${TAP_POINTS}, each round ${ROUND_POINTS} × its number, plus ${PERFECT_POINTS} if you got it right the first time.`,
        `Chaque nouvelle étape vaut ${TAP_POINTS}, chaque ronde ${ROUND_POINTS} × son numéro, plus ${PERFECT_POINTS} si vous la réussissez du premier coup.`,
      ),
      L(
        `A step with a gold star pays ${GOLD_POINTS} more the first time you get it right.`,
        `Une étape marquée d’une étoile dorée rapporte ${GOLD_POINTS} de plus la première fois que vous la réussissez.`,
      ),
      L(
        'Say the shapes (or hum the colours) under your breath: it helps you remember.',
        'Nommez les formes (ou les couleurs) à voix basse : ça aide à retenir.',
      ),
    ],
  }),
  // Three stars for a perfect run (combo rewards included); a slip or a broken combo still makes two.
  stars: (d) => [Math.round(maxScore(d) * 0.75), maxScore(d)],
  par: (d) => Math.round(runSeconds(d)),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const n = s.n;
    const max = livesFor(ctx.difficulty);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const ring = n <= 4 ? 92 : n <= 6 ? 94 : 104;
    const padR = Math.min(56, ring * Math.sin(Math.PI / n) * 0.86);
    const hubR = ring - padR - 8;
    // Ring slots clockwise from the top (just left of it for an even count). Pad k sits on slot
    // s.slot[k] and glides there when pads trade places.
    const slots = Array.from({ length: n }, (_, k) => {
      const a = -Math.PI / 2 - (n % 2 ? 0 : Math.PI / n) + (k * Math.PI * 2) / n;
      return { x: MID + Math.cos(a) * ring, y: CY + Math.sin(a) * ring };
    });
    const pads = slots.map((p) => ({ ...p }));
    /** Per pad: a press / playback pulse, 1 → 0. */
    const pulse = new Float32Array(n);
    /** Pads tapped right this attempt, for the step pips. */
    let taps: number[] = [];
    let tapped = { pad: -1, t: 0 };
    let shown = '';
    /** Playback step already sounded. */
    let heard = -1;
    /** Whole seconds left on the idle clock, already ticked. */
    let ticked = -1;
    let end: '' | 'win' | 'lose' = '';
    /** The last round was cleared with no slip. */
    let perfect = false;

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

    /** A decoy flash: the pad goes grey and hatched, with a dashed rim (not part of the sequence). */
    function drawGhost(g: CanvasRenderingContext2D, k: number) {
      const c = arena.colors;
      const { x, y } = pads[k];
      g.save();
      g.globalAlpha = 0.9;
      g.fillStyle = c.muted;
      g.beginPath();
      g.arc(x, y, padR, 0, Math.PI * 2);
      g.fill();
      g.clip();
      g.strokeStyle = c.cellAlt;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      for (let o = -padR * 2; o < padR * 2; o += 7) {
        g.moveTo(x + o, y - padR);
        g.lineTo(x + o + padR, y + padR);
      }
      g.stroke();
      g.restore();
      g.strokeStyle = c.fg;
      g.lineWidth = arena.lw * 1.2;
      g.setLineDash([5, 4]);
      g.lineDashOffset = arena.time * 30;
      g.beginPath();
      g.arc(x, y, padR + 5, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }

    function drawPad(g: CanvasRenderingContext2D, k: number, on: boolean) {
      const c = arena.colors;
      const { x, y } = pads[k];
      const tone = c.p[TONE[k]];
      const t = arena.tone(tone);
      const p = pulse[k];
      const r = padR * (1 + (on ? 0.05 : 0) + 0.06 * p * p);
      if (on) {
        // Soft halo behind the lit pad.
        g.fillStyle = t.glow;
        g.beginPath();
        g.arc(x, y, r + 8, 0, Math.PI * 2);
        g.fill();
      }
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
        // A glossy top and a bright rim.
        g.fillStyle = t.hi;
        g.globalAlpha = 0.6;
        g.beginPath();
        g.ellipse(x - r * 0.3, y - r * 0.55, r * 0.34, r * 0.16, -0.5, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = tone;
        g.lineWidth = arena.lw * 1.5;
        g.beginPath();
        g.arc(x, y, r + 5, 0, Math.PI * 2);
        g.stroke();
      }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
      // Lit: a dark glyph on the bright pad (it reads on yellow in both themes); unlit: the glyph in its colour.
      g.fillStyle = on ? c.coal : tone;
      g.strokeStyle = on ? c.coal : c.ink;
      glyphPath(g, TONE[k], x, y - r * 0.08, r * 0.44);
      g.fill();
      g.stroke();
      g.fillStyle = on ? c.coal : c.ink;
      g.font = `800 ${Math.round(Math.max(9, r * 0.26))}px ${arena.family}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(k + 1), x, y + r * 0.7);
      // Hint (a combo reward): the pad to tap next breathes a dashed halo on your turn.
      if (s.hint > 0 && s.phase === 'input' && wanted(s) === k) {
        g.strokeStyle = c.accent;
        g.lineWidth = arena.lw * 1.4;
        g.globalAlpha = 0.55 + 0.35 * Math.sin(arena.time * 6);
        g.setLineDash([4, 4]);
        g.beginPath();
        g.arc(x, y, r + 9, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
    }

    /** The prompt above the pads: what to do right now, and in which colour. */
    function banner(): [string, string] {
      const c = arena.colors;
      if (end === 'win') return [L('All rounds cleared!', 'Toutes les rondes réussies!'), c.good];
      if (end === 'lose') return [L('Out of hearts', 'Plus de cœurs'), c.bad];
      switch (s.phase) {
        case 'input':
          return [s.kind === 'reverse' ? L('Your turn: backwards!', 'À vous : à rebours!') : L('Your turn!', 'À vous!'), c.fg];
        case 'good':
          return [perfect ? L('Perfect!', 'Parfait!') : L('Got it!', 'Réussi!'), c.good];
        case 'bad':
          return [
            s.got < 0 ? L('Too slow! Watch again', 'Trop lent! Regardez encore') : L('Oops! Watch again', 'Oups! Regardez encore'),
            c.bad,
          ];
        default:
          return [s.slow > 0 ? L('Watch… (slow)', 'Regardez… (lent)') : L('Watch…', 'Regardez…'), c.muted];
      }
    }

    /** Combo rewards around the hub: a shield bubble, the ×2 badge (rounds left), the combo meter. */
    function drawRewards(g: CanvasRenderingContext2D, good: boolean) {
      const c = arena.colors;
      if (s.shield) {
        g.strokeStyle = c.p[5];
        g.lineWidth = arena.lw * 1.6;
        g.globalAlpha = 0.7 + 0.2 * Math.sin(arena.time * 4);
        g.beginPath();
        g.arc(MID, CY, hubR + 9, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      if (s.dbl > 0 && !good) {
        const bx = MID + hubR * 0.85;
        const by = CY - hubR * 0.85;
        arena.disc(g, bx, by, 11, c.p[3]);
        g.fillStyle = c.coal;
        g.font = `900 11px ${arena.family}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('×2', bx, by + 0.5);
        for (let i = 0; i < s.dbl; i++) arena.disc(g, bx - 4 + i * 8, by + 15, 2.2, c.p[3]);
      }
      // Combo meter: a thin bar under the prompt, filling towards the next milestone.
      const next = COMBO_TIERS[s.tier] as number | undefined;
      if (s.combo > 0 && next) {
        const prev = s.tier ? COMBO_TIERS[s.tier - 1] : 0;
        g.fillStyle = c.cellAlt;
        g.fillRect(MID - 50, 44, 100, 4);
        g.fillStyle = multOf(s) > 1 ? c.p[3] : c.accent;
        g.fillRect(MID - 50, 44, (100 * (s.combo - prev)) / (next - prev), 4);
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 25, 0, false);
      const on = lit(s);
      const fake = ghost(s);
      for (let k = 0; k < n; k++) {
        drawPad(g, k, k === on || (k === tapped.pad && tapped.t > 0));
        if (k === fake) drawGhost(g, k);
      }

      // Hub: the round number, coloured by the phase, with the idle clock around it on your turn.
      const good = s.phase === 'good' || end === 'win';
      const bad = s.phase === 'bad' || end === 'lose';
      const hub = good ? c.good : bad ? c.bad : s.phase === 'input' ? c.accent : c.cellAlt;
      const hr = hubR * (s.phase === 'good' ? 1 + 0.1 * Math.max(0, 1 - s.t * 4) : 1);
      if (arena.sh) {
        g.fillStyle = c.drop;
        g.beginPath();
        g.arc(MID + arena.sh * 0.6, CY + arena.sh * 0.6, hr, 0, Math.PI * 2);
        g.fill();
      }
      arena.disc(g, MID, CY, hr, hub);
      g.fillStyle = hub === c.cellAlt ? c.fg : c.coal;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `800 ${Math.round(hubR * 0.72)}px ${arena.family}`;
      g.fillText(String(s.round), MID, CY - hubR * 0.12);
      g.font = `700 ${Math.round(Math.max(8, hubR * 0.3))}px ${arena.family}`;
      g.globalAlpha = 0.7;
      g.fillText(`/${s.rounds}`, MID, CY + hubR * 0.5);
      g.globalAlpha = 1;
      if (s.phase === 'input' && s.t > IDLE_WARN) {
        const left = Math.max(0, 1 - (s.t - IDLE_WARN) / (IDLE_S - IDLE_WARN));
        g.strokeStyle = left < 0.4 ? c.bad : c.fg;
        g.lineWidth = arena.lw * 1.4;
        g.lineCap = 'round';
        g.beginPath();
        g.arc(MID, CY, hubR + 4, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
        g.stroke();
        g.lineCap = 'butt';
      }
      drawRewards(g, good);

      // After a slip, ring the pad you should have tapped and cross the one you did.
      if (s.phase === 'bad' && s.want >= 0) {
        const { x, y } = pads[s.want];
        g.strokeStyle = c.fg;
        g.lineWidth = arena.lw * 1.2;
        g.setLineDash([6, 4]);
        g.lineDashOffset = -arena.time * 20;
        g.beginPath();
        g.arc(x, y, padR + 7, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.lineDashOffset = 0;
      }
      if (s.phase === 'bad' && s.got >= 0) {
        const { x, y } = pads[s.got];
        const k = padR * 0.32;
        g.lineCap = 'round';
        for (const [col, w] of [
          [c.cell, 3.2],
          [c.bad, 1.8],
        ] as const) {
          g.strokeStyle = col;
          g.lineWidth = arena.lw * w;
          g.beginPath();
          g.moveTo(x - k, y - k);
          g.lineTo(x + k, y + k);
          g.moveTo(x + k, y - k);
          g.lineTo(x - k, y + k);
          g.stroke();
        }
        g.lineCap = 'butt';
      }

      // The prompt pops in at each phase change.
      const [text, col] = banner();
      const pop = s.phase === 'intro' || s.phase === 'done' ? 1 : outBack(Math.min(1, s.t * 5));
      g.save();
      g.translate(MID, 26);
      g.scale(pop, pop);
      g.font = `800 20px ${arena.family}`;
      g.lineJoin = 'round';
      g.strokeStyle = c.cellAlt;
      g.lineWidth = 5;
      g.strokeText(text, 0, 0);
      g.fillStyle = col;
      g.fillText(text, 0, 0);
      g.restore();

      // Step pips: grey as the playback goes, in the pad's colour as you tap them back.
      const len = lenOf(s);
      const pr = Math.min(7, (W - 40) / len / 2 - 3);
      const gap = pr * 2 + 6;
      const x0 = MID - ((len - 1) * gap) / 2;
      const py = H - 20;
      const bi = beatIndex(s);
      const played = bi < 0 ? -1 : playback(s).filter((b, j) => j <= bi && !b.fake).length - 1;
      const back = s.kind === 'reverse';
      for (let i = 0; i < len; i++) {
        const x = x0 + i * gap;
        const done = good || (s.phase === 'input' && (back ? i >= len - s.pos : i < s.pos));
        if (done) arena.ball(g, x, py, pr, c.p[TONE[taps[i] ?? s.seq[i]]], false);
        else if (i <= played) arena.ball(g, x, py, pr, c.muted, false);
        else {
          g.strokeStyle = c.muted;
          g.lineWidth = arena.lw * 0.7;
          g.beginPath();
          g.arc(x, py, pr * 0.8, 0, Math.PI * 2);
          g.stroke();
        }
        const gi = s.gold.indexOf(i);
        if (gi >= 0 && !s.goldGot[gi]) {
          // A golden step: a little star over its pip.
          g.fillStyle = c.p[3];
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.5;
          glyphPath(g, 4, x, py - pr - 5, 3.6);
          g.fill();
          g.stroke();
        }
        if (s.phase === 'input' && i === wantIndex(s)) {
          g.strokeStyle = c.fg;
          g.lineWidth = arena.lw * 0.8;
          g.beginPath();
          g.arc(x, py, pr + 2.5 + Math.sin(arena.time * 8), 0, Math.PI * 2);
          g.stroke();
        }
      }
      arena.overlay(g);
    }

    function report(out: PressResult, gain = 0) {
      if (!out) return;
      const c = arena.colors;
      ctx.score(s.score);
      if (out === 'shield') {
        // The shield pops instead of a heart; carry on from the same step.
        fx.ring(MID, CY, c.p[5], hubR + 9, ring, 0.45, arena.lw * 1.4);
        fx.text(MID, CY - hubR - 10, L('Shield!', 'Bouclier!'), c.p[5], 15, 0.9);
        fx.shake(2, 0.2);
        haptic(25);
        if (s.got >= 0) fx.burst(pads[s.got].x, pads[s.got].y, c.muted, 8, 100, 2.5, 0.4, 'spark', 0);
      }
      if (s.unlocked) {
        comboTier(fx, s.fired, c.p[3], POWER_NAMES[s.unlocked]());
        if (s.unlocked === 'heart') ctx.lives(s.lives, max);
        s.unlocked = '';
      }
      if (out === 'slip' || out === 'lose') {
        ctx.lives(s.lives, max);
        fx.shake(4, 0.3);
        fx.flash(c.bad, 0.22, 0.35);
        haptic(40);
        taps = [];
        if (s.got >= 0) fx.burst(pads[s.got].x, pads[s.got].y, c.bad, 10, 120, 3, 0.45, 'spark', 0);
      }
      if (out === 'round' || out === 'win') {
        perfect = s.slips === 0;
        fx.burst(MID, CY, c.good, 12, 120, 3, 0.55, 'dot', 0);
        fx.ring(MID, CY, c.good, hubR * 0.6, hubR * 1.8, 0.4, arena.lw);
        if (gain > 0) fx.text(MID, CY - hubR - 8, `+${gain}`, perfect ? c.accent : c.fg, perfect ? 16 : 14);
      }
      if (out === 'win') {
        end = 'win';
        for (let k = 0; k < n; k++) fx.burst(pads[k].x, pads[k].y, c.p[TONE[k]], 10, 170, 4, 0.9, 'square', 200);
        fx.ring(MID, CY, c.good, hubR, ring + padR, 0.6, arena.lw * 1.5);
        fx.flash(c.good, 0.2, 0.5);
      } else if (out === 'lose') end = 'lose';
      if (end) arena.linger(1.6);
      status();
      draw();
      if (out === 'win') ctx.win();
      else if (out === 'lose') ctx.lose();
    }

    function tap(k: number) {
      if (s.phase !== 'input') return;
      tapped = { pad: k, t: TAP_S };
      pulse[k] = 1;
      const before = s.score;
      const at = s.pos;
      const out = press(s, k);
      if (out === 'slip' || out === 'lose' || out === 'shield') sfx('error');
      else {
        const tone = arena.colors.p[TONE[k]];
        taps[s.kind === 'reverse' ? lenOf(s) - at - 1 : at] = k;
        comboPop(fx, pads[k].x, pads[k].y - padR * 0.6, s.combo, multOf(s) > 1 ? arena.colors.p[3] : arena.colors.accent);
        sfx('combo', { step: k + 1 });
        fx.ring(pads[k].x, pads[k].y, tone, padR * 0.8, padR * 1.3, 0.3, arena.lw * 1.2);
        fx.burst(pads[k].x, pads[k].y, arena.tone(tone).hi, 6, 90, 2.5, 0.35, 'dot', 0);
      }
      if (out === 'round' || out === 'win') sfx('power');
      report(out, s.score - before);
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 12,
      onDown(p) {
        // The nearest pad within reach (a little past its rim, so thumbs don't miss).
        let best = -1;
        let bd = padR * 1.18;
        pads.forEach((q, k) => {
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d <= bd) [best, bd] = [k, d];
        });
        if (best >= 0) tap(best);
      },
    });

    ctx.score(0);
    ctx.lives(s.lives, max);
    status();
    return {
      draw,
      frame(dt) {
        const phase = s.phase;
        const ev = step(s, dt);
        arena.update(dt);
        for (let k = 0; k < n; k++) {
          pulse[k] = Math.max(0, pulse[k] - dt * 5);
          // Glide towards the pad's slot (pads trade places between rounds on a shuffle level).
          const to = slots[s.slot[k]];
          const f = Math.min(1, dt * 6);
          pads[k].x += (to.x - pads[k].x) * f;
          pads[k].y += (to.y - pads[k].y) * f;
        }
        if (ev.phase && s.phase === 'show') taps = [];
        if (s.phase === 'show') {
          const i = beatIndex(s);
          const k = lit(s);
          if (i !== heard && k >= 0) {
            heard = i;
            pulse[k] = 1;
            sfx('combo', { step: k + 1 });
            fx.ring(pads[k].x, pads[k].y, arena.colors.p[TONE[k]], padR, padR * 1.35, 0.35, arena.lw * 1.2);
          } else if (i !== heard && ghost(s) >= 0) {
            // A decoy: a flat buzz, no ring.
            heard = i;
            sfx('tick', { vol: 0.5, pitch: -3 });
          }
        } else heard = -1;
        // The last seconds of the idle clock tick.
        if (s.phase === 'input') {
          const left = Math.ceil(IDLE_S - s.t);
          if (left <= 3 && left !== ticked) sfx('tick', { vol: 0.5, pitch: 4 - left });
          ticked = left;
        } else ticked = -1;
        if (phase === 'show' && s.phase === 'input') sfx('tick', { vol: 0.4, pitch: 7 });
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
