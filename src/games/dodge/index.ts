import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena, type Trace } from '../../kits/arena/arena';
import { approach } from '../../kits/arena/ease';
import { gestures, keyDir } from '../../kits/gesture/gesture';
import { sfx } from '../../kits/sound/sound';
import { glyphPath } from '../../kits/glyph/glyph';
import {
  createLevel,
  durationFor,
  H,
  incoming,
  LIFE_BONUS,
  livesFor,
  PICKUP_POINTS,
  PICKUP_R,
  pickupsFor,
  PLAYER_R,
  starsOut,
  step,
  W,
} from './rules';

/** Glyph used for pickups (a five-point star). */
const STAR = 4;

export const dodge: GameDef = {
  id: 'dodge',
  get name() {
    return L('Dodge', 'Esquive');
  },
  get rules() {
    return L('Dodge everything that flies until time runs out.', 'Esquivez tout ce qui vole jusqu’à la fin du temps.');
  },
  category: 'reflex',
  help: () => ({
    goal: L('Stay in one piece until the timer runs out.', 'Tenez bon sans trop de coups jusqu’à la fin du chrono.'),
    steps: [
      L(
        'Blocks fall from the top; later, discs fly in from the sides and bars come down with a gap.',
        'Des blocs tombent du haut; plus tard, des disques arrivent des côtés et des barres descendent avec une ouverture.',
      ),
      L(
        'A hit costs a heart and leaves you safe for a moment (you blink).',
        'Un coup coûte un cœur et vous protège un instant (vous clignotez).',
      ),
      L('Grab the stars for bonus points.', 'Attrapez les étoiles pour des points en prime.'),
      L(
        'Drag anywhere: your dot moves with your finger without hiding under it.',
        'Glissez n’importe où : votre pastille suit votre doigt sans se cacher dessous.',
      ),
      L('Keyboard: arrows or WASD to move, P to pause.', 'Clavier : flèches ou WASD pour bouger, P pour la pause.'),
    ],
    tips: [
      L('Red marks on the edges show what is about to come in.', 'Les marques rouges sur les bords annoncent ce qui s’en vient.'),
      L(
        `10 points per second, ${PICKUP_POINTS} per star, ${LIFE_BONUS} per heart left at the end.`,
        `10 points par seconde, ${PICKUP_POINTS} par étoile, ${LIFE_BONUS} par cœur restant à la fin.`,
      ),
    ],
  }),
  stars: (d) => {
    const base = durationFor(d) * 10;
    const picks = pickupsFor(d);
    const lives = livesFor(d);
    return [
      base + Math.floor(picks * 0.4) * PICKUP_POINTS + (lives - 1) * LIFE_BONUS,
      base + Math.floor(picks * 0.75) * PICKUP_POINTS + lives * LIFE_BONUS,
    ];
  },
  par: (d) => durationFor(d),
  pad: () => ({ left: 'dpad' }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const max = livesFor(ctx.difficulty);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const held = new Set<number>();
    let offset = { x: 0, y: 0 };
    let shown = -1;
    /** Where the player looks (smoothed direction of travel). */
    let lookX = 0;
    let lookY = -0.4;
    const TRAIL = 8;
    const trail = new Float32Array(TRAIL * 2);
    let trailN = 0;
    let trailAt = 0;
    let ended = false;
    const star: Trace = (g, r) => glyphPath(g, STAR, 0, 0, r);

    const status = () => {
      const left = Math.max(0, Math.ceil(s.duration - s.time));
      shown = left;
      ctx.status(
        [P(left, ['s left', 's left'], ['s restante', 's restantes']), P(s.pickups, ['star', 'stars'], ['étoile', 'étoiles'])].join(' · '),
      );
    };

    /** Hazard stripes across a box, in the shaded tone of the hazard. */
    function stripes(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
      g.save();
      g.beginPath();
      g.roundRect(x + 1, y + 1, w - 2, h - 2, arena.r(2));
      g.clip();
      g.strokeStyle = arena.tone(arena.colors.bad).lo;
      g.lineWidth = 3;
      g.beginPath();
      for (let d = -h; d < w; d += 9) {
        g.moveTo(x + d, y + h);
        g.lineTo(x + d + h, y);
      }
      g.stroke();
      g.restore();
    }

    /** A spinning saw blade of radius r. */
    function saw(g: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number) {
      const c = arena.colors;
      const t = arena.tone(c.bad);
      g.save();
      g.translate(x, y);
      g.rotate(spin);
      g.beginPath();
      const teeth = 10;
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i * Math.PI) / teeth;
        const rr = i % 2 ? r * 0.74 : r;
        if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else g.moveTo(rr, 0);
      }
      g.closePath();
      g.fillStyle = c.bad;
      g.fill();
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.7;
      g.lineJoin = 'round';
      g.stroke();
      g.fillStyle = t.lo;
      g.beginPath();
      g.arc(0, 0, r * 0.42, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = t.hi;
      g.beginPath();
      g.arc(0, 0, r * 0.16, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);
      // Time bar along the top.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, 0, W, 7);
      const f = Math.min(1, s.time / s.duration);
      if (f > 0) arena.block(g, -4, -4, W * f + 4, 11, c.accent, 4, false, 0.6);

      for (const p of starsOut(s)) {
        const tw = Math.sin(arena.time * 5 + p.x);
        g.fillStyle = arena.tone(c.p[3]).glow;
        g.beginPath();
        g.arc(p.x, p.y, PICKUP_R * (1.5 + 0.2 * tw), 0, Math.PI * 2);
        g.fill();
        arena.gem(g, p.x, p.y, PICKUP_R, c.p[3], star, true, 1 + 0.08 * tw, Math.sin(arena.time * 2 + p.y) * 0.25);
      }
      // Edge markers for what's about to enter: pulsing arrows.
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(arena.time * 9));
      g.fillStyle = c.bad;
      g.strokeStyle = arena.tone(c.bad).edge;
      g.lineWidth = arena.lw * 0.5;
      g.lineJoin = 'round';
      g.globalAlpha = pulse;
      for (const z of incoming(s)) {
        g.beginPath();
        if (z.kind === 'disc') {
          const y = z.y + z.h / 2;
          const x = z.vx > 0 ? 3 : W - 3;
          const k = z.vx > 0 ? 1 : -1;
          g.moveTo(x, y - 7);
          g.lineTo(x + 9 * k, y);
          g.lineTo(x, y + 7);
        } else {
          const x = z.x + z.w / 2;
          g.moveTo(x - 7, 9);
          g.lineTo(x, 18);
          g.lineTo(x + 7, 9);
        }
        g.closePath();
        g.fill();
        g.stroke();
      }
      g.globalAlpha = 1;
      for (const z of s.live) {
        if (z.kind === 'disc') saw(g, z.x + z.w / 2, z.y + z.h / 2, z.w / 2, arena.time * 7 * Math.sign(z.vx || 1));
        else {
          arena.block(g, z.x, z.y, z.w, z.h, c.bad, z.kind === 'bar' ? 2 : 4);
          stripes(g, z.x, z.y, z.w, z.h - 2);
          g.strokeStyle = arena.tone(c.bad).edge;
          g.lineWidth = arena.lw * 0.8;
          g.beginPath();
          g.roundRect(z.x, z.y, z.w, z.h, arena.r(z.kind === 'bar' ? 2 : 4));
          g.stroke();
        }
      }
      // The player: a trail, then the ball blinking while safe after a hit, eyes looking ahead.
      if (!ended || s.lives > 0) {
        g.fillStyle = arena.tone(c.accent).glow;
        for (let i = 0; i < trailN; i++) {
          const k = (trailAt - 1 - i + TRAIL) % TRAIL;
          const fi = 1 - i / TRAIL;
          g.globalAlpha = fi * 0.7;
          g.beginPath();
          g.arc(trail[k * 2], trail[k * 2 + 1], PLAYER_R * (0.3 + 0.55 * fi), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
        if (!s.invulnerable || Math.floor(s.invulnerable * 10) % 2 === 0) {
          arena.ball(g, s.px, s.py, PLAYER_R, c.accent);
          const ex = lookX * 2.2;
          const ey = lookY * 2.2;
          for (const dx of [-3.6, 3.6]) {
            const x = s.px + dx + ex * 0.6;
            const y = s.py - 1.5 + ey * 0.6;
            g.fillStyle = c.paper;
            g.strokeStyle = arena.tone(c.accent).edge;
            g.lineWidth = arena.lw * 0.4;
            g.beginPath();
            g.arc(x, y, 2.9, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            g.fillStyle = c.coal;
            g.beginPath();
            g.arc(x + ex * 0.5, y + ey * 0.5, 1.45, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      arena.overlay(g);
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 4,
      onDown(p) {
        offset = { x: s.px - p.x, y: s.py - p.y };
        s.target = { x: s.px, y: s.py };
      },
      onMove(p, from) {
        if (from) s.target = { x: p.x + offset.x, y: p.y + offset.y };
      },
    });

    const syncKeys = () => {
      s.kx = (held.has(1) ? 1 : 0) - (held.has(3) ? 1 : 0);
      s.ky = (held.has(2) ? 1 : 0) - (held.has(0) ? 1 : 0);
    };

    ctx.score(0);
    ctx.lives(s.lives, max);
    status();
    return {
      draw,
      frame(dt) {
        const before = s.score;
        const ox = s.px;
        const oy = s.py;
        const picks = s.pickups;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        // A drag target outside the field is clamped like the dot.
        if (s.target) s.target = { x: s.px, y: s.py };
        // Eyes follow the direction of travel; the trail records the path.
        const mx = s.px - ox;
        const my = s.py - oy;
        const m = Math.hypot(mx, my);
        if (m > 0.3) {
          lookX = approach(lookX, mx / m, 12, dt);
          lookY = approach(lookY, my / m, 12, dt);
        }
        if (m > 0.5 || trailN) {
          trail[trailAt * 2] = s.px;
          trail[trailAt * 2 + 1] = s.py;
          trailAt = (trailAt + 1) % TRAIL;
          trailN = m > 0.5 ? Math.min(TRAIL, trailN + 1) : Math.max(0, trailN - 1);
        }
        if (s.score !== before) ctx.score(s.score);
        if (s.pickups > picks) {
          const p = s.stars.find((q) => q.taken && Math.hypot(q.x - s.px, q.y - s.py) < PICKUP_R + PLAYER_R + 2);
          const x = p?.x ?? s.px;
          const y = p?.y ?? s.py;
          fx.burst(x, y, c.p[3], 12, 120, 3.5, 0.5, 'square', 120);
          fx.ring(x, y, c.p[3], PICKUP_R, PICKUP_R * 3, 0.35, arena.lw);
          fx.text(x, y - 14, `+${PICKUP_POINTS}`, c.p[3], 13);
          sfx('coin', { pitch: s.pickups % 4 });
        }
        if (ev.hurt) {
          ctx.lives(s.lives, max);
          fx.shake(6, 0.35);
          fx.flash(c.bad, 0.3, 0.35);
          fx.burst(s.px, s.py, c.bad, 14, 150, 3.5, 0.5);
          fx.ring(s.px, s.py, c.bad, PLAYER_R, PLAYER_R * 4, 0.4, arena.lw * 1.4);
        }
        if (ev.picked || Math.ceil(s.duration - s.time) !== shown) status();
        if (ev.won) {
          ended = true;
          for (let i = 0; i < 4; i++) fx.burst(s.px, s.py, c.p[i], 10, 190, 4, 0.9, 'square', 200);
          fx.ring(s.px, s.py, c.good, PLAYER_R, 90, 0.6, arena.lw * 1.5);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          fx.burst(s.px, s.py, c.accent, 16, 170, 4, 0.7);
          arena.linger();
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const dir = keyDir(e.key);
        if (dir === -1) return false;
        if (e.type === 'keydown') held.add(dir);
        else held.delete(dir);
        s.target = null;
        syncKeys();
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
