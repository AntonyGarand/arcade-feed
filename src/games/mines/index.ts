import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type Difficulty, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { DX, DY, gestures, keyDir, type Point } from '../../kits/gesture/gesture';
import {
  CELL_POINTS,
  CLEAN_BONUS,
  createLevel,
  LIFE_BONUS,
  livesFor,
  minesFor,
  minesLeft,
  reveal,
  sizeFor,
  tick,
  TIME_POINTS,
  timeFor,
  toggleFlag,
  type Events,
} from './rules';

const W = 300;
const H = 400;
/** Toolbar under the board (flag-mode button, mines left, clock). */
const BAR = 50;
const PAD = 8;
/** Seconds a press must hold still to plant a flag. */
const LONG_S = 0.35;
/** Palette slot per count (1 blue, 2 green, 3 orange, 4 purple, 5 pink, 6 cyan, 7 yellow, 8 lime). */
const TONE = [1, 2, 0, 4, 6, 5, 3, 7];
const FONT = "'Space Grotesk Variable', system-ui, sans-serif";

/** Seconds a quick, sure player needs for a typical board (about one tap a second). */
const strongFor = (d: Difficulty) => byLevel(d, [15, 25, 32, 36, 46]);
const safeFor = (d: Difficulty) => sizeFor(d)[0] * sizeFor(d)[1] - minesFor(d);

