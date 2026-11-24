import './style.css';
import { L, P } from '../../core/i18n';
import { btn } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { alpha } from '../../kits/arena/color';
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
    const fx = arena.fx;
    const held = new Set<string>();
    /** Show the crosshair once the player has pointed or used the arrows. */
    let hover = false;
    let ended = false;
    /** Arena time each launcher last fired (its barrel kicks back). */
    const firedAt = [-9, -9, -9];

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
        // Rubble, still smoking.
        arena.block(g, x - CITY_W / 2, GROUND_Y - 6, CITY_W * 0.55, 6, c.muted, 1.5, false);
        arena.block(g, x - CITY_W / 2 + CITY_W * 0.4, GROUND_Y - 9, CITY_W * 0.6, 9, c.muted, 1.5, false);
        if (!ended && Math.sin(arena.time * 3 + k * 1.7) > 0.97)
          fx.burst(x, GROUND_Y - 10, c.muted, 1, 25, 4, 1.2, 'dot', -30, -Math.PI / 2, 0.6);
        return;
      }
      // Three towers of fixed (but varied) heights, with lit windows.
      const hs = [18, 28, 22].map((h, i) => h + ((k * 5 + i * 3) % 7));
      const w = CITY_W / 3;
      hs.forEach((h, i) => arena.block(g, x - CITY_W / 2 + i * w, GROUND_Y - h, w, h, c.p[(k + i) % 2 ? 4 : 5], 1.5, true, 0.5));
      g.fillStyle = c.paper;
      g.globalAlpha = arena.dark ? 0.85 : 0.7;
      hs.forEach((h, i) => {
        for (let y = GROUND_Y - h + 4; y < GROUND_Y - 5; y += 6) g.fillRect(x - CITY_W / 2 + i * w + w / 2 - 1.25, y, 2.5, 3);
      });
      g.globalAlpha = 1;
    }

    function drawBase(g: CanvasRenderingContext2D, i: number) {
      const c = arena.colors;
      const b = s.bases[i];
      // A barrel that turns towards the crosshair and kicks back when it fires.
      if (b.alive) {
        const a = Math.atan2(Math.min(AIM_MIN_Y, s.cy) - (GROUND_Y - 13), s.cx - b.x);
        const kick = Math.max(0, 1 - (arena.time - firedAt[i]) / 0.15) * 4;
        g.save();
        g.translate(b.x, GROUND_Y - 13);
        g.rotate(hover ? a : -Math.PI / 2);
        arena.box(g, -kick, -2.5, 13, 5, c.muted, 1.5, false);
        g.restore();
      }
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
      if (!b.alive) return;
      // Interceptors left: a number on the mound, red when out.
      g.font = `800 10px ${arena.family}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = b.ammo ? c.coal : c.bad;
      g.fillText(String(b.ammo), b.x, GROUND_Y - 5.5);
      g.fillStyle = c.fg;
      for (let k = 0; k < b.ammo; k++) g.fillRect(b.x - 15 + (k % 10) * 3, GROUND_Y + 6 + Math.floor(k / 10) * 5, 2, 3.5);
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 25, 0, false);
      // Ground.
      g.fillStyle = c.cell;
      g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      g.strokeStyle = c.ink;
      g.lineWidth = arena.lw * 0.8;
      g.beginPath();
      g.moveTo(0, GROUND_Y);
      g.lineTo(W, GROUND_Y);
      g.stroke();

      s.cities.forEach((ct, k) => drawCity(g, ct.x, ct.alive, k));
      for (let i = 0; i < s.bases.length; i++) drawBase(g, i);

      // Missiles: a trail fading back to where they came in, a glowing head (a diamond if it will split).
      g.lineCap = 'round';
      for (const m of s.missiles) {
        const tail = g.createLinearGradient(m.x0, m.y0, m.x, m.y);
        tail.addColorStop(0, alpha(c.bad, 0));
        tail.addColorStop(1, c.bad);
        g.strokeStyle = tail;
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(m.x0, m.y0);
        g.lineTo(m.x, m.y);
        g.stroke();
        g.fillStyle = alpha(c.bad, 0.3 + 0.15 * Math.sin(arena.time * 14 + m.id));
        g.beginPath();
        g.arc(m.x, m.y, 7, 0, Math.PI * 2);
        g.fill();
        if (m.splitY) {
          g.fillStyle = c.bad;
          g.strokeStyle = c.ink;
          g.lineWidth = arena.lw * 0.6;
          glyphPath(g, DIAMOND, m.x, m.y, 6);
          g.fill();
          g.stroke();
        } else arena.ball(g, m.x, m.y, 3.6, c.bad, false);
      }
      g.lineCap = 'butt';
      // Interceptors: a dashed trail and a mark where they'll burst.
      g.setLineDash([3, 3]);
      for (const sh of s.shots) {
        g.strokeStyle = c.accent;
        g.lineWidth = 1.8;
        g.beginPath();
        g.moveTo(sh.x0, sh.y0);
        g.lineTo(sh.x, sh.y);
        g.stroke();
      }
      g.setLineDash([]);
      for (const sh of s.shots) {
        g.strokeStyle = c.fg;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(sh.tx - 4, sh.ty - 4);
        g.lineTo(sh.tx + 4, sh.ty + 4);
        g.moveTo(sh.tx + 4, sh.ty - 4);
        g.lineTo(sh.tx - 4, sh.ty + 4);
        g.stroke();
        arena.ball(g, sh.x, sh.y, 3, c.accent, false);
      }
      // Blasts: a hot core fading out to the edge, with a bright rim.
      for (const b of s.blasts) {
        const r = blastR(b);
        if (r <= 0.5) continue;
        const col = b.kind === 'shot' ? c.accent : b.kind === 'chain' ? c.p[3] : c.bad;
        const glow = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
        glow.addColorStop(0, alpha(c.paper, 0.95));
        glow.addColorStop(0.35, alpha(col, 0.85));
        glow.addColorStop(1, alpha(col, 0.25));
        g.fillStyle = glow;
        g.beginPath();
        g.arc(b.x, b.y, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = col;
        g.lineWidth = arena.lw;
        g.stroke();
      }

      // Crosshair, with the blast's reach.
      if (hover && !ended) {
        g.strokeStyle = c.fg;
        g.lineWidth = 1.6;
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
      arena.overlay(g);
    }

    const shoot = (x: number, y: number, force = -1) => {
      const ammo = s.bases.map((b) => b.ammo);
      if (fire(s, x, y, force)) {
        const i = s.bases.findIndex((b, k) => b.ammo !== ammo[k]);
        firedAt[i] = arena.time;
        fx.burst(s.bases[i].x, GROUND_Y - 16, arena.colors.accent, 5, 70, 2.5, 0.3, 'spark', 0, -Math.PI / 2, 1.2);
        sfx('shoot', { vol: 0.8 });
        status();
      } else {
        sfx('error', { vol: 0.7 });
        fx.text(
          Math.max(30, Math.min(W - 30, x)),
          Math.min(AIM_MIN_Y, y) - 12,
          L('No ammo', 'Plus de munitions'),
          arena.colors.bad,
          11,
          0.7,
        );
      }
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
        arena.update(dt);
        const c = arena.colors;
        if (ev.killed) {
          sfx('pop', { pitch: Math.min(8, ev.killed * 2) });
          // Chain blasts born this frame mark the missiles that just blew up.
          for (const b of s.blasts)
            if (b.kind === 'chain' && b.age === 0) {
              fx.burst(b.x, b.y, c.p[3], 8, 110, 2.5, 0.45, 'spark', 60);
              fx.text(b.x, b.y - 14, `+${MISSILE_POINTS}`, c.fg, 11, 0.7);
            }
          if (ev.killed >= 3) fx.shake(2, 0.2);
        }
        for (const im of ev.impacts) {
          if (im.wrecked) {
            fx.burst(im.x, GROUND_Y - 8, c.p[4], 12, 150, 4, 0.7, 'square', 300, -Math.PI / 2, Math.PI);
            fx.burst(im.x, GROUND_Y - 8, c.muted, 8, 60, 6, 1, 'dot', -40, -Math.PI / 2, 1);
            fx.ring(im.x, GROUND_Y, c.bad, 6, 40, 0.45, arena.lw * 1.5);
            fx.shake(6, 0.4);
            fx.flash(c.bad, 0.22, 0.35);
          } else {
            fx.burst(im.x, GROUND_Y - 2, c.muted, 6, 70, 3, 0.4, 'dot', 200, -Math.PI / 2, Math.PI * 0.8);
            fx.shake(2, 0.2);
          }
        }
        if (ev.impacts.length) {
          sfx('boom');
          if (ev.impacts.some((i) => i.wrecked)) haptic(30);
        }
        if (ev.killed || ev.cleared) ctx.score(s.score);
        if (ev.killed || ev.impacts.length || incoming(s) !== before) status();
        if (ev.cleared || ev.over) {
          ended = true;
          if (ev.cleared)
            for (const ct of s.cities) if (ct.alive) fx.burst(ct.x, GROUND_Y - 30, c.p[(ct.x | 0) % 5], 8, 160, 3.5, 0.9, 'square', 200);
          fx.flash(ev.cleared ? c.good : c.bad, 0.2, 0.5);
          arena.linger(1.4);
        }
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
