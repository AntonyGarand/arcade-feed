import './style.css';
import { L } from '../../core/i18n';
import { btn, leftRight, power } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { alpha, mix } from '../../kits/arena/color';
import { outBack } from '../../kits/arena/ease';
import { gestures, type Point } from '../../kits/gesture/gesture';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { drawExtras, drawPads } from './draw';
import { sfx } from '../../kits/sound/sound';
import {
  BALL_R,
  type Boon,
  COIN_POINTS,
  createLevel,
  CUP_R,
  H,
  type KindId,
  limitFor,
  putt,
  setAim,
  type State,
  step,
  STROKE_POINTS,
  TRICK_TIERS,
  W,
  WALL,
} from './rules';

/** Drag length (world units) for a full-power putt. */
const PULL_MAX = 110;

/** What each kind of hole is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [
    L('Classic hole', 'Trou classique'),
    L('Walls, bumpers and hazards: the usual.', 'Murs, butoirs et obstacles : la base.'),
  ],
  pinball: () => [
    L('Bumper alley', 'Allée des butoirs'),
    L('Bumpers everywhere: bank off them for tricks.', 'Des butoirs partout : rebondissez pour des figures.'),
  ],
  gates: () => [
    L('Moving gates', 'Barrières mobiles'),
    L('Gates slide across every gap: time your putt.', 'Des barrières glissent dans chaque passage.'),
  ],
  speedway: () => [
    L('Speedway', 'Piste rapide'),
    L('Arrow pads kick the ball along: ride them.', 'Les flèches relancent la balle : profitez-en.'),
  ],
  lakes: () => [L('Lakeside', 'Bord du lac'), L('Ponds all over: keep the ball dry.', 'Des étangs partout : gardez la balle au sec.')],
};

const BOON_NAMES: Record<Boon, () => string> = {
  guide: () => L('Full aim guide!', 'Visée complète!'),
  magnet: () => L('Magnet cup!', 'Trou aimanté!'),
  free: () => L('Free putt!', 'Coup gratuit!'),
};

export const golf: GameDef = {
  id: 'golf',
  get name() {
    return L('Mini Golf', 'Minigolf');
  },
  get rules() {
    return L('Sink the ball in as few putts as you can.', 'Envoyez la balle dans le trou en le moins de coups possible.');
  },
  category: 'aim',
  help: () => ({
    goal: L('Get the ball into the cup before you run out of strokes.', 'Mettez la balle dans le trou avant d’avoir épuisé vos coups.'),
    steps: [
      L(
        'The ball rolls, slows down and bounces off walls; round bumpers kick it back harder.',
        'La balle roule, ralentit et rebondit sur les murs; les butoirs ronds la renvoient plus fort.',
      ),
      L(
        'It drops in only if it’s rolling slowly enough over the cup. Sand slows it right down.',
        'Elle ne tombe que si elle roule assez lentement sur le trou. Le sable la freine net.',
      ),
      L(
        'Water costs a penalty stroke and puts the ball back where it was. Arrow pads kick the ball their way; gates slide across gaps.',
        'L’eau coûte un coup de pénalité et ramène la balle où elle était. Les flèches relancent la balle; des barrières glissent dans les passages.',
      ),
      L(
        `Tricks in one putt (bank shots, bumpers, coins, arrows): ${TRICK_TIERS[0]} unlock the full aim guide, ${TRICK_TIERS[1]} a magnet cup, ${TRICK_TIERS[2]} a free putt.`,
        `Figures en un coup (bandes, butoirs, pièces, flèches) : ${TRICK_TIERS[0]} donnent la visée complète, ${TRICK_TIERS[1]} un trou aimanté, ${TRICK_TIERS[2]} un coup gratuit.`,
      ),
      L(
        'Drag back from anywhere (the ball goes the other way, harder the further you pull), release to putt.',
        'Glissez vers l’arrière n’importe où (la balle part à l’opposé, plus fort si vous tirez loin), relâchez pour frapper.',
      ),
      L(
        'Keyboard: ← → to aim, ↑ ↓ for power, Space to putt, P to pause.',
        'Clavier : ← → pour viser, ↑ ↓ pour la puissance, Espace pour frapper, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Every stroke left under the limit is worth ${STROKE_POINTS} points.`,
        `Chaque coup restant sous la limite vaut ${STROKE_POINTS} points.`,
      ),
      L(
        `Coins are worth ${COIN_POINTS} points each and count as tricks.`,
        `Chaque pièce vaut ${COIN_POINTS} points et compte comme une figure.`,
      ),
      L('Bank shots off the walls often beat going the long way around.', 'Un rebond sur un mur vaut souvent mieux qu’un long détour.'),
    ],
  }),
  // Three stars for par (a hole in one on the easy level), two for one stroke more.
  stars: (d) => {
    const three = byLevel(d, [1, 2, 3, 3, 4]);
    return [STROKE_POINTS * (limitFor(d) - three), STROKE_POINTS * (limitFor(d) - three + 1)];
  },
  par: (d) => byLevel(d, [20, 25, 35, 40, 50]),
  pad: () => ({ left: leftRight(), right: [...power('ArrowDown', 'ArrowUp'), btn(' ', 'fire', L('Putt', 'Frapper'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    let drag: { from: Point; to: Point } | null = null;
    /** Recent ball positions, for a short trail. */
    let trail: Point[] = [];
    let ended = false;
    /** The hole is over: the result is reported once the sink (or the miss) has played out, at this arena time. */
    let reportAt = -1;
    let won = false;
    /** When the ball dropped (arena time): it shrinks into the cup and the flag lifts out. */
    let sunkAt = -1;
    /** When each bumper was last hit (arena time), for its pulse. */
    const bumped = new Map<number, number>();
    let inSand = false;
    /** Ball position before the frame's step (a splash puts it back, so the splash shows here). */
    let px = s.bx;
    let py = s.by;
    /** Aim preview: sampled points of the first stretch of the putt, from a copy of the state. */
    const preview: Point[] = [];
    let previewKey = '';

    const status = () =>
      ctx.status(
        [
          `${L('Strokes', 'Coups')} ${s.strokes}/${s.limit}`,
          `${L('par', 'normale')} ${s.par}`,
          `${L('coins', 'pièces')} ${s.coins.filter((c) => c.taken).length}/${s.coins.length}`,
          s.free ? L(`${s.free} free`, `${s.free} gratuit`) : '',
          s.rolling && s.tricks > 1 ? L(`${s.tricks} tricks`, `${s.tricks} figures`) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );

    /** Colours of the course, derived from the theme. */
    const course = () => {
      const c = arena.colors;
      const grass = mix(c.p[2], c.cell, arena.dark ? 0.52 : 0.18);
      return {
        grass,
        stripe: mix(grass, c.paper, arena.dark ? 0.07 : 0.16),
        rail: mix(c.p[0], c.coal, arena.dark ? 0.42 : 0.3),
        frame: mix(c.p[0], c.coal, arena.dark ? 0.6 : 0.5),
      };
    };

    const inZone = (z: { x: number; y: number; w: number; h: number }, x: number, y: number) =>
      x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;

    /** Roll a copy of the ball with the current aim and power: its path up to a little past the first bounce. */
    function plan() {
      // Moving gates change the path as time goes by, so it's replanned every frame on those holes.
      const key = `${s.aim.toFixed(4)}|${s.power.toFixed(3)}|${s.bx}|${s.by}|${s.guide}|${s.gates.length ? s.t.toFixed(3) : ''}`;
      if (key === previewKey) return;
      previewKey = key;
      preview.length = 0;
      const sim: State = structuredClone({ ...s, turn: 0, pump: 0 });
      if (!putt(sim)) return;
      // The full guide (a trick reward) follows the whole roll.
      const reach = s.guide ? Infinity : 40 + s.power * 150;
      let run = 0;
      let after = -1;
      let lx = sim.bx;
      let ly = sim.by;
      preview.push({ x: lx, y: ly });
      for (let i = 0; i < (s.guide ? 1800 : 240) && run < reach && (s.guide || after < 0 || run < after); i++) {
        const ev = step(sim, 1 / 120);
        if (ev.splash || ev.cleared) break;
        run += Math.hypot(sim.bx - lx, sim.by - ly);
        lx = sim.bx;
        ly = sim.by;
        preview.push({ x: lx, y: ly });
        if (ev.bump > 0 && after < 0) after = run + 22;
        if (ev.stopped) break;
      }
    }

    function drawWall(g: CanvasRenderingContext2D, i: number, rail: string) {
      const c = arena.colors;
      const w = s.walls[i];
      switch (w.kind) {
        case 'rect':
          // The border walls are drawn as one frame.
          if (i >= 4) arena.block(g, w.x, w.y, w.w, w.h, rail, 2);
          break;
        case 'disc': {
          const hit = bumped.get(i);
          const k = hit == null ? 0 : Math.max(0, 1 - (arena.time - hit) / 0.25);
          const r = w.r * (1 + 0.22 * k * k);
          arena.ball(g, w.x, w.y, r, c.p[6]);
          g.strokeStyle = arena.tone(c.p[6]).edge;
          g.lineWidth = arena.lw * 0.6;
          g.beginPath();
          g.arc(w.x, w.y, r * 0.5, 0, Math.PI * 2);
          g.stroke();
          if (k > 0) {
            g.globalAlpha = k * 0.8;
            g.fillStyle = c.paper;
            g.beginPath();
            g.arc(w.x, w.y, r, 0, Math.PI * 2);
            g.fill();
            g.globalAlpha = 1;
          }
          break;
        }
        case 'seg': {
          const t = arena.tone(rail);
          g.lineCap = 'round';
          if (arena.sh) {
            g.strokeStyle = c.drop;
            g.lineWidth = w.r * 2;
            g.beginPath();
            g.moveTo(w.x1 + arena.sh * 0.6, w.y1 + arena.sh * 0.6);
            g.lineTo(w.x2 + arena.sh * 0.6, w.y2 + arena.sh * 0.6);
            g.stroke();
          }
          g.strokeStyle = t.edge;
          g.lineWidth = w.r * 2;
          g.beginPath();
          g.moveTo(w.x1, w.y1);
          g.lineTo(w.x2, w.y2);
          g.stroke();
          g.strokeStyle = rail;
          g.lineWidth = w.r * 2 - arena.lw * 1.4;
          g.stroke();
          g.strokeStyle = t.hi;
          g.globalAlpha = 0.6;
          g.lineWidth = Math.max(0.8, w.r * 0.5);
          g.beginPath();
          g.moveTo(w.x1, w.y1 - w.r * 0.35);
          g.lineTo(w.x2, w.y2 - w.r * 0.35);
          g.stroke();
          g.globalAlpha = 1;
          g.lineCap = 'butt';
          break;
        }
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const k = course();
      const iw = W - 2 * WALL;
      const ih = H - 2 * WALL;
      // Fairway: mowed stripes, shaded under the top and left rails.
      g.fillStyle = k.grass;
      g.fillRect(WALL, WALL, iw, ih);
      g.fillStyle = k.stripe;
      for (let y = WALL; y < H - WALL; y += 48) g.fillRect(WALL, y, iw, Math.min(24, H - WALL - y));
      g.fillStyle = c.coal;
      g.globalAlpha = arena.dark ? 0.25 : 0.12;
      g.fillRect(WALL, WALL, iw, 5);
      g.fillRect(WALL, WALL + 5, 4, ih - 5);
      g.globalAlpha = 1;
      // Sand: yellow with a stipple; water: blue with ripples.
      for (const z of s.sand) {
        arena.box(g, z.x, z.y, z.w, z.h, c.p[3], 10, false);
        g.fillStyle = arena.tone(c.p[3]).lo;
        for (let y = z.y + 6; y < z.y + z.h - 3; y += 7)
          for (let x = z.x + 6 + ((y / 7) % 2) * 3; x < z.x + z.w - 3; x += 8) g.fillRect(x, y, 1.6, 1.6);
      }
      for (const z of s.water) {
        arena.box(g, z.x, z.y, z.w, z.h, c.p[1], 8, false);
        g.strokeStyle = c.paper;
        g.lineWidth = 1.2;
        g.globalAlpha = 0.6;
        for (let y = z.y + 8; y < z.y + z.h - 4; y += 8) {
          g.beginPath();
          for (let x = z.x + 6; x < z.x + z.w - 6; x += 2) {
            const yy = y + Math.sin(x / 5 + arena.time * 2) * 1.5;
            if (x === z.x + 6) g.moveTo(x, yy);
            else g.lineTo(x, yy);
          }
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      drawPads(arena, g, s);
      // Frame: a wooden border with the stroke pips (filled: strokes left) set into the top rail.
      g.fillStyle = k.frame;
      g.fillRect(0, 0, W, WALL);
      g.fillRect(0, H - WALL, W, WALL);
      g.fillRect(0, WALL, WALL, ih);
      g.fillRect(W - WALL, WALL, WALL, ih);
      g.fillStyle = arena.tone(k.frame).hi;
      g.globalAlpha = 0.35;
      g.fillRect(0, 0, W, 2);
      g.globalAlpha = 1;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.strokeRect(WALL, WALL, iw, ih);
      for (let i = 0; i < s.limit; i++) {
        const x = W / 2 + (i - (s.limit - 1) / 2) * 13;
        const left = i >= s.strokes;
        g.beginPath();
        g.arc(x, WALL / 2, 3, 0, Math.PI * 2);
        g.fillStyle = left ? c.paper : alpha(c.coal, 0.5);
        g.fill();
        g.strokeStyle = c.coal;
        g.lineWidth = 0.8;
        g.stroke();
      }
      // Free putts (a trick reward): gold pips after the others.
      for (let i = 0; i < s.free; i++) {
        const x = W / 2 + ((s.limit - 1) / 2 + 1.2 + i) * 13;
        arena.disc(g, x, WALL / 2, 3.6, c.p[3]);
      }
      const waiting = !s.rolling && !s.done && !ended;
      // Power gauge along the bottom rail.
      if (waiting) {
        g.fillStyle = mix(c.paper, c.bad, s.power);
        g.beginPath();
        g.roundRect(WALL, H - WALL + 2.5, Math.max(3, iw * s.power), WALL - 5, 2);
        g.fill();
      }
      // Tee mat.
      g.fillStyle = k.stripe;
      g.strokeStyle = alpha(c.paper, 0.5);
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(s.tee.x - 11, s.tee.y - 7, 22, 14, arena.r(3));
      g.fill();
      g.stroke();
      for (let i = 0; i < s.walls.length; i++) drawWall(g, i, k.rail);
      drawExtras(arena, g, s, sunkAt < 0);
      // Cup: a dark hole with a lit lip, and the flag (it lifts out once the ball drops).
      g.fillStyle = alpha(c.paper, 0.35);
      g.beginPath();
      g.arc(s.cup.x, s.cup.y + 1, CUP_R + 2, 0, Math.PI * 2);
      g.fill();
      arena.disc(g, s.cup.x, s.cup.y, CUP_R, c.coal);
      const lift = sunkAt < 0 ? 0 : outBack(Math.min(1, (arena.time - sunkAt) / 0.5));
      const top = s.cup.y - 34 - lift * 14;
      g.strokeStyle = c.coal;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s.cup.x, s.cup.y - lift * 14);
      g.lineTo(s.cup.x, top);
      g.stroke();
      g.fillStyle = c.p[0];
      g.strokeStyle = c.coal;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.moveTo(s.cup.x, top);
      g.lineTo(s.cup.x + 19, top + 6 + Math.sin(arena.time * 3) * 1.8);
      g.lineTo(s.cup.x, top + 12);
      g.closePath();
      g.fill();
      g.stroke();
      // Aim preview: dots along the start of the putt's real path (past the first bounce), then an arrowhead.
      if (waiting) {
        plan();
        let next = BALL_R + 5;
        let run = 0;
        let last: Point | null = null;
        let dir = 0;
        const total = preview.reduce((n, p, i) => (i ? n + Math.hypot(p.x - preview[i - 1].x, p.y - preview[i - 1].y) : 0), 0);
        // Light dots on the dark fairway, dark ones on the light fairway.
        // The full guide (a trick reward) gets its own colour.
        g.fillStyle = s.guide ? c.p[4] : arena.dark ? c.paper : mix(k.grass, c.coal, 0.6);
        for (let i = 1; i < preview.length; i++) {
          const a = preview[i - 1];
          const b = preview[i];
          const seg = Math.hypot(b.x - a.x, b.y - a.y);
          if (seg > 0) dir = Math.atan2(b.y - a.y, b.x - a.x);
          for (const end = seg > 0 ? run + seg : -1; next <= end; next += 8) {
            const f = (next - run) / seg;
            const x = a.x + (b.x - a.x) * f;
            const y = a.y + (b.y - a.y) * f;
            g.globalAlpha = 0.95 - 0.55 * (next / Math.max(1, total));
            g.beginPath();
            g.arc(x, y, 2, 0, Math.PI * 2);
            g.fill();
          }
          run += seg;
          last = b;
        }
        g.globalAlpha = 1;
        if (last && total > BALL_R + 12) {
          const ca = Math.cos(dir);
          const sa = Math.sin(dir);
          g.strokeStyle = c.coal;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(last.x + ca * 6, last.y + sa * 6);
          g.lineTo(last.x - sa * 4.5, last.y + ca * 4.5);
          g.lineTo(last.x + sa * 4.5, last.y - ca * 4.5);
          g.closePath();
          g.fill();
          g.stroke();
        }
        // Power ring around the ball.
        g.lineCap = 'round';
        g.strokeStyle = alpha(c.coal, 0.35);
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(s.bx, s.by, BALL_R + 5, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = mix(c.paper, c.bad, s.power);
        g.beginPath();
        g.arc(s.bx, s.by, BALL_R + 5, -Math.PI / 2, -Math.PI / 2 + Math.max(0.05, s.power) * Math.PI * 2);
        g.stroke();
        g.lineCap = 'butt';
      }
      // Trail and ball (shrinking into the cup once it drops).
      g.fillStyle = c.paper;
      for (const [i, p] of trail.entries()) {
        g.globalAlpha = (i / trail.length) * 0.45;
        g.beginPath();
        g.arc(p.x, p.y, BALL_R * (0.4 + (i / trail.length) * 0.45), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      const shrink = sunkAt < 0 ? 1 : 1 - Math.min(1, (arena.time - sunkAt) / 0.22);
      if (shrink > 0) arena.ball(g, s.bx, s.by, BALL_R * shrink, c.paper, sunkAt < 0);
      // Pointer drag band.
      if (drag) {
        g.strokeStyle = alpha(c.paper, 0.7);
        g.lineWidth = 1.5;
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(drag.from.x, drag.from.y);
        g.lineTo(drag.to.x, drag.to.y);
        g.stroke();
        g.setLineDash([]);
        arena.disc(g, drag.from.x, drag.from.y, 3.5, c.paper);
        arena.disc(g, drag.to.x, drag.to.y, 5, mix(c.paper, c.bad, s.power));
      }
      arena.overlay(g);
    }

    const aim = (from: Point, to: Point) => {
      drag = { from, to };
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      if (Math.hypot(dx, dy) >= 6) setAim(s, Math.atan2(dy, dx), Math.hypot(dx, dy) / PULL_MAX);
    };
    const fire = () => {
      if (ended || !putt(s)) return;
      const c = arena.colors;
      trail = [];
      sfx('hit', { pitch: 6 - s.power * 6 });
      fx.burst(s.bx, s.by, course().stripe, 7, 50 + s.power * 60, 2.5, 0.35, 'dot', 0, s.aim + Math.PI, 1.4);
      fx.ring(s.bx, s.by, c.paper, BALL_R, BALL_R + 10 + s.power * 8, 0.25, arena.lw * 0.8);
      status();
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onMove: (p, from) => {
        if (from && !s.rolling) aim(from, p);
      },
      onTap: () => {
        drag = null;
      },
      onRelease: (p, from) => {
        drag = null;
        if (s.rolling || Math.hypot(from.x - p.x, from.y - p.y) < 10) return;
        aim(from, p);
        drag = null;
        fire();
      },
    });

    /** The name of a finish against par. */
    const finishName = () => {
      const d = s.strokes - s.par;
      if (s.strokes === 1) return L('Hole in one!', 'Trou d’un coup!');
      if (d <= -2) return L('Eagle!', 'Aigle!');
      if (d === -1) return L('Birdie!', 'Oiselet!');
      if (d === 0) return L('Par', 'Normale');
      return L(`+${d} over par`, `+${d} sur la normale`);
    };

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        px = s.bx;
        py = s.by;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        if (s.rolling) {
          trail.push({ x: s.bx, y: s.by });
          if (trail.length > 9) trail.shift();
        } else trail = [];
        if (ev.bump > 40) {
          const bi = s.walls.findIndex((w) => w.kind === 'disc' && Math.hypot(s.bx - w.x, s.by - w.y) < w.r + BALL_R + 2);
          if (bi >= 0) {
            const w = s.walls[bi];
            bumped.set(bi, arena.time);
            if (w.kind === 'disc') fx.ring(w.x, w.y, c.p[6], w.r, w.r + 14, 0.3, arena.lw);
            fx.burst(s.bx, s.by, arena.tone(c.p[6]).hi, 6, 110, 2.5, 0.3, 'spark', 0);
            sfx('hit', { pitch: 7, vol: Math.min(1, ev.bump / 160) });
          } else {
            fx.burst(s.bx, s.by, c.paper, 4, 50 + ev.bump * 0.3, 2, 0.25, 'spark', 0);
            sfx('hit', { pitch: -3, vol: Math.min(1, ev.bump / 200) });
          }
          if (ev.bump > 260) fx.shake(1.5, 0.12);
        }
        for (const p of ev.coins) {
          sfx('coin', { pitch: Math.min(8, s.tricks) });
          fx.burst(p.x, p.y, c.p[3], 10, 90, 2.5, 0.4, 'spark', 0);
          fx.text(p.x, p.y - 12, `+${COIN_POINTS}`, c.p[3], 12);
        }
        for (const p of ev.boosts) {
          sfx('jump', { pitch: 4 });
          fx.ring(p.x, p.y, c.p[4], 6, 26, 0.3, arena.lw);
          fx.burst(s.bx, s.by, arena.tone(c.p[4]).hi, 8, 120, 2.5, 0.3, 'spark', 0, Math.atan2(-s.vy, -s.vx), 0.8);
        }
        if (ev.tricks) {
          comboPop(fx, Math.max(20, Math.min(W - 20, s.bx)), s.by - 10, s.tricks, c.accent);
          if (s.tricks >= 2) status();
        }
        if (ev.tier && ev.unlocked) {
          comboTier(fx, ev.tier, c.accent, BOON_NAMES[ev.unlocked]());
          if (ev.unlocked === 'magnet') fx.ring(s.cup.x, s.cup.y, c.p[4], CUP_R, CUP_R + 40, 0.6, arena.lw * 1.4);
          else if (ev.unlocked === 'free') fx.ring(W / 2, WALL / 2, c.p[3], 4, 40, 0.5, arena.lw);
          status();
        }
        const sand = s.rolling && s.sand.some((z) => inZone(z, s.bx, s.by));
        if (sand && !inSand) {
          fx.burst(s.bx, s.by, arena.tone(c.p[3]).lo, 10, 70, 2.5, 0.4, 'dot', 160, -Math.PI / 2, Math.PI);
          sfx('tick', { pitch: -8 });
        }
        inSand = sand;
        if (ev.splash) {
          sfx('splash');
          fx.ring(px, py, c.paper, 3, 20, 0.45, arena.lw);
          fx.ring(px, py, c.p[1], 6, 30, 0.6, arena.lw * 0.8);
          fx.burst(px, py, arena.tone(c.p[1]).hi, 12, 100, 2.5, 0.5, 'dot', 280, -Math.PI / 2, Math.PI * 0.8);
          fx.text(Math.max(70, Math.min(W - 70, px)), py - 16, L('Splash! +1 stroke', 'Plouf! +1 coup'), c.bad, 13, 1.2);
          fx.ring(s.bx, s.by, c.paper, BALL_R, BALL_R + 12, 0.4, arena.lw);
          status();
        }
        if (ev.stopped) {
          status();
          const miss = Math.hypot(s.bx - s.cup.x, s.by - s.cup.y);
          if (!ev.over && !ev.splash && miss < CUP_R + 18) fx.text(s.bx, s.by - 14, L('So close!', 'Presque!'), c.fg, 11);
        }
        if (ev.cleared) {
          ended = true;
          sunkAt = arena.time;
          sfx('power');
          fx.ring(s.cup.x, s.cup.y, c.paper, CUP_R, CUP_R + 30, 0.5, arena.lw * 1.3);
          for (let i = 0; i < 5; i++) fx.burst(s.cup.x, s.cup.y, c.p[i], 8, 170, 3.5, 0.9, 'square', 240);
          fx.text(s.cup.x < W / 2 ? s.cup.x + 30 : s.cup.x - 30, s.cup.y + 34, finishName(), c.p[3], 16, 1.5);
          fx.flash(c.good, 0.2, 0.45);
          ctx.score(s.score);
          status();
          won = true;
          reportAt = arena.time + 0.3;
        } else if (ev.over) {
          ended = true;
          fx.flash(c.bad, 0.25, 0.4);
          fx.shake(3, 0.3);
          fx.text(W / 2, H / 2, L('Out of strokes', 'Plus de coups'), c.bad, 15, 1.4);
          reportAt = arena.time + 0.25;
        }
        draw();
        if (reportAt >= 0 && arena.time >= reportAt) {
          reportAt = -1;
          arena.linger(0.9);
          if (won) ctx.win();
          else ctx.lose();
        }
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const down = e.type === 'keydown';
        const turn = k === 'arrowright' || k === 'd' ? 1 : k === 'arrowleft' || k === 'a' ? -1 : 0;
        if (turn) {
          if (down) s.turn = turn;
          else if (s.turn === turn) s.turn = 0;
          return true;
        }
        const pump = k === 'arrowup' || k === 'w' ? 1 : k === 'arrowdown' || k === 's' ? -1 : 0;
        if (pump) {
          if (down) s.pump = pump;
          else if (s.pump === pump) s.pump = 0;
          return true;
        }
        if (k === ' ' || k === 'enter') {
          if (down && !e.repeat) fire();
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
