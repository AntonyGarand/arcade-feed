import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { outBack, outCubic } from '../../kits/arena/ease';
import { DX, DY, gestures, keyDir } from '../../kits/gesture/gesture';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  BEETLE_POINTS,
  CHAIN_STEPS,
  CHAIN_TIERS,
  COLS,
  createLevel,
  goalFor,
  GOLD_POINTS,
  GOLD_STEPS,
  PELLET_POINTS,
  QUICK,
  ROWS,
  speedFor,
  step,
  turn,
  type KindId,
  type Perk,
} from './rules';

const CELL = 20;
/** The border wall shows half its thickness: more room for the field. */
const O = CELL / 2;
const W = COLS * CELL - 2 * O;
const H = ROWS * CELL - 2 * O;

/** What each kind of map is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [L('Garden', 'Jardin'), L('A few walls and fresh pellets.', 'Quelques murs et des pastilles fraîches.')],
  maze: () => [L('Maze', 'Labyrinthe'), L('A symmetric maze of walls to weave through.', 'Un labyrinthe symétrique à traverser.')],
  portals: () => [
    L('Portals', 'Portails'),
    L('Enter a portal, come out of its twin.', 'Entrez dans un portail, ressortez par son jumeau.'),
  ],
  runaway: () => [L('Runaway', 'Fuyardes'), L('Pellets hop away when you get close.', 'Les pastilles se sauvent quand vous approchez.')],
  beetles: () => [L('Beetles', 'Scarabées'), L('Crawling beetles patrol: don’t bump them.', 'Des scarabées patrouillent : évitez-les.')],
  shrink: () => [L('Closing in', 'Ça rapetisse'), L('The walls close in as you eat.', 'Les murs se resserrent à mesure que vous mangez.')],
};

/** What a chain milestone unlocked, under its banner. */
const PERK_NAMES: Record<Perk, () => string> = {
  gold: () => L('Golden pellet!', 'Pastille dorée!'),
  slow: () => L('Slow motion!', 'Ralenti!'),
  ghost: () => L('Ghost: slip through walls!', 'Fantôme : passez les murs!'),
  feast: () => L('Feast: gold + slow motion!', 'Festin : or + ralenti!'),
};

