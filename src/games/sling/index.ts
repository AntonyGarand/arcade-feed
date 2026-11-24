import './style.css';
import { L, P } from '../../core/i18n';
import { aimUpDown, btn, power } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { gestures, type Point } from '../../kits/gesture/gesture';
import { haptic, sfx } from '../../kits/sound/sound';
import { drawBand, drawBlob, drawBox, drawFork, drawStone } from './draw';
import { createLevel, type KindId } from './level';
import {
  aimPath,
  BLAST_R,
  CHAIN_TIERS,
  fire,
  GROUND,
  H,
  type Reward,
  setAim,
  SHOT_BONUS,
  shotsFor,
  SLING,
  type State,
  step,
  stoneOf,
  STONE_R,
  TARGET_POINTS,
  targetsFor,
  VIEW_TOP,
  W,
} from './rules';

/** Drag length (world units) for a full pull, and how far the pouch stretches back on screen. */
const PULL_MAX = 110;
const PULL_SHOW = 30;
const VH = H - VIEW_TOP;
/** Stones a clean run needs, per level (the rest earn the bonus): sets the star goals. */
const NEED = [1, 1, 2, 3, 3] as const;

/** What each kind of fort is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  village: () => [L('Village', 'Village'), L('Huts and perches of wood and stone.', 'Des cabanes et des perchoirs en bois et en pierre.')],
  frozen: () => [L('Ice forts', 'Forts de glace'), L('Ice shatters at a tap and slides.', 'La glace éclate au moindre choc et glisse.')],
  sky: () => [
    L('Flying grumps', 'Grognons volants'),
    L('Some grumps hover in the sky: hit them on the wing.', 'Des grognons planent dans le ciel : touchez-les en vol.'),
  ],
  tower: () => [L('Tower', 'Tour'), L('One tall tower: bring it down on itself.', 'Une haute tour : faites-la s’écrouler.')],
  powder: () => [
    L('Powder keg', 'Baril de poudre'),
    L('Dynamite holds the forts up: set it off.', 'De la dynamite tient les forts : faites-la sauter.'),
  ],
};

/** What each chain milestone hands out (banner line and status). */
const REWARD_NAMES: Record<Reward, () => string> = {
  boom: () => L('Explosive stone!', 'Pierre explosive!'),
  stone: () => L('+1 stone!', '+1 pierre!'),
  split: () => L('Triple stone!', 'Pierre triple!'),
};

