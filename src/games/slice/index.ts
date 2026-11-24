import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { keyDir } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { haptic, sfx } from '../../kits/sound/sound';
import { KIND_NAMES, POWER_NAMES } from './names';
import {
  COMBO_POINTS,
  createLevel,
  DOUBLE_S,
  drag,
  FRUIT_POINTS,
  fruitsFor,
  GOLD_POINTS,
  H,
  LIFE_BONUS,
  LIVES,
  type Piece,
  press,
  release,
  SLOW,
  SLOW_S,
  step,
  STREAK_TIERS,
  toCome,
  TOUGH_POINTS,
  toughFor,
  W,
} from './rules';

/** Seconds a blade trail point lasts. */
const TRAIL_S = 0.2;
/** Seconds a juice stain stays on the field. */
const SPLAT_S = 1.6;
/** Glyph of the bomb's fuse spark (four-point star). */
const SPARK = 7;

interface Half {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  k: number;
  /** The cut line's angle; this half is the side `side` (±1) of it. */
  a: number;
  side: number;
  rot: number;
  spin: number;
}

interface Splat {
  x: number;
  y: number;
  r: number;
  k: number;
  a: number;
  t: number;
}

const round10 = (n: number) => Math.round(n / 10) * 10;
const base = (d: Parameters<GameDef['stars']>[0]) => fruitsFor(d) * FRUIT_POINTS + toughFor(d) * (TOUGH_POINTS - FRUIT_POINTS);

