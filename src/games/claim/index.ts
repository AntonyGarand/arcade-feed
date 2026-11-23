import './style.css';
import { L } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { DX, DY, gestures, keyDir } from '../../kits/gesture/gesture';
import { sfx } from '../../kits/sound/sound';
import { glyphPath } from '../../kits/glyph/glyph';
import {
  CLAIMED,
  COLS,
  createLevel,
  goalFor,
  LIFE_BONUS,
  LIVES,
  MARKER_SPEED,
  OVER_POINTS,
  parFor,
  percent,
  ROWS,
  starGoals,
  step,
  stop,
  TIME_POINTS,
  turn,
  WALL,
} from './rules';

const CELL = 5;
const W = COLS * CELL;
const H = ROWS * CELL;

export const claim: GameDef = {
  id: 'claim',
  get name() {
    return L('Claim', 'Territoire');
  },
  get rules() {
    return L('Fence off the field, away from the sparks.', 'Clôturez le terrain, loin des étincelles.');
  },
  category: 'reflex',
  help: () => ({
    goal: L(
      'Claim the share of the field shown before you run out of lives.',
      'Conquérez la part du terrain demandée avant de manquer de vies.',
    ),
    steps: [
      L(
        'Leave the claimed edge to draw a line across the open field; reach claimed ground again to close it.',
        'Quittez le bord conquis pour tracer une ligne dans le terrain libre; rejoignez un terrain conquis pour la fermer.',
      ),
      L(
        'Closing a line claims every part of the field that has no spark in it.',
        'Fermer une ligne conquiert chaque partie du terrain où il n’y a pas d’étincelle.',
      ),
      L(
        'A spark touching your line or your marker, or a crawler catching you on the edge, costs a life and erases the line.',
        'Une étincelle qui touche votre ligne ou votre marqueur, ou un rôdeur qui vous attrape sur le bord, coûte une vie et efface la ligne.',
      ),
      L(
        'Swipe to move: the marker keeps going while it draws and stops on the edge. Tap to stop on the edge.',
        'Balayez pour bouger : le marqueur continue tant qu’il trace et s’arrête sur le bord. Touchez pour l’arrêter sur le bord.',
      ),
      L(
        'Keyboard: arrows or WASD (hold to run along the edge), P to pause.',
        'Clavier : flèches ou WASD (maintenez pour longer le bord), P pour la pause.',
      ),
    ],
    tips: [
      L(
        `Bigger captures pay more per percent. Each life left adds ${LIFE_BONUS}, each second under par ${TIME_POINTS}, each percent beyond the goal ${OVER_POINTS}.`,
        `Les grosses prises rapportent plus par pour cent. Chaque vie restante ajoute ${LIFE_BONUS}, chaque seconde sous la normale ${TIME_POINTS}, chaque pour cent au-delà de l’objectif ${OVER_POINTS}.`,
      ),
      L(
        'Quick bites near the edge are safest. Shut a spark in a small pocket to claim the rest at once.',
        'Les petites bouchées rapides près du bord sont les plus sûres. Enfermez une étincelle dans une petite poche pour conquérir le reste d’un coup.',
      ),
    ],
  }),
  stars: (d) => starGoals(d),
  par: (d) => parFor(d),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const rng = ctx.rng;
    // The picture the claimed ground reveals: rings around a seeded centre and a few big blobs.
    const art = {
      x: rng.int(40, W - 40),
      y: rng.int(60, H - 60),
      blobs: Array.from({ length: 4 }, () => ({ x: rng.int(0, W), y: rng.int(0, H), r: rng.int(30, 70), k: rng.pick([0, 1, 2, 3, 6, 7]) })),
    };
    /** When each cell shows as claimed (arena time): a capture spreads out from where the line closed. */
    const born = new Float32Array(COLS * ROWS).fill(-1);
    let reveal: number[] = [];
    let revealUntil = -1;
    let paths: { wall: Path2D; claimed: Path2D; edges: Path2D } | null = null;
    /** Marker and crawler glide between cells: the cell they came from and when. */
    let prevPos = s.pos;
    let moveAt = -1;
    const crawlPrev = s.crawlers.map((c) => c.pos);
    const crawlAt = s.crawlers.map(() => -1);
    /** An erased line fading out after a hit. */
    let ghost: number[] = [];
    let ghostAt = -10;
    let sparkPuff = 0;
    let ended = false;

    const status = () => {
      const pct = Math.floor(percent(s));
      ctx.status([L(`${pct}% claimed`, `${pct} % conquis`), L(`goal ${goalFor(s.d)}%`, `objectif ${goalFor(s.d)} %`)].join(' · '));
    };

    const cx = (i: number) => (i % COLS) * CELL + CELL / 2;
    const cy = (i: number) => Math.floor(i / COLS) * CELL + CELL / 2;
    const glide = (from: number, to: number, at: number, speed: number) => {
      const f = Math.min(1, Math.max(0, (arena.time - at) * speed));
      return [cx(from) + (cx(to) - cx(from)) * f, cy(from) + (cy(to) - cy(from)) * f];
    };

    /** Claimed and wall areas as row runs, plus their outline; cells still waiting to be revealed are left out. */
    function buildPaths() {
      const wall = new Path2D();
      const claimed = new Path2D();
      const edges = new Path2D();
      const now = arena.time;
      const shown = (c: number, r: number) => {
        const i = r * COLS + c;
        const v = s.grid[i];
        return v === WALL || (v === CLAIMED && born[i] <= now);
      };
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS;) {
          const v = s.grid[r * COLS + c];
          const kind = v === WALL ? 1 : shown(c, r) ? 2 : 0;
          let e = c + 1;
          while (e < COLS && (s.grid[r * COLS + e] === WALL ? 1 : shown(e, r) ? 2 : 0) === kind) e++;
          if (kind) (kind === 1 ? wall : claimed).rect(c * CELL, r * CELL, (e - c) * CELL, CELL);
          c = e;
        }
        for (let c = 0; c < COLS; c++) {
          if (!shown(c, r)) continue;
          for (let d = 0; d < 4; d++) {
            const nc = c + DX[d];
            const nr = r + DY[d];
            if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || shown(nc, nr)) continue;
            const x = c * CELL + (DX[d] > 0 ? CELL : 0);
            const y = r * CELL + (DY[d] > 0 ? CELL : 0);
            edges.moveTo(x, y);
            edges.lineTo(x + (DY[d] ? CELL : 0), y + (DX[d] ? CELL : 0));
          }
        }
      }
      return { wall, claimed, edges };
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const now = arena.time;
      if (!paths || now < revealUntil) paths = buildPaths();
      arena.field(g, 0, 0, W, H, 20, 0, false);

      // Starting ground: a muted surface with fine stripes.
      const wallFill = mix(c.muted, c.cell, arena.dark ? 0.55 : 0.4);
      g.save();
      g.clip(paths.wall);
      g.fillStyle = wallFill;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = arena.tone(wallFill).lo;
      g.lineWidth = 1;
      g.beginPath();
      for (let k = -H; k < W; k += 6) {
        g.moveTo(k, H);
        g.lineTo(k + H, 0);
      }
      g.stroke();
      g.restore();

      // Claimed ground reveals the picture.
      const t = arena.tone(c.accent);
      g.save();
      g.clip(paths.claimed);
      g.fillStyle = c.accent;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = t.hi;
      g.lineWidth = 7;
      g.globalAlpha = 0.4;
      g.beginPath();
      for (let r = 10; r < 440; r += 22) {
        g.moveTo(art.x + r, art.y);
        g.arc(art.x, art.y, r, 0, Math.PI * 2);
      }
      g.stroke();
      g.globalAlpha = 0.45;
      for (const b of art.blobs) {
        g.fillStyle = c.p[b.k];
        g.beginPath();
        g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.restore();
      // A shimmer over freshly claimed cells.
      if (now < revealUntil) {
        g.fillStyle = c.paper;
        for (const i of reveal) {
          const f = (now - born[i]) / 0.3;
          if (f < 0 || f >= 1) continue;
          g.globalAlpha = 0.7 * (1 - f);
          g.fillRect((i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL);
        }
        g.globalAlpha = 1;
      }
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.7;
      g.stroke(paths.edges);

      const [mx, my] = glide(prevPos, s.pos, moveAt, MARKER_SPEED);
      // The erased line, fading out in red.
      if (now - ghostAt < 0.5 && ghost.length) {
        g.globalAlpha = 1 - (now - ghostAt) / 0.5;
        g.strokeStyle = c.bad;
        g.lineWidth = CELL * 0.6;
        g.lineJoin = 'round';
        g.beginPath();
        ghost.forEach((i, k) => (k ? g.lineTo(cx(i), cy(i)) : g.moveTo(cx(i), cy(i))));
        g.stroke();
        g.globalAlpha = 1;
      }
      // The line being drawn: a glow, then a solid stroke.
      if (s.drawing) {
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx(s.start), cy(s.start));
        for (const i of s.trail.slice(0, -1)) g.lineTo(cx(i), cy(i));
        g.lineTo(mx, my);
        g.strokeStyle = t.glow;
        g.lineWidth = CELL * 1.3;
        g.stroke();
        g.strokeStyle = c.fg;
        g.lineWidth = CELL * 0.45;
        g.stroke();
        g.lineCap = 'butt';
      }

      // Crawlers: round critters with eyes looking ahead, scuttling along the edge.
      s.crawlers.forEach((cr, k) => {
        const [gx, gy] = glide(crawlPrev[k], cr.pos, crawlAt[k], s.crawlSpeed);
        // Drawn around the origin at 1.4× so it reads on a phone.
        g.save();
        g.translate(gx, gy);
        g.scale(1.4, 1.4);
        const x = 0;
        const y = 0;
        const fill = c.p[0];
        const wob = Math.sin(now * 18 + k) * 0.6;
        g.strokeStyle = arena.tone(fill).edge;
        g.lineWidth = 1;
        g.beginPath();
        for (const side of [-1, 1]) {
          g.moveTo(x - 4.5, y + side * (2 + wob));
          g.lineTo(x + 4.5, y - side * (2 - wob));
        }
        g.stroke();
        arena.ball(g, x, y, 3.8, fill);
        const dx = DX[cr.dir];
        const dy = DY[cr.dir];
        for (const side of [-1, 1]) {
          const ex = x + dx * 1.4 - dy * side * 1.5;
          const ey = y + dy * 1.4 + dx * side * 1.5;
          g.fillStyle = c.paper;
          g.beginPath();
          g.arc(ex, ey, 1.2, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = c.coal;
          g.beginPath();
          g.arc(ex + dx * 0.5, ey + dy * 0.5, 0.6, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      });

      // Sparks: spinning stars with a pulsing glow.
      for (const k of s.sparks) {
        const x = k.x * CELL;
        const y = k.y * CELL;
        g.fillStyle = arena.tone(c.bad).glow;
        g.beginPath();
        g.arc(x, y, 10 + Math.sin(now * 9) * 1.6, 0, Math.PI * 2);
        g.fill();
        arena.gem(g, x, y, 7, c.bad, (gg, r) => glyphPath(gg, 4, 0, 0, r), true, 1, now * 5);
      }

      // Marker: a diamond, with a pulse while drawing; it blinks while safe after a hit.
      if (!(s.safe > 0 && Math.floor(now * 10) % 2)) {
        if (s.drawing) {
          g.strokeStyle = t.edge;
          g.lineWidth = 1;
          g.globalAlpha = 0.6;
          g.beginPath();
          g.arc(mx, my, 9 + ((now * 3) % 1) * 5, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }
        arena.gem(g, mx, my, 6.5, c.paper, (gg, r) => glyphPath(gg, 1, 0, 0, r));
      }
      arena.overlay(g);
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CELL * 2.5,
      repeat: true,
      onSwipe: (dir) => turn(s, dir),
      onTap: () => stop(s),
    });

    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const c = arena.colors;
        const pos = s.pos;
        const crawl = s.crawlers.map((cr) => cr.pos);
        const trail = s.trail;
        const start = s.start;
        const ev = step(s, dt);
        arena.update(dt);
        const now = arena.time;
        if (s.pos !== pos) {
          const near = Math.abs((s.pos % COLS) - (pos % COLS)) + Math.abs(Math.floor(s.pos / COLS) - Math.floor(pos / COLS)) === 1;
          prevPos = near ? pos : s.pos;
          moveAt = now;
          if (!near && !ev.lostLife) fx.ring(cx(s.pos), cy(s.pos), c.fg, 2, 12, 0.35, arena.lw);
        }
        s.crawlers.forEach((cr, k) => {
          if (cr.pos !== crawl[k]) {
            crawlPrev[k] = crawl[k];
            crawlAt[k] = now;
          }
        });
        if (ev.started) {
          sfx('tick');
          fx.burst(cx(s.start), cy(s.start), c.fg, 5, 60, 2, 0.3, 'dot', 0);
        }
        if (ev.fresh.length) {
          // Spread the reveal out from where the line closed.
          const ox = s.pos % COLS;
          const oy = Math.floor(s.pos / COLS);
          let sx = 0;
          let sy = 0;
          let last = now;
          for (const i of ev.fresh) {
            const dist = Math.hypot((i % COLS) - ox, Math.floor(i / COLS) - oy);
            born[i] = now + Math.min(0.45, dist * 0.008);
            last = Math.max(last, born[i]);
            sx += cx(i);
            sy += cy(i);
          }
          reveal = ev.fresh;
          revealUntil = last + 0.3;
          const x = sx / ev.fresh.length;
          const y = sy / ev.fresh.length;
          const big = ev.pct >= 10;
          if (big) sfx('power');
          else sfx('pop', { pitch: Math.min(6, Math.floor(ev.pct / 2)) });
          for (let k = 0; k < trail.length; k += 4) fx.burst(cx(trail[k]), cy(trail[k]), c.paper, 2, 50, 2, 0.35, 'dot', 0);
          fx.burst(x, y, c.accent, big ? 24 : 12, big ? 170 : 110, 3.5, 0.6);
          fx.burst(x, y, arena.tone(c.accent).hi, 8, 90, 2.5, 0.5, 'dot');
          fx.ring(x, y, c.accent, 4, big ? 70 : 30, 0.45, arena.lw * 1.2);
          fx.text(x, y - 6, `+${ev.gain}`, big ? c.accent : c.fg, big ? 15 : 12);
          fx.text(x, y + 10, `${ev.pct.toFixed(1)} %`, c.fg, 9, 0.9);
          if (big) {
            fx.shake(3, 0.25);
            fx.flash(c.accent, 0.18, 0.35);
          }
          ctx.score(s.score);
          status();
          paths = null;
        }
        if (ev.lostLife) {
          ghost = [start, ...trail];
          ghostAt = now;
          ctx.lives(s.lives, LIVES);
          fx.shake(5, 0.35);
          fx.flash(c.bad, 0.3, 0.35);
          fx.burst(cx(ev.hitAt), cy(ev.hitAt), c.bad, 14, 130, 3, 0.5, 'spark', 0);
          fx.ring(cx(ev.hitAt), cy(ev.hitAt), c.bad, 3, 26, 0.4, arena.lw);
        }
        if ((sparkPuff -= dt) <= 0) {
          sparkPuff = 0.09;
          for (const k of s.sparks) fx.burst(k.x * CELL, k.y * CELL, c.bad, 1, 50, 2, 0.3, 'spark', 0);
        }
        if (ev.won) {
          ended = true;
          for (let k = 0; k < 6; k++) fx.burst(W / 2, H / 2, c.p[k], 10, 210, 4, 0.9, 'square', 200);
          fx.ring(W / 2, H / 2, c.accent, 10, 160, 0.7, arena.lw * 1.5);
          fx.flash(c.good, 0.25, 0.5);
          arena.linger(1.4);
        } else if (ev.over) {
          ended = true;
          arena.linger();
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const dir = keyDir(e.key);
        if (dir === -1) return false;
        if (ended) return true;
        if (e.type === 'keydown') {
          if (!e.repeat || s.dir === -1) turn(s, dir);
        } else if (s.dir === dir) stop(s);
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
