import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { keyDir } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  COMBO_POINTS,
  createLevel,
  drag,
  FRUIT_POINTS,
  fruitsFor,
  H,
  LIFE_BONUS,
  LIVES,
  type Piece,
  press,
  release,
  step,
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
      L('Fruit with a thick rind needs two cuts.', 'Les fruits à l’écorce épaisse demandent deux coupes.'),
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
        `Fruit tops out and hangs for a moment: the easiest time to slice. Each heart left is worth ${LIFE_BONUS}.`,
        `Les fruits ralentissent au sommet de leur course : c’est le meilleur moment. Chaque cœur restant vaut ${LIFE_BONUS}.`,
      ),
    ],
  }),
  stars: (d) => {
    const b = base(d);
    return [b + 2 * LIFE_BONUS, b + 3 * LIFE_BONUS + Math.ceil(fruitsFor(d) / 10) * COMBO_POINTS];
  },
  par: (d) => byLevel(d, [25, 25, 25, 23, 23]),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
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
      arena.ball(g, p.x, p.y, p.r, fill(p.k));
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
      g.fillStyle = t.hi;
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.5;
      glyphPath(g, p.k, 0, p.r * 0.1, p.r * 0.38);
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
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        if (keyboard && s.down) addTrail(s.bx, s.by);
        trail = trail.filter((p) => arena.time - p.t < TRAIL_S);
        for (const h of halves) {
          h.vy += s.g * dt;
          h.x += h.vx * dt;
          h.y += h.vy * dt;
          h.rot += h.spin * dt;
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
          fx.text(p.x, p.y - p.r, `+${cut.points}`, cut.chain > 1 ? c.accent : c.fg, cut.chain > 1 ? 13 : 11);
        }
        const best = ev.cuts.reduce((m, cut) => Math.max(m, cut.chain), 0);
        if (best >= 2 && ev.cuts.length) {
          const last = ev.cuts[ev.cuts.length - 1].p;
          fx.text(Math.max(50, Math.min(W - 50, last.x)), Math.max(40, last.y - last.r - 22), `combo ×${best}`, c.accent, 16, 1);
          fx.shake(1.5 + best * 0.5, 0.2);
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
