import './style.css';
import { L, P } from '../../core/i18n';
import { btn } from '../../core/pad';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures } from '../../kits/gesture/gesture';
import { sfx } from '../../kits/sound/sound';
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
        'Jump over crates and holes; later, duck under the hanging bars. Each bump costs a heart.',
        'Sautez par-dessus les caisses et les trous; plus loin, penchez-vous sous les barres suspendues. Chaque choc coûte un cœur.',
      ),
      L(
        'Tap to jump: hold for a high jump, let go early for a short hop. You can land on crates.',
        'Touchez pour sauter : maintenez pour un grand saut, relâchez tôt pour un petit bond. Vous pouvez atterrir sur les caisses.',
      ),
      L(
        'Swipe down, or hold the ground under the runner, to duck (in the air, it drops you at once).',
        'Balayez vers le bas, ou maintenez le sol sous le coureur, pour vous pencher (en l’air, vous redescendez d’un coup).',
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
  pad: () => ({ left: [btn('ArrowDown', 'duck', L('Duck', 'Pencher'))], right: [btn(' ', 'jump', L('Jump', 'Sauter'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const max = s.lives;
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    let shown = -1;
    /** Arena time of the last bump (the runner winces), and how the run ended. */
    let hurtAt = -9;
    let ended: '' | 'won' | 'lost' = '';
    /** Squash on landing, 1 → 0. */
    let squash = 0;
    /** A press on the ground band ducks while held instead of jumping. */
    let groundHold = false;

    const status = () => {
      shown = Math.floor(progress(s) * 100);
      ctx.status([L(`${shown}%`, `${shown} %`), P(s.collected, ['coin', 'coins'], ['pièce', 'pièces'])].join(' · '));
    };

    /** Screen x of a track position. */
    const sx = (x: number) => RX + x - s.x;

    function drawRunner(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      if (!ended && s.invulnerable && Math.floor(s.invulnerable * 10) % 2) return;
      const duckNow = ducking(s);
      const h = heightOf(s);
      const feet = GROUND - s.y;
      g.save();
      if (ended === 'lost') {
        // Knocked over: tipped back on the spot.
        g.translate(RX, feet);
        g.rotate(-Math.PI / 2 + 0.3);
        g.translate(-RX, -feet);
      }
      // Legs: a quick stride on the ground, tucked in the air.
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 1.3;
      g.lineCap = 'round';
      const running = s.grounded && !ended;
      const stride = running ? Math.sin(s.time * 22) * 6 : 3;
      for (const k of [-1, 1]) {
        g.beginPath();
        g.moveTo(RX + k * 4, feet - 7);
        g.lineTo(RX + k * 4 + stride * k, feet - (s.grounded ? 0 : 4));
        g.stroke();
      }
      // Body: squashed on landing and when ducking, stretched while rising.
      const stretch = s.grounded ? 1 - 0.15 * squash * squash : Math.max(0.92, Math.min(1.1, 1 + s.vy / 4000));
      const bh = (h - 5) * stretch;
      const bw = (PW + 3) * (duckNow ? 1.15 : 1) * (1 + (1 - stretch) * 0.6);
      const x = RX - bw / 2;
      const y = feet - 5 - bh;
      // Arm swinging behind the body.
      if (!duckNow) {
        const swing = running ? Math.sin(s.time * 22 + Math.PI) * 5 : -5;
        g.beginPath();
        g.moveTo(RX - 2, y + bh * 0.5);
        g.lineTo(RX - 8 - swing * 0.4, y + bh * 0.5 + 6 + swing);
        g.stroke();
      }
      g.lineCap = 'butt';
      arena.block(g, x, y, bw, bh, c.accent, 7);
      // Headband trailing in the wind.
      const wave = Math.sin(s.time * 14);
      g.fillStyle = c.p[6];
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.5;
      g.beginPath();
      g.moveTo(x + 1, y + 4);
      g.lineTo(x - 9, y + 2 + wave * 2);
      g.lineTo(x - 7, y + 7 + wave * 2.5);
      g.lineTo(x + 1, y + 8);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillRect(x + 1, y + 4, bw - 2, 4);
      // Eye with a pupil looking ahead (a wince right after a bump).
      const ex = x + bw - 7;
      const ey = y + Math.min(13, bh * 0.55);
      if (arena.time - hurtAt < 0.5 || ended === 'lost') {
        g.strokeStyle = c.coal;
        g.lineWidth = arena.lw * 0.7;
        g.beginPath();
        g.moveTo(ex - 3, ey - 3);
        g.lineTo(ex + 3, ey + 3);
        g.moveTo(ex + 3, ey - 3);
        g.lineTo(ex - 3, ey + 3);
        g.stroke();
      } else {
        arena.disc(g, ex, ey, 4, c.paper);
        g.fillStyle = c.coal;
        g.beginPath();
        g.arc(ex + 1.4, ey + (s.grounded ? 0 : s.vy > 0 ? -1.2 : 1.2), 1.9, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }

    function drawCoin(g: CanvasRenderingContext2D, x: number, y: number) {
      const c = arena.colors;
      const spin = Math.cos(arena.time * 4 + x * 0.05);
      const rx = COIN_R * (0.3 + 0.7 * Math.abs(spin));
      const t = arena.tone(c.p[3]);
      g.fillStyle = t.lo;
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.7;
      g.beginPath();
      g.ellipse(x, y, rx, COIN_R, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = t.base;
      g.beginPath();
      g.ellipse(x - rx * 0.12, y, rx * 0.78, COIN_R * 0.82, 0, 0, Math.PI * 2);
      g.fill();
      if (Math.abs(spin) > 0.5) {
        g.fillStyle = t.hi;
        g.fillRect(x - rx * 0.2, y - COIN_R * 0.5, rx * 0.35, COIN_R);
      }
      g.beginPath();
      g.ellipse(x, y, rx, COIN_R, 0, 0, Math.PI * 2);
      g.stroke();
    }

    function drawFinish(g: CanvasRenderingContext2D, fl: number) {
      const c = arena.colors;
      g.fillStyle = c.ink;
      g.fillRect(fl - 2, GROUND - 120, 4, 120);
      for (let r = 0; r < 3; r++)
        for (let k = 0; k < 4; k++) {
          g.fillStyle = (k + r) % 2 ? c.coal : c.paper;
          g.fillRect(fl + 2 + k * 7, GROUND - 120 + r * 7, 7, 7);
        }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.6;
      g.strokeRect(fl + 2, GROUND - 120, 28, 21);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      // Sky: a sun, two layers of clouds and a tall far skyline, each drifting slower the further away.
      arena.ball(g, 206, 62, 20, c.p[3], false);
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
        [0.05, 48, 9, 150],
        [0.12, 100, 12, 190],
      ] as const) {
        g.fillStyle = speed < 0.1 ? c.cellAlt : c.cell;
        const shift = (s.x * speed) % span;
        const first = Math.floor((s.x * speed) / span);
        for (let i = 0; i < 3; i++) {
          const n = first + i;
          cloud(i * span - shift + ((n * 53) % 60), y0 + ((n * 29) % 3) * 12, r);
        }
      }
      g.fillStyle = c.cellAlt;
      g.globalAlpha = 0.55;
      for (let i = -1; i < 8; i++) {
        const n = i + Math.floor((s.x * 0.12) / 48);
        const x = i * 48 - ((s.x * 0.12) % 48);
        const tall = 90 + ((n * 41) % 6) * 14;
        g.fillRect(x, GROUND - tall, 40, tall);
      }
      g.globalAlpha = 1;
      // Near skyline, drifting slowly, with windows.
      for (let i = -1; i < 9; i++) {
        const n = i + Math.floor(Math.floor(s.x * 0.25) / 40);
        const x = i * 40 - ((s.x * 0.25) % 40);
        const tall = 36 + ((n * 37) % 5) * 13;
        g.fillStyle = c.cellAlt;
        g.fillRect(x, GROUND - tall, 32, tall);
        g.fillStyle = c.muted;
        g.globalAlpha = 0.25;
        for (let wy = GROUND - tall + 7; wy < GROUND - 10; wy += 12)
          for (const wx of [6, 19]) if (((n * 7 + wy * 3 + wx) & 3) !== 0) g.fillRect(x + wx, wy, 6, 5);
        g.globalAlpha = 1;
      }
      // Ground, cut by the pits: a grass strip on top, dashes scrolling by.
      const pits = s.obstacles.filter((o) => o.kind === 'pit' && sx(o.x + o.w) > -10 && sx(o.x) < W + 10);
      g.fillStyle = c.ink;
      g.globalAlpha = arena.dark ? 0.55 : 0.75;
      for (const p of pits) g.fillRect(sx(p.x), GROUND, p.w, H - GROUND + 6);
      g.globalAlpha = 1;
      let from = -10;
      for (const p of [...pits, { x: s.x + W, w: 0 }]) {
        const to = Math.min(W + 10, sx(p.x));
        if (to > from) {
          arena.box(g, from, GROUND, to - from, H - GROUND + 6, c.cellAlt, 0, false);
          arena.box(g, from, GROUND, to - from, 6, c.p[2], 2, false);
        }
        from = sx(p.x + p.w);
      }
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.6;
      for (let x = -((s.x % 30) + 30); x < W + 30; x += 30) {
        if (pits.some((p) => x > sx(p.x) - 12 && x < sx(p.x + p.w) + 2)) continue;
        g.beginPath();
        g.moveTo(x, GROUND + 22);
        g.lineTo(x + 10, GROUND + 22);
        g.stroke();
      }
      const fl = sx(s.length);
      if (fl < W + 40) drawFinish(g, fl);
      for (const o of s.obstacles) {
        const x = sx(o.x);
        if (x > W + 4 || x + o.w < -8) continue;
        if (o.kind === 'block') {
          // A crate: bevelled, with a frame and a brace.
          arena.block(g, x, GROUND - o.h, o.w, o.h, c.p[0], 3);
          if (o.w > 14 && o.h > 14) {
            g.strokeStyle = arena.tone(c.p[0]).edge;
            g.lineWidth = arena.lw * 0.5;
            g.strokeRect(x + 3.5, GROUND - o.h + 3.5, o.w - 7, o.h - 9);
            g.beginPath();
            g.moveTo(x + 3.5, GROUND - o.h + 3.5);
            g.lineTo(x + o.w - 3.5, GROUND - 5.5);
            g.stroke();
          }
        } else if (o.kind === 'bar') {
          // Hanging bar: hazard stripes, from the top down to just above a ducking runner.
          const bottom = GROUND - BAR_GAP;
          g.fillStyle = c.muted;
          g.fillRect(x + o.w / 2 - 2, 0, 4, bottom - 18);
          arena.block(g, x, bottom - 20, o.w, 20, c.p[4], 3);
          g.save();
          g.beginPath();
          g.rect(x + 1, bottom - 19, o.w - 2, 15);
          g.clip();
          g.fillStyle = c.coal;
          g.globalAlpha = 0.3;
          for (let k = -10; k < o.w + 10; k += 12) {
            g.beginPath();
            g.moveTo(x + k, bottom - 1);
            g.lineTo(x + k + 6, bottom - 1);
            g.lineTo(x + k + 14, bottom - 19);
            g.lineTo(x + k + 8, bottom - 19);
            g.fill();
          }
          g.restore();
        }
      }
      for (const coin of s.coins) {
        const x = sx(coin.x);
        if (coin.taken || x < -10 || x > W + 10) continue;
        drawCoin(g, x, GROUND - coin.y);
      }
      drawRunner(g);
      // Progress bar along the top: a dot marks the runner, a flag the finish.
      const p = progress(s);
      const bw = W - 34;
      arena.box(g, 10, 9, bw, 10, c.cellAlt, 5, false);
      g.fillStyle = c.accent;
      g.beginPath();
      g.roundRect(10, 9, Math.max(10, bw * p), 10, 5);
      g.fill();
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.roundRect(10, 9, bw, 10, 5);
      g.stroke();
      arena.disc(g, 10 + Math.max(5, bw * p - 5), 14, 5.5, c.accent);
      for (let r = 0; r < 2; r++)
        for (let k = 0; k < 3; k++) {
          g.fillStyle = (k + r) % 2 ? c.coal : c.paper;
          g.fillRect(W - 19 + k * 4, 7 + r * 4, 4, 4);
        }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.5;
      g.strokeRect(W - 19, 7, 12, 8);
      g.fillStyle = c.ink;
      g.fillRect(W - 20.5, 7, 1.5, 15);
      arena.overlay(g);
    }

    const jump = () => {
      const was = s.grounded && !s.falling;
      press(s);
      if (was && !s.grounded) sfx('jump', { vol: 0.6 });
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 16,
      onDown: (p) => {
        // The ground band under the runner is a duck button; anywhere else jumps.
        groundHold = p.y > GROUND + 4;
        if (groundHold) s.duckKey = true;
        else jump();
      },
      onSwipe: (dir) => {
        if (dir === 2) duck(s);
      },
      onTap: () => {
        release(s);
        if (groundHold) s.duckKey = groundHold = false;
      },
      onRelease: () => {
        release(s);
        if (groundHold) s.duckKey = groundHold = false;
      },
    });

    ctx.score(0);
    ctx.lives(s.lives, max);
    status();
    return {
      draw,
      frame(dt) {
        const before = s.score;
        const wasDucking = ducking(s);
        const wasGrounded = s.grounded;
        const vy = s.vy;
        const ev = step(s, dt);
        arena.update(dt);
        squash = Math.max(0, squash - dt * 6);
        const c = arena.colors;
        const feet = GROUND - s.y;
        if (wasGrounded && !s.grounded && s.vy > 0) fx.burst(RX - 4, feet, c.muted, 5, 60, 2.5, 0.3, 'dot', 0, Math.PI, Math.PI * 0.6);
        if (ev.coin) {
          const mid = feet - heightOf(s) / 2;
          fx.burst(RX + 6, mid, c.p[3], 7, 90, 2.5, 0.35, 'spark', 0);
          fx.text(RX + 16, feet - heightOf(s) - 12, `+${COIN_POINTS}`, c.p[3], 12, 0.6);
          sfx('coin', { pitch: (s.collected % 5) * 2 });
        }
        if (ev.landed && !wasDucking) {
          squash = Math.min(1, -vy / 600);
          fx.burst(RX, feet, c.muted, 8, 80, 2.5, 0.35, 'dot', 0, Math.PI, Math.PI * 0.9);
          sfx('hit', { vol: 0.35, pitch: 6 });
        }
        if (ev.hurt) {
          hurtAt = arena.time;
          const y = Math.min(GROUND, feet) - 18;
          fx.burst(RX + 8, y, c.bad, 12, 140, 3.5, 0.5, 'square', 300);
          fx.ring(RX, y, c.bad, 8, 34, 0.35, arena.lw * 1.4);
          fx.shake(4, 0.3);
          fx.flash(c.bad, 0.18, 0.3);
          ctx.lives(s.lives, max);
        }
        if (s.score !== before) ctx.score(s.score);
        if (ev.coin || Math.floor(progress(s) * 100) !== shown) status();
        if (ev.won) {
          ended = 'won';
          const fl = sx(s.length);
          for (let i = 0; i < 5; i++) fx.burst(fl + 14, GROUND - 110, c.p[i], 9, 170, 3.5, 0.9, 'square', 200);
          fx.ring(RX, feet - 18, c.good, 8, 70, 0.6, arena.lw * 1.5);
          fx.text(W / 2, GROUND - 150, L('Finish!', 'Arrivée!'), c.good, 20, 1.2);
          fx.flash(c.good, 0.2, 0.5);
          arena.linger(1.4);
        } else if (ev.over) {
          ended = 'lost';
          arena.linger(1.2);
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const down = e.type === 'keydown';
        if (k === ' ' || k === 'arrowup' || k === 'w') {
          if (down && !e.repeat) jump();
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
