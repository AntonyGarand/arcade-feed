import './style.css';
import { L, P } from '../../core/i18n';
import { btn } from '../../core/pad';
import type { GameDef } from '../../core/types';
import { Arena, type Trace } from '../../kits/arena/arena';
import { glyphPath } from '../../kits/glyph/glyph';
import { drawBird, drawCave, drawCoin, drawDrafts } from './draw';
import { alpha, mix } from '../../kits/arena/color';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  COIN_POINTS,
  COL_W,
  COMBO_TIERS,
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
  MAGNET_R,
  MAGNET_S,
  nextColumn,
  PICKUP_POINTS,
  PICKUP_R,
  pickupsFor,
  spacingFor,
  SLOW_S,
  speedFor,
  step,
  TRAIL,
  W,
  type KindId,
  type Power,
} from './rules';

/** What each kind of flight is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  meadow: () => [L('Open sky', 'Ciel dégagé'), L('Classic columns with bonus stars.', 'Des colonnes classiques et des étoiles bonus.')],
  trails: () => [
    L('Coin trails', 'Pistes de pièces'),
    L('Coins curve between the gates: grab whole trails.', 'Des pièces serpentent entre les portes : prenez-les toutes.'),
  ],
  cave: () => [
    L('Cave', 'Caverne'),
    L('Rock walls between the gates, and the tunnel narrows.', 'Des parois de roc entre les portes; le tunnel rétrécit.'),
  ],
  sliding: () => [
    L('Sliding gates', 'Portes mobiles'),
    L('The gaps glide up and down: time your pass.', 'Les ouvertures montent et descendent : visez juste.'),
  ],
  windy: () => [
    L('Gusty', 'Bourrasques'),
    L('Updrafts lift you, downdrafts push you down.', 'Les courants d’air vous soulèvent ou vous rabattent.'),
  ],
  flock: () => [
    L('Bird flock', 'Volée d’oiseaux'),
    L('Birds bob between the columns: fly around them.', 'Des oiseaux flottent entre les colonnes : contournez-les.'),
  ],
};

const POWER_NAMES: Record<Power, () => string> = {
  shield: () => L('Shield!', 'Bouclier!'),
  magnet: () => L('Star magnet!', 'Aimant à étoiles!'),
  slow: () => L('Slow motion!', 'Ralenti!'),
  super: () => L('Shield, magnet, slow-mo!', 'Bouclier, aimant, ralenti!'),
};

/** Glyph used for bonus stars (a five-point star). */
const STAR = 4;
const star: Trace = (g, r) => glyphPath(g, STAR, 0, 0, r);

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
        'Pass through the gap of each column. Touching a column, the ground, a cave wall or a bird costs a heart.',
        'Passez par l’ouverture de chaque colonne. Toucher une colonne, le sol, une paroi ou un oiseau coûte un cœur.',
      ),
      L(
        'Each level has its twist: sliding gates, a narrowing cave, gusts (follow the arrows), coin trails or a flock of birds.',
        'Chaque niveau a sa particularité : portes mobiles, caverne qui rétrécit, bourrasques (suivez les flèches), pistes de pièces ou volée d’oiseaux.',
      ),
      L(
        'After a crash you reappear in the gap and blink: you’re safe for a moment.',
        'Après un choc, vous réapparaissez dans l’ouverture et clignotez : vous êtes à l’abri un instant.',
      ),
      L(
        'Tap anywhere to flap (keyboard: Space, ↑ or W; P to pause). Nothing moves until your first flap.',
        'Touchez n’importe où pour battre des ailes (clavier : Espace, ↑ ou W; P pour la pause). Rien ne bouge avant le premier battement.',
      ),
    ],
    tips: [
      L(
        'Short, regular taps keep you level; let yourself fall a little before a low gap.',
        'Des touches courtes et régulières vous gardent à niveau; laissez-vous tomber un peu avant une ouverture basse.',
      ),
      L(
        `Fly clean to build a combo: each gate, star and coin trail in a row (a gate right through the middle counts double). At ${COMBO_TIERS[0]} you get a shield, at ${COMBO_TIERS[1]} a star magnet, at ${COMBO_TIERS[2]} slow motion, at ${COMBO_TIERS[3]} all three. A crash resets it.`,
        `Volez sans faute pour bâtir un combo : chaque porte, étoile et piste de pièces d’affilée (une porte franchie en plein centre compte double). À ${COMBO_TIERS[0]}, vous gagnez un bouclier, à ${COMBO_TIERS[1]} un aimant à étoiles, à ${COMBO_TIERS[2]} le ralenti, à ${COMBO_TIERS[3]} les trois. Un choc le remet à zéro.`,
      ),
      L(
        `${GATE_POINTS} points per gate, ${PICKUP_POINTS} per star, ${COIN_POINTS} per coin, ${LIFE_BONUS} per heart left at the end.`,
        `${GATE_POINTS} points par porte, ${PICKUP_POINTS} par étoile, ${COIN_POINTS} par pièce, ${LIFE_BONUS} par cœur restant à la fin.`,
      ),
    ],
  }),
  stars: (d) => {
    const base = gatesFor(d) * GATE_POINTS;
    const picks = pickupsFor(d);
    const lives = livesFor(d);
    return [
      base + Math.floor(picks * 0.3) * PICKUP_POINTS + LIFE_BONUS,
      base + (picks - Math.ceil(picks / 5)) * PICKUP_POINTS + lives * LIFE_BONUS,
    ];
  },
  par: (d) => Math.round((gatesFor(d) * spacingFor(d)) / speedFor(d) + 3),
  pad: () => ({ right: [btn(' ', 'flap', L('Flap', 'Battre'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const max = s.lives;
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    /** Seconds since the last flap (drives the wing beat). */
    let wing = 1;
    /** Seconds since the flyer reappeared after a crash (a grow-in ring). */
    let respawn = 9;
    /** The run ended: won (flyer cheers) or lost (flyer tumbles down). */
    let ended: 'won' | 'lost' | null = null;
    let fallY = 0;
    let fallV = 0;
    let spin = 0;
    /** Arena time at the last draw, to animate the tumble while the arena lingers. */
    let drawnAt = 0;
    const last = s.cols[s.cols.length - 1];

    const status = () =>
      ctx.status(
        s.started
          ? [
              `${L('Gate', 'Porte')} ${s.passed}/${s.goal}`,
              s.kind === 'trails' ? P(s.coins, ['coin', 'coins'], ['pièce', 'pièces']) : P(s.got, ['star', 'stars'], ['étoile', 'étoiles']),
              s.combo >= 2 ? `combo ×${s.combo}` : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : L('Tap to fly', 'Touchez pour voler'),
      );

    function drawFlyer(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      if (!ended && s.invulnerable && Math.floor(s.invulnerable * 10) % 2) g.globalAlpha = 0.35;
      const y = ended === 'lost' ? fallY : s.y;
      const tilt = ended === 'lost' ? spin : Math.max(-0.5, Math.min(0.9, s.vy / 500));
      // Squash and stretch: tall right after a flap, stretched along a fast fall.
      const pump = Math.max(0, 1 - wing * 6);
      const sy = 1 + pump * 0.12;
      const sx = 1 - pump * 0.08;
      g.save();
      g.translate(FX, y);
      g.rotate(tilt);
      g.scale(sx, sy);
      arena.ball(g, 0, 0, FLYER_R, c.accent);
      // Beak, eye and a wing that beats after each flap.
      g.fillStyle = c.p[0];
      g.strokeStyle = arena.tone(c.p[0]).edge;
      g.lineWidth = arena.lw * 0.6;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(FLYER_R - 2, -3.5);
      g.lineTo(FLYER_R + 7, 0.5);
      g.lineTo(FLYER_R - 2, 4.5);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = c.paper;
      g.strokeStyle = c.coal;
      g.lineWidth = arena.lw * 0.5;
      g.beginPath();
      g.arc(3.5, -3.5, 3.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.strokeStyle = c.coal;
      g.fillStyle = c.coal;
      if (ended === 'lost') {
        // Dazed: crossed eyes.
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(2, -5);
        g.lineTo(5, -2);
        g.moveTo(5, -5);
        g.lineTo(2, -2);
        g.stroke();
      } else if (ended === 'won') {
        // Happy: a closed, smiling eye.
        g.lineWidth = 1.3;
        g.beginPath();
        g.arc(3.5, -2.8, 1.8, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      } else {
        g.beginPath();
        g.arc(4.6, -3.4 + Math.max(-0.8, Math.min(1, s.vy / 300)), 1.6, 0, Math.PI * 2);
        g.fill();
      }
      // Wing: flaps hard after a tap, then settles into a slow glide beat.
      const beat = wing < 0.25 ? Math.sin(wing * 40) : Math.sin(arena.time * 8) * 0.3;
      const wt = arena.tone(c.accent);
      g.fillStyle = wt.hi;
      g.strokeStyle = wt.edge;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.ellipse(-4, 1 - beat * 3, 6.5, 3 + Math.abs(beat) * 2.5, -0.35 - beat * 0.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
      if (!ended && s.shield) {
        // Shield: a wobbling bubble around the flyer.
        const r = FLYER_R + 7 + Math.sin(arena.time * 6) * 1.2;
        const sh = arena.tone(c.p[4]);
        g.fillStyle = alpha(c.p[4], 0.16);
        g.strokeStyle = sh.edge;
        g.lineWidth = arena.lw;
        g.beginPath();
        g.arc(FX, y, r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.strokeStyle = sh.hi;
        g.beginPath();
        g.arc(FX, y, r - 3, Math.PI * 1.1, Math.PI * 1.45);
        g.stroke();
      }
      if (!ended && s.magnet > 0) {
        // Magnet: a dashed ring of the pull radius, turning.
        g.save();
        g.strokeStyle = alpha(c.p[3], 0.25 + 0.35 * Math.min(1, s.magnet / 1.5));
        g.lineWidth = arena.lw * 0.8;
        g.setLineDash([5, 6]);
        g.lineDashOffset = -arena.time * 30;
        g.beginPath();
        g.arc(FX, y, MAGNET_R, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
      if (respawn < 0.45) {
        const k = respawn / 0.45;
        g.globalAlpha = 1 - k;
        g.strokeStyle = c.accent;
        g.lineWidth = arena.lw;
        g.beginPath();
        g.arc(FX, s.y, FLYER_R + 22 * (1 - k), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    /** One column: two bevelled pipes with lips; the finish column is checkered. */
    function drawColumn(g: CanvasRenderingContext2D, x: number, top: number, bottom: number, fill: string, finish: boolean) {
      const c = arena.colors;
      arena.block(g, x, -8, COL_W, top + 8, fill, 3);
      arena.block(g, x, bottom, COL_W, GROUND - bottom + 8, fill, 3);
      // A vertical shine down each pipe.
      g.fillStyle = arena.tone(fill).hi;
      g.globalAlpha = 0.45;
      g.fillRect(x + 7, -8, 5, top - 4);
      g.fillRect(x + 7, bottom + 14, 5, GROUND - bottom - 14);
      g.globalAlpha = 1;
      arena.block(g, x - 5, top - 13, COL_W + 10, 13, fill, 3);
      arena.block(g, x - 5, bottom, COL_W + 10, 13, fill, 3);
      if (finish) {
        // Checkered lips mark the last gate.
        for (const ly of [top - 13, bottom]) {
          g.save();
          g.beginPath();
          g.rect(x - 4, ly + 1, COL_W + 8, 11);
          g.clip();
          g.fillStyle = c.coal;
          for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) g.fillRect(x - 4 + i * 5, ly + 1 + j * 5.5, 5, 5.5);
          g.restore();
        }
      }
    }

    /** Powers running (a labelled bar each, top left) and the combo count (top right). */
    function drawPowers(g: CanvasRenderingContext2D) {
      if (ended) return;
      const c = arena.colors;
      const bars: [string, number, string][] = [];
      if (s.shield) bars.push([L('Shield', 'Bouclier'), 1, c.p[4]]);
      if (s.magnet > 0) bars.push([L('Magnet', 'Aimant'), s.magnet / MAGNET_S, c.p[3]]);
      if (s.slow > 0) bars.push([L('Slow-mo', 'Ralenti'), s.slow / SLOW_S, c.p[6]]);
      g.font = `800 9px ${arena.family}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      bars.forEach(([label, k, col], i) => {
        const y = 24 + i * 13;
        g.fillStyle = alpha(c.muted, 0.35);
        g.fillRect(8, y - 3, 46, 6);
        g.fillStyle = col;
        g.fillRect(8, y - 3, 46 * k, 6);
        g.lineWidth = 3;
        g.strokeStyle = c.cell;
        g.strokeText(label, 58, y);
        g.fillStyle = c.fg;
        g.fillText(label, 58, y);
      });
      if (s.combo >= 2) {
        const str = `×${s.combo}`;
        g.textAlign = 'right';
        g.font = `900 ${Math.round(Math.min(18, 11 + s.combo * 0.25))}px ${arena.family}`;
        g.lineWidth = 4;
        g.strokeStyle = c.cell;
        g.strokeText(str, W - 8, 26);
        g.fillStyle = s.tier ? c.accent : c.fg;
        g.fillText(str, W - 8, 26);
      }
      g.textBaseline = 'alphabetic';
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const ddt = Math.min(0.05, arena.time - drawnAt);
      drawnAt = arena.time;
      if (ended === 'lost' && ddt > 0) {
        fallV += 900 * ddt;
        fallY = Math.min(GROUND - FLYER_R, fallY + fallV * ddt);
        if (fallY < GROUND - FLYER_R) spin += 7 * ddt;
      }
      const far = s.dist * 0.15;
      const near = s.dist * 0.35;
      // Clouds, then two layers of hills, each scrolling slower than the columns for depth.
      g.fillStyle = alpha(c.fg, arena.dark ? 0.06 : 0.07);
      g.beginPath();
      for (let i = -1; i < 4; i++) {
        const n = i + Math.floor(far / 120);
        const x = i * 120 - (far % 120) + 30;
        const y = 50 + ((((n * 53) % 5) + 5) % 5) * 22;
        g.moveTo(x + 26, y);
        g.ellipse(x, y, 26, 9, 0, 0, Math.PI * 2);
        g.moveTo(x + 32, y - 6);
        g.ellipse(x + 16, y - 6, 16, 10, 0, 0, Math.PI * 2);
        g.moveTo(x - 2, y - 3);
        g.ellipse(x - 14, y - 3, 12, 7, 0, 0, Math.PI * 2);
      }
      g.fill();
      // Each layer is one path, so overlapping hills read as one ridge.
      g.fillStyle = mix(c.cell, c.good, arena.dark ? 0.08 : 0.12);
      g.beginPath();
      for (let i = -1; i < 5; i++) {
        const n = i + Math.floor(far / 110);
        const x = i * 110 - (far % 110) + 55;
        g.moveTo(x, GROUND + 30);
        g.arc(x, GROUND + 30, 70 + (((n % 3) + 3) % 3) * 14, Math.PI, 0);
      }
      g.fill();
      g.fillStyle = mix(c.cell, c.good, arena.dark ? 0.16 : 0.22);
      g.beginPath();
      for (let i = -1; i < 5; i++) {
        const n = i + Math.floor(near / 90);
        const x = i * 90 - (near % 90) + 45;
        g.moveTo(x, GROUND + 12);
        g.arc(x, GROUND + 12, 44 + (((n % 3) + 3) % 3) * 10, Math.PI, 0);
      }
      g.fill();
      drawDrafts(g, arena, s);
      const rock = mix(c.muted, c.cellAlt, 0.45);
      drawCave(g, arena, s, rock);
      const pipe = s.cave ? rock : c.p[2];
      const next = nextColumn(s);
      for (const col of s.cols) {
        const x = col.x - s.dist;
        if (x > W + 8 || x + COL_W < -10) continue;
        const top = col.gy - col.gap / 2;
        const bottom = col.gy + col.gap / 2;
        if (col === next && s.started && !ended && x > FX + FLYER_R) {
          // Chevrons in the gate to aim for, pulsing gently.
          g.strokeStyle = arena.dark ? c.accent : mix(c.accent, c.ink, 0.4);
          g.lineWidth = arena.lw;
          g.lineCap = 'round';
          g.lineJoin = 'round';
          for (let i = 0; i < 2; i++) {
            const cx = x + COL_W / 2 - 4 + i * 9;
            g.globalAlpha = 0.25 + 0.35 * Math.max(0, Math.sin(arena.time * 6 - i * 1.2));
            g.beginPath();
            g.moveTo(cx - 3, col.gy - 6);
            g.lineTo(cx + 3, col.gy);
            g.lineTo(cx - 3, col.gy + 6);
            g.stroke();
          }
          g.globalAlpha = 1;
          g.lineCap = 'butt';
        }
        const done = x + COL_W < FX - FLYER_R;
        drawColumn(g, x, top, bottom, done ? mix(pipe, c.cellAlt, 0.6) : pipe, col === last);
        if (col.amp && !done) {
          // Sliding gate: little arrows on the lips, pointing the way it's heading.
          const dir = Math.cos(s.flight * 1.5 + col.phase) >= 0 ? 1 : -1;
          g.fillStyle = arena.tone(pipe).edge;
          for (const ly of [top - 6.5, bottom + 6.5]) {
            g.beginPath();
            g.moveTo(x + COL_W / 2 - 5, ly - dir * 2.5);
            g.lineTo(x + COL_W / 2 + 5, ly - dir * 2.5);
            g.lineTo(x + COL_W / 2, ly + dir * 3);
            g.closePath();
            g.fill();
          }
        }
      }
      for (const p of s.pickups) {
        const x = p.x - s.dist;
        if (p.taken || x > W + 12 || x < -12) continue;
        if (p.coin) drawCoin(g, arena, x, p.y);
        else {
          const tw = Math.sin(arena.time * 5 + p.x);
          arena.gem(g, x, p.y + tw * 2, PICKUP_R + 1, c.p[3], star, true, 1 + 0.06 * tw, tw * 0.2);
        }
      }
      for (const b of s.birds) {
        const x = b.x - s.dist;
        if (!b.gone && x < W + 20 && x > -20) drawBird(g, arena, x, b.y, b.phase * 10);
      }
      // Ground: grass edge over a strip with moving stripes.
      arena.box(g, -4, GROUND, W + 8, H - GROUND + 4, c.cellAlt, 0, false);
      g.save();
      g.beginPath();
      g.rect(0, GROUND + 6, W, H - GROUND);
      g.clip();
      g.strokeStyle = alpha(c.muted, 0.6);
      g.lineWidth = 3;
      for (let x = -((s.dist % 24) + 24); x < W + 24; x += 24) {
        g.beginPath();
        g.moveTo(x, H + 2);
        g.lineTo(x + 14, GROUND + 4);
        g.stroke();
      }
      g.restore();
      arena.block(g, -4, GROUND, W + 8, 7, c.good, 0, false, 0.6);
      if (s.slow > 0 && !ended) {
        // Slow motion: a cool tint that fades out as it ends.
        g.fillStyle = alpha(c.p[6], 0.1 * Math.min(1, s.slow / 0.6));
        g.fillRect(0, 0, W, H);
      }
      drawFlyer(g);
      drawPowers(g);
      // Progress along the top: one pip per gate.
      const pipW = Math.min(14, (W - 40) / s.goal - 2);
      const x0 = W / 2 - (s.goal * (pipW + 2) - 2) / 2;
      for (let i = 0; i < s.goal; i++) {
        g.fillStyle = i < s.passed ? c.accent : alpha(c.muted, 0.45);
        g.beginPath();
        g.roundRect(x0 + i * (pipW + 2), 8, pipW, 4, 2);
        g.fill();
      }
      if (!s.started) {
        // Idle: a bobbing hint above the flyer.
        g.font = `800 15px ${arena.family}`;
        g.textAlign = 'center';
        g.lineJoin = 'round';
        g.lineWidth = 4;
        g.strokeStyle = c.cell;
        const ty = s.y - 34 + Math.sin(arena.time * 4) * 2;
        g.strokeText(L('Tap to flap', 'Touchez pour voler'), FX + 40, ty);
        g.fillStyle = c.fg;
        g.fillText(L('Tap to flap', 'Touchez pour voler'), FX + 40, ty);
      }
      arena.overlay(g);
    }

    const doFlap = () => {
      if (ended) return;
      const first = !s.started;
      flap(s);
      sfx('jump', { vol: 0.5, pitch: (s.passed % 3) - 1 });
      wing = 0;
      // A puff of air under the wing.
      fx.burst(FX - 6, s.y + 6, alpha(arena.colors.fg, 0.5), 4, 50, 3, 0.3, 'dot', 0, Math.PI * 0.65, 0.9);
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
        respawn += dt;
        arena.update(dt);
        const c = arena.colors;
        const y0 = s.y;
        const before = s.score;
        const combo = s.combo;
        const ev = step(s, dt);
        if (ev.passed) {
          sfx('coin', { vol: 0.7, step: 1 + (s.passed % 7) });
          fx.ring(FX, s.y, ev.perfect ? c.good : c.accent, FLYER_R, FLYER_R + (ev.perfect ? 24 : 16), 0.3, arena.lw * 0.8);
          if (s.passed === s.goal - 1) fx.text(W / 2, 40, L('Last gate!', 'Dernière porte!'), c.accent, 15, 1.2);
          fx.text(
            FX,
            s.y - 30,
            ev.perfect ? L('Perfect!', 'Parfait!') : `+${GATE_POINTS}`,
            ev.perfect ? c.good : c.fg,
            ev.perfect ? 13 : 12,
          );
        }
        if (ev.coins) {
          sfx('coin', { vol: 0.5, step: 3 + (s.coins % TRAIL) * 2 });
          fx.burst(FX + 6, s.y, c.p[3], 5, 80, 2.5, 0.35, 'spark', 0);
          if (!ev.picked) fx.text(FX + 16, s.y - 14, `+${COIN_POINTS}`, c.p[3], 11, 0.5);
        }
        if (ev.picked) {
          sfx('power', { vol: 0.8 });
          fx.burst(FX + 8, s.y, c.p[3], 12, 120, 3.5, 0.5, 'spark', 0);
          fx.ring(FX + 8, s.y, c.p[3], 4, 26, 0.3, arena.lw);
          fx.text(FX + 18, s.y - 18, ev.coins ? L('Trail!', 'Piste!') : `+${PICKUP_POINTS}`, c.p[3], 15);
        }
        if (s.combo > combo && !ev.tier) comboPop(fx, FX + 34, s.y - 8, s.combo, c.accent);
        if (ev.tier && ev.unlocked) {
          comboTier(fx, ev.tier, c.accent, POWER_NAMES[ev.unlocked]());
          const p = ev.unlocked;
          if (p === 'shield' || p === 'super') fx.ring(FX, s.y, c.p[4], FLYER_R, FLYER_R + 30, 0.45, arena.lw * 1.4);
          if (p === 'magnet' || p === 'super') fx.ring(FX, s.y, c.p[3], MAGNET_R, FLYER_R, 0.5, arena.lw);
          if (p === 'slow' || p === 'super') fx.burst(FX, s.y, c.p[6], 14, 110, 3, 0.6, 'dot', 0);
        }
        if (ev.shielded) {
          sfx('hit');
          haptic(25);
          fx.ring(FX, s.y, c.p[4], FLYER_R + 6, FLYER_R + 34, 0.4, arena.lw * 1.4);
          fx.burst(FX, s.y, arena.tone(c.p[4]).hi, 14, 140, 3, 0.5, 'dot', 0);
          fx.text(FX, s.y - 28, L('Shield saved you!', 'Sauvé par le bouclier!'), c.p[4], 12, 0.9);
          fx.shake(3, 0.2);
        }
        if (ev.bird) fx.burst(ev.bird.x, ev.bird.y, c.bad, 14, 150, 3.5, 0.6, 'square', 200);
        if (ev.broke >= 5) fx.text(W - 30, 44, L('Combo lost', 'Combo perdu'), c.muted, 11, 0.9);
        if (ev.hurt) {
          ctx.lives(s.lives, max);
          fx.shake(5, 0.35);
          fx.flash(c.bad, 0.3, 0.35);
          fx.burst(FX, y0, c.accent, 12, 140, 3.5, 0.6, 'square', 300);
          fx.burst(FX, y0, arena.tone(c.accent).hi, 6, 90, 2.5, 0.5, 'dot', 120);
          fx.ring(FX, y0, c.bad, FLYER_R, FLYER_R + 26, 0.4, arena.lw * 1.4);
          if (!ev.over) respawn = 0;
        }
        if (s.score !== before) ctx.score(s.score);
        if (ev.passed || ev.picked || ev.coins || ev.hurt || ev.shielded) status();
        if (ev.over) {
          ended = 'lost';
          fallY = y0;
          fallV = -180;
          arena.linger(1.4);
        } else if (ev.won) {
          ended = 'won';
          for (let i = 0; i < 5; i++) fx.burst(FX, s.y, c.p[i], 10, 190, 4, 0.9, 'square', 220);
          fx.ring(FX, s.y, c.accent, 8, 90, 0.6, arena.lw * 1.5);
          fx.flash(c.good, 0.25, 0.5);
          arena.linger();
        }
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
