import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures } from '../../kits/gesture/gesture';
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
  SHOT_HL,
  SHOT_HW,
  step,
  TIME_POINTS,
  W,
} from './rules';

/** A spark from a popped critter (k = palette index, −1 for the cannon). */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  k: number;
}

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
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const sparks: Spark[] = [];
    let flash = 0;
    let offset = 0;

    const status = () => ctx.status(P(aliveCount(s), ['critter left', 'critters left'], ['bestiole restante', 'bestioles restantes']));

    /** A critter: its glyph as the body, two eyes, and legs that swap with each march tick. */
    function critter(g: CanvasRenderingContext2D, x: number, y: number, k: number) {
      const c = arena.colors;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.7;
      g.lineCap = 'round';
      const spread = s.pose ? 7 : 4;
      g.beginPath();
      for (const side of [-1, 1]) {
        g.moveTo(x + side * 4, y + 4);
        g.lineTo(x + side * spread, y + CRITTER_R + 1);
        g.moveTo(x + side * 6, y - 4);
        g.lineTo(x + side * (s.pose ? 9 : 11), y - CRITTER_R);
      }
      g.stroke();
      g.lineCap = 'butt';
      if (arena.sh) {
        g.fillStyle = c.drop;
        glyphPath(g, k, x + arena.sh * 0.5, y + arena.sh * 0.5, CRITTER_R - 1);
        g.fill();
      }
      g.fillStyle = c.p[k];
      g.lineWidth = arena.lw * 0.8;
      glyphPath(g, k, x, y, CRITTER_R - 1);
      g.fill();
      g.stroke();
      for (const side of [-1, 1]) {
        g.fillStyle = c.cell;
        g.beginPath();
        g.arc(x + side * 3, y - 1, 2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = c.ink;
        g.beginPath();
        g.arc(x + side * 3 + s.dir * 0.8, y - 0.6, 1, 0, Math.PI * 2);
        g.fill();
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      if (flash > 0) {
        g.globalAlpha = Math.min(1, flash) * 0.25;
        g.fillStyle = c.bad;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
      // The landing line and the ground.
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.5;
      g.setLineDash([4, 6]);
      g.beginPath();
      g.moveTo(0, LAND_Y);
      g.lineTo(W, LAND_Y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = c.cellAlt;
      g.fillRect(0, CANNON_Y + 12, W, H - CANNON_Y - 12);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, CANNON_Y + 12);
      g.lineTo(W, CANNON_Y + 12);
      g.stroke();

      for (const sh of s.shields)
        sh.cells.forEach((on, i) => {
          if (!on) return;
          const p = shieldCell(sh, i);
          g.fillStyle = c.muted;
          g.fillRect(p.x, p.y, BLOCK, BLOCK);
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.35;
          g.strokeRect(p.x, p.y, BLOCK, BLOCK);
        });

      for (const k of s.critters) {
        if (!k.alive) continue;
        const p = critterAt(s, k);
        critter(g, p.x, p.y, k.k);
      }

      for (const b of s.shots) arena.box(g, b.x - SHOT_HW, b.y - SHOT_HL, SHOT_HW * 2, SHOT_HL * 2, c.accent, 1, false);
      // Enemy shots: a zigzag bolt.
      g.strokeStyle = c.bad;
      g.lineWidth = 2.4;
      for (const m of s.bombs) {
        g.beginPath();
        for (let i = 0; i <= 4; i++) {
          const x = m.x + (i % 2 ? 2.5 : -2.5) * (Math.floor(m.y / 6) % 2 ? 1 : -1);
          const y = m.y - SHOT_HL + i * ((SHOT_HL * 2) / 4);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }

      for (const p of sparks) {
        g.globalAlpha = Math.min(1, p.life * 2.5);
        g.fillStyle = p.k < 0 ? c.bad : c.p[p.k];
        g.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      g.globalAlpha = 1;

      // The cannon (blinking while safe after a hit).
      if (s.safe <= 0 || Math.floor(s.safe * 10) % 2 === 0) {
        arena.box(g, s.px - CANNON_HW, CANNON_Y - 2, CANNON_HW * 2, 12, c.accent, 3);
        arena.box(g, s.px - 3.5, CANNON_Y - 11, 7, 10, c.accent, 2, false);
      }
    }

    const release = () => {
      s.fire = false;
      s.target = null;
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 4,
      onDown(p) {
        offset = s.px - p.x;
        s.target = s.px;
        s.fire = true;
      },
      onMove(p, from) {
        if (from) s.target = p.x + offset;
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
        const ev = step(s, dt);
        for (const p of ev.pops)
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + p.x;
            const sp = 50 + ((i * 29) % 60);
            sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, k: p.k });
          }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const p = sparks[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt;
          if (p.life <= 0) sparks.splice(i, 1);
        }
        flash = Math.max(0, flash - dt * 2);
        if (ev.hurt) {
          flash = 1;
          ctx.lives(s.lives, LIVES);
        }
        if (ev.hit || ev.cleared) {
          ctx.score(s.score);
          status();
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
