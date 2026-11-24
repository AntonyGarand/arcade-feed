import './style.css';
import { L, P } from '../../core/i18n';
import { btn } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { gestures } from '../../kits/gesture/gesture';
import { glyphPath } from '../../kits/glyph/glyph';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  ammoFor,
  AMMO_POINTS,
  ammoLeft,
  AIM_MIN_Y,
  blastMax,
  blastR,
  citiesFor,
  CITY_POINTS,
  CITY_W,
  createLevel,
  fire,
  GROUND_Y,
  H,
  incoming,
  MISSILE_POINTS,
  waveSize,
  step,
  W,
} from './rules';

/** Glyph for a missile that will split (a diamond head). */
const DIAMOND = 1;

export const skyguard: GameDef = {
  id: 'skyguard',
  get name() {
    return L('Sky Guard', 'Garde céleste');
  },
  get rules() {
    return L('Blast the falling missiles to save your cities.', 'Faites exploser les missiles pour sauver vos villes.');
  },
  category: 'aim',
  help: () => ({
    goal: L(
      'Stop the wave of missiles with at least one city still standing.',
      'Arrêtez la vague de missiles avec au moins une ville encore debout.',
    ),
    steps: [
      L(
        'Missiles fall toward your cities and launchers. One hit wrecks what it lands on.',
        'Des missiles tombent vers vos villes et vos lanceurs. Un impact détruit ce qu’il touche.',
      ),
      L(
        'Each interceptor flies to the point you pick and bursts into a growing blast. Anything inside blows up, which can set off more.',
        'Chaque intercepteur vole jusqu’au point choisi et éclate en une explosion qui grandit. Tout ce qui s’y trouve saute, et peut en faire sauter d’autres.',
      ),
      L(
        'Ammo is limited per launcher. Missiles with a diamond head split in two or three on the way down.',
        'Les munitions sont limitées par lanceur. Les missiles à tête en losange se divisent en deux ou trois en descendant.',
      ),
      L(
        'Tap or click the sky: the nearest launcher with ammo fires there.',
        'Touchez ou cliquez le ciel : le lanceur le plus proche qui a des munitions y tire.',
      ),
      L(
        'Keyboard: arrows move the crosshair, Space fires, Z X C fire from the left, middle or right launcher, P to pause.',
        'Clavier : les flèches bougent le viseur, Espace tire, Z X C tirent du lanceur de gauche, du centre ou de droite, P pour la pause.',
      ),
    ],
    tips: [
      L('Aim ahead of a missile: the blast takes a moment to grow.', 'Visez devant le missile : l’explosion prend un moment à grandir.'),
      L(
        `${MISSILE_POINTS} per missile, ${CITY_POINTS} per city standing and ${AMMO_POINTS} per interceptor left at the end.`,
        `${MISSILE_POINTS} par missile, ${CITY_POINTS} par ville debout et ${AMMO_POINTS} par intercepteur restant à la fin.`,
      ),
    ],
  }),
  stars: (d) => {
    // Two: most missiles and over half the cities. Three: every missile and city, with ammo to spare.
    const kills = waveSize(d) * MISSILE_POINTS;
    const cities = citiesFor(d);
    const spare = Math.round(3 * ammoFor(d) * byLevel(d, [0.35, 0.25, 0.2, 0.12, 0.1]));
    return [Math.round(kills * 0.9) + Math.ceil(cities * 0.6) * CITY_POINTS, kills + cities * CITY_POINTS + spare * AMMO_POINTS];
  },
  par: (d) => byLevel(d, [36, 39, 42, 45, 48]),
  pad: () => ({ left: 'dpad', right: [btn(' ', 'fire', L('Fire', 'Tirer'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const held = new Set<string>();
    let flash = 0;
    /** Show the crosshair once the player has pointed or used the arrows. */
    let hover = false;

    const status = () =>
      ctx.status(
        [
          P(incoming(s), ['missile left', 'missiles left'], ['missile restant', 'missiles restants']),
          P(ammoLeft(s), ['interceptor', 'interceptors'], ['intercepteur', 'intercepteurs']),
        ].join(' · '),
      );

    function drawCity(g: CanvasRenderingContext2D, x: number, alive: boolean, k: number) {
      const c = arena.colors;
      if (!alive) {
        arena.box(g, x - CITY_W / 2, GROUND_Y - 5, CITY_W, 5, c.muted, 1, false);
        return;
      }
      // Three towers of seeded-looking (but fixed) heights.
      const hs = [14, 22, 17].map((h, i) => h + ((k * 5 + i * 3) % 6));
      const w = CITY_W / 3;
      hs.forEach((h, i) => arena.box(g, x - CITY_W / 2 + i * w, GROUND_Y - h, w, h, c.p[(k + i) % 2 ? 4 : 5], 1.5));
      g.fillStyle = c.cell;
      hs.forEach((h, i) => {
        for (let y = GROUND_Y - h + 4; y < GROUND_Y - 4; y += 6) g.fillRect(x - CITY_W / 2 + i * w + w / 2 - 1, y, 2, 2.5);
      });
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      if (flash > 0) {
        g.globalAlpha = Math.min(1, flash) * 0.22;
        g.fillStyle = c.bad;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
      // Ground.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, GROUND_Y);
      g.lineTo(W, GROUND_Y);
      g.stroke();

      s.cities.forEach((ct, k) => drawCity(g, ct.x, ct.alive, k));
      // Launchers: a mound with a pip per interceptor left.
      for (const b of s.bases) {
        g.fillStyle = b.alive ? c.accent : c.muted;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.8;
        g.beginPath();
        g.moveTo(b.x - 18, GROUND_Y);
        g.lineTo(b.x - 9, GROUND_Y - 13);
        g.lineTo(b.x + 9, GROUND_Y - 13);
        g.lineTo(b.x + 18, GROUND_Y);
        g.closePath();
        g.fill();
        g.stroke();
        if (!b.alive) continue;
        g.fillStyle = c.ink;
        for (let i = 0; i < b.ammo; i++) g.fillRect(b.x - 15 + (i % 10) * 3, GROUND_Y + 5 + Math.floor(i / 10) * 5, 2, 3.5);
      }

      // Missiles: a trail from where they came in, a head (a diamond if it will split).
      for (const m of s.missiles) {
        g.strokeStyle = c.bad;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(m.x0, m.y0);
        g.lineTo(m.x, m.y);
        g.stroke();
        g.fillStyle = c.bad;
        g.strokeStyle = c.ink;
        g.lineWidth = arena.lw * 0.6;
        if (m.splitY) {
          glyphPath(g, DIAMOND, m.x, m.y, 5);
          g.fill();
          g.stroke();
        } else arena.disc(g, m.x, m.y, 2.6, c.bad);
      }
      // Interceptors: a dashed trail and a mark where they'll burst.
      g.setLineDash([3, 3]);
      for (const sh of s.shots) {
        g.strokeStyle = c.accent;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(sh.x0, sh.y0);
        g.lineTo(sh.x, sh.y);
        g.stroke();
      }
      g.setLineDash([]);
      for (const sh of s.shots) {
        g.strokeStyle = c.fg;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(sh.tx - 4, sh.ty - 4);
        g.lineTo(sh.tx + 4, sh.ty + 4);
        g.moveTo(sh.tx + 4, sh.ty - 4);
        g.lineTo(sh.tx - 4, sh.ty + 4);
        g.stroke();
        arena.disc(g, sh.x, sh.y, 2.4, c.accent);
      }
      for (const b of s.blasts) {
        const r = blastR(b);
        if (r <= 0.5) continue;
        g.globalAlpha = b.kind === 'impact' ? 0.8 : 0.6;
        arena.disc(g, b.x, b.y, r, b.kind === 'shot' ? c.accent : b.kind === 'chain' ? c.p[3] : c.bad);
        g.globalAlpha = 1;
      }

      // Crosshair, with the blast's reach.
      if (hover) {
        g.strokeStyle = c.fg;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(s.cx, s.cy, 7, 0, Math.PI * 2);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          g.moveTo(s.cx + dx * 4, s.cy + dy * 4);
          g.lineTo(s.cx + dx * 11, s.cy + dy * 11);
        }
        g.stroke();
        g.strokeStyle = c.muted;
        g.lineWidth = 1;
        g.setLineDash([2, 4]);
        g.beginPath();
        g.arc(s.cx, s.cy, blastMax(s), 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      // Highest point interceptors can be sent to, as a faint line.
      g.strokeStyle = c.cellAlt;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, AIM_MIN_Y);
      g.lineTo(W, AIM_MIN_Y);
      g.stroke();
    }

    const shoot = (x: number, y: number, force = -1) => {
      if (fire(s, x, y, force)) {
        sfx('shoot', { vol: 0.8 });
        status();
      } else sfx('error', { vol: 0.7 });
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 10,
      onDown(p) {
        hover = true;
        s.cx = p.x;
        s.cy = Math.min(AIM_MIN_Y, p.y);
        shoot(p.x, p.y);
      },
      onMove(p) {
        hover = true;
        s.cx = p.x;
        s.cy = Math.min(AIM_MIN_Y, p.y);
      },
    });

    const syncKeys = () => {
      s.kx = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      s.ky = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
    };

    ctx.score(0);
    status();
    return {
      draw,
      frame(dt) {
        const before = incoming(s);
        const ev = step(s, dt);
        flash = Math.max(0, flash - dt * 2);
        if (ev.impacts.some((i) => i.wrecked)) flash = 1;
        if (ev.killed) sfx('pop', { pitch: Math.min(8, ev.killed * 2) });
        if (ev.impacts.length) {
          sfx('boom');
          if (ev.impacts.some((i) => i.wrecked)) haptic(30);
        }
        if (ev.killed || ev.cleared) ctx.score(s.score);
        if (ev.killed || ev.impacts.length || incoming(s) !== before) status();
        draw();
        if (ev.cleared) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const down = e.type === 'keydown';
        const dir = { arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down' }[k];
        if (dir) {
          hover = true;
          if (down) held.add(dir);
          else held.delete(dir);
          syncKeys();
          return true;
        }
        const force = ['z', 'x', 'c'].indexOf(k);
        if (k === ' ' || k === 'enter' || force >= 0) {
          if (down && !e.repeat) shoot(s.cx, s.cy, force);
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
