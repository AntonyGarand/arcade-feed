import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { DX, DY, gestures, keyDir, type Point } from '../../kits/gesture/gesture';
import { sfx } from '../../kits/sound/sound';
import { painter } from './draw';
import { KIND_NAMES, POWER_NAMES } from './names';
import {
  canPlace,
  CHAIN_TIERS,
  COIN_POINTS,
  coinsFor,
  COLS,
  countdownFor,
  createLevel,
  CROSS_BONUS,
  DRAIN_BONUS,
  flowNow,
  FREEZE_S,
  goalFor,
  openEnd,
  perPieceFor,
  PIPE_POINTS,
  place,
  REPLACE_POINTS,
  ROWS,
  step,
  UNUSED_POINTS,
} from './rules';

const W = 300;
const PAD = 6;
const CS = (W - 2 * PAD) / COLS;
const BOARD = PAD + ROWS * CS;
/** Toolbar under the board: the piece queue and the flow button. */
const BAR_Y = BOARD + 6;
const BAR_H = 60;
const H = Math.round(BAR_Y + BAR_H + PAD);
/** Seconds a freshly laid piece takes to pop in. */
const POP_S = 0.18;

export const pipeline: GameDef = {
  id: 'pipeline',
  get name() {
    return L('Pipeline', 'Canalisation');
  },
  get rules() {
    return L('Lay pipes so the flow passes enough before it spills.', 'Posez des tuyaux pour que le flot en traverse assez.');
  },
  category: 'think',
  help: () => ({
    goal: L(
      'Lay pipes from the source so the liquid flows through enough of them before it spills.',
      'Posez des tuyaux depuis la source pour que le liquide en traverse assez avant de déborder.',
    ),
    steps: [
      L(
        'Tap a cell to lay the next piece of the queue there. Pieces can’t be turned.',
        'Touchez une case pour y poser la prochaine pièce de la file. Les pièces ne tournent pas.',
      ),
      L(
        'When the countdown ends, liquid flows from the source along your pipes. It spills at an open end, a wall or a pipe that doesn’t fit.',
        'À la fin du décompte, le liquide coule de la source dans vos tuyaux. Il déborde à un bout ouvert, un mur ou un tuyau mal raccordé.',
      ),
      L(
        'Clear the level when the flow has passed the goal number of pipes before it spills. A drain ends the flow with a bonus.',
        'Le niveau est réussi si le flot traverse le nombre de tuyaux visé avant de déborder. Un drain termine le flot avec un bonus.',
      ),
      L(
        'Tapping a dry pipe replaces it (short delay, a few points). Tap Flow to start early for a bonus, or to speed the flow up.',
        'Toucher un tuyau sec le remplace (court délai, quelques points). Touchez Ouvrir pour lancer le flot plus tôt contre un bonus, ou pour l’accélérer.',
      ),
      L(
        'Bolted pieces are fixed: tanks fill slowly and count as two pipes, arrows let the flow through one way only. Coins pay a bonus when the flow passes them.',
        'Les pièces boulonnées sont fixes : les réservoirs se remplissent lentement et comptent pour deux, les flèches ne laissent passer le flot que dans un sens. Les pièces d’or rapportent une prime au passage du flot.',
      ),
      L(
        `Lay pieces that join the chain in a row: ${CHAIN_TIERS[0]} freeze the flow ${FREEZE_S} s, ${CHAIN_TIERS[1]} deal a perfect piece, ${CHAIN_TIERS[2]} double the flow’s points. A piece off the chain breaks the combo.`,
        `Posez d’affilée des pièces qui prolongent la chaîne : ${CHAIN_TIERS[0]} gèlent le flot ${FREEZE_S} s, ${CHAIN_TIERS[1]} donnent une pièce parfaite, ${CHAIN_TIERS[2]} doublent les points du flot. Une pièce hors de la chaîne brise le combo.`,
      ),
    ],
    tips: [
      L(
        `Dump pieces you can’t use on a spare cell far from your route. Each dry pipe costs ${UNUSED_POINTS} at the end.`,
        `Déposez les pièces inutiles sur une case libre loin de votre trajet. Chaque tuyau sec coûte ${UNUSED_POINTS} à la fin.`,
      ),
      L(
        `${PIPE_POINTS} per pipe, ${CROSS_BONUS} for going through a cross both ways, ${DRAIN_BONUS} for the drain.`,
        `${PIPE_POINTS} par tuyau, ${CROSS_BONUS} pour traverser une croix dans les deux sens, ${DRAIN_BONUS} pour le drain.`,
      ),
      L(`Each coin is worth ${COIN_POINTS}.`, `Chaque pièce d’or vaut ${COIN_POINTS}.`),
      L(
        'Keyboard: arrows or WASD to move, Space or Enter to lay, F to flow, P to pause.',
        'Clavier : flèches ou WASD pour bouger, Espace ou Entrée pour poser, F pour ouvrir, P pour la pause.',
      ),
    ],
  }),
  // Three stars take a long chain and half the coins (or a chain combo's double points).
  stars: (d) => {
    const n = goalFor(d);
    return [(n + 2) * PIPE_POINTS + 50, (n + 5) * PIPE_POINTS + 100 + (coinsFor(d) * COIN_POINTS) / 2];
  },
  par: (d) => Math.round(countdownFor(d) * 0.6 + (goalFor(d) + 3) * perPieceFor(d)),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const start = openEnd(s);
    let cursor = start ? start.cell : s.source;
    let showCursor = false;
    /** When each cell last got a piece (arena time), for its pop; and a refused tap's wobble. */
    const laid = new Map<number, number>();
    let refused = -1;
    let refusedAt = -1;
    let ended = false;
    let lastStatus = '';
    let lastScore = -1;
    let chainShown = 0;

    const btn = { x: W - PAD - 100, y: BAR_Y, w: 100, h: BAR_H };
    const inBtn = (p: Point) => p.x >= btn.x && p.x <= btn.x + btn.w && p.y >= btn.y && p.y <= btn.y + btn.h;
    const cx = (i: number) => PAD + (i % COLS) * CS + CS / 2;
    const cy = (i: number) => PAD + Math.floor(i / COLS) * CS + CS / 2;
    const cellAt = (p: Point) => {
      const c = Math.floor((p.x - PAD) / CS);
      const r = Math.floor((p.y - PAD) / CS);
      return c >= 0 && r >= 0 && c < COLS && r < ROWS ? r * COLS + c : -1;
    };

    function report() {
      const text = [
        !s.started
          ? L(`flow in ${Math.ceil(s.countdown)} s`, `écoulement dans ${Math.ceil(s.countdown)} s`)
          : s.freeze > 0
            ? L('frozen', 'gelé')
            : s.fast
              ? L('fast flow', 'flot rapide')
              : L('flowing', 'ça coule'),
        s.count >= s.goal
          ? L('goal reached', 'objectif atteint')
          : P(s.goal - s.count, ['pipe to go', 'pipes to go'], ['tuyau à remplir', 'tuyaux à remplir']),
      ].join(' · ');
      if (text !== lastStatus) ctx.status((lastStatus = text));
      if (s.score !== lastScore) ctx.score((lastScore = s.score));
    }

    const paint = painter(arena, s, CS);
    const { piece } = paint;

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, PAD, PAD, W - 2 * PAD, ROWS * CS, CS, 4);
      const tile = arena.dark ? mix(c.cellAlt, c.fg, 0.1) : c.cell;
      for (let i = 0; i < COLS * ROWS; i++) {
        const x = cx(i) - CS / 2;
        const y = cy(i) - CS / 2;
        const wob = i === refused && arena.time - refusedAt < 0.25 ? Math.sin((arena.time - refusedAt) * 60) * 2 : 0;
        if (s.block[i]) {
          arena.box(g, x + 2, y + 2, CS - 4, CS - 4, c.muted, 5);
          g.save();
          g.beginPath();
          g.roundRect(x + 2, y + 2, CS - 4, CS - 4, arena.r(5));
          g.clip();
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.5;
          for (let k = -CS; k < CS; k += 8) {
            g.beginPath();
            g.moveTo(x + k, y + CS);
            g.lineTo(x + k + CS, y);
            g.stroke();
          }
          g.restore();
        } else if (i === s.source) {
          arena.block(g, x + 2, y + 2, CS - 4, CS - 4, c.accent, 6);
          paint.stub(g, cx(i), cy(i), s.srcDir, s.started ? (s.flow.at === i ? Math.min(1, s.flow.t) : 1) : 0);
          // Valve wheel, ringed by the time left before it opens.
          arena.disc(g, cx(i), cy(i), CS * 0.17, c.paper);
          if (!s.started) {
            g.strokeStyle = c.fg;
            g.lineWidth = arena.lw * 1.2;
            g.beginPath();
            g.arc(cx(i), cy(i), CS * 0.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.countdown / s.clock));
            g.stroke();
          }
        } else if (i === s.drain) {
          arena.block(g, x + 2, y + 2, CS - 4, CS - 4, c.good, 6);
          paint.stub(g, cx(i), cy(i), s.drainDir, 0);
          arena.disc(g, cx(i), cy(i), CS * 0.2, c.coal);
          g.strokeStyle = c.paper;
          g.lineWidth = arena.lw * 0.6;
          g.beginPath();
          g.arc(cx(i), cy(i), CS * 0.1, 0, Math.PI * 2);
          g.stroke();
        } else if (s.pipe[i]) {
          const at = laid.get(i);
          const k = at == null ? 1 : Math.min(1, (arena.time - at) / POP_S);
          const scale = k < 1 ? 0.6 + 0.4 * k + Math.sin(Math.PI * k) * 0.15 : 1;
          g.save();
          g.translate(cx(i) + wob, cy(i));
          g.scale(scale, scale);
          arena.block(g, -CS / 2 + 1.5, -CS / 2 + 1.5, CS - 3, CS - 3, s.fixed[i] ? c.cellAlt : tile, 5, true, 0.6);
          if (s.fixed[i]) paint.bolts(g, 0, 0);
          if (s.wet[i]) {
            g.fillStyle = arena.tone(c.accent).glow;
            g.beginPath();
            g.roundRect(-CS / 2 + 1.5, -CS / 2 + 1.5, CS - 3, CS - 3, arena.r(5));
            g.fill();
          }
          piece(g, 0, 0, s.pipe[i], i);
          g.restore();
        }
        if (s.coin[i]) paint.coin(g, cx(i), cy(i), s.pipe[i] !== 0);
      }
      // Frozen (a combo reward): frost over the flow's front, with the time left.
      if (s.freeze > 0 && !ended) {
        const i = s.flow.at;
        g.globalAlpha = 0.5;
        g.fillStyle = c.p[5];
        g.beginPath();
        g.roundRect(cx(i) - CS / 2 + 2, cy(i) - CS / 2 + 2, CS - 4, CS - 4, arena.r(5));
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = c.p[5];
        g.lineWidth = arena.lw * 1.4;
        g.beginPath();
        g.arc(cx(i), cy(i), CS * 0.42, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * s.freeze) / FREEZE_S);
        g.stroke();
      }
      if (!ended) {
        // The open end of the chain pulses; the cursor shows the next piece where it would go.
        const end = openEnd(s);
        if (end) {
          const k = 0.5 + 0.5 * Math.sin(arena.time * 6);
          g.strokeStyle = c.accent;
          g.lineWidth = arena.lw * (0.8 + 0.6 * k);
          g.setLineDash([4, 4]);
          g.beginPath();
          g.roundRect(cx(end.cell) - CS / 2 + 4, cy(end.cell) - CS / 2 + 4, CS - 8, CS - 8, arena.r(5));
          g.stroke();
          g.setLineDash([]);
        }
        if (showCursor && cursor >= 0) {
          if (canPlace(s, cursor)) {
            g.globalAlpha = 0.45;
            piece(g, cx(cursor), cy(cursor), s.queue[0]);
            g.globalAlpha = 1;
          }
          g.strokeStyle = c.fg;
          g.lineWidth = arena.lw;
          g.beginPath();
          g.roundRect(cx(cursor) - CS / 2 + 1, cy(cursor) - CS / 2 + 1, CS - 2, CS - 2, arena.r(6));
          g.stroke();
        }
      }
      drawBar(g);
      arena.overlay(g);
    }

    function drawBar(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      // Queue: the next piece big and outlined, the rest smaller.
      const big = BAR_H;
      arena.box(g, PAD, BAR_Y, big, big, c.cell, 6);
      g.strokeStyle = s.cool > 0 ? c.bad : c.accent;
      g.lineWidth = arena.lw * 1.4;
      g.beginPath();
      g.roundRect(PAD + 3, BAR_Y + 3, big - 6, big - 6, arena.r(4));
      g.stroke();
      const head = (big - 10) / CS;
      g.save();
      g.translate(PAD + big / 2, BAR_Y + big / 2);
      g.scale(head, head);
      g.globalAlpha = s.cool > 0 ? 0.4 : 1;
      piece(g, 0, 0, s.queue[0]);
      g.restore();
      g.globalAlpha = 1;
      drawChain(g, big);
      const small = 36;
      for (let k = 1; k < s.queue.length; k++) {
        const x = PAD + big + 8 + (k - 1) * (small + 4);
        const y = BAR_Y + (BAR_H - small) / 2;
        g.fillStyle = c.cell;
        g.beginPath();
        g.roundRect(x, y, small, small, arena.r(4));
        g.fill();
        g.save();
        g.translate(x + small / 2, y + small / 2);
        g.scale((small - 6) / CS, (small - 6) / CS);
        g.globalAlpha = 1 - k * 0.15;
        piece(g, 0, 0, s.queue[k]);
        g.restore();
        g.globalAlpha = 1;
      }
      // Flow button: the countdown, then a speed-up.
      const live = !s.done && !s.fast;
      arena.box(g, btn.x, btn.y, btn.w, btn.h, live ? (s.started ? c.cell : c.accent) : c.cellAlt, 8, live);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const mx = btn.x + btn.w / 2;
      if (!s.started) {
        const left = Math.ceil(s.countdown);
        // On the accent fill: physical black reads in every theme; the last seconds throb.
        g.fillStyle = c.coal;
        g.font = `700 ${left <= 3 ? 24 + 3 * Math.max(0, Math.sin(arena.time * 12)) : 24}px ${arena.family}`;
        g.fillText(`${left} s`, mx, btn.y + 22);
        g.font = `600 11px ${arena.family}`;
        g.fillText(L('Flow now', 'Ouvrir'), mx, btn.y + 45);
        g.globalAlpha = 0.5;
        g.fillRect(btn.x + 8, btn.y + btn.h - 7, (btn.w - 16) * Math.min(1, s.countdown / s.clock), 2.5);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = live ? c.fg : c.muted;
        g.font = `700 22px ${arena.family}`;
        g.fillText(`${Math.min(s.count, 99)}/${s.goal}`, mx, btn.y + 22);
        g.font = `600 11px ${arena.family}`;
        const label =
          s.freeze > 0 && !s.done
            ? L(`Frozen ${Math.ceil(s.freeze)} s`, `Gelé ${Math.ceil(s.freeze)} s`)
            : s.fast || s.done
              ? L('pipes', 'tuyaux')
              : L('Faster »', 'Accélérer »');
        g.fillText(label, mx, btn.y + 45);
      }
      if (s.double) {
        // Flow points ×2 (a combo reward) for the rest of the run.
        arena.disc(g, btn.x + btn.w - 4, btn.y + 4, 11, c.p[3]);
        g.fillStyle = c.coal;
        g.font = `900 10px ${arena.family}`;
        g.fillText('×2', btn.x + btn.w - 4, btn.y + 4.5);
      }
    }

    /** The chain combo, on the queue head: pieces joined in a row and the way to the next milestone. */
    function drawChain(g: CanvasRenderingContext2D, big: number) {
      if (!s.chain) return;
      const c = arena.colors;
      const next = CHAIN_TIERS[s.tier] as number | undefined;
      const prev = s.tier ? CHAIN_TIERS[s.tier - 1] : 0;
      const bx = PAD + big - 6;
      const by = BAR_Y + 6;
      arena.disc(g, bx, by, 10, c.accent);
      g.fillStyle = c.coal;
      g.font = `800 9px ${arena.family}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`×${s.chain}`, bx, by + 0.5);
      g.fillStyle = c.cellAlt;
      g.fillRect(PAD + 6, BAR_Y + big - 6, big - 12, 2.5);
      g.fillStyle = c.accent;
      g.fillRect(PAD + 6, BAR_Y + big - 6, (big - 12) * (next ? (s.chain - prev) / (next - prev) : 1), 2.5);
    }

    function lay(cell: number) {
      if (ended || cell < 0) return;
      const res = place(s, cell);
      const c = arena.colors;
      if (res === 'no' || res === 'wait') {
        refused = cell;
        refusedAt = arena.time;
        if (res === 'no') sfx('error');
        fx.ring(cx(cell), cy(cell), c.bad, CS * 0.2, CS * 0.5, 0.25, arena.lw);
        if (res === 'wait') fx.text(cx(cell), cy(cell) - 6, L('wait', 'attendez'), c.muted, 11, 0.5);
      } else {
        laid.set(cell, arena.time);
        fx.ring(cx(cell), cy(cell), c.accent, CS * 0.3, CS * 0.7, 0.3, arena.lw);
        if (s.chain !== chainShown && s.chain > chainShown) comboPop(fx, cx(cell), cy(cell) - CS * 0.3, s.chain, c.accent);
        else if (chainShown >= 3 && !s.chain) fx.text(cx(cell), cy(cell) - CS * 0.4, L('Chain broken', 'Chaîne brisée'), c.muted, 11, 0.7);
        chainShown = s.chain;
        if (s.unlocked) {
          comboTier(fx, s.fired, c.p[3], POWER_NAMES[s.unlocked]());
          if (s.unlocked === 'perfect') fx.ring(PAD + BAR_H / 2, BAR_Y + BAR_H / 2, c.p[3], 8, BAR_H * 0.8, 0.5, arena.lw * 1.4);
          if (s.unlocked === 'freeze') fx.ring(cx(s.flow.at), cy(s.flow.at), c.p[5], CS * 0.2, CS * 1.4, 0.5, arena.lw * 1.4);
        }
        if (res === 'replaced') {
          sfx('error', { pitch: 4, vol: 0.7 });
          fx.burst(cx(cell), cy(cell), c.muted, 10, 110, 3, 0.45, 'square', 200);
          fx.text(cx(cell), cy(cell) - 8, `−${REPLACE_POINTS}`, c.bad, 12);
        } else {
          sfx('hit');
          fx.burst(cx(cell), cy(cell), arena.tone(c.accent).hi, 5, 60, 2, 0.3, 'dot', 0);
        }
      }
      report();
      draw();
    }

    function flow() {
      if (ended) return;
      const was = s.started;
      const fast = s.fast;
      flowNow(s);
      const c = arena.colors;
      if (!was) {
        sfx('splash');
        fx.flash(c.accent, 0.18, 0.3);
        fx.ring(cx(s.source), cy(s.source), c.accent, CS * 0.3, CS * 1.2, 0.45, arena.lw * 1.4);
        if (s.early) fx.text(btn.x + btn.w / 2, btn.y - 6, `+${s.early}`, c.accent, 14);
      } else if (!fast) fx.text(btn.x + btn.w / 2, btn.y - 6, '»»', c.fg, 14, 0.6);
      report();
      draw();
    }

    function onStep(ev: ReturnType<typeof step>) {
      const c = arena.colors;
      if (ev.tick && !s.started && s.countdown <= 3) {
        sfx('tick', { pitch: 6 - Math.ceil(s.countdown) });
        fx.ring(cx(s.source), cy(s.source), c.bad, CS * 0.3, CS * 0.8, 0.4, arena.lw);
        fx.text(cx(s.source), cy(s.source) - CS * 0.5, String(Math.ceil(s.countdown)), c.bad, 14, 0.7);
      }
      if (ev.started) {
        sfx('splash');
        fx.ring(cx(s.source), cy(s.source), c.accent, CS * 0.3, CS * 1.2, 0.45, arena.lw * 1.4);
        fx.text(cx(s.source), cy(s.source) - CS * 0.5, L('Flow!', 'Ça coule!'), c.accent, 14);
      }
      if (ev.entered.length) sfx('tick', { pitch: Math.min(14, s.count * 0.5), vol: 0.5 });
      for (const i of ev.entered) {
        fx.burst(cx(i), cy(i), c.accent, 5, 50, 2.5, 0.35, 'dot', 0);
        const n = (s.res[i] ? 2 : 1) * (s.double ? 2 : 1);
        fx.text(cx(i), cy(i) - 8, `+${PIPE_POINTS * n}`, s.double ? c.p[3] : c.fg, 10, 0.6);
      }
      for (const i of ev.coins) {
        sfx('coin');
        fx.burst(cx(i), cy(i), c.p[3], 10, 110, 3, 0.5, 'spark', 0);
        fx.text(cx(i), cy(i) - CS * 0.45, `+${COIN_POINTS}`, c.p[3], 14);
      }
      if (ev.cross) {
        sfx('power');
        const i = s.flow.at;
        fx.ring(cx(i), cy(i), c.accent, CS * 0.2, CS, 0.45, arena.lw * 1.4);
        fx.text(cx(i), cy(i) - CS * 0.4, `+${CROSS_BONUS}`, c.accent, 15);
        fx.shake(1.5, 0.15);
      }
      if (ev.goal) {
        const i = s.flow.at;
        fx.ring(cx(i), cy(i), c.good, CS * 0.3, CS * 2, 0.6, arena.lw * 1.6);
        fx.text(cx(i), cy(i) - CS * 0.6, L('Goal!', 'Objectif!'), c.good, 16, 1);
        fx.flash(c.good, 0.15, 0.3);
      }
      if (ev.end) {
        ended = true;
        const i = ev.spill;
        const x = cx(i) + (DX[ev.spillDir] * CS) / 2;
        const y = cy(i) + (DY[ev.spillDir] * CS) / 2;
        if (s.drained) {
          sfx('power');
          fx.ring(cx(i), cy(i), c.good, CS * 0.2, CS * 1.4, 0.6, arena.lw * 1.6);
          fx.text(cx(i), cy(i) - CS * 0.5, `+${DRAIN_BONUS}`, c.good, 16, 1);
        } else {
          sfx('splash');
          fx.burst(x, y, c.accent, 22, 120, 3.5, 0.7, 'dot', 260, Math.atan2(DY[ev.spillDir], DX[ev.spillDir]), Math.PI * 0.9);
          fx.ring(x, y, c.accent, 3, CS * 0.8, 0.4, arena.lw);
        }
        const dry = s.pipe.filter((p, k) => p && !s.wet[k]).length;
        if (dry) fx.text(W / 2, BOARD / 2, `−${dry * UNUSED_POINTS}`, c.muted, 13, 1);
        if (ev.end === 'win') {
          for (let k = 0; k < 5; k++) fx.burst(x, y, c.p[k], 10, 180, 4, 0.9, 'square', 220);
          fx.flash(c.good, 0.25, 0.5);
        } else {
          fx.shake(5, 0.35);
          fx.flash(c.bad, 0.3, 0.4);
        }
        arena.linger(1.4);
      }
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CS * 0.5,
      onMove(p, from) {
        if (from) return;
        const cell = cellAt(p);
        showCursor = cell >= 0;
        if (showCursor) cursor = cell;
      },
      onTap(p) {
        if (inBtn(p)) flow();
        else lay(cellAt(p));
      },
    });

    report();
    return {
      draw,
      frame(dt) {
        const ev = step(s, dt);
        arena.update(dt);
        onStep(ev);
        report();
        draw();
        if (ev.end === 'win') ctx.win();
        else if (ev.end === 'lose') ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = keyDir(e.key);
        const act = k === ' ' || k === 'enter';
        if (dir === -1 && !act && k !== 'f') return false;
        if (e.type !== 'keydown') return true;
        if (dir !== -1) {
          const col = Math.max(0, Math.min(COLS - 1, (cursor % COLS) + DX[dir]));
          const row = Math.max(0, Math.min(ROWS - 1, Math.floor(cursor / COLS) + DY[dir]));
          cursor = row * COLS + col;
          showCursor = true;
          draw();
        } else if (act) {
          showCursor = true;
          lay(cursor);
        } else flow();
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
