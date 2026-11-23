import './style.css';
import { L, P } from '../../core/i18n';
import { byLevel, type GameDef } from '../../core/types';
import { Arena } from '../../kits/arena/arena';
import { sfx } from '../../kits/sound/sound';
import {
  ARC,
  BALL_BONUS,
  BALL_R,
  BALLS,
  createLevel,
  FLIP_R0,
  FLIP_R1,
  flipperTip,
  goalFor,
  H,
  LANE_X,
  LANE_Y0,
  LANE_Y1,
  MID,
  PLUNGER_Y,
  pull,
  release,
  SLING,
  step,
  W,
} from './rules';

/** Palette slots for the bumpers (the kicker post first), then the slings and the target banks. */
const BUMPER_P = [7, 1, 6, 0, 2, 5];
const SLING_P = 3;
const BANK_P = [0, 6, 2];

export const pinball: GameDef = {
  id: 'pinball',
  get name() {
    return L('Pinball', 'Flipper');
  },
  get rules() {
    return L('Flip the ball to reach the goal score.', 'Frappez la bille pour atteindre le pointage visé.');
  },
  category: 'aim',
  help: () => ({
    goal: L(
      'Reach the goal score before your three balls drain between the flippers.',
      'Atteignez le pointage visé avant que vos trois billes tombent entre les batteurs.',
    ),
    steps: [
      L(
        'The plunger launches each ball by itself; hold to pull it back and let go for a stronger shot.',
        'Le lanceur envoie chaque bille tout seul; maintenez pour le tirer et relâchez pour un tir plus fort.',
      ),
      L(
        'Bumpers and slingshots kick the ball around. Drop targets fall when hit.',
        'Les champignons et les lance-billes la renvoient. Les cibles tombent quand on les touche.',
      ),
      L(
        'Knock down a whole bank of targets to raise the multiplier (up to ×4) for every point after.',
        'Abattez toute une rangée de cibles pour monter le multiplicateur (jusqu’à ×4) de tous les points suivants.',
      ),
      L(
        'Hard and up: side outlanes swallow the ball too. A ball lost right after launch comes back once.',
        'Dès Difficile, les couloirs extérieurs avalent aussi la bille. Une bille perdue juste après le lancer revient une fois.',
      ),
      L(
        'Touch the left or right half to flip that flipper (both at once works).',
        'Touchez la moitié gauche ou droite pour actionner ce batteur (les deux à la fois, ça marche).',
      ),
      L(
        'Keyboard: ← or A / Z and → or D / / to flip, Space or ↓ to launch, P to pause.',
        'Clavier : ← ou A / Z et → ou D / / pour les batteurs, Espace ou ↓ pour lancer, P pour la pause.',
      ),
    ],
    tips: [
      L(
        'Flip as the ball reaches the middle of the flipper: hitting near the tip sends it across the table.',
        'Frappez quand la bille arrive au milieu du batteur : près du bout, elle traverse la table.',
      ),
      L(
        'Light every top lane for a bonus: each flip shifts the lit lamps one lane over.',
        'Allumez tous les couloirs du haut pour un boni : chaque coup de batteur décale les lampes allumées.',
      ),
      L(
        `Each ball left unplayed at the goal is worth ${BALL_BONUS} points.`,
        `Chaque bille pas encore jouée à l’objectif vaut ${BALL_BONUS} points.`,
      ),
    ],
  }),
  stars: (d) => [goalFor(d) + BALL_BONUS, goalFor(d) + 2 * BALL_BONUS],
  par: (d) => byLevel(d, [70, 80, 90, 100, 110]),
  create(ctx) {
    const s = createLevel(ctx.difficulty, ctx.rng);
    const arena = new Arena(ctx.root, W, H, () => draw());
    const fx = arena.fx;
    /** Arena time of each bumper's, sling's and target's last hit, for their flash and pop. */
    const bumpAt = new Float32Array(s.bumpers.length).fill(-9);
    const slingAt = new Float32Array(2).fill(-9);
    const targetAt = new Float32Array(s.targets.length).fill(-9);
    const flipAt = new Float32Array(2).fill(-9);
    let laneAt = -9;
    let multAt = -9;
    const TRAIL = 8;
    const trail = new Float32Array(TRAIL * 2);
    let trailN = 0;
    let trailAt = 0;
    let ended = false;
    /** Pointers held down and the side (0 left, 1 right) each one is pressing. */
    const touches = new Map<number, number>();
    const keys: [boolean, boolean] = [false, false];

    const status = () =>
      ctx.status(
        [
          P(Math.max(0, s.goal - s.score), ['point to go', 'points to go'], ['point à faire', 'points à faire']),
          s.mult > 1 ? `×${s.mult}` : '',
          s.save > 0 && !s.saveUsed ? L('ball save on', 'bille protégée') : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );

    const flash = (at: number, life: number) => Math.max(0, 1 - (arena.time - at) / life);

    function draw() {
      const g = arena.begin();
      if (!g) return;
      const c = arena.colors;
      const t = arena.time;
      arena.field(g, 0, 0, W, H, 20, 0, false);
      // Outside the table: the cabinet surface.
      g.fillStyle = c.cell;
      g.beginPath();
      g.rect(0, 0, W, H);
      g.moveTo(4, H);
      g.lineTo(4, ARC.y);
      g.arc(ARC.x, ARC.y, ARC.r, Math.PI, Math.PI * 2);
      g.lineTo(258, H);
      g.closePath();
      g.fill('evenodd');

      // Multiplier lamps under the field's middle.
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `800 9px ${arena.family}`;
      const pop = flash(multAt, 0.5);
      for (let m = 2; m <= 4; m++) {
        const x = MID + (m - 3) * 24;
        const on = s.mult >= m;
        const y = 286;
        g.globalAlpha = on ? 1 : 0.5;
        arena.box(g, x - 9, y - 6, 18, 12, on ? c.accent : c.cellAlt, 6, false);
        g.fillStyle = on ? c.coal : c.muted;
        g.fillText(`×${m}`, x, y + 0.5);
        g.globalAlpha = 1;
        if (on && s.mult === m && pop > 0) {
          g.strokeStyle = c.accent;
          g.lineWidth = 2 * pop;
          g.beginPath();
          g.roundRect(x - 12 - 4 * (1 - pop), y - 9 - 4 * (1 - pop), 24 + 8 * (1 - pop), 18 + 8 * (1 - pop), 9);
          g.stroke();
        }
      }
      // Ball save lamp, blinking as it runs out.
      if (s.save > 0 && !s.saveUsed && (s.save > 2 || Math.sin(t * 16) > 0)) {
        arena.disc(g, MID, 404, 4, c.good);
      }

      // Top lanes: their lamps light as the ball rolls through.
      const lp = flash(laneAt, 0.4);
      for (let i = 0; i < s.lanes.length; i++) {
        const on = s.lit[i];
        const x = s.lanes[i];
        const y = (LANE_Y0 + LANE_Y1) / 2;
        if (on) {
          g.fillStyle = arena.tone(c.accent).glow;
          g.beginPath();
          g.arc(x, y, 7 + lp * 3, 0, Math.PI * 2);
          g.fill();
        }
        arena.gem(
          g,
          x,
          y,
          4.2,
          on ? c.accent : c.cellAlt,
          (q, r) => {
            q.beginPath();
            q.moveTo(0, -r);
            q.lineTo(r, r * 0.7);
            q.lineTo(-r, r * 0.7);
            q.closePath();
          },
          false,
        );
      }

      // Slingshots: a rubber face that flashes when it kicks.
      for (const side of [0, 1]) {
        const m = (x: number) => (side ? 2 * MID - x : x);
        const fill = c.p[SLING_P];
        const tone = arena.tone(fill);
        const k = flash(slingAt[side], 0.18);
        g.beginPath();
        g.moveTo(m(SLING.ax), SLING.ay);
        g.lineTo(m(SLING.bx), SLING.by);
        g.lineTo(m(SLING.cx), SLING.cy);
        g.closePath();
        g.fillStyle = k > 0 ? tone.hi : fill;
        g.fill();
        g.strokeStyle = tone.edge;
        g.lineWidth = arena.lw * 0.8;
        g.lineJoin = 'round';
        g.stroke();
        const bulge = 3 * k;
        const nx = side ? -0.92 : 0.92;
        g.strokeStyle = k > 0 ? c.paper : tone.hi;
        g.lineWidth = 2.4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(m(SLING.ax) + nx * 1.5, SLING.ay + 3);
        g.quadraticCurveTo(
          (m(SLING.ax) + m(SLING.cx)) / 2 + nx * (2 + bulge),
          (SLING.ay + SLING.cy) / 2 - 1,
          m(SLING.cx) - nx * 1,
          SLING.cy - 3,
        );
        g.stroke();
      }

      // Walls, guides and lane posts.
      g.strokeStyle = c.ink;
      g.lineCap = 'round';
      for (const sg of s.segs) {
        if (sg.kind === 'sling') continue;
        if (sg.kind === 'gate') {
          if (s.inLane) continue;
          g.globalAlpha = 0.5;
        }
        g.lineWidth = Math.max(arena.lw * 1.2, sg.r * 2);
        g.beginPath();
        g.moveTo(sg.ax, sg.ay);
        g.lineTo(sg.bx, sg.by);
        g.stroke();
        g.globalAlpha = 1;
      }
      for (const p of s.posts) arena.disc(g, p.x, p.y, p.r, c.muted);
      g.lineCap = 'butt';

      // Drop targets: standing plates, or a slot and a lit lamp once down.
      for (let i = 0; i < s.targets.length; i++) {
        const tg = s.targets[i];
        const fill = c.p[BANK_P[tg.bank % BANK_P.length]];
        const vertical = tg.ax === tg.bx;
        const x = Math.min(tg.ax, tg.bx) - (vertical ? 3 : 0);
        const y = Math.min(tg.ay, tg.by) - (vertical ? 0 : 3);
        const w = vertical ? 6 : tg.bx - tg.ax;
        const h = vertical ? tg.by - tg.ay : 6;
        const k = flash(targetAt[i], 0.25);
        if (!tg.down) arena.block(g, x, y, w, h, fill, 2, true, 0.6);
        else {
          g.strokeStyle = arena.tone(fill).edge;
          g.globalAlpha = 0.45;
          g.lineWidth = 1;
          g.setLineDash([2, 2]);
          g.strokeRect(x, y, w, h);
          g.setLineDash([]);
          g.globalAlpha = 1;
        }
        // Lamp beside the target: lit while it's down.
        const lx = vertical ? (tg.ax < MID ? tg.ax + 9 : tg.ax - 9) : (tg.ax + tg.bx) / 2;
        const ly = vertical ? (tg.ay + tg.by) / 2 : tg.ay + 9;
        arena.disc(g, lx, ly, 2.4 + k * 2, tg.down ? fill : c.cellAlt);
      }

      // Bumpers: a rubber ring and a cap that pops when struck.
      for (let i = 0; i < s.bumpers.length; i++) {
        const b = s.bumpers[i];
        const fill = c.p[BUMPER_P[i % BUMPER_P.length]];
        const k = flash(bumpAt[i], 0.2);
        const tone = arena.tone(fill);
        if (k > 0) {
          g.fillStyle = tone.glow;
          g.beginPath();
          g.arc(b.x, b.y, b.r + 5 * k + 2, 0, Math.PI * 2);
          g.fill();
        }
        arena.disc(g, b.x, b.y, b.r, tone.lo);
        arena.ball(g, b.x, b.y - 1, b.r * (0.74 + 0.12 * k), k > 0.3 ? tone.hi : fill, false);
        g.fillStyle = c.paper;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.arc(b.x, b.y - 1, b.r * 0.22, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }

      // Plunger: a spring that squeezes as it's pulled.
      const pullBack = s.held ? s.charge * 12 : 0;
      const top = PLUNGER_Y + BALL_R + 1 + pullBack;
      g.strokeStyle = c.muted;
      g.lineWidth = 1.5;
      g.beginPath();
      const coils = 5;
      const span = H - top - 6;
      for (let i = 0; i <= coils * 2; i++) {
        const x = LANE_X + (i % 2 ? 6 : -6);
        const y = top + 4 + (span * i) / (coils * 2);
        if (i) g.lineTo(x, y);
        else g.moveTo(LANE_X, y);
      }
      g.stroke();
      arena.block(g, LANE_X - 9, top, 18, 5, c.accent, 2, false, 0.5);

      // Flippers: tapered bats that flash on a swing.
      for (let k = 0; k < 2; k++) {
        const f = s.flippers[k];
        const tip = flipperTip(f);
        const a = Math.atan2(tip.y - f.py, tip.x - f.px);
        const fill = flash(flipAt[k], 0.12) > 0 ? arena.tone(c.accent).hi : c.accent;
        const tone = arena.tone(c.accent);
        g.beginPath();
        g.arc(f.px, f.py, FLIP_R0, a + Math.PI / 2, a + (3 * Math.PI) / 2);
        g.arc(tip.x, tip.y, FLIP_R1, a - Math.PI / 2, a + Math.PI / 2);
        g.closePath();
        g.fillStyle = c.drop;
        g.save();
        g.translate(arena.sh * 0.5, arena.sh * 0.5);
        g.fill();
        g.restore();
        g.fillStyle = fill;
        g.fill();
        g.strokeStyle = tone.edge;
        g.lineWidth = arena.lw * 0.8;
        g.stroke();
        arena.disc(g, f.px, f.py, 2.4, c.paper);
      }

      // Ball and its trail.
      const ballFill = arena.dark ? c.fg : c.cell;
      if (!s.held && !ended) {
        g.fillStyle = arena.tone(c.accent).glow;
        for (let i = 0; i < trailN; i++) {
          const k = (trailAt - 1 - i + TRAIL) % TRAIL;
          const f = 1 - i / TRAIL;
          g.globalAlpha = f * 0.8;
          g.beginPath();
          g.arc(trail[k * 2], trail[k * 2 + 1], BALL_R * (0.35 + 0.6 * f), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      if (!ended || s.balls > 0) arena.ball(g, s.bx, s.by + pullBack, BALL_R, ballFill);
      arena.overlay(g);
    }

    function react(ev: ReturnType<typeof step>) {
      const c = arena.colors;
      for (const h of ev.hits) {
        if (h.kind === 'bumper') {
          const b = s.bumpers[h.i];
          const fill = c.p[BUMPER_P[h.i % BUMPER_P.length]];
          bumpAt[h.i] = arena.time;
          sfx('hit', { pitch: 3 + (h.i % 5) * 2 });
          fx.ring(b.x, b.y, fill, b.r, b.r * 2.2, 0.3, arena.lw);
          fx.burst(h.x, h.y, arena.tone(fill).hi, 5, 110, 2.2, 0.3, 'spark', 0);
          fx.text(b.x, b.y - b.r - 4, `+${h.pts}`, c.fg, 10, 0.6);
          fx.shake(1.2, 0.1);
        } else if (h.kind === 'sling') {
          slingAt[h.i] = arena.time;
          sfx('hit', { pitch: -5, vol: 0.7 });
          fx.burst(h.x, h.y, arena.tone(c.p[SLING_P]).hi, 5, 90, 2, 0.25, 'spark', 0);
        } else if (h.kind === 'target') {
          const fill = c.p[BANK_P[s.targets[h.i].bank % BANK_P.length]];
          targetAt[h.i] = arena.time;
          sfx('pop', { pitch: 2 });
          fx.burst(h.x, h.y, fill, 10, 110, 3, 0.45);
          fx.text(h.x + (h.x < MID ? 14 : h.x > 200 ? -14 : 0), h.y - 10, `+${h.pts}`, fill, 12);
        } else if (h.kind === 'bank') {
          multAt = arena.time;
          sfx('power');
          fx.ring(h.x, h.y, c.accent, 6, 70, 0.5, arena.lw * 1.4);
          fx.text(MID, 220, `×${s.mult}!`, c.accent, 22, 1.1);
          fx.text(MID, 246, `+${h.pts}`, c.fg, 13, 1);
          fx.flash(c.accent, 0.18, 0.35);
          fx.shake(2.5, 0.25);
        } else if (h.kind === 'lane') {
          laneAt = arena.time;
          sfx('coin');
          fx.ring(h.x, h.y, c.accent, 4, 16, 0.3, arena.lw);
        } else {
          sfx('power');
          fx.text(MID, 84, `+${h.pts}`, c.accent, 16, 1);
          for (const x of s.lanes) fx.burst(x, (LANE_Y0 + LANE_Y1) / 2, c.accent, 5, 90, 2.5, 0.4, 'dot', 80);
          fx.flash(c.accent, 0.12, 0.25);
        }
      }
      for (let k = 0; k < 2; k++) {
        if (!ev.flip[k]) continue;
        flipAt[k] = arena.time;
        sfx('flip', { pitch: k ? 2 : 0 });
      }
      if (ev.launched) {
        sfx('shoot');
        fx.burst(LANE_X, PLUNGER_Y + BALL_R, c.muted, 7, 80, 2, 0.3, 'dot', 0, -Math.PI / 2, Math.PI * 0.6);
      }
      if (ev.saved) {
        sfx('power');
        fx.text(MID, 330, L('Ball saved!', 'Bille sauvée!'), c.good, 15, 1.2);
        fx.flash(c.good, 0.15, 0.3);
        trailN = 0;
      }
      if (ev.drained) {
        ctx.lives(s.balls, BALLS);
        fx.shake(5, 0.35);
        fx.flash(c.bad, 0.3, 0.35);
        fx.burst(MID, H - 4, c.bad, 12, 140, 3.5, 0.5, 'square', 300, -Math.PI / 2, Math.PI * 0.7);
        trailN = 0;
      }
    }

    // Each half of the field is a flipper button; with the ball on the plunger, a press also pulls it.
    const sync = () => {
      for (let k = 0; k < 2; k++) s.press[k] = keys[k] || [...touches.values()].includes(k);
    };
    const down = (e: PointerEvent) => {
      arena.canvas.setPointerCapture?.(e.pointerId);
      touches.set(e.pointerId, arena.toWorld(e).x < W / 2 ? 0 : 1);
      sync();
      pull(s);
    };
    const up = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      sync();
      if (!touches.size) release(s);
    };
    arena.canvas.addEventListener('pointerdown', down);
    arena.canvas.addEventListener('pointerup', up);
    arena.canvas.addEventListener('pointercancel', up);

    ctx.score(0);
    ctx.lives(s.balls, BALLS);
    status();
    return {
      draw,
      frame(dt) {
        const score = s.score;
        const mult = s.mult;
        const saving = s.save > 0 && !s.saveUsed;
        const ev = step(s, dt);
        arena.update(dt);
        react(ev);
        if (s.score !== score) ctx.score(s.score);
        if (s.score !== score || s.mult !== mult || saving !== (s.save > 0 && !s.saveUsed) || ev.drained) status();
        if (!s.held) {
          trail[trailAt * 2] = s.bx;
          trail[trailAt * 2 + 1] = s.by;
          trailAt = (trailAt + 1) % TRAIL;
          trailN = Math.min(TRAIL, trailN + 1);
        } else trailN = 0;
        const c = arena.colors;
        if (ev.won) {
          ended = true;
          for (let i = 0; i < 5; i++) fx.burst(MID, H * 0.4, c.p[i], 10, 200, 4, 0.9, 'square', 220);
          fx.ring(s.bx, s.by, c.accent, 6, 90, 0.6, arena.lw * 1.5);
          if (s.balls > 1) fx.text(MID, H * 0.5, `+${(s.balls - 1) * BALL_BONUS}`, c.good, 16, 1.2);
          fx.flash(c.good, 0.25, 0.5);
          arena.linger();
        } else if (ev.over) {
          ended = true;
          arena.linger();
        }
        draw();
        if (ev.won) ctx.win();
        else if (ev.over) ctx.lose();
      },
      onKey(e) {
        const k = e.key.toLowerCase();
        const side: 0 | 1 | -1 = k === 'arrowleft' || k === 'a' || k === 'z' ? 0 : k === 'arrowright' || k === 'd' || k === '/' ? 1 : -1;
        if (side !== -1) {
          keys[side] = e.type === 'keydown';
          sync();
          return true;
        }
        if (k === ' ' || k === 'arrowdown' || k === 's') {
          if (e.type === 'keydown') pull(s);
          else release(s);
          return true;
        }
        return false;
      },
      destroy() {
        arena.canvas.removeEventListener('pointerdown', down);
        arena.canvas.removeEventListener('pointerup', up);
        arena.canvas.removeEventListener('pointercancel', up);
        arena.destroy();
      },
    };
  },
};