export const snake: GameDef = {
  id: 'snake',
  get name() {
    return L('Snake', 'Serpent');
  },
  get rules() {
    return L('Eat the pellets without hitting a wall or yourself.', 'Mangez les pastilles sans toucher un mur ni vous-même.');
  },
  category: 'reflex',
  help: () => ({
    goal: L('Eat the number of pellets shown without crashing.', 'Mangez le nombre de pastilles demandé sans vous écraser.'),
    steps: [
      L(
        'The snake moves on its own, one square at a time. Each pellet makes it longer.',
        'Le serpent avance tout seul, une case à la fois. Chaque pastille l’allonge.',
      ),
      L('Running into a wall or your own body ends the run.', 'Foncer dans un mur ou dans votre propre corps met fin à la partie.'),
      L(
        'Each map has a twist: portals lead to their twin, pellets run away, beetles patrol (don’t bump them), or the walls close in.',
        'Chaque carte a sa surprise : les portails mènent à leur jumeau, les pastilles se sauvent, des scarabées patrouillent (évitez-les) ou les murs se resserrent.',
      ),
      L('Swipe in the direction you want to turn.', 'Balayez dans la direction où vous voulez tourner.'),
      L('Keyboard: arrows or WASD to turn, P to pause.', 'Clavier : flèches ou WASD pour tourner, P pour la pause.'),
    ],
    tips: [
      L(
        `A pellet is worth ${PELLET_POINTS}, plus up to ${QUICK} more if you reach it in few steps: the ring around it shows the bonus left.`,
        `Une pastille vaut ${PELLET_POINTS}, plus jusqu’à ${QUICK} de plus si vous l’atteignez en peu de pas : l’anneau autour montre le bonus qui reste.`,
      ),
      L(
        `Golden pellets are worth ${GOLD_POINTS} but vanish after ${GOLD_STEPS} steps; they don’t count towards the goal.`,
        `Les pastilles dorées valent ${GOLD_POINTS}, mais disparaissent après ${GOLD_STEPS} pas; elles ne comptent pas pour l’objectif.`,
      ),
      L(
        `Chain bites less than ${CHAIN_STEPS} steps apart: ${CHAIN_TIERS[0]} in a row drop a golden pellet, ${CHAIN_TIERS[1]} slow time down, ${CHAIN_TIERS[2]} turn you into a ghost that slips through inner walls and squashes beetles, ${CHAIN_TIERS[3]} bring a feast.`,
        `Enchaînez les bouchées à moins de ${CHAIN_STEPS} pas d’intervalle : ${CHAIN_TIERS[0]} de suite font apparaître une pastille dorée, ${CHAIN_TIERS[1]} ralentissent le temps, ${CHAIN_TIERS[2]} vous changent en fantôme qui traverse les murs intérieurs et écrase les scarabées, ${CHAIN_TIERS[3]} donnent un festin.`,
      ),
      L('You can queue two turns ahead for tight corners.', 'Vous pouvez enchaîner deux virages d’avance dans les coins serrés.'),
    ],
  }),
  // Golden pellets and squashed beetles score on top of the pellets: the goals sit a little higher.
  stars: (d) => [goalFor(d) * 22, goalFor(d) * 30],
  par: (d) => Math.round((goalFor(d) * 10) / speedFor(d) + 10),
  pad: () => ({ left: 'dpad' }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    let dead = false;
    /** The tail cell before the last step, and when that step happened: the snake glides between cells. */
    let prevTail = -1;
    let moveAt = 0;
    /** When the last pellet was eaten (a bulge travels down the body) and when the current one appeared. */
    let eatAt = -10;
    let pelletAt = -10;
    let pellet = s.pellet;
    // Path points (cell centres, plus the gliding head and tail), reused every frame.
    let px = new Float32Array(64);
    let py = new Float32Array(64);
    /** 1 where the body path jumps (through a portal): a new stroke starts there. */
    let jump = new Uint8Array(64);
    /** Where the pellet hopped from (runaway maps) and when, so it slides instead of popping in. */
    let hopFrom = -1;
    let hopAt = -10;
    let gold = s.gold;
    let goldAt = -10;
    let lastStatus = '';

    const status = () => {
      const text = [
        P(s.goal - s.eaten, ['pellet to go', 'pellets to go'], ['pastille à manger', 'pastilles à manger']),
        s.chain > 1 ? L(`chain ${s.chain}`, `chaîne ${s.chain}`) : '',
        s.ghost > 0 ? L('ghost', 'fantôme') : '',
        s.slow > 0 ? L('slow motion', 'ralenti') : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (text !== lastStatus) ctx.status((lastStatus = text));
    };
    const near = (a: number, b: number) => Math.abs((a % COLS) - (b % COLS)) + Math.abs(Math.floor(a / COLS) - Math.floor(b / COLS)) === 1;

    const cx = (i: number) => (i % COLS) * CELL + CELL / 2;
    const cy = (i: number) => Math.floor(i / COLS) * CELL + CELL / 2;

    /** Trace the body path built by `draw` (n points), shifted by (dx, dy). */
    function trace(g: CanvasRenderingContext2D, n: number, dx = 0, dy = 0) {
      g.beginPath();
      g.moveTo(px[0] + dx, py[0] + dy);
      for (let i = 1; i < n; i++) {
        if (jump[i]) g.moveTo(px[i] + dx, py[i] + dy);
        g.lineTo(px[i] + dx, py[i] + dy);
      }
    }

    /** A portal: a swirl of rings in its pair's colour. */
    function drawPortal(g: CanvasRenderingContext2D, i: number, col: string) {
      const x = cx(i);
      const y = cy(i);
      const tone = arena.tone(col);
      g.fillStyle = tone.glow;
      g.beginPath();
      g.arc(x, y, CELL * (0.58 + 0.05 * Math.sin(arena.time * 4)), 0, Math.PI * 2);
      g.fill();
      arena.ball(g, x, y, CELL * 0.42, col, false);
      g.strokeStyle = tone.edge;
      g.lineWidth = 1.4;
      g.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const a = arena.time * (2.4 + k * 0.6) + (k * Math.PI * 2) / 3;
        g.beginPath();
        g.arc(x, y, CELL * (0.1 + k * 0.1), a, a + Math.PI * 1.1);
        g.stroke();
      }
      g.lineCap = 'butt';
    }

    /** A beetle: a shiny shell split down the back, spots and scuttling legs, facing where it crawls. */
    function drawBeetle(g: CanvasRenderingContext2D, at: number, dir: number) {
      const c = arena.colors;
      const x = cx(at);
      const y = cy(at);
      const dx = DX[dir];
      const dy = DY[dir];
      const tone = arena.tone(c.bad);
      const wig = Math.sin(arena.time * 18) * 1.5;
      g.strokeStyle = tone.edge;
      g.lineWidth = 1.2;
      g.lineCap = 'round';
      g.beginPath();
      for (const k of [-0.3, 0, 0.3])
        for (const side of [-1, 1]) {
          const bx = x + dx * k * CELL;
          const by = y + dy * k * CELL;
          g.moveTo(bx, by);
          g.lineTo(bx - dy * side * CELL * 0.46 + dx * wig * side, by + dx * side * CELL * 0.46 + dy * wig * side);
        }
      g.stroke();
      g.fillStyle = c.coal;
      g.beginPath();
      g.arc(x + dx * CELL * 0.32, y + dy * CELL * 0.32, CELL * 0.17, 0, Math.PI * 2);
      g.fill();
      arena.ball(g, x - dx * 1.5, y - dy * 1.5, CELL * 0.36, c.bad);
      g.beginPath();
      g.moveTo(x + dx * CELL * 0.16, y + dy * CELL * 0.16);
      g.lineTo(x - dx * CELL * 0.46, y - dy * CELL * 0.46);
      g.stroke();
      g.lineCap = 'butt';
      g.fillStyle = c.coal;
      for (const [k, side] of [
        [-0.05, 1],
        [-0.05, -1],
        [-0.3, 1],
        [-0.3, -1],
      ]) {
        g.beginPath();
        g.arc(x + dx * k * CELL - dy * side * 3, y + dy * k * CELL + dx * side * 3, 1.4, 0, Math.PI * 2);
        g.fill();
      }
    }

    /** The golden pellet: a sparkling gold fruit with a ring counting down the steps it has left. */
    function drawGold(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const age = arena.time - goldAt;
      const pop = age < 0.3 ? outBack(age / 0.3, 2.4) : 1;
      const x = cx(s.gold);
      const y = cy(s.gold) + Math.sin(arena.time * 5);
      const r = CELL * 0.38 * pop;
      const left = s.goldLeft / GOLD_STEPS;
      // Blinks when it's about to vanish.
      if (left < 0.25 && Math.sin(arena.time * 20) > 0) g.globalAlpha = 0.45;
      g.strokeStyle = c.p[3];
      g.lineWidth = arena.lw * 0.9;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(x, y, CELL * 0.66, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      g.stroke();
      g.lineCap = 'butt';
      if (r > 0.5) {
        g.fillStyle = arena.tone(c.p[3]).glow;
        g.beginPath();
        g.arc(x, y, r * (1.7 + 0.2 * Math.sin(arena.time * 8)), 0, Math.PI * 2);
        g.fill();
        arena.ball(g, x, y, r, c.p[3]);
        // A four-point twinkle.
        const tw = r * (0.25 + 0.2 * Math.sin(arena.time * 7));
        const sx = x - r * 0.3;
        const sy = y - r * 0.3;
        g.fillStyle = c.paper;
        g.beginPath();
        g.moveTo(sx, sy - tw);
        g.lineTo(sx + tw * 0.3, sy);
        g.lineTo(sx, sy + tw);
        g.lineTo(sx - tw * 0.3, sy);
        g.closePath();
        g.moveTo(sx - tw, sy);
        g.lineTo(sx, sy - tw * 0.3);
        g.lineTo(sx + tw, sy);
        g.lineTo(sx, sy + tw * 0.3);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Border wall: one solid frame with mortar lines; the field inside.
      // Dark mode's muted grey is light: sink the walls towards the surface so they don't glare.
      const wallFill = arena.dark ? mix(c.muted, c.cell, 0.55) : c.muted;
      const wall = arena.tone(wallFill);
      g.fillStyle = wall.base;
      g.fillRect(0, 0, W, H);
      g.save();
      g.translate(-O, -O);
      g.strokeStyle = wall.lo;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = CELL; x < W; x += CELL) {
        g.moveTo(x, 0);
        g.lineTo(x, CELL);
        g.moveTo(x, H - CELL);
        g.lineTo(x, H);
      }
      for (let y = CELL; y < H; y += CELL) {
        g.moveTo(0, y);
        g.lineTo(CELL, y);
        g.moveTo(W - CELL, y);
        g.lineTo(W, y);
      }
      g.stroke();
      g.restore();
      arena.field(g, CELL - O, CELL - O, W - 2 * (CELL - O), H - 2 * (CELL - O), 0, 0, false);
      g.strokeStyle = wall.edge;
      g.lineWidth = arena.lw * 0.6;
      g.strokeRect(CELL - O, CELL - O, W - 2 * (CELL - O), H - 2 * (CELL - O));
      g.save();
      g.translate(-O, -O);
      g.fillStyle = c.cell;
      g.globalAlpha = 0.4;
      for (let i = 0; i < COLS * ROWS; i++)
        if (!s.walls[i] && ((i % COLS) + Math.floor(i / COLS)) % 2) g.fillRect((i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL);
      g.globalAlpha = 1;
      for (let i = 0; i < COLS * ROWS; i++) {
        const c0 = i % COLS;
        const r0 = Math.floor(i / COLS);
        if (s.walls[i] && c0 > 0 && r0 > 0 && c0 < COLS - 1 && r0 < ROWS - 1)
          arena.block(g, c0 * CELL + 1, r0 * CELL + 1, CELL - 2, CELL - 2, wallFill, 3);
      }

      // Slow motion tints the field.
      if (s.slow > 0) {
        g.fillStyle = c.p[1];
        g.globalAlpha = 0.12 * Math.min(1, s.slow);
        g.fillRect(CELL, CELL, (COLS - 2) * CELL, (ROWS - 2) * CELL);
        g.globalAlpha = 1;
      }
      for (let k = 0; k < s.portals.length; k++) drawPortal(g, s.portals[k], c.p[4 + (k >> 1)]);
      for (const b of s.beetles) drawBeetle(g, b.at, b.dir);
      if (s.gold >= 0 && !dead) drawGold(g);

      // Pellet: a bobbing fruit with a stem and a leaf; it pops in when it appears and hops when it runs away.
      if (s.pellet >= 0 && s.eaten < s.goal) {
        const age = arena.time - pelletAt;
        const pop = age < 0.3 ? outBack(age / 0.3, 2.4) : 1;
        const k = hopFrom >= 0 ? outCubic(Math.min(1, (arena.time - hopAt) * 8)) : 1;
        const from = hopFrom >= 0 ? hopFrom : s.pellet;
        const x = cx(from) + (cx(s.pellet) - cx(from)) * k;
        const y = cy(from) + (cy(s.pellet) - cy(from)) * k + Math.sin(arena.time * 4) * 0.8 - Math.sin(k * Math.PI) * 5;
        const r = CELL * 0.4 * pop;
        // The quick bonus left, as a ring running down around the pellet.
        const bonus = Math.max(0, QUICK - s.sinceLast) / QUICK;
        if (bonus > 0 && !dead) {
          g.strokeStyle = c.p[3];
          g.lineWidth = arena.lw * 0.9;
          g.lineCap = 'round';
          g.beginPath();
          g.arc(x, y, CELL * 0.66, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * bonus);
          g.stroke();
          g.lineCap = 'butt';
        }
        if (r > 0.5) {
          g.fillStyle = arena.tone(c.p[0]).glow;
          g.beginPath();
          g.arc(x, y, r * (1.5 + 0.15 * Math.sin(arena.time * 6)), 0, Math.PI * 2);
          g.fill();
          arena.ball(g, x, y, r, c.p[0]);
          g.strokeStyle = arena.tone(c.p[0]).edge;
          g.lineWidth = 1.2;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(x, y - r * 0.8);
          g.lineTo(x + r * 0.2, y - r * 1.3);
          g.stroke();
          g.lineCap = 'butt';
          g.fillStyle = c.p[2];
          g.beginPath();
          g.ellipse(x + r * 0.55, y - r * 1.15, r * 0.4, r * 0.2, -0.5, 0, Math.PI * 2);
          g.fill();
        }
      }

      // Body: a smooth tube through the cell centres, the head and tail gliding between cells.
      const len = s.body.length;
      const f = dead || prevTail < 0 ? 1 : outCubic((arena.time - moveAt) * s.speed * 2.2);
      if (px.length < len + 2) {
        px = new Float32Array(len * 2 + 4);
        py = new Float32Array(len * 2 + 4);
        jump = new Uint8Array(len * 2 + 4);
      }
      jump.fill(0);
      let n = 0;
      const h0 = s.body[0];
      const h1 = len > 1 ? s.body[1] : h0;
      // Out of a portal, the head pops out where it is: no glide, and the tube breaks there.
      const fh = h0 === h1 || near(h0, h1) ? f : 1;
      px[n] = cx(h1) + (cx(h0) - cx(h1)) * fh;
      py[n++] = cy(h1) + (cy(h0) - cy(h1)) * fh;
      for (let k = 1; k < len; k++) {
        if (!near(s.body[k], s.body[k - 1])) jump[n] = 1;
        px[n] = cx(s.body[k]);
        py[n++] = cy(s.body[k]);
      }
      if (prevTail >= 0 && len > 1 && near(prevTail, s.body[len - 1])) {
        const t = s.body[len - 1];
        px[n] = cx(prevTail) + (cx(t) - cx(prevTail)) * f;
        py[n++] = cy(prevTail) + (cy(t) - cy(prevTail)) * f;
      }
      if (n === 1) {
        px[n] = px[0];
        py[n++] = py[0];
      }
      const fill = dead ? c.bad : c.accent;
      const tone = arena.tone(fill);
      const bw = CELL * 0.8;
      // A ghost snake is see-through (flickering as the ghost runs out).
      const ghostA = s.ghost > 0 && !dead ? (s.ghost < 6 && Math.sin(arena.time * 24) > 0 ? 0.85 : 0.5) : 1;
      g.globalAlpha = ghostA;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      if (arena.sh && arena.look === 'neo') {
        g.strokeStyle = c.drop;
        g.lineWidth = bw;
        trace(g, n, arena.sh * 0.5, arena.sh * 0.5);
        g.stroke();
      } else if (arena.look === 'soft') {
        g.strokeStyle = c.drop;
        g.lineWidth = bw;
        trace(g, n, 0, arena.sh * 0.7);
        g.stroke();
      }
      trace(g, n);
      g.strokeStyle = tone.edge;
      g.lineWidth = bw;
      g.stroke();
      g.strokeStyle = fill;
      g.lineWidth = bw - arena.lw * 1.5;
      g.stroke();
      // Scales: a darker diamond on every other segment.
      g.fillStyle = tone.lo;
      for (let k = 2; k < len - 1; k += 2) {
        const x = cx(s.body[k]);
        const y = cy(s.body[k]);
        g.beginPath();
        g.moveTo(x, y - 2.6);
        g.lineTo(x + 2.6, y);
        g.lineTo(x, y + 2.6);
        g.lineTo(x - 2.6, y);
        g.closePath();
        g.fill();
      }
      if (arena.look !== 'newsprint') {
        g.strokeStyle = tone.hi;
        g.globalAlpha = 0.55;
        g.lineWidth = bw * 0.2;
        trace(g, n, -bw * 0.12, -bw * 0.16);
        g.stroke();
        g.globalAlpha = ghostA;
      }
      g.lineCap = 'butt';
      // A swallowed pellet travels down the body.
      const bulge = Math.floor((arena.time - eatAt) * s.speed * 1.5);
      if (bulge >= 1 && bulge < len - 1) arena.ball(g, cx(s.body[bulge]), cy(s.body[bulge]), CELL * 0.45, fill, false);

      // Head: a rounder ball with eyes that look ahead, blink now and then, and a flicking tongue.
      const hx = px[0];
      const hy = py[0];
      const dx = DX[s.dir];
      const dy = DY[s.dir];
      if (!dead && Math.sin(arena.time * 2.3) > 0.82) {
        g.strokeStyle = c.bad;
        g.lineWidth = 1.3;
        g.lineCap = 'round';
        const tx = hx + dx * CELL * 0.8;
        const ty = hy + dy * CELL * 0.8;
        g.beginPath();
        g.moveTo(hx + dx * CELL * 0.4, hy + dy * CELL * 0.4);
        g.lineTo(tx, ty);
        g.lineTo(tx + (dx - dy) * 2.5, ty + (dy + dx) * 2.5);
        g.moveTo(tx, ty);
        g.lineTo(tx + (dx + dy) * 2.5, ty + (dy - dx) * 2.5);
        g.stroke();
        g.lineCap = 'butt';
      }
      arena.ball(g, hx, hy, CELL * 0.54, fill);
      g.globalAlpha = 1;
      const blink = !dead && arena.time % 3.2 > 3.05;
      for (const side of [-1, 1]) {
        const ex = hx + dx * 3 + dy * side * 4.2;
        const ey = hy + dy * 3 + dx * side * 4.2;
        if (dead) {
          g.strokeStyle = tone.edge;
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(ex - 2, ey - 2);
          g.lineTo(ex + 2, ey + 2);
          g.moveTo(ex + 2, ey - 2);
          g.lineTo(ex - 2, ey + 2);
          g.stroke();
          continue;
        }
        g.fillStyle = c.paper;
        g.strokeStyle = tone.edge;
        g.lineWidth = arena.lw * 0.4;
        g.beginPath();
        g.ellipse(ex, ey, 3, blink ? 0.6 : 3, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        if (!blink) {
          g.fillStyle = c.coal;
          g.beginPath();
          g.arc(ex + dx * 1.2, ey + dy * 1.2, 1.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      // Chain meter along the top wall: drains until the chain runs out.
      if (s.chain > 1 && !dead) {
        const k = Math.max(0, 1 - s.sinceChain / CHAIN_STEPS);
        g.fillStyle = s.tier ? c.p[3] : c.fg;
        g.globalAlpha = 0.85;
        g.fillRect(CELL, O + 3, (COLS - 2) * CELL * k, 4);
        g.globalAlpha = 1;
      }
      arena.overlay(g);
      g.restore();
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CELL * 0.7,
      repeat: true,
      onSwipe: (dir) => turn(s, dir),
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const tail = s.body[s.body.length - 1];
        const score = s.score;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        if (ev.moved && !ev.dead) {
          prevTail = tail;
          moveAt = arena.time;
        }
        if (ev.ate || ev.goldAte || ev.squashed >= 0) ctx.score(s.score);
        if (ev.moved) status();
        if (ev.goldAte) {
          const x = cx(s.body[0]);
          const y = cy(s.body[0]);
          eatAt = arena.time;
          sfx('power', { vol: 0.7 });
          fx.burst(x, y, c.p[3], 16, 140, 3.5, 0.6, 'spark', 0);
          fx.ring(x, y, c.p[3], 4, CELL * 2, 0.4, arena.lw * 1.2);
          fx.text(x, y - 12, `+${GOLD_POINTS}`, c.p[3], 15);
        }
        if (ev.goldGone) sfx('error', { vol: 0.4 });
        if (ev.squashed >= 0) {
          const x = cx(ev.squashed);
          const y = cy(ev.squashed);
          sfx('pop');
          fx.burst(x, y, c.bad, 14, 130, 3, 0.5, 'square', 160);
          fx.text(x, y - 12, `+${BEETLE_POINTS}`, c.bad, 14);
        }
        if (ev.warped >= 0) {
          sfx('jump', { vol: 0.6 });
          fx.ring(cx(ev.warped), cy(ev.warped), c.p[4], 4, CELL * 1.2, 0.3, arena.lw);
          fx.ring(cx(s.body[0]), cy(s.body[0]), c.p[4], 4, CELL * 1.2, 0.3, arena.lw);
        }
        if (ev.hopped) {
          hopFrom = pellet;
          hopAt = arena.time;
          pellet = s.pellet;
          sfx('tick');
        }
        if (ev.shrank) {
          sfx('boom');
          haptic(40);
          fx.shake(4, 0.3);
          fx.banner(L('Closing in!', 'Ça rapetisse!'), c.bad);
        }
        if (ev.chain >= 2) comboPop(fx, cx(s.body[0]), cy(s.body[0]) - 16, ev.chain, c.p[3]);
        if (ev.perk) {
          comboTier(fx, ev.tier, c.p[3], PERK_NAMES[ev.perk]());
          if (ev.perk === 'ghost') fx.ring(cx(s.body[0]), cy(s.body[0]), c.fg, 6, CELL * 3, 0.5, arena.lw);
        }
        if (ev.ate) {
          const x = cx(s.body[0]);
          const y = cy(s.body[0]);
          eatAt = arena.time;
          sfx('coin', { pitch: s.body.length % 5, vol: 0.6 });
          fx.burst(x, y, c.p[0], 10, 100, 3, 0.45);
          fx.ring(x, y, c.p[0], 4, CELL * 1.4, 0.3, arena.lw);
          fx.text(x, y - 12, `+${s.score - score}`, c.fg, 12);
        }
        if (s.pellet !== pellet) {
          pellet = s.pellet;
          pelletAt = arena.time;
          hopFrom = -1;
        }
        if (s.gold !== gold) {
          gold = s.gold;
          goldAt = arena.time;
        }
        if (ev.dead) {
          dead = true;
          fx.shake(5, 0.4);
          fx.flash(c.bad, 0.28, 0.4);
          fx.burst(cx(s.body[0]) + DX[s.dir] * CELL * 0.5, cy(s.body[0]) + DY[s.dir] * CELL * 0.5, c.muted, 12, 120, 3, 0.5);
          arena.linger();
        } else if (ev.won) {
          for (let k = 0; k < s.body.length; k += 2) fx.burst(cx(s.body[k]), cy(s.body[k]), c.p[k % 5], 3, 120, 3.5, 0.8, 'square', 160);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.dead) ctx.lose();
      },
      onKey(e) {
        const dir = keyDir(e.key);
        if (dir === -1) return false;
        if (e.type === 'keydown' && !e.repeat) turn(s, dir);
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
