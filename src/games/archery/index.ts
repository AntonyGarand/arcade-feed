import './style.css';
import { L } from '../../core/i18n';
import { aimUpDown, btn, power } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { gestures, type Point } from '../../kits/gesture/gesture';
import { haptic, sfx } from '../../kits/sound/sound';
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
  pad: () => ({ left: aimUpDown(), right: [...power('ArrowLeft', 'ArrowRight'), btn(' ', 'fire', L('Shoot', 'Tirer'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    /** When each arrow stuck (arena time), for its quiver. */
    const stuckAt = new WeakMap<object, number>();
    /** Recent positions of the arrow in flight. */
    let trail: Point[] = [];
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
      g.lineWidth = 2.2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(x - Math.cos(a) * 3, y - Math.sin(a) * 3);
      g.stroke();
      g.lineCap = 'butt';
      // Head.
      g.fillStyle = c.ink;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * 1.5, y + Math.sin(a) * 1.5);
      g.lineTo(x - Math.cos(a) * 5 - Math.sin(a) * 3, y - Math.sin(a) * 5 + Math.cos(a) * 3);
      g.lineTo(x - Math.cos(a) * 5 + Math.sin(a) * 3, y - Math.sin(a) * 5 - Math.cos(a) * 3);
      g.closePath();
      g.fill();
      // Fletching.
      g.fillStyle = c.accent;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.4;
      for (const k of [-1, 1]) {
        g.beginPath();
        g.moveTo(tx + Math.cos(a) * 8, ty + Math.sin(a) * 8);
        g.lineTo(tx - Math.sin(a) * 4.5 * k, ty + Math.cos(a) * 4.5 * k);
        g.lineTo(tx, ty);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }

    /** Wind streaks drifting across the sky: their speed and side show the wind at a glance. */
    function drawWind(g: CanvasRenderingContext2D, w: number) {
      if (!w) return;
      const c = arena.colors;
      const speed = 40 + Math.abs(w) * 1.6;
      const len = 10 + Math.min(30, Math.abs(w) / 4);
      g.strokeStyle = c.muted;
      g.lineWidth = 1.2;
      g.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const span = W + 80;
        const off = (i * 97.3 + arena.time * speed * (0.75 + (i % 3) * 0.15)) % span;
        const x = w > 0 ? off - 40 : W + 40 - off;
        const y = 70 + ((i * 53) % 230);
        g.globalAlpha = 0.18 + (i % 3) * 0.07;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - Math.sign(w) * len, y);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.lineCap = 'butt';
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Sky and ground: a grass strip over the earth.
      arena.field(g, 0, 0, W, GROUND, 25, 0, false);
      const w = s.phase === 'done' ? 0 : wind(s);
      drawWind(g, w);
      g.fillStyle = mix(c.p[7], c.cellAlt, 0.55);
      g.fillRect(0, GROUND, W, H - GROUND);
      g.fillStyle = mix(c.p[7], c.cellAlt, 0.2);
      g.fillRect(0, GROUND, W, 7);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, GROUND);
      g.lineTo(W, GROUND);
      g.stroke();

      // Targets: a face seen at an angle (rings as ellipses) on a stand; the current one is marked.
      const cur = current(s);
      const ringFill = ringFills();
      for (const [i, t] of s.targets.entries()) {
        const y = targetY(s, t) + (i === shaken ? Math.sin(shake * 40) * shake * 3 : 0);
        const live = i === cur && s.phase !== 'done';
        g.globalAlpha = live || s.phase === 'done' ? 1 : 0.35;
        if (t.amp) {
          g.strokeStyle = c.muted;
          g.lineWidth = 1;
          g.setLineDash([3, 4]);
          g.beginPath();
          g.moveTo(t.x + t.r * 0.7, t.y - t.amp);
          g.lineTo(t.x + t.r * 0.7, t.y + t.amp);
          g.stroke();
          g.setLineDash([]);
        }
        // Easel legs (a moving target slides on a pole instead), then the straw back and the face.
        g.strokeStyle = c.ink;
        g.lineCap = 'round';
        if (t.amp) {
          g.lineWidth = arena.lw;
          g.beginPath();
          g.moveTo(t.x + 3, y);
          g.lineTo(t.x + 3, GROUND);
          g.moveTo(t.x - 7, GROUND);
          g.lineTo(t.x + 13, GROUND);
          g.stroke();
        } else {
          g.lineWidth = arena.lw * 1.2;
          g.beginPath();
          g.moveTo(t.x + 3, y + t.r * 0.5);
          g.lineTo(t.x - 10, GROUND);
          g.moveTo(t.x + 3, y + t.r * 0.5);
          g.lineTo(t.x + 14, GROUND);
          g.stroke();
        }
        g.lineCap = 'butt';
        const face = 0.46;
        g.fillStyle = arena.tone(c.p[3]).lo;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.8;
        g.beginPath();
        g.ellipse(t.x + 4, y, t.r * face, t.r, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        for (let k = RINGS.length; k >= 1; k--) {
          const ry = (t.r * k) / RINGS.length;
          g.fillStyle = ringFill[k - 1];
          g.strokeStyle = k === RINGS.length ? c.ink : mix(c.coal, c.paper, 0.45);
          g.lineWidth = k === RINGS.length ? arena.lw * 0.8 : arena.lw * 0.35;
          g.beginPath();
          g.ellipse(t.x, y, Math.max(2, ry * face), ry, 0, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        for (const a of s.stuck) if (a.t === i) drawArrow(g, t.x, y + a.y, a.a + wobble(a));
        if (live) {
          const bob = Math.sin(arena.time * 5) * 2;
          g.fillStyle = c.accent;
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.6;
          g.beginPath();
          g.moveTo(t.x - 8, y - t.r - 19 + bob);
          g.lineTo(t.x + 8, y - t.r - 19 + bob);
          g.lineTo(t.x, y - t.r - 8 + bob);
          g.closePath();
          g.fill();
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      for (const a of s.stuck) if (a.t < 0) drawArrow(g, a.x, a.y, a.a + wobble(a));

      // Aim guide: dots fading out along the first stretch of the flight.
      if (s.phase === 'aim') {
        const path = aimPath(s);
        g.fillStyle = c.fg;
        for (const [i, p] of path.entries())
          if (i % 2 === 0) {
            g.globalAlpha = 0.85 * (1 - i / (path.length + 2));
            g.beginPath();
            g.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
            g.fill();
          }
        g.globalAlpha = 1;
      }

      // The arrow's trail in flight.
      if (s.phase === 'flight' && trail.length > 1) {
        g.strokeStyle = arena.tone(c.accent).glow;
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(trail[0].x, trail[0].y);
        for (const p of trail) g.lineTo(p.x, p.y);
        g.stroke();
        g.lineCap = 'butt';
      }

      // The archer: legs, body, head, arms, and the bow turned to the aim with the string drawn back.
      const ca = Math.cos(s.angle);
      const sa = -Math.sin(s.angle);
      const hip = { x: BOW.x - 14, y: GROUND - 30 };
      const shoulder = { x: hip.x, y: BOW.y - 4 };
      const drawn = s.phase === 'aim' ? s.power : 0;
      const nock = { x: BOW.x - ca * (4 + drawn * 14), y: BOW.y - sa * (4 + drawn * 14) };
      g.strokeStyle = c.ink;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(hip.x - 7, GROUND);
      g.lineTo(hip.x, hip.y);
      g.lineTo(hip.x + 8, GROUND);
      g.moveTo(hip.x, hip.y);
      g.lineTo(shoulder.x, shoulder.y);
      g.stroke();
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(shoulder.x, shoulder.y);
      g.lineTo(BOW.x, BOW.y);
      g.moveTo(shoulder.x, shoulder.y);
      g.lineTo(nock.x, nock.y);
      g.stroke();
      arena.ball(g, hip.x, BOW.y - 17, 7.5, c.accent);
      const tipA = { x: BOW.x + ca * 3 - sa * 22, y: BOW.y + sa * 3 + ca * 22 };
      const tipB = { x: BOW.x + ca * 3 + sa * 22, y: BOW.y + sa * 3 - ca * 22 };
      g.strokeStyle = c.ink;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(tipA.x, tipA.y);
      g.lineTo(nock.x, nock.y);
      g.lineTo(tipB.x, tipB.y);
      g.stroke();
      g.beginPath();
      g.moveTo(tipA.x, tipA.y);
      g.quadraticCurveTo(BOW.x + ca * 16, BOW.y + sa * 16, tipB.x, tipB.y);
      g.lineWidth = 5;
      g.stroke();
      g.lineWidth = 2.6;
      g.strokeStyle = c.p[3];
      g.stroke();
      g.lineCap = 'butt';
      if (s.phase === 'aim') drawArrow(g, nock.x + ca * ARROW_LEN, nock.y + sa * ARROW_LEN, -s.angle);
      if (s.phase === 'flight') drawArrow(g, s.ax, s.ay, Math.atan2(s.vy, s.vx));

      // Power gauge by the archer: fills as the bow is drawn, red near full draw.
      const gh = 84;
      const gy = BOW.y - gh + 6;
      arena.box(g, 6, gy, 11, gh, c.cell, 3, false);
      const pw = s.phase === 'aim' ? s.power : 0;
      const ph = (gh - 4) * pw;
      if (ph > 0) {
        g.fillStyle = pw > 0.85 ? c.bad : c.accent;
        g.beginPath();
        g.roundRect(8, gy + gh - 2 - ph, 7, ph, 2);
        g.fill();
      }

      // Tally: one box per arrow with its points, and a bar towards the goal under it.
      g.font = `700 11px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let i = 0; i < s.arrows; i++) {
        const x = 8 + i * 25;
        const pts = s.hits[i];
        const now = i === s.shot && s.phase !== 'done';
        arena.box(g, x, 8, 21, 21, now ? c.accent : pts ? c.cell : c.cellAlt, 3, now);
        if (pts != null) {
          g.fillStyle = pts ? c.fg : c.muted;
          g.fillText(pts ? String(pts) : '×', x + 10.5, 19);
        }
      }
      const bw = s.arrows * 25 - 4;
      const done = Math.min(1, s.score / s.goal);
      arena.box(g, 8, 34, bw, 8, c.cellAlt, 4, false);
      if (done > 0) {
        g.fillStyle = done >= 1 ? c.good : c.accent;
        g.beginPath();
        g.roundRect(9.5, 35.5, (bw - 3) * done, 5, 2.5);
        g.fill();
      }
      g.fillStyle = c.fg;
      g.font = `700 11px ${FONT}`;
      g.textAlign = 'left';
      g.fillText(`${s.score}/${s.goal}`, 13 + bw, 38.5);

      // Wind flag: side and strength (in steps), fresh for every arrow.
      const fx0 = W - 40;
      g.strokeStyle = c.ink;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(fx0, 8);
      g.lineTo(fx0, 46);
      g.stroke();
      const len = 8 + Math.min(28, Math.abs(w) / 4);
      const dir = w >= 0 ? 1 : -1;
      const wave = Math.sin(arena.time * (4 + Math.abs(w) / 20)) * 2.5;
      g.fillStyle = c.accent;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.moveTo(fx0, 9);
      g.quadraticCurveTo(fx0 + (dir * len) / 2, 9 + wave, fx0 + dir * len, 15 + wave);
      g.quadraticCurveTo(fx0 + (dir * len) / 2, 22 + wave, fx0, 23);
      g.closePath();
      g.fill();
      g.stroke();
      const steps = Math.round(Math.abs(w) / WIND_STEP);
      arena.box(g, fx0 - 24, 50, 48, 18, c.cell, 4, false);
      g.fillStyle = c.fg;
      g.font = `800 12px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(steps ? `${dir > 0 ? '→' : '←'} ${steps}` : L('calm', 'calme'), fx0, 59.5);
      g.textBaseline = 'alphabetic';

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
        arena.disc(g, drag.from.x, drag.from.y, 3.5, c.cell);
        arena.disc(g, drag.to.x, drag.to.y, 5, c.accent);
      }
      arena.overlay(g);
    }

    /** Ring colours, centre first: gold, red, blue, black, white. */
    const ringFills = () => {
      const c = arena.colors;
      return [c.p[3], c.bad, c.p[1], c.coal, c.paper];
    };

    /** A freshly stuck arrow quivers for a moment. */
    function wobble(a: object) {
      const at = stuckAt.get(a);
      const age = at == null ? 9 : arena.time - at;
      return age < 0.5 ? Math.sin(age * 55) * 0.12 * (1 - age / 0.5) : 0;
    }

    const aim = (from: Point, to: Point) => {
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      drag = { from, to };
      if (Math.hypot(dx, dy) < 6) return;
      setAim(s, Math.atan2(-dy, dx), Math.hypot(dx, dy) / PULL_MAX);
    };
    const fire = () => {
      if (!ended && shoot(s)) {
        sfx('shoot');
        status();
      }
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
        arena.update(dt);
        shake = Math.max(0, shake - dt * 2.5);
        if (s.phase === 'flight') {
          trail.push({ x: s.ax, y: s.ay });
          if (trail.length > 14) trail.shift();
        } else trail = [];
        if (ev.landed) {
          const c = arena.colors;
          const last = s.stuck.at(-1);
          if (last) stuckAt.set(last, arena.time);
          if (ev.points) {
            shake = 1;
            shaken = last?.t ?? -1;
            const fill = ringFills()[RINGS.findIndex((r) => r === ev.points)] ?? c.accent;
            fx.burst(ev.x, ev.y, fill, 8 + ev.points, 90 + ev.points * 8, 3, 0.5, 'square', 160, Math.PI, Math.PI * 0.9);
            fx.ring(ev.x, ev.y, fill, 3, 14 + ev.points * 2, 0.35, arena.lw);
            if (ev.points >= 10) {
              sfx('power');
              haptic(20);
              fx.text(ev.x - 10, ev.y - 30, L('Bullseye!', 'En plein dans le mille!'), c.accent, 15, 1.2);
              fx.text(ev.x - 10, ev.y - 10, '+10', c.accent, 17, 1.1);
              fx.flash(c.accent, 0.18, 0.3);
              fx.shake(2.5, 0.2);
            } else {
              sfx('hit', { pitch: ev.points / 2 });
              fx.text(ev.x - 10, ev.y - 16, `+${ev.points}`, ev.points >= 6 ? c.accent : c.fg, 13 + ev.points * 0.3);
            }
          } else {
            sfx('error');
            fx.burst(ev.x, ev.y, c.muted, 10, 70, 2.5, 0.45, 'dot', 220, -Math.PI / 2, Math.PI * 0.8);
            fx.text(ev.x, ev.y - 16, L('Miss', 'Raté'), c.fg, 12);
          }
          ctx.score(s.score);
          status();
        }
        if (ev.next) status();
        if (!ended && (ev.cleared || ev.over)) {
          const c = arena.colors;
          if (ev.cleared) {
            const t = s.targets[s.stuck.at(-1)?.t ?? current(s)] ?? s.targets[0];
            for (let i = 0; i < 4; i++) fx.burst(t.x, targetY(s, t), c.p[i], 10, 170, 3.5, 0.9, 'square', 200);
            fx.flash(c.good, 0.22, 0.5);
          }
          arena.linger(1.4);
        }
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