export const sling: GameDef = {
  id: 'sling',
  get name() {
    return L('Sling', 'Fronde');
  },
  get rules() {
    return L('Fling stones to pop every grumpy blob.', 'Lancez des pierres pour faire éclater les grognons.');
  },
  category: 'aim',
  help: () => ({
    goal: L(
      'Pop every grumpy blob hiding in the forts before you run out of stones.',
      'Faites éclater tous les grognons cachés dans les forts avant de manquer de pierres.',
    ),
    steps: [
      L(
        'A blob pops when a stone or a block hits it hard, when it falls, or when it leaves the field.',
        'Un grognon éclate quand une pierre ou un bloc le frappe fort, quand il tombe ou s’il quitte le terrain. Un grognon ailé éclate au moindre contact.',
      ),
      L(
        'Wood breaks on a solid hit; grey stone is heavy and takes two; blue ice shatters at a tap; red dynamite blows up all around it. Rocks never budge.',
        'Le bois casse sous un bon coup; la pierre grise est lourde et en demande deux; la glace bleue éclate au moindre choc; la dynamite rouge fait tout sauter autour. Les rochers ne bougent jamais.',
      ),
      L(
        'The dotted guide shows only the start of the flight. Each stone waits for everything to settle.',
        'Le guide pointillé ne montre que le début du vol. Chaque pierre attend que tout se calme.',
      ),
      L(
        'Drag back from anywhere (the stone flies the other way, faster the further you pull), release to fling.',
        'Glissez vers l’arrière n’importe où (la pierre part à l’opposé, plus vite si vous tirez loin), relâchez pour lancer.',
      ),
      L(
        'Keyboard: ↑ ↓ to aim, ← → for power, Space to fling, P to pause.',
        'Clavier : ↑ ↓ pour viser, ← → pour la puissance, Espace pour lancer, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Smash ${CHAIN_TIERS[0]} things with one stone for an explosive next stone, ${CHAIN_TIERS[1]} for a stone more, ${CHAIN_TIERS[2]} for a stone that splits in three.`,
        `Démolissez ${CHAIN_TIERS[0]} choses d’une seule pierre pour une pierre explosive, ${CHAIN_TIERS[1]} pour une pierre de plus, ${CHAIN_TIERS[2]} pour une pierre qui se divise en trois.`,
      ),
      L(`Every stone left at the end is worth ${SHOT_BONUS} points.`, `Chaque pierre restante à la fin vaut ${SHOT_BONUS} points.`),
      L(
        'Knock out the posts under a heavy roof: it slides off and squashes what’s below.',
        'Faites sauter les poteaux sous un toit lourd : il glisse et écrase ce qui est dessous.',
      ),
    ],
  }),
  // Three stars for a clear with the stones a clean run needs, two for one more.
  stars: (d) => {
    const base = targetsFor(d) * TARGET_POINTS;
    const spare = shotsFor(d) - byLevel(d, NEED);
    return [base + (spare - 1) * SHOT_BONUS, base + spare * SHOT_BONUS];
  },
  par: (d) => byLevel(d, [10, 12, 20, 28, 32]),
  pad: () => ({ left: aimUpDown(), right: [...power('ArrowLeft', 'ArrowRight'), btn(' ', 'fire', L('Fling', 'Lancer'))] }),
  create(ctx) {
    const s: State = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const arena = new Arena(ctx.root, W, VH, () => {
      if (ended) wash.a = Math.max(0, wash.a - (arena.time - washAt) * 0.7);
      washAt = arena.time;
      draw();
    });
    /** A wash over the whole view (fx's own flash would be shifted with the view). */
    let wash = { color: '', a: 0 };
    let washAt = 0;
    const fx = arena.fx;
    let drag: { from: Point; to: Point } | null = null;
    /** Pouch spring after a shot, 1 → 0. */
    let twang = 0;
    /** Cooldown between impact shakes. */
    let bumpWait = 0;
    let ended = false;
    /** Stone trail: recent positions in flight. */
    let trail: Point[] = [];

    const status = () =>
      ctx.status(
        [
          P(s.targets, ['grump left', 'grumps left'], ['grognon restant', 'grognons restants']),
          P(s.shots - s.used, ['stone', 'stones'], ['pierre', 'pierres']),
          s.boomNext ? L('explosive next', 'prochaine explosive') : '',
          s.splitNext ? L('triple next', 'prochaine triple') : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );

    /** Where the pouch sits: pulled back against the aim while aiming. */
    function pouch(): Point {
      if (s.phase !== 'aim' || ended) return { x: SLING.x, y: SLING.y + Math.sin(twang * 18) * twang * 5 };
      const k = 4 + s.power * PULL_SHOW;
      return { x: SLING.x - Math.cos(s.angle) * k, y: SLING.y + Math.sin(s.angle) * k };
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, VH, 20, 0, false);
      g.save();
      g.translate(0, -VIEW_TOP);
      // Far hills.
      g.fillStyle = arena.tone(c.p[7]).glow;
      g.beginPath();
      g.moveTo(0, GROUND);
      g.quadraticCurveTo(60, GROUND - 70, 130, GROUND - 30);
      g.quadraticCurveTo(210, GROUND - 95, W, GROUND - 40);
      g.lineTo(W, GROUND);
      g.fill();
      // Ground: soil and a grass edge.
      g.fillStyle = c.cell;
      g.fillRect(0, GROUND, W, H - GROUND);
      g.fillStyle = c.p[7];
      g.fillRect(0, GROUND, W, 5);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, GROUND);
      g.lineTo(W, GROUND);
      g.moveTo(0, GROUND + 5);
      g.lineTo(W, GROUND + 5);
      g.stroke();

      const stone = stoneOf(s);
      const look = stone ?? pouch();
      for (const b of s.bodies) if (!b.ball && (b.mat !== 'ground' || b.y < GROUND)) drawBox(arena, g, b);
      for (const b of s.bodies) if (b.mat === 'blob') drawBlob(arena, g, b, look);
      for (const b of s.bodies) if (b.mat === 'shot' && b !== stone) drawStone(arena, g, b.x, b.y, s.phase === 'flight', b.spin, {}, b.hw);

      // Aim guide.
      if (s.phase === 'aim' && !ended) {
        g.fillStyle = c.fg;
        const pts = aimPath(s);
        for (const [i, p] of pts.entries()) {
          g.globalAlpha = 0.8 - (i / pts.length) * 0.6;
          g.beginPath();
          g.arc(p.x, p.y, 2.6 - (i / pts.length) * 1.2, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }

      // Stone trail.
      if (stone && trail.length) {
        g.fillStyle = arena.tone(c.accent).glow;
        for (const [i, p] of trail.entries()) {
          const f = (i + 1) / trail.length;
          g.beginPath();
          g.arc(p.x, p.y, STONE_R * 0.6 * f, 0, Math.PI * 2);
          g.fill();
        }
      }

      // The sling: back arm and band, the stone in the pouch, front arm and band.
      const p = pouch();
      const loaded = s.phase === 'aim' && !ended;
      drawFork(arena, g, -1);
      drawBand(arena, g, -1, p);
      if (loaded) drawStone(arena, g, p.x, p.y, true, 0, { boom: s.boomNext, split: s.splitNext });
      drawFork(arena, g, 1);
      drawBand(arena, g, 1, p);
      if (stone) drawStone(arena, g, stone.x, stone.y, true, stone.spin, stone);

      // A stone above the view: an arrow at the top edge, following it.
      if (stone && stone.y < VIEW_TOP - STONE_R) {
        g.fillStyle = c.accent;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.6;
        const ax = Math.max(8, Math.min(W - 8, stone.x));
        g.beginPath();
        g.moveTo(ax, VIEW_TOP + 3);
        g.lineTo(ax - 6, VIEW_TOP + 12);
        g.lineTo(ax + 6, VIEW_TOP + 12);
        g.closePath();
        g.fill();
        g.stroke();
      }
      // Stones left, top left (in view space).
      g.translate(0, VIEW_TOP);
      for (let i = 0; i < s.shots; i++) {
        const left = i < s.shots - s.used;
        if (left) arena.ball(g, 14 + i * 17, 16, 6, i === 0 && s.boomNext ? c.bad : c.accent, false);
        else {
          g.strokeStyle = c.muted;
          g.lineWidth = 1.2;
          g.beginPath();
          g.arc(14 + i * 17, 16, 5, 0, Math.PI * 2);
          g.stroke();
        }
      }

      // Drag line while pulling with the pointer.
      if (drag) {
        g.strokeStyle = c.muted;
        g.lineWidth = 1.5;
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(drag.from.x, drag.from.y);
        g.lineTo(drag.to.x, drag.to.y);
        g.stroke();
        g.setLineDash([]);
        arena.disc(g, drag.from.x, drag.from.y, 3, c.cell);
      }
      g.translate(0, -VIEW_TOP);
      arena.overlay(g);
      g.restore();
      if (wash.a > 0) {
        g.globalAlpha = wash.a;
        g.fillStyle = wash.color;
        g.fillRect(-10, -10, W + 20, VH + 20);
        g.globalAlpha = 1;
      }
    }

    const inField = (x: number, y: number): [number, number] => [Math.max(12, Math.min(W - 12, x)), Math.max(12, Math.min(H - 12, y))];

    function effects(ev: ReturnType<typeof step>) {
      const c = arena.colors;
      for (const [k, h] of ev.popped.entries()) {
        sfx('pop', { pitch: 5 + k * 3 });
        const [x, y] = inField(h.x, h.y);
        fx.burst(x, y, c.p[2], 16, 150, 4, 0.6, 'dot');
        fx.burst(x, y, c.paper, 6, 90, 2.5, 0.4, 'dot');
        fx.ring(x, y, c.p[2], 4, 26, 0.35, arena.lw);
        fx.text(x, y - 10, `+${h.points}`, c.accent, 14);
        fx.shake(3, 0.2);
      }
      for (const h of ev.broken) {
        sfx('pop', { pitch: h.mat === 'wood' ? 0 : h.mat === 'ice' ? 9 : -5, vol: 0.7 });
        const [x, y] = inField(h.x, h.y);
        const fill = h.mat === 'wood' ? c.p[0] : h.mat === 'ice' ? c.p[5] : h.mat === 'tnt' ? c.bad : c.muted;
        fx.burst(x, y, fill, 12, 120, 3.5, 0.55, 'square');
        fx.burst(x, y, arena.tone(fill).edge, 5, 80, 2, 0.4, 'spark', 200);
        if (h.points) fx.text(x, y - 6, `+${h.points}`, c.fg, 10, 0.7);
      }
      for (const h of ev.cracked) {
        sfx('hit', { pitch: -4 });
        fx.burst(h.x, h.y, c.muted, 6, 70, 2.5, 0.4, 'square');
      }
      for (const b of ev.blasts) {
        const [x, y] = inField(b.x, b.y);
        fx.ring(x, y, c.bad, 6, BLAST_R, 0.4, arena.lw * 1.5);
        fx.burst(x, y, c.accent, 18, 190, 4, 0.6, 'spark', 0);
        fx.burst(x, y, c.bad, 10, 120, 5, 0.5, 'dot', 80);
        fx.shake(5, 0.3);
      }
      if (ev.blasts.length) {
        sfx('boom');
        haptic(40);
      }
      if (ev.split) {
        fx.ring(ev.split.x, ev.split.y, c.accent, 3, 22, 0.3, arena.lw);
        fx.burst(ev.split.x, ev.split.y, arena.tone(c.accent).hi, 8, 90, 2.5, 0.35, 'spark', 0);
        sfx('shoot', { pitch: 5 });
      }
      // The chain: a ×N pop where the last thing broke, a banner and its reward at each milestone.
      const last = ev.popped.at(-1) ?? ev.broken.at(-1);
      if (last && s.chain >= 2) {
        const [x, y] = inField(last.x, last.y);
        comboPop(fx, x, y - 14, s.chain, c.accent);
      }
      for (const r of ev.rewards) comboTier(fx, r.tier, r.reward === 'boom' ? c.bad : c.accent, REWARD_NAMES[r.reward]());
      if (ev.rewards.length) status();
      for (const h of ev.crumbled) {
        fx.burst(h.x, h.y, c.muted, 8, 50, 2.5, 0.45, 'dot', 60);
        fx.ring(h.x, h.y, c.muted, 2, 12, 0.3, 1);
      }
      if (ev.bumps.length && bumpWait <= 0) {
        const top = ev.bumps.reduce((a, b) => (b.v > a.v ? b : a));
        if (top.v > 140) {
          sfx('hit', { pitch: top.v > 320 ? -6 : 0, vol: Math.min(1, top.v / 300) });
          if (top.v > 420) {
            sfx('boom', { vol: 0.6 });
            haptic(25);
          }
          fx.burst(top.x, top.y, c.ink, 5, 90, 2, 0.3, 'spark', 0);
          fx.shake(Math.min(4, top.v / 90), 0.18);
          bumpWait = 0.12;
        }
      }
    }

    const aim = (from: Point, to: Point) => {
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      drag = { from, to };
      if (Math.hypot(dx, dy) < 6) return;
      setAim(s, Math.atan2(-dy, dx), Math.hypot(dx, dy) / PULL_MAX);
    };
    const fling = () => {
      if (ended || !fire(s)) return;
      const c = arena.colors;
      twang = 1;
      sfx('shoot');
      trail = [];
      fx.burst(SLING.x, SLING.y, c.muted, 6, 70, 2.5, 0.3, 'dot', 0, Math.PI - s.angle, 1.2);
      fx.ring(SLING.x, SLING.y, c.accent, 4, 18, 0.25, arena.lw);
      status();
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => {
        const p = arena.toWorld(e);
        return { x: p.x, y: p.y + VIEW_TOP };
      },
      slop: 6,
      onMove: (p, from) => {
        if (from && s.phase === 'aim' && !ended) aim(from, p);
      },
      onTap: () => {
        drag = null;
      },
      onRelease: (p, from) => {
        drag = null;
        if (s.phase !== 'aim' || Math.hypot(from.x - p.x, from.y - p.y) < 12) return;
        aim(from, p);
        drag = null;
        fling();
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const before = s.score;
        const ev = step(s, dt);
        arena.update(dt);
        twang = Math.max(0, twang - dt * 2.5);
        wash.a = Math.max(0, wash.a - dt * 0.7);
        bumpWait -= dt;
        const stone = stoneOf(s);
        if (stone && s.phase === 'flight') {
          trail.push({ x: stone.x, y: stone.y });
          if (trail.length > 8) trail.shift();
        } else trail = [];
        effects(ev);
        if (s.score !== before) ctx.score(s.score);
        if (ev.popped.length || ev.ready) status();
        const c = arena.colors;
        if (ev.cleared && !ended) {
          ended = true;
          for (let i = 0; i < 4; i++) fx.burst(W * (0.55 + i * 0.1), GROUND - 60, c.p[i + 1], 10, 170, 4, 0.9, 'square', 220);
          if (ev.bonus) fx.text(W / 2, H / 2 - 40, `+${ev.bonus}`, c.accent, 18, 1.2);
          wash = { color: c.good, a: 0.25 };
          washAt = arena.time;
          arena.linger(1.4);
        } else if (ev.over && !ended) {
          ended = true;
          wash = { color: c.bad, a: 0.28 };
          washAt = arena.time;
          fx.shake(4, 0.3);
          arena.linger();
        }
        draw();
        if (ev.cleared) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const down = e.type === 'keydown';
        const turn = k === 'arrowup' || k === 'w' ? 1 : k === 'arrowdown' || k === 's' ? -1 : 0;
        if (turn) {
          if (down) s.turn = turn;
          else if (s.turn === turn) s.turn = 0;
          return true;
        }
        const pull = k === 'arrowright' || k === 'd' ? 1 : k === 'arrowleft' || k === 'a' ? -1 : 0;
        if (pull) {
          if (down) s.pull = pull;
          else if (s.pull === pull) s.pull = 0;
          return true;
        }
        if (k === ' ' || k === 'enter') {
          if (down && !e.repeat) fling();
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
