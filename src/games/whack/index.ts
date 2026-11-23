import './style.css';
import { L } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { DX, DY, gestures, keyDir } from '../../kits/gesture/gesture';
import { sfx } from '../../kits/sound/sound';
import { glyphPath } from '../../kits/glyph/glyph';
import {
  bop,
  createLevel,
  durationFor,
  GOLD_POINTS,
  HIT_POINTS,
  isUp,
  LIFE_BONUS,
  LIVES,
  type Pop,
  step,
  TIME_POINTS,
  WHIFF_S,
} from './rules';

const SIZE = 300;
const PAD = 10;
const BAR = 6;
/** Seconds a critter takes to rise out of its hole (and to sink back). */
const RISE_S = 0.1;
/** Seconds a whacked critter stays squashed on screen. */
const BONK_S = 0.3;
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

interface Float {
  x: number;
  y: number;
  text: string;
  life: number;
  good: boolean;
}

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
    const keys = KEYS[n];
    let cursor = -1;
    let keyboard = false;
    let floats: Float[] = [];
    /** Seconds left of the red flash after hitting a decoy, and of the dust puff after a whiff. */
    let ouch = 0;
    let puff = { hole: -1, t: 0 };
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
    /** The hole's mouth sits a bit below the cell's centre; critters rise above it. */
    const mouthY = (h: number) => centre(h).y + cell * 0.2;

    function drawCritter(g: CanvasRenderingContext2D, p: Pop) {
      const c = arena.colors;
      const { x } = centre(p.hole);
      const my = mouthY(p.hole);
      const r = cell * 0.26;
      // How far out of the hole: rising, up, sinking; squashed for a moment once hit.
      const since = s.time - p.t;
      const left = p.t + p.dur - s.time;
      const bonk = p.hit >= 0 ? Math.min(1, (s.time - p.hit) / BONK_S) : 0;
      const out = p.hit >= 0 ? 1 - bonk : Math.min(1, since / RISE_S, left / RISE_S);
      if (out <= 0) return;
      const y = my - out * r * 0.95;
      const squash = p.hit >= 0 ? 1 - bonk * 0.5 : 1;
      g.save();
      g.beginPath();
      g.rect(x - cell / 2, my - cell, cell, cell);
      g.clip();
      g.translate(x, y);
      g.scale(1 + (1 - squash) * 0.6, squash);
      if (p.kind === 'decoy') {
        g.fillStyle = c.fg;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.8;
        glyphPath(g, SPIKE, 0, 0, r * 1.25);
        g.fill();
        g.stroke();
        // Angry slanted eyes.
        g.strokeStyle = c.bad;
        g.lineWidth = arena.lw * 1.1;
        for (const k of [-1, 1]) {
          g.beginPath();
          g.moveTo(k * r * 0.5, -r * 0.2);
          g.lineTo(k * r * 0.12, -r * 0.02);
          g.stroke();
        }
      } else {
        const body = p.kind === 'gold' ? c.p[3] : c.accent;
        for (const k of [-1, 1]) arena.disc(g, k * r * 0.62, -r * 0.78, r * 0.3, body);
        arena.disc(g, 0, 0, r, body);
        for (const k of [-1, 1]) {
          arena.disc(g, k * r * 0.36, -r * 0.18, r * 0.24, c.cell);
          g.fillStyle = c.ink;
          g.beginPath();
          if (p.hit >= 0) g.rect(k * r * 0.36 - r * 0.16, -r * 0.2, r * 0.32, r * 0.06);
          else g.arc(k * r * 0.36, -r * 0.14, r * 0.11, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = c.ink;
        g.beginPath();
        g.arc(0, r * 0.2, r * 0.1, 0, Math.PI * 2);
        g.fill();
        if (p.kind === 'gold') {
          g.fillStyle = c.p[3];
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.7;
          glyphPath(g, STAR, 0, -r * 1.35, r * 0.42);
          g.fill();
          g.stroke();
        }
      }
      g.restore();
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      for (let h = 0; h < n * n; h++) {
        const { x, y } = centre(h);
        arena.box(g, x - cell / 2 + 3, y - cell / 2 + 3, cell - 6, cell - 6, c.cellAlt, 8, false);
        // The hole: dark mouth, back rim.
        const my = mouthY(h);
        g.fillStyle = c.muted;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.8;
        g.beginPath();
        g.ellipse(x, my, cell * 0.34, cell * 0.11, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      for (const p of s.pops) {
        const visible = isUp(p, s.time) || (p.hit >= 0 && s.time - p.hit < BONK_S);
        if (visible) drawCritter(g, p);
      }
      // Front rim over the critters' bottoms, so they come out of the hole.
      for (let h = 0; h < n * n; h++) {
        const { x } = centre(h);
        const my = mouthY(h);
        g.fillStyle = c.cellAlt;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.8;
        g.beginPath();
        g.ellipse(x, my, cell * 0.34, cell * 0.11, 0, 0, Math.PI);
        g.lineTo(x - cell * 0.4, my + cell * 0.18);
        g.lineTo(x + cell * 0.4, my + cell * 0.18);
        g.closePath();
        g.fill();
        g.beginPath();
        g.ellipse(x, my, cell * 0.34, cell * 0.11, 0, 0, Math.PI);
        g.stroke();
        if (keyboard) {
          g.fillStyle = c.muted;
          g.font = `600 ${Math.round(cell * 0.12)}px system-ui, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(keys[h].toUpperCase(), x, my + cell * 0.235);
        }
      }
      if (puff.t > 0) {
        const { x } = centre(puff.hole);
        const my = mouthY(puff.hole);
        g.globalAlpha = puff.t / WHIFF_S;
        for (const k of [-1, 0, 1]) arena.disc(g, x + k * cell * 0.16, my - cell * 0.08 - (1 - puff.t / WHIFF_S) * 8, cell * 0.07, c.cell);
        g.globalAlpha = 1;
      }
      if (cursor >= 0) {
        const { x, y } = centre(cursor);
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 1.2;
        g.setLineDash([6, 4]);
        g.beginPath();
        g.roundRect(x - cell / 2 + 3, y - cell / 2 + 3, cell - 6, cell - 6, 8);
        g.stroke();
        g.setLineDash([]);
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const f of floats) {
        g.globalAlpha = Math.min(1, f.life * 2);
        g.font = `800 ${Math.round(cell * 0.22)}px system-ui, sans-serif`;
        g.lineWidth = 3;
        g.strokeStyle = c.cell;
        g.strokeText(f.text, f.x, f.y);
        g.fillStyle = f.good ? c.fg : c.bad;
        g.fillText(f.text, f.x, f.y);
      }
      g.globalAlpha = 1;
      if (ouch > 0) {
        g.globalAlpha = ouch;
        g.fillStyle = c.bad;
        g.fillRect(0, 0, SIZE, SIZE);
        g.globalAlpha = 1;
      }
      // Time left along the bottom.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, SIZE, SIZE, BAR);
      g.fillStyle = s.duration - s.time < 6 ? c.bad : c.accent;
      g.fillRect(0, SIZE, SIZE * Math.max(0, 1 - s.time / s.duration), BAR);
    }

    function hit(h: number) {
      const r = bop(s, h);
      if (!r.out) return;
      const { x, y } = centre(h);
      if (r.out === 'whiff') {
        puff = { hole: h, t: WHIFF_S };
        sfx('tick');
      } else if (r.out === 'decoy' || r.out === 'lose') {
        ouch = 0.35;
        floats.push({ x, y: y - cell * 0.3, text: '✕', life: 0.7, good: false });
        ctx.lives(s.lives, LIVES);
        if (r.out === 'decoy') sfx('error');
      } else {
        floats.push({ x, y: y - cell * 0.3, text: `+${r.points}`, life: 0.7, good: true });
        if (r.out === 'gold') sfx('power');
        else sfx('pop', { pitch: s.score % 5 });
      }
      ctx.score(s.score);
      status();
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
        const ev = step(s, dt);
        ouch = Math.max(0, ouch - dt * 1.5);
        puff.t = Math.max(0, puff.t - dt);
        for (const f of floats) {
          f.life -= dt;
          f.y -= dt * 30;
        }
        floats = floats.filter((f) => f.life > 0);
        status();
        draw();
        if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        let h = keys.indexOf(k);
        if (h < 0 && n === 3) h = KEYS3.indexOf(k);
        const dir = h < 0 ? keyDir(e.key) : -1;
        const swing = e.key === ' ' || e.key === 'Enter';
        if (h < 0 && dir === -1 && !swing) return false;
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
