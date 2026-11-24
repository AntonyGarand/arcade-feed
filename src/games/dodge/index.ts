import './style.css';
import { L, P } from '../../core/i18n';
import type { GameDef } from '../../core/types';
import { Arena, type Trace } from '../../kits/arena/arena';
import { approach, outBack } from '../../kits/arena/ease';
import { gestures, keyDir } from '../../kits/gesture/gesture';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { haptic, sfx } from '../../kits/sound/sound';
import { glyphPath } from '../../kits/glyph/glyph';
import {
  BLAST_POINTS,
  CHAIN_TIERS,
  CHAIN_WINDOW,
  createLevel,
  durationFor,
  H,
  GRAZE_POINTS,
  incoming,
  LIFE_BONUS,
  livesFor,
  MAGNET_S,
  PICKUP_LIFE_S,
  PICKUP_POINTS,
  PICKUP_R,
  pickupsFor,
  PLAYER_R,
  SLOW_S,
  starsOut,
  step,
  W,
  type KindId,
  type Power,
} from './rules';

/** Glyph used for pickups (a five-point star). */
const STAR = 4;
/** The player is drawn a little larger than its hit circle: grazes that look close stay fair. */
const DRAW_R = PLAYER_R + 2.5;
/** The last seconds are counted down in the middle of the field. */
const COUNTDOWN = 5;

