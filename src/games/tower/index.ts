import './style.css';
import { L } from '../../core/i18n';
import { btn } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  BH,
  BLOCK_POINTS,
  createLevel,
  drop,
  floorY,
  goalFor,
  GROUND,
  H,
  height,
  PERFECT_POINTS,
  REGROW_EVERY,
  speedFor,
  step,
  W,
} from './rules';

/** Where the sliding block sits on screen once the camera starts to climb. */
const VIEW_Y = 130;
/** The sliding block hovers this far above its floor, and drops into place. */
const HOVER = 12;

export const tower: GameDef = {
  id: 'tower',
  get name() {
    return L('Tower', 'Tour');
  },
  get rules() {
    return L('Drop each block right on top of the last.', 'Lâchez chaque bloc pile sur le précédent.');
  },
  category: 'stack',
  help: () => ({
    goal: L(
      'Build the tower up to the flag before your blocks get too thin.',
      'Montez la tour jusqu’au drapeau avant que vos blocs deviennent trop minces.',
    ),
    steps: [
      L(
        'A block slides back and forth above the tower. Drop it when it lines up.',
        'Un bloc glisse de gauche à droite au-dessus de la tour. Lâchez-le quand il est aligné.',
      ),
      L(
        'Whatever hangs over the edge is sliced off: the next block is only as wide as what is left.',
        'Ce qui dépasse est tranché : le bloc suivant n’est pas plus large que ce qui reste.',
      ),
      L(
        `A near-perfect drop keeps the full width; ${REGROW_EVERY} in a row grow the block back a little.`,
        `Un lâcher presque parfait garde toute la largeur; ${REGROW_EVERY} de suite font regrandir le bloc un peu.`,
      ),
      L('Miss the tower completely and it’s over.', 'Si le bloc rate complètement la tour, c’est terminé.'),
      L('Tap anywhere to drop the block.', 'Touchez n’importe où pour lâcher le bloc.'),
      L('Keyboard: Space, Enter or ↓ to drop, P to pause.', 'Clavier : Espace, Entrée ou ↓ pour lâcher, P pour la pause.'),
    ],
    tips: [
      L(
        `Each block is worth ${BLOCK_POINTS}; perfects add ${PERFECT_POINTS} per step of the streak (up to ×5).`,
        `Chaque bloc vaut ${BLOCK_POINTS}; les parfaits ajoutent ${PERFECT_POINTS} par cran de la série (jusqu’à ×5).`,
      ),
      L(
        'Watch the edge of the block below, not the middle: it’s easier to time.',
        'Regardez le bord du bloc du dessous plutôt que le milieu : c’est plus facile à synchroniser.',
      ),
    ],
  }),
  stars: (d) => {
    const n = goalFor(d);
    return [n * byLevel(d, [26, 24, 22, 20, 18]), n * byLevel(d, [46, 44, 42, 40, 38])];
  },
  par: (d) => Math.round(goalFor(d) * (W / speedFor(d)) * 0.9 + 8),
  pad: () => ({ right: [btn(' ', 'drop', L('Drop', 'Lâcher'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    let ended = false;
    /** After the run, the arena's own frames keep the sliced pieces falling (see `linger`). */
    let lingerAt = 0;
    const arena = new Arena(ctx.root, W, H, () => {
      if (ended) {
        const dt = arena.time - lingerAt;
        lingerAt = arena.time;
        if (dt > 0) step(s, dt);
        wash.a = Math.max(0, wash.a - dt * 0.6);
      }
      draw();
    });
    const fx = arena.fx;
    /** Camera offset (world y + cam = screen y), eased towards the top of the tower. */
    let cam = 0;
    const camTarget = () => Math.max(0, VIEW_Y - floorY(s.blocks.length));
    /** 1 just after a drop, easing to 0 as the block settles; the perfect glow fades the same way. */
    let land = 0;
    let glow = 0;
    /** A wash over the whole field (fx's own flash would scroll with the camera). */
    let wash = { color: '', a: 0 };

    const status = () =>
      ctx.status(
        [`${L('Floor', 'Étage')} ${height(s)}/${s.goal}`, s.streak > 1 ? `${L('perfect', 'parfait')} ×${s.streak}` : '']
          .filter(Boolean)
          .join(' · '),
      );

    const fill = (floor: number) => arena.colors.p[floor % 8];

    /** One floor of the tower: a bevelled slab with a row of windows. */
    function slab(g: CanvasRenderingContext2D, x: number, y: number, w: number, color: string) {
      arena.block(g, x, y, w, BH, color, 2.5);
      if (w < 14) return;
      const t = arena.tone(color);
      g.fillStyle = t.lo;
      const n = Math.max(1, Math.floor((w - 6) / 14));
      const gap = (w - 6) / n;
      for (let k = 0; k < n; k++) g.fillRect(x + 3 + k * gap + gap / 2 - 3, y + 5, 6, 6);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);
      // Clouds drifting by, slower than the tower climbs (parallax).
      g.fillStyle = c.cell;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.5;
      for (let i = 0; i < 6; i++) {
        const y = ((i * 110 + cam * 0.4) % 660) - 40;
        const x = ((i * 97 + arena.time * (6 + i * 2)) % (W + 80)) - 40;
        const r = 9 + (i % 3) * 3;
        g.beginPath();
        g.arc(x, y, r, Math.PI * 0.5, Math.PI * 1.5);
        g.arc(x + r * 0.9, y - r * 0.55, r * 0.95, Math.PI, Math.PI * 2);
        g.arc(x + r * 2, y, r, Math.PI * 1.5, Math.PI * 0.5);
        g.closePath();
        g.fill();
        g.stroke();
      }
      g.save();
      g.translate(0, cam);
      // Height marks every 5 floors, and the goal: a dashed line with a flag.
      g.font = `700 11px ${arena.family}`;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      for (let i = 5; i < s.goal; i += 5) {
        const y = floorY(i);
        g.fillStyle = c.muted;
        g.fillRect(0, y - 0.75, 10, 1.5);
        g.fillText(String(i), 13, y);
      }
      const gy = floorY(s.goal);
      g.strokeStyle = c.good;
      g.lineWidth = arena.lw * 0.7;
      g.setLineDash([6, 5]);
      g.beginPath();
      g.moveTo(0, gy);
      g.lineTo(W, gy);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(W - 24, gy);
      g.lineTo(W - 24, gy - 30);
      g.stroke();
      const wave = Math.sin(arena.time * 5) * 2;
      g.fillStyle = c.good;
      g.beginPath();
      g.moveTo(W - 24, gy - 30);
      g.quadraticCurveTo(W - 34, gy - 28 + wave, W - 46, gy - 23 + wave);
      g.lineTo(W - 24, gy - 16);
      g.closePath();
      g.fill();
      g.stroke();

      // Ground: earth with a strip of grass.
      arena.box(g, -4, GROUND, W + 8, H, c.cellAlt, 0, false);
      arena.box(g, -4, GROUND, W + 8, 5, c.p[2], 0, false);

      // The tower, base first (the base is a plain foundation slab).
      const last = s.blocks.length - 1;
      for (const [i, b] of s.blocks.entries()) {
        const y = floorY(i) - (i === last ? HOVER * land : 0);
        if (i === 0) arena.block(g, b.x, y, b.w, BH, c.muted, 2.5);
        else slab(g, b.x, y, b.w, fill(i));
      }
      // Perfect glow: the last block shines, then fades.
      if (glow > 0 && last > 0) {
        const b = s.blocks[last];
        g.globalAlpha = glow * 0.6;
        g.fillStyle = c.paper;
        g.beginPath();
        g.roundRect(b.x, floorY(last), b.w, BH, arena.r(2.5));
        g.fill();
        g.globalAlpha = 1;
      }
      // Sliced pieces tumbling away.
      for (const ch of s.chunks) {
        g.save();
        g.translate(ch.x + ch.w / 2, ch.y + BH / 2);
        g.rotate(ch.a);
        arena.block(g, -ch.w / 2, -BH / 2, ch.w, BH, fill(ch.floor), 2, false);
        g.restore();
      }
      // The sliding block, with guides from the edges of the block below.
      if (!s.done) {
        const y = floorY(s.blocks.length) - HOVER;
        const t = s.blocks[last];
        g.strokeStyle = c.muted;
        g.globalAlpha = 0.6;
        g.lineWidth = arena.lw * 0.5;
        g.setLineDash([3, 3]);
        g.beginPath();
        for (const ex of [t.x, t.x + t.w]) {
          g.moveTo(ex, floorY(last));
          g.lineTo(ex, y - 8);
        }
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
        slab(g, s.x, y, s.w, fill(s.blocks.length));
      }
      arena.overlay(g);
      g.restore();
      // Progress to the flag, along the right edge (fixed on screen).
      const bar = H - 60;
      const k = Math.min(1, height(s) / s.goal);
      arena.box(g, W - 12, 30, 8, bar, c.cellAlt, 4, false);
      if (k > 0) {
        g.fillStyle = c.good;
        g.beginPath();
        g.roundRect(W - 12, 30 + bar * (1 - k), 8, bar * k, 4);
        g.fill();
      }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.roundRect(W - 12, 30, 8, bar, 4);
      g.stroke();
      if (wash.a > 0) {
        g.globalAlpha = wash.a;
        g.fillStyle = wash.color;
        g.fillRect(-10, -10, W + 20, H + 20);
        g.globalAlpha = 1;
      }
    }

    const fire = () => {
      if (ended) return;
      const r = drop(s);
      if (!r) return;
      const c = arena.colors;
      if (!r.over) land = 1;
      const i = s.blocks.length - 1;
      const b = s.blocks[r.over ? 0 : i];
      const cx = r.over ? W / 2 : b.x + b.w / 2;
      const y = floorY(i) + BH / 2;
      const rise = Math.min(i, 14);
      if (r.kind === 'perfect') {
        sfx('power', { pitch: Math.min(rise / 2, 6) });
        haptic(15);
        glow = 1;
        fx.ring(cx, y, c.accent, b.w * 0.3, b.w * 0.75, 0.4, arena.lw * 1.4);
        fx.burst(b.x, y, c.paper, 5, 90, 2.5, 0.35, 'spark', 0, Math.PI, 1);
        fx.burst(b.x + b.w, y, c.paper, 5, 90, 2.5, 0.35, 'spark', 0, 0, 1);
        fx.text(cx, y - 22, `${L('Perfect', 'Parfait')}${s.streak > 1 ? ` ×${s.streak}` : ''}`, c.accent, 15, 0.9);
        if (r.grew) fx.text(cx, y - 40, L('Wider!', 'Plus large!'), c.good, 12, 0.9);
      } else if (r.kind === 'cut') {
        sfx('hit', { pitch: rise - 4 });
        // Dust where the overhang snapped off.
        for (const ch of s.chunks.slice(-2))
          if (ch.floor === i) fx.burst(ch.x < b.x ? b.x : b.x + b.w, y, fill(i), 8, 90, 3, 0.4, 'square', 300);
        fx.shake(1.5 + Math.min(3, r.cut / 15), 0.2);
      } else {
        sfx('error');
        fx.shake(5, 0.4);
        wash = { color: c.bad, a: 0.22 };
      }
      if (r.points) fx.text(cx, y - 6, `+${r.points}`, c.fg, 12, 0.7);
      ctx.score(s.score);
      status();
      if (r.cleared || r.over) {
        ended = true;
        lingerAt = arena.time;
        if (r.cleared) {
          for (let k = 0; k < 5; k++) fx.burst(cx, y - 10, c.p[k], 10, 200, 4, 0.9, 'square', 220);
          fx.ring(cx, y, c.good, 10, 120, 0.6, arena.lw * 1.5);
          wash = { color: c.good, a: 0.22 };
        }
        arena.linger(1.6);
      }
      if (r.cleared) ctx.win();
      else if (r.over) ctx.lose();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button > 0) return;
      fire();
    };
    arena.canvas.addEventListener('pointerdown', onDown);

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        step(s, dt);
        arena.update(dt);
        cam += (camTarget() - cam) * Math.min(1, dt * 5);
        glow = Math.max(0, glow - dt * 2.5);
        wash.a = Math.max(0, wash.a - dt * 0.6);
        land = Math.max(0, land - dt * 12);
        draw();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        if (k === ' ' || k === 'enter' || k === 'arrowdown' || k === 's') {
          if (e.type === 'keydown' && !e.repeat) fire();
          return true;
        }
        return false;
      },
      destroy() {
        arena.canvas.removeEventListener('pointerdown', onDown);
        arena.destroy();
      },
    };
  },
};
