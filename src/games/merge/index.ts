import './style.css';
import { L, P } from '../../core/i18n';
import { btn, leftRight } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { outBack } from '../../kits/arena/ease';
import { gestures } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { haptic, sfx } from '../../kits/sound/sound';
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
  pad: () => ({ left: leftRight(), right: [btn(' ', 'drop', L('Drop', 'Lâcher'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    let done = false;
    type Body = (typeof s.bodies)[number];
    /** Arena time each piece appeared (merged pieces pop in). */
    const born = new WeakMap<Body, number>();
    for (const b of s.bodies) born.set(b, -1);

    const status = () =>
      ctx.status(
        [L(`goal: size ${s.target + 1}`, `objectif : taille ${s.target + 1}`), P(s.drops, ['drop', 'drops'], ['lâcher', 'lâchers'])].join(
          ' · ',
        ),
      );

    /**
     * Fruit of size `k`: a glossy ball in the size's colour with its own decoration (stem, leaf,
     * dimples, crease, stripes or crown) and the size's symbol, a second cue besides colour.
     */
    function fruit(g: CanvasRenderingContext2D, k: number, x: number, y: number, r: number = RADII[k], shadow = true) {
      const c = arena.colors;
      const fill = c.p[TONE[k]];
      const t = arena.tone(fill);
      const leafFill = TONE[k] === 2 || TONE[k] === 7 ? c.p[0] : c.p[2];
      const leaf = (lx: number, ly: number, a: number, len: number) => {
        g.save();
        g.translate(lx, ly);
        g.rotate(a);
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(len * 0.5, -len * 0.45, len, 0);
        g.quadraticCurveTo(len * 0.5, len * 0.45, 0, 0);
        g.fillStyle = leafFill;
        g.fill();
        g.strokeStyle = t.edge;
        g.lineWidth = arena.lw * 0.5;
        g.stroke();
        g.restore();
      };
      const stem = () => {
        g.strokeStyle = t.edge;
        g.lineWidth = Math.max(1, r * 0.12);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x, y - r * 0.85);
        g.quadraticCurveTo(x + r * 0.05, y - r * 1.2, x + r * 0.25, y - r * 1.3);
        g.stroke();
        g.lineCap = 'butt';
      };
      const d = k % 8;
      if (d === 0 || d === 3 || d === 7) stem();
      arena.ball(g, x, y, r, fill, shadow);
      g.strokeStyle = t.lo;
      g.fillStyle = t.lo;
      g.lineWidth = Math.max(0.8, r * 0.07);
      if (d === 2) {
        // Citrus dimples.
        for (let i = 0; i < 6; i++) {
          const a = i * 1.05 + 0.4;
          g.beginPath();
          g.arc(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, Math.max(0.6, r * 0.06), 0, Math.PI * 2);
          g.fill();
        }
      } else if (d === 4) {
        // Peach crease.
        g.beginPath();
        g.moveTo(x + r * 0.1, y - r * 0.92);
        g.quadraticCurveTo(x + r * 0.5, y, x + r * 0.15, y + r * 0.9);
        g.stroke();
      } else if (d === 5 || d === 7) {
        // Melon stripes.
        for (const o of [-0.5, 0, 0.5]) {
          g.beginPath();
          g.moveTo(x + o * r * 0.6, y - r * 0.95);
          g.quadraticCurveTo(x + o * r * 1.5, y, x + o * r * 0.6, y + r * 0.95);
          g.stroke();
        }
      }
      if (d === 0 || d === 1 || d === 3) leaf(x + r * 0.15, y - r * (d === 1 ? 0.8 : 1.05), -0.5, r * (d === 0 ? 0.75 : 0.6));
      else if (d === 6) for (const a of [-2.1, -1.57, -1.05]) leaf(x, y - r * 0.82, a, r * 0.6);
      // The size's symbol.
      g.fillStyle = arena.dark ? t.hi : c.cell;
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.55;
      glyphPath(g, k, x, y + r * 0.06, r * 0.4);
      g.fill();
      g.stroke();
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const top = LINE - 24;
      // Jar: the field, glass glints along the walls, the danger zone above the line.
      arena.field(g, s.left, top, s.right - s.left, FLOOR - top, 20, 0, false);
      const warn = s.over > 0;
      g.fillStyle = c.bad;
      g.globalAlpha = warn ? 0.12 + 0.1 * Math.sin(arena.time * 14) : 0.05;
      g.fillRect(s.left, top, s.right - s.left, LINE - top);
      g.globalAlpha = arena.dark ? 0.1 : 0.35;
      g.fillStyle = c.paper;
      g.fillRect(s.left + 4, top + 6, 3, FLOOR - top - 16);
      g.fillRect(s.left + 9, top + 6, 1.5, FLOOR - top - 60);
      g.globalAlpha = 1;
      // Size ladder, up to the goal.
      let lx = 10;
      for (let k = 0; k <= s.target; k++) {
        const r = 4 + k * 1.4;
        if (k === s.target) {
          g.fillStyle = arena.tone(c.p[TONE[k]]).glow;
          g.beginPath();
          g.arc(lx + r, 14, r + 3 + Math.sin(arena.time * 4), 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = c.fg;
          g.lineWidth = arena.lw * 0.7;
          g.setLineDash([3, 2]);
          g.stroke();
          g.setLineDash([]);
        }
        fruit(g, k, lx + r, 14, r, false);
        if (k <= s.biggest) {
          g.fillStyle = c.good;
          g.beginPath();
          g.arc(lx + r * 1.7, 14 + r * 0.7, 2, 0, Math.PI * 2);
          g.fill();
        }
        lx += 2 * r + 6;
      }
      // Next fruit, top right.
      const nr = Math.min(12, RADII[s.next]);
      fruit(g, s.next, W - 12 - nr, 14, nr, false);
      g.fillStyle = c.muted;
      g.font = `700 9px ${arena.family}`;
      g.textAlign = 'center';
      g.fillText(L('next', 'suivant'), W - 12 - nr, 14 + nr + 11);

      // Overflow line: dashed, red and thicker while something is above it.
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

      for (const b of s.bodies) {
        const t0 = born.get(b) ?? -1;
        const age = arena.time - t0;
        const pop = t0 >= 0 && age < 0.25 ? 0.55 + 0.45 * outBack(age / 0.25, 2.2) : 1;
        fruit(g, b.k, b.x, b.y, RADII[b.k] * pop);
      }

      // Walls and floor.
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 1.4;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(s.left, top);
      g.lineTo(s.left, FLOOR);
      g.lineTo(s.right, FLOOR);
      g.lineTo(s.right, top);
      g.stroke();
      g.lineCap = 'butt';

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
        fruit(g, s.current, s.aimX, DROP_Y + Math.sin(arena.time * 4) * 1.2);
        g.globalAlpha = 1;
      }
      arena.overlay(g);
    }

    /** Merged pieces: a pop, a burst in the new size's colour, the points. */
    function react(gain: number) {
      const c = arena.colors;
      for (const b of s.bodies) {
        if (born.has(b)) continue;
        born.set(b, arena.time);
        if (b.age < 0.5) continue; // a fresh drop, not a merge
        sfx('pop', { pitch: b.k * 2 - 4 });
        if (b.k >= 5) haptic(15);
        const fill = c.p[TONE[b.k]];
        const r = RADII[b.k];
        fx.burst(b.x, b.y, fill, 8 + b.k * 2, 90 + r * 3, 3.5, 0.5);
        fx.burst(b.x, b.y, arena.tone(fill).hi, 5, 70, 2.5, 0.4, 'dot', 100);
        fx.ring(b.x, b.y, fill, r * 0.8, r * 1.8, 0.35, arena.lw * 1.2);
        if (gain > 0) fx.text(b.x, b.y - r - 4, `+${gain}`, b.k >= 4 ? fill : c.fg, 11 + Math.min(8, b.k * 1.5));
        if (b.k >= 4) fx.shake(0.5 + b.k * 0.35, 0.2);
      }
    }

    const at = (p: { x: number }) => aim(s, p.x);
    const release = (p: { x: number }) => {
      at(p);
      if (!done && drop(s)) {
        sfx('tick', { vol: 0.5, pitch: -5 });
        status();
      }
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
        arena.update(dt);
        if (s.score !== before) ctx.score(s.score);
        if (ev.merged || s.bodies.length) react(s.score - before);
        const c = arena.colors;
        if (ev.won) {
          done = true;
          const big = s.bodies.reduce((a, b) => (b.k > a.k ? b : a), s.bodies[0]);
          if (big) {
            for (let i = 0; i < 4; i++) fx.burst(big.x, big.y, c.p[i], 12, 200, 4, 0.9, 'square', 200);
            fx.ring(big.x, big.y, c.good, RADII[big.k], RADII[big.k] * 3, 0.6, arena.lw * 1.5);
          }
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
          draw();
          ctx.win();
        } else if (ev.lost) {
          done = true;
          fx.shake(4, 0.4);
          fx.flash(c.bad, 0.25, 0.45);
          arena.linger();
          draw();
          ctx.lose();
        } else draw();
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
          if (e.type === 'keydown' && !done && drop(s)) {
            sfx('tick', { vol: 0.5, pitch: -5 });
            status();
          }
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
