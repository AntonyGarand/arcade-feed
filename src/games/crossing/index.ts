import './style.css';
import { L } from '../../core/i18n';
import { byLevel, type Difficulty, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { gestures, keyDir, type Dir } from '../../kits/gesture/gesture';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  BIG_FREEZE_S,
  COLS,
  createLevel,
  JAWS,
  GOAL_ROW,
  HOME_POINTS,
  homesFor,
  hop,
  HOP_S,
  itemX,
  LIFE_BONUS,
  LIVES,
  RESPAWN_S,
  ROW_POINTS,
  ROWS,
  SLOTS,
  START_ROW,
  step,
  STREAK_TIERS,
  STREAK_WINDOW,
  sunk,
  TIME_POINTS,
  timeFor,
  type KindId,
  type Lane,
  type Reward,
} from './rules';

/** What each kind of level is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [
    L('Classic', 'Classique'),
    L('Cars on the road, logs on the river.', 'Des autos sur la route, des billots sur la rivière.'),
  ],
  rush: () => [L('Rush hour', 'Heure de pointe'), L('Five lanes of packed, faster traffic.', 'Cinq voies de circulation dense et rapide.')],
  railway: () => [
    L('Railway', 'Chemin de fer'),
    L('Trains thunder by: watch the red signals.', 'Des trains passent en trombe : surveillez les feux.'),
  ],
  turtles: () => [
    L('Turtle bay', 'Baie des tortues'),
    L('Ride turtles, but some of them dive.', 'Montez sur les tortues, mais certaines plongent.'),
  ],
  flood: () => [L('Flood', 'Inondation'), L('The river has swallowed half the road.', 'La rivière a englouti la moitié de la route.')],
  night: () => [L('Night', 'Nuit'), L('Dark out: you only see what is near.', 'Il fait noir : vous ne voyez que de près.')],
};

const REWARD_NAMES: Record<Reward, () => string> = {
  freeze: () => L('Traffic frozen!', 'Circulation gelée!'),
  shield: () => L('Shield!', 'Bouclier!'),
  bigFreeze: () => L('Big freeze!', 'Grand gel!'),
};

/** Seconds before a train shows up that its signal starts blinking. */
const WARN_S = 2;

const CELL = 32;
const W = COLS * CELL;
const H = ROWS * CELL;

/** Seconds per home for a fast clean run (three stars) and a decent one (two stars, one splash allowed). */
const fastPerHome = (d: Difficulty) => byLevel(d, [4.5, 4.5, 5.5, 6.5, 6.5]);
const okPerHome = (d: Difficulty) => byLevel(d, [8, 9, 10, 11, 11]);
const base = (d: Difficulty) => homesFor(d) * ((START_ROW - GOAL_ROW) * ROW_POINTS + HOME_POINTS) + LIVES * LIFE_BONUS;

