/**
 * Cheap game juice for an arena: particle bursts, expanding rings, floating "+score" text, screen shake
 * and a full-field flash. Everything lives in fixed pools (no allocation per frame), runs on the game's
 * `dt`, and tones itself down under prefers-reduced-motion (no shake, fewer particles, softer flashes).
 *
 * Visual only: it uses Math.random, never the level's seeded rng.
 */

/** What the effects need from their arena to draw (colours, type face). */
interface FxHost {
  colors: { cell: string; ink: string; fg: string };
  dark: boolean;
  family: string;
}

/** Particle shapes. */
export type Bit = 'square' | 'dot' | 'spark';
const BIT: Record<Bit, number> = { square: 0, dot: 1, spark: 2 };

const CAP = 220;
const RINGS = 10;
const TEXTS = 10;

interface Text {
  live: boolean;
  x: number;
  y: number;
  t: number;
  max: number;
  size: number;
  str: string;
  color: string;
}

interface Ring {
  live: boolean;
  x: number;
  y: number;
  r0: number;
  r1: number;
  t: number;
  max: number;
  width: number;
  color: string;
}

export class Fx {
  // Particles, struct-of-arrays; [0, n) are alive.
  private n = 0;
  private x = new Float32Array(CAP);
  private y = new Float32Array(CAP);
  private vx = new Float32Array(CAP);
  private vy = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private max = new Float32Array(CAP);
  private size = new Float32Array(CAP);
  private grav = new Float32Array(CAP);
  private kind = new Uint8Array(CAP);
  private color: string[] = new Array<string>(CAP).fill('');
  private rings: Ring[] = Array.from({ length: RINGS }, () => ({
    live: false,
    x: 0,
    y: 0,
    r0: 0,
    r1: 0,
    t: 0,
    max: 1,
    width: 1,
    color: '',
  }));
  private texts: Text[] = Array.from({ length: TEXTS }, () => ({ live: false, x: 0, y: 0, t: 0, max: 1, size: 12, str: '', color: '' }));
  private shakeT = 0;
  private shakeMax = 0;
  private shakeAmp = 0;
  private flashT = 0;
  private flashMax = 0;
  private flashA = 0;
  private flashColor = '';
  private ban = { t: 1, max: 1, str: '', sub: '', color: '' };
  /** Current shake offset in world units (applied by `Arena.begin`). */
  sx = 0;
  sy = 0;
  private mq = matchMedia('(prefers-reduced-motion: reduce)');

  /** The player asked for less motion. */
  get calm(): boolean {
    return this.mq.matches;
  }

  /** Anything still animating (shake, flash, particles, rings or text)? */
  get busy(): boolean {
    return (
      this.n > 0 ||
      this.shakeT > 0 ||
      this.flashT > 0 ||
      this.ban.t < this.ban.max ||
      this.rings.some((r) => r.live) ||
      this.texts.some((t) => t.live)
    );
  }

