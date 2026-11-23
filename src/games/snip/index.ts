import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena, type Trace } from '../../kits/arena/arena';
import { gestures, type Point } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  BUBBLE_R,
  createLevel,
  CRIT_Y,
  DELIVER_PTS,
  H,
  LINKS,
  pop,
  popAt,
  type Rope,
  SPEED_PTS,
  SPIKE_R,
  STAR_PTS,
  STAR_R,
  step,
  swipe,
  cut,
  SWEET_R,
  W,
} from './rules';

const star: Trace = (g, r) => glyphPath(g, 4, 0, 0, r);
const spiky: Trace = (g, r) => {
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const rr = i % 2 ? r * 0.58 : r;
    if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else g.moveTo(rr, 0);
  }
  g.closePath();
};
const blob: Trace = (g, r) => {
  g.beginPath();
  g.ellipse(0, 0, r * 1.12, r * 0.95, 0, 0, Math.PI * 2);
};

export const snip: GameDef = {
  id: 'snip',
  get name() {
    return L('Snip', 'Coupez');
  },
  get rules() {
    return L('Cut the ropes to feed the sweet to the critter.', 'Coupez les cordes pour nourrir la bestiole.');
  },
  category: 'aim',
  help: () => ({
    goal: L(
      'Cut the ropes so the sweet drops into the critter’s mouth, grabbing the stars on the way.',
      'Coupez les cordes pour que le bonbon tombe dans la bouche de la bestiole, en attrapant les étoiles au passage.',
    ),
    steps: [
      L(
        'The sweet hangs from ropes: it swings once one is cut, and falls when none are left.',
        'Le bonbon pend au bout de cordes : il se balance dès qu’on en coupe une et tombe quand il n’en reste plus.',
      ),
      L(
        'Cut in the right order, at the right moment: the stars trace the way.',
        'Coupez dans le bon ordre, au bon moment : les étoiles tracent le chemin.',
      ),
      L(
        'A bubble carries the sweet up until you pop it. Spikes destroy it.',
        'Une bulle fait monter le bonbon jusqu’à ce que vous la creviez. Les pics le détruisent.',
      ),
      L('If the sweet leaves the field, the level is lost.', 'Si le bonbon sort du terrain, la partie est perdue.'),
      L(
        'Swipe across ropes to cut them; tap a bubble to pop it.',
        'Glissez à travers les cordes pour les couper; touchez une bulle pour la crever.',
      ),
      L(
        'Keyboard: 1 to 4 cut the numbered ropes, Space pops the bubble, P to pause.',
        'Clavier : 1 à 4 coupent les cordes numérotées, Espace crève la bulle, P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Each star is worth ${STAR_PTS} points, the delivery ${DELIVER_PTS}, and a quick clear up to ${SPEED_PTS} more.`,
        `Chaque étoile vaut ${STAR_PTS} points, la livraison ${DELIVER_PTS}, et une réussite rapide jusqu’à ${SPEED_PTS} de plus.`,
      ),
      L(
        'Nothing moves before your first cut: take a moment to read the level.',
        'Rien ne bouge avant votre première coupe : prenez le temps de lire le niveau.',
      ),
      L(
        'Cut as the sweet swings towards the critter: it keeps its momentum.',
        'Coupez quand le bonbon file vers la bestiole : il garde son élan.',
      ),
    ],
  }),
  stars: () => [2 * STAR_PTS + DELIVER_PTS, 3 * STAR_PTS + DELIVER_PTS + 20],
  par: (d) => byLevel(d, [8, 10, 12, 12, 15]),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    /** Swipe trail: recent pointer points with their age. */
    let trail: (Point & { t: number })[] = [];
    let last: Point | null = null;
    /** Sweet spin (radians), critter chomp (1 → 0) and its mood after the run. */
    let spin = 0;
    let chomp = 0;
    let ended = false;

    const left = () => s.ropes.filter((r) => !r.cut).length;
    const status = () =>
      ctx.status(
        [
          `${L('Stars', 'Étoiles')} ${s.got}/${s.stars.length}`,
          P(left(), ['rope left', 'ropes left'], ['corde restante', 'cordes restantes']),
          s.bubble?.held && !s.bubble.popped ? L('tap the bubble', 'touchez la bulle') : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );

    function chain(g: CanvasRenderingContext2D, r: Rope, from: number, to: number) {
      if (to <= from) return;
      g.beginPath();
      g.moveTo(r.nx[from], r.ny[from]);
      for (let i = from + 1; i < to; i++) g.quadraticCurveTo(r.nx[i], r.ny[i], (r.nx[i] + r.nx[i + 1]) / 2, (r.ny[i] + r.ny[i + 1]) / 2);
      g.lineTo(r.nx[to], r.ny[to]);
    }

    function drawRopes(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const twist = arena.tone(c.p[0]);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const r of s.ropes) {
        const parts: [number, number][] = r.cut
          ? [
              [0, r.seg],
              [r.seg + 1, LINKS],
            ]
          : [[0, LINKS]];
        for (const [a, b] of parts) {
          chain(g, r, a, b);
          g.strokeStyle = c.ink;
          g.lineWidth = 3.6;
          g.stroke();
          g.strokeStyle = twist.hi;
          g.lineWidth = 1.8;
          g.setLineDash([3, 3]);
          g.stroke();
          g.setLineDash([]);
        }
      }
      g.lineCap = 'butt';
    }

    function drawSweet(g: CanvasRenderingContext2D, x: number, y: number) {
      const c = arena.colors;
      const t = arena.tone(c.accent);
      g.save();
      g.translate(x, y);
      g.rotate(spin);
      // Wrapper twists on both sides.
      g.fillStyle = t.hi;
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.6;
      for (const k of [-1, 1]) {
        g.beginPath();
        g.moveTo(k * (SWEET_R - 2), 0);
        g.lineTo(k * (SWEET_R + 7), -6);
        g.lineTo(k * (SWEET_R + 5), 0);
        g.lineTo(k * (SWEET_R + 7), 6);
        g.closePath();
        g.fill();
        g.stroke();
      }
      arena.ball(g, 0, 0, SWEET_R, c.accent);
      g.strokeStyle = t.hi;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(1, 1, SWEET_R * 0.5, 0.4, Math.PI * 1.5);
      g.stroke();
      g.restore();
    }

    function drawBubble(g: CanvasRenderingContext2D, x: number, y: number) {
      const c = arena.colors;
      const t = arena.tone(c.p[5]);
      g.fillStyle = t.glow;
      g.strokeStyle = t.base;
      g.lineWidth = arena.lw * 0.7;
      g.beginPath();
      g.arc(x, y, BUBBLE_R, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.strokeStyle = c.paper;
      g.globalAlpha = 0.75;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, BUBBLE_R * 0.7, Math.PI * 1.1, Math.PI * 1.45);
      g.stroke();
      g.globalAlpha = 1;
    }

    function drawCritter(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const m = s.critter;
      if (!m) return;
      const near = s.phase === 'play' ? Math.hypot(s.x - m.x, s.y - m.y) : 999;
      const open = s.ropes.every((r) => r.cut) ? Math.max(0, Math.min(1, 1 - (near - 40) / 140)) : 0;
      const bob = Math.sin(arena.time * 3) * 1.2 - chomp * 4;
      const cx = m.x;
      const cy = CRIT_Y + 20 + bob;
      arena.box(g, cx - 32, CRIT_Y + 40, 64, 10, c.cellAlt, 3);
      // Antennae, then the body.
      g.strokeStyle = c.ink;
      g.lineWidth = 2;
      for (const k of [-1, 1]) {
        const tx = cx + k * 14 + Math.sin(arena.time * 4 + k) * 1.5;
        g.beginPath();
        g.moveTo(cx + k * 6, cy - 18);
        g.quadraticCurveTo(cx + k * 8, cy - 30, tx, cy - 32);
        g.stroke();
        arena.disc(g, tx, cy - 32, 3, c.p[2]);
      }
      arena.gem(g, cx, cy, 24, c.p[2], blob, true, 1 + chomp * 0.08);
      // Eyes that follow the sweet.
      const dx = s.x - cx;
      const dy = s.y - (cy - 8);
      const dl = Math.hypot(dx, dy) || 1;
      for (const k of [-1, 1]) {
        const ex = cx + k * 9;
        const ey = cy - 9;
        arena.disc(g, ex, ey, 5.5, c.paper);
        if (s.phase === 'lost') {
          g.strokeStyle = c.coal;
          g.lineWidth = 1.6;
          g.beginPath();
          g.moveTo(ex - 3, ey - 2 + k);
          g.lineTo(ex + 3, ey - 2 - k);
          g.stroke();
        }
        g.fillStyle = c.coal;
        g.beginPath();
        g.arc(ex + (dx / dl) * 2, ey + (dy / dl) * 2, 2.4, 0, Math.PI * 2);
        g.fill();
      }
      // Mouth: opens as the sweet comes, chews after a catch, frowns after a loss.
      g.fillStyle = c.coal;
      g.strokeStyle = c.coal;
      g.lineWidth = 2;
      g.beginPath();
      if (s.phase === 'lost') {
        g.arc(cx, cy + 9, 6, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke();
      } else if (s.phase === 'won') {
        g.arc(cx, cy + 2, 7, 0.2, Math.PI - 0.2);
        g.stroke();
      } else {
        g.ellipse(cx, cy + 4, 6 + open * 6, 2 + open * 8, 0, 0, Math.PI * 2);
        g.fill();
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);
      drawRopes(g);
      // Anchors, numbered for the keyboard.
      g.font = `700 9px ${arena.family}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [i, r] of s.ropes.entries()) {
        arena.disc(g, r.ax, r.ay, 5, r.cut ? c.cellAlt : c.cell);
        g.fillStyle = c.ink;
        g.beginPath();
        g.arc(r.ax, r.ay, 1.6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = r.cut ? c.muted : c.fg;
        g.fillText(String(i + 1), r.ax + (r.ax < W - 20 ? 11 : -11), r.ay - 7);
      }
      for (const st of s.stars) {
        if (st.got) continue;
        const k = 1 + Math.sin(arena.time * 4 + st.x) * 0.08;
        arena.gem(g, st.x, st.y, STAR_R + 1, c.p[3], star, true, k, Math.sin(arena.time * 2 + st.y) * 0.2);
      }
      for (const sp of s.spikes) arena.gem(g, sp.x, sp.y, SPIKE_R + 2, c.bad, spiky, true, 1, arena.time * 0.8);
      const b = s.bubble;
      if (b && !b.popped && !b.held) drawBubble(g, b.x, b.y + Math.sin(arena.time * 2) * 2);
      drawCritter(g);
      if (s.phase !== 'won' && s.why !== 'spike') drawSweet(g, s.x, s.y);
      if (b && !b.popped && b.held) drawBubble(g, s.x, s.y);
      // Swipe trail.
      if (trail.length > 1) {
        g.strokeStyle = c.fg;
        g.lineCap = 'round';
        for (let i = 1; i < trail.length; i++) {
          const f = 1 - trail[i].t / 0.2;
          g.globalAlpha = Math.max(0, f) * 0.8;
          g.lineWidth = 1 + f * 3;
          g.beginPath();
          g.moveTo(trail[i - 1].x, trail[i - 1].y);
          g.lineTo(trail[i].x, trail[i].y);
          g.stroke();
        }
        g.globalAlpha = 1;
        g.lineCap = 'butt';
      }
      arena.overlay(g);
    }

    function snipped(i: number, x: number, y: number) {
      sfx('cut');
      const c = arena.colors;
      fx.burst(x, y, arena.tone(c.p[0]).hi, 8, 90, 2.5, 0.4, 'spark', 0);
      fx.burst(x, y, c.ink, 4, 60, 2, 0.4, 'square', 300);
      fx.ring(x, y, c.fg, 2, 14, 0.25, arena.lw * 0.8);
      fx.shake(1, 0.1);
      if (i >= 0) status();
    }
    const cutKey = (i: number) => {
      if (ended || !cut(s, i)) return;
      const r = s.ropes[i];
      snipped(i, r.nx[r.seg], r.ny[r.seg]);
    };
    const popped = () => {
      sfx('pop');
      const c = arena.colors;
      const b = s.bubble;
      if (!b) return;
      fx.burst(b.x, b.y, arena.tone(c.p[5]).hi, 12, 120, 2.5, 0.4, 'dot', 0);
      fx.ring(b.x, b.y, c.p[5], BUBBLE_R * 0.6, BUBBLE_R * 1.6, 0.3, arena.lw);
      status();
    };

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onDown: (p) => {
        last = p;
        trail.push({ ...p, t: 0 });
      },
      onMove: (p, from) => {
        if (!from || !last || ended) return;
        for (const hit of swipe(s, last.x, last.y, p.x, p.y)) snipped(hit.rope, hit.x, hit.y);
        last = p;
        trail.push({ ...p, t: 0 });
      },
      onTap: (p) => {
        last = null;
        if (!ended && popAt(s, p.x, p.y)) popped();
      },
      onRelease: () => {
        last = null;
      },
    });

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        for (const p of trail) p.t += dt;
        trail = trail.filter((p) => p.t < 0.2);
        spin += Math.max(-0.3, Math.min(0.3, (s.x - s.ox) * 0.08));
        chomp = Math.max(0, chomp - dt * 2.5);
        for (const [k, i] of ev.stars.entries()) {
          sfx('coin', { step: s.got - ev.stars.length + k + 1 });
          const st = s.stars[i];
          fx.burst(st.x, st.y, c.p[3], 14, 140, 3, 0.6, 'spark', 0);
          fx.ring(st.x, st.y, c.p[3], 4, 26, 0.35, arena.lw);
          fx.text(st.x, st.y - 12, `+${STAR_PTS}`, c.p[3], 13);
          fx.shake(1.5, 0.12);
        }
        if (ev.stars.length) {
          ctx.score(s.score);
          status();
        }
        if (ev.captured) {
          sfx('pop', { pitch: 4 });
          fx.ring(s.x, s.y, c.p[5], SWEET_R, BUBBLE_R * 1.4, 0.35, arena.lw);
          status();
        }
        if (ev.won && s.critter) {
          sfx('pop', { pitch: -5 }); // the chomp; the card plays the win jingle
          ended = true;
          chomp = 1;
          const m = s.critter;
          for (let i = 0; i < 5; i++) fx.burst(m.x, m.y, c.p[i], 8, 170, 3.5, 0.9, 'square', 260, -Math.PI / 2, Math.PI);
          fx.ring(m.x, m.y + 10, c.accent, 8, 70, 0.5, arena.lw * 1.5);
          fx.text(m.x, m.y - 26, `+${s.score - s.got * STAR_PTS}`, c.accent, 15, 1.1);
          fx.flash(c.good, 0.22, 0.45);
          ctx.score(s.score);
          arena.linger(1.5);
        } else if (ev.lost) {
          ended = true;
          if (s.why === 'spike') {
            sfx('boom');
            haptic(30);
            fx.burst(s.x, s.y, c.accent, 18, 160, 3.5, 0.7, 'square', 300);
            fx.burst(s.x, s.y, arena.tone(c.accent).hi, 8, 120, 2.5, 0.5, 'dot', 200);
            fx.shake(6, 0.35);
          } else fx.shake(4, 0.3);
          fx.flash(c.bad, 0.3, 0.4);
          arena.linger(1.4);
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.lost) ctx.lose();
      },
      onKey(e) {
        const k = e.key;
        if (k >= '1' && k <= '4') {
          if (e.type === 'keydown' && !e.repeat) cutKey(Number(k) - 1);
          return true;
        }
        if (k === ' ') {
          if (e.type === 'keydown' && !e.repeat && !ended && pop(s)) popped();
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
