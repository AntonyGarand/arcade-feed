import './style.css';
import { L } from '../../core/i18n';
import { btn } from '../../core/pad';
import { byLevel, type Difficulty, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { outBack } from '../../kits/arena/ease';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  CHAIN_WINDOW,
  createLevel,
  DRAG_FULL,
  FOOT_X,
  FOOT_Y,
  fuelFor,
  groundAt,
  H,
  LIFE_BONUS,
  livesFor,
  MAX_TILT,
  SAFE_TILT,
  SAFE_VX,
  SAFE_VY,
  SHIP_R,
  SLOW_S,
  slowEnough,
  step,
  W,
  windNow,
  type KindId,
  type Reward,
} from './rules';

/** What each kind of level is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [L('Classic', 'Classique'), L('Rough ground, flat pads: pick one.', 'Sol accidenté, plateformes plates : choisissez.')],
  canyon: () => [L('Canyon', 'Canyon'), L('Each pad sits deep between rock spires.', 'Chaque plateforme est au creux de pics rocheux.')],
  moving: () => [
    L('Moving pad', 'Plateforme mobile'),
    L('The best pad slides along its rail.', 'La meilleure plateforme glisse sur son rail.'),
  ],
  moon: () => [L('Moon', 'Lune'), L('Low gravity, a small tank, no wind.', 'Faible gravité, petit réservoir, pas de vent.')],
  storm: () => [L('Storm', 'Tempête'), L('Strong wind that swings side to side.', 'Un vent fort qui change de bord.')],
  asteroids: () => [
    L('Asteroids', 'Astéroïdes'),
    L('Dodge the rocks drifting across the sky.', 'Évitez les roches qui dérivent dans le ciel.'),
  ],
};

const REWARD_NAMES: Record<Reward, () => string> = {
  refill: () => L('Tank refilled!', 'Le plein!'),
  shield: () => L('Shield!', 'Bouclier!'),
  slow: () => L('Slow motion!', 'Ralenti!'),
};

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
        'Fly through crystals for points and fuel cans for a quarter tank. Each level has a twist: canyon, moving pad, Moon, storm or asteroids.',
        'Traversez les cristaux pour des points et les bidons pour un quart de réservoir. Chaque niveau a sa variante : canyon, plateforme mobile, Lune, tempête ou astéroïdes.',
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
      L(
        'Grab pickups in a quick chain: 3 refills the tank, 5 gives a shield against one hit, 7 slows time down.',
        'Ramassez les bonus en chaîne rapide : 3 font le plein, 5 donnent un bouclier contre un coup, 7 ralentissent le temps.',
      ),
    ],
  }),
  stars: (d) => {
    // Fuel share a clean run keeps: a lot on Easy, little on Master (less fuel, more gravity and wind).
    const fuel = byLevel(d, [0.6, 0.5, 0.4, 0.3, 0.2]);
    // Plus a share of the pickup points (a few crystals on the way for ★★, a short chain for ★★★).
    return [scoreAt(d, 2, fuel / 2, 0.3) + 20, scoreAt(d, 3, fuel, 0.4) + 40];
  },
  par: (d) => Math.round(fuelFor(d) * 2 + 6),
  pad: () => ({
    left: [btn('ArrowLeft', 'ccw', L('Tilt left', 'Pencher à gauche')), btn('ArrowRight', 'cw', L('Tilt right', 'Pencher à droite'))],
    right: [btn('ArrowUp', 'thrust', L('Engine', 'Moteur'))],
  }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const max = s.lives;
    const arena = new Arena(ctx.root, W, H, () => draw());
    const keys = new Set<string>();
    let thrustOn = false;
    let pointer = -1;
    let pressX = 0;
    const fx = arena.fx;
    /** Seconds since the ship (re)appeared at the start: it pops in. */
    let spawn = 0;
    let shown = '';
    const font = (px: number) => `700 ${px}px ${arena.family}`;

    const padColor = (mult: number) => arena.colors.p[[5, 3, 6][mult - 1]];

    const status = () => {
      const fuel = Math.ceil((100 * s.fuel) / s.fuelMax);
      const text =
        s.phase === 'landed'
          ? L(`Landed on ×${s.pad?.mult}!`, `Posé sur ×${s.pad?.mult}!`)
          : [
              L(`Fuel ${fuel}%`, `Carburant ${fuel} %`),
              s.phase === 'boom' ? L('Crashed', 'Écrasé') : slowEnough(s) ? L('speed OK', 'vitesse OK') : L('too fast', 'trop vite'),
              s.chain > 1 ? L(`chain ${s.chain}`, `chaîne ${s.chain}`) : '',
            ]
              .filter(Boolean)
              .join(' · ');
      if (text !== shown) ctx.status((shown = text));
    };

    function gauge(g: CanvasRenderingContext2D, x: number, label: string, share: number, fill: string, tick?: number) {
      const c = arena.colors;
      g.font = font(9);
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
      const pop = spawn < 0.45 ? Math.max(0.02, outBack(spawn / 0.45)) : 1;
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.angle);
      if (pop !== 1) g.scale(pop, pop);
      if (s.thrust && s.fuel > 0 && s.phase === 'fly') {
        const len = 13 + Math.sin(s.time * 60) * 3;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.6;
        for (const [w, l, col] of [
          [5.5, len, c.p[0]],
          [3, len * 0.6, c.p[3]],
        ] as const) {
          g.fillStyle = col;
          g.beginPath();
          g.moveTo(-w, SHIP_R + 1);
          g.quadraticCurveTo(-w * 0.6, SHIP_R + l * 0.6, 0, SHIP_R + 1 + l);
          g.quadraticCurveTo(w * 0.6, SHIP_R + l * 0.6, w, SHIP_R + 1);
          g.closePath();
          g.fill();
          if (w > 4) g.stroke();
        }
      }
      // Legs and feet, the nozzle, then the hull and its window.
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
      g.lineCap = 'butt';
      arena.box(g, -4, SHIP_R - 3, 8, 5, c.muted, 1.5, false);
      arena.ball(g, 0, 0, SHIP_R, c.accent);
      arena.disc(g, 0, -1.5, 3.8, c.coal);
      g.fillStyle = c.paper;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(-1.2, -2.8, 1.3, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.restore();
      if (s.shield) {
        g.strokeStyle = c.p[4];
        g.lineWidth = arena.lw * 1.2;
        g.globalAlpha = 0.55 + 0.3 * Math.sin(arena.time * 6);
        g.beginPath();
        g.arc(s.x, s.y + 1, SHIP_R + 8, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    /** Crystals, fuel cans and drifting rocks. */
    function drawSky(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      for (const p of s.pickups) {
        if (p.taken) continue;
        const y = p.y + Math.sin(arena.time * 3 + p.x) * 2;
        if (p.type === 'gem') {
          g.fillStyle = c.p[4];
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.7;
          g.beginPath();
          g.moveTo(p.x, y - 7);
          g.lineTo(p.x + 5, y);
          g.lineTo(p.x, y + 7);
          g.lineTo(p.x - 5, y);
          g.closePath();
          g.fill();
          g.stroke();
          g.fillStyle = arena.tone(c.p[4]).hi;
          g.fillRect(p.x - 1.5, y - 3, 2, 3);
        } else {
          arena.block(g, p.x - 5, y - 7, 10, 14, c.good, 2);
          g.fillStyle = c.coal;
          g.font = font(8);
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('F', p.x, y + 1);
          g.textBaseline = 'alphabetic';
        }
      }
      for (const r of s.rocks) {
        arena.ball(g, r.x, r.y, r.r, c.muted);
        g.fillStyle = arena.tone(c.muted).lo;
        g.beginPath();
        g.arc(r.x - r.r * 0.3, r.y - r.r * 0.2, r.r * 0.28, 0, Math.PI * 2);
        g.arc(r.x + r.r * 0.35, r.y + r.r * 0.3, r.r * 0.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // A few fixed stars, twinkling.
      g.fillStyle = c.muted;
      for (let i = 0; i < 28; i++) {
        g.globalAlpha = 0.5 + 0.4 * Math.sin(arena.time * (0.8 + (i % 5) * 0.35) + i * 1.7);
        g.beginPath();
        g.arc((i * 97 + i * i * 31) % W, 40 + ((i * 61 + i * i * 17) % 190), i % 4 ? 0.8 : 1.3, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      if (s.kind === 'moon') {
        // The Earth hangs in the sky.
        arena.ball(g, W - 58, 92, 22, c.p[4]);
        g.fillStyle = c.good;
        g.beginPath();
        g.ellipse(W - 64, 86, 8, 5, 0.4, 0, Math.PI * 2);
        g.ellipse(W - 50, 100, 6, 4, -0.3, 0, Math.PI * 2);
        g.fill();
      }
      if (s.swing) {
        // Rain streaks blown by the wind.
        const lean = windNow(s) * 0.9;
        g.strokeStyle = c.muted;
        g.lineWidth = 1;
        g.globalAlpha = 0.45;
        g.beginPath();
        for (let i = 0; i < 26; i++) {
          const x = ((i * 53 + arena.time * lean * 6) % (W + 40)) + (lean < 0 ? W + 40 : 0) - 20;
          const y = (i * 89 + arena.time * 260) % H;
          g.moveTo(x, y);
          g.lineTo(x + lean, y + 10);
        }
        g.stroke();
        g.globalAlpha = 1;
      }
      // Ground: the textured field inside the terrain's outline.
      const ridge = () => s.ground.forEach((y, i) => g.lineTo((i * W) / (s.ground.length - 1), y));
      g.save();
      g.beginPath();
      g.moveTo(0, H + 2);
      ridge();
      g.lineTo(W, H + 2);
      g.closePath();
      g.clip();
      arena.field(g, 0, 0, W, H, 14, 0, false);
      g.restore();
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(0, s.ground[0]);
      ridge();
      g.stroke();
      // Where the ship would come down: a dashed drop line, in the pad's colour while over a pad.
      const under = s.phase === 'fly' ? s.pads.find((p) => s.x - FOOT_X >= p.x0 && s.x + FOOT_X <= p.x1) : undefined;
      if (s.phase === 'fly' && spawn > 0.3) {
        const gy = groundAt(s, s.x);
        const top = s.y + FOOT_Y + 3;
        if (gy - top > 6) {
          g.strokeStyle = under ? padColor(under.mult) : c.muted;
          g.globalAlpha = under ? 0.85 : 0.45;
          g.lineWidth = arena.lw * 0.6;
          g.setLineDash([2, 4]);
          g.beginPath();
          g.moveTo(s.x, top);
          g.lineTo(s.x, gy - 3);
          g.stroke();
          g.setLineDash([]);
          g.globalAlpha = 1;
        }
      }
      for (const p of s.pads) {
        if (!p.rail) continue;
        // The moving pad's rail: a dashed track with stops at both ends.
        const w = p.x1 - p.x0;
        g.strokeStyle = g.fillStyle = padColor(p.mult);
        g.lineWidth = arena.lw;
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(p.rail.lo, p.y + 6);
        g.lineTo(p.rail.hi + w, p.y + 6);
        g.stroke();
        g.setLineDash([]);
        for (const x of [p.rail.lo, p.rail.hi + w]) g.fillRect(x - 1.5, p.y - 2, 3, 10);
      }
      drawSky(g);
      for (const p of s.pads) {
        const fill = padColor(p.mult);
        const mid = (p.x0 + p.x1) / 2;
        arena.block(g, p.x0, p.y - 3, p.x1 - p.x0, 7, fill, 2);
        // Landing lights at both ends: they blink fast while the ship is over this pad.
        const on = Math.sin(arena.time * (under === p ? 16 : 3) + p.x0) > 0;
        for (const x of [p.x0 + 3, p.x1 - 3]) arena.disc(g, x, p.y - 5.5, 2, on ? c.paper : arena.tone(fill).lo);
        g.font = font(12);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const lw = g.measureText(`×${p.mult}`).width + 10;
        arena.box(g, mid - lw / 2, p.y + 9, lw, 15, fill, 7, false);
        g.fillStyle = c.coal;
        g.fillText(`×${p.mult}`, mid, p.y + 17);
        g.textBaseline = 'alphabetic';
      }
      if (s.phase === 'fly' || s.phase === 'landed') drawShip(g);
      // The touch zones, for the first seconds of the run.
      if (s.time < 5) {
        g.globalAlpha = Math.min(1, 5 - s.time) * 0.8;
        g.font = font(9);
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
      // Touchdown light: speed and tilt both fine (a tick or a cross, not just its colour).
      arena.disc(g, 200, 21, 7, safe ? c.good : c.bad);
      g.strokeStyle = c.coal;
      g.lineWidth = 1.8;
      g.lineCap = 'round';
      g.beginPath();
      if (safe) {
        g.moveTo(196.8, 21.2);
        g.lineTo(199, 23.6);
        g.lineTo(203.4, 18.4);
      } else {
        g.moveTo(197.4, 18.4);
        g.lineTo(202.6, 23.6);
        g.moveTo(202.6, 18.4);
        g.lineTo(197.4, 23.6);
      }
      g.stroke();
      g.lineCap = 'butt';
      // Wind: an arrow showing which way and how hard.
      const wind = windNow(s);
      if (wind) {
        const x = 254;
        const len = 8 + Math.abs(wind) * 2;
        const k = Math.sign(wind);
        g.font = font(9);
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
      // Chain meter: drains until the chain of pickups runs out.
      if (s.chain > 0 && s.phase === 'fly') {
        g.fillStyle = c.p[4];
        g.globalAlpha = 0.85;
        g.fillRect(0, 33, W * Math.max(0, s.chainLeft / CHAIN_WINDOW), 3);
        g.globalAlpha = 1;
      }
      // Slow motion: a tinted sky and a draining bar along the bottom.
      if (s.slow > 0) {
        g.fillStyle = c.p[4];
        g.globalAlpha = 0.08;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 0.85;
        g.fillRect(0, H - 4, W * (s.slow / SLOW_S), 4);
        g.globalAlpha = 1;
      }
      arena.overlay(g);
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
        spawn += dt;
        arena.update(dt);
        const ev = step(s, dt);
        const c = arena.colors;
        if (s.thrust !== thrustOn) {
          thrustOn = s.thrust;
          if (thrustOn && s.fuel > 0) sfx('tick', { vol: 0.5 });
        }
        if (s.phase === 'fly' && s.thrust && s.fuel > 0) {
          // Exhaust out of the nozzle, and dust kicked up when the flame nears the ground.
          const a = s.angle + Math.PI / 2;
          const nx = s.x - Math.sin(s.angle) * (SHIP_R + 4);
          const ny = s.y + Math.cos(s.angle) * (SHIP_R + 4);
          fx.burst(nx, ny, Math.random() < 0.5 ? c.p[0] : c.p[3], 1, 90, 2.6, 0.3, 'dot', 0, a, 0.5);
          const gy = groundAt(s, nx);
          if (gy - ny < 50 && Math.random() < 0.5) {
            const right = Math.random() < 0.5;
            fx.burst(nx, gy - 1, c.muted, 1, 90 * (1 - (gy - ny) / 60), 2.4, 0.5, 'dot', -20, right ? -0.25 : Math.PI + 0.25, 0.5);
          }
        }
        if (ev.crashed) {
          fx.burst(s.x, s.y, c.accent, 16, 150, 4, 0.8, 'square', 240, -Math.PI / 2, Math.PI * 1.4);
          fx.burst(s.x, s.y, c.p[0], 12, 120, 3, 0.55, 'dot', 60);
          fx.burst(s.x, s.y, c.p[3], 8, 90, 2.5, 0.4, 'spark', 0);
          fx.ring(s.x, s.y, c.bad, 6, 46, 0.5, arena.lw * 1.5);
          fx.shake(6, 0.4);
          fx.flash(c.bad, 0.3, 0.35);
          sfx('boom');
          haptic(30);
          ctx.lives(s.lives, max);
        }
        for (const p of ev.picked) {
          const col = p.type === 'gem' ? c.p[4] : c.good;
          fx.burst(p.x, p.y, col, 10, 110, 3, 0.45, 'spark', 0);
          fx.ring(p.x, p.y, col, 3, 20, 0.3, arena.lw);
          if (s.chain >= 2) comboPop(fx, p.x, p.y - 6, s.chain, col);
          else sfx('coin', { vol: 0.6 });
          ctx.score(s.bonus);
        }
        if (ev.tier && ev.reward) {
          comboTier(fx, ev.tier, c.p[4], REWARD_NAMES[ev.reward]());
          fx.ring(s.x, s.y, ev.reward === 'refill' ? c.good : c.p[4], 6, 40, 0.5, arena.lw * 1.5);
        }
        if (ev.shielded) {
          fx.ring(s.x, s.y, c.p[4], 8, 50, 0.45, arena.lw * 1.5);
          fx.burst(s.x, s.y, c.p[4], 14, 140, 3, 0.5, 'spark', 0);
          fx.shake(4, 0.3);
          sfx('hit');
          haptic(20);
        }
        if (ev.retry) {
          spawn = 0;
          fx.ring(s.x, s.y, c.accent, 2, 26, 0.4, arena.lw);
        }
        if (ev.landed) {
          const fy = s.y + FOOT_Y;
          fx.burst(s.x - 6, fy, c.muted, 8, 80, 2.6, 0.6, 'dot', -10, Math.PI, 0.5);
          fx.burst(s.x + 6, fy, c.muted, 8, 80, 2.6, 0.6, 'dot', -10, 0, 0.5);
          fx.ring(s.x, fy, c.good, 6, 60, 0.6, arena.lw * 1.5);
          for (const k of [2, 3, 4, 5]) fx.burst(s.x, s.y - 10, c.p[k], 6, 150, 3.5, 0.9, 'square', 200, -Math.PI / 2, Math.PI);
          fx.text(s.x, s.y - 28, `+${s.score}`, padColor(s.pad?.mult ?? 1), 18, 1.4);
          fx.flash(c.good, 0.22, 0.5);
          ctx.score(s.score);
          sfx('coin');
          arena.linger(1.6);
        }
        if (ev.over) arena.linger();
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
