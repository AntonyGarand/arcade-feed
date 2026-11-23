import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures, keyDir } from '../../kits/gesture/gesture';
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
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const max = livesFor(ctx.difficulty);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const held = new Set<number>();
    let offset = { x: 0, y: 0 };
    let shown = -1;

    const status = () => {
      const left = Math.max(0, Math.ceil(s.duration - s.time));
      shown = left;
      ctx.status(
        [P(left, ['s left', 's left'], ['s restante', 's restantes']), P(s.pickups, ['star', 'stars'], ['étoile', 'étoiles'])].join(' · '),
      );
    };

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Time bar along the top.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, 0, W, 6);
      g.fillStyle = c.accent;
      g.fillRect(0, 0, W * Math.min(1, s.time / s.duration), 6);

      for (const p of starsOut(s)) {
        g.fillStyle = c.p[3];
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.7;
        glyphPath(g, STAR, p.x, p.y, PICKUP_R);
        g.fill();
        g.stroke();
      }
      // Edge markers for what's about to enter.
      g.fillStyle = c.bad;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.5;
      for (const z of incoming(s)) {
        g.beginPath();
        if (z.kind === 'disc') {
          const y = z.y + z.h / 2;
          const x = z.vx > 0 ? 3 : W - 3;
          const k = z.vx > 0 ? 1 : -1;
          g.moveTo(x, y - 6);
          g.lineTo(x + 8 * k, y);
          g.lineTo(x, y + 6);
        } else {
          const x = z.x + z.w / 2;
          g.moveTo(x - 6, 8);
          g.lineTo(x, 16);
          g.lineTo(x + 6, 8);
        }
        g.closePath();
        g.fill();
        g.stroke();
      }
      for (const z of s.live) {
        if (z.kind === 'disc') arena.disc(g, z.x + z.w / 2, z.y + z.h / 2, z.w / 2, c.bad);
        else arena.box(g, z.x, z.y, z.w, z.h, c.bad, z.kind === 'bar' ? 2 : 4);
      }
      // The player: blinking while safe after a hit.
      if (!s.invulnerable || Math.floor(s.invulnerable * 10) % 2 === 0) {
        if (arena.sh) {
          g.fillStyle = c.drop;
          g.beginPath();
          g.arc(s.px + arena.sh * 0.6, s.py + arena.sh * 0.6, PLAYER_R, 0, Math.PI * 2);
          g.fill();
        }
        arena.disc(g, s.px, s.py, PLAYER_R, c.accent);
        for (const dx of [-3.5, 3.5]) arena.disc(g, s.px + dx, s.py - 2, 2.4, c.cell);
      }
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
        const ev = step(s, dt);
        // A drag target outside the field is clamped like the dot.
        if (s.target) s.target = { x: s.px, y: s.py };
        if (s.score !== before) ctx.score(s.score);
        if (ev.hurt) ctx.lives(s.lives, max);
        if (ev.picked || Math.ceil(s.duration - s.time) !== shown) status();
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
