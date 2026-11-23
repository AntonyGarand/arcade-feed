import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { mix } from '../../kits/arena/color';
import { gestures, keyDir, type Point } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { sfx } from '../../kits/sound/sound';
import {
  BRUSH,
  CELL,
  cleanFor,
  COLS,
  createLevel,
  digLine,
  DIRT,
  EMPTY,
  GEM_POINTS,
  H,
  needFor,
  PCT_POINTS,
  ROCK,
  ROWS,
  scoreOf,
  SETTLE_S,
  SLUDGE,
  step,
  W,
  WATER,
} from './rules';

/** Keyboard digger speed (world units per second). */
const KEY_SPEED = 85;
/** A percentage, with the French space. */
const pc = (n: number) => L(`${n}%`, `${n} %`);

const star = (g: CanvasRenderingContext2D, r: number) => glyphPath(g, 4, 0, 0, r);

export const dig: GameDef = {
  id: 'dig',
  get name() {
    return L('Dig', 'Creusez');
  },
  get rules() {
    return L('Dig tunnels to lead the water into the pipe.', 'Creusez des tunnels pour mener l’eau au tuyau.');
  },
  category: 'think',
  help: () => ({
    goal: L(
      'Dig a way for the water down to the pipe, and get at least the target share of it there.',
      'Creusez un passage pour l’eau jusqu’au tuyau, et amenez-y au moins la part visée.',
    ),
    steps: [
      L(
        'Drag through the dirt to dig. Water falls and flows along your tunnels.',
        'Glissez dans la terre pour creuser. L’eau tombe et coule le long de vos tunnels.',
      ),
      L(
        'Rock can’t be dug. Green sludge destroys any water that touches it.',
        'La roche ne se creuse pas. La boue verte détruit toute l’eau qui la touche.',
      ),
      L(
        'Water that reaches a gem collects it: dig a little dip down to each one.',
        'L’eau qui atteint une gemme la récolte : creusez un petit creux jusqu’à chacune.',
      ),
      L(
        `Once the water is flowing, if it stays still for ${SETTLE_S} seconds while you don’t dig, the run ends.`,
        `Une fois que l’eau coule, si elle reste immobile ${SETTLE_S} secondes sans que vous creusiez, la partie se termine.`,
      ),
      L(
        'Keyboard: arrows or WASD move the digger, which digs as it goes; P to pause.',
        'Clavier : les flèches ou WASD déplacent la pelle, qui creuse en avançant; P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Dig from the pipe up towards the water, so it all flows in one go.',
        'Creusez du tuyau vers l’eau, pour qu’elle coule d’un seul coup.',
      ),
      L(
        `${PCT_POINTS} points per percent of the water delivered, ${GEM_POINTS} per gem.`,
        `${PCT_POINTS} points par pourcentage d’eau livrée, ${GEM_POINTS} par gemme.`,
      ),
    ],
  }),
  stars: (d) => [GEM_POINTS + (needFor(d) + 5) * PCT_POINTS, 3 * GEM_POINTS + cleanFor(d) * PCT_POINTS],
  par: (d) => byLevel(d, [25, 30, 35, 45, 55]),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const need = needFor(ctx.difficulty);
    const mouth = { x: (s.drain.x + s.drain.w / 2) * CELL, y: s.drain.y * CELL };
    /** Arena time each gem was collected (-1: not yet). */
    const gotAt = s.gems.map(() => -1);
    let ended = false;
    let shown = '';
    // Terrain (dirt, tunnels, rock, sludge, pipe) is cached and repainted only after a dig.
    let terr: HTMLCanvasElement | null = null;
    let terrKey = '';
    let dirty = true;
    // Input: the pointer's last dig point, the mouse hover, the keyboard digger.
    let last: Point | null = null;
    let hover: Point | null = null;
    const held = [false, false, false, false];
    let kbd = false;
    const cur = { x: mouth.x, y: mouth.y - 3 * CELL };
    let crumbT = 0;
    let splash = 0;
    let splashT = 0;
    let lostT = 0;
    let digT = -1;
    let sludgeT = -1;
    let arrived = false;

    const pct = () => Math.floor((100 * s.delivered) / s.total);
    const status = () => {
      const left = s.gems.filter((g) => !g.got).length;
      const parts = [
        s.dug
          ? L(`water ${pct()}% of ${need}%`, `eau ${pct()} % sur ${need} %`)
          : L(`Dig a way to the pipe · goal ${need}%`, `Creusez un passage jusqu’au tuyau · objectif ${need} %`),
        P(left, ['gem left', 'gems left'], ['gemme restante', 'gemmes restantes']),
      ];
      if (s.released && !s.done && s.delivered < s.need && s.still > 1) parts.push(L('water still: dig!', 'l’eau stagne : creusez!'));
      const t = parts.join(' · ');
      if (t !== shown) ctx.status((shown = t));
    };

    const dirtOf = () => mix(arena.colors.p[0], arena.colors.coal, arena.dark ? 0.5 : 0.38);

    function paintTerrain(t: CanvasRenderingContext2D) {
      const c = arena.colors;
      const dirt = dirtOf();
      const dt = arena.tone(dirt);
      const tunnel = mix(dirt, c.cell, 0.72);
      const rock = mix(c.muted, c.cellAlt, 0.25);
      const rt = arena.tone(rock);
      const st = arena.tone(c.p[7]);
      t.fillStyle = dirt;
      t.fillRect(0, 0, W, H);
      // Specks of grit, from a hash of the cell (visual only).
      const specks = (fill: string, test: (h: number) => boolean) => {
        t.fillStyle = fill;
        t.beginPath();
        for (let i = 0; i < COLS * ROWS; i++) {
          const h = Math.imul(i + 7, 2654435761) >>> 0;
          if (s.cell[i] === DIRT && test(h))
            t.rect((i % COLS) * CELL + ((h >>> 8) % 3), Math.floor(i / COLS) * CELL + ((h >>> 12) % 3), 1.3, 1.3);
        }
        t.fill();
      };
      specks(dt.lo, (h) => (h & 7) === 0);
      specks(dt.hi, (h) => (h & 15) === 1);
      // Cells of one kind as merged discs: a rim pass, then the fill.
      const discs = (test: (k: number) => boolean, r: number, fill: string) => {
        t.fillStyle = fill;
        t.beginPath();
        for (let i = 0; i < COLS * ROWS; i++)
          if (test(s.cell[i])) {
            const x = ((i % COLS) + 0.5) * CELL;
            const y = (Math.floor(i / COLS) + 0.5) * CELL;
            t.moveTo(x + r, y);
            t.arc(x, y, r, 0, Math.PI * 2);
          }
        t.fill();
      };
      const open = (k: number) => k === EMPTY || k === WATER;
      discs(open, CELL * 0.98, dt.lo);
      discs(open, CELL * 0.8, tunnel);
      discs((k) => k === ROCK, CELL * 0.95, rt.edge);
      discs((k) => k === ROCK, CELL * 0.8, rock);
      discs((k) => k === SLUDGE, CELL * 0.95, st.edge);
      discs((k) => k === SLUDGE, CELL * 0.8, st.base);
      // The pipe: a metal body with a dark grated mouth.
      const { x, y, w } = s.drain;
      arena.block(t, (x - 1) * CELL, y * CELL, (w + 2) * CELL, H - y * CELL + 8, c.cellAlt, 3);
      t.fillStyle = mix(tunnel, c.coal, 0.45);
      t.fillRect(x * CELL, y * CELL, w * CELL, 2 * CELL);
      t.strokeStyle = arena.tone(c.cellAlt).edge;
      t.lineWidth = arena.lw * 0.5;
      t.beginPath();
      for (let k = 1; k < w; k++) {
        t.moveTo((x + k) * CELL, y * CELL);
        t.lineTo((x + k) * CELL, (y + 2) * CELL);
      }
      t.stroke();
    }

    function terrain(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const pw = arena.canvas.width;
      const ph = arena.canvas.height;
      const key = `${pw}x${ph}|${arena.look}|${c.p[0]}|${c.cell}|${c.muted}|${c.ink}`;
      if (key !== terrKey || dirty || !terr) {
        terr ??= document.createElement('canvas');
        terr.width = pw;
        terr.height = ph;
        const t = terr.getContext('2d');
        if (!t) return;
        t.setTransform(pw / W, 0, 0, ph / H, 0, 0);
        paintTerrain(t);
        terrKey = key;
        dirty = false;
      }
      g.drawImage(terr, 0, 0, W, H);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      terrain(g);
      const T = arena.time;

      // Sludge bubbles.
      const st = arena.tone(c.p[7]);
      g.fillStyle = st.hi;
      for (const [k, b] of s.sludge.entries())
        for (let j = 0; j < 2; j++) {
          const f = (T * 0.7 + k * 0.37 + j * 0.5) % 1;
          g.globalAlpha = 1 - f;
          g.beginPath();
          g.arc((b.x + 0.5 + (j ? 0.6 : -0.5)) * CELL, (b.y + 0.5 + b.r * 0.4 - f * b.r) * CELL, 0.6 + f * 1.2, 0, Math.PI * 2);
          g.fill();
        }
      g.globalAlpha = 1;

      // Water: merged blobs with a darker underside (falling drops stretch into streams), and a
      // rippling sheen on resting surfaces.
      const wt = arena.tone(c.accent);
      const falling = (i: number) => i + COLS < COLS * ROWS && s.cell[i + COLS] === EMPTY;
      for (const [fill, dy, r] of [
        [wt.lo, 0.8, 0.84],
        [wt.base, 0, 0.8],
      ] as const) {
        g.fillStyle = fill;
        g.beginPath();
        for (let i = 0; i < COLS * ROWS; i++)
          if (s.cell[i] === WATER) {
            const x = ((i % COLS) + 0.5) * CELL;
            const y = (Math.floor(i / COLS) + 0.5) * CELL + dy;
            if (falling(i)) g.roundRect(x - r * CELL * 0.7, y - r * CELL, r * CELL * 1.4, (1 + 2 * r) * CELL, r * CELL * 0.7);
            else {
              g.moveTo(x + r * CELL, y);
              g.arc(x, y, r * CELL, 0, Math.PI * 2);
            }
          }
        g.fill();
      }
      g.strokeStyle = wt.hi;
      g.lineWidth = 1.1;
      g.lineCap = 'round';
      g.beginPath();
      for (let i = COLS; i < COLS * ROWS; i++)
        if (s.cell[i] === WATER && s.cell[i - COLS] !== WATER && !falling(i)) {
          const x = (i % COLS) * CELL;
          const y = Math.floor(i / COLS) * CELL + 1.2 + Math.sin(T * 5 + (i % COLS) * 0.8) * 0.5;
          g.moveTo(x, y);
          g.lineTo(x + CELL, y);
        }
      g.stroke();
      g.lineCap = 'butt';

      // Gems: bob in the dirt; once touched they pop and float away.
      for (const [k, gem] of s.gems.entries()) {
        const x = (gem.x + 0.5) * CELL;
        const y = (gem.y + 0.5) * CELL;
        const fill = c.p[6];
        if (!gem.got) {
          g.globalAlpha = 0.35 + 0.25 * Math.sin(T * 3 + k);
          g.fillStyle = arena.tone(fill).glow;
          g.beginPath();
          g.arc(x, y, 8, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 1;
          arena.gem(g, x, y + Math.sin(T * 2.5 + k * 2) * 0.6, 5.5, fill, star, true, 1, Math.sin(T * 1.5 + k) * 0.15);
        } else {
          const f = (T - gotAt[k]) / 0.7;
          if (f >= 1) continue;
          g.globalAlpha = 1 - f;
          arena.gem(g, x, y - f * 18, 5.5, fill, star, false, 1 + f * 0.8, f * 3);
          g.globalAlpha = 1;
        }
      }

      // Pipe meter: delivered share against the goal.
      const { x: dx, y: dy, w: dw } = s.drain;
      const mx = (dx - 0.5) * CELL;
      const mw = (dw + 1) * CELL;
      const my = (dy + 3.2) * CELL;
      g.fillStyle = c.cell;
      g.fillRect(mx, my, mw, 3);
      g.fillStyle = s.delivered >= s.need ? c.good : c.accent;
      g.fillRect(mx, my, (mw * s.delivered) / s.total, 3);
      g.fillStyle = c.ink;
      g.fillRect(mx + (mw * need) / 100 - 0.5, my - 1, 1, 5);
      g.font = `800 8px ${arena.family}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = s.delivered >= s.need ? c.good : c.fg;
      g.fillText(pc(pct()), mouth.x, my + 9);

      // Before the first dig: a pulse on the water and on the pipe.
      if (!s.dug && !ended) {
        const f = (T * 0.8) % 1;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.8;
        g.globalAlpha = 0.6 * (1 - f);
        g.beginPath();
        g.arc(mouth.x, mouth.y, 8 + f * 16, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }

      // The brush: the keyboard digger, or the mouse hovering.
      const brush = kbd ? cur : hover;
      if (brush && !ended) {
        g.strokeStyle = kbd ? c.ink : c.fg;
        g.lineWidth = arena.lw * (kbd ? 0.9 : 0.6);
        g.setLineDash(kbd ? [] : [3, 3]);
        g.beginPath();
        g.arc(brush.x, brush.y, BRUSH * CELL + 1, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        if (kbd) arena.disc(g, brush.x, brush.y, 2.2, c.accent);
      }
      arena.overlay(g);
    }

    function digTo(a: Point, b: Point) {
      const n = digLine(s, a.x, a.y, b.x, b.y);
      if (!n) return;
      dirty = true;
      if (arena.time - digT > 0.15) {
        digT = arena.time;
        sfx('tick', { vol: 0.3, pitch: ((crumbT * 7) % 3) - 1 });
      }
      if (arena.time - crumbT > 0.05) {
        crumbT = arena.time;
        const dirt = dirtOf();
        fx.burst(b.x, b.y, dirt, Math.min(7, 2 + n / 3), 80, 2.6, 0.45, 'square', 320);
        fx.burst(b.x, b.y, arena.tone(dirt).hi, 2, 50, 1.8, 0.3, 'dot', 200);
      }
      status();
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 4,
      onDown(p) {
        kbd = false;
        last = p;
        digTo(p, p);
      },
      onMove(p, from) {
        hover = from ? null : p;
        if (!from || !last) return;
        digTo(last, p);
        last = p;
      },
      onTap: () => (last = null),
      onRelease: () => (last = null),
    });
    const onLeave = () => (hover = null);
    arena.canvas.addEventListener('pointerleave', onLeave);

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        if (ended) return;
        // Keyboard digger: moves (and digs) while arrows are held.
        const vx = (held[1] ? 1 : 0) - (held[3] ? 1 : 0);
        const vy = (held[2] ? 1 : 0) - (held[0] ? 1 : 0);
        if (vx || vy) {
          const k = (KEY_SPEED * dt) / Math.hypot(vx, vy);
          const from = { ...cur };
          cur.x = Math.max(2, Math.min(W - 2, cur.x + vx * k));
          cur.y = Math.max(2, Math.min(H - 2, cur.y + vy * k));
          digTo(from, cur);
        }
        const score = scoreOf(s);
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        if (scoreOf(s) !== score) ctx.score(scoreOf(s));
        // Water arriving: splashes at the mouth, and the share every 10 %.
        splash += ev.delivered;
        if (ev.delivered && !arrived) {
          arrived = true;
          sfx('splash');
        }
        if (splash && arena.time - splashT > 0.07) {
          splashT = arena.time;
          fx.burst(mouth.x, mouth.y, arena.tone(c.accent).hi, Math.min(6, 1 + splash), 70, 2.4, 0.4, 'dot', 260, -Math.PI / 2, 1.6);
          splash = 0;
        }
        const p = pct();
        if (ev.lost && arena.time - sludgeT > 0.6) {
          sludgeT = arena.time;
          sfx('error', { vol: 0.6 });
        }
        if (ev.lost && s.lostAt >= 0 && arena.time - lostT > 0.12) {
          lostT = arena.time;
          const x = ((s.lostAt % COLS) + 0.5) * CELL;
          const y = (Math.floor(s.lostAt / COLS) + 0.5) * CELL;
          fx.burst(x, y, c.p[7], 6, 60, 2.5, 0.4, 'dot', -40);
          fx.burst(x, y, c.bad, 3, 50, 2, 0.35, 'spark', 0);
          fx.shake(1, 0.12);
        }
        for (const k of ev.gems) {
          gotAt[k] = arena.time;
          const x = (s.gems[k].x + 0.5) * CELL;
          const y = (s.gems[k].y + 0.5) * CELL;
          fx.ring(x, y, c.p[6], 4, 24, 0.4, arena.lw * 1.2);
          sfx('coin');
          fx.burst(x, y, c.p[6], 12, 120, 3, 0.55, 'spark', 0);
          fx.burst(x, y, arena.tone(c.p[6]).hi, 6, 70, 2.2, 0.5, 'dot', 120);
          fx.text(x, y - 10, `+${GEM_POINTS}`, c.p[6], 13);
          fx.shake(1.2, 0.15);
        }
        if (ev.goal) {
          sfx('power');
          fx.ring(mouth.x, mouth.y, c.good, 6, 50, 0.5, arena.lw * 1.4);
          fx.text(mouth.x, mouth.y - 24, L('Goal!', 'Objectif atteint!'), c.good, 14, 1.1);
          fx.flash(c.good, 0.15, 0.35);
        }
        status();
        if (ev.won) {
          ended = true;
          for (let i = 0; i < 5; i++) fx.burst(mouth.x, mouth.y, c.p[i], 10, 190, 4, 0.9, 'square', 220, -Math.PI / 2, 2.2);
          fx.ring(mouth.x, mouth.y, c.accent, 6, 90, 0.6, arena.lw * 1.5);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          fx.shake(4, 0.4);
          fx.flash(c.bad, 0.28, 0.45);
          fx.text(mouth.x, mouth.y - 24, `${pc(p)} / ${pc(need)}`, c.bad, 13, 1.1);
          arena.linger();
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const dir = keyDir(e.key);
        if (dir === -1) return false;
        held[dir] = e.type === 'keydown';
        if (held[dir]) {
          kbd = true;
          hover = null;
        }
        return true;
      },
      destroy() {
        stopGestures();
        arena.canvas.removeEventListener('pointerleave', onLeave);
        arena.destroy();
      },
    };
  },
};