export const mines: GameDef = {
  id: 'mines',
  get name() {
    return L('Mines', 'Mines');
  },
  get rules() {
    return L('Open every safe cell before the clock runs out.', 'Ouvrez toutes les cases sûres avant la fin du chrono.');
  },
  category: 'think',
  help: () => ({
    goal: L(
      'Open every cell without a mine before time runs out. No guessing needed: logic always shows a safe cell.',
      'Ouvrez toutes les cases sans mine avant la fin du temps. Pas besoin de deviner : la logique montre toujours une case sûre.',
    ),
    steps: [
      L(
        'Your first tap is always safe and opens an area. The clock starts then.',
        'Votre première touche est toujours sûre et ouvre une zone. Le chrono part à ce moment.',
      ),
      L(
        'A number tells how many mines touch that cell, diagonals included.',
        'Un chiffre indique combien de mines touchent cette case, en diagonale aussi.',
      ),
      L(
        'Opening a mine costs a life. Tap a number whose mines are all flagged to open its other neighbours.',
        'Ouvrir une mine coûte une vie. Touchez un chiffre dont toutes les mines ont un drapeau pour ouvrir ses autres voisines.',
      ),
      L(
        'Tap to open; hold a cell (or switch on the flag button) to plant a flag.',
        'Touchez pour ouvrir; maintenez une case (ou activez le bouton drapeau) pour planter un drapeau.',
      ),
      L(
        'Keyboard: arrows move the cursor, Space opens, F flags, P to pause.',
        'Clavier : les flèches déplacent le curseur, Espace ouvre, F met un drapeau, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Compare two neighbouring numbers: the cells only one of them touches often settle it.',
        'Comparez deux chiffres voisins : les cases qu’un seul des deux touche règlent souvent la question.',
      ),
      L(
        `${CELL_POINTS} points per cell, ${TIME_POINTS} per second left, ${LIFE_BONUS} per life left, ${CLEAN_BONUS} if no flag was wrong.`,
        `${CELL_POINTS} points par case, ${TIME_POINTS} par seconde restante, ${LIFE_BONUS} par vie restante, ${CLEAN_BONUS} si aucun drapeau n’était faux.`,
      ),
    ],
  }),
  stars: (d) => {
    const cells = safeFor(d) * CELL_POINTS;
    const lives = livesFor(d);
    return [
      cells + (lives - 1) * LIFE_BONUS + (timeFor(d) - 2 * strongFor(d)) * TIME_POINTS,
      cells + lives * LIFE_BONUS + CLEAN_BONUS + (timeFor(d) - strongFor(d)) * TIME_POINTS,
    ];
  },
  par: (d) => Math.round(strongFor(d) * 1.6),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const max = livesFor(ctx.difficulty);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const cs = Math.floor(Math.min((W - 2 * PAD) / s.cols, (H - BAR - 2 * PAD) / s.rows));
    const ox = (W - cs * s.cols) / 2;
    const oy = (H - BAR - cs * s.rows) / 2;
    const n = s.cols * s.rows;

    let flagMode = false;
    let cursor = -1;
    /** Cell being pressed, how long, and whether the hold already planted a flag. */
    let press = -1;
    let held = 0;
    let fired = false;
    /** Seconds since each cell opened (negative: still waiting in the ripple). */
    const age = new Array<number>(n).fill(1);
    /** Cells already shown open (so a later ripple leaves them be). */
    const shownOpen = new Array<boolean>(n).fill(false);
    let flash = 0;
    let shake = 0;
    let shown = -1;

    const button = { x: PAD, y: H - BAR + 6, w: 118, h: BAR - 14 };

    const status = () => {
      if (!s.placed) {
        ctx.status(L('Tap any cell to start', 'Touchez une case pour commencer'));
        return;
      }
      shown = Math.max(0, Math.ceil(s.limit - s.time));
      ctx.status(
        [P(Math.max(0, minesLeft(s)), ['mine left', 'mines left'], ['mine restante', 'mines restantes']), `${shown} s`].join(' · '),
      );
    };

    const cellAt = (p: Point) => {
      const c = Math.floor((p.x - ox) / cs);
      const r = Math.floor((p.y - oy) / cs);
      return c >= 0 && r >= 0 && c < s.cols && r < s.rows ? r * s.cols + c : -1;
    };
    const inButton = (p: Point) => p.x >= button.x && p.x <= button.x + button.w && p.y >= button.y && p.y <= button.y + button.h;

    function after(ev: Events, from: number) {
      if (ev.opened) {
        // Ripple out from the tapped cell.
        const fc = from % s.cols;
        const fr = Math.floor(from / s.cols);
        for (let i = 0; i < n; i++)
          if (s.open[i] && !shownOpen[i]) {
            shownOpen[i] = true;
            age[i] = -0.025 * Math.max(Math.abs((i % s.cols) - fc), Math.abs(Math.floor(i / s.cols) - fr));
          }
        ctx.score(s.score);
      }
      if (ev.boom) {
        flash = 1;
        shake = 0.35;
        ctx.lives(Math.max(0, s.lives), max);
      }
      status();
      draw();
      if (ev.won) {
        ctx.score(s.score);
        ctx.win();
      } else if (ev.over) ctx.lose();
    }

    const open = (i: number) => after(reveal(s, i), i);
    const flag = (i: number) => {
      if (toggleFlag(s, i)) {
        status();
        draw();
      }
    };

    function drawFlag(g: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string) {
      const c = arena.colors;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(x - size * 0.22, y + size * 0.36);
      g.lineTo(x - size * 0.22, y - size * 0.36);
      g.stroke();
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(x - size * 0.22, y - size * 0.36);
      g.lineTo(x + size * 0.32, y - size * 0.18);
      g.lineTo(x - size * 0.22, y);
      g.closePath();
      g.fill();
      g.stroke();
    }

    function drawMine(g: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string) {
      const c = arena.colors;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw;
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4;
        g.moveTo(x - Math.cos(a) * size * 0.36, y - Math.sin(a) * size * 0.36);
        g.lineTo(x + Math.cos(a) * size * 0.36, y + Math.sin(a) * size * 0.36);
      }
      g.stroke();
      arena.disc(g, x, y, size * 0.24, fill);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      g.save();
      if (shake > 0) g.translate(Math.sin(shake * 90) * shake * 8, 0);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `700 ${Math.round(cs * 0.56)}px ${FONT}`;
      const lost = s.done && s.opened < s.safe;
      const won = s.done && !lost;
      for (let i = 0; i < n; i++) {
        const x = ox + (i % s.cols) * cs;
        const y = oy + Math.floor(i / s.cols) * cs;
        const mx = x + cs / 2;
        const my = y + cs / 2;
        if (s.boom[i]) {
          arena.box(g, x + 1.5, y + 1.5, cs - 3, cs - 3, c.bad, 4, false);
          drawMine(g, mx, my, cs, c.ink);
          continue;
        }
        if (!s.open[i] || age[i] < 0) {
          arena.box(g, x + 1.5, y + 1.5, cs - 3, cs - 3, c.cellAlt, 4);
          if (s.flag[i]) {
            drawFlag(g, mx, my, cs, won ? c.good : c.bad);
            if (lost && !s.mine[i]) {
              // A wrong flag: crossed out.
              g.strokeStyle = c.fg;
              g.lineWidth = arena.lw;
              g.beginPath();
              g.moveTo(x + cs * 0.22, y + cs * 0.22);
              g.lineTo(x + cs * 0.78, y + cs * 0.78);
              g.stroke();
            }
          } else if (s.mine[i] && won) drawFlag(g, mx, my, cs, c.good);
          else if (s.mine[i] && lost) drawMine(g, mx, my, cs * 0.85, c.muted);
          continue;
        }
        // Open: flat, a pop of growth while it fades in.
        const k = Math.min(1, age[i] / 0.16); // grows in over 0.16 s
        g.fillStyle = c.cellAlt;
        g.globalAlpha = 0.35;
        g.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
        g.globalAlpha = 1;
        const v = s.num[i];
        if (v) {
          const r = (cs / 2 - 3) * (0.6 + 0.4 * k);
          g.fillStyle = c.p[TONE[v - 1]];
          g.globalAlpha = 0.45;
          g.beginPath();
          g.roundRect(mx - r, my - r, 2 * r, 2 * r, r * 0.4);
          g.fill();
          g.globalAlpha = 1;
          g.fillStyle = c.fg;
          g.fillText(String(v), mx, my + 1);
        }
      }
      // Hold-to-flag progress around the pressed cell.
      if (press >= 0 && !fired && held > 0.08) {
        const x = ox + (press % s.cols) * cs + cs / 2;
        const y = oy + Math.floor(press / s.cols) * cs + cs / 2;
        g.strokeStyle = c.accent;
        g.lineWidth = arena.lw * 1.6;
        g.beginPath();
        g.arc(x, y, cs * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.min(1, held / LONG_S) * Math.PI * 2);
        g.stroke();
      }
      if (cursor >= 0) {
        const x = ox + (cursor % s.cols) * cs;
        const y = oy + Math.floor(cursor / s.cols) * cs;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 1.2;
        g.setLineDash([5, 3]);
        g.beginPath();
        g.roundRect(x + 1, y + 1, cs - 2, cs - 2, 5);
        g.stroke();
        g.setLineDash([]);
      }
      g.restore();
      drawBar(g);
      if (flash > 0) {
        g.fillStyle = c.bad;
        g.globalAlpha = flash * 0.35;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    function drawBar(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const b = button;
      arena.box(g, b.x, b.y, b.w, b.h, flagMode ? c.accent : c.cell, 8);
      drawFlag(g, b.x + 20, b.y + b.h / 2, 26, c.bad);
      g.fillStyle = c.fg;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = `700 13px ${FONT}`;
      g.fillText(flagMode ? L('Flag: on', 'Drapeau : oui') : L('Flag: off', 'Drapeau : non'), b.x + 36, b.y + b.h / 2 + 1);
      // Mines left.
      const mx = b.x + b.w + 26;
      const my = b.y + b.h / 2;
      drawMine(g, mx, my, 26, c.muted);
      g.fillStyle = c.fg;
      g.font = `700 16px ${FONT}`;
      g.fillText(String(Math.max(0, minesLeft(s))), mx + 16, my + 1);
      // Clock: a bar that drains, red in the last 10 seconds.
      const left = Math.max(0, s.limit - s.time);
      const tx = mx + 46;
      const tw = W - PAD - tx;
      arena.box(g, tx, my - 7, tw, 14, c.cell, 7, false);
      g.fillStyle = left <= 10 && s.placed ? c.bad : c.accent;
      g.beginPath();
      g.roundRect(tx + 2, my - 5, Math.max(0, (tw - 4) * (left / s.limit)), 10, 5);
      g.fill();
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 10,
      onDown(p) {
        press = s.done ? -1 : cellAt(p);
        held = 0;
        fired = false;
      },
      onMove(p, from) {
        if (from && press >= 0 && Math.hypot(p.x - from.x, p.y - from.y) > cs * 0.4) press = -1;
      },
      onTap(p) {
        const i = press;
        press = -1;
        if (inButton(p)) {
          flagMode = !flagMode;
          draw();
          return;
        }
        if (i < 0 || fired || s.done) return;
        cursor = -1;
        if (flagMode && s.placed && !s.open[i]) flag(i);
        else open(i);
      },
    });

    // Right click flags too (and keeps the browser menu away).
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      press = -1;
      if (!s.done) flag(cellAt(arena.toWorld(e)));
    };
    arena.canvas.addEventListener('contextmenu', onContext);

    ctx.score(0);
    ctx.lives(s.lives, max);
    status();
    return {
      draw,
      frame(dt) {
        if (press >= 0 && !fired) {
          held += dt;
          if (held >= LONG_S) {
            fired = true;
            if (s.placed && !s.open[press]) flag(press);
          }
        }
        for (let i = 0; i < n; i++) if (age[i] < 1) age[i] = Math.min(1, age[i] + dt);
        flash = Math.max(0, flash - dt * 2.5);
        shake = Math.max(0, shake - dt);
        const ev = tick(s, dt);
        if (s.placed && Math.ceil(s.limit - s.time) !== shown) status();
        draw();
        if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = keyDir(e.key);
        // Arrows only (WASD would clash with F), plus Space / Enter / F.
        const arrow = dir !== -1 && k.startsWith('arrow');
        if (!arrow && k !== ' ' && k !== 'enter' && k !== 'f') return false;
        if (e.type !== 'keydown') return true;
        const mid = Math.floor(s.rows / 2) * s.cols + Math.floor(s.cols / 2);
        if (cursor < 0) cursor = mid;
        else if (arrow) {
          const c = Math.min(s.cols - 1, Math.max(0, (cursor % s.cols) + DX[dir]));
          const r = Math.min(s.rows - 1, Math.max(0, Math.floor(cursor / s.cols) + DY[dir]));
          cursor = r * s.cols + c;
        } else if (k === 'f') flag(cursor);
        else open(cursor);
        draw();
        return true;
      },
      destroy() {
        stopGestures();
        arena.canvas.removeEventListener('contextmenu', onContext);
        arena.destroy();
      },
    };
  },
};