/** What each kind of run is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [L('Classic', 'Classique'), L('A bit of everything flies at you.', 'Un peu de tout vous fonce dessus.')],
  rain: () => [L('Downpour', 'Averse'), L('A thick rain of small, fast blocks.', 'Une pluie serrée de petits blocs rapides.')],
  sweep: () => [
    L('Sweepers', 'Balayeurs'),
    L('Walls slide across: find the gap.', 'Des murs traversent le terrain : trouvez l’ouverture.'),
  ],
  seekers: () => [L('Seekers', 'Chercheurs'), L('Darts that home in on you for a while.', 'Des dards qui vous pourchassent un moment.')],
  bouncers: () => [L('Bouncers', 'Rebonds'), L('Rubber balls ricochet off every wall.', 'Des balles de caoutchouc rebondissent partout.')],
  shrapnel: () => [L('Shrapnel', 'Éclats'), L('Bombs fall and burst into shards.', 'Des bombes tombent et éclatent en morceaux.')],
};

const POWER_NAMES: Record<Power, () => string> = {
  shield: () => L('Shield!', 'Bouclier!'),
  slow: () => L('Slow motion!', 'Ralenti!'),
  magnet: () => L('Star magnet!', 'Aimant à étoiles!'),
  blast: () => L('Blast!', 'Déflagration!'),
};

export const dodge: GameDef = {
  id: 'dodge',
  get name() {
    return L('Dodge', 'Esquive');
  },
  get rules() {
    return L('Dodge everything that flies until time runs out.', 'Esquivez tout ce qui vole jusqu’à la fin du temps.');
  },
  category: 'reflex',
  help: () => ({
    goal: L('Stay in one piece until the timer runs out.', 'Tenez bon sans trop de coups jusqu’à la fin du chrono.'),
    steps: [
      L(
        'Each run has its own mix: falling blocks, saws from the sides, bars or sliding walls with a gap, homing darts, bouncing balls, bombs that burst into shards.',
        'Chaque partie a son mélange : blocs qui tombent, scies des côtés, barres ou murs mobiles avec une ouverture, dards chercheurs, balles qui rebondissent, bombes qui éclatent.',
      ),
      L(
        'A hit costs a heart and leaves you safe for a moment (you blink).',
        'Un coup coûte un cœur et vous protège un instant (vous clignotez).',
      ),
      L(
        'Near misses and stars build a chain: 3 gives a shield, 6 slow motion, 10 a star magnet, 15 a blast that clears the field.',
        'Frôlements et étoiles font une chaîne : 3 donnent un bouclier, 6 le ralenti, 10 un aimant à étoiles, 15 une déflagration qui vide le terrain.',
      ),
      L(
        'Drag anywhere: your dot moves with your finger without hiding under it.',
        'Glissez n’importe où : votre pastille suit votre doigt sans se cacher dessous.',
      ),
      L('Keyboard: arrows or WASD to move, P to pause.', 'Clavier : flèches ou WASD pour bouger, P pour la pause.'),
    ],
    tips: [
      L('Red marks on the edges show what is about to come in.', 'Les marques rouges sur les bords annoncent ce qui s’en vient.'),
      L(
        `10 points per second, ${PICKUP_POINTS} per star, ${GRAZE_POINTS}+ per near miss, ${LIFE_BONUS} per heart left at the end.`,
        `10 points par seconde, ${PICKUP_POINTS} par étoile, ${GRAZE_POINTS}+ par frôlement, ${LIFE_BONUS} par cœur restant à la fin.`,
      ),
      L(
        'A hit ends the chain, and the shield takes the hit instead of a heart.',
        'Un coup met fin à la chaîne; le bouclier encaisse le coup à la place d’un cœur.',
      ),
    ],
  }),
  stars: (d) => {
    const base = durationFor(d) * 10;
    const picks = pickupsFor(d);
    const lives = livesFor(d);
    return [
      base + Math.floor(picks * 0.4) * PICKUP_POINTS + (lives - 1) * LIFE_BONUS,
      // Chain rewards (near misses, the magnet's star shower) are worth about this much more.
      base + Math.floor(picks * 0.75) * PICKUP_POINTS + lives * LIFE_BONUS + 100,
    ];
  },
  par: (d) => durationFor(d),
  pad: () => ({ left: 'dpad' }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const max = livesFor(ctx.difficulty);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const held = new Set<number>();
    let offset = { x: 0, y: 0 };
    let shown = -1;
    /** Where the player looks (smoothed direction of travel). */
    let lookX = 0;
    let lookY = -0.4;
    const TRAIL = 8;
    const trail = new Float32Array(TRAIL * 2);
    let trailN = 0;
    let trailAt = 0;
    let ended = false;
    /** Last countdown second announced. */
    let counted = COUNTDOWN + 1;
    /** Hurt wobble on the player, 1 → 0. */
    let hurtT = 0;
    const star: Trace = (g, r) => glyphPath(g, STAR, 0, 0, r);

    const status = () => {
      const left = Math.max(0, Math.ceil(s.duration - s.time));
      shown = left;
      ctx.status(
        [
          P(left, ['s left', 's left'], ['s restante', 's restantes']),
          P(s.pickups, ['star', 'stars'], ['étoile', 'étoiles']),
          s.chain > 1 ? L(`chain ${s.chain}`, `chaîne ${s.chain}`) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
    };

    /** Hazard stripes across a box, in the shaded tone of the hazard. */
    function stripes(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
      g.save();
      g.beginPath();
      g.roundRect(x + 1, y + 1, w - 2, h - 2, arena.r(2));
      g.clip();
      g.strokeStyle = arena.tone(arena.colors.bad).lo;
      g.lineWidth = 3;
      g.beginPath();
      for (let d = -h; d < w; d += 9) {
        g.moveTo(x + d, y + h);
        g.lineTo(x + d + h, y);
      }
      g.stroke();
      g.restore();
    }

    /** A spinning saw blade of radius r. */
    function saw(g: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number) {
      const c = arena.colors;
      const t = arena.tone(c.bad);
      g.save();
      g.translate(x, y);
      g.rotate(spin);
      g.beginPath();
      const teeth = 10;
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i * Math.PI) / teeth;
        const rr = i % 2 ? r * 0.74 : r;
        if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else g.moveTo(rr, 0);
      }
      g.closePath();
      g.fillStyle = c.bad;
      g.fill();
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.7;
      g.lineJoin = 'round';
      g.stroke();
      g.fillStyle = t.lo;
      g.beginPath();
      g.arc(0, 0, r * 0.42, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = t.hi;
      g.beginPath();
      g.arc(0, 0, r * 0.16, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    /** A homing dart pointing where it flies, its eye lit while it still steers. */
    function dart(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, homing: boolean) {
      const c = arena.colors;
      const t = arena.tone(c.bad);
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.beginPath();
      g.moveTo(r * 1.35, 0);
      g.lineTo(-r * 0.9, r * 0.95);
      g.lineTo(-r * 0.45, 0);
      g.lineTo(-r * 0.9, -r * 0.95);
      g.closePath();
      g.fillStyle = c.bad;
      g.fill();
      g.strokeStyle = t.edge;
      g.lineWidth = arena.lw * 0.7;
      g.lineJoin = 'round';
      g.stroke();
      g.fillStyle = homing ? c.paper : t.lo;
      g.beginPath();
      g.arc(r * 0.25, 0, r * 0.28, 0, Math.PI * 2);
      g.fill();
      if (homing) {
        g.fillStyle = c.coal;
        g.beginPath();
        g.arc(r * 0.32, 0, r * 0.13, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }

    /** A bomb with a sparking fuse, blinking faster as it nears the height it bursts at. */
    function bomb(g: CanvasRenderingContext2D, x: number, y: number, r: number, toGo: number) {
      const c = arena.colors;
      const hot = toGo < 60 && Math.floor(arena.time * (toGo < 25 ? 16 : 8)) % 2 === 0;
      arena.ball(g, x, y, r, hot ? c.bad : c.coal);
      g.strokeStyle = c.accent;
      g.lineWidth = arena.lw * 0.6;
      g.beginPath();
      g.moveTo(x + r * 0.4, y - r * 0.8);
      g.quadraticCurveTo(x + r * 0.9, y - r * 1.5, x + r * 1.2, y - r * 1.2);
      g.stroke();
      if (Math.sin(arena.time * 20 + x) > 0) {
        g.fillStyle = c.accent;
        g.fillRect(x + r * 1.1, y - r * 1.4, 3, 3);
      }
      // Where it bursts: a faint ring of the blast it's about to throw.
      if (toGo < 80) {
        g.strokeStyle = c.bad;
        g.lineWidth = arena.lw * 0.6;
        g.globalAlpha = 0.35 * (1 - Math.max(0, toGo) / 80);
        g.setLineDash([3, 4]);
        g.beginPath();
        g.arc(x, y + Math.max(0, toGo), 34, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
    }

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);
      // Time bar along the top.
      g.fillStyle = c.cellAlt;
      g.fillRect(0, 0, W, 7);
      const f = Math.min(1, s.time / s.duration);
      const left = s.duration - s.time;
      if (f > 0) arena.block(g, -4, -4, W * f + 4, 11, left < COUNTDOWN ? c.good : c.accent, 4, false, 0.6);
      // Slow motion: a cool wash over the field and its time left under the timer.
      if (s.slow > 0) {
        g.fillStyle = c.p[4];
        g.globalAlpha = 0.1 * Math.min(1, s.slow * 2);
        g.fillRect(0, 7, W, H - 7);
        g.globalAlpha = 0.8;
        g.fillRect(0, 7, (W * s.slow) / SLOW_S, 3);
        g.globalAlpha = 1;
      }
      if (s.magnet > 0) {
        g.fillStyle = c.p[3];
        g.globalAlpha = 0.8;
        g.fillRect(0, 10, (W * s.magnet) / MAGNET_S, 3);
        g.globalAlpha = 1;
      }
      // The chain meter along the bottom: drains until the chain runs out, with the next milestone.
      if (s.chain > 0 && !ended) {
        const k = Math.max(0, s.chainLeft / CHAIN_WINDOW);
        g.fillStyle = c.accent;
        g.globalAlpha = 0.85;
        g.fillRect(0, H - 4, W * k, 4);
        g.globalAlpha = 1;
        g.fillStyle = c.fg;
        g.textAlign = 'left';
        g.font = `800 11px ${arena.family}`;
        g.fillText(s.tier < CHAIN_TIERS.length ? `×${s.chain} / ${CHAIN_TIERS[s.tier]}` : `×${s.chain}`, 6, H - 9);
      }
      // The last seconds, big and faint behind the action.
      if (left < COUNTDOWN && left > 0 && !ended) {
        const n = Math.ceil(left);
        const k = n - left;
        g.globalAlpha = 0.2 * (1 - k * 0.6);
        g.fillStyle = c.fg;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `800 ${(96 * (1.15 - 0.15 * Math.min(1, k * 4))).toFixed(1)}px ${arena.family}`;
        g.fillText(String(n), W / 2, H * 0.42);
        g.globalAlpha = 1;
        g.textBaseline = 'alphabetic';
      }

      for (const p of starsOut(s)) {
        const age = s.time - p.t;
        const rest = PICKUP_LIFE_S - age;
        // Pops in, then blinks faster and faster before it goes.
        if (rest < 1.5 && Math.floor(rest * (rest < 0.6 ? 14 : 8)) % 2) continue;
        const pop = outBack(Math.min(1, age / 0.35), 2.4);
        const tw = Math.sin(arena.time * 5 + p.x);
        const t = arena.tone(c.p[3]);
        g.fillStyle = t.glow;
        g.beginPath();
        g.arc(p.x, p.y, PICKUP_R * (1.6 + 0.2 * tw) * pop, 0, Math.PI * 2);
        g.fill();
        // Time left on the pickup, as a ring that empties.
        g.strokeStyle = arena.dark ? t.hi : t.edge;
        g.globalAlpha = 0.6;
        g.lineWidth = arena.lw * 0.6;
        g.lineCap = 'round';
        g.beginPath();
        g.arc(p.x, p.y, PICKUP_R * 1.8 * pop, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, rest / PICKUP_LIFE_S));
        g.stroke();
        g.lineCap = 'butt';
        g.globalAlpha = 1;
        arena.gem(g, p.x, p.y, PICKUP_R, c.p[3], star, true, pop * (1 + 0.08 * tw), Math.sin(arena.time * 2 + p.y) * 0.25);
      }
      // Edge markers for what's about to enter: pulsing arrows.
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(arena.time * 9));
      g.fillStyle = c.bad;
      g.strokeStyle = arena.tone(c.bad).edge;
      g.lineWidth = arena.lw * 0.5;
      g.lineJoin = 'round';
      g.globalAlpha = pulse;
      for (const z of incoming(s)) {
        g.beginPath();
        if (z.kind === 'sweep') {
          // A strip down the side it slides in from.
          g.fillRect(z.vx > 0 ? 2 : W - 5, z.y + 2, 3, z.h - 4);
          continue;
        }
        if (z.kind === 'disc') {
          const y = z.y + z.h / 2;
          const x = z.vx > 0 ? 3 : W - 3;
          const k = z.vx > 0 ? 1 : -1;
          g.moveTo(x, y - 8);
          g.lineTo(x + 11 * k, y);
          g.lineTo(x, y + 8);
        } else {
          // A strip shows the span of what's coming, an arrow its middle.
          const x = z.x + z.w / 2;
          g.fillRect(z.x + 2, 8, z.w - 4, 3);
          g.moveTo(x - 8, 10);
          g.lineTo(x, 20);
          g.lineTo(x + 8, 10);
        }
        g.closePath();
        g.fill();
        g.stroke();
      }
      g.globalAlpha = 1;
      for (const z of s.live) {
        const zx = z.x + z.w / 2;
        const zy = z.y + z.h / 2;
        if (z.kind === 'disc' || z.kind === 'shard') saw(g, zx, zy, z.w / 2, arena.time * 7 * Math.sign(z.vx || 1));
        else if (z.kind === 'seeker') dart(g, zx, zy, z.w / 2, Math.atan2(z.vy, z.vx), z.life > 0);
        else if (z.kind === 'bomb') bomb(g, zx, zy, z.w / 2, z.life - zy);
        else if (z.kind === 'bouncer') {
          // A rubber ball with a spinning band, a little faded once it stops bouncing and heads out.
          if (z.life <= 0) g.globalAlpha = 0.75;
          arena.ball(g, zx, zy, z.w / 2, c.bad);
          g.strokeStyle = arena.tone(c.bad).hi;
          g.lineWidth = arena.lw * 0.8;
          g.beginPath();
          g.arc(zx, zy, z.w * 0.3, arena.time * 4, arena.time * 4 + Math.PI);
          g.stroke();
          g.globalAlpha = 1;
        } else {
          const flat = z.kind === 'bar' || z.kind === 'sweep';
          arena.block(g, z.x, z.y, z.w, z.h, c.bad, flat ? 2 : 4);
          stripes(g, z.x, z.y, z.w, z.h - 2);
          g.strokeStyle = arena.tone(c.bad).edge;
          g.lineWidth = arena.lw * 0.8;
          g.beginPath();
          g.roundRect(z.x, z.y, z.w, z.h, arena.r(flat ? 2 : 4));
          g.stroke();
        }
      }
      // The player: a trail, then the ball blinking while safe after a hit, eyes looking ahead.
      if (!ended || s.lives > 0) {
        g.fillStyle = arena.tone(c.accent).glow;
        for (let i = 0; i < trailN; i++) {
          const k = (trailAt - 1 - i + TRAIL) % TRAIL;
          const fi = 1 - i / TRAIL;
          g.globalAlpha = fi * 0.7;
          g.beginPath();
          g.arc(trail[k * 2], trail[k * 2 + 1], DRAW_R * (0.3 + 0.55 * fi), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
        // Magnet: a dashed ring that turns, pulling stars in.
        if (s.magnet > 0) {
          g.strokeStyle = c.p[3];
          g.globalAlpha = 0.45 * Math.min(1, s.magnet);
          g.lineWidth = arena.lw * 0.6;
          g.setLineDash([5, 7]);
          g.lineDashOffset = -arena.time * 30;
          g.beginPath();
          g.arc(s.px, s.py, 40 + Math.sin(arena.time * 5) * 3, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
          g.lineDashOffset = 0;
          g.globalAlpha = 1;
        }
        // The chain's shield: a hexagon around the dot until it takes a hit.
        if (s.shield) {
          g.fillStyle = arena.tone(c.good).glow;
          g.strokeStyle = c.good;
          g.lineWidth = arena.lw;
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = arena.time * 1.5 + (i * Math.PI) / 3;
            const r = DRAW_R + 6;
            if (i) g.lineTo(s.px + Math.cos(a) * r, s.py + Math.sin(a) * r);
            else g.moveTo(s.px + Math.cos(a) * r, s.py + Math.sin(a) * r);
          }
          g.closePath();
          g.fill();
          g.stroke();
        }
        // Safe after a hit: a shield bubble that fades as the safety runs out.
        if (s.invulnerable > 0) {
          g.strokeStyle = arena.tone(c.accent).hi;
          g.globalAlpha = Math.min(1, s.invulnerable * 1.5) * 0.7;
          g.lineWidth = arena.lw * 0.7;
          g.beginPath();
          g.arc(s.px, s.py, DRAW_R + 4 + Math.sin(arena.time * 12), 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }
        if (!s.invulnerable || Math.floor(s.invulnerable * 10) % 2 === 0) {
          const px = s.px + (hurtT > 0 ? Math.sin(hurtT * 40) * hurtT * 3 : 0);
          arena.ball(g, px, s.py, DRAW_R, c.accent);
          const ex = lookX * 2.6;
          const ey = lookY * 2.6;
          const wince = hurtT > 0.45;
          for (const dx of [-4.4, 4.4]) {
            const x = px + dx + ex * 0.6;
            const y = s.py - 1.8 + ey * 0.6;
            g.fillStyle = c.paper;
            g.strokeStyle = arena.tone(c.accent).edge;
            g.lineWidth = arena.lw * 0.4;
            g.beginPath();
            // Squeezed shut for a moment after a hit.
            if (wince) g.ellipse(x, y, 3.4, 1.1, 0, 0, Math.PI * 2);
            else g.arc(x, y, 3.4, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            if (wince) continue;
            g.fillStyle = c.coal;
            g.beginPath();
            g.arc(x + ex * 0.5, y + ey * 0.5, 1.7, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      arena.overlay(g);
    }

    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 4,
      onDown(p) {
        offset = { x: s.px - p.x, y: s.py - p.y };
        s.target = { x: s.px, y: s.py };
      },
      onMove(p, from) {
        if (from) s.target = { x: p.x + offset.x, y: p.y + offset.y };
      },
    });

    const syncKeys = () => {
      s.kx = (held.has(1) ? 1 : 0) - (held.has(3) ? 1 : 0);
      s.ky = (held.has(2) ? 1 : 0) - (held.has(0) ? 1 : 0);
    };

    ctx.score(0);
    ctx.lives(s.lives, max);
    status();
    return {
      draw,
      frame(dt) {
        const before = s.score;
        const ox = s.px;
        const oy = s.py;
        const picks = s.pickups;
        const chain = s.chain;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        // A drag target outside the field is clamped like the dot.
        if (s.target) s.target = { x: s.px, y: s.py };
        // Eyes follow the direction of travel; the trail records the path.
        const mx = s.px - ox;
        const my = s.py - oy;
        const m = Math.hypot(mx, my);
        if (m > 0.3) {
          lookX = approach(lookX, mx / m, 12, dt);
          lookY = approach(lookY, my / m, 12, dt);
        }
        if (m > 0.5 || trailN) {
          trail[trailAt * 2] = s.px;
          trail[trailAt * 2 + 1] = s.py;
          trailAt = (trailAt + 1) % TRAIL;
          trailN = m > 0.5 ? Math.min(TRAIL, trailN + 1) : Math.max(0, trailN - 1);
        }
        if (s.score !== before) ctx.score(s.score);
        if (s.pickups > picks) {
          const p = s.stars.find((q) => q.taken && Math.hypot(q.x - s.px, q.y - s.py) < PICKUP_R + PLAYER_R + 2);
          const x = p?.x ?? s.px;
          const y = p?.y ?? s.py;
          fx.burst(x, y, c.p[3], 12, 120, 3.5, 0.5, 'square', 120);
          fx.ring(x, y, c.p[3], PICKUP_R, PICKUP_R * 3, 0.35, arena.lw);
          fx.text(x, y - 14, `+${PICKUP_POINTS}`, c.p[3], 13);
          sfx('coin', { pitch: s.pickups % 4 });
        }
        hurtT = Math.max(0, hurtT - dt * 1.6);
        if (ev.hurt) {
          hurtT = 1;
          haptic(60);
          ctx.lives(s.lives, max);
          fx.shake(6, 0.35);
          fx.flash(c.bad, 0.3, 0.35);
          fx.burst(s.px, s.py, c.bad, 14, 150, 3.5, 0.5);
          fx.ring(s.px, s.py, c.bad, PLAYER_R, PLAYER_R * 4, 0.4, arena.lw * 1.4);
        }
        if (ev.shielded) {
          haptic(40);
          sfx('hit', { pitch: 6 });
          fx.ring(s.px, s.py, c.good, DRAW_R + 6, PLAYER_R * 5, 0.45, arena.lw * 1.5);
          fx.burst(s.px, s.py, c.good, 16, 160, 3, 0.5, 'spark', 0);
          fx.text(s.px, s.py - DRAW_R - 12, L('blocked!', 'bloqué!'), c.good, 13);
        }
        // Near misses: sparks on the side the hazard brushed past, and the chain counts up.
        for (const z of ev.grazes) {
          const a = Math.atan2(z.y - s.py, z.x - s.px);
          fx.burst(s.px + Math.cos(a) * DRAW_R, s.py + Math.sin(a) * DRAW_R, c.fg, 6, 90, 2, 0.3, 'spark', 0, a + Math.PI, 1.6);
        }
        if (ev.grazes.length) {
          if (s.chain >= 2) comboPop(fx, s.px, s.py - DRAW_R - 6, s.chain, c.accent);
          else {
            fx.text(s.px, s.py - DRAW_R - 10, L('close!', 'de justesse!'), c.fg, 12, 0.6);
            sfx('tick', { pitch: 7, vol: 0.6 });
          }
        }
        for (const b of ev.bursts) {
          fx.ring(b.x, b.y, c.bad, 4, 34, 0.35, arena.lw * 1.2);
          fx.burst(b.x, b.y, c.accent, 12, 140, 3, 0.45, 'spark', 0);
          sfx('boom', { vol: 0.6 });
        }
        if (ev.unlocked) {
          comboTier(fx, ev.tier, c.accent, POWER_NAMES[ev.unlocked]());
          if (ev.unlocked === 'blast') {
            fx.ring(s.px, s.py, c.accent, PLAYER_R, W, 0.6, arena.lw * 2);
            for (const b of ev.blasted) {
              fx.burst(b.x, b.y, c.bad, 10, 150, 3.5, 0.5, 'square', 150);
              fx.text(b.x, b.y, `+${BLAST_POINTS}`, c.fg, 11, 0.6);
            }
            sfx('boom');
          } else if (ev.unlocked === 'shield') fx.ring(s.px, s.py, c.good, PLAYER_R, PLAYER_R * 4, 0.4, arena.lw);
          else if (ev.unlocked === 'magnet') for (const p of starsOut(s)) fx.ring(p.x, p.y, c.p[3], 2, PICKUP_R * 2.5, 0.4, arena.lw);
        }
        const left = Math.ceil(s.duration - s.time);
        if (left < counted && left <= COUNTDOWN && left > 0) {
          counted = left;
          sfx('tick', { pitch: 12 - left * 2 });
        }
        if (ev.picked || ev.grazes.length || ev.hurt || ev.shielded || left !== shown || (chain && !s.chain)) status();
        if (ev.won) {
          ended = true;
          for (let i = 0; i < 4; i++) fx.burst(s.px, s.py, c.p[i], 10, 190, 4, 0.9, 'square', 200);
          fx.ring(s.px, s.py, c.good, PLAYER_R, 90, 0.6, arena.lw * 1.5);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          fx.burst(s.px, s.py, c.accent, 16, 170, 4, 0.7);
          arena.linger();
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const dir = keyDir(e.key);
        if (dir === -1) return false;
        if (e.type === 'keydown') held.add(dir);
        else held.delete(dir);
        s.target = null;
        syncKeys();
        return true;
      },
      destroy() {
        stopGestures();
        arena.destroy();
      },
    };
  },
};
