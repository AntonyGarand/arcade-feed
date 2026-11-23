import './style.css';
import { L } from '../../core/i18n';
import { byLevel, type Difficulty, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  createLevel,
  DRAG_FULL,
  FOOT_X,
  FOOT_Y,
  fuelFor,
  H,
  LIFE_BONUS,
  livesFor,
  MAX_TILT,
  SAFE_TILT,
  SAFE_VX,
  SAFE_VY,
  SHIP_R,
  slowEnough,
  step,
  W,
  windNow,
} from './rules';

const FONT = "700 9px 'Space Grotesk Variable', system-ui, sans-serif";
const BIG = "700 13px 'Space Grotesk Variable', system-ui, sans-serif";

/** Landing score at a level for a pad multiplier, the fuel share left and softness (0–1). */
const scoreAt = (d: Difficulty, mult: number, fuel: number, soft: number) =>
  mult * (100 + Math.round(150 * fuel) + Math.round(50 * soft)) + (livesFor(d) - 1) * LIFE_BONUS;

export const lander: GameDef = {
  id: 'lander',
  get name() {
    return L('Lander', 'Atterrissage');
  },
  get rules() {
    return L('Set the ship down gently on a flat pad.', 'Posez le vaisseau en douceur sur une plateforme.');
  },
  category: 'move',
  help: () => ({
    goal: L(
      'Land on a pad: slowly, upright, both feet on it. Smaller pads pay more.',
      'Posez-vous sur une plateforme : lentement, bien droit, les deux pieds dessus. Les plus petites rapportent plus.',
    ),
    steps: [
      L(
        'Gravity pulls the ship down; the engine pushes it the way its nose points, and burns fuel.',
        'La gravité tire le vaisseau vers le bas; le moteur le pousse là où pointe son nez et brûle du carburant.',
      ),
      L(
        'Touch down slowly (the speed gauge turns green) and nearly upright. Anything else is a crash.',
        'Touchez le sol lentement (la jauge de vitesse devient verte) et presque droit. Sinon, c’est l’écrasement.',
      ),
      L(
        'Hold the middle of the field to fire the engine, and drag sideways while holding to tilt. Hold the left or right third to tilt without the engine. Let go and the ship straightens up.',
        'Maintenez le doigt au milieu du terrain pour allumer le moteur, et glissez de côté en le tenant pour pencher. Maintenez le tiers gauche ou droit pour pencher sans moteur. Relâchez et le vaisseau se redresse.',
      ),
      L(
        'A crash costs an attempt; the next one starts over with a full tank.',
        'Un écrasement coûte un essai; le suivant repart du début avec le plein.',
      ),
      L(
        'Keyboard: ↑, W or Space for the engine, ← → or A D to tilt, P to pause.',
        'Clavier : ↑, W ou Espace pour le moteur, ← → ou A D pour pencher, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Short bursts save fuel. Kill your sideways speed high up, then sink straight down.',
        'Des petits coups économisent le carburant. Arrêtez de glisser de côté en hauteur, puis descendez tout droit.',
      ),
      L(
        'Score: (100 + up to 150 for fuel left + up to 50 for softness) × the pad’s multiplier.',
        'Pointage : (100 + jusqu’à 150 pour le carburant restant + jusqu’à 50 pour la douceur) × le multiplicateur.',
      ),
    ],
  }),
  stars: (d) => {
    // Fuel share a clean run keeps: a lot on Easy, little on Master (less fuel, more gravity and wind).
    const fuel = byLevel(d, [0.6, 0.5, 0.4, 0.3, 0.2]);
    return [scoreAt(d, 2, fuel / 2, 0.3), scoreAt(d, 3, fuel, 0.4)];
  },
  par: (d) => Math.round(fuelFor(d) * 2 + 6),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const max = s.lives;
    const arena = new Arena(ctx.root, W, H, () => draw());
    const keys = new Set<string>();
    let thrustOn = false;
    let pointer = -1;
    let pressX = 0;
    /** Seconds since the last crash or landing (for the effects). */
    let fx = 99;
    let crashAt = { x: 0, y: 0 };
    let shown = '';

    const padColor = (mult: number) => arena.colors.p[[5, 3, 6][mult - 1]];

    const status = () => {
      const fuel = Math.ceil((100 * s.fuel) / s.fuelMax);
      const text =
        s.phase === 'landed'
          ? L(`Landed on ×${s.pad?.mult}!`, `Posé sur ×${s.pad?.mult}!`)
          : [
              L(`Fuel ${fuel}%`, `Carburant ${fuel} %`),
              s.phase === 'boom' ? L('Crashed', 'Écrasé') : slowEnough(s) ? L('speed OK', 'vitesse OK') : L('too fast', 'trop vite'),
            ].join(' · ');
      if (text !== shown) ctx.status((shown = text));
    };

    function gauge(g: CanvasRenderingContext2D, x: number, label: string, share: number, fill: string, tick?: number) {
      const c = arena.colors;
      g.font = FONT;
      g.textAlign = 'left';
      g.fillStyle = c.muted;
      g.fillText(label, x, 13);
      arena.box(g, x, 17, 80, 9, c.cellAlt, 4, false);
      g.fillStyle = fill;
      g.beginPath();
      g.roundRect(x, 17, Math.max(4, 80 * Math.min(1, share)), 9, 4);
      g.fill();
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.7;
      g.beginPath();
      g.roundRect(x, 17, 80, 9, 4);
      g.stroke();
      if (tick != null) {
        g.beginPath();
        g.moveTo(x + 80 * tick, 14);
        g.lineTo(x + 80 * tick, 29);
        g.stroke();
      }
    }

    function drawShip(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.angle);
      if (s.thrust && s.fuel > 0 && s.phase === 'fly') {
        const len = 12 + Math.sin(s.time * 60) * 3;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.6;
        for (const [w, l, col] of [
          [6, len, c.p[0]],
          [3, len * 0.6, c.p[3]],
        ] as const) {
          g.fillStyle = col;
          g.beginPath();
          g.moveTo(-w, SHIP_R - 1);
          g.lineTo(0, SHIP_R + l);
          g.lineTo(w, SHIP_R - 1);
          g.closePath();
          g.fill();
          if (w > 4) g.stroke();
        }
      }
      // Legs and feet, then the hull and its window.
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw;
      g.lineCap = 'round';
      for (const k of [-1, 1]) {
        g.beginPath();
        g.moveTo(k * 4, 4);
        g.lineTo(k * FOOT_X, FOOT_Y);
        g.moveTo(k * FOOT_X - 3, FOOT_Y);
        g.lineTo(k * FOOT_X + 3, FOOT_Y);
        g.stroke();
      }
      if (arena.sh) {
        g.fillStyle = c.drop;
        g.beginPath();
        g.arc(arena.sh * 0.5, arena.sh * 0.5, SHIP_R, 0, Math.PI * 2);
        g.fill();
      }
      arena.disc(g, 0, 0, SHIP_R, c.accent);
      arena.disc(g, 0, -2, 3.6, c.cell);
      g.restore();
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // A few fixed stars.
      g.fillStyle = c.muted;
      for (let i = 0; i < 24; i++) g.fillRect((i * 97 + i * i * 31) % W, 40 + ((i * 61 + i * i * 17) % 190), 1.5, 1.5);
      // Ground.
      g.fillStyle = c.cellAlt;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, H + 2);
      s.ground.forEach((y, i) => g.lineTo((i * W) / (s.ground.length - 1), y));
      g.lineTo(W, H + 2);
      g.closePath();
      g.fill();
      g.stroke();
      for (const p of s.pads) {
        arena.box(g, p.x0, p.y - 3, p.x1 - p.x0, 7, padColor(p.mult), 2);
        g.font = BIG;
        g.textAlign = 'center';
        g.fillStyle = c.fg;
        g.fillText(`×${p.mult}`, (p.x0 + p.x1) / 2, p.y + 20);
      }
      if (s.phase !== 'boom' && s.phase !== 'over') drawShip(g);
      // Crash: a ring and flying debris; landing: a green ring.
      if (fx < 1.2) {
        const k = fx / 1.2;
        g.globalAlpha = 1 - k;
        const at = s.phase === 'landed' ? { x: s.x, y: s.y + FOOT_Y } : crashAt;
        g.strokeStyle = s.phase === 'landed' ? c.good : c.bad;
        g.lineWidth = arena.lw * 1.5;
        g.beginPath();
        g.arc(at.x, at.y, 8 + k * 40, 0, Math.PI * 2);
        g.stroke();
        if (s.phase !== 'landed')
          for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + 0.3;
            const r = 6 + k * (30 + (i % 3) * 12);
            arena.box(g, at.x + Math.cos(a) * r - 2.5, at.y + Math.sin(a) * r - 2.5 - k * 10, 5, 5, i % 2 ? c.accent : c.p[0], 1, false);
          }
        g.globalAlpha = 1;
      }
      // The touch zones, for the first seconds of the run.
      if (s.time < 5) {
        g.globalAlpha = Math.min(1, 5 - s.time) * 0.8;
        g.font = FONT;
        g.fillStyle = c.muted;
        g.textAlign = 'left';
        g.fillText(L('◀ tilt', '◀ pencher'), 10, 48);
        g.textAlign = 'right';
        g.fillText(L('tilt ▶', 'pencher ▶'), W - 10, 48);
        g.textAlign = 'center';
        g.fillText(L('hold: engine', 'maintenir : moteur'), W / 2, 48);
        g.globalAlpha = 1;
        g.strokeStyle = c.muted;
        g.lineWidth = arena.lw * 0.5;
        g.setLineDash([2, 5]);
        g.globalAlpha = Math.min(1, 5 - s.time) * 0.4;
        g.beginPath();
        for (const x of [W / 3, (2 * W) / 3]) {
          g.moveTo(x, 38);
          g.lineTo(x, H * 0.55);
        }
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
      // Gauges: fuel, and speed against the safe limit (the tick), green when slow enough.
      const speed = Math.max(Math.abs(s.vx) / SAFE_VX, Math.max(0, s.vy) / SAFE_VY);
      const safe = slowEnough(s) && Math.abs(s.angle) <= SAFE_TILT;
      gauge(g, 10, L('FUEL', 'CARBURANT'), s.fuel / s.fuelMax, s.fuel / s.fuelMax > 0.25 ? c.accent : c.bad);
      gauge(g, 104, L('SPEED', 'VITESSE'), speed / 2, slowEnough(s) ? c.good : c.bad, 0.5);
      // Touchdown light: speed and tilt both fine.
      arena.disc(g, 200, 21, 6, safe ? c.good : c.bad);
      // Wind: an arrow showing which way and how hard.
      const wind = windNow(s);
      if (wind) {
        const x = 254;
        const len = 8 + Math.abs(wind) * 2;
        const k = Math.sign(wind);
        g.font = FONT;
        g.textAlign = 'center';
        g.fillStyle = c.muted;
        g.fillText(L('WIND', 'VENT'), x, 13);
        g.strokeStyle = c.fg;
        g.lineWidth = arena.lw;
        g.beginPath();
        g.moveTo(x - (k * len) / 2, 22);
        g.lineTo(x + (k * len) / 2, 22);
        g.lineTo(x + (k * len) / 2 - k * 5, 18);
        g.moveTo(x + (k * len) / 2, 22);
        g.lineTo(x + (k * len) / 2 - k * 5, 26);
        g.stroke();
      }
    }

    const syncKeys = () => {
      if (!sides.size) s.turn = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
      if (pointer === -1) s.thrust = keys.has('up');
    };

    // Touch / mouse. Pressing in the middle third fires the engine, and dragging sideways while holding
    // tilts; pressing in the left or right third only tilts that way (no engine). Fingers combine.
    const sides = new Map<number, -1 | 1>();
    const syncTouch = () => {
      let turn = 0;
      for (const k of sides.values()) turn += k;
      s.turn = Math.sign(turn) || (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    };
    const down = (e: PointerEvent) => {
      if (e.button > 0) return;
      const x = arena.toWorld(e).x;
      arena.canvas.setPointerCapture?.(e.pointerId);
      if (x < W / 3 || x > (2 * W) / 3) {
        sides.set(e.pointerId, x < W / 3 ? -1 : 1);
        syncTouch();
        return;
      }
      if (pointer !== -1) return;
      pointer = e.pointerId;
      pressX = x;
      s.thrust = true;
      s.tilt = sides.size ? null : s.angle;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer || sides.size) return;
      const dx = arena.toWorld(e).x - pressX;
      s.tilt = Math.max(-1, Math.min(1, dx / DRAG_FULL)) * MAX_TILT;
    };
    const up = (e: PointerEvent) => {
      if (sides.delete(e.pointerId)) {
        syncTouch();
        return;
      }
      if (e.pointerId !== pointer) return;
      pointer = -1;
      s.tilt = null;
      syncKeys();
    };
    const listeners = [
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointercancel', up],
    ] as const;
    for (const [type, fn] of listeners) arena.canvas.addEventListener(type, fn);

    ctx.score(0);
    ctx.lives(s.lives, max);
    status();
    return {
      draw,
      frame(dt) {
        fx += dt;
        const ev = step(s, dt);
        if (s.thrust !== thrustOn) {
          thrustOn = s.thrust;
          if (thrustOn) sfx('tick', { vol: 0.5 });
        }
        if (ev.crashed) {
          fx = 0;
          crashAt = { x: s.x, y: s.y };
          sfx('boom');
          haptic(30);
          ctx.lives(s.lives, max);
        }
        if (ev.landed) {
          fx = 0;
          ctx.score(s.score);
          sfx('hit', { vol: 0.7 });
        }
        status();
        draw();
        if (ev.landed) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const name =
          k === 'arrowup' || k === 'w' || k === ' '
            ? 'up'
            : k === 'arrowleft' || k === 'a'
              ? 'left'
              : k === 'arrowright' || k === 'd'
                ? 'right'
                : '';
        if (!name) return false;
        if (e.type === 'keydown') keys.add(name);
        else keys.delete(name);
        syncKeys();
        return true;
      },
      destroy() {
        for (const [type, fn] of listeners) arena.canvas.removeEventListener(type, fn);
        arena.destroy();
      },
    };
  },
};
