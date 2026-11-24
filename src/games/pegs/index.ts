import './style.css';
import { L, P } from '../../core/i18n';
import { btn, leftRight } from '../../core/pad';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { outCubic } from '../../kits/arena/ease';
import { gestures } from '../../kits/gesture/gesture';
import { comboPop, comboTier } from '../../kits/combo/combo';
import { haptic, sfx } from '../../kits/sound/sound';
import {
  aimAt,
  aimPath,
  BALL_BONUS,
  BALL_R,
  ballsFor,
  BUCKET_H,
  BUCKET_Y,
  BUMPER_R,
  createLevel,
  H,
  LAUNCH,
  multiplier,
  PEG_R,
  shoot,
  SHOT_TIERS,
  step,
  targetsFor,
  targetsLeft,
  W,
  type KindId,
  type Power,
} from './rules';

/** What each kind of field is called on the start gate. */
const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  scatter: () => [L('Peg field', 'Champ de chevilles'), L('A classic field of pegs.', 'Un champ de chevilles classique.')],
  rings: () => [L('Rings', 'Anneaux'), L('Rings of pegs around bouncy bumpers.', 'Des anneaux de chevilles autour de pare-chocs.')],
  wheels: () => [
    L('Wheels', 'Roues'),
    L('Two wheels of pegs spin: time your shot.', 'Deux roues de chevilles tournent : choisissez le moment.'),
  ],
  mines: () => [
    L('Minefield', 'Champ de mines'),
    L('Bomb pegs everywhere: set off chain blasts.', 'Des bombes partout : déclenchez des explosions en chaîne.'),
  ],
  fortress: () => [
    L('Fortress', 'Forteresse'),
    L('Armoured orange pegs hide down low.', 'Des chevilles orange blindées se cachent en bas.'),
  ],
};

/** What a shot milestone unlocked, under its banner. */
const POWER_NAMES: Record<Power, () => string> = {
  bucket: () => L('Big bucket!', 'Gros panier!'),
  blast: () => L('Blast!', 'Explosion!'),
  ball: () => L('Free ball!', 'Balle gratuite!'),
};

