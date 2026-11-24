import './style.css';
import { L, P } from '../../core/i18n';
import { btn, leftRight } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { outBack } from '../../kits/arena/ease';
import { gestures } from '../../kits/gesture/gesture';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { glyphPath } from '../../kits/glyph/glyph';
import { haptic, sfx } from '../../kits/sound/sound';
import { KIND_NAMES, POWER_NAMES } from './names';
import {
  aim,
  BLAST,
  BOMB_MAX,
  CHAIN_S,
  CHAIN_TIERS,
  createLevel,
  drop,
  dropBudget,
  DROP_BONUS,
  DROP_Y,
  FLOOR,
  floorOf,
  H,
  LINE,
  OVERFLOW_S,
  type PieceType,
  RADII,
  step,
  W,
} from './rules';

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
      L(
        'Rainbow wildcards merge with any fruit; grey rocks never merge but crumble next to a merge; bombs clear small fruit and rocks.',
        'Les jokers arc-en-ciel fusionnent avec tout fruit; les roches grises ne fusionnent pas mais se brisent près d’une fusion; les bombes effacent petits fruits et roches.',
      ),
      L(
        'Drag or point to aim, release or tap to drop. Keyboard: ← → or A D to aim, Space or ↓ to drop, P to pause.',
        'Glissez ou pointez pour viser, relâchez ou touchez pour lâcher. Clavier : ← → ou A D pour viser, Espace ou ↓ pour lâcher, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Keep big fruit in one corner and small ones next to them, so merges chain.',
        'Gardez les gros fruits dans un coin et les petits à côté, pour enchaîner les fusions.',
      ),
      L(
        `Merges less than ${CHAIN_S} s apart make a chain: ${CHAIN_TIERS[0]} hand you a wildcard, ${CHAIN_TIERS[1]} pop the smallest fruit and every rock, ${CHAIN_TIERS[2]} grow the smallest fruit a size.`,
        `Des fusions à moins de ${CHAIN_S} s d’écart font une chaîne : ${CHAIN_TIERS[0]} vous donnent un joker, ${CHAIN_TIERS[1]} font éclater les plus petits fruits et toutes les roches, ${CHAIN_TIERS[2]} font grossir les plus petits fruits.`,
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
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    let done = false;
    type Body = (typeof s.bodies)[number];
    /** Arena time each piece appeared (merged pieces pop in). */
    const born = new WeakMap<Body, number>();
    for (const b of s.bodies) born.set(b, -1);

    /** Centre x of each size on the ladder (set while drawing), and the biggest size made so far. */
    const ladderX: number[] = [];
    let biggest = s.biggest;

    const status = () =>
      ctx.status(
        [
          L(`goal: size ${s.target + 1}`, `objectif : taille ${s.target + 1}`),
          P(s.drops, ['drop', 'drops'], ['lâcher', 'lâchers']),
          s.chain > 1 ? L(`chain ×${s.chain}`, `chaîne ×${s.chain}`) : '',
        ]
          .filter(Boolean)
          .join(' · '),
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

    /** A piece of any type: a fruit, or a wildcard, rock or bomb. */
    function piece(g: CanvasRenderingContext2D, type: PieceType, k: number, x: number, y: number, r: number = RADII[k], shadow = true) {
      if (type === 'fruit') fruit(g, k, x, y, r, shadow);
      else if (type === 'wild') wild(g, x, y, r, shadow);
      else if (type === 'rock') rock(g, x, y, r, shadow);
      else bomb(g, x, y, r, shadow);
    }

    /** A rainbow wildcard: a ball in palette slices that slowly turns, with a star. */
    function wild(g: CanvasRenderingContext2D, x: number, y: number, r: number, shadow: boolean) {
      const c = arena.colors;
      arena.ball(g, x, y, r, c.p[0], shadow);
      const spin = arena.time * 1.5;
      for (let i = 0; i < 6; i++) {
        g.fillStyle = c.p[[0, 3, 2, 5, 1, 4][i]];
        g.beginPath();
        g.moveTo(x, y);
        g.arc(x, y, r * 0.86, spin + (i * Math.PI) / 3, spin + ((i + 1) * Math.PI) / 3);
        g.closePath();
        g.fill();
      }
      g.fillStyle = c.paper;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.5;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.2 : r * 0.48;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.stroke();
    }

    /** A rock: a lumpy grey stone with cracks. */
    function rock(g: CanvasRenderingContext2D, x: number, y: number, r: number, shadow: boolean) {
      const c = arena.colors;
      const t = arena.tone(c.muted);
      g.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const rr = r * (0.9 + 0.1 * Math.sin(i * 2.7));
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
      if (shadow) {
        g.save();
        g.translate(arena.sh * 0.5, arena.sh * 0.5);
        g.fillStyle = c.drop;
        g.fill();
        g.restore();
      }
      g.fillStyle = c.muted;
      g.fill();
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.8;
      g.stroke();
      g.strokeStyle = t.lo;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.moveTo(x - r * 0.4, y - r * 0.5);
      g.lineTo(x - r * 0.1, y - r * 0.1);
      g.lineTo(x - r * 0.3, y + r * 0.35);
      g.moveTo(x + r * 0.2, y + r * 0.1);
      g.lineTo(x + r * 0.55, y + r * 0.25);
      g.stroke();
      g.fillStyle = t.hi;
      g.beginPath();
      g.ellipse(x - r * 0.35, y - r * 0.45, r * 0.18, r * 0.1, -0.6, 0, Math.PI * 2);
      g.fill();
    }

    /** A bomb: a coal ball with a fuse that sparks. */
    function bomb(g: CanvasRenderingContext2D, x: number, y: number, r: number, shadow: boolean) {
      const c = arena.colors;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw;
      g.beginPath();
      g.moveTo(x + r * 0.4, y - r * 0.75);
      g.quadraticCurveTo(x + r * 0.7, y - r * 1.35, x + r * 1.05, y - r * 1.1);
      g.stroke();
      arena.ball(g, x, y, r, c.coal, shadow);
      if (Math.sin(arena.time * 18 + x) > -0.3) {
        g.fillStyle = c.p[3];
        g.beginPath();
        g.arc(x + r * 1.05, y - r * 1.1, 2.6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = c.bad;
        g.beginPath();
        g.arc(x + r * 1.05, y - r * 1.1, 1.3, 0, Math.PI * 2);
        g.fill();
      }
    }

    /** Rising floor: a hatched platform that climbs from the bottom of the jar. */
    function platform(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const floor = floorOf(s);
      if (floor >= FLOOR) return;
      arena.box(g, s.left, floor, s.right - s.left, FLOOR - floor, c.cellAlt, 0, false);
      g.save();
      g.beginPath();
      g.rect(s.left, floor, s.right - s.left, FLOOR - floor);
      g.clip();
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      for (let hx = s.left - 100; hx < s.right; hx += 10) {
        g.moveTo(hx, FLOOR);
        g.lineTo(hx + 100, FLOOR - 100);
      }
      g.stroke();
      g.restore();
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw;
      g.beginPath();
      g.moveTo(s.left, floor);
      g.lineTo(s.right, floor);
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
      platform(g);
      // Size ladder, up to the goal.
      let lx = 8;
      for (let k = 0; k <= s.target; k++) {
        const r = 5.5 + k * 1.5;
        if (k === s.target) {
          g.fillStyle = arena.tone(c.p[TONE[k]]).glow;
          g.beginPath();
          g.arc(lx + r, 18, r + 3 + Math.sin(arena.time * 4), 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = c.fg;
          g.lineWidth = arena.lw * 0.7;
          g.setLineDash([3, 2]);
          g.stroke();
          g.setLineDash([]);
        }
        // Sizes not made yet are faded.
        g.globalAlpha = k <= s.biggest ? 1 : 0.38;
        fruit(g, k, lx + r, 18, r, false);
        g.globalAlpha = 1;
        ladderX[k] = lx + r;
        lx += 2 * r + 5;
      }
      // Next fruit, top right.
      const nr = Math.min(12, RADII[s.next]);
      piece(g, s.nextType, s.next, W - 12 - nr, 18, nr, false);
      g.fillStyle = c.muted;
      g.font = `700 9px ${arena.family}`;
      g.textAlign = 'center';
      g.fillText(L('next', 'suivant'), W - 12 - nr, 18 + nr + 11);

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
        piece(g, b.type, b.k, b.x, b.y, RADII[b.k] * pop);
      }
      // Chain meter under the ladder: drains until the chain runs out.
      if (s.chain > 1 && !done) {
        g.fillStyle = c.accent;
        g.globalAlpha = 0.85;
        g.fillRect(8, 36, (W - 16) * Math.max(0, s.chainLeft / CHAIN_S), 3);
        g.globalAlpha = 1;
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
        // Piece in hand, its drop guide down to where it would land, and a ghost there.
        const r = RADII[s.current];
        let land = floorOf(s) - r;
        for (const b of s.bodies) {
          const reach = RADII[b.k] + r;
          const dx = b.x - s.aimX;
          if (Math.abs(dx) < reach) land = Math.min(land, b.y - Math.sqrt(reach * reach - dx * dx));
        }
        const ready = s.cooldown <= 0;
        g.strokeStyle = c.muted;
        g.lineWidth = arena.lw * 0.5;
        g.setLineDash([2, 4]);
        g.beginPath();
        g.moveTo(s.aimX, DROP_Y + r);
        g.lineTo(s.aimX, Math.max(DROP_Y + r, land - r));
        g.stroke();
        if (ready && land - r > DROP_Y + r) {
          g.strokeStyle = s.currentType === 'fruit' ? c.p[TONE[s.current]] : c.muted;
          g.lineWidth = arena.lw * 0.8;
          g.globalAlpha = 0.6;
          g.beginPath();
          g.arc(s.aimX, land, r, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }
        g.setLineDash([]);
        g.globalAlpha = ready ? 1 : 0.5;
        piece(g, s.currentType, s.current, s.aimX, DROP_Y + Math.sin(arena.time * 4) * 1.2);
        if (s.currentType === 'bomb') {
          // How far the blast reaches.
          g.strokeStyle = c.bad;
          g.lineWidth = arena.lw * 0.6;
          g.setLineDash([3, 4]);
          g.globalAlpha = 0.5;
          g.beginPath();
          g.arc(s.aimX, land, BLAST, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
          g.globalAlpha = 1;
        }
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
        comboPop(fx, b.x + r * 0.8, b.y - r - 16, s.chain, c.accent);
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
        for (const b of ev.blasts) {
          fx.ring(b.x, b.y, c.bad, 6, BLAST, 0.4, arena.lw * 1.5);
          fx.burst(b.x, b.y, c.p[3], 18, 170, 3.5, 0.6, 'spark', 0);
          fx.burst(b.x, b.y, c.coal, 10, 120, 3, 0.5, 'square', 200);
          fx.shake(4, 0.3);
        }
        if (ev.blasts.length) {
          sfx('boom');
          haptic(35);
        }
        for (const r of ev.crumbled) fx.burst(r.x, r.y, c.muted, 14, 110, 3.5, 0.5, 'square', 300);
        if (ev.crumbled.length) sfx('hit', { pitch: -6 });
        if (ev.power) {
          comboTier(fx, ev.tier, c.accent, POWER_NAMES[ev.power]());
          if (ev.power === 'wild') fx.ring(W - 24, 18, c.accent, 6, 26, 0.5, arena.lw * 1.2);
          else
            for (const b of s.bodies)
              if (b.type === 'fruit' && b.k <= BOMB_MAX + 1) fx.ring(b.x, b.y, c.good, 4, RADII[b.k] * 1.6, 0.4, arena.lw);
        }
        if (ev.merged || ev.power || ev.blasts.length) status();
        if (s.biggest > biggest) {
          // A new size: its ladder slot lights up.
          biggest = s.biggest;
          const lx = ladderX[biggest];
          if (lx != null) {
            const fill = c.p[TONE[biggest]];
            fx.ring(lx, 18, fill, 6, 26, 0.5, arena.lw * 1.2);
            fx.burst(lx, 18, fill, 8, 70, 2.5, 0.45, 'dot', 60);
          }
        }
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
