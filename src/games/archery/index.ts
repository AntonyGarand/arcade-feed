import './style.css';
import { L } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures, type Point } from '../../kits/gesture/gesture';
import {
  aimPath,
  ARROW_LEN,
  arrowsFor,
  BOW,
  createLevel,
  current,
  GROUND,
  H,
  RINGS,
  setAim,
  shoot,
  step,
  targetY,
  W,
  wind,
  WIND_STEP,
} from './rules';

/** Drag length (world units) for a full draw. */
const PULL_MAX = 120;
const FONT = "'Space Grotesk Variable', system-ui, sans-serif";

interface Pop {
  x: number;
  y: number;
  t: number;
  text: string;
  good: boolean;
}

export const archery: GameDef = {
  id: 'archery',
  get name() {
    return L('Archery', 'Tir à l’arc');
  },
  get rules() {
    return L('Mind the wind and hit the bullseye.', 'Tenez compte du vent et visez le centre.');
  },
  category: 'aim',
  help: () => ({
    goal: L(
      'Score the points shown with the arrows you have. Rings pay 10, 8, 6, 4 and 2.',
      'Marquez les points demandés avec les flèches que vous avez. Les anneaux valent 10, 8, 6, 4 et 2.',
    ),
    steps: [
      L(
        'Shoot at the marked target; with several targets, they take turns.',
        'Tirez sur la cible marquée; s’il y en a plusieurs, elles passent à tour de rôle.',
      ),
      L(
        'Arrows drop with gravity and drift with the wind: the flag shows its side and strength, new for every arrow.',
        'Les flèches tombent et dérivent au vent : le drapeau montre son sens et sa force, différents à chaque flèche.',
      ),
      L(
        'The dotted guide only shows the start of the flight, without the wind. Some targets move.',
        'Le guide pointillé ne montre que le début du vol, sans le vent. Certaines cibles bougent.',
      ),
      L(
        'Drag back from anywhere to draw and aim (the arrow flies the other way), release to shoot.',
        'Glissez vers l’arrière n’importe où pour bander l’arc et viser (la flèche part à l’opposé), relâchez pour tirer.',
      ),
      L(
        'Keyboard: ↑ ↓ to aim, ← → for power, Space to shoot, P to pause.',
        'Clavier : ↑ ↓ pour viser, ← → pour la puissance, Espace pour tirer, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Wind blowing towards the target carries the arrow further: aim a little lower.',
        'Un vent vers la cible porte la flèche plus loin : visez un peu plus bas.',
      ),
      L('A flatter, faster shot gives the wind less time to act.', 'Un tir plus tendu et plus fort laisse moins de prise au vent.'),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [40, 50],
      [42, 57],
      [45, 56],
      [44, 60],
      [42, 59],
    ] as const),
  par: (d) => arrowsFor(d) * 6 + 5,
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    let pops: Pop[] = [];
    /** Pointer drag in progress: where it started and where it is. */
    let drag: { from: Point; to: Point } | null = null;
    /** Impact wobble of the last target hit. */
    let shake = 0;
    let shaken = -1;
    let ended = false;

    const status = () =>
      ctx.status(`${L('Points', 'Points')} ${s.score}/${s.goal} · ${L('arrow', 'flèche')} ${Math.min(s.shot + 1, s.arrows)}/${s.arrows}`);

    function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, a: number) {
      const c = arena.colors;
      const tx = x - Math.cos(a) * ARROW_LEN;
      const ty = y - Math.sin(a) * ARROW_LEN;
      g.strokeStyle = c.ink;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(x, y);
      g.stroke();
      // Fletching.
      g.fillStyle = c.accent;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.4;
      for (const k of [-1, 1]) {
        g.beginPath();
        g.moveTo(tx + Math.cos(a) * 7, ty + Math.sin(a) * 7);
        g.lineTo(tx - Math.sin(a) * 4 * k, ty + Math.cos(a) * 4 * k);
        g.lineTo(tx, ty);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Ground.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, GROUND, W, H - GROUND);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, GROUND);
      g.lineTo(W, GROUND);
      g.stroke();

      // Targets: a face seen at an angle (rings as ellipses) on a stand; the current one is marked.
      const cur = current(s);
      const ringFill = [c.cell, c.p[5], c.p[1], c.bad, c.p[3]];
      for (const [i, t] of s.targets.entries()) {
        const y = targetY(s, t) + (i === shaken ? Math.sin(shake * 40) * shake * 3 : 0);
        g.globalAlpha = i === cur || s.phase === 'done' ? 1 : 0.4;
        if (t.amp) {
          g.strokeStyle = c.muted;
          g.lineWidth = 1;
          g.setLineDash([3, 4]);
          g.beginPath();
          g.moveTo(t.x + t.r * 0.6, t.y - t.amp);
          g.lineTo(t.x + t.r * 0.6, t.y + t.amp);
          g.stroke();
          g.setLineDash([]);
        }
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw;
        g.beginPath();
        g.moveTo(t.x + 2, y + t.r * 0.5);
        g.lineTo(t.x - 9, GROUND);
        g.moveTo(t.x + 2, y + t.r * 0.5);
        g.lineTo(t.x + 12, GROUND);
        g.stroke();
        for (let k = RINGS.length; k >= 1; k--) {
          const ry = (t.r * k) / RINGS.length;
          g.fillStyle = ringFill[k - 1];
          g.strokeStyle = c.ink;
          g.lineWidth = k === RINGS.length ? arena.lw * 0.8 : arena.lw * 0.35;
          g.beginPath();
          g.ellipse(t.x, y, Math.max(2, ry * 0.32), ry, 0, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        for (const a of s.stuck) if (a.t === i) drawArrow(g, t.x, y + a.y, a.a);
        if (i === cur && s.phase !== 'done') {
          g.fillStyle = c.accent;
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.6;
          g.beginPath();
          g.moveTo(t.x - 7, y - t.r - 16);
          g.lineTo(t.x + 7, y - t.r - 16);
          g.lineTo(t.x, y - t.r - 7);
          g.closePath();
          g.fill();
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      for (const a of s.stuck) if (a.t < 0) drawArrow(g, a.x, a.y, a.a);

      // Aim guide.
      if (s.phase === 'aim') {
        g.fillStyle = c.muted;
        for (const [i, p] of aimPath(s).entries())
          if (i % 2 === 0) {
            g.beginPath();
            g.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
            g.fill();
          }
      }

      // The archer: legs, body, head, and the bow turned to the aim with the string drawn back.
      const ca = Math.cos(s.angle);
      const sa = -Math.sin(s.angle);
      const hip = { x: BOW.x - 14, y: GROUND - 30 };
      g.strokeStyle = c.ink;
      g.lineCap = 'round';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(hip.x - 6, GROUND);
      g.lineTo(hip.x, hip.y);
      g.lineTo(hip.x + 7, GROUND);
      g.moveTo(hip.x, hip.y);
      g.lineTo(hip.x, BOW.y - 4);
      g.lineTo(BOW.x, BOW.y);
      g.stroke();
      arena.disc(g, hip.x, BOW.y - 16, 7, c.accent);
      const drawn = s.phase === 'aim' ? s.power : 0;
      const nock = { x: BOW.x - ca * (4 + drawn * 14), y: BOW.y - sa * (4 + drawn * 14) };
      const tipA = { x: BOW.x + ca * 3 - sa * 22, y: BOW.y + sa * 3 + ca * 22 };
      const tipB = { x: BOW.x + ca * 3 + sa * 22, y: BOW.y + sa * 3 - ca * 22 };
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(tipA.x, tipA.y);
      g.lineTo(nock.x, nock.y);
      g.lineTo(tipB.x, tipB.y);
      g.stroke();
      g.lineWidth = 3.5;
      g.strokeStyle = c.ink;
      g.beginPath();
      g.moveTo(tipA.x, tipA.y);
      g.quadraticCurveTo(BOW.x + ca * 16, BOW.y + sa * 16, tipB.x, tipB.y);
      g.stroke();
      g.lineCap = 'butt';
      if (s.phase === 'aim') drawArrow(g, nock.x + ca * ARROW_LEN, nock.y + sa * ARROW_LEN, -s.angle);
      if (s.phase === 'flight') drawArrow(g, s.ax, s.ay, Math.atan2(s.vy, s.vx));

      // Power gauge by the archer.
      arena.box(g, 8, BOW.y - 70, 9, 70, c.cellAlt, 2, false);
      const ph = 66 * (s.phase === 'aim' ? s.power : 0);
      g.fillStyle = c.accent;
      g.fillRect(10, BOW.y - 2 - ph, 5, ph);

      // Tally: one box per arrow with its points.
      g.font = `700 10px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let i = 0; i < s.arrows; i++) {
        const x = 8 + i * 22;
        const pts = s.hits[i];
        arena.box(g, x, 8, 18, 18, i === s.shot && s.phase !== 'done' ? c.accent : pts ? c.cell : c.cellAlt, 3, false);
        if (pts != null) {
          g.fillStyle = pts ? c.fg : c.muted;
          g.fillText(pts ? String(pts) : '×', x + 9, 17.5);
        }
      }

      // Wind flag: side and strength (in steps), fresh for every arrow.
      const w = s.phase === 'done' ? 0 : wind(s);
      const fx = W - 54;
      g.strokeStyle = c.ink;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(fx, 8);
      g.lineTo(fx, 46);
      g.stroke();
      const len = 6 + Math.min(34, Math.abs(w) / 4);
      const dir = w >= 0 ? 1 : -1;
      const wave = Math.sin(s.time * (4 + Math.abs(w) / 20)) * 2;
      g.fillStyle = c.accent;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.moveTo(fx, 9);
      g.lineTo(fx + dir * len, 14 + wave);
      g.lineTo(fx, 22);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = c.fg;
      g.font = `700 11px ${FONT}`;
      g.textAlign = 'center';
      const steps = Math.round(Math.abs(w) / WIND_STEP);
      g.fillText(steps ? `${dir > 0 ? '→' : '←'} ${steps}` : '0', fx, 56);

      // Drag band while drawing with the pointer.
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

      // Points popping up where the arrow landed.
      g.font = `700 14px ${FONT}`;
      for (const p of pops) {
        g.globalAlpha = Math.min(1, p.t * 2);
        g.fillStyle = p.good ? c.fg : c.muted;
        g.fillText(p.text, p.x, p.y - (1 - p.t) * 20);
      }
      g.globalAlpha = 1;
    }

    const aim = (from: Point, to: Point) => {
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      drag = { from, to };
      if (Math.hypot(dx, dy) < 6) return;
      setAim(s, Math.atan2(-dy, dx), Math.hypot(dx, dy) / PULL_MAX);
    };
    const fire = () => {
      if (!ended && shoot(s)) status();
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onMove: (p, from) => {
        if (from && s.phase === 'aim') aim(from, p);
      },
      onTap: () => {
        drag = null;
      },
      onRelease: (p, from) => {
        drag = null;
        if (s.phase !== 'aim' || Math.hypot(from.x - p.x, from.y - p.y) < 12) return;
        aim(from, p);
        drag = null;
        fire();
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const ev = step(s, dt);
        shake = Math.max(0, shake - dt * 2.5);
        if (ev.landed) {
          if (ev.points) {
            shake = 1;
            shaken = s.stuck.at(-1)?.t ?? -1;
          }
          pops.push({ x: ev.x - 6, y: ev.y - 14, t: 1, text: ev.points ? `+${ev.points}` : L('Miss', 'Raté'), good: ev.points > 0 });
          ctx.score(s.score);
          status();
        }
        if (ev.next) status();
        for (const p of pops) p.t -= dt * 0.9;
        pops = pops.filter((p) => p.t > 0);
        draw();
        if (ended) return;
        if (ev.cleared) {
          ended = true;
          ctx.win();
        } else if (ev.over) {
          ended = true;
          ctx.lose();
        }
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
