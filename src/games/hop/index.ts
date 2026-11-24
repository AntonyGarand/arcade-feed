import './style.css';
import { L, P } from '../../core/i18n';
import { btn } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { glyphPath } from '../../kits/glyph/glyph';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  COIN_POINTS,
  COIN_R,
  createLevel,
  CRIT_R,
  GEM_POINTS,
  GEM_R,
  goalFor,
  H,
  HEIGHT_UNIT,
  LIFE_BONUS,
  LIVES,
  parFor,
  PH,
  PLAT_H,
  PR,
  progress,
  SPRING_W,
  step,
  STOMP_POINTS,
  TIME_POINTS,
  W,
  type Plat,
} from './rules';

/** Coins a level deals, about (one in two path platforms, three over every fourth). */
const coinsAbout = (d: Parameters<typeof goalFor>[0]) => Math.round((goalFor(d) / byLevel(d, [52, 59, 65, 69, 73])) * 1.1);

export const hop: GameDef = {
  id: 'hop',
  get name() {
    return L('Hop', 'Bondissez');
  },
  get rules() {
    return L('Bounce from platform to platform up to the flag.', 'Rebondissez de plateforme en plateforme jusqu’au drapeau.');
  },
  category: 'move',
  help: () => ({
    goal: L(
      'Climb to the finish flag at the top before you run out of hearts.',
      'Grimpez jusqu’au drapeau d’arrivée, tout en haut, avant de manquer de cœurs.',
    ),
    steps: [
      L(
        'Your hopper bounces by itself each time it lands on a platform. Steer it left and right to land on the next one up.',
        'Votre sauteur rebondit tout seul chaque fois qu’il touche une plateforme. Dirigez-le à gauche et à droite pour atteindre la suivante.',
      ),
      L(
        'The field wraps: leave by one side to come back by the other. Falling off the bottom costs a heart.',
        'Le terrain fait le tour : sortez d’un côté pour revenir de l’autre. Tomber par le bas coûte un cœur.',
      ),
      L(
        'Some platforms slide, cracked ones break after one bounce, and springs send you very high.',
        'Certaines plateformes glissent, les fissurées cèdent après un rebond et les ressorts vous propulsent très haut.',
      ),
      L(
        'Spiky critters cost a heart if you bump into them, but you can stomp them from above.',
        'Les bestioles à piquants coûtent un cœur si vous les heurtez, mais vous pouvez les écraser par le dessus.',
      ),
      L(
        'Hold the left or right half of the field to steer. Keyboard: ← → or A D, P to pause.',
        'Maintenez la moitié gauche ou droite du terrain pour vous diriger. Clavier : ← → ou A D, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Steer as soon as you take off: you have the whole bounce to line up with the next platform.',
        'Dirigez-vous dès le décollage : vous avez tout le rebond pour vous aligner sur la plateforme suivante.',
      ),
      L(
        `A point per ${HEIGHT_UNIT} of height, ${COIN_POINTS} per coin, ${GEM_POINTS} per gem, ${STOMP_POINTS} per stomp; at the flag, ${LIFE_BONUS} per heart and ${TIME_POINTS} per second saved.`,
        `Un point par ${HEIGHT_UNIT} de hauteur, ${COIN_POINTS} par pièce, ${GEM_POINTS} par gemme, ${STOMP_POINTS} par bestiole écrasée; au drapeau, ${LIFE_BONUS} par cœur et ${TIME_POINTS} par seconde gagnée.`,
      ),
    ],
  }),
  stars: (d) => {
    const base = goalFor(d) / HEIGHT_UNIT;
    const coins = coinsAbout(d) * COIN_POINTS;
    return [
      Math.round(base + coins * 0.3 + (LIVES - 1) * LIFE_BONUS),
      Math.round(base + coins * 0.55 + LIVES * LIFE_BONUS + parFor(d) * 0.15 * TIME_POINTS),
    ];
  },
  par: (d) => parFor(d),
  pad: () => ({ left: [btn('ArrowLeft', 'left', L('Left', 'Gauche'))], right: [btn('ArrowRight', 'right', L('Right', 'Droite'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    /** Squash after a landing, 1 → 0. */
    let squash = 0;
    /** Recently crumbled platforms, with when they broke (for their falling halves). */
    const broken: { p: Plat; t: number }[] = [];
    let keyL = false;
    let keyR = false;
    let pointerDir: -1 | 0 | 1 = 0;
    let pointerId = -1;
    let shown = '';
    let ended = false;

    /** Screen y of a height. */
    const sy = (alt: number) => H - (alt - s.cam);

    const status = () => {
      const pct = Math.floor(progress(s) * 100);
      const text = [L(`${pct}%`, `${pct} %`), P(s.coinsTaken + s.gemsTaken, ['coin', 'coins'], ['pièce', 'pièces'])].join(' · ');
      if (text !== shown) ctx.status((shown = text));
    };

    /** Run `fn` at x and at its wrapped twin when the shape (half width `hw`) crosses a side. */
    const wrapped = (x: number, hw: number, fn: (x: number) => void) => {
      fn(x);
      if (x - hw < 0) fn(x + W);
      if (x + hw > W) fn(x - W);
    };

    function drawPlat(g: CanvasRenderingContext2D, p: Plat) {
      const c = arena.colors;
      const y = sy(p.alt);
      if (y < -20 || y > H + 20) return;
      if (p.kind === 'ground') {
        arena.block(g, -6, y, W + 12, H, c.p[2], 0, false);
        return;
      }
      const fill = p.kind === 'moving' ? c.p[4] : p.kind === 'crumble' ? c.cellAlt : c.p[2];
      wrapped(p.x, p.w / 2, (x) => {
        const x0 = x - p.w / 2;
        if (p.kind === 'crumble') {
          arena.box(g, x0, y, p.w, PLAT_H, fill, 3);
          g.strokeStyle = c.muted;
          g.lineWidth = arena.lw * 0.6;
          g.beginPath();
          g.moveTo(x0 + p.w * 0.3, y + 1);
          g.lineTo(x0 + p.w * 0.38, y + PLAT_H * 0.55);
          g.lineTo(x0 + p.w * 0.33, y + PLAT_H - 1);
          g.moveTo(x0 + p.w * 0.68, y + 1);
          g.lineTo(x0 + p.w * 0.62, y + PLAT_H * 0.6);
          g.stroke();
        } else arena.block(g, x0, y, p.w, PLAT_H, fill, 4);
        if (p.kind === 'moving') {
          // Little arrows on both ends: this one slides.
          g.fillStyle = arena.tone(fill).edge;
          for (const k of [-1, 1]) {
            const ax = x + k * (p.w / 2 - 5);
            g.beginPath();
            g.moveTo(ax + k * 3, y + PLAT_H / 2 - 1);
            g.lineTo(ax - k * 1.5, y + 1.5);
            g.lineTo(ax - k * 1.5, y + PLAT_H - 3.5);
            g.closePath();
            g.fill();
          }
        }
        if (p.spring != null) {
          const spx = x + p.spring;
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.7;
          g.beginPath();
          g.moveTo(spx - 5, y);
          for (let k = 1; k <= 4; k++) g.lineTo(spx + (k % 2 ? 5 : -5), y - k * 2.2);
          g.stroke();
          arena.box(g, spx - SPRING_W, y - 12, SPRING_W * 2, 4, c.p[6], 2, false);
        }
      });
    }

    function drawHopper(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      if (s.invulnerable && Math.floor(s.invulnerable * 10) % 2) return;
      // Squash on landing, stretch on the way up.
      const stretch = Math.max(0, Math.min(1, s.vy / 900)) * 0.22;
      const q = squash * squash * 0.38;
      const ky = 1 + stretch - q;
      const kx = 1 / ky;
      const look = Math.max(-1, Math.min(1, s.vx / 200));
      wrapped(s.x, PR + 4, (x) => {
        g.save();
        g.translate(x, sy(s.alt));
        g.scale(kx, ky);
        // Two stubby feet, then the body, a sprout and the eyes.
        g.fillStyle = c.ink;
        for (const k of [-1, 1]) {
          g.beginPath();
          g.ellipse(k * 4.5, -1.5, 3.5, 2, 0, 0, Math.PI * 2);
          g.fill();
        }
        arena.box(g, -PR, -PH, PR * 2, PH - 2, c.accent, 9);
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.7;
        g.beginPath();
        g.moveTo(0, -PH);
        g.quadraticCurveTo(-1, -PH - 6, 3, -PH - 8);
        g.stroke();
        g.fillStyle = c.p[3];
        g.beginPath();
        g.ellipse(4.5, -PH - 8, 3.5, 2, -0.4, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        for (const k of [-1, 1]) {
          const ex = k * 4 + look * 2;
          arena.disc(g, ex, -PH * 0.62, 2.8, c.paper);
          g.fillStyle = c.coal;
          g.beginPath();
          g.arc(ex + look, -PH * 0.62 + (s.vy < 0 ? 0.8 : -0.4), 1.3, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      });
    }

    function drawCritter(g: CanvasRenderingContext2D, x: number, y: number) {
      const c = arena.colors;
      const wob = Math.sin(arena.time * 8 + x) * 1.2;
      // Spikes all round the sides and bottom; the top is a smooth shell, safe to stomp.
      g.fillStyle = c.ink;
      for (let k = 0; k < 7; k++) {
        const a = -0.2 + (k / 6) * (Math.PI + 0.4);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        g.beginPath();
        g.moveTo(x + ca * (CRIT_R + 5), y + sa * (CRIT_R + 5) + wob);
        g.lineTo(x + Math.cos(a - 0.3) * CRIT_R, y + Math.sin(a - 0.3) * CRIT_R);
        g.lineTo(x + Math.cos(a + 0.3) * CRIT_R, y + Math.sin(a + 0.3) * CRIT_R);
        g.closePath();
        g.fill();
      }
      arena.ball(g, x, y, CRIT_R, c.bad);
      for (const k of [-1, 1]) {
        arena.disc(g, x + k * 4, y - 1, 2.6, c.paper);
        g.fillStyle = c.coal;
        g.beginPath();
        g.arc(x + k * 4, y - 0.5, 1.2, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.moveTo(x - 6, y - 5.5);
      g.lineTo(x - 2, y - 4);
      g.moveTo(x + 6, y - 5.5);
      g.lineTo(x + 2, y - 4);
      g.stroke();
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);
      // Clouds drifting past slower than the platforms, and height marks along the left side.
      g.fillStyle = c.cell;
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.4;
      const span = 170;
      const first = Math.floor((s.cam * 0.4) / span);
      for (let i = -1; i < 4; i++) {
        const n = first + i;
        const y = H - (n * span - s.cam * 0.4);
        const x = (((n * 97) % W) + W) % W;
        for (const dx of [0, 16, 32]) {
          g.beginPath();
          g.ellipse(x + dx - 16, y - (dx === 16 ? 6 : 0), 14, 9, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.fillStyle = c.muted;
      g.font = `700 8px ${arena.family}`;
      g.textAlign = 'left';
      for (let m = Math.ceil(s.cam / 250) * 250; m < s.cam + H; m += 250) {
        if (m <= 0 || m >= s.goal) continue;
        g.fillRect(0, sy(m) - 0.5, 8, 1);
        g.fillText(`${m / HEIGHT_UNIT}`, 10, sy(m) + 3);
      }

      // Finish line: a checkered band across the field, a flag on its left.
      const fy = sy(s.goal);
      if (fy > -20 && fy < H + 20) {
        for (let k = 0; k * 10 < W; k++)
          for (const r of [0, 1]) {
            g.fillStyle = (k + r) % 2 ? c.ink : c.cell;
            g.fillRect(k * 10, fy - 10 + r * 5, 10, 5);
          }
        g.fillStyle = c.ink;
        g.fillRect(20, fy - 46, 2.5, 36);
        g.fillStyle = c.good;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.6;
        g.beginPath();
        g.moveTo(22.5, fy - 46);
        g.lineTo(44 + Math.sin(arena.time * 6) * 2, fy - 40);
        g.lineTo(22.5, fy - 33);
        g.closePath();
        g.fill();
        g.stroke();
      }

      for (const p of s.plats) if (!p.gone) drawPlat(g, p);
      // Halves of crumbled platforms, tumbling down.
      for (const b of broken) {
        const t = arena.time - b.t;
        const y = sy(b.p.alt) + 120 * t * t + 40 * t;
        g.globalAlpha = Math.max(0, 1 - t * 1.6);
        for (const k of [-1, 1])
          wrapped(b.p.x, b.p.w / 2, (x) => {
            g.save();
            g.translate(x + k * (b.p.w / 4 + t * 18), y);
            g.rotate(k * t * 2.5);
            arena.box(g, -b.p.w / 4, 0, b.p.w / 2 - 1, PLAT_H, c.cellAlt, 2, false);
            g.restore();
          });
        g.globalAlpha = 1;
      }

      for (const coin of s.coins) {
        const y = sy(coin.alt) + Math.sin(arena.time * 3 + coin.alt) * 1.5;
        if (coin.taken || y < -12 || y > H + 12) continue;
        if (coin.gem) wrapped(coin.x, GEM_R, (x) => arena.gem(g, x, y, GEM_R, c.p[7], (gg, r) => glyphPath(gg, 1, 0, 0, r), true, 1, 0));
        else {
          const spin = Math.abs(Math.cos(arena.time * 4 + coin.alt * 0.05));
          wrapped(coin.x, COIN_R, (x) => {
            g.fillStyle = c.p[3];
            g.strokeStyle = c.ink;
            g.lineWidth = arena.lw * 0.7;
            g.beginPath();
            g.ellipse(x, y, COIN_R * (0.3 + 0.7 * spin), COIN_R, 0, 0, Math.PI * 2);
            g.fill();
            g.stroke();
          });
        }
      }
      for (const k of s.critters) {
        const y = sy(k.alt);
        if (!k.dead && y > -20 && y < H + 20) wrapped(k.x, CRIT_R + 5, (x) => drawCritter(g, x, y));
      }
      if (!ended || s.won) drawHopper(g);

      // Climb so far, up the right side, with a little flag at the top.
      const top = 30;
      const bottom = H - 30;
      const bx = W - 12;
      arena.box(g, bx, top, 6, bottom - top, c.cellAlt, 3, false);
      const fill = (bottom - top) * progress(s);
      g.fillStyle = c.accent;
      g.beginPath();
      g.roundRect(bx, bottom - fill, 6, fill, 3);
      g.fill();
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.roundRect(bx, top, 6, bottom - top, 3);
      g.stroke();
      g.fillStyle = c.good;
      g.beginPath();
      g.moveTo(bx + 3, top - 4);
      g.lineTo(bx + 3, top - 18);
      g.lineTo(bx - 7, top - 13);
      g.closePath();
      g.fill();
      g.stroke();
      arena.overlay(g);
    }

    const dirOf = (e: PointerEvent): -1 | 1 => (arena.toWorld(e).x < W / 2 ? -1 : 1);
    const onDown = (e: PointerEvent) => {
      if (pointerId !== -1) return;
      pointerId = e.pointerId;
      arena.canvas.setPointerCapture?.(e.pointerId);
      pointerDir = dirOf(e);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === pointerId) pointerDir = dirOf(e);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = -1;
      pointerDir = 0;
    };
    arena.canvas.addEventListener('pointerdown', onDown);
    arena.canvas.addEventListener('pointermove', onMove);
    arena.canvas.addEventListener('pointerup', onUp);
    arena.canvas.addEventListener('pointercancel', onUp);

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const keys = (keyR ? 1 : 0) - (keyL ? 1 : 0);
        s.dir = (keys || pointerDir) as -1 | 0 | 1;
        const score = s.score;
        const ev = step(s, dt);
        arena.update(dt);
        squash = Math.max(0, squash - dt * 6);
        while (broken.length && arena.time - broken[0].t > 0.8) broken.shift();
        const c = arena.colors;
        const hx = s.x;
        const hy = sy(s.alt);
        if (ev.landed) {
          squash = 1;
          if (!ev.spring) sfx('jump', { vol: 0.5 });
          const ly = sy(ev.landed.alt);
          fx.burst(hx, ly, c.muted, 6, 70, 2.5, 0.35, 'dot', 60, Math.PI, Math.PI * 0.35);
          fx.burst(hx, ly, c.muted, 6, 70, 2.5, 0.35, 'dot', 60, 0, Math.PI * 0.35);
        }
        if (ev.spring) {
          sfx('power', { vol: 0.7 });
          fx.ring(hx, hy, c.p[6], 6, 34, 0.4, arena.lw * 1.4);
          fx.text(hx, hy - 30, L('Boing!', 'Boing!'), c.p[6], 13);
          fx.burst(hx, hy, arena.tone(c.p[6]).hi, 8, 120, 2.5, 0.4, 'spark', 0, -Math.PI / 2, Math.PI * 0.6);
        }
        if (ev.crumbled) {
          sfx('pop', { pitch: -4 });
          broken.push({ p: ev.crumbled, t: arena.time });
          fx.burst(ev.crumbled.x, sy(ev.crumbled.alt) + PLAT_H / 2, c.muted, 12, 90, 3, 0.6, 'square', 400);
        }
        for (const coin of ev.taken) {
          const cy = sy(coin.alt);
          const fill = coin.gem ? c.p[7] : c.p[3];
          sfx('coin', { pitch: coin.gem ? 7 : 0 });
          fx.burst(coin.x, cy, fill, coin.gem ? 14 : 6, coin.gem ? 120 : 70, 2.5, 0.4, 'spark', 0);
          fx.ring(coin.x, cy, fill, 3, coin.gem ? 26 : 14, 0.3, arena.lw);
          fx.text(coin.x, cy - 10, `+${coin.gem ? GEM_POINTS : COIN_POINTS}`, coin.gem ? c.p[7] : c.fg, coin.gem ? 14 : 11);
        }
        if (ev.stomped) {
          sfx('hit');
          haptic(20);
          const ky = sy(ev.stomped.alt);
          fx.burst(ev.stomped.x, ky, c.bad, 14, 130, 3.5, 0.55);
          fx.ring(ev.stomped.x, ky, c.bad, 4, 28, 0.35, arena.lw * 1.2);
          fx.text(ev.stomped.x, ky - 14, `+${STOMP_POINTS}`, c.accent, 13);
          fx.shake(2.5, 0.2);
        }
        if (ev.hurt) {
          ctx.lives(s.lives, LIVES);
          fx.shake(6, 0.4);
          fx.flash(c.bad, 0.3, 0.4);
          if (ev.hurt === 'bump') fx.burst(hx, hy, c.bad, 12, 140, 3, 0.5);
          else fx.burst(hx, H - 4, c.bad, 12, 160, 3.5, 0.5, 'square', 300, -Math.PI / 2, Math.PI * 0.7);
          if (!ev.over) fx.ring(s.x, sy(s.alt) - PH / 2, c.accent, 4, 30, 0.45, arena.lw * 1.2);
        }
        if (ev.won) {
          ended = true;
          const y = sy(s.goal);
          for (let i = 0; i < 5; i++) fx.burst(W / 2 + (i - 2) * 50, y, c.p[i + 2], 10, 180, 4, 0.9, 'square', 220);
          fx.ring(hx, hy - PH / 2, c.good, 6, 90, 0.6, arena.lw * 1.5);
          fx.flash(c.good, 0.25, 0.5);
          if (s.bonus) fx.text(W / 2, H / 2, `+${s.bonus}`, c.accent, 18, 1.2);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          arena.linger();
        }
        if (s.score !== score) ctx.score(s.score);
        status();
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const down = e.type === 'keydown';
        if (k === 'arrowleft' || k === 'a') keyL = down;
        else if (k === 'arrowright' || k === 'd') keyR = down;
        else return false;
        return true;
      },
      destroy() {
        arena.canvas.removeEventListener('pointerdown', onDown);
        arena.canvas.removeEventListener('pointermove', onMove);
        arena.canvas.removeEventListener('pointerup', onUp);
        arena.canvas.removeEventListener('pointercancel', onUp);
        arena.destroy();
      },
    };
  },
};
