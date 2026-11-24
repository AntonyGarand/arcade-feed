import './style.css';
import { L, P } from '../../core/i18n';
import { btn, leftRight } from '../../core/pad';
import type { GameDef } from '../../core/types';
import { Arena, type Trace } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { gestures } from '../../kits/gesture/gesture';
import { sfx } from '../../kits/sound/sound';
import { glyphPath } from '../../kits/glyph/glyph';
import {
  aliveCount,
  BLOCK,
  CANNON_HW,
  CANNON_Y,
  createLevel,
  CRITTER_R,
  critterAt,
  formationPoints,
  H,
  LAND_Y,
  LIFE_BONUS,
  LIVES,
  parFor,
  shieldCell,
  SHIELD_COLS,
  SHIELD_Y,
  SHOT_HL,
  SHOT_HW,
  step,
  TIME_POINTS,
  W,
} from './rules';

export const formation: GameDef = {
  id: 'formation',
  get name() {
    return L('Formation', 'Formation');
  },
  get rules() {
    return L('Clear the marching formation before it lands.', 'Éliminez la formation en marche avant qu’elle atterrisse.');
  },
  category: 'reflex',
  help: () => ({
    goal: L(
      'Shoot every critter of the formation before it reaches the ground or hits you three times.',
      'Abattez chaque bestiole de la formation avant qu’elle touche le sol ou vous atteigne trois fois.',
    ),
    steps: [
      L(
        'The formation marches side to side and steps down at each edge. It speeds up as it thins out.',
        'La formation va de gauche à droite et descend d’un cran à chaque bord. Elle accélère en rétrécissant.',
      ),
      L(
        'Critters fire back. A hit costs a heart; the bunkers block shots from both sides until they crumble.',
        'Les bestioles ripostent. Un coup coûte un cœur; les abris bloquent les tirs des deux côtés jusqu’à s’effriter.',
      ),
      L(
        'Only a shot or two of yours can fly at once: make them count. Your shot cancels one of theirs.',
        'Seulement un ou deux de vos tirs volent à la fois : visez bien. Votre tir annule un des leurs.',
      ),
      L(
        'Touch and drag anywhere to slide the cannon; it fires while your finger is down.',
        'Touchez et glissez n’importe où pour déplacer le canon; il tire tant que votre doigt est posé.',
      ),
      L(
        'Keyboard: ← → or A D to move, Space to fire (hold it to keep firing), P to pause.',
        'Clavier : ← → ou A D pour bouger, Espace pour tirer (maintenez pour continuer), P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Top rows are worth more. Each heart left adds ${LIFE_BONUS}, each second under par ${TIME_POINTS}.`,
        `Les rangées du haut valent plus. Chaque cœur restant ajoute ${LIFE_BONUS}, chaque seconde sous la normale ${TIME_POINTS}.`,
      ),
      L(
        'Clear the end columns first: the formation then marches farther before it steps down.',
        'Videz d’abord les colonnes du bout : la formation marche alors plus loin avant de descendre.',
      ),
    ],
  }),
  stars: (d) => {
    // Two: lose up to two hearts at a fair pace. Three: fast and without a scratch (one heart at Expert+).
    const base = formationPoints(d);
    const par = parFor(d);
    return [
      base + LIFE_BONUS + Math.round(par * 0.2) * TIME_POINTS,
      base + (d >= 4 ? 2 : 3) * LIFE_BONUS + Math.round(par * 0.5) * TIME_POINTS,
    ];
  },
  par: (d) => parFor(d),
  pad: () => ({ left: leftRight(), right: [btn(' ', 'fire', L('Fire', 'Tirer'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    let offset = 0;
    /** Cannon recoil after a shot, 1 → 0. */
    let recoil = 0;
    /** Marches so far (for the four-note marching beat). */
    let beat = 0;
    /** How the run ended: the formation landed, the cannon fell, or it was cleared. */
    let ended: 'landed' | 'shot' | 'won' | null = null;
    /** Shield cells standing at the last frame, to chip the ones that just broke. */
    let standing = s.shields.map((sh) => sh.cells.slice());
    /** Critter trace for the gem helper. */
    const traces = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (k): Trace =>
        (g, r) =>
          glyphPath(g, k, 0, 0, r),
    );

    const status = () => ctx.status(P(aliveCount(s), ['critter left', 'critters left'], ['bestiole restante', 'bestioles restantes']));

    /** A critter: its glyph as a faceted body, antennae and legs that swap with each march tick, two eyes. */
    function critter(g: CanvasRenderingContext2D, x: number, y0: number, k: number) {
      const c = arena.colors;
      const fill = c.p[k];
      const t = arena.tone(fill);
      const hop = s.pose ? -1 : 0;
      const y = y0 + hop;
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.75;
      g.lineCap = 'round';
      const spread = s.pose ? 8 : 4.5;
      g.beginPath();
      for (const side of [-1, 1]) {
        g.moveTo(x + side * 4, y + 4);
        g.lineTo(x + side * spread, y + CRITTER_R + 2 - hop);
        g.moveTo(x + side * 5, y - 5);
        g.lineTo(x + side * (s.pose ? 9 : 11), y - CRITTER_R - 1);
      }
      g.stroke();
      g.fillStyle = t.hi;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.arc(x + side * (s.pose ? 9 : 11), y - CRITTER_R - 1, 1.6, 0, Math.PI * 2);
        g.fill();
      }
      g.lineCap = 'butt';
      arena.gem(g, x, y, CRITTER_R, fill, traces[k]);
      // Eyes follow the cannon.
      const look = Math.max(-1, Math.min(1, (s.px - x) / 60));
      for (const side of [-1, 1]) {
        g.fillStyle = c.paper;
        g.strokeStyle = c.coal;
        g.lineWidth = arena.lw * 0.4;
        g.beginPath();
        g.arc(x + side * 3.3, y - 0.5, 2.6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = c.coal;
        g.beginPath();
        g.arc(x + side * 3.3 + look * 1.1, y + 0.2, 1.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    function drawShields(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const t = arena.tone(c.good);
      for (const sh of s.shields) {
        const on = (i: number) => i >= 0 && i < sh.cells.length && sh.cells[i];
        sh.cells.forEach((v, i) => {
          if (!v) return;
          const p = shieldCell(sh, i);
          const col = i % SHIELD_COLS;
          // Lit top on exposed cells, shaded base: reads as one solid bunker that crumbles.
          g.fillStyle = !on(i - SHIELD_COLS) ? t.hi : !on(i + SHIELD_COLS) ? t.lo : t.base;
          g.fillRect(p.x, p.y, BLOCK + 0.2, BLOCK + 0.2);
          g.strokeStyle = t.edge;
          g.lineWidth = arena.lw * 0.6;
          g.beginPath();
          if (!on(i - SHIELD_COLS)) {
            g.moveTo(p.x, p.y);
            g.lineTo(p.x + BLOCK, p.y);
          }
          if (!on(i + SHIELD_COLS)) {
            g.moveTo(p.x, p.y + BLOCK);
            g.lineTo(p.x + BLOCK, p.y + BLOCK);
          }
          if (col === 0 || !on(i - 1)) {
            g.moveTo(p.x, p.y);
            g.lineTo(p.x, p.y + BLOCK);
          }
          if (col === SHIELD_COLS - 1 || !on(i + 1)) {
            g.moveTo(p.x + BLOCK, p.y);
            g.lineTo(p.x + BLOCK, p.y + BLOCK);
          }
          g.stroke();
        });
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 25, 0, false);
      // The landing line warms up as the formation gets close to it.
      const live = s.critters.filter((k) => k.alive);
      const low = live.length ? Math.max(...live.map((k) => critterAt(s, k).y)) + CRITTER_R : 0;
      const near = Math.max(0, Math.min(1, 1 - (LAND_Y - low) / 90));
      g.strokeStyle = near > 0 ? mix(c.muted, c.bad, near) : c.muted;
      g.globalAlpha = 0.6 + 0.4 * near * (0.6 + 0.4 * Math.sin(arena.time * 10));
      g.lineWidth = arena.lw * (0.5 + near * 0.5);
      g.setLineDash([4, 6]);
      g.beginPath();
      g.moveTo(0, LAND_Y);
      g.lineTo(W, LAND_Y);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      arena.block(g, -4, CANNON_Y + 12, W + 8, H - CANNON_Y, c.cellAlt, 0, false, 0);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, CANNON_Y + 12);
      g.lineTo(W, CANNON_Y + 12);
      g.stroke();

      drawShields(g);

      for (const k of live) {
        const p = critterAt(s, k);
        critter(g, p.x, p.y, k.k);
      }

      // Your shots: a bright slug with a short fading tail.
      const at = arena.tone(c.accent);
      for (const b of s.shots) {
        g.fillStyle = at.glow;
        g.beginPath();
        g.roundRect(b.x - SHOT_HW * 2, b.y - SHOT_HL, SHOT_HW * 4, SHOT_HL * 3.4, SHOT_HW * 2);
        g.fill();
        arena.box(g, b.x - SHOT_HW - 0.5, b.y - SHOT_HL, SHOT_HW * 2 + 1, SHOT_HL * 2, c.accent, 1.5, false);
      }
      // Enemy shots: a zigzag bolt over a soft glow.
      const bt = arena.tone(c.bad);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const m of s.bombs) {
        g.fillStyle = bt.glow;
        g.beginPath();
        g.ellipse(m.x, m.y, 5, SHOT_HL + 3, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = c.bad;
        g.lineWidth = 2.6;
        g.beginPath();
        for (let i = 0; i <= 4; i++) {
          const x = m.x + (i % 2 ? 2.5 : -2.5) * (Math.floor(m.y / 6) % 2 ? 1 : -1);
          const y = m.y - SHOT_HL + i * ((SHOT_HL * 2) / 4);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }
      g.lineCap = 'butt';

      // The cannon (blinking while safe after a hit; gone once shot down).
      if (ended !== 'shot' && (s.safe <= 0 || Math.floor(s.safe * 10) % 2 === 0)) {
        const kick = recoil * recoil * 3;
        arena.block(g, s.px - 3.5, CANNON_Y - 12 + kick, 7, 12, c.accent, 2);
        arena.block(g, s.px - CANNON_HW, CANNON_Y - 3, CANNON_HW * 2, 13, c.accent, 4);
        g.fillStyle = arena.tone(c.accent).edge;
        g.beginPath();
        g.arc(s.px, CANNON_Y + 3, 2, 0, Math.PI * 2);
        g.fill();
      }
      arena.overlay(g);
    }

    const release = () => {
      s.fire = false;
      s.target = null;
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 4,
      onDown(p) {
        if (ended) return;
        offset = s.px - p.x;
        s.target = s.px;
        s.fire = true;
      },
      onMove(p, from) {
        if (from && !ended) s.target = p.x + offset;
      },
      onTap: () => release(),
      onRelease: () => release(),
    });

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const c = arena.colors;
        const pose = s.pose;
        const bombs = s.bombs.slice();
        const ev = step(s, dt);
        arena.update(dt);
        recoil = Math.max(0, recoil - dt * 6);
        if (ev.fired) {
          sfx('shoot', { vol: 0.4 });
          recoil = 1;
          fx.burst(s.px, CANNON_Y - 13, arena.tone(c.accent).hi, 4, 70, 2, 0.2, 'spark', 0, -Math.PI / 2, 0.9);
        }
        if (pose !== s.pose) {
          // The march: a low four-note beat that quickens with the formation.
          sfx('tick', { vol: 0.28, pitch: [-12, -14, -16, -14][beat++ % 4] });
        }
        for (const p of ev.pops) {
          if (p.k < 0) {
            fx.burst(p.x, p.y, c.accent, 14, 150, 3.5, 0.6, 'square', 280, -Math.PI / 2, Math.PI * 1.2);
            fx.burst(p.x, p.y, c.bad, 8, 110, 3, 0.5, 'spark', 0);
            fx.ring(p.x, p.y, c.bad, 6, 40, 0.4, arena.lw * 1.4);
            continue;
          }
          const fill = c.p[p.k];
          sfx('pop', { pitch: p.k % 5 });
          fx.burst(p.x, p.y, fill, 14, 130, 3.5, 0.55, 'square', 120);
          fx.burst(p.x, p.y, arena.tone(fill).hi, 6, 90, 2.5, 0.4, 'dot', 0);
          fx.ring(p.x, p.y, fill, 4, CRITTER_R * 2.4, 0.3, arena.lw);
          fx.text(p.x, p.y - 6, `+${p.pts}`, p.pts >= 30 ? c.accent : c.fg, p.pts >= 30 ? 13 : 11);
        }
        // Shots that vanished mid-air were cancelled by yours: a spark where they met.
        for (const m of bombs)
          if (!s.bombs.includes(m) && m.y < SHIELD_Y - 4 && !ev.hurt) {
            fx.burst(m.x, m.y, c.paper, 6, 80, 2, 0.3, 'spark', 0);
            fx.ring(m.x, m.y, c.accent, 2, 12, 0.25, arena.lw * 0.8);
            sfx('hit', { vol: 0.5, pitch: 5 });
          }
        // Chips off the bunkers.
        s.shields.forEach((sh, n) =>
          sh.cells.forEach((on, i) => {
            if (on || !standing[n][i]) return;
            const p = shieldCell(sh, i);
            fx.burst(p.x + BLOCK / 2, p.y + BLOCK / 2, c.good, 3, 60, 2.2, 0.35, 'square', 200);
          }),
        );
        standing = s.shields.map((sh) => sh.cells.slice());
        if (ev.hurt) {
          ctx.lives(s.lives, LIVES);
          fx.shake(5, 0.35);
          fx.flash(c.bad, 0.3, 0.35);
        }
        if (ev.hit || ev.cleared) {
          ctx.score(s.score);
          status();
        }
        if (ev.cleared) {
          ended = 'won';
          for (let i = 0; i < 5; i++) fx.burst(s.px, CANNON_Y - 20, c.p[i], 10, 190, 4, 0.9, 'square', 220, -Math.PI / 2, Math.PI);
          fx.ring(s.px, CANNON_Y, c.accent, 8, 90, 0.6, arena.lw * 1.5);
          fx.flash(c.good, 0.25, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = s.lives <= 0 ? 'shot' : 'landed';
          if (ended === 'landed') {
            fx.shake(6, 0.45);
            fx.flash(c.bad, 0.35, 0.5);
            fx.burst(s.px, CANNON_Y, c.accent, 14, 150, 3.5, 0.6, 'square', 280, -Math.PI / 2, Math.PI * 1.2);
          }
          s.fire = false;
          arena.linger(1.4);
        }
        draw();
        if (ev.cleared) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const down = e.type === 'keydown';
        const dir = k === 'arrowleft' || k === 'a' ? -1 : k === 'arrowright' || k === 'd' ? 1 : 0;
        if (dir) {
          s.target = null;
          if (down) s.kdir = dir;
          else if (s.kdir === dir) s.kdir = 0;
          return true;
        }
        if (k === ' ' || k === 'enter' || k === 'arrowup' || k === 'w') {
          s.fire = down;
          return true;
        }
        return false;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
