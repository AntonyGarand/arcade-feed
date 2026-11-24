import './style.css';
import { L } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { outBack } from '../../kits/arena/ease';
import { DX, DY, gestures, keyDir } from '../../kits/gesture/gesture';
import { sfx } from '../../kits/sound/sound';
import { glyphPath } from '../../kits/glyph/glyph';
import { bop, createLevel, durationFor, GOLD_POINTS, HIT_POINTS, isUp, LIFE_BONUS, LIVES, type Pop, step, TIME_POINTS } from './rules';

const SIZE = 300;
const PAD = 10;
/** Height of the timer strip under the holes. */
const BAR = 12;
/** Seconds a critter takes to spring out of its hole (and to sink back). */
const RISE_S = 0.14;
/** Seconds a whacked critter stays squashed on screen. */
const BONK_S = 0.3;
/** The mallet's swing down, and how long it stays before fading. */
const SWING_S = 0.08;
const MALLET_S = 0.24;
/** Glyphs: a four-point spike for decoys, a star above golden critters. */
const SPIKE = 7;
const STAR = 4;
/** Hole keys, row by row: numeric-keypad layout for 3×3, a 4×4 block of the keyboard otherwise. */
const KEYS: Record<number, string[]> = {
  3: ['7', '8', '9', '4', '5', '6', '1', '2', '3'],
  4: ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'],
};
/** Letter keys for 3×3 too, for keyboards without a keypad. */
const KEYS3 = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'];

