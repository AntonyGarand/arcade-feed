import './style.css';
import { L, P } from '../../core/i18n';
import { btn } from '../../core/pad';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { glyphPath } from '../../kits/glyph/glyph';
import { sfx } from '../../kits/sound/sound';
import {
  COL_W,
  createLevel,
  flap,
  FLYER_R,
  FX,
  GATE_POINTS,
  gatesFor,
  GROUND,
  H,
  LIFE_BONUS,
  livesFor,
  PICKUP_POINTS,
  PICKUP_R,
  pickupsFor,
  spacingFor,
  speedFor,
  step,
  W,
} from './rules';

/** Glyph used for bonus stars (a five-point star). */
const STAR = 4;
const FONT = "700 13px 'Space Grotesk Variable', system-ui, sans-serif";

/** A short-lived pop: a gate score, a grabbed star or a crash ring. */
interface Pop {
  x: number;
  y: number;
  age: number;
  kind: 'gate' | 'star' | 'hit';
}

export const flutter: GameDef = {
  id: 'flutter',
  get name() {
    return L('Flutter', 'Battements');
  },
  get rules() {
    return L('Tap to flap through the gaps in the columns.', 'Touchez pour battre des ailes et franchir les ouvertures.');
  },
  category: 'move',
  help: () => ({
    goal: L(
      'Fly through every gate of the level without running out of hearts.',
      'Franchissez toutes les portes du niveau sans manquer de cœurs.',
    ),
    steps: [
      L(
        'Your flyer falls all the time; each flap lifts it up a little.',
        'Votre oiseau tombe sans arrêt; chaque battement le fait remonter un peu.',
      ),
      L(
        'Pass through the gap of each column. Touching a column or the ground costs a heart.',
        'Passez par l’ouverture de chaque colonne. Toucher une colonne ou le sol coûte un cœur.',
      ),
      L(
        'After a crash you reappear in the gap and blink: you’re safe for a moment.',
        'Après un choc, vous réapparaissez dans l’ouverture et clignotez : vous êtes à l’abri un instant.',
      ),
      L(
        'Tap anywhere to flap. Nothing moves until your first tap.',
        'Touchez n’importe où pour battre des ailes. Rien ne bouge avant votre première touche.',
      ),
      L('Keyboard: Space, ↑ or W to flap, P to pause.', 'Clavier : Espace, ↑ ou W pour battre des ailes, P pour la pause.'),
    ],
    tips: [
      L(
        'Short, regular taps keep you level; let yourself fall a little before a low gap.',
        'Des touches courtes et régulières vous gardent à niveau; laissez-vous tomber un peu avant une ouverture basse.',
      ),
      L(
        `${GATE_POINTS} points per gate, ${PICKUP_POINTS} per star, ${LIFE_BONUS} per heart left at the end.`,
        `${GATE_POINTS} points par porte, ${PICKUP_POINTS} par étoile, ${LIFE_BONUS} par cœur restant à la fin.`,
      ),
    ],
  }),
  stars: (d) => {
    const base = gatesFor(d) * GATE_POINTS;
    const picks = pickupsFor(d);
    const lives = livesFor(d);
    return [
      base + Math.floor(picks * 0.3) * PICKUP_POINTS + LIFE_BONUS,
      base + (picks - Math.ceil(picks / 4)) * PICKUP_POINTS + lives * LIFE_BONUS,
    ];
  },
  par: (d) => Math.round((gatesFor(d) * spacingFor(d)) / speedFor(d) + 3),
  pad: () => ({ right: [btn(' ', 'flap', L('Flap', 'Battre'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const max = s.lives;
    const arena = new Arena(ctx.root, W, H, () => draw());
    const pops: Pop[] = [];
    let flash = 0;
    let wing = 0;

    const status = () =>
      ctx.status(
        s.started
          ? [`${L('Gate', 'Porte')} ${s.passed}/${s.goal}`, P(s.pickups, ['star', 'stars'], ['étoile', 'étoiles'])].join(' · ')
          : L('Tap to fly', 'Touchez pour voler'),
      );

    function drawFlyer(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      if (s.invulnerable && Math.floor(s.invulnerable * 10) % 2) return;
      const tilt = Math.max(-0.5, Math.min(0.9, s.vy / 500));
      g.save();
      g.translate(FX, s.y);
      g.rotate(tilt);
      if (arena.sh) {
        g.fillStyle = c.drop;
        g.beginPath();
        g.arc(arena.sh * 0.6, arena.sh * 0.6, FLYER_R, 0, Math.PI * 2);
        g.fill();
      }
      arena.disc(g, 0, 0, FLYER_R, c.accent);
      // Beak, eye and a wing that beats after each flap.
      g.fillStyle = c.p[0];
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.moveTo(FLYER_R - 2, -3);
      g.lineTo(FLYER_R + 6, 1);
      g.lineTo(FLYER_R - 2, 4);
      g.closePath();
      g.fill();
      g.stroke();
      arena.disc(g, 3.5, -3.5, 3.2, c.cell);
      g.fillStyle = c.ink;
      g.beginPath();
      g.arc(4.5, -3.5, 1.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = c.cell;
      g.beginPath();
      g.ellipse(-4, 2, 6, 3.5 + Math.abs(Math.sin(wing * 18)) * 2.5 * Math.min(1, wing * 4), -0.3, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Soft hills scrolling slower than the columns, for a sense of speed.
      g.fillStyle = c.cellAlt;
      for (let i = -1; i < 5; i++) {
        const x = i * 90 - ((s.dist * 0.3) % 90);
        g.beginPath();
        g.arc(x + 45, GROUND + 12, 50 + ((i + Math.floor((s.dist * 0.3) / 90)) % 3) * 10, Math.PI, 0);
        g.fill();
      }
      for (const col of s.cols) {
        const x = col.x - s.dist;
        if (x > W + 4 || x + COL_W < -8) continue;
        const top = col.gy - s.gap / 2;
        const bottom = col.gy + s.gap / 2;
        const fill = col.x - s.dist + COL_W < FX - FLYER_R ? c.muted : c.p[2];
        arena.box(g, x, -6, COL_W, top + 6, fill, 3);
        arena.box(g, x, bottom, COL_W, GROUND - bottom + 6, fill, 3);
        // Lips around the opening.
        arena.box(g, x - 4, top - 12, COL_W + 8, 12, fill, 3, false);
        arena.box(g, x - 4, bottom, COL_W + 8, 12, fill, 3, false);
        if (col.star != null && !col.taken) {
          g.fillStyle = c.p[3];
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.7;
          glyphPath(g, STAR, x + COL_W / 2, col.star + Math.sin(s.time * 5 + col.x) * 1.5, PICKUP_R);
          g.fill();
          g.stroke();
        }
      }
      // Ground strip with moving stripes.
      arena.box(g, -4, GROUND, W + 8, H - GROUND + 4, c.cellAlt, 0, false);
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.6;
      for (let x = -((s.dist % 24) + 24); x < W + 24; x += 24) {
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(x + 12, GROUND + 2);
        g.stroke();
      }
      drawFlyer(g);
      for (const p of pops) {
        const k = p.age / 0.7;
        g.globalAlpha = Math.max(0, 1 - k);
        if (p.kind === 'hit') {
          g.strokeStyle = c.bad;
          g.lineWidth = arena.lw * 1.5;
          g.beginPath();
          g.arc(p.x, p.y, FLYER_R + k * 30, 0, Math.PI * 2);
          g.stroke();
        } else {
          g.font = FONT;
          g.textAlign = 'center';
          g.fillStyle = p.kind === 'star' ? c.fg : c.muted;
          g.fillText(`+${p.kind === 'star' ? PICKUP_POINTS : GATE_POINTS}`, p.x, p.y - k * 24);
        }
        g.globalAlpha = 1;
      }
      if (flash > 0) {
        g.fillStyle = c.bad;
        g.globalAlpha = flash * 0.5;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
      if (!s.started) {
        g.font = FONT;
        g.textAlign = 'center';
        g.fillStyle = c.fg;
        g.fillText(L('Tap to flap', 'Touchez pour voler'), W / 2, s.y - 34);
      }
    }

    const doFlap = () => {
      const first = !s.started;
      flap(s);
      sfx('jump', { vol: 0.5, pitch: (s.passed % 3) - 1 });
      wing = 0;
      if (first) status();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button > 0) return;
      doFlap();
    };
    arena.canvas.addEventListener('pointerdown', onDown);

    ctx.score(0);
    ctx.lives(s.lives, max);
    status();
    return {
      draw,
      frame(dt) {
        wing += dt;
        flash = Math.max(0, flash - dt * 3);
        for (const p of pops) p.age += dt;
        while (pops.length && pops[0].age > 0.7) pops.shift();
        const before = s.score;
        const ev = step(s, dt);
        if (ev.passed) pops.push({ x: FX, y: 40, age: 0, kind: 'gate' });
        if (ev.passed) sfx('coin', { vol: 0.7 });
        if (ev.picked) sfx('power', { vol: 0.8 });
        if (ev.picked) pops.push({ x: FX + 14, y: s.y - 12, age: 0, kind: 'star' });
        if (ev.hurt) {
          pops.push({ x: FX, y: s.y, age: 0, kind: 'hit' });
          flash = 1;
          ctx.lives(s.lives, max);
        }
        if (s.score !== before) ctx.score(s.score);
        if (ev.passed || ev.picked || ev.hurt) status();
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        if (k !== ' ' && k !== 'arrowup' && k !== 'w') return false;
        if (e.type === 'keydown' && !e.repeat) doFlap();
        return true;
      },
      destroy() {
        arena.canvas.removeEventListener('pointerdown', onDown);
        arena.destroy();
      },
    };
  },
};
