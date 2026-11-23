import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures } from '../../kits/gesture/gesture';
import {
  BAR_GAP,
  COIN_POINTS,
  COIN_R,
  coinsFor,
  createLevel,
  duck,
  ducking,
  GROUND,
  H,
  heightOf,
  lengthFor,
  LIFE_BONUS,
  livesFor,
  press,
  progress,
  PW,
  release,
  RX,
  speedFor,
  step,
  W,
} from './rules';

const FONT = "700 12px 'Space Grotesk Variable', system-ui, sans-serif";
const POP_S = 0.6;

/** A short-lived effect: a coin's score, a bump ring or landing dust (screen x, height above ground). */
interface Pop {
  x: number;
  y: number;
  age: number;
  kind: 'coin' | 'hit' | 'dust';
}

export const runner: GameDef = {
  id: 'runner',
  get name() {
    return L('Runner', 'Coureur');
  },
  get rules() {
    return L('Jump and duck your way to the finish line.', 'Sautez et penchez-vous jusqu’à la ligne d’arrivée.');
  },
  category: 'move',
  help: () => ({
    goal: L('Reach the finish line before you run out of hearts.', 'Rendez-vous à la ligne d’arrivée avant de manquer de cœurs.'),
    steps: [
      L(
        'You run on your own, a little faster as you go. The bar at the top shows how far is left.',
        'Vous courez tout seul, un peu plus vite à mesure. La barre du haut montre le chemin qui reste.',
      ),
      L(
        'Jump over blocks and holes; later, duck under the hanging bars. Each bump costs a heart.',
        'Sautez par-dessus les blocs et les trous; plus loin, penchez-vous sous les barres suspendues. Chaque choc coûte un cœur.',
      ),
      L(
        'Tap to jump: hold for a high jump, let go early for a short hop. You can land on blocks.',
        'Touchez pour sauter : maintenez pour un grand saut, relâchez tôt pour un petit bond. Vous pouvez atterrir sur les blocs.',
      ),
      L(
        'Swipe down to duck for a moment (in the air, it drops you at once).',
        'Balayez vers le bas pour vous pencher un instant (en l’air, vous redescendez d’un coup).',
      ),
      L(
        'Keyboard: Space, ↑ or W to jump (hold for higher), ↓ or S to duck, P to pause.',
        'Clavier : Espace, ↑ ou W pour sauter (maintenez pour monter plus haut), ↓ ou S pour vous pencher, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Coins trace the arc of a full jump: jump so its top lands over the obstacle.',
        'Les pièces dessinent l’arc d’un grand saut : sautez pour que son sommet passe au-dessus de l’obstacle.',
      ),
      L(
        `${COIN_POINTS} points per coin, ${LIFE_BONUS} per heart left at the finish.`,
        `${COIN_POINTS} points par pièce, ${LIFE_BONUS} par cœur restant à l’arrivée.`,
      ),
    ],
  }),
  stars: (d) => {
    const coins = coinsFor(d) * COIN_POINTS;
    const lives = livesFor(d);
    return [Math.round(coins * 0.5) + (lives - 1) * LIFE_BONUS, Math.round(coins * 0.95) + lives * LIFE_BONUS];
  },
  par: (d) => Math.round(lengthFor(d) / (speedFor(d) * 1.15)),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const max = s.lives;
    const arena = new Arena(ctx.root, W, H, () => draw());
    const pops: Pop[] = [];
    let flash = 0;
    let shown = -1;

    const status = () => {
      shown = Math.floor(progress(s) * 100);
      ctx.status([L(`${shown}%`, `${shown} %`), P(s.collected, ['coin', 'coins'], ['pièce', 'pièces'])].join(' · '));
    };

    /** Screen x of a track position. */
    const sx = (x: number) => RX + x - s.x;

    function drawRunner(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      if (s.invulnerable && Math.floor(s.invulnerable * 10) % 2) return;
      const h = heightOf(s);
      const x = RX - PW / 2;
      const y = GROUND - s.y - h;
      // Legs: a quick stride on the ground, tucked in the air.
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 1.1;
      g.lineCap = 'round';
      const stride = s.grounded ? Math.sin(s.time * 22) * 5 : 2;
      const legTop = Math.min(y + h - 4, GROUND - s.y - 4);
      for (const k of [-1, 1]) {
        g.beginPath();
        g.moveTo(RX + k * 3, legTop);
        g.lineTo(RX + k * 3 + stride * k, GROUND - s.y + (s.grounded ? 0 : -3));
        g.stroke();
      }
      arena.box(g, x, y, PW, h - 3, c.accent, 5);
      // Eye and a headband trailing behind.
      arena.disc(g, x + PW - 5, y + 6, 2.6, c.cell);
      g.fillStyle = c.p[6];
      g.fillRect(x - 6, y + 2 + Math.sin(s.time * 14) * 1.5, 7, 3);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Sky: a sun, two layers of clouds and a tall far skyline, each drifting slower the further away.
      arena.disc(g, 238, 74, 22, c.p[3]);
      const cloud = (x: number, y: number, r: number) => {
        g.beginPath();
        g.arc(x, y, r, Math.PI * 0.5, Math.PI * 1.5);
        g.arc(x + r * 0.9, y - r * 0.55, r * 0.95, Math.PI, Math.PI * 2);
        g.arc(x + r * 2, y, r, Math.PI * 1.5, Math.PI * 0.5);
        g.closePath();
        g.fill();
        g.stroke();
      };
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.6;
      for (const [speed, y0, r, span] of [
        [0.05, 56, 9, 170],
        [0.12, 118, 13, 210],
      ] as const) {
        g.fillStyle = speed < 0.1 ? c.cellAlt : c.cell;
        const shift = (s.x * speed) % span;
        const first = Math.floor((s.x * speed) / span);
        for (let i = 0; i < 3; i++) {
          const n = first + i;
          cloud(i * span - shift + ((n * 53) % 60), y0 + ((n * 29) % 3) * 12, r);
        }
      }
      g.fillStyle = c.cell;
      g.globalAlpha = 0.6;
      for (let i = -1; i < 8; i++) {
        const k = Math.floor((s.x * 0.12) / 48);
        const n = i + k;
        const x = i * 48 - ((s.x * 0.12) % 48);
        const tall = 110 + ((n * 41) % 6) * 16;
        g.fillRect(x, GROUND - tall, 40, tall);
      }
      g.globalAlpha = 1;
      // Near skyline, drifting slowly.
      g.fillStyle = c.cellAlt;
      for (let i = -1; i < 9; i++) {
        const k = Math.floor(s.x * 0.25) / 40;
        const n = i + Math.floor(k);
        const x = i * 40 - ((s.x * 0.25) % 40);
        const tall = 40 + ((n * 37) % 5) * 14;
        g.fillRect(x, GROUND - tall, 32, tall);
      }
      // Ground, cut by the pits.
      const pits = s.obstacles.filter((o) => o.kind === 'pit' && sx(o.x + o.w) > -10 && sx(o.x) < W + 10);
      let from = -10;
      for (const p of [...pits, { x: s.x + W, w: 0 }]) {
        const to = Math.min(W + 10, sx(p.x));
        if (to > from) arena.box(g, from, GROUND, to - from, H - GROUND + 6, c.cellAlt, 0, false);
        from = sx(p.x + p.w);
      }
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.5;
      for (let x = -((s.x % 30) + 30); x < W + 30; x += 30) {
        if (pits.some((p) => x > sx(p.x) - 4 && x < sx(p.x + p.w) + 4)) continue;
        g.beginPath();
        g.moveTo(x, GROUND + 10);
        g.lineTo(x + 8, GROUND + 10);
        g.stroke();
      }
      // Finish line.
      const fx = sx(s.length);
      if (fx < W + 10) {
        for (let k = 0; k < 8; k++) {
          g.fillStyle = k % 2 ? c.ink : c.cell;
          g.fillRect(fx, GROUND - 80 + k * 10, 8, 10);
        }
        g.strokeStyle = c.ink;
        g.strokeRect(fx, GROUND - 80, 8, 80);
      }
      for (const o of s.obstacles) {
        const x = sx(o.x);
        if (x > W + 4 || x + o.w < -8) continue;
        if (o.kind === 'block') arena.box(g, x, GROUND - o.h, o.w, o.h, c.p[0], 3);
        else if (o.kind === 'bar') {
          // Hanging bar: striped, from the top down to just above a ducking runner.
          const bottom = GROUND - BAR_GAP;
          g.fillStyle = c.muted;
          g.fillRect(x + o.w / 2 - 2, 14, 4, bottom - 30);
          arena.box(g, x, bottom - 18, o.w, 18, c.p[4], 3);
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.5;
          for (let k = 8; k < o.w; k += 10) {
            g.beginPath();
            g.moveTo(x + k, bottom - 17);
            g.lineTo(x + k - 6, bottom - 1);
            g.stroke();
          }
        }
      }
      for (const coin of s.coins) {
        const x = sx(coin.x);
        if (coin.taken || x < -10 || x > W + 10) continue;
        const squash = Math.abs(Math.cos(s.time * 4 + coin.x * 0.05));
        g.fillStyle = c.p[3];
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.7;
        g.beginPath();
        g.ellipse(x, GROUND - coin.y, COIN_R * (0.35 + 0.65 * squash), COIN_R, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      drawRunner(g);
      for (const p of pops) {
        const k = p.age / POP_S;
        g.globalAlpha = Math.max(0, 1 - k);
        if (p.kind === 'coin') {
          g.font = FONT;
          g.textAlign = 'center';
          g.fillStyle = c.fg;
          g.fillText(`+${COIN_POINTS}`, p.x, GROUND - p.y - 10 - k * 20);
        } else if (p.kind === 'hit') {
          g.strokeStyle = c.bad;
          g.lineWidth = arena.lw * 1.5;
          g.beginPath();
          g.arc(p.x, GROUND - p.y, 12 + k * 26, 0, Math.PI * 2);
          g.stroke();
        } else {
          g.fillStyle = c.muted;
          for (const dx of [-1, 1]) {
            g.beginPath();
            g.arc(p.x + dx * (6 + k * 14), GROUND - p.y - 3 - k * 4, 3 * (1 - k) + 0.5, 0, Math.PI * 2);
            g.fill();
          }
        }
        g.globalAlpha = 1;
      }
      // Progress bar along the top, with the finish flag at its end.
      arena.box(g, 10, 10, W - 20, 10, c.cellAlt, 5, false);
      g.fillStyle = c.accent;
      g.beginPath();
      g.roundRect(10, 10, Math.max(10, (W - 20) * progress(s)), 10, 5);
      g.fill();
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.roundRect(10, 10, W - 20, 10, 5);
      g.stroke();
      if (flash > 0) {
        g.fillStyle = c.bad;
        g.globalAlpha = flash * 0.45;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 18,
      onDown: () => press(s),
      onSwipe: (dir) => {
        if (dir === 2) duck(s);
      },
      onTap: () => release(s),
      onRelease: () => release(s),
    });

    ctx.score(0);
    ctx.lives(s.lives, max);
    status();
    return {
      draw,
      frame(dt) {
        flash = Math.max(0, flash - dt * 3);
        for (const p of pops) p.age += dt;
        while (pops.length && pops[0].age > POP_S) pops.shift();
        const before = s.score;
        const wasDucking = ducking(s);
        const ev = step(s, dt);
        if (ev.coin) pops.push({ x: RX, y: s.y + heightOf(s), age: 0, kind: 'coin' });
        if (ev.landed && !wasDucking) pops.push({ x: RX, y: s.y, age: 0, kind: 'dust' });
        if (ev.hurt) {
          pops.push({ x: RX, y: Math.max(0, s.y) + 12, age: 0, kind: 'hit' });
          flash = 1;
          ctx.lives(s.lives, max);
        }
        if (s.score !== before) ctx.score(s.score);
        if (ev.coin || Math.floor(progress(s) * 100) !== shown) status();
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const down = e.type === 'keydown';
        if (k === ' ' || k === 'arrowup' || k === 'w') {
          if (down && !e.repeat) press(s);
          else if (!down) release(s);
          return true;
        }
        if (k === 'arrowdown' || k === 's') {
          s.duckKey = down;
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
