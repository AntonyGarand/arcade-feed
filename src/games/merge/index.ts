import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { aim, createLevel, drop, dropBudget, DROP_BONUS, DROP_Y, FLOOR, H, LINE, OVERFLOW_S, RADII, step, W } from './rules';

/** Palette slot per size, so neighbouring sizes contrast. */
const TONE = [6, 0, 3, 2, 5, 1, 4, 7];

export const merge: GameDef = {
  id: 'merge',
  get name() {
    return L('Fruit Merge', 'Fusion de fruits');
  },
  get rules() {
    return L('Drop fruit; two alike merge into a bigger one.', 'Lâchez des fruits; deux pareils fusionnent en plus gros.');
  },
  category: 'stack',
  help: () => ({
    goal: L(
      'Grow a fruit to the target size before the jar overflows.',
      'Faites grossir un fruit jusqu’à la taille visée avant que le bocal déborde.',
    ),
    steps: [
      L(
        'Drop fruit into the jar. Two fruits of the same size that touch merge into the next size.',
        'Lâchez des fruits dans le bocal. Deux fruits de même taille qui se touchent fusionnent en la taille suivante.',
      ),
      L(
        'Each size has its own colour and symbol; the row at the top shows the order up to the goal.',
        'Chaque taille a sa couleur et son symbole; la rangée du haut montre l’ordre jusqu’à l’objectif.',
      ),
      L(
        'If fruit stays above the dashed line for 2 seconds, the jar overflows.',
        'Si un fruit reste au-dessus de la ligne pointillée pendant 2 secondes, le bocal déborde.',
      ),
      L('Drag or point to aim, release or tap to drop.', 'Glissez ou pointez pour viser, relâchez ou touchez pour lâcher.'),
      L(
        'Keyboard: ← → or A D to aim, Space or ↓ to drop, P to pause.',
        'Clavier : ← → ou A D pour viser, Espace ou ↓ pour lâcher, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Keep big fruit in one corner and small ones next to them, so merges chain.',
        'Gardez les gros fruits dans un coin et les petits à côté, pour enchaîner les fusions.',
      ),
      L(
        `Reaching the goal in fewer drops earns ${DROP_BONUS} points per drop saved.`,
        `Atteindre l’objectif en moins de lâchers rapporte ${DROP_BONUS} points par lâcher épargné.`,
      ),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [300, 350],
      [740, 860],
      [620, 720],
      [1350, 1580],
      [1450, 1650],
    ] as const),
  par: (d) => Math.round(dropBudget(d) * 1.6),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    let done = false;

    const status = () =>
      ctx.status(
        [L(`goal: size ${s.target + 1}`, `objectif : taille ${s.target + 1}`), P(s.drops, ['drop', 'drops'], ['lâcher', 'lâchers'])].join(
          ' · ',
        ),
      );

    function fruit(g: CanvasRenderingContext2D, k: number, x: number, y: number, r: number = RADII[k]) {
      const c = arena.colors;
      if (arena.sh) {
        g.fillStyle = c.drop;
        g.beginPath();
        g.arc(x + arena.sh * 0.5, y + arena.sh * 0.5, r, 0, Math.PI * 2);
        g.fill();
      }
      arena.disc(g, x, y, r, c.p[TONE[k]]);
      // The size's symbol: a second cue besides colour.
      g.fillStyle = c.cell;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.6;
      glyphPath(g, k, x, y, r * 0.48);
      g.fill();
      g.stroke();
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const top = LINE - 24;
      // Jar.
      g.fillStyle = c.cellAlt;
      g.fillRect(s.left, top, s.right - s.left, FLOOR - top);
      // Size ladder, up to the goal.
      let lx = 10;
      for (let k = 0; k <= s.target; k++) {
        const r = 4 + k * 1.4;
        if (k === s.target) {
          g.strokeStyle = c.fg;
          g.lineWidth = arena.lw * 0.7;
          g.setLineDash([3, 2]);
          g.beginPath();
          g.arc(lx + r, 14, r + 3, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
        fruit(g, k, lx + r, 14, r);
        lx += 2 * r + 6;
      }
      // Next fruit, top right.
      const nr = Math.min(12, RADII[s.next]);
      fruit(g, s.next, W - 12 - nr, 14, nr);
      g.fillStyle = c.muted;
      g.font = "600 9px 'Space Grotesk Variable', system-ui, sans-serif";
      g.textAlign = 'center';
      g.fillText(L('next', 'suivant'), W - 12 - nr, 14 + nr + 11);

      // Overflow line: dashed, red and thicker while something is above it.
      const warn = s.over > 0;
      g.strokeStyle = warn ? c.bad : c.muted;
      g.lineWidth = warn ? arena.lw * 1.2 : arena.lw * 0.6;
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(s.left, LINE);
      g.lineTo(s.right, LINE);
      g.stroke();
      g.setLineDash([]);
      if (warn) {
        g.fillStyle = c.bad;
        g.fillRect(s.left, LINE + 3, ((s.right - s.left) * s.over) / OVERFLOW_S, 4);
      }

      for (const b of s.bodies) fruit(g, b.k, b.x, b.y);

      // Walls and floor.
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 1.4;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(s.left, top);
      g.lineTo(s.left, FLOOR);
      g.lineTo(s.right, FLOOR);
      g.lineTo(s.right, top);
      g.stroke();

      if (!done) {
        // Piece in hand and its drop guide.
        const r = RADII[s.current];
        g.strokeStyle = c.muted;
        g.lineWidth = arena.lw * 0.5;
        g.setLineDash([2, 4]);
        g.beginPath();
        g.moveTo(s.aimX, DROP_Y + r);
        g.lineTo(s.aimX, FLOOR);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = s.cooldown > 0 ? 0.5 : 1;
        fruit(g, s.current, s.aimX, DROP_Y);
        g.globalAlpha = 1;
      }
    }

    const at = (p: { x: number }) => aim(s, p.x);
    const release = (p: { x: number }) => {
      at(p);
      if (!done && drop(s)) status();
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onDown: at,
      onMove: at,
      onTap: release,
      onRelease: release,
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        if (done) return;
        const before = s.score;
        const ev = step(s, dt);
        if (s.score !== before) ctx.score(s.score);
        draw();
        if (ev.won) {
          done = true;
          draw();
          ctx.win();
        } else if (ev.lost) {
          done = true;
          draw();
          ctx.lose();
        }
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = k === 'arrowleft' || k === 'a' ? -1 : k === 'arrowright' || k === 'd' ? 1 : 0;
        if (dir) {
          if (e.type === 'keydown') s.dir = dir;
          else if (s.dir === dir) s.dir = 0;
          return true;
        }
        if (k === ' ' || k === 'enter' || k === 'arrowdown' || k === 's') {
          if (e.type === 'keydown' && !done && drop(s)) status();
          return true;
        }
        return false;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