export const slice: GameDef = {
  id: 'slice',
  get name() {
    return L('Slice', 'Tranchez');
  },
  get rules() {
    return L('Swipe to slice the fruit. Never the bombs!', 'Glissez pour trancher les fruits, jamais les bombes!');
  },
  category: 'reflex',
  help: () => ({
    goal: L(
      'Slice every fruit tossed up in the run, keeping at least one heart.',
      'Tranchez tous les fruits lancés pendant la partie en gardant au moins un cœur.',
    ),
    steps: [
      L(
        'Fruit is tossed up from below: slice it before it falls back out. Each one you miss costs a heart.',
        'Des fruits sont lancés d’en bas : tranchez-les avant qu’ils retombent. Chaque fruit raté coûte un cœur.',
      ),
      L(
        'Dark bombs with a lit fuse must not be sliced: each costs a heart, and on Master it ends the run.',
        'Ne tranchez pas les bombes foncées à la mèche allumée : chacune coûte un cœur, et en Maître elle termine la partie.',
      ),
      L(
        `Fruit with a thick rind needs two cuts. Bonus fruit: gold is worth ${GOLD_POINTS}, frost slows time. Missing them is free.`,
        `Les fruits à l’écorce épaisse demandent deux coupes. Fruits bonus : l’or vaut ${GOLD_POINTS}, le givre ralentit le temps. Les rater ne coûte rien.`,
      ),
      L('Swipe quickly across the fruit: a slow drag doesn’t cut.', 'Glissez vite à travers les fruits : un glissement lent ne coupe pas.'),
      L(
        'Keyboard: arrows or WASD move the blade; hold Space while moving to slice. P to pause.',
        'Clavier : flèches ou WASD pour déplacer la lame; maintenez Espace en bougeant pour trancher. P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Several fruit in one stroke is a combo: +${COMBO_POINTS} more for each extra fruit.`,
        `Plusieurs fruits d’un seul trait font un combo : +${COMBO_POINTS} de plus par fruit supplémentaire.`,
      ),
      L(
        `Slice without missing or touching a bomb to build a streak: at ${STREAK_TIERS[0]} you get slow motion, at ${STREAK_TIERS[1]} a fruit frenzy, then a bomb shield, then double points.`,
        `Tranchez sans rater ni toucher de bombe pour bâtir une série : à ${STREAK_TIERS[0]}, le ralenti, à ${STREAK_TIERS[1]}, une frénésie de fruits, puis un bouclier anti-bombe et les points doublés.`,
      ),
      L(
        `Fruit tops out and hangs for a moment: the easiest time to slice. Each heart left is worth ${LIFE_BONUS}.`,
        `Les fruits ralentissent au sommet de leur course : c’est le meilleur moment. Chaque cœur restant vaut ${LIFE_BONUS}.`,
      ),
    ],
  }),
  // Streak rewards (frenzy fruit, double points) are part of a good run's score, so the goals scale with the base.
  stars: (d) => {
    const b = base(d);
    return [round10(b * 1.4) + 2 * LIFE_BONUS, round10(b * 2.3) + 3 * LIFE_BONUS];
  },
  // A little longer than the throws: slow motion stretches the run.
  par: (d) => byLevel(d, [28, 28, 28, 26, 26]),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const held = new Set<number>();
    let trail: { x: number; y: number; t: number }[] = [];
    let halves: Half[] = [];
    let splats: Splat[] = [];
    let keyboard = false;
    let shown = '';
    let ended = false;

    const status = () => {
      const text = [
        P(s.sliced, ['slice', 'slices'], ['tranche', 'tranches']),
        P(toCome(s), ['fruit to come', 'fruit to come'], ['fruit à venir', 'fruits à venir']),
        s.chain > 1 ? `combo ×${s.chain}` : '',
        s.streak > 2 ? L(`streak ${s.streak}`, `série ${s.streak}`) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (text !== shown) ctx.status((shown = text));
    };

    const fill = (k: number) => arena.colors.p[k];

    /** A whole fruit: a glossy ball, its glyph, a stem and leaf that tumble with it. */
    function fruit(g: CanvasRenderingContext2D, p: Piece) {
      const c = arena.colors;
      const t = arena.tone(fill(p.k));
      if (p.kind === 'gold') {
        // Turning rays behind it, so it reads as a prize.
        g.save();
        g.translate(p.x, p.y);
        g.rotate(arena.time * 1.5);
        g.fillStyle = t.glow;
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          g.moveTo(0, 0);
          g.arc(0, 0, p.r * 1.9, a - 0.16, a + 0.16);
        }
        g.fill();
        g.restore();
      } else if (p.kind === 'frost') {
        g.fillStyle = arena.tone(c.paper).glow;
        g.beginPath();
        g.arc(p.x, p.y, p.r * 1.3, 0, Math.PI * 2);
        g.fill();
      }
      arena.ball(g, p.x, p.y, p.r, fill(p.k));
      if (p.kind === 'frost') {
        snowflake(g, p.x, p.y, p.r * 0.62, p.rot);
        return;
      }
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      if (p.kind === 'tough') {
        // A thick, studded rind; cracked once it has taken a cut.
        g.strokeStyle = t.edge;
        g.lineWidth = arena.lw * 0.9;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.arc(0, 0, p.r * 0.78, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        if (p.hp < 2) {
          g.lineWidth = arena.lw;
          g.beginPath();
          g.moveTo(-p.r * 0.9, -p.r * 0.2);
          g.lineTo(-p.r * 0.35, p.r * 0.1);
          g.lineTo(0, -p.r * 0.25);
          g.lineTo(p.r * 0.35, p.r * 0.15);
          g.lineTo(p.r * 0.9, -p.r * 0.05);
          g.stroke();
        }
      }
      g.fillStyle = p.kind === 'gold' ? c.paper : t.hi;
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.5;
      glyphPath(g, p.kind === 'gold' ? SPARK : p.k, 0, p.r * 0.1, p.r * (p.kind === 'gold' ? 0.5 : 0.38));
      g.fill();
      g.stroke();
      // Stem and leaf.
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(0, -p.r * 0.9);
      g.lineTo(p.r * 0.08, -p.r * 1.2);
      g.stroke();
      g.lineCap = 'butt';
      g.fillStyle = c.good;
      g.beginPath();
      g.ellipse(p.r * 0.3, -p.r * 1.1, p.r * 0.26, p.r * 0.12, -0.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
    }

    /** Six ice spokes with little branches (frost fruit, the slow-motion badge). */
    function snowflake(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
      const c = arena.colors;
      g.save();
      g.translate(x, y);
      g.rotate(rot * 0.3);
      g.lineCap = 'round';
      for (const [col, w] of [
        [arena.tone(fill(5)).edge, arena.lw * 1.6 + 1.5],
        [c.paper, Math.max(1.2, arena.lw * 0.9)],
      ] as const) {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          g.moveTo(0, 0);
          g.lineTo(ca * r, sa * r);
          const bx = ca * r * 0.6;
          const by = sa * r * 0.6;
          for (const side of [-1, 1]) {
            const b = a + side * 0.7;
            g.moveTo(bx, by);
            g.lineTo(bx + Math.cos(b) * r * 0.3, by + Math.sin(b) * r * 0.3);
          }
        }
        g.stroke();
      }
      g.lineCap = 'butt';
      g.restore();
    }

    /** A bomb: a dark ball with a band, a fuse and a flickering spark. */
    function bomb(g: CanvasRenderingContext2D, p: Piece) {
      const c = arena.colors;
      arena.ball(g, p.x, p.y, p.r, c.coal);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot * 0.4);
      arena.box(g, -p.r * 0.3, -p.r * 1.12, p.r * 0.6, p.r * 0.3, c.bad, 1.5, false);
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw;
      g.beginPath();
      g.moveTo(0, -p.r * 1.12);
      g.quadraticCurveTo(p.r * 0.1, -p.r * 1.5, p.r * 0.45, -p.r * 1.5);
      g.stroke();
      const flick = 0.75 + 0.35 * Math.sin(arena.time * 31 + p.x);
      g.fillStyle = c.accent;
      g.strokeStyle = c.bad;
      g.lineWidth = arena.lw * 0.5;
      glyphPath(g, SPARK, p.r * 0.45, -p.r * 1.5, p.r * 0.42 * flick);
      g.fill();
      g.stroke();
      g.restore();
    }

    /** Half a fruit, seen from its cut face. */
    function half(g: CanvasRenderingContext2D, h: Half) {
      const t = arena.tone(fill(h.k));
      const a0 = h.a + h.rot + (h.side > 0 ? 0 : Math.PI);
      g.save();
      g.translate(h.x, h.y);
      g.fillStyle = t.base;
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.arc(0, 0, h.r, a0, a0 + Math.PI);
      g.closePath();
      g.fill();
      g.fillStyle = t.hi;
      g.beginPath();
      g.arc(0, 0, h.r * 0.78, a0, a0 + Math.PI);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(0, 0, h.r, a0, a0 + Math.PI);
      g.closePath();
      g.stroke();
      g.restore();
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);
      // Juice stains, fading.
      for (const sp of splats) {
        g.globalAlpha = 0.3 * Math.max(0, 1 - (arena.time - sp.t) / SPLAT_S);
        g.fillStyle = fill(sp.k);
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = sp.a + i * 1.05;
          const d = sp.r * (0.35 + 0.35 * ((i * 7) % 3));
          const x = sp.x + Math.cos(a) * d;
          const y = sp.y + Math.sin(a) * d;
          g.moveTo(x + sp.r * 0.4, y);
          g.arc(x, y, sp.r * (0.25 + 0.08 * (i % 3)), 0, Math.PI * 2);
        }
        g.moveTo(sp.x + sp.r * 0.6, sp.y);
        g.arc(sp.x, sp.y, sp.r * 0.6, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      // Progress along the top: fruit thrown so far.
      const f = 1 - toCome(s) / s.total;
      arena.box(g, 10, 8, W - 20, 9, c.cellAlt, 4.5, false);
      if (f > 0) {
        g.fillStyle = c.accent;
        g.beginPath();
        g.roundRect(10, 8, Math.max(9, (W - 20) * f), 9, 4.5);
        g.fill();
      }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.7;
      g.beginPath();
      g.roundRect(10, 8, W - 20, 9, 4.5);
      g.stroke();
      drawStreak(g);

      for (const h of halves) half(g, h);
      for (const p of s.live) {
        if (p.kind === 'bomb') bomb(g, p);
        else fruit(g, p);
      }
      // The blade's trail: a tapering streak, dull when too slow to cut.
      const now = arena.time;
      const sharp = s.hot > 0;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      // Three passes (outline, colour, bright core) so the segments join into one smooth streak.
      const col = sharp ? c.accent : c.muted;
      for (let pass = 0; pass < 3; pass++) {
        g.strokeStyle = pass === 0 ? arena.tone(col).edge : pass === 1 ? col : c.paper;
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1];
          const b = trail[i];
          const k = Math.max(0, 1 - (now - b.t) / TRAIL_S);
          if (k <= 0) continue;
          g.lineWidth = pass === 0 ? 8 * k + arena.lw : pass === 1 ? 8 * k : 2.5 * k;
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
      }
      g.lineCap = 'butt';
      // A shielded blade wears a ring.
      if (s.shield > 0 && s.down && !ended) {
        g.strokeStyle = c.good;
        g.lineWidth = arena.lw * 1.4;
        g.beginPath();
        g.arc(s.bx, s.by, 11 + Math.sin(arena.time * 8), 0, Math.PI * 2);
        g.stroke();
      }
      if (keyboard && !ended) {
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw;
        g.fillStyle = s.down ? c.accent : c.paper;
        g.beginPath();
        g.arc(s.bx, s.by, 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      arena.overlay(g);
    }

    /** Streak meter under the progress bar (fills towards the next milestone) and badges for active powers. */
    function drawStreak(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      if (s.slow > 0) {
        // A frosty tint while time runs slow.
        g.globalAlpha = 0.12 * Math.min(1, s.slow / 0.5);
        g.fillStyle = fill(5);
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
      const lo = s.tier ? STREAK_TIERS[s.tier - 1] : 0;
      const hi = STREAK_TIERS[Math.min(s.tier, STREAK_TIERS.length - 1)];
      const k = s.tier >= STREAK_TIERS.length ? 1 : Math.max(0, Math.min(1, (s.streak - lo) / (hi - lo)));
      if (s.streak > 0 && !ended) {
        g.fillStyle = c.accent;
        g.globalAlpha = 0.85;
        g.fillRect(14, 20, (W - 28) * k, 3);
        g.globalAlpha = 1;
      }
      // Badges, top left: what's running and for how long.
      const badges: [label: string, col: string, left: number][] = [];
      if (s.slow > 0) badges.push(['', fill(5), s.slow / SLOW_S]);
      if (s.double > 0) badges.push(['×2', c.accent, s.double / DOUBLE_S]);
      if (s.shield > 0) badges.push(['', c.good, 1]);
      let x = 12;
      for (const [label, col, left] of badges) {
        arena.box(g, x, 28, 30, 18, c.cell, 6, false);
        g.fillStyle = col;
        g.fillRect(x + 3, 41, 24 * Math.max(0, Math.min(1, left)), 2.5);
        if (col === c.good) {
          // A little shield.
          g.fillStyle = col;
          g.strokeStyle = arena.tone(col).edge;
          g.lineWidth = arena.lw * 0.6;
          g.beginPath();
          g.moveTo(x + 15, 31);
          g.lineTo(x + 21, 33);
          g.quadraticCurveTo(x + 21, 39, x + 15, 41);
          g.quadraticCurveTo(x + 9, 39, x + 9, 33);
          g.closePath();
          g.fill();
          g.stroke();
        } else if (label) {
          g.fillStyle = col;
          g.font = `900 11px ${arena.family}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(label, x + 15, 35.5);
          g.textBaseline = 'alphabetic';
        } else snowflake(g, x + 15, 35.5, 5.5, 0);
        x += 36;
      }
    }

    function addTrail(x: number, y: number) {
      trail.push({ x, y, t: arena.time });
      if (trail.length > 40) trail.shift();
    }

    const cv = arena.canvas;
    const down = (e: PointerEvent) => {
      cv.setPointerCapture?.(e.pointerId);
      const p = arena.toWorld(e);
      keyboard = false;
      press(s, p.x, p.y);
      trail = [{ ...p, t: arena.time }];
    };
    const move = (e: PointerEvent) => {
      if (!s.down) return;
      const p = arena.toWorld(e);
      drag(s, p.x, p.y);
      addTrail(p.x, p.y);
    };
    const up = () => release(s);
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);

    const syncKeys = () => {
      s.kx = (held.has(1) ? 1 : 0) - (held.has(3) ? 1 : 0);
      s.ky = (held.has(2) ? 1 : 0) - (held.has(0) ? 1 : 0);
    };

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const lives = s.lives;
        const score = s.score;
        const wdt = s.slow > 0 ? dt * SLOW : dt;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        if (keyboard && s.down) addTrail(s.bx, s.by);
        trail = trail.filter((p) => arena.time - p.t < TRAIL_S);
        for (const h of halves) {
          h.vy += s.g * wdt;
          h.x += h.vx * wdt;
          h.y += h.vy * wdt;
          h.rot += h.spin * wdt;
        }
        halves = halves.filter((h) => h.y - h.r < H + 10);
        splats = splats.filter((sp) => arena.time - sp.t < SPLAT_S);

        for (const cut of ev.cuts) {
          const p = cut.p;
          const col = fill(p.k);
          sfx('cut', { pitch: Math.min(6, cut.chain - 1) });
          sfx(cut.chain > 1 ? 'combo' : 'pop', { step: cut.chain, vol: 0.7 });
          // Two halves fly apart across the cut line.
          const nx = -Math.sin(cut.angle);
          const ny = Math.cos(cut.angle);
          for (const side of [1, -1])
            halves.push({
              x: p.x + nx * side * 2,
              y: p.y + ny * side * 2,
              vx: p.vx * 0.6 + nx * side * 70,
              vy: Math.min(p.vy, 0) * 0.4 + ny * side * 70 - 40,
              r: p.r,
              k: p.k,
              a: cut.angle,
              side,
              rot: 0,
              spin: side * 3,
            });
          if (halves.length > 24) halves.splice(0, halves.length - 24);
          splats.push({ x: p.x, y: p.y, r: p.r * 1.2, k: p.k, a: cut.angle, t: arena.time });
          if (splats.length > 10) splats.shift();
          fx.burst(p.x, p.y, col, 14, 150, 3.5, 0.55, 'dot', 300);
          fx.burst(p.x, p.y, arena.tone(col).hi, 6, 120, 2.5, 0.4, 'spark', 0, cut.angle, 0.5);
          fx.ring(p.x, p.y, col, p.r * 0.5, p.r * 1.6, 0.3, arena.lw);
          fx.text(
            p.x,
            p.y - p.r,
            `+${cut.points}`,
            cut.chain > 1 || p.kind === 'gold' ? c.accent : c.fg,
            cut.chain > 1 || p.kind === 'gold' ? 13 : 11,
          );
          if (p.kind === 'gold') {
            fx.burst(p.x, p.y, c.accent, 16, 200, 3, 0.7, 'spark', 0);
            fx.ring(p.x, p.y, c.accent, p.r, p.r * 4, 0.45, arena.lw * 1.5);
            sfx('coin');
          } else if (p.kind === 'frost') {
            fx.text(p.x, p.y - p.r - 16, POWER_NAMES.slow(), fill(5), 14, 1);
            fx.flash(fill(5), 0.2, 0.4);
            fx.ring(p.x, p.y, c.paper, p.r, W, 0.6, arena.lw * 2);
            sfx('power', { pitch: -3 });
          }
        }
        const best = ev.cuts.reduce((m, cut) => Math.max(m, cut.chain), 0);
        if (best >= 2 && ev.cuts.length) {
          const last = ev.cuts[ev.cuts.length - 1].p;
          fx.text(Math.max(50, Math.min(W - 50, last.x)), Math.max(40, last.y - last.r - 22), `combo ×${best}`, c.accent, 16, 1);
          fx.shake(1.5 + best * 0.5, 0.2);
        } else if (ev.cuts.length && s.streak >= 3) {
          const last = ev.cuts[ev.cuts.length - 1].p;
          comboPop(fx, Math.max(30, Math.min(W - 30, last.x)), Math.max(40, last.y - last.r - 10), s.streak, c.accent);
        }
        if (ev.tier && ev.unlocked) {
          comboTier(fx, ev.tier, c.accent, POWER_NAMES[ev.unlocked]());
          if (ev.unlocked === 'frenzy')
            for (let i = 0; i < 5; i++) fx.burst(30 + i * 60, H, c.p[i], 6, 160, 3, 0.5, 'dot', 200, -Math.PI / 2, 0.6);
          if (ev.unlocked === 'slow') fx.ring(W / 2, H / 2, fill(5), 10, W * 0.7, 0.6, arena.lw * 2);
          if (ev.unlocked === 'shield') fx.ring(s.bx, s.by, c.good, 6, 40, 0.5, arena.lw * 1.5);
        }
        for (const p of ev.defused) {
          sfx('hit', { pitch: 7 });
          fx.ring(p.x, p.y, c.good, p.r, p.r * 3, 0.45, arena.lw * 2);
          fx.burst(p.x, p.y, c.good, 12, 140, 3, 0.5, 'spark', 0);
          fx.text(p.x, p.y - p.r - 6, L('Defused!', 'Désamorcée!'), c.good, 14, 1);
        }
        for (const p of ev.cracked) {
          sfx('hit', { pitch: 4, vol: 0.7 });
          fx.burst(p.x, p.y, arena.tone(fill(p.k)).edge, 8, 110, 3, 0.4, 'square', 200);
          fx.ring(p.x, p.y, c.fg, p.r, p.r * 1.5, 0.25, arena.lw);
        }
        for (const p of ev.booms) {
          sfx('boom');
          haptic(40);
          fx.burst(p.x, p.y, c.coal, 18, 190, 4.5, 0.7);
          fx.burst(p.x, p.y, c.bad, 12, 220, 3, 0.5, 'spark', 0);
          fx.ring(p.x, p.y, c.bad, p.r, p.r * 5, 0.5, arena.lw * 2);
          fx.shake(8, 0.45);
          fx.flash(c.bad, 0.4, 0.4);
        }
        for (const p of ev.missed) {
          const x = Math.max(16, Math.min(W - 16, p.x));
          fx.burst(x, H - 4, c.bad, 10, 130, 3, 0.45, 'square', 300, -Math.PI / 2, Math.PI * 0.6);
          fx.text(x, H - 28, '✕', c.bad, 24, 1);
          fx.ring(x, H, c.bad, 6, 34, 0.4, arena.lw * 1.4);
          fx.shake(4, 0.3);
          fx.flash(c.bad, 0.22, 0.3);
        }
        // Fuse sparks.
        for (const p of s.live)
          if (p.kind === 'bomb' && Math.sin(arena.time * 23 + p.x) > 0.8)
            fx.burst(p.x + p.r * 0.45, p.y - p.r * 1.5, c.accent, 1, 50, 2, 0.25, 'spark', 0);
        if (s.score !== score) ctx.score(s.score);
        if (s.lives !== lives) ctx.lives(s.lives, LIVES);
        status();
        if (ev.won) {
          ended = true;
          for (let i = 0; i < 5; i++) fx.burst(W / 2, H / 2, c.p[i], 10, 200, 4, 0.9, 'square', 220);
          fx.ring(W / 2, H / 2, c.good, 10, 120, 0.6, arena.lw * 1.5);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          arena.linger();
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const dir = keyDir(e.key);
        const space = e.key === ' ';
        if (dir === -1 && !space) return false;
        keyboard = true;
        if (space) {
          if (e.type === 'keydown' && !e.repeat) {
            press(s, s.bx, s.by);
            trail = [{ x: s.bx, y: s.by, t: arena.time }];
          } else if (e.type === 'keyup') release(s);
          return true;
        }
        if (e.type === 'keydown') held.add(dir);
        else held.delete(dir);
        syncKeys();
        return true;
      },
      destroy() {
        cv.removeEventListener('pointerdown', down);
        cv.removeEventListener('pointermove', move);
        cv.removeEventListener('pointerup', up);
        cv.removeEventListener('pointercancel', up);
        arena.destroy();
      },
    };
  },
};