export const pegs: GameDef = {
  id: 'pegs',
  get name() {
    return L('Pegs', 'Chevilles');
  },
  get rules() {
    return L('Shoot the ball to clear every orange peg.', 'Lancez la balle pour retirer les chevilles orange.');
  },
  category: 'aim',
  help: () => ({
    goal: L('Clear every orange peg before you run out of balls.', 'Retirez toutes les chevilles orange avant de manquer de balles.'),
    steps: [
      L(
        'Aim from the top and shoot: the ball bounces off the pegs as it falls.',
        'Visez du haut et tirez : la balle rebondit sur les chevilles en tombant.',
      ),
      L(
        'Every peg the ball hits lights up and vanishes once the ball leaves play.',
        'Chaque cheville touchée s’allume et disparaît quand la balle sort du jeu.',
      ),
      L(
        'Orange pegs are the square ones. A ball that lands in the moving bucket comes back.',
        'Les chevilles orange sont carrées. Une balle qui tombe dans le panier mobile vous est rendue.',
      ),
      L(
        'Bombs light the pegs around them, green pegs give a ball back, armoured orange pegs take two hits, bumpers kick the ball.',
        'Les bombes allument les chevilles voisines, les vertes redonnent une balle, les orange blindées demandent deux coups, les pare-chocs relancent la balle.',
      ),
      L(
        'Touch and drag to aim along the guide, release to shoot (with a mouse: point, click).',
        'Touchez et glissez pour viser selon le guide, relâchez pour tirer (à la souris : pointez, cliquez).',
      ),
      L('Keyboard: ← → or A D to aim, Space to shoot, P to pause.', 'Clavier : ← → ou A D pour viser, Espace pour tirer, P pour la pause.'),
    ],
    tips: [
      L(
        'Every 4 pegs hit in one shot raise its multiplier (up to ×5): long rallies pay.',
        'Toutes les 4 chevilles touchées d’un même tir, le multiplicateur monte (jusqu’à ×5) : les longs rebonds paient.',
      ),
      L(
        `Combos: ${SHOT_TIERS[0]} pegs in one shot widen the bucket, ${SHOT_TIERS[1]} set off a blast, ${SHOT_TIERS[2]} earn a free ball.`,
        `Combos : ${SHOT_TIERS[0]} chevilles d’un même tir élargissent le panier, ${SHOT_TIERS[1]} font exploser, ${SHOT_TIERS[2]} donnent une balle.`,
      ),
      L(`Each ball left at the end is worth ${BALL_BONUS} points.`, `Chaque balle restante à la fin vaut ${BALL_BONUS} points.`),
    ],
  }),
  stars: (d) =>
    byLevel(d, [
      [2650, 3700],
      [3100, 4300],
      [3500, 4900],
      [4100, 5700],
      [4700, 6500],
    ] as const),
  par: (d) => 30 + targetsFor(d) * 5,
  pad: () => ({ left: leftRight(), right: [btn(' ', 'fire', L('Shoot', 'Tirer'))] }),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const [kindName, kindBlurb] = KIND_NAMES[s.kind]();
    ctx.variant({ id: s.kind, name: kindName, blurb: kindBlurb });
    const max = ballsFor(ctx.difficulty);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    const n = s.pegs.length;
    /** Arena time each peg lit up (-1: not lit), and which pegs have already popped. */
    const litAt = new Float32Array(n).fill(-1);
    const popped = new Uint8Array(n);
    /** Pegs that started armoured (they keep their cracked plate once hit). */
    const armoured = Uint8Array.from(s.pegs, (p) => (p.hp > 1 ? 1 : 0));
    /** When each cleared peg pops (arena time): lit pegs pop one after another once the ball is gone. */
    const popAt = new Float32Array(n).fill(-1);
    const TRAIL = 9;
    const trail = new Float32Array(TRAIL * 2);
    let trailN = 0;
    let trailAt = 0;
    let shotStart = 0;
    let lastMult = 1;
    let ended = false;
    /** Arena time each bumper last kicked (for its flash). */
    const bumpAt = s.bumpers.map(() => -1);

    const status = () =>
      ctx.status(
        [
          P(targetsLeft(s), ['orange peg left', 'orange pegs left'], ['cheville orange restante', 'chevilles orange restantes']),
          s.flying && multiplier(s) > 1 ? `×${multiplier(s)}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      arena.field(g, 0, 0, W, H, 20, 0, false);
      // Aim guide: a dotted arc, fading out, while waiting to shoot.
      if (!s.flying && !ended) {
        g.fillStyle = c.fg;
        const path = aimPath(s, 0.5);
        for (let i = 0; i < path.length; i += 2) {
          g.globalAlpha = 0.65 * (1 - i / path.length);
          g.beginPath();
          g.arc(path[i].x, path[i].y, 2 - i / path.length, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      // Wheels: a faint track under each spinning ring.
      const tracks = new Set<string>();
      g.strokeStyle = c.muted;
      g.lineWidth = arena.lw * 0.6;
      g.setLineDash([3, 5]);
      g.globalAlpha = 0.5;
      for (const p of s.pegs) {
        const o = p.orbit;
        if (!o || tracks.has(`${o.cx},${o.cy}`)) continue;
        tracks.add(`${o.cx},${o.cy}`);
        g.beginPath();
        g.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
        g.stroke();
      }
      g.setLineDash([]);
      g.globalAlpha = 1;
      // Bumpers: violet discs with a ring that flashes when they kick.
      s.bumpers.forEach((b, i) => {
        const k = bumpAt[i] < 0 ? 0 : Math.max(0, 1 - (arena.time - bumpAt[i]) / 0.25);
        const tone = arena.tone(c.p[4]);
        if (k > 0) {
          g.fillStyle = tone.glow;
          g.beginPath();
          g.arc(b.x, b.y, BUMPER_R * (1.4 + k), 0, Math.PI * 2);
          g.fill();
        }
        arena.ball(g, b.x, b.y, BUMPER_R * (1 + 0.15 * k), k > 0 ? tone.hi : c.p[4]);
        g.strokeStyle = tone.edge;
        g.lineWidth = arena.lw * 0.8;
        g.beginPath();
        g.arc(b.x, b.y, BUMPER_R * 0.5, 0, Math.PI * 2);
        g.stroke();
      });
      for (let i = 0; i < n; i++) {
        const p = s.pegs[i];
        if (p.gone && (popAt[i] < 0 || arena.time >= popAt[i])) continue;
        // Targets are orange rounded squares, plain pegs blue balls, bombs dark, gold pegs green;
        // lit pegs glow and turn light.
        const base = p.target ? c.p[0] : p.trait === 'bomb' ? c.coal : p.trait === 'gold' ? c.good : c.p[1];
        let r = PEG_R;
        let fill = base;
        if (p.lit) {
          const age = arena.time - litAt[i];
          r = PEG_R * (1 + 0.45 * (1 - outCubic(age / 0.25)));
          fill = arena.tone(base).hi;
          g.fillStyle = arena.tone(base).glow;
          g.beginPath();
          g.arc(p.x, p.y, PEG_R * (1.9 + 0.15 * Math.sin(arena.time * 10 + i)), 0, Math.PI * 2);
          g.fill();
        }
        if (p.target) arena.block(g, p.x - r - 1, p.y - r - 1, r * 2 + 2, r * 2 + 2, fill, 3, !p.lit, 0.8);
        else arena.ball(g, p.x, p.y, r, fill, !p.lit);
        if (!p.lit) drawTrait(g, p, i);
      }
      // Bucket: a tub with a dark opening and a rim.
      const bl = s.bucketX - s.bucketW / 2;
      arena.block(g, bl, BUCKET_Y, s.bucketW, BUCKET_H, c.accent, 4);
      g.fillStyle = arena.tone(c.accent).lo;
      g.beginPath();
      g.roundRect(bl + 4, BUCKET_Y + 2.5, s.bucketW - 8, 3.5, 2);
      g.fill();
      // Launcher: a barrel along the aim on a round base.
      const bx = LAUNCH.x + Math.sin(s.aim) * 18;
      const by = LAUNCH.y + Math.cos(s.aim) * 18;
      g.lineCap = 'round';
      g.strokeStyle = arena.tone(c.accent).edge;
      g.lineWidth = 11;
      g.beginPath();
      g.moveTo(LAUNCH.x, LAUNCH.y);
      g.lineTo(bx, by);
      g.stroke();
      g.strokeStyle = c.accent;
      g.lineWidth = 11 - 2 * arena.lw * 0.8;
      g.stroke();
      g.strokeStyle = arena.tone(c.accent).hi;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(LAUNCH.x - Math.cos(s.aim) * 2, LAUNCH.y + Math.sin(s.aim) * 2);
      g.lineTo(bx - Math.cos(s.aim) * 2, by + Math.sin(s.aim) * 2);
      g.stroke();
      g.lineCap = 'butt';
      arena.ball(g, LAUNCH.x, LAUNCH.y, 12, c.accent);
      // Ball, with a trail while it flies.
      const ballFill = arena.dark ? c.fg : c.cell;
      if (s.flying) {
        g.fillStyle = arena.tone(c.accent).glow;
        for (let i = 0; i < trailN; i++) {
          const k = (trailAt - 1 - i + TRAIL) % TRAIL;
          const f = 1 - i / TRAIL;
          g.globalAlpha = f;
          g.beginPath();
          g.arc(trail[k * 2], trail[k * 2 + 1], BALL_R * (0.3 + 0.6 * f), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      if (!ended) arena.ball(g, s.flying ? s.bx : bx, s.flying ? s.by : by, BALL_R, ballFill);
      // Combo meter along the top: pegs hit this shot towards the next milestone.
      if (s.flying && s.hits > 0 && s.tier < SHOT_TIERS.length) {
        const from = s.tier ? SHOT_TIERS[s.tier - 1] : 0;
        const k = (s.hits - from) / (SHOT_TIERS[s.tier] - from);
        g.globalAlpha = 0.85;
        g.fillStyle = c.muted;
        g.fillRect(0, 0, W, 4);
        g.fillStyle = c.accent;
        g.fillRect(0, 0, W * k, 4);
        g.globalAlpha = 1;
      }
      arena.overlay(g);
    }

    /** Marks on special pegs: a fuse on bombs, a + on gold pegs, a plate (then a crack) on armour. */
    function drawTrait(g: CanvasRenderingContext2D, p: (typeof s.pegs)[number], i: number) {
      const c = arena.colors;
      g.lineWidth = arena.lw * 0.7;
      if (p.trait === 'bomb') {
        g.strokeStyle = c.accent;
        g.beginPath();
        g.moveTo(p.x + 3, p.y - 4);
        g.quadraticCurveTo(p.x + 5, p.y - 9, p.x + 8, p.y - 8);
        g.stroke();
        if (Math.sin(arena.time * 14 + i) > 0) {
          g.fillStyle = c.bad;
          g.fillRect(p.x + 7, p.y - 10, 2.5, 2.5);
        }
      } else if (p.trait === 'gold') {
        g.fillStyle = c.paper;
        g.fillRect(p.x - 3.5, p.y - 1, 7, 2);
        g.fillRect(p.x - 1, p.y - 3.5, 2, 7);
      }
      if (p.target && (p.hp > 1 || armoured[i])) {
        const t = arena.tone(c.p[0]);
        g.strokeStyle = t.edge;
        g.beginPath();
        g.roundRect(p.x - PEG_R + 2, p.y - PEG_R + 2, PEG_R * 2 - 4, PEG_R * 2 - 4, 1.5);
        g.stroke();
        g.fillStyle = t.edge;
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          g.fillRect(p.x + dx * (PEG_R - 4) - 0.8, p.y + dy * (PEG_R - 4) - 0.8, 1.6, 1.6);
        if (p.hp <= 1) {
          // Cracked: one more hit lights it.
          g.beginPath();
          g.moveTo(p.x - 4, p.y - 5);
          g.lineTo(p.x, p.y - 1);
          g.lineTo(p.x - 2, p.y + 2);
          g.lineTo(p.x + 3, p.y + 5);
          g.stroke();
        }
      }
    }

    /** Effects for what changed this frame: newly lit pegs, popped pegs, a rising multiplier. */
    let lits = 0;
    const queue: number[] = [];
    let popCombo = 0;
    let lastCalled = false;
    function react(gain: number) {
      const c = arena.colors;
      for (let i = 0; i < n; i++) {
        const p = s.pegs[i];
        const base = p.target ? c.p[0] : c.p[1];
        if (p.lit && litAt[i] < 0) {
          litAt[i] = arena.time;
          sfx('hit', { pitch: Math.min(12, lits++) });
          fx.ring(p.x, p.y, base, PEG_R, PEG_R * 3, 0.3, arena.lw);
          fx.burst(p.x, p.y, arena.tone(base).hi, p.target ? 6 : 3, 80, 2.2, 0.35, 'spark', 0);
          if (p.target) fx.text(p.x, p.y - 10, `+${gain}`, c.p[0], 12);
        }
        if (p.gone && !popped[i] && popAt[i] < 0) queue.push(i);
        if (p.gone && !popped[i] && popAt[i] >= 0 && arena.time >= popAt[i]) {
          popped[i] = 1;
          sfx('pop', { vol: 0.6, pitch: Math.min(12, popCombo++) });
          fx.burst(p.x, p.y, base, p.target ? 12 : 6, 100, 3, 0.5);
          fx.ring(p.x, p.y, base, PEG_R * 0.6, PEG_R * 2.2, 0.25, arena.lw * 0.8);
        }
      }
      if (queue.length) {
        // Pop the lit pegs in the order they were hit.
        queue.sort((a, b) => litAt[a] - litAt[b]);
        const gap = Math.min(0.06, 0.9 / queue.length);
        queue.forEach((i, k) => (popAt[i] = arena.time + 0.05 + k * gap));
        queue.length = 0;
        popCombo = 0;
      }
      const left = targetsLeft(s) - s.pegs.filter((p) => p.target && p.lit && !p.gone).length;
      if (left === 0 && targetsLeft(s) > 0 && !lastCalled) {
        // The last orange peg is lit: make it a moment.
        lastCalled = true;
        const p = s.pegs.find((q) => q.target && q.lit && !q.gone);
        if (p) {
          fx.ring(p.x, p.y, c.p[0], PEG_R, 70, 0.6, arena.lw * 1.6);
          fx.text(p.x, p.y - 22, L('Last one!', 'La dernière!'), c.p[0], 16, 1.1);
          fx.shake(3, 0.25);
          sfx('power');
        }
      }
      if (multiplier(s) > lastMult) {
        lastMult = multiplier(s);
        fx.text(s.bx, s.by - 26, L(`Points ×${lastMult}`, `Points ×${lastMult}`), c.accent, 13);
      }
    }

    /** Effects for armour, blasts, bumpers, free balls and shot milestones. */
    function onEvents(ev: ReturnType<typeof step>, hits: number) {
      const c = arena.colors;
      for (const k of ev.cracks) {
        fx.burst(k.x, k.y, c.muted, 6, 90, 2, 0.3, 'spark', 0);
        sfx('hit', { pitch: 2 });
      }
      for (const b of ev.blasts) {
        fx.ring(b.x, b.y, c.bad, 6, b.r, 0.4, arena.lw * 1.5);
        fx.burst(b.x, b.y, c.accent, 16, 160, 3.5, 0.55, 'spark', 0);
        fx.shake(3, 0.25);
      }
      if (ev.blasts.length) {
        sfx('boom');
        haptic(40);
      }
      for (const i of ev.bumps) {
        if (arena.time - bumpAt[i] > 0.1) sfx('hit', { pitch: 9 });
        bumpAt[i] = arena.time;
      }
      if (ev.free) {
        sfx('coin');
        fx.text(s.bx, s.by - 20, L('+1 ball', '+1 balle'), c.good, 14);
        ctx.lives(s.balls, max);
      }
      if (s.hits > hits && s.hits >= 4) comboPop(fx, s.bx, s.by - 12, s.hits, c.accent);
      for (const u of ev.unlocks) {
        comboTier(fx, u.tier, c.accent, POWER_NAMES[u.power]());
        if (u.power === 'bucket') fx.ring(s.bucketX, BUCKET_Y, c.accent, 8, s.bucketW, 0.45, arena.lw);
      }
    }

    const aim = (p: { x: number; y: number }) => aimAt(s, p.x, p.y);
    const fire = () => {
      if (!shoot(s)) return;
      status();
      shotStart = s.score;
      lits = 0;
      sfx('shoot');
      lastMult = 1;
      trailN = 0;
      const c = arena.colors;
      fx.burst(
        LAUNCH.x + Math.sin(s.aim) * 20,
        LAUNCH.y + Math.cos(s.aim) * 20,
        c.muted,
        6,
        90,
        2.5,
        0.3,
        'dot',
        0,
        Math.PI / 2 - s.aim,
        0.9,
      );
    };
    const stopGestures = gestures(arena.canvas, {
      toWorld: (e) => arena.toWorld(e),
      slop: 6,
      onDown: aim,
      onMove: aim,
      onTap: (p) => {
        aim(p);
        fire();
      },
      onRelease: (p) => {
        aim(p);
        fire();
      },
    });

    ctx.score(0);
    ctx.lives(s.balls, max);
    status();
    return {
      draw,
      frame(dt) {
        const score = s.score;
        const hits = s.hits;
        const ev = step(s, dt);
        arena.update(dt);
        const c = arena.colors;
        if (s.flying) {
          trail[trailAt * 2] = s.bx;
          trail[trailAt * 2 + 1] = s.by;
          trailAt = (trailAt + 1) % TRAIL;
          trailN = Math.min(TRAIL, trailN + 1);
        }
        if (ev.hit) {
          ctx.score(s.score);
          status();
        }
        react(s.score - score);
        onEvents(ev, hits);
        if (ev.ended) {
          ctx.score(s.score);
          ctx.lives(s.balls, max);
          status();
          const shot = s.score - shotStart;
          if (shot > 0) fx.text(W / 2, H * 0.45, `+${shot}`, lastMult > 1 ? c.accent : c.fg, 14 + Math.min(8, lastMult * 2), 1.1);
          if (ev.caught) {
            sfx('coin');
            fx.burst(s.bucketX, BUCKET_Y, c.accent, 12, 120, 3, 0.55, 'square', 260, -Math.PI / 2, Math.PI * 0.8);
            fx.text(s.bucketX, BUCKET_Y - 16, L('+1 ball', '+1 balle'), c.good, 12);
          } else fx.burst(Math.max(8, Math.min(W - 8, s.bx)), H - 2, c.muted, 6, 80, 2.5, 0.35, 'dot', 200, -Math.PI / 2, 1);
        }
        if (ev.cleared) {
          ended = true;
          for (let i = 0; i < 4; i++) fx.burst(W / 2, H * 0.4, c.p[i], 12, 200, 4, 0.9, 'square', 200);
          fx.flash(c.good, 0.22, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          fx.shake(4, 0.35);
          fx.flash(c.bad, 0.22, 0.4);
          arena.linger();
        }
        draw();
        if (ev.cleared) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const dir = k === 'arrowleft' || k === 'a' ? -1 : k === 'arrowright' || k === 'd' ? 1 : 0;
        if (dir) {
          if (e.type === 'keydown') s.turn = dir;
          else if (s.turn === dir) s.turn = 0;
          return true;
        }
        if (k === ' ' || k === 'enter' || k === 'arrowdown' || k === 's') {
          if (e.type === 'keydown') fire();
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