export const crossing: GameDef = {
  id: 'crossing',
  get name() {
    return L('Crossing', 'Traversée');
  },
  get rules() {
    return L('Hop across the road and river to reach home.', 'Sautez par-dessus route et rivière jusqu’à l’abri.');
  },
  category: 'move',
  help: () => ({
    goal: L(
      'Hop your critter into the home slots across the far bank before the time runs out.',
      'Menez votre bestiole jusqu’aux abris de l’autre rive avant la fin du temps.',
    ),
    steps: [
      L(
        'Cross the road between the cars: getting hit costs a heart.',
        'Traversez la route entre les voitures : vous faire frapper coûte un cœur.',
      ),
      L(
        'On the river, ride the logs: they carry you along. The water, or drifting off the edge, costs a heart.',
        'Sur la rivière, montez sur les billots : ils vous emportent. L’eau, ou sortir par le bord, coûte un cœur.',
      ),
      L(
        'Each home slot takes one critter; the hedge between them blocks the way.',
        'Chaque abri accueille une bestiole; la haie entre les abris bloque le passage.',
      ),
      L(
        'Levels vary: trains (a red signal blinks first), turtles that dive, crocodiles whose jaws bite, floods, night.',
        'Les niveaux varient : trains (un feu rouge clignote avant), tortues qui plongent, crocodiles qui mordent, inondations, nuit.',
      ),
      L(
        'Swipe to hop one square. Tap above your critter to hop forward, beside it to hop sideways.',
        'Balayez pour sauter d’une case. Touchez au-dessus de la bestiole pour avancer, à côté pour aller de côté.',
      ),
      L(
        'Keyboard: arrows or WASD to hop, Space to hop forward, P to pause.',
        'Clavier : flèches ou WASD pour sauter, Espace pour avancer, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `New rows are worth ${ROW_POINTS}, a home ${HOME_POINTS}; each second left adds ${TIME_POINTS} and each heart ${LIFE_BONUS}.`,
        `Chaque nouvelle rangée vaut ${ROW_POINTS}, un abri ${HOME_POINTS}; chaque seconde restante ajoute ${TIME_POINTS} et chaque cœur ${LIFE_BONUS}.`,
      ),
      L(
        'Grass strips are safe: wait there for a gap or the right log.',
        'Les bandes de gazon sont sûres : attendez-y une ouverture ou le bon billot.',
      ),
      L(
        `Hop forward quickly without stopping: ${STREAK_TIERS[0]} in a row freezes traffic, ${STREAK_TIERS[1]} gives a shield against one hit, ${STREAK_TIERS[2]} a longer freeze.`,
        `Avancez vite sans vous arrêter : ${STREAK_TIERS[0]} sauts de suite gèlent la circulation, ${STREAK_TIERS[1]} donnent un bouclier contre un coup, ${STREAK_TIERS[2]} un gel plus long.`,
      ),
    ],
  }),
  stars: (d) => {
    const n = homesFor(d);
    return [
      base(d) - LIFE_BONUS + Math.round(timeFor(d) - n * okPerHome(d)) * TIME_POINTS,
      base(d) + Math.round(timeFor(d) - n * fastPerHome(d)) * TIME_POINTS,
    ];
  },
  par: (d) => Math.round(homesFor(d) * okPerHome(d) + 5),
  pad: () => ({ left: 'dpad' }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const arena = new Arena(ctx.root, W, H, () => draw());
    /** Last hop: where it started, for the jump animation, and its direction (the eyes look that way). */
    let from = { x: s.x, row: s.row };
    let facing: Dir = 0;
    const fx = arena.fx;
    let ended = false;
    /** Where the hopper went down, for the splash/squash mark. */
    let wreck: { x: number; row: number; water: boolean } | null = null;
    /** Seconds left of the flash on a freshly filled slot. */
    let homeFlash = 0;
    let lastSlot = -1;
    let shown = -1;

    const secondsLeft = () => Math.max(0, Math.ceil(s.limit - s.time));
    const status = () => {
      shown = secondsLeft();
      ctx.status(
        [`${L('Home', 'Abris')} ${s.homes}/${s.need}`, `${shown} s`, s.streak > 2 ? L(`streak ${s.streak}`, `série ${s.streak}`) : '']
          .filter(Boolean)
          .join(' · '),
      );
    };

    function drawHopper(g: CanvasRenderingContext2D, cx: number, cy: number, scale: number, dir: Dir) {
      const c = arena.colors;
      const r = CELL * 0.34 * scale;
      // Feet, then body, then eyes looking where it hops.
      const lx = dir === 1 || dir === 3 ? 0 : 1;
      const fy = 1 - lx;
      const t = arena.tone(c.accent);
      for (const k of [-1, 1]) arena.disc(g, cx + k * r * 0.78 * lx, cy + k * r * 0.78 * fy, r * 0.36, t.lo);
      arena.ball(g, cx, cy, r, c.accent);
      const ex = dir === 1 ? 1 : dir === 3 ? -1 : 0;
      const ey = dir === 0 ? -1 : dir === 2 ? 1 : 0;
      for (const k of [-1, 1]) {
        const px = cx + ex * r * 0.35 + k * r * 0.42 * (ey ? 1 : 0);
        const py = cy + ey * r * 0.35 + k * r * 0.42 * (ex ? 1 : 0);
        arena.disc(g, px, py, r * 0.28, c.paper);
        g.fillStyle = c.coal;
        g.beginPath();
        g.arc(px + ex * r * 0.1, py + ey * r * 0.1, r * 0.12, 0, Math.PI * 2);
        g.fill();
      }
    }

    function drawLanes(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      for (let r = 0; r < ROWS; r++) {
        const lane = s.lanes[r];
        const y = r * CELL;
        g.globalAlpha = lane.kind === 'river' ? 0.5 : lane.kind === 'road' ? 0.28 : 0.22;
        g.fillStyle = lane.kind === 'river' ? c.p[1] : lane.kind === 'road' ? c.muted : c.p[2];
        g.fillRect(0, y, W, CELL);
        g.globalAlpha = 1;
        if (lane.kind === 'river') {
          // Ripples drifting with the current.
          g.strokeStyle = c.cell;
          g.lineWidth = 1.2;
          g.globalAlpha = 0.6;
          const off = (((lane.speed * s.clock * 0.5) % 2) + 2) % 2;
          for (let k = -1; k < COLS + 1; k += 2) {
            const x = (k + off) * CELL;
            g.beginPath();
            g.moveTo(x + 6, y + CELL * 0.55);
            g.quadraticCurveTo(x + 12, y + CELL * 0.4, x + 18, y + CELL * 0.55);
            g.stroke();
          }
          g.globalAlpha = 1;
        }
        if (lane.rail) drawRail(g, lane, y);
        else if (lane.kind === 'road' && s.lanes[r + 1].kind === 'road' && !s.lanes[r + 1].rail) {
          g.strokeStyle = c.cell;
          g.lineWidth = 2;
          g.setLineDash([10, 10]);
          g.beginPath();
          g.moveTo(0, y + CELL);
          g.lineTo(W, y + CELL);
          g.stroke();
          g.setLineDash([]);
        }
      }
      // Far bank: hedge with home slots.
      g.fillStyle = c.p[2];
      g.fillRect(0, 0, W, CELL);
      SLOTS.forEach((col, k) => {
        const x = col * CELL;
        arena.box(g, x + 3, 4, CELL - 6, CELL - 6, k === lastSlot && homeFlash > 0 ? c.good : c.cellAlt, 6, false);
        if (s.filled[k]) drawHopper(g, x + CELL / 2, CELL / 2, 0.8, 2);
      });
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, CELL);
      g.lineTo(W, CELL);
      g.stroke();
    }

    function drawItems(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      for (let r = 0; r < ROWS; r++) {
        const lane = s.lanes[r];
        const y = r * CELL;
        for (const it of lane.items) {
          const x = itemX(lane, it, s.clock) * CELL;
          const w = it.len * CELL;
          if (it.type === 'turtle') {
            drawTurtles(g, x, y, it.len, sunk(it, s.clock));
            continue;
          }
          if (it.type === 'train') {
            drawTrain(g, x, y, w, lane.speed > 0);
            continue;
          }
          if (lane.kind === 'river') {
            const croc = it.type === 'croc';
            const wood = croc ? arena.tone(c.p[2]).lo : arena.tone(c.p[0]).lo;
            arena.block(g, x + 1, y + 5, w - 2, CELL - 10, wood, 8);
            // Wood grain, and the cut rings at both ends.
            const wt = arena.tone(wood);
            g.strokeStyle = wt.edge;
            g.lineWidth = 1;
            g.globalAlpha = 0.4;
            for (let k = 1; k < it.len; k++) {
              g.beginPath();
              g.moveTo(x + k * CELL - 7 + (k % 2) * 4, y + CELL * 0.4);
              g.lineTo(x + k * CELL + 5 + (k % 2) * 4, y + CELL * 0.4);
              g.stroke();
            }
            g.globalAlpha = 1;
            if (croc) {
              drawJaws(g, x, y, w, lane.speed > 0);
              continue;
            }
            g.fillStyle = wt.hi;
            for (const ex of [x + 7, x + w - 7]) {
              g.beginPath();
              g.ellipse(ex, y + CELL / 2 - 1, 3, CELL / 2 - 8, 0, 0, Math.PI * 2);
              g.fill();
              g.stroke();
            }
            continue;
          }
          // Wheels on the sides, the body, then the windscreen and headlights at the front.
          g.fillStyle = c.coal;
          g.beginPath();
          for (const wx of [x + 8, x + w - 14]) {
            g.roundRect(wx, y + 2.5, 6, 4, 1.5);
            g.roundRect(wx, y + CELL - 6.5, 6, 4, 1.5);
          }
          g.fill();
          arena.block(g, x + 3, y + 5, w - 6, CELL - 10, c.p[it.tone], 5);
          const ahead = lane.speed > 0;
          const front = ahead ? x + w - 14 : x + 7;
          arena.box(g, front, y + 9, 7, CELL - 18, mix(c.p[1], c.paper, 0.55), 2, false);
          g.fillStyle = c.p[3];
          for (const ly of [y + 9, y + CELL - 9]) {
            g.beginPath();
            g.arc(ahead ? x + w - 4.5 : x + 4.5, ly, 1.6, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }

    /** Train tracks: sleepers and two rails, and a signal at each end that blinks while a train is near. */
    function drawRail(g: CanvasRenderingContext2D, lane: Lane, y: number) {
      const c = arena.colors;
      g.fillStyle = arena.tone(c.p[0]).lo;
      g.globalAlpha = 0.55;
      for (let x = 4; x < W; x += 12) g.fillRect(x, y + 4, 5, CELL - 8);
      g.globalAlpha = 1;
      g.strokeStyle = c.muted;
      g.lineWidth = 2;
      g.beginPath();
      for (const ry of [y + 10, y + CELL - 10]) {
        g.moveTo(0, ry);
        g.lineTo(W, ry);
      }
      g.stroke();
      const it = lane.items[0];
      const x = itemX(lane, it, s.clock);
      const v = Math.abs(lane.speed);
      const until = lane.speed > 0 ? -(x + it.len) / v : (x - COLS) / v;
      const near = until < WARN_S && (until > 0 || (x < COLS && x + it.len > 0));
      const on = near && Math.sin(arena.time * 14) > 0;
      for (const sx of [5, W - 5]) arena.disc(g, sx, y + CELL / 2, 4, on ? c.bad : c.cellAlt);
    }

    function drawTrain(g: CanvasRenderingContext2D, x: number, y: number, w: number, right: boolean) {
      const c = arena.colors;
      const fill = c.p[7];
      arena.block(g, x + 1, y + 3, w - 2, CELL - 6, fill, 6);
      // Windows along the carriages, and a lamp on the nose.
      g.fillStyle = mix(c.p[1], c.paper, 0.55);
      for (let k = 0.5; k < w / CELL - 0.5; k += 1) g.fillRect(x + k * CELL + 4, y + 9, CELL - 14, CELL - 18);
      g.fillStyle = arena.tone(fill).edge;
      for (let k = 1; k < w / CELL; k += 2) g.fillRect(x + k * CELL - 1, y + 4, 2, CELL - 8);
      arena.disc(g, right ? x + w - 5 : x + 5, y + CELL / 2, 3, c.p[3]);
    }

    /** A crocodile's head at the end it swims towards: an eye, and jaws snapping. */
    function drawJaws(g: CanvasRenderingContext2D, x: number, y: number, w: number, right: boolean) {
      const c = arena.colors;
      const k = right ? 1 : -1;
      const tip = right ? x + w - 2 : x + 2;
      const back = tip - k * JAWS * CELL;
      const open = 3 + Math.abs(Math.sin(arena.time * 4)) * 4;
      g.fillStyle = c.bad;
      g.beginPath();
      g.moveTo(back, y + CELL / 2);
      g.lineTo(tip, y + CELL / 2 - open);
      g.lineTo(tip, y + CELL / 2 + open);
      g.closePath();
      g.fill();
      g.fillStyle = c.paper;
      for (let t = 0.25; t < 1; t += 0.3) {
        const tx = back + (tip - back) * t;
        g.fillRect(tx - 1, y + CELL / 2 - open * t - 1, 2, 2.5);
        g.fillRect(tx - 1, y + CELL / 2 + open * t - 1.5, 2, 2.5);
      }
      arena.disc(g, back - k * 4, y + 9, 3, c.paper);
      arena.disc(g, back - k * 4, y + 9, 1.4, c.coal);
    }

    /** A group of turtles, fading under the water as they dive (`under` 0 to 1). */
    function drawTurtles(g: CanvasRenderingContext2D, x: number, y: number, n: number, under: number) {
      const c = arena.colors;
      for (let k = 0; k < n; k++) {
        const cx = x + (k + 0.5) * CELL;
        const cy = y + CELL / 2;
        if (under >= 1) {
          g.strokeStyle = c.cell;
          g.lineWidth = 1.2;
          g.globalAlpha = 0.7;
          g.beginPath();
          g.arc(cx, cy, CELL * 0.25 + Math.sin(arena.time * 5 + k) * 2, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
          continue;
        }
        g.globalAlpha = 1 - under * 0.7;
        const shell = under > 0 && Math.sin(arena.time * 12) > 0 ? c.bad : c.good;
        arena.disc(g, cx + CELL * 0.33, cy, 4, arena.tone(c.good).lo);
        arena.ball(g, cx, cy, CELL * 0.34 * (1 - under * 0.3), shell);
        g.strokeStyle = arena.tone(shell).edge;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cx - 5, cy);
        g.lineTo(cx + 5, cy);
        g.moveTo(cx, cy - 5);
        g.lineTo(cx, cy + 5);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    /** Night: everything but the far bank fades into the dark, apart from a circle around the critter and the headlights. */
    function drawNight(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const k = s.cool > 0 && !s.dead ? 1 - s.cool / HOP_S : 1;
      const cx = (from.x + (s.x - from.x) * k + 0.5) * CELL;
      const cy = (from.row + (s.row - from.row) * k + 0.5) * CELL;
      g.fillStyle = c.coal;
      g.globalAlpha = 0.72;
      g.beginPath();
      g.rect(0, CELL, W, H - CELL);
      g.arc(cx, cy, CELL * 2.3, 0, Math.PI * 2, true);
      g.fill('evenodd');
      g.globalAlpha = 1;
      for (let r = 0; r < ROWS; r++) {
        const lane = s.lanes[r];
        if (lane.kind !== 'road') continue;
        for (const it of lane.items) {
          const x = itemX(lane, it, s.clock) * CELL;
          const front = lane.speed > 0 ? x + it.len * CELL : x;
          if (front < -CELL || front > W + CELL) continue;
          g.fillStyle = c.p[3];
          g.globalAlpha = 0.25;
          g.beginPath();
          g.moveTo(front, r * CELL + CELL / 2);
          g.lineTo(front + Math.sign(lane.speed) * CELL * 1.6, r * CELL + 2);
          g.lineTo(front + Math.sign(lane.speed) * CELL * 1.6, r * CELL + CELL - 2);
          g.closePath();
          g.fill();
          g.globalAlpha = 1;
          arena.disc(g, front - Math.sign(lane.speed) * 4, r * CELL + CELL / 2, 3, c.p[3]);
        }
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      drawLanes(g);
      drawItems(g);
      if (s.freeze > 0) {
        // Frozen traffic: a frosty tint over the lanes.
        g.fillStyle = c.p[4];
        g.globalAlpha = 0.14 + 0.05 * Math.sin(arena.time * 8);
        g.fillRect(0, CELL, W, H - 2 * CELL);
        g.globalAlpha = 0.9;
        g.fillRect(0, CELL, W * Math.min(1, s.freeze / BIG_FREEZE_S), 3);
        g.globalAlpha = 1;
      }
      if (wreck && s.dead > 0) {
        const cx = (wreck.x + 0.5) * CELL;
        const cy = (wreck.row + 0.5) * CELL;
        const k = 1 - s.dead / RESPAWN_S;
        g.strokeStyle = wreck.water ? c.cell : c.bad;
        g.lineWidth = arena.lw;
        for (const rr of [0.3, 0.55]) {
          g.beginPath();
          g.arc(cx, cy, CELL * (rr + k * 0.5), 0, Math.PI * 2);
          g.stroke();
        }
        if (!wreck.water) {
          g.fillStyle = c.bad;
          g.beginPath();
          g.ellipse(cx, cy, CELL * 0.38, CELL * 0.18, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (!s.dead) {
        // Hop animation: slide from the last cell with a little bounce.
        const k = s.cool > 0 ? 1 - s.cool / HOP_S : 1;
        const hx1 = from.x + (s.x - from.x) * k;
        const fy = from.row + (s.row - from.row) * k;
        drawHopper(g, (hx1 + 0.5) * CELL, (fy + 0.5) * CELL, 1 + Math.sin(Math.PI * k) * 0.25, facing);
        if (s.shield) {
          g.strokeStyle = c.p[4];
          g.lineWidth = arena.lw * 1.2;
          g.globalAlpha = 0.6 + 0.3 * Math.sin(arena.time * 6);
          g.beginPath();
          g.arc((hx1 + 0.5) * CELL, (fy + 0.5) * CELL, CELL * 0.52, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }
      }
      if (s.kind === 'night' && !ended) drawNight(g);
      // Streak meter under the far bank: drains until the streak of forward hops runs out.
      if (s.streak > 1 && !ended) {
        g.fillStyle = c.accent;
        g.globalAlpha = 0.9;
        g.fillRect(0, CELL + 3, W * Math.max(0, s.streakLeft / STREAK_WINDOW), 3);
        g.globalAlpha = 1;
      }
      // Time left along the bottom: red and pulsing over the last ten seconds.
      const low = s.limit - s.time < 10 && !ended;
      const bh = low ? 6 + Math.abs(Math.sin(arena.time * 6)) * 2 : 6;
      g.fillStyle = c.cellAlt;
      g.fillRect(0, H - bh, W, bh);
      g.fillStyle = low ? c.bad : c.accent;
      g.fillRect(0, H - bh, W * Math.max(0, 1 - s.time / s.limit), bh);
      arena.overlay(g);
    }

    function go(dir: Dir) {
      const before = { x: s.x, row: s.row };
      const out = hop(s, dir);
      if (!out) return;
      facing = dir;
      const c0 = arena.colors;
      if (dir === 0 && s.streak >= 3) comboPop(fx, (before.x + 0.5) * CELL, before.row * CELL, s.streak, c0.accent);
      if (s.reward) {
        comboTier(fx, s.tier, s.reward === 'shield' ? c0.p[4] : c0.accent, REWARD_NAMES[s.reward]());
      }
      if (out === 'move') {
        from = before;
        if (!(dir === 0 && s.streak >= 3)) sfx('jump', { vol: 0.45, pitch: dir === 0 ? 2 : 0 });
      } else {
        if (out === 'home') sfx('power');
        const col = Math.round(before.x);
        lastSlot = SLOTS.indexOf(col);
        const c = arena.colors;
        const hx0 = (col + 0.5) * CELL;
        const hy0 = (GOAL_ROW + 0.5) * CELL;
        fx.burst(hx0, hy0, c.good, 14, 130, 3.5, 0.55, 'square', 200, Math.PI / 2, Math.PI * 1.2);
        fx.burst(hx0, hy0, c.accent, 8, 90, 2.5, 0.45, 'dot', 120);
        fx.ring(hx0, hy0, c.good, 6, CELL * 1.2, 0.4, arena.lw * 1.2);
        fx.text(Math.max(28, Math.min(W - 28, hx0)), hy0 + CELL * 0.9, `+${HOME_POINTS}`, c.accent, 16, 1);
        homeFlash = 0.6;
        from = { x: s.x, row: s.row };
      }
      ctx.score(s.score);
      status();
      draw();
      if (out === 'win') {
        ended = true;
        const c = arena.colors;
        for (let k = 0; k < 5; k++) fx.burst(W / 2, CELL, c.p[k], 10, 200, 3.5, 0.9, 'square', 220);
        fx.flash(c.good, 0.22, 0.5);
        arena.linger(1.4);
        ctx.win();
      }
    }

    const hx = () => (s.x + 0.5) * CELL;
    const hy = () => (s.row + 0.5) * CELL;
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CELL * 0.5,
      onSwipe: (dir) => go(dir),
      onTap(p) {
        if (p.y < hy() - CELL * 0.5) go(0);
        else if (p.y > hy() + CELL * 0.5) go(2);
        else go(p.x < hx() ? 3 : 1);
      },
    });

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const x = s.x;
        const row = s.row;
        const ev = step(s, dt);
        // Riding a log: the hop start drifts along with it.
        if (s.row === row) from = { x: from.x + (s.x - x), row: from.row };
        arena.update(dt);
        homeFlash = Math.max(0, homeFlash - dt);
        if (ev.shielded) {
          const c = arena.colors;
          const wx = (s.x + 0.5) * CELL;
          const wy = (s.row + 0.5) * CELL;
          fx.ring(wx, wy, c.p[4], 6, CELL * 1.3, 0.45, arena.lw * 1.5);
          fx.text(wx, wy - CELL * 0.6, L('Shielded!', 'Protégé!'), c.p[4], 14);
        }
        if (ev.streakEnd) status();
        if (ev.died) {
          const c = arena.colors;

          wreck = { x: s.x, row: s.row, water: s.lanes[s.row].kind === 'river' };
          const wx = (s.x + 0.5) * CELL;
          const wy = (s.row + 0.5) * CELL;
          fx.shake(4, 0.3);
          fx.flash(c.bad, 0.25, 0.35);
          if (wreck.water) {
            sfx('splash');
            fx.burst(wx, wy, c.p[1], 14, 120, 3, 0.55, 'dot', 260, -Math.PI / 2, Math.PI * 0.9);
            fx.burst(wx, wy, c.paper, 6, 80, 2.5, 0.4, 'dot', 200, -Math.PI / 2, Math.PI * 0.7);
            fx.text(wx, wy - CELL * 0.6, L('Splash!', 'Plouf!'), c.fg, 13);
          } else {
            sfx('boom', { vol: 0.8 });
            haptic(25);
            fx.burst(wx, wy, c.accent, 12, 140, 3.5, 0.5);
            fx.burst(wx, wy, c.bad, 6, 100, 2.5, 0.4, 'spark', 0);
            fx.text(wx, wy - CELL * 0.6, L('Bonk!', 'Bang!'), c.bad, 13);
          }
          ctx.lives(s.lives, LIVES);
        }
        if (ev.respawned) from = { x: s.x, row: s.row };
        if (secondsLeft() !== shown) status();
        if (ev.over && !ended) {
          ended = true;
          arena.linger(1.4);
        }
        draw();
        if (ev.over) ctx.lose();
      },
      onKey(e) {
        const dir = e.key === ' ' ? 0 : keyDir(e.key);
        if (dir === -1) return false;
        if (e.type === 'keydown' && !e.repeat) go(dir);
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
