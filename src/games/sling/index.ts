import './style.css';
import { L, P } from '../../core/i18n';
import { aimUpDown, btn, power } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures, type Point } from '../../kits/gesture/gesture';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  aimPath,
  type Body,
  createLevel,
  fire,
  GROUND,
  H,
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
  W,
} from './rules';

/** Drag length (world units) for a full pull, and how far the pouch stretches back on screen. */
const PULL_MAX = 110;
const PULL_SHOW = 30;
/** Stones a clean run needs, per level (the rest earn the bonus): sets the star goals. */
const NEED = [1, 1, 2, 3, 3] as const;

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
        'Un grognon éclate quand une pierre ou un bloc le frappe fort, quand il tombe ou s’il quitte le terrain.',
      ),
      L(
        'Wood breaks on a solid hit; grey stone is heavy and takes two. Rocks never budge.',
        'Le bois casse sous un bon coup; la pierre grise est lourde et en demande deux. Les rochers ne bougent jamais.',
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
    const arena = new Arena(ctx.root, W, H, () => draw());
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
        ].join(' · '),
      );

    /** Where the pouch sits: pulled back against the aim while aiming. */
    function pouch(): Point {
      if (s.phase !== 'aim' || ended) return { x: SLING.x, y: SLING.y + Math.sin(twang * 18) * twang * 5 };
      const k = 4 + s.power * PULL_SHOW;
      return { x: SLING.x - Math.cos(s.angle) * k, y: SLING.y + Math.sin(s.angle) * k };
    }

    function drawFork(g: CanvasRenderingContext2D, side: -1 | 1) {
      const c = arena.colors;
      const wood = arena.tone(c.p[0]);
      const top = { x: SLING.x + side * 9, y: SLING.y - 6 };
      const knee = { x: SLING.x, y: SLING.y + 18 };
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const [w, col] of [
        [8, wood.edge],
        [4.5, side < 0 ? wood.lo : wood.base],
      ] as const) {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        if (side > 0) {
          g.moveTo(SLING.x, GROUND - 2);
          g.lineTo(knee.x, knee.y);
        } else g.moveTo(knee.x, knee.y);
        g.lineTo(top.x, top.y);
        g.stroke();
      }
      g.lineCap = 'butt';
    }

    function drawBand(g: CanvasRenderingContext2D, side: -1 | 1, p: Point) {
      g.strokeStyle = arena.colors.ink;
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(SLING.x + side * 9, SLING.y - 6);
      g.lineTo(p.x - STONE_R * 0.6, p.y);
      g.stroke();
    }

    /** The stone: a round pebble with a determined look. */
    function drawStone(g: CanvasRenderingContext2D, x: number, y: number, live: boolean, spin: number) {
      const c = arena.colors;
      arena.ball(g, x, y, STONE_R, live ? c.accent : arena.tone(c.muted).hi, live);
      if (!live) {
        // A pebble's notch, rolling with it.
        g.strokeStyle = arena.tone(c.muted).edge;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, y, STONE_R * 0.55, spin, spin + 1.4);
        g.stroke();
        return;
      }
      for (const dx of [-2.4, 2.4]) {
        g.fillStyle = c.paper;
        g.beginPath();
        g.arc(x + dx + 1, y - 1, 1.9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = c.coal;
        g.beginPath();
        g.arc(x + dx + 1.8, y - 1, 1, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = c.ink;
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(x - 3.6, y - 4.4);
      g.lineTo(x + 4.6, y - 3.4);
      g.stroke();
    }

    /** A grumpy blob: squat, scowling, eyes on the stone. */
    function drawBlob(g: CanvasRenderingContext2D, b: Body, look: Point) {
      const c = arena.colors;
      const r = b.hw;
      const breathe = Math.sin(arena.time * 2.2 + b.id * 1.7) * 0.04;
      g.save();
      g.translate(b.x, b.y + r);
      g.scale(1 + breathe, 1 - breathe);
      arena.ball(g, 0, -r, r, c.p[2]);
      const a = Math.atan2(look.y - b.y, look.x - b.x);
      const blink = (arena.time + b.id * 0.9) % 3.4 < 0.12;
      for (const k of [-1, 1]) {
        const ex = k * r * 0.36;
        const ey = -r * 1.08;
        if (blink) {
          g.strokeStyle = c.coal;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(ex - 2, ey);
          g.lineTo(ex + 2, ey);
          g.stroke();
        } else {
          g.fillStyle = c.paper;
          g.beginPath();
          g.arc(ex, ey, r * 0.27, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = c.coal;
          g.beginPath();
          g.arc(ex + Math.cos(a) * 1.1, ey + Math.sin(a) * 1.1, r * 0.13, 0, Math.PI * 2);
          g.fill();
        }
        // Brows slanting down to the middle: grumpy.
        g.strokeStyle = c.ink;
        g.lineWidth = 1.5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(ex + k * r * 0.32, ey - r * 0.42);
        g.lineTo(ex - k * r * 0.22, ey - r * 0.22);
        g.stroke();
      }
      // Frown.
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(0, -r * 0.42, r * 0.3, Math.PI * 1.2, Math.PI * 1.8);
      g.stroke();
      g.lineCap = 'butt';
      g.restore();
    }

    function drawBox(g: CanvasRenderingContext2D, b: Body) {
      const c = arena.colors;
      const x = b.x - b.hw;
      const y = b.y - b.hh;
      const w = b.hw * 2;
      const h = b.hh * 2;
      if (b.mat === 'ground') {
        arena.block(g, x, y, w, h, c.muted, 5);
        return;
      }
      const fill = b.mat === 'wood' ? c.p[0] : arena.tone(c.muted).hi;
      arena.block(g, x, y, w, h, fill, 2);
      const t = arena.tone(fill);
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.35;
      g.globalAlpha = 0.45;
      g.beginPath();
      if (b.mat === 'wood') {
        // Grain along the long side.
        if (w >= h) {
          g.moveTo(x + 4, y + h * 0.45);
          g.lineTo(x + w - 6, y + h * 0.45);
        } else {
          g.moveTo(x + w * 0.5, y + 4);
          g.lineTo(x + w * 0.5, y + h - 6);
        }
      } else {
        // Speckles, and a crack once hit.
        g.arc(x + w * 0.3, y + h * 0.35, 0.8, 0, Math.PI * 2);
        g.moveTo(x + w * 0.7 + 0.8, y + h * 0.6);
        g.arc(x + w * 0.7, y + h * 0.6, 0.8, 0, Math.PI * 2);
      }
      g.stroke();
      g.globalAlpha = 1;
      if (b.mat === 'stone' && b.hp < 2) {
        g.lineWidth = arena.lw * 0.6;
        g.beginPath();
        g.moveTo(x + w * 0.35, y);
        g.lineTo(x + w * 0.55, y + h * 0.45);
        g.lineTo(x + w * 0.42, y + h * 0.7);
        g.lineTo(x + w * 0.6, y + h);
        g.stroke();
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);
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
      for (const b of s.bodies) if (!b.ball && (b.mat !== 'ground' || b.y < GROUND)) drawBox(g, b);
      for (const b of s.bodies) if (b.mat === 'blob') drawBlob(g, b, look);
      for (const b of s.bodies) if (b.mat === 'shot' && b !== stone) drawStone(g, b.x, b.y, false, b.spin);

      // Aim guide.
      if (s.phase === 'aim' && !ended) {
        g.fillStyle = c.muted;
        const pts = aimPath(s);
        for (const [i, p] of pts.entries()) {
          g.globalAlpha = 1 - (i / pts.length) * 0.7;
          g.beginPath();
          g.arc(p.x, p.y, 2 - (i / pts.length) * 0.8, 0, Math.PI * 2);
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
      drawFork(g, -1);
      drawBand(g, -1, p);
      if (loaded) drawStone(g, p.x, p.y, true, 0);
      drawFork(g, 1);
      drawBand(g, 1, p);
      if (stone) drawStone(g, stone.x, stone.y, true, stone.spin);

      // Stones left, top left.
      for (let i = 0; i < s.shots; i++) {
        const left = i < s.shots - s.used;
        if (left) arena.ball(g, 14 + i * 17, 16, 6, c.accent, false);
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
      arena.overlay(g);
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
        sfx('pop', { pitch: h.mat === 'wood' ? 0 : -5, vol: 0.7 });
        const [x, y] = inField(h.x, h.y);
        const fill = h.mat === 'wood' ? c.p[0] : c.muted;
        fx.burst(x, y, fill, 12, 120, 3.5, 0.55, 'square');
        fx.burst(x, y, arena.tone(fill).edge, 5, 80, 2, 0.4, 'spark', 200);
        if (h.points) fx.text(x, y - 6, `+${h.points}`, c.fg, 10, 0.7);
      }
      for (const h of ev.cracked) {
        sfx('hit', { pitch: -4 });
        fx.burst(h.x, h.y, c.muted, 6, 70, 2.5, 0.4, 'square');
      }
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
      toWorld: (e) => arena.toWorld(e),
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
          fx.flash(c.good, 0.25, 0.5);
          arena.linger(1.4);
        } else if (ev.over && !ended) {
          ended = true;
          fx.flash(c.bad, 0.3, 0.4);
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