  /**
   * `count` particles flying out of (x, y). `speed` in world units per second, `life` in seconds.
   * `angle` / `spread` aim the burst (default: all around); `gravity` pulls them down.
   */
  burst(
    x: number,
    y: number,
    color: string,
    count = 10,
    speed = 110,
    size = 3,
    life = 0.55,
    kind: Bit = 'square',
    gravity = 260,
    angle = 0,
    spread = Math.PI * 2,
  ) {
    const k = this.calm ? Math.ceil(count * 0.3) : count;
    for (let i = 0; i < k; i++) {
      if (this.n >= CAP) return;
      const j = this.n++;
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.45 + Math.random() * 0.75);
      this.x[j] = x;
      this.y[j] = y;
      this.vx[j] = Math.cos(a) * v;
      this.vy[j] = Math.sin(a) * v;
      this.max[j] = this.life[j] = life * (0.6 + Math.random() * 0.6);
      this.size[j] = size * (0.6 + Math.random() * 0.8);
      this.grav[j] = gravity;
      this.kind[j] = BIT[kind];
      this.color[j] = color;
    }
  }

  /** A ring growing from `r0` to `r1` and fading out: impacts, pickups, merges. */
  ring(x: number, y: number, color: string, r0: number, r1: number, life = 0.35, width = 2) {
    const r = this.rings.find((q) => !q.live) ?? this.rings[0];
    Object.assign(r, { live: true, x, y, r0, r1, t: 0, max: life, width, color });
  }

  /** Floating text (a score, a combo) that pops in, rises and fades. */
  text(x: number, y: number, str: string, color: string, size = 13, life = 0.85) {
    let slot = this.texts[0];
    for (const t of this.texts) {
      if (!t.live) {
        slot = t;
        break;
      }
      if (t.t > slot.t) slot = t;
    }
    Object.assign(slot, { live: true, x, y, t: 0, max: life, size, str, color });
  }

  /**
   * A big headline across the middle of the field ("FRENZY!", "Boss wave") with an optional smaller
   * line under it: slides in, holds, fades. One at a time; a new one replaces the old.
   */
  banner(str: string, color: string, sub = '', life = 1.5) {
    Object.assign(this.ban, { t: 0, max: life, str, sub, color });
  }

  /** Shake the whole field by up to `amp` world units for `s` seconds (skipped under reduced motion). */
  shake(amp: number, s = 0.3) {
    if (this.calm) return;
    if (amp >= this.shakeAmp * (this.shakeT / (this.shakeMax || 1))) {
      this.shakeAmp = amp;
      this.shakeT = this.shakeMax = s;
    }
  }

  /** Wash the field with `color` at `a` opacity, fading over `s` seconds (softer under reduced motion). */
  flash(color: string, a = 0.35, s = 0.3) {
    this.flashColor = color;
    this.flashA = this.calm ? a * 0.4 : a;
    this.flashT = this.flashMax = s;
  }

  /** Forget everything (a new level). */
  clear() {
    this.n = 0;
    this.shakeT = this.flashT = 0;
    this.ban.t = this.ban.max;
    this.sx = this.sy = 0;
    for (const r of this.rings) r.live = false;
    for (const t of this.texts) t.live = false;
  }

  update(dt: number) {
    for (let i = 0; i < this.n;) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      this.vx[i] *= 1 - Math.min(1, dt * 1.6);
      this.vy[i] = this.vy[i] * (1 - Math.min(1, dt * 1.6)) + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
    for (const r of this.rings) if (r.live && (r.t += dt) >= r.max) r.live = false;
    for (const t of this.texts) if (t.live && (t.t += dt) >= t.max) t.live = false;
    if (this.ban.t < this.ban.max) this.ban.t = Math.min(this.ban.max, this.ban.t + dt);
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const k = this.shakeAmp * (this.shakeT / this.shakeMax) ** 2;
      this.sx = (Math.random() * 2 - 1) * k;
      this.sy = (Math.random() * 2 - 1) * k;
    } else this.sx = this.sy = 0;
  }

  /** Swap-remove particle `i` with the last live one. */
  private kill(i: number) {
    const j = --this.n;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.max[i] = this.max[j];
    this.size[i] = this.size[j];
    this.grav[i] = this.grav[j];
    this.kind[i] = this.kind[j];
    this.color[i] = this.color[j];
  }

  /** Draw particles, rings, texts, then the flash over the field `w` × `h`. */
  draw(g: CanvasRenderingContext2D, host: FxHost, w: number, h: number) {
    for (let i = 0; i < this.n; i++) {
      const f = this.life[i] / this.max[i];
      const s = this.size[i] * (0.35 + 0.65 * f);
      g.globalAlpha = Math.min(1, f * 1.8);
      g.fillStyle = this.color[i];
      const k = this.kind[i];
      if (k === 1) {
        g.beginPath();
        g.arc(this.x[i], this.y[i], s / 2, 0, Math.PI * 2);
        g.fill();
      } else if (k === 2) {
        g.strokeStyle = this.color[i];
        g.lineWidth = Math.max(0.8, s * 0.5);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(this.x[i], this.y[i]);
        g.lineTo(this.x[i] - this.vx[i] * 0.04, this.y[i] - this.vy[i] * 0.04);
        g.stroke();
        g.lineCap = 'butt';
      } else g.fillRect(this.x[i] - s / 2, this.y[i] - s / 2, s, s);
    }
    for (const r of this.rings) {
      if (!r.live) continue;
      const f = r.t / r.max;
      const e = 1 - (1 - f) ** 3;
      g.globalAlpha = 1 - f;
      g.strokeStyle = r.color;
      g.lineWidth = r.width * (1 - f * 0.6);
      g.beginPath();
      g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const t of this.texts) {
      if (!t.live) continue;
      const f = t.t / t.max;
      // Pop in with a little overshoot, rise, fade over the last third.
      const pop = f < 0.18 ? 0.6 + 0.55 * Math.sin((f / 0.18) * (Math.PI * 0.75)) : 1;
      g.globalAlpha = f > 0.66 ? 1 - (f - 0.66) / 0.34 : 1;
      const size = t.size * pop;
      g.font = `800 ${size.toFixed(1)}px ${host.family}`;
      const y = t.y - 22 * (1 - (1 - f) ** 2);
      const plain = t.color === host.colors.fg;
      g.strokeStyle = plain || host.dark ? host.colors.cell : host.colors.ink;
      g.lineWidth = Math.max(2, size * 0.22);
      g.strokeText(t.str, t.x, y);
      g.fillStyle = t.color;
      g.fillText(t.str, t.x, y);
    }
    if (this.ban.t < this.ban.max) this.drawBanner(g, host, w, h);
    g.textBaseline = 'alphabetic';
    if (this.flashT > 0) {
      g.globalAlpha = this.flashA * (this.flashT / this.flashMax);
      g.fillStyle = this.flashColor;
      g.fillRect(-20, -20, w + 40, h + 40);
    }
    g.globalAlpha = 1;
  }

  private drawBanner(g: CanvasRenderingContext2D, host: FxHost, w: number, h: number) {
    const b = this.ban;
    const f = b.t / b.max;
    const inn = Math.min(1, b.t / 0.18);
    const out = f > 0.75 ? (f - 0.75) / 0.25 : 0;
    const size = Math.min(w / Math.max(4, b.str.length * 0.62), w * 0.11);
    const band = size * (b.sub ? 2.3 : 1.6);
    const cy = h * 0.42;
    g.globalAlpha = 0.82 * inn * (1 - out);
    g.fillStyle = host.colors.cell;
    g.fillRect(-20, cy - band / 2, w + 40, band);
    g.fillStyle = b.color;
    g.fillRect(-20, cy - band / 2, w + 40, Math.max(1.5, size * 0.08));
    g.fillRect(-20, cy + band / 2 - Math.max(1.5, size * 0.08), w + 40, Math.max(1.5, size * 0.08));
    g.globalAlpha = 1 - out;
    // Slide in from the left with a little overshoot, drift on, slide out to the right.
    const e = inn < 1 ? 1 - (1 - inn) ** 3 * (1 + 2.2 * inn) : 1;
    const x = w / 2 + (1 - e) * -w * 0.6 + out * w * 0.4 + (f - 0.5) * size * 0.4;
    const y = b.sub ? cy - size * 0.32 : cy;
    g.font = `900 ${size.toFixed(1)}px ${host.family}`;
    g.lineWidth = Math.max(2, size * 0.2);
    g.strokeStyle = host.dark ? host.colors.cell : host.colors.ink;
    g.strokeText(b.str, x, y);
    g.fillStyle = b.color;
    g.fillText(b.str, x, y);
    if (b.sub) {
      const s2 = size * 0.42;
      g.font = `700 ${s2.toFixed(1)}px ${host.family}`;
      g.fillStyle = host.colors.fg;
      g.fillText(b.sub, x, cy + size * 0.55);
    }
    g.globalAlpha = 1;
  }
}
