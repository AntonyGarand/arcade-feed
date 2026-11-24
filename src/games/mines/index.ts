import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type Difficulty, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { outBack } from '../../kits/arena/ease';
import { DX, DY, gestures, keyDir, type Point } from '../../kits/gesture/gesture';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { haptic, sfx } from '../../kits/sound/sound';
import { drawBonus, drawFlag, drawMine } from './draw';
import { KIND_NAMES, POWER_NAMES } from './names';
import {
  CELL_POINTS,
  CLEAN_BONUS,
  CLOCK_S,
  FREEZE_S,
  GEM_POINTS,
  createLevel,
  SCOUT_CELLS,
  startCell,
  STREAK_S,
  STREAK_TIERS,
  TIME_S,
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
        'The clock runs from the start. Your first tap is always safe and opens an area.',
        'Le chrono part dès le début. Votre première touche est toujours sûre et ouvre une zone.',
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
        `Golden cells are always safe: an hourglass adds ${CLOCK_S} s, a gem ${GEM_POINTS} points. Some fields have holes: they aren’t cells.`,
        `Les cases dorées sont toujours sûres : un sablier ajoute ${CLOCK_S} s, un joyau ${GEM_POINTS} points. Certains champs ont des trous : ce ne sont pas des cases.`,
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
        `Open cells quickly (under ${STREAK_S} s apart) for a streak: ${STREAK_TIERS[0]} freeze the clock ${FREEZE_S} s, ${STREAK_TIERS[1]} send a scout to open ${SCOUT_CELLS} safe cells, ${STREAK_TIERS[2]} add ${TIME_S} s.`,
        `Ouvrez des cases rapidement (moins de ${STREAK_S} s d’écart) pour une série : ${STREAK_TIERS[0]} gèlent le chrono ${FREEZE_S} s, ${STREAK_TIERS[1]} envoient un éclaireur ouvrir ${SCOUT_CELLS} cases sûres, ${STREAK_TIERS[2]} ajoutent ${TIME_S} s.`,
      ),
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
      // A quick player also finds the bonus cells and freezes the clock once.
      cells + lives * LIFE_BONUS + CLEAN_BONUS + (timeFor(d) - strongFor(d) + CLOCK_S + FREEZE_S) * TIME_POINTS + GEM_POINTS,
    ];
  },
  par: (d) => Math.round(strongFor(d) * 1.6),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
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
    let shown = -1;
    const fx = arena.fx;
    /** Arena time each cell was last struck (flag planted, mine blown or shown), for its pop. */
    const struck = new Array<number>(n).fill(-9);
    /** Mines already blown up on screen. */
    const blown = new Array<boolean>(n).fill(false);

    const button = { x: PAD, y: H - BAR + 6, w: 118, h: BAR - 14 };

    /** What the status line last showed: frozen clock, streak running. */
    let shownState = '';
    const state = () => `${s.freeze > 0}${s.streak > 1 ? s.streak : 0}`;
    const status = () => {
      shown = Math.max(0, Math.ceil(s.limit - s.time));
      shownState = state();
      if (!s.placed) {
        ctx.status(L(`Tap any cell to open an area · ${shown} s`, `Touchez une case pour ouvrir une zone · ${shown} s`));
        return;
      }
      ctx.status(
        [
          P(Math.max(0, minesLeft(s)), ['mine left', 'mines left'], ['mine restante', 'mines restantes']),
          `${shown} s`,
          s.freeze > 0 ? L('frozen', 'gelé') : '',
          s.streak > 1 ? L(`streak ${s.streak}`, `série ${s.streak}`) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
    };

    const cellAt = (p: Point) => {
      const c = Math.floor((p.x - ox) / cs);
      const r = Math.floor((p.y - oy) / cs);
      return c >= 0 && r >= 0 && c < s.cols && r < s.rows ? r * s.cols + c : -1;
    };
    const inButton = (p: Point) => p.x >= button.x && p.x <= button.x + button.w && p.y >= button.y && p.y <= button.y + button.h;

    function after(ev: Events, from: number) {
      const c = arena.colors;
      const fc = from % s.cols;
      const fr = Math.floor(from / s.cols);
      const cx = ox + fc * cs + cs / 2;
      const cy = oy + fr * cs + cs / 2;
      if (ev.opened) {
        // Ripple out from the tapped cell.
        for (let i = 0; i < n; i++)
          if (s.open[i] && !shownOpen[i]) {
            shownOpen[i] = true;
            age[i] = -0.025 * Math.max(Math.abs((i % s.cols) - fc), Math.abs(Math.floor(i / s.cols) - fr));
          }
        ctx.score(s.score);
        if (!ev.boom) sfx(ev.opened > 1 ? 'pop' : 'tick', { pitch: ev.opened > 1 ? Math.min(8, ev.opened / 4) : 0 });
        if (ev.opened > 1) fx.ring(cx, cy, c.accent, cs * 0.3, cs * (1.2 + Math.min(3, ev.opened / 8)), 0.45, arena.lw);
        fx.text(cx, cy - cs * 0.4, `+${ev.opened * CELL_POINTS}`, ev.opened > 8 ? c.accent : c.fg, ev.opened > 8 ? 14 : 11);
      }
      const centreOf = (i: number) => ({ x: ox + (i % s.cols) * cs + cs / 2, y: oy + Math.floor(i / s.cols) * cs + cs / 2 });
      for (const b of ev.bonus) {
        const p = centreOf(b.i);
        const col = b.kind === 'clock' ? c.p[5] : c.p[3];
        fx.burst(p.x, p.y, col, 12, 120, 3, 0.5, 'spark', 0);
        fx.ring(p.x, p.y, col, cs * 0.2, cs * 0.9, 0.4, arena.lw);
        fx.text(p.x, p.y - cs * 0.6, b.kind === 'clock' ? `+${CLOCK_S} s` : `+${GEM_POINTS}`, col, 15, 1);
        sfx('coin', { pitch: b.kind === 'clock' ? 2 : 5 });
      }
      if (ev.opened && !ev.boom) comboPop(fx, cx + cs * 0.6, cy - cs * 0.6, s.streak, c.accent);
      if (ev.power) {
        const col = ev.power === 'freeze' ? c.p[5] : ev.power === 'scout' ? c.good : c.accent;
        comboTier(fx, ev.tier, col, POWER_NAMES[ev.power]());
        for (const j of ev.scouted) {
          const p = centreOf(j);
          fx.ring(p.x, p.y, c.good, cs * 0.2, cs * 1.4, 0.5, arena.lw * 1.3);
        }
        // The scout's cells ripple open from where they are.
        for (let i = 0; i < n; i++)
          if (s.open[i] && !shownOpen[i]) {
            shownOpen[i] = true;
            age[i] = -0.15;
          }
      }
      if (ev.boom) {
        // Every mine that went off this time: a blast where it sits.
        for (let i = 0; i < n; i++)
          if (s.boom[i] && !blown[i]) {
            blown[i] = true;
            struck[i] = arena.time;
            const bx = ox + (i % s.cols) * cs + cs / 2;
            const by = oy + Math.floor(i / s.cols) * cs + cs / 2;
            fx.burst(bx, by, c.bad, 16, 150, 4, 0.6, 'square', 200);
            fx.burst(bx, by, c.p[3], 10, 110, 3, 0.45, 'spark', 0);
            fx.ring(bx, by, c.bad, cs * 0.3, cs * 1.6, 0.45, arena.lw * 1.5);
          }
        sfx('boom');
        haptic(30);
        fx.shake(6, 0.4);
        fx.flash(c.bad, 0.3, 0.4);
        ctx.lives(Math.max(0, s.lives), max);
      }
      status();
      if (ev.won) {
        // Every hidden mine pops up a flag, then confetti.
        for (let i = 0; i < n; i++) if (s.mine[i] && !s.flag[i]) struck[i] = arena.time;
        for (let k = 0; k < 5; k++) fx.burst(W / 2, oy + (cs * s.rows) / 2, c.p[k], 10, 220, 4, 0.9, 'square', 220);
        fx.flash(c.good, 0.22, 0.5);
      }
      if (ev.won || ev.over) end();
      draw();
      if (ev.won) {
        ctx.score(s.score);
        ctx.win();
      } else if (ev.over) ctx.lose();
    }

    /** The run is over: on a lost board the hidden mines show up one after another. */
    function end() {
      if (s.opened < s.safe) {
        let k = 0;
        for (let i = 0; i < n; i++) if (s.mine[i] && !s.boom[i] && !s.flag[i]) struck[i] = arena.time + 0.05 * k++;
      }
      arena.linger(1.8);
    }

    const open = (i: number) => after(reveal(s, i), i);
    const flag = (i: number) => {
      if (toggleFlag(s, i)) {
        sfx('hit', { pitch: s.flag[i] ? 0 : -4, vol: 0.6 });
        struck[i] = arena.time;
        if (s.flag[i]) {
          const x = ox + (i % s.cols) * cs + cs / 2;
          const y = oy + Math.floor(i / s.cols) * cs + cs / 2;
          fx.burst(x, y - cs * 0.2, arena.colors.bad, 6, 70, 2.5, 0.35, 'dot', 120, -Math.PI / 2, Math.PI);
        }
        status();
        draw();
      }
    };

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // The board is a recessed tray: open cells are its floor, hidden cells raised tiles on it.
      arena.field(g, ox - 2, oy - 2, cs * s.cols + 4, cs * s.rows + 4, cs, 6);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `800 ${Math.round(cs * 0.6)}px ${arena.family}`;
      const lost = s.done && s.opened < s.safe;
      const won = s.done && !lost;
      const tile = arena.dark ? mix(c.cellAlt, c.fg, 0.2) : c.cell;
      for (let i = 0; i < n; i++) {
        const x = ox + (i % s.cols) * cs;
        const y = oy + Math.floor(i / s.cols) * cs;
        const mx = x + cs / 2;
        const my = y + cs / 2;
        const since = arena.time - struck[i];
        if (s.hole[i]) {
          // A hole in the field: the card shows through.
          arena.box(g, x - 0.5, y - 0.5, cs + 1, cs + 1, c.cell, 0, false);
          continue;
        }
        if (s.boom[i]) {
          const k = since < 0.3 ? 1 + 0.25 * Math.sin((since / 0.3) * Math.PI) : 1;
          arena.box(g, x + 1.5, y + 1.5, cs - 3, cs - 3, c.bad, 4, false);
          drawMine(arena, g, mx, my, cs * k, c.coal);
          continue;
        }
        if (!s.open[i] || age[i] < 0) {
          // A tile sinks while it's held down.
          const down = i === press && !fired && held > 0.08 ? 1.5 : 0;
          const gold = s.bonus[i] && !s.flag[i];
          arena.block(g, x + 1.5, y + 1.5 + down, cs - 3, cs - 3 - down, gold ? mix(tile, c.p[3], 0.35) : tile, 4, !down);
          if (gold && !s.done) drawBonus(arena, g, mx, my + down, cs, s.bonus[i] === 'clock');
          const pop = since < 0 ? 0 : since < 0.3 ? Math.max(0.01, outBack(since / 0.3, 2.4)) : 1;
          if (s.flag[i]) {
            drawFlag(arena, g, mx, my, cs, won ? c.good : c.bad, pop);
            if (lost && !s.mine[i]) {
              // A wrong flag: crossed out.
              g.strokeStyle = c.bad;
              g.lineWidth = arena.lw * 1.4;
              g.lineCap = 'round';
              g.beginPath();
              g.moveTo(x + cs * 0.22, y + cs * 0.22);
              g.lineTo(x + cs * 0.78, y + cs * 0.78);
              g.moveTo(x + cs * 0.78, y + cs * 0.22);
              g.lineTo(x + cs * 0.22, y + cs * 0.78);
              g.stroke();
              g.lineCap = 'butt';
            }
          } else if (s.mine[i] && won) drawFlag(arena, g, mx, my, cs, c.good, pop);
          else if (s.mine[i] && lost && pop > 0.01) drawMine(arena, g, mx, my, cs * 0.85 * pop, c.muted);
          continue;
        }
        // Open: the tray shows through; the number pops in as the ripple reaches it.
        const v = s.num[i];
        if (v) {
          const k = outBack(Math.min(1, age[i] / 0.22), 2);
          if (k <= 0.01) continue;
          const t = arena.tone(c.p[TONE[v - 1]]);
          g.save();
          g.translate(mx, my + 1);
          g.scale(k, k);
          g.fillStyle = arena.dark ? t.base : t.lo;
          g.fillText(String(v), 0, 0);
          g.restore();
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
        g.strokeStyle = c.accent;
        g.lineWidth = arena.lw * 1.4;
        g.setLineDash([5, 3]);
        g.lineDashOffset = -arena.time * 12;
        g.beginPath();
        g.roundRect(x + 1, y + 1, cs - 2, cs - 2, 5);
        g.stroke();
        g.setLineDash([]);
        g.lineDashOffset = 0;
      }
      // Streak meter along the top of the field: drains until the streak runs out.
      if (s.streak > 1 && !s.done) {
        g.fillStyle = c.accent;
        g.globalAlpha = 0.85;
        g.fillRect(ox, Math.max(1, oy - 6), cs * s.cols * Math.max(0, s.streakLeft / STREAK_S), 3);
        g.globalAlpha = 1;
      }
      drawBar(g);
      arena.overlay(g);
    }

    function drawBar(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const b = button;
      arena.box(g, b.x, b.y, b.w, b.h, flagMode ? c.accent : c.cell, 8);
      drawFlag(arena, g, b.x + 20, b.y + b.h / 2, 26, c.bad);
      g.fillStyle = flagMode ? c.coal : c.fg;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = `700 13px ${arena.family}`;
      g.fillText(flagMode ? L('Flag: on', 'Drapeau : oui') : L('Flag: off', 'Drapeau : non'), b.x + 36, b.y + b.h / 2 + 1);
      // Mines left.
      const mx = b.x + b.w + 26;
      const my = b.y + b.h / 2;
      drawMine(arena, g, mx, my, 26, c.muted);
      g.fillStyle = c.fg;
      g.font = `700 16px ${arena.family}`;
      g.fillText(String(Math.max(0, minesLeft(s))), mx + 16, my + 1);
      // Clock: a bar that drains, red in the last 10 seconds.
      const left = Math.max(0, s.limit - s.time);
      const tx = mx + 46;
      const tw = W - PAD - tx;
      arena.box(g, tx, my - 9, tw, 18, c.cell, 9, false);
      const frozen = s.freeze > 0;
      g.fillStyle = frozen ? c.p[5] : left <= 10 ? c.bad : c.accent;
      g.globalAlpha = left <= 10 && left > 0 && !frozen ? 0.75 + 0.25 * Math.sin(arena.time * 12) : 1;
      g.beginPath();
      g.roundRect(tx + 2, my - 7, Math.max(0, (tw - 4) * (left / s.limit)), 14, 7);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = c.fg;
      g.font = `800 11px ${arena.family}`;
      g.textAlign = 'center';
      g.strokeStyle = c.cell;
      g.lineWidth = 3;
      g.lineJoin = 'round';
      const label = frozen ? `❄ ${Math.ceil(left)} s` : `${Math.ceil(left)} s`;
      g.strokeText(label, tx + tw / 2, my + 1);
      g.fillText(label, tx + tw / 2, my + 1);
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
        arena.update(dt);
        const ev = tick(s, dt);
        const secs = Math.ceil(s.limit - s.time);
        if (secs !== shown) {
          if (secs <= 5 && secs > 0 && !s.freeze) sfx('tick', { pitch: 5 - secs });
          status();
        } else if (state() !== shownState) status();
        if (ev.over) {
          const c = arena.colors;
          fx.text(W / 2, oy + (cs * s.rows) / 2, L('Time’s up!', 'Temps écoulé!'), c.bad, 22, 1.4);
          fx.flash(c.bad, 0.25, 0.4);
          fx.shake(4, 0.3);
          end();
        }
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
        if (cursor < 0) cursor = startCell(s);
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
