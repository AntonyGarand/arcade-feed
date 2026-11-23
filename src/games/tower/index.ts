import './style.css';
import { L } from '../../core/i18n';
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
const FONT = "'Space Grotesk Variable', system-ui, sans-serif";

interface Pop {
  x: number;
  y: number;
  w: number;
  t: number;
  text: string;
}

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
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    /** Camera offset (world y + cam = screen y), eased towards the top of the tower. */
    let cam = 0;
    const camTarget = () => Math.max(0, VIEW_Y - floorY(s.blocks.length));
    let pops: Pop[] = [];
    /** Shake after a cut, flash after a perfect. */
    let flash = 0;
    /** 1 just after a drop, easing to 0 as the block settles. */
    let land = 0;
    let ended = false;

    const status = () =>
      ctx.status(
        [`${L('Floor', 'Étage')} ${height(s)}/${s.goal}`, s.streak > 1 ? `${L('perfect', 'parfait')} ×${s.streak}` : '']
          .filter(Boolean)
          .join(' · '),
      );

    const fill = (floor: number) => arena.colors.p[floor % 8];

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      g.save();
      g.translate(0, cam);
      // Height marks every 5 floors, and the goal flag.
      g.font = `600 9px ${FONT}`;
      g.textBaseline = 'middle';
      for (let i = 5; i < s.goal; i += 5) {
        const y = floorY(i);
        g.fillStyle = c.cellAlt;
        g.fillRect(0, y - 0.5, 12, 1);
        g.fillRect(W - 12, y - 0.5, 12, 1);
        g.fillStyle = c.muted;
        g.textAlign = 'left';
        g.fillText(String(i), 14, y);
      }
      const gy = floorY(s.goal);
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.6;
      g.setLineDash([6, 5]);
      g.beginPath();
      g.moveTo(0, gy);
      g.lineTo(W, gy);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(W - 18, gy);
      g.lineTo(W - 18, gy - 26);
      g.stroke();
      g.fillStyle = c.accent;
      g.beginPath();
      g.moveTo(W - 18, gy - 26);
      g.lineTo(W - 38, gy - 20);
      g.lineTo(W - 18, gy - 14);
      g.closePath();
      g.fill();
      g.stroke();

      // Ground.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, GROUND, W, H);
      g.strokeStyle = c.ink;
      g.beginPath();
      g.moveTo(0, GROUND);
      g.lineTo(W, GROUND);
      g.stroke();

      // The tower, base first (the base is a plain slab).
      const last = s.blocks.length - 1;
      for (const [i, b] of s.blocks.entries())
        arena.box(g, b.x, floorY(i) - (i === last ? HOVER * land : 0), b.w, BH, i === 0 ? c.muted : fill(i), 2);
      // Perfect flash: an outline around the last block, fading out.
      if (flash > 0) {
        const i = s.blocks.length - 1;
        const b = s.blocks[i];
        const k = 1 - flash;
        g.globalAlpha = flash;
        g.strokeStyle = c.accent;
        g.lineWidth = 3;
        g.strokeRect(b.x - 4 - k * 10, floorY(i) - 4 - k * 6, b.w + 8 + k * 20, BH + 8 + k * 12);
        g.globalAlpha = 1;
      }
      // Sliced pieces tumbling away.
      for (const ch of s.chunks) {
        g.save();
        g.translate(ch.x + ch.w / 2, ch.y + BH / 2);
        g.rotate(ch.a);
        arena.box(g, -ch.w / 2, -BH / 2, ch.w, BH, fill(ch.floor), 2, false);
        g.restore();
      }
      // The sliding block, with a faint guide down to the tower.
      if (!s.done) {
        const y = floorY(s.blocks.length) - HOVER;
        g.fillStyle = c.cellAlt;
        g.fillRect(s.x, y + BH, s.w, HOVER);
        arena.box(g, s.x, y, s.w, BH, fill(s.blocks.length), 2);
      }
      // Pops: "+30" and "Perfect" floating up.
      g.textAlign = 'center';
      for (const p of pops) {
        g.globalAlpha = Math.min(1, p.t * 2);
        g.font = `700 ${p.w}px ${FONT}`;
        g.fillStyle = c.fg;
        g.fillText(p.text, p.x, p.y - (1 - p.t) * 24);
      }
      g.globalAlpha = 1;
      g.restore();
      // Progress to the flag, along the right edge (fixed on screen).
      const bar = H - 40;
      arena.box(g, W - 9, 20, 5, bar, c.cellAlt, 2, false);
      g.fillStyle = c.accent;
      const k = Math.min(1, height(s) / s.goal);
      g.fillRect(W - 8, 20 + bar * (1 - k), 3, bar * k);
    }

    const fire = () => {
      if (ended) return;
      const r = drop(s);
      if (!r) return;
      if (!r.over) land = 1;
      const i = s.blocks.length - 1;
      const b = s.blocks[r.over ? 0 : i];
      const cx = r.over ? W / 2 : b.x + b.w / 2;
      const rise = Math.min(i, 14);
      if (r.kind === 'perfect') sfx('power', { pitch: Math.min(rise / 2, 6) });
      else if (r.kind === 'cut') sfx('hit', { pitch: rise - 4 });
      else sfx('error');
      if (r.kind === 'perfect') haptic(15);
      if (r.kind === 'perfect') {
        flash = 1;
        pops.push({ x: cx, y: floorY(i) - 12, w: 13, t: 1, text: `${L('Perfect', 'Parfait')}${s.streak > 1 ? ` ×${s.streak}` : ''}` });
      }
      if (r.points) pops.push({ x: cx, y: floorY(i) + BH / 2, w: 10, t: 1, text: `+${r.points}` });
      ctx.score(s.score);
      status();
      if (r.cleared) {
        ended = true;
        ctx.win();
      } else if (r.over) {
        ended = true;
        ctx.lose();
      }
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
        cam += (camTarget() - cam) * Math.min(1, dt * 5);
        flash = Math.max(0, flash - dt * 2);
        land = Math.max(0, land - dt * 12);
        for (const p of pops) p.t -= dt * 1.2;
        pops = pops.filter((p) => p.t > 0);
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