export const whack: GameDef = {
  id: 'whack',
  get name() {
    return L('Whack', 'Tape-bestiole');
  },
  get rules() {
    return L('Bop the critters before they hide. Not the spiky ones!', 'Tapez les bestioles, mais jamais les piquantes!');
  },
  category: 'reflex',
  help: () => ({
    goal: L('Hit the number of critters shown before the time runs out.', 'Tapez le nombre de bestioles demandé avant la fin du temps.'),
    steps: [
      L(
        'Critters pop out of the holes for a moment: hit them before they duck back down.',
        'Des bestioles sortent des trous un instant : tapez-les avant qu’elles redescendent.',
      ),
      L(
        'Golden critters with a star are quicker and worth much more.',
        'Les bestioles dorées avec une étoile sont plus rapides et valent bien plus.',
      ),
      L(
        'Never hit the spiky dark ones: each costs a heart. Hitting an empty hole jams your mallet a moment.',
        'Ne tapez jamais les foncées piquantes : chacune coûte un cœur. Taper un trou vide bloque votre maillet un instant.',
      ),
      L('Tap a critter to hit it.', 'Touchez une bestiole pour la taper.'),
      L(
        'Keyboard: keypad 7 8 9 / 4 5 6 / 1 2 3 (or Q W E / A S D / Z X C; 1-4, Q-R, A-F, Z-V on 4×4), or arrows and Space; P to pause.',
        'Clavier : pavé 7 8 9 / 4 5 6 / 1 2 3 (ou Q W E / A S D / Z X C; 1-4, Q-R, A-F, Z-V en 4×4), ou flèches et Espace; P pour la pause.',
      ),
    ],
    tips: [
      L(
        `A hit is worth ${HIT_POINTS} (golden: ${GOLD_POINTS}), more if it's quick and when you chain hits without a miss.`,
        `Un coup vaut ${HIT_POINTS} (dorée : ${GOLD_POINTS}), plus s’il est rapide et si vous enchaînez sans rater.`,
      ),
      L(
        `Finishing early pays ${TIME_POINTS} per second left, and each heart left ${LIFE_BONUS}.`,
        `Finir tôt rapporte ${TIME_POINTS} par seconde restante, et chaque cœur restant ${LIFE_BONUS}.`,
      ),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [540, 640],
      [600, 730],
      [700, 830],
      [800, 1050],
      [850, 1200],
    ] as const),
  par: (d) => Math.round(durationFor(d) * 0.65),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const n = s.n;
    const cell = (SIZE - 2 * PAD) / n;
    const arena = new Arena(ctx.root, SIZE, SIZE + BAR, () => draw());
    const fx = arena.fx;
    const keys = KEYS[n];
    let cursor = -1;
    let keyboard = false;
    /** The last swing: which hole, when (arena time) and whether it hit a critter. */
    let swing = { hole: -1, at: -9, hit: false };
    let ended = false;
    let shown = '';

    const status = () => {
      const text = [
        `${L('Hits', 'Coups')} ${s.hits}/${s.target}`,
        `${Math.max(0, Math.ceil(s.duration - s.time))} s`,
        s.streak >= 3 ? L(`streak ×${s.streak}`, `série ×${s.streak}`) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (text !== shown) ctx.status((shown = text));
    };

    const centre = (h: number) => ({ x: PAD + (h % n) * cell + cell / 2, y: PAD + Math.floor(h / n) * cell + cell / 2 });
    /** The hole's mouth sits below the cell's centre; critters rise above it. */
    const mouthY = (h: number) => centre(h).y + cell * 0.24;
    const holeW = cell * 0.36;
    const holeH = cell * 0.12;

    function drawCritter(g: CanvasRenderingContext2D, p: Pop) {
      const c = arena.colors;
      const { x } = centre(p.hole);
      const my = mouthY(p.hole);
      const r = cell * 0.3;
      // How far out of the hole: springing up, up, sinking; squashed for a moment once hit.
      const since = s.time - p.t;
      const left = p.t + p.dur - s.time;
      const bonk = p.hit >= 0 ? Math.min(1, (s.time - p.hit) / BONK_S) : 0;
      const out = p.hit >= 0 ? 1 - bonk * bonk : Math.min(outBack(Math.min(1, since / RISE_S), 2.2), left / RISE_S);
      if (out <= 0) return;
      const y = my - out * r * 1.25;
      const squash = p.hit >= 0 ? 1 - Math.min(1, bonk * 3) * 0.45 : 1;
      g.save();
      g.beginPath();
      g.rect(x - cell / 2, my - cell * 1.2, cell, cell * 1.2);
      g.clip();
      g.translate(x, y + r * (1 - squash));
      g.scale(1 + (1 - squash) * 0.7, squash);
      if (p.kind === 'decoy') {
        // A spiky dark ball that quivers, with angry red eyes.
        const body = arena.dark ? mix(c.coal, c.muted, 0.3) : c.coal;
        g.rotate(Math.sin(s.time * 18 + p.hole) * 0.08);
        g.fillStyle = body;
        g.strokeStyle = arena.dark ? c.ink : arena.tone(body).edge;
        g.lineWidth = arena.lw * 0.8;
        glyphPath(g, SPIKE, 0, 0, r * 1.3);
        g.fill();
        g.stroke();
        arena.ball(g, 0, 0, r * 0.66, body, false);
        for (const k of [-1, 1]) {
          g.fillStyle = c.bad;
          g.beginPath();
          g.arc(k * r * 0.24, 0, r * 0.1, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = c.bad;
          g.lineWidth = arena.lw * 1.1;
          g.beginPath();
          g.moveTo(k * r * 0.48, -r * 0.3);
          g.lineTo(k * r * 0.1, -r * 0.14);
          g.stroke();
        }
      } else {
        const body = p.kind === 'gold' ? c.p[3] : c.accent;
        for (const k of [-1, 1]) arena.ball(g, k * r * 0.64, -r * 0.76, r * 0.3, body, false);
        arena.ball(g, 0, 0, r, body);
        // Muzzle, eyes (squeezed shut once hit) and nose.
        g.fillStyle = arena.tone(body).hi;
        g.beginPath();
        g.ellipse(0, r * 0.32, r * 0.42, r * 0.28, 0, 0, Math.PI * 2);
        g.fill();
        for (const k of [-1, 1]) {
          if (p.hit >= 0) {
            g.strokeStyle = c.coal;
            g.lineWidth = arena.lw * 0.8;
            g.beginPath();
            g.moveTo(k * r * 0.5, -r * 0.26);
            g.lineTo(k * r * 0.26, -r * 0.13);
            g.lineTo(k * r * 0.5, 0);
            g.stroke();
          } else {
            arena.disc(g, k * r * 0.36, -r * 0.14, r * 0.2, c.paper);
            g.fillStyle = c.coal;
            g.beginPath();
            g.arc(k * r * 0.36, -r * 0.1, r * 0.1, 0, Math.PI * 2);
            g.fill();
          }
        }
        g.fillStyle = c.coal;
        g.beginPath();
        g.ellipse(0, r * 0.2, r * 0.12, r * 0.08, 0, 0, Math.PI * 2);
        g.fill();
        if (p.kind === 'gold') {
          g.fillStyle = c.p[3];
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.7;
          glyphPath(g, STAR, 0, -r * 1.42, r * 0.42 * (1 + 0.12 * Math.sin(s.time * 12)));
          g.fill();
          g.stroke();
        }
      }
      g.restore();
    }

    /** The mallet: swings down onto the tapped hole, then fades away. */
    function drawMallet(g: CanvasRenderingContext2D) {
      const age = arena.time - swing.at;
      if (swing.hole < 0 || age > MALLET_S) return;
      const c = arena.colors;
      const { x } = centre(swing.hole);
      const top = mouthY(swing.hole) - cell * 0.38;
      g.save();
      g.globalAlpha = age < SWING_S ? 1 : Math.max(0, 1 - (age - SWING_S) / (MALLET_S - SWING_S));
      g.translate(x + cell * 0.4, top);
      g.rotate((age < SWING_S ? -0.9 * (1 - age / SWING_S) : 0) - 0.12);
      arena.box(g, -cell * 0.36, -cell * 0.03, cell * 0.42, cell * 0.06, c.p[0], 2, false);
      arena.block(g, -cell * 0.52, -cell * 0.13, cell * 0.2, cell * 0.26, swing.hit ? c.p[1] : c.muted, 3, false);
      g.restore();
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, SIZE, SIZE + BAR, 20, 0, false);
      /** Inside of a hole: dark in both themes; a mound of earth around it. */
      const pit = mix(c.coal, c.cellAlt, arena.dark ? 0.15 : 0.3);
      const mound = arena.tone(c.cellAlt).lo;
      /** Where the mound outline meets the mouth line: the front lip runs below it. */
      const lipA = Math.asin(0.3 / 1.9);
      for (let h = 0; h < n * n; h++) {
        const { x, y } = centre(h);
        arena.box(g, x - cell / 2 + 3, y - cell / 2 + 3, cell - 6, cell - 6, c.cell, 8, false);
        const my = mouthY(h);
        g.fillStyle = mound;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.7;
        g.beginPath();
        g.ellipse(x, my + holeH * 0.3, holeW * 1.18, holeH * 1.9, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = pit;
        g.beginPath();
        g.ellipse(x, my, holeW, holeH, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      for (const p of s.pops) {
        const visible = isUp(p, s.time) || (p.hit >= 0 && s.time - p.hit < BONK_S);
        if (visible) drawCritter(g, p);
      }
      // Front of the mound over the critters' bottoms, so they come out of the hole.
      for (let h = 0; h < n * n; h++) {
        const { x } = centre(h);
        const my = mouthY(h);
        g.fillStyle = mound;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.7;
        g.beginPath();
        g.ellipse(x, my, holeW, holeH, 0, 0, Math.PI);
        g.ellipse(x, my + holeH * 0.3, holeW * 1.18, holeH * 1.9, 0, Math.PI + lipA, -lipA, true);
        g.closePath();
        g.fill();
        g.beginPath();
        g.ellipse(x, my, holeW, holeH, 0, 0, Math.PI);
        g.stroke();
        g.beginPath();
        g.ellipse(x, my + holeH * 0.3, holeW * 1.18, holeH * 1.9, 0, Math.PI + lipA, -lipA, true);
        g.stroke();
        if (keyboard) {
          g.fillStyle = c.fg;
          g.font = `700 ${Math.round(cell * 0.13)}px ${arena.family}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(keys[h].toUpperCase(), x, my + cell * 0.2);
        }
      }
      drawMallet(g);
      if (cursor >= 0) {
        const { x, y } = centre(cursor);
        g.strokeStyle = c.accent;
        g.lineWidth = arena.lw * 1.4;
        g.setLineDash([6, 4]);
        g.beginPath();
        g.roundRect(x - cell / 2 + 3, y - cell / 2 + 3, cell - 6, cell - 6, 8);
        g.stroke();
        g.setLineDash([]);
      }
      // Time left along the bottom, red and pulsing for the last seconds.
      const left = Math.max(0, 1 - s.time / s.duration);
      const late = s.duration - s.time < 6 && !ended;
      const bw = SIZE - 2 * PAD;
      arena.box(g, PAD, SIZE - 2, bw, BAR - 4, c.cellAlt, 4, false);
      if (left > 0) {
        g.fillStyle = late ? c.bad : c.accent;
        g.globalAlpha = late ? 0.75 + 0.25 * Math.sin(s.time * 14) : 1;
        g.beginPath();
        g.roundRect(PAD, SIZE - 2, Math.max(BAR - 4, bw * left), BAR - 4, 4);
        g.fill();
        g.globalAlpha = 1;
      }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.7;
      g.beginPath();
      g.roundRect(PAD, SIZE - 2, bw, BAR - 4, 4);
      g.stroke();
      arena.overlay(g);
    }

    function end(won: boolean) {
      ended = true;
      const c = arena.colors;
      if (won) {
        for (let i = 0; i < 5; i++) fx.burst(SIZE / 2, SIZE / 2, c.p[i], 10, 200, 4, 0.9, 'square', 220);
        fx.ring(SIZE / 2, SIZE / 2, c.good, 10, 130, 0.6, arena.lw * 1.5);
        fx.flash(c.good, 0.22, 0.5);
      } else fx.flash(c.bad, 0.2, 0.4);
      arena.linger();
    }

    function hit(h: number) {
      const r = bop(s, h);
      if (!r.out) return;
      const c = arena.colors;
      const { x } = centre(h);
      const my = mouthY(h) - cell * 0.3;
      swing = { hole: h, at: arena.time, hit: r.out !== 'whiff' };
      if (r.out === 'whiff') {
        sfx('tick');
        fx.burst(x, mouthY(h), c.muted, 6, 50, 3, 0.35, 'dot', -40, -Math.PI / 2, Math.PI);
      } else if (r.out === 'decoy' || r.out === 'lose') {
        ctx.lives(s.lives, LIVES);
        fx.burst(x, my, c.bad, 12, 150, 3.5, 0.5, 'spark', 0);
        fx.ring(x, my, c.bad, cell * 0.2, cell * 0.6, 0.35, arena.lw * 1.5);
        fx.text(x, my - cell * 0.2, '✕', c.bad, 24);
        fx.shake(5, 0.35);
        fx.flash(c.bad, 0.25, 0.35);
        if (r.out === 'decoy') sfx('error');
      } else {
        const gold = r.pop?.kind === 'gold';
        const col = gold ? c.p[3] : c.accent;
        fx.burst(x, my, col, gold ? 16 : 10, 140, 3.5, 0.5, 'square', 200);
        fx.burst(x, my, c.paper, 5, 110, 2.5, 0.3, 'spark', 0);
        fx.ring(x, my, col, cell * 0.15, cell * (gold ? 0.7 : 0.5), 0.3, arena.lw * 1.2);
        fx.text(x, my - cell * 0.15, `+${r.points}`, gold ? c.p[3] : c.fg, gold ? 18 : 14);
        if (s.streak >= 3 && r.out !== 'win') fx.text(x, my - cell * 0.4, `×${s.streak}`, c.accent, 12, 0.7);
        if (gold) {
          fx.shake(2.5, 0.2);
          sfx('power');
        } else sfx('pop', { pitch: Math.min(10, s.streak) });
      }
      ctx.score(s.score);
      status();
      if (r.out === 'win' || r.out === 'lose') end(r.out === 'win');
      draw();
      if (r.out === 'win') ctx.win();
      else if (r.out === 'lose') ctx.lose();
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: cell * 0.4,
      onDown(p) {
        const c = Math.floor((p.x - PAD) / cell);
        const r = Math.floor((p.y - PAD) / cell);
        if (c >= 0 && r >= 0 && c < n && r < n) hit(r * n + c);
      },
    });

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const before = s.time;
        const ev = step(s, dt);
        arena.update(dt);
        if (ev.missed) {
          // A critter got away: a puff of dust as it ducks back down.
          const c = arena.colors;
          for (const p of s.pops) {
            const gone = p.t + p.dur;
            if (p.hit >= 0 || p.kind === 'decoy' || gone <= before || gone > s.time) continue;
            fx.burst(centre(p.hole).x, mouthY(p.hole) - 4, c.muted, 6, 60, 3, 0.4, 'dot', -30, -Math.PI / 2, Math.PI * 0.8);
          }
        }
        status();
        if (ev.over) end(false);
        draw();
        if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        let h = keys.indexOf(k);
        if (h < 0 && n === 3) h = KEYS3.indexOf(k);
        const dir = h < 0 ? keyDir(e.key) : -1;
        const swingKey = e.key === ' ' || e.key === 'Enter';
        if (h < 0 && dir === -1 && !swingKey) return false;
        if (e.type !== 'keydown' || e.repeat) return true;
        keyboard = true;
        if (h >= 0) hit(h);
        else if (dir !== -1) {
          const mid = Math.floor(n / 2) * (n + 1);
          if (cursor < 0) cursor = mid;
          else {
            const cc = (cursor % n) + DX[dir];
            const rr = Math.floor(cursor / n) + DY[dir];
            if (cc >= 0 && rr >= 0 && cc < n && rr < n) cursor = rr * n + cc;
          }
        } else if (cursor < 0) cursor = Math.floor(n / 2) * (n + 1);
        else hit(cursor);
        draw();
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
