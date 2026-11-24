import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { alpha, mix } from '../../kits/arena/color';
import { outBack } from '../../kits/arena/ease';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { DX, DY, type Dir, gestures, keyDir } from '../../kits/gesture/gesture';
import { haptic, sfx } from '../../kits/sound/sound';
import { WALL } from './maze';
import { KIND_NAMES, POWER_NAMES } from './names';
import { CELL, drawGlowEyes, drawOwl, owlColor } from './owls';
import {
  BERRY,
  BERRY_POINTS,
  CHAIN,
  createLevel,
  DASH_S,
  LIFE_BONUS,
  LIVES,
  MAGNET_S,
  pos,
  RESPAWN_S,
  SEED,
  SEED_POINTS,
  seedsFor,
  steer,
  step,
  STREAK_TIERS,
  STREAK_WINDOW,
} from './rules';

export const chase: GameDef = {
  id: 'chase',
  get name() {
    return L('Maze Chase', 'Poursuite');
  },
  get rules() {
    return L('Eat every seed in the maze; dodge the owls.', 'Mangez toutes les graines; évitez les hiboux.');
  },
  category: 'reflex',
  help: () => ({
    goal: L(
      'Eat every seed in the hedge maze before the owls catch you three times.',
      'Mangez toutes les graines du labyrinthe avant que les hiboux vous attrapent trois fois.',
    ),
    steps: [
      L(
        'Your mouse runs on its own along the hedges and stops against a wall.',
        'Votre souris court toute seule entre les haies et s’arrête contre un mur.',
      ),
      L(
        'Owls leave the nest one by one and hunt you, each in its own way. A touch costs a life.',
        'Les hiboux sortent du nid un à un et vous chassent, chacun à sa façon. Un contact vous coûte une vie.',
      ),
      L(
        'A big berry scares them for a few seconds: catch them then for points.',
        'Une grosse baie les effraie quelques secondes : attrapez-les alors pour des points.',
      ),
      L(
        'Some mazes hide hawks that swoop down straight corridors, or ghost owls that drift through hedges.',
        'Certains labyrinthes cachent des faucons qui foncent dans les couloirs droits, ou des hiboux fantômes qui traversent les haies.',
      ),
      L(
        'Swipe (or tap a side of the mouse) to pick the next turn; it’s taken at the next opening.',
        'Balayez (ou touchez à côté de la souris) pour choisir le prochain virage; il est pris à la prochaine ouverture.',
      ),
      L('Keyboard: arrows or WASD to steer, P to pause.', 'Clavier : flèches ou WASD pour diriger, P pour la pause.'),
    ],
    tips: [
      L(
        `Eat seeds without a pause: a streak of ${STREAK_TIERS[0]} gives a dash, ${STREAK_TIERS[1]} a seed magnet, ${STREAK_TIERS[2]} scares the owls, ${STREAK_TIERS[3]} all three.`,
        `Mangez des graines sans pause : une série de ${STREAK_TIERS[0]} donne un sprint, ${STREAK_TIERS[1]} un aimant à graines, ${STREAK_TIERS[2]} effraie les hiboux, ${STREAK_TIERS[3]} les trois.`,
      ),
      L(
        `Scared owls caught on one berry are worth ${CHAIN.slice(0, 3).join(', ')}, then ${CHAIN[3]}.`,
        `Les hiboux effrayés attrapés avec une même baie valent ${CHAIN.slice(0, 3).join(', ')}, puis ${CHAIN[3]}.`,
      ),
      L(
        'The side passage wraps around and slows the owls down. An acorn shows up twice at the start.',
        'Le passage sur le côté fait le tour et ralentit les hiboux. Un gland apparaît deux fois au départ.',
      ),
      L(`Each life left at the end is worth ${LIFE_BONUS}.`, `Chaque vie restante à la fin vaut ${LIFE_BONUS}.`),
    ],
  }),
  stars: (d) => {
    const base = seedsFor(d) * SEED_POINTS + 4 * (BERRY_POINTS - SEED_POINTS);
    // Streak scares make catching owls a little easier, so ★★★ asks for a little more.
    return [base + 2 * LIFE_BONUS, base + LIVES * LIFE_BONUS + 800];
  },
  par: (d) => byLevel(d, [40, 45, 60, 65, 70]),
  pad: () => ({ left: 'dpad' }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const W = s.cols * CELL;
    const H = s.rows * CELL;
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    let hedge: Path2D | null = null;
    let moved = false;
    let ended = false;
    /** When the hero last ate (it munches) and when the acorn appeared. */
    let munchAt = -10;
    let bonusAt = -10;
    let shown = '';
    /** Lit radius drawn in a night maze (eases towards the target). */
    let sight = s.sight * CELL;

    const status = () => {
      const parts = [P(s.left, ['seed left', 'seeds left'], ['graine restante', 'graines restantes'])];
      if (s.fright > 0) parts.push(L(`owls scared ${Math.ceil(s.fright)} s`, `hiboux effrayés ${Math.ceil(s.fright)} s`));
      else if (s.streak >= 5) parts.push(L(`streak ${s.streak}`, `série ${s.streak}`));
      else if (!moved) parts.push(L('swipe to set off', 'balayez pour partir'));
      const t = parts.join(' · ');
      if (t !== shown) ctx.status((shown = t));
    };

    const cx = (i: number) => (i % s.cols) * CELL + CELL / 2;
    const cy = (i: number) => Math.floor(i / s.cols) * CELL + CELL / 2;
    const wall = (c: number, r: number) => c >= 0 && r >= 0 && c < s.cols && r < s.rows && s.grid[r * s.cols + c] === WALL;

    /** The hedges as one shape: an inset tile per wall cell, bridged to its wall neighbours. */
    function hedges(): Path2D {
      const p = new Path2D();
      const m = CELL * 0.14;
      const k = CELL - 2 * m;
      for (let r = 0; r < s.rows; r++)
        for (let c = 0; c < s.cols; c++) {
          if (!wall(c, r)) continue;
          const x = c * CELL;
          const y = r * CELL;
          p.roundRect(x + m, y + m, k, k, 3);
          if (wall(c + 1, r)) p.rect(x + m, y + m, CELL, k);
          if (wall(c, r + 1)) p.rect(x + m, y + m, k, CELL);
          if (wall(c + 1, r) && wall(c, r + 1) && wall(c + 1, r + 1)) p.rect(x + CELL / 2, y + CELL / 2, CELL, CELL);
        }
      return p;
    }

    /** Draw at x, and again on the other side while crossing the side passage. */
    function wrapped(x: number, paint: (x: number) => void) {
      paint(x);
      if (x < CELL / 2) paint(x + W);
      else if (x > W - CELL / 2) paint(x - W);
    }

    function drawHero(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const h = s.hero;
      const p = pos(s, h);
      const fx0 = DX[h.face];
      const fy0 = DY[h.face];
      // Perpendicular to the heading, for the ears and eyes.
      const px = -fy0;
      const py = fx0;
      const dying = s.dying > 0 ? s.dying / RESPAWN_S : ended && s.lives <= 0 ? 0 : 1;
      if (dying <= 0.02) return;
      if (s.safe > 0 && Math.floor(arena.time * 10) % 2) g.globalAlpha = 0.4;
      const munch = arena.time - munchAt < 0.12 ? 1.08 : 1;
      const r = CELL * 0.4 * dying * munch;
      const pink = c.p[6];
      const skin = arena.tone(c.paper);
      wrapped(p.x * CELL, (x) => {
        const y = p.y * CELL;
        g.save();
        if (s.dying > 0) {
          g.translate(x, y);
          g.rotate((1 - dying) * 9);
          g.translate(-x, -y);
        }
        // Tail: a wavy pink line out the back.
        const wag = Math.sin(arena.time * 12) * (h.moving ? 2.5 : 1);
        g.strokeStyle = pink;
        g.lineWidth = 1.4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x - fx0 * r * 0.8, y - fy0 * r * 0.8);
        g.quadraticCurveTo(
          x - fx0 * r * 1.5 + px * wag,
          y - fy0 * r * 1.5 + py * wag,
          x - fx0 * r * 2 - px * wag,
          y - fy0 * r * 2 - py * wag,
        );
        g.stroke();
        g.lineCap = 'butt';
        arena.ball(g, x, y, r, c.paper);
        // Round ears towards the back, pink inside.
        for (const side of [-1, 1]) {
          const ex = x - fx0 * r * 0.3 + px * side * r * 0.68;
          const ey = y - fy0 * r * 0.3 + py * side * r * 0.68 - (fy0 === 0 ? r * 0.25 : 0);
          g.fillStyle = c.paper;
          g.strokeStyle = skin.edge;
          g.lineWidth = arena.lw * 0.5;
          g.beginPath();
          g.arc(ex, ey, r * 0.42, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          g.fillStyle = pink;
          g.beginPath();
          g.arc(ex, ey, r * 0.24, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = c.coal;
        for (const side of [-1, 1]) {
          g.beginPath();
          g.arc(
            x + fx0 * r * 0.38 + px * side * r * 0.3,
            y + fy0 * r * 0.38 + py * side * r * 0.3 - (fy0 === 0 ? r * 0.12 : 0),
            r * 0.13,
            0,
            Math.PI * 2,
          );
          g.fill();
        }
        g.fillStyle = pink;
        g.beginPath();
        g.arc(x + fx0 * r * 0.92, y + fy0 * r * 0.92, r * 0.16, 0, Math.PI * 2);
        g.fill();
        g.restore();
      });
      g.globalAlpha = 1;
      if (h.want >= 0 && h.moving && !ended && s.dying <= 0) {
        // The turn asked for, waiting for the next opening: a chevron on that side of the mouse.
        const wx = DX[h.want as Dir];
        const wy = DY[h.want as Dir];
        const d = CELL * (0.78 + 0.08 * Math.sin(arena.time * 14));
        const ax = p.x * CELL + wx * d;
        const ay = p.y * CELL + wy * d;
        const k = CELL * 0.2;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        for (const [col, w] of [
          [arena.tone(c.accent).edge, arena.lw * 1.8],
          [c.accent, arena.lw * 0.9],
        ] as const) {
          g.strokeStyle = col;
          g.lineWidth = w;
          g.beginPath();
          g.moveTo(ax - wx * k - wy * k, ay - wy * k - wx * k);
          g.lineTo(ax, ay);
          g.lineTo(ax - wx * k + wy * k, ay - wy * k + wx * k);
          g.stroke();
        }
        g.lineCap = 'butt';
      }
      if (!moved && !ended) {
        // Waiting for the first swipe: a pulse around the mouse.
        const f = (arena.time * 0.8) % 1;
        g.strokeStyle = c.accent;
        g.globalAlpha = 1 - f;
        g.lineWidth = arena.lw;
        g.beginPath();
        g.arc(p.x * CELL, p.y * CELL, CELL * (0.6 + f * 0.7), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, CELL, 0, false);

      // Hedges: shadow, outline (the fill covers the inner seams), fill, then a sprinkle of leaves.
      hedge ??= hedges();
      const green = arena.dark ? mix(c.accent, c.cell, 0.35) : c.accent;
      const t = arena.tone(green);
      if (arena.sh && arena.look !== 'minimal') {
        g.save();
        g.translate(arena.look === 'soft' ? 0 : arena.sh * 0.5, arena.sh * (arena.look === 'soft' ? 0.7 : 0.5));
        g.fillStyle = c.drop;
        g.fill(hedge);
        g.restore();
      }
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 1.6;
      g.lineJoin = 'round';
      g.stroke(hedge);
      g.fillStyle = t.base;
      g.fill(hedge);
      for (const [fill, k] of [
        [t.hi, 0],
        [t.lo, 1],
      ] as const) {
        g.fillStyle = fill;
        g.beginPath();
        for (let i = 0; i < s.grid.length; i++) {
          if (s.grid[i] !== WALL || (i * 7 + k * 3) % 5 > 1) continue;
          const lx = cx(i) + (((i * 13 + k * 5) % 7) - 3);
          const ly = cy(i) + (((i * 11 + k * 3) % 7) - 3);
          g.moveTo(lx + 1.3, ly);
          g.arc(lx, ly, 1.3, 0, Math.PI * 2);
        }
        g.fill();
      }

      // The nest: a woven box around its three cells, with a twig gate on top.
      const nx = cx(s.den - 1) - CELL / 2 + 1.5;
      const ny = cy(s.den) - CELL / 2 + 1.5;
      g.fillStyle = arena.tone(c.muted).glow;
      g.fillRect(nx, ny, CELL * 3 - 3, CELL - 3);
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw;
      g.beginPath();
      g.moveTo(cx(s.den) - CELL / 2, ny);
      g.lineTo(nx, ny);
      g.lineTo(nx, ny + CELL - 3);
      g.lineTo(nx + CELL * 3 - 3, ny + CELL - 3);
      g.lineTo(nx + CELL * 3 - 3, ny);
      g.lineTo(cx(s.den) + CELL / 2, ny);
      g.stroke();
      g.setLineDash([2, 2]);
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.moveTo(cx(s.den) - CELL / 2, ny);
      g.lineTo(cx(s.den) + CELL / 2, ny);
      g.stroke();
      g.setLineDash([]);

      // Seeds (little tilted grains) in one pass, then the berries. On light surfaces the yellow is
      // warmed towards orange so the grains don't fade into the path.
      const seed = arena.tone(arena.dark ? c.p[3] : mix(c.p[3], c.p[0], 0.4));
      g.fillStyle = seed.base;
      g.strokeStyle = seed.edge;
      g.lineWidth = arena.lw * 0.45;
      g.beginPath();
      for (let i = 0; i < s.items.length; i++) {
        if (s.items[i] !== SEED) continue;
        const a = (i % 3) - 1;
        g.moveTo(cx(i) + 2.3 * Math.cos(a), cy(i) + 2.3 * Math.sin(a));
        g.ellipse(cx(i), cy(i), 2.3, 1.55, a, 0, Math.PI * 2);
      }
      g.fill();
      g.stroke();
      for (let i = 0; i < s.items.length; i++) {
        if (s.items[i] !== BERRY) continue;
        const pulse = 1 + 0.12 * Math.sin(arena.time * 6 + i);
        g.fillStyle = arena.tone(c.p[6]).glow;
        g.beginPath();
        g.arc(cx(i), cy(i), CELL * 0.42 * pulse, 0, Math.PI * 2);
        g.fill();
        arena.ball(g, cx(i), cy(i), CELL * 0.27 * pulse, c.p[6]);
        g.fillStyle = c.p[7];
        g.beginPath();
        g.ellipse(cx(i) + 2.5, cy(i) - 4.2, 2.4, 1.1, -0.5, 0, Math.PI * 2);
        g.fill();
      }

      // The acorn bonus at the start, blinking as it runs out.
      if (s.bonus > 0 && (s.bonus > 2 || Math.floor(arena.time * 8) % 2)) {
        const pop = outBack((arena.time - bonusAt) / 0.35, 2.4);
        const x = cx(s.start);
        const y = cy(s.start) + Math.sin(arena.time * 3) * 0.8;
        arena.ball(g, x, y + 1.5 * pop, CELL * 0.3 * pop, c.p[0]);
        arena.block(g, x - CELL * 0.32 * pop, y - CELL * 0.3 * pop, CELL * 0.64 * pop, CELL * 0.26 * pop, c.muted, 3, false, 0.6);
        g.strokeStyle = arena.tone(c.muted).edge;
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x, y - CELL * 0.3 * pop);
        g.lineTo(x + 1, y - CELL * 0.45 * pop);
        g.stroke();
      }

      // Eyes going home under everything, then the owls, then the mouse on top.
      s.chasers.forEach((ch, n) => ch.mode === 'eyes' && drawOwl(arena, s, g, ch, n, wrapped));
      s.chasers.forEach((ch, n) => ch.mode !== 'eyes' && drawOwl(arena, s, g, ch, n, wrapped));
      drawPowers(g);
      if (s.sight > 0 && !ended) drawNight(g);
      drawHero(g);
      drawMeters(g);
      arena.overlay(g);
    }

    /** Night maze: darkness everywhere but a pool of light around the mouse (wider while owls are scared). */
    function drawNight(g: CanvasRenderingContext2D) {
      const c = arena.colors;
      const p = pos(s, s.hero);
      const hx = p.x * CELL;
      const hy = p.y * CELL;
      const want = s.sight * (s.fright > 0 ? 1.7 : s.dash > 0 ? 1.25 : 1) * CELL;
      sight += (want - sight) * 0.12;
      const dark = arena.dark ? mix(c.bg, c.coal, 0.5) : c.coal;
      const grad = g.createRadialGradient(hx, hy, sight * 0.55, hx, hy, sight);
      grad.addColorStop(0, alpha(dark, 0));
      grad.addColorStop(1, alpha(dark, 0.93));
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      drawGlowEyes(arena, s, g, wrapped);
    }

    /** A dash leaves a trail; a magnet spins a dotted ring around the mouse. */
    function drawPowers(g: CanvasRenderingContext2D) {
      if (ended || s.dying > 0) return;
      const c = arena.colors;
      const p = pos(s, s.hero);
      const hx = p.x * CELL;
      const hy = p.y * CELL;
      if (s.dash > 0 && s.hero.moving) {
        g.fillStyle = arena.tone(c.p[2]).glow;
        for (let k = 1; k <= 4; k++) {
          g.globalAlpha = 0.6 - k * 0.12;
          g.beginPath();
          g.arc(hx - DX[s.hero.dir] * k * 4, hy - DY[s.hero.dir] * k * 4, CELL * (0.4 - k * 0.05), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      if (s.magnet > 0 && (s.magnet > 1.5 || Math.floor(arena.time * 8) % 2)) {
        g.strokeStyle = c.p[4];
        g.lineWidth = arena.lw;
        g.setLineDash([3, 4]);
        g.lineDashOffset = -arena.time * 20;
        g.beginPath();
        g.arc(hx, hy, CELL * 1.3, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.lineDashOffset = 0;
      }
    }

    /** Along the top: the munch streak draining, then the dash and magnet time left. */
    function drawMeters(g: CanvasRenderingContext2D) {
      if (ended) return;
      const c = arena.colors;
      const bars: [number, string][] = [];
      if (s.streak >= 3) bars.push([s.streakLeft / STREAK_WINDOW, c.accent]);
      if (s.dash > 0) bars.push([s.dash / DASH_S, c.p[2]]);
      if (s.magnet > 0) bars.push([s.magnet / MAGNET_S, c.p[4]]);
      g.globalAlpha = 0.9;
      bars.forEach(([k, col], i) => {
        g.fillStyle = col;
        g.fillRect(0, i * 4, W * Math.max(0, k), 3);
      });
      g.globalAlpha = 1;
    }

    function go(dir: Dir) {
      if (ended) return;
      steer(s, dir);
      if (!moved && s.hero.moving) {
        moved = true;
        status();
      }
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: CELL * 0.6,
      repeat: true,
      onSwipe: (dir) => go(dir),
      onTap: (q) => {
        const p = pos(s, s.hero);
        const dx = q.x - p.x * CELL;
        const dy = q.y - p.y * CELL;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < CELL * 0.4) return;
        go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
      },
    });

    let seedN = 0;
    let chain = 0;
    ctx.score(0);
    ctx.lives(s.lives, LIVES);
    status();
    return {
      draw,
      frame(dt) {
        const score = s.score;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        const hp = pos(s, s.hero);
        const hx = hp.x * CELL;
        const hy = hp.y * CELL;
        if (ev.seeds) {
          sfx('coin', { pitch: (seedN++ % 2) * 2, vol: 0.35 });
          munchAt = arena.time;
          fx.burst(hx, hy, c.p[3], 3, 50, 2, 0.25, 'dot', 0);
          if (ev.streak >= 5 && Math.floor(ev.streak / 5) > Math.floor((ev.streak - ev.seeds) / 5))
            comboPop(fx, hx, hy - 6, ev.streak - (ev.streak % 5), c.accent);
        }
        // Seeds the magnet pulled in fly to the mouse.
        for (const i of ev.pulled) fx.burst(cx(i), cy(i), c.p[4], 3, 40, 2, 0.3, 'dot', 0, Math.atan2(hy - cy(i), hx - cx(i)), 0.4);
        if (ev.tier && ev.unlocked) {
          comboTier(fx, ev.tier, c.accent, POWER_NAMES[ev.unlocked]());
          if (ev.unlocked !== 'magnet') fx.ring(hx, hy, c.p[2], 4, CELL * 2.5, 0.4, arena.lw * 1.2);
          if (ev.unlocked !== 'dash') fx.ring(hx, hy, c.p[4], 4, CELL * 3, 0.5, arena.lw);
          if (ev.unlocked === 'scare' || ev.unlocked === 'frenzy') {
            chain = 0;
            haptic(40);
          }
        }
        if (ev.berry) {
          sfx('power');
          chain = 0;
          munchAt = arena.time;
          fx.ring(hx, hy, c.p[6], 4, CELL * 3, 0.45, arena.lw * 1.2);
          fx.burst(hx, hy, c.p[6], 12, 120, 3, 0.5, 'dot', 0);
          fx.flash(c.p[6], 0.16, 0.35);
          fx.text(hx, hy - 10, L('Shoo!', 'Ouste!'), c.p[6], 13);
        }
        for (const k of ev.caught) {
          sfx('combo', { step: ++chain });
          const x = k.x * CELL;
          const y = k.y * CELL;
          const col = owlColor(arena, k.kind);
          fx.burst(x, y, col, 14, 130, 3.5, 0.55);
          fx.burst(x, y, c.paper, 6, 80, 2.5, 0.4, 'spark', 0);
          fx.ring(x, y, col, 4, CELL * 1.8, 0.35, arena.lw);
          fx.text(x, y - 10, `+${k.points}`, k.points >= 800 ? c.accent : c.fg, k.points >= 800 ? 15 : 12);
          fx.shake(2.5, 0.2);
        }
        if (ev.released) fx.burst(cx(s.door), cy(s.door), c.muted, 6, 50, 2.5, 0.4, 'dot', -40);
        if (ev.bonusUp) {
          bonusAt = arena.time;
          fx.ring(cx(s.start), cy(s.start), c.p[0], 2, CELL * 1.4, 0.4, arena.lw);
        }
        if (ev.bonus) {
          sfx('coin', { pitch: 5 });
          fx.burst(cx(s.start), cy(s.start), c.p[0], 12, 110, 3, 0.5);
          fx.ring(cx(s.start), cy(s.start), c.accent, 4, CELL * 2, 0.4, arena.lw);
          fx.text(cx(s.start), cy(s.start) - 10, `+${ev.bonus}`, c.accent, 14);
        }
        if (ev.lostLife) {
          ctx.lives(s.lives, LIVES);
          fx.shake(5, 0.4);
          fx.flash(c.bad, 0.3, 0.4);
          fx.burst(hx, hy, c.paper, 10, 120, 3, 0.5);
          fx.burst(hx, hy, c.p[6], 6, 90, 2.5, 0.45, 'dot');
        }
        if (ev.respawned) fx.ring(cx(s.start), cy(s.start), c.accent, 2, CELL * 1.5, 0.4, arena.lw);
        if (s.score !== score) ctx.score(s.score);
        if (ev.won) {
          ended = true;
          for (let k = 0; k < 6; k++) fx.burst(hx, hy, c.p[k], 8, 170, 3.5, 0.9, 'square', 200);
          fx.ring(hx, hy, c.accent, 6, W * 0.6, 0.6, arena.lw * 1.5);
          if (ev.lifeBonus) fx.text(W / 2, H / 2, `+${ev.lifeBonus}`, c.accent, 18, 1.2);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          arena.linger(1.6);
        }
        status();
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const dir = keyDir(e.key);
        if (dir === -1) return false;
        if (e.type === 'keydown' && !e.repeat) go(dir);
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
