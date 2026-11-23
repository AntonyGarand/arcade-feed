import './arena.css';
import { alpha, luma, mix, parse } from './color';
import { Fx } from './fx';

/** Theme colours, read from the CSS tokens (so light / dark / styles and the game's accent all apply). */
export interface Palette {
  cell: string;
  cellAlt: string;
  ink: string;
  fg: string;
  muted: string;
  accent: string;
  good: string;
  bad: string;
  /** --p1 … --p8 */
  p: string[];
  /** Hard shadow colour (--drop; transparent in flat styles). */
  drop: string;
  /** Page background (--bg). */
  bg: string;
  /** Physical white and black (--paper, --coal): the same in every theme (eyes, pips). */
  paper: string;
  coal: string;
}

/** The app's visual style (Settings > Theme): pieces are drawn to match it. */
export type Look = 'neo' | 'minimal' | 'soft' | 'newsprint';

/** Shades of one fill colour, derived for the active style and theme (see `Arena.tone`). */
export interface Tone {
  base: string;
  /** Lighter: highlights, facets, the lit top of a bevel. */
  hi: string;
  /** Darker: the shaded side of a bevel or a ball. */
  lo: string;
  /** Outline: ink in neo and newsprint, a darker shade of the fill in soft and minimal. */
  edge: string;
  /** Translucent fill, for glows and trails. */
  glow: string;
}

/** Traces a shape centred on (0, 0) that fits a circle of radius `r` (e.g. a glyph); no fill or stroke. */
export type Trace = (g: CanvasRenderingContext2D, r: number) => void;

/**
 * A canvas playfield in fixed world units (`w` × `h`), scaled to the card: its CSS width is
 * `var(--board)`, the backing store follows the device pixel ratio, and drawing happens in world units.
 * Colours come from the theme tokens and refresh (then `onTheme` redraws) when the theme changes.
 *
 * Drawing helpers match the active style: `box` / `disc` (flat), `block` (bevelled tile), `ball`
 * (glossy sphere), `gem` (any traced shape, faceted), `field` (background with a faint pattern).
 * `fx` adds juice (bursts, rings, floating text, shake, flash): advance it with `update(dt)` from the
 * game's frame, draw it last with `overlay(g)`, and call `linger()` when the run ends so the last
 * effects play out after the card stops calling `frame`.
 */
export class Arena {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D | null;
  colors!: Palette;
  /** Border width (--bw) in world units. */
  lw = 2;
  /** Shadow offset (--sh) in world units. */
  sh = 3;
  /** Active style and whether the surfaces are dark. */
  look: Look = 'neo';
  dark = false;
  /** Font family from the --font token, for canvas text. */
  family = 'system-ui, sans-serif';
  /** Particles, rings, floating text, shake and flash. */
  readonly fx = new Fx();
  /** Seconds of play so far (advanced by `update`): drives idle animations like bobbing and twinkling. */
  time = 0;
  private scale = 1;
  /** Shadow passes for the style, as (dx, dy) pairs in world units (see `begin`). */
  private shOff: number[] = [];
  /** --bw and --sh in CSS pixels. */
  private bwPx = 2.5;
  private shPx = 4;
  /** How shadows are drawn: hard offset (neo), soft and below (soft), or none (flat styles). */
  private shadowMode: 'hard' | 'soft' | 'none' = 'hard';
  /** Corner radius factor for the style: rounder in soft, squarer in newsprint. */
  private round = 1;
  private tones = new Map<string, Tone>();
  private hatch: CanvasPattern | null = null;
  private hatchScale = 0;
  private bg: HTMLCanvasElement | null = null;
  private bgKey = '';
  private raf = 0;
  /**
   * Colours were read while the canvas was off the page (a card dealt before the feed is attached), so
   * they are fallbacks: read them again on the next frame.
   */
  private stale = true;
  private obs: MutationObserver;
  private mq = matchMedia('(prefers-color-scheme: dark)');
  private onMq = () => this.refresh();

  constructor(
    root: HTMLElement,
    readonly w: number,
    readonly h: number,
    private readonly onTheme: () => void = () => {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'arena';
    this.canvas.style.aspectRatio = `${w} / ${h}`;
    root.append(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.readColors();
    this.obs = new MutationObserver(() => this.refresh());
    this.obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'data-oled'] });
    this.mq.addEventListener('change', this.onMq);
  }

  private refresh() {
    this.readColors();
    this.onTheme();
  }

  private readColors() {
    this.stale = !this.canvas.isConnected;
    const cs = getComputedStyle(this.canvas);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    this.colors = {
      cell: v('--cell', '#fff'),
      cellAlt: v('--cell-alt', '#eee'),
      ink: v('--ink', '#111'),
      fg: v('--fg', '#111'),
      muted: v('--muted', '#666'),
      accent: v('--accent', '#ffd23f'),
      good: v('--good', '#3ddc84'),
      bad: v('--bad', '#ff5a5f'),
      p: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--p${i}`, '#888')),
      drop: v('--drop', v('--ink', '#111')),
      bg: v('--bg', '#fff'),
      paper: v('--paper', '#fffdf6'),
      coal: v('--coal', '#111'),
    };
    this.bwPx = parseFloat(v('--bw', '2.5')) || 2.5;
    this.shPx = parseFloat(v('--sh', '4')) || 0;
    this.family = v('--font', 'system-ui, sans-serif');
    const style = document.documentElement.dataset['style'];
    this.look = style === 'minimal' || style === 'soft' || style === 'newsprint' ? style : 'neo';
    this.dark = luma(this.colors.cell) < 0.3;
    const dropA = parse(this.colors.drop)?.[3] ?? 1;
    this.shadowMode = !this.shPx || dropA === 0 ? 'none' : this.look === 'soft' ? 'soft' : 'hard';
    this.round = { neo: 1, minimal: 1.2, soft: 1.7, newsprint: 0.35 }[this.look];
    this.tones.clear();
    this.hatch = null;
    this.bgKey = '';
  }

  /**
   * Start a frame: match the backing store to the canvas's size on screen, map world units to pixels,
   * and clear to the surface colour. Returns null when there's nothing to draw on (no 2D context, or
   * the canvas isn't laid out yet). The field shakes while `fx.shake` runs.
   */
  begin(): CanvasRenderingContext2D | null {
    const g = this.g;
    const cssW = this.canvas.clientWidth;
    if (!g || !cssW) return null;
    if (this.stale) this.readColors();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const pw = Math.round(cssW * dpr);
    const ph = Math.round((cssW * this.h * dpr) / this.w);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.scale = cssW / this.w;
    this.lw = this.bwPx / this.scale;
    this.sh = this.shPx / this.scale;
    const sh = this.sh;
    if (this.shadowMode === 'hard' && (this.shOff.length !== 2 || this.shOff[0] !== sh * 0.6)) this.shOff = [sh * 0.6, sh * 0.6];
    else if (this.shadowMode === 'soft' && (this.shOff.length !== 4 || this.shOff[1] !== sh * 0.9))
      this.shOff = [0, sh * 0.9, 0, sh * 0.45];
    else if (this.shadowMode === 'none' && this.shOff.length) this.shOff = [];
    g.setTransform(pw / this.w, 0, 0, ph / this.h, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = this.colors.cell;
    g.fillRect(0, 0, this.w, this.h);
    if (this.fx.sx || this.fx.sy) g.translate(this.fx.sx, this.fx.sy);
    return g;
  }

  /** A pointer position in world units (may fall outside the field during a drag). */
  toWorld(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / (r.width || 1)) * this.w, y: ((e.clientY - r.top) / (r.height || 1)) * this.h };
  }

  /** Advance time and effects by `dt` seconds: call it from the game's `frame`. */
  update(dt: number) {
    this.time += dt;
    this.fx.update(dt);
  }

  /** Draw the effects on top of the field: call it last in the game's draw. */
  overlay(g: CanvasRenderingContext2D) {
    this.fx.draw(g, this, this.w, this.h);
  }

  /**
   * The run just ended (the card stops calling `frame`): keep the effects and idle animations going
   * for `s` seconds on the arena's own animation frames, redrawing with the `onTheme` callback.
   */
  linger(s = 1.2) {
    if (!this.canvas.clientWidth) return;
    if (this.raf) cancelAnimationFrame(this.raf);
    let last = performance.now();
    let left = s;
    const tick = (t: number) => {
      const dt = Math.min(1 / 20, Math.max(0, (t - last) / 1000));
      last = t;
      left -= dt;
      this.update(dt);
      this.onTheme();
      this.raf = left > 0 ? requestAnimationFrame(tick) : 0;
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Shades of `fill` for the active style and theme (cached: cheap to call every frame). */
  tone(fill: string): Tone {
    let t = this.tones.get(fill);
    if (!t) {
      const { ink } = this.colors;
      const edge =
        this.look === 'soft'
          ? this.dark
            ? mix(fill, '#000000', 0.5)
            : mix(fill, ink, 0.62)
          : this.look === 'minimal'
            ? mix(fill, '#000000', this.dark ? 0.45 : 0.3)
            : ink;
      t = {
        base: fill,
        hi: mix(fill, '#ffffff', this.look === 'soft' ? 0.55 : 0.45),
        lo: mix(fill, '#000000', this.dark ? 0.32 : 0.2),
        edge,
        glow: alpha(fill, 0.35),
      };
      this.tones.set(fill, t);
    }
    return t;
  }

  /** Corner radius `r` adjusted to the style (rounder in soft, squarer in newsprint). */
  r(r: number) {
    return r * this.round;
  }

  /** Outline width for pieces. */
  private get edgeW() {
    return this.lw * (this.look === 'minimal' ? 0.7 : 0.8);
  }

  /** Neo-brutalist block: hard offset shadow, flat fill, ink outline (soft shadow in the soft style). */
  box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, r = 3, shadow = true) {
    const rr = this.r(r);
    if (shadow && this.sh) {
      g.fillStyle = this.colors.drop;
      for (let i = 0; i < this.shOff.length; i += 2) {
        g.beginPath();
        g.roundRect(x + this.shOff[i], y + this.shOff[i + 1], w, h, rr);
        g.fill();
      }
    }
    g.fillStyle = fill;
    g.strokeStyle = this.colors.ink;
    g.lineWidth = this.lw * 0.8;
    g.beginPath();
    g.roundRect(x, y, w, h, rr);
    g.fill();
    g.stroke();
  }

  /** Disc with an ink outline. */
  disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
    g.fillStyle = fill;
    g.strokeStyle = this.colors.ink;
    g.lineWidth = this.lw * 0.8;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  /**
   * A raised tile: the style's shadow, a bevel (lit top, shaded bottom; hatched in newsprint), a
   * highlight strip and an outline. `bevel` scales the bevel (0 for a flat tile).
   */
  block(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, r = 3, shadow = true, bevel = 1) {
    const t = this.tone(fill);
    const rr = Math.min(this.r(r), w / 2, h / 2);
    if (shadow) {
      g.fillStyle = this.colors.drop;
      for (let i = 0; i < this.shOff.length; i += 2) {
        g.beginPath();
        g.roundRect(x + this.shOff[i], y + this.shOff[i + 1], w, h, rr);
        g.fill();
      }
    }
    const b = bevel * Math.max(1, Math.min(4, Math.min(w, h) * 0.16));
    g.beginPath();
    g.roundRect(x, y, w, h, rr);
    if (bevel > 0) {
      // Shaded body, then the face lifted off its bottom edge.
      g.fillStyle = this.look === 'newsprint' ? t.base : t.lo;
      g.fill();
      if (this.look === 'newsprint') {
        g.fillStyle = this.hatchFill(g);
        g.fill();
      }
      g.fillStyle = t.base;
      g.beginPath();
      g.roundRect(x, y, w, h - b, rr);
      g.fill();
      if (this.look !== 'newsprint') {
        g.fillStyle = t.hi;
        g.globalAlpha = this.look === 'minimal' ? 0.35 : 0.6;
        g.beginPath();
        g.roundRect(x + b, y + b * 0.55, w - 2 * b, Math.max(0.8, Math.min(b * 0.8, h * 0.18)), b * 0.5);
        g.fill();
        g.globalAlpha = 1;
      }
    } else {
      g.fillStyle = t.base;
      g.fill();
    }
    g.strokeStyle = t.edge;
    g.lineWidth = this.edgeW;
    g.beginPath();
    g.roundRect(x, y, w, h, rr);
    g.stroke();
  }

  /** A glossy ball: the style's shadow, a shaded crescent, a highlight and an outline. */
  ball(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, shadow = true) {
    const t = this.tone(fill);
    if (shadow) {
      g.fillStyle = this.colors.drop;
      for (let i = 0; i < this.shOff.length; i += 2) {
        g.beginPath();
        g.arc(x + this.shOff[i] * 0.8, y + this.shOff[i + 1] * 0.8, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = t.lo;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    if (this.look === 'newsprint') {
      g.fillStyle = this.hatchFill(g);
      g.fill();
    }
    g.fillStyle = t.base;
    g.beginPath();
    g.arc(x - r * 0.12, y - r * 0.12, r * 0.86, 0, Math.PI * 2);
    g.fill();
    this.sheen(g, x - r * 0.36, y - r * 0.4, r);
    g.strokeStyle = t.edge;
    g.lineWidth = this.edgeW;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
  }

  /**
   * A faceted piece of any shape: `trace` draws its outline around (0, 0). Shadow, fill, a lighter
   * inner facet, a sheen and an outline; `scale` and `rot` (radians) pop and spin it.
   */
  gem(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, trace: Trace, shadow = true, scale = 1, rot = 0) {
    if (scale <= 0.01) return;
    const t = this.tone(fill);
    g.save();
    g.translate(x, y);
    if (rot) g.rotate(rot);
    if (scale !== 1) g.scale(scale, scale);
    if (shadow) {
      g.fillStyle = this.colors.drop;
      for (let i = 0; i < this.shOff.length; i += 2) {
        const dx = (this.shOff[i] * 0.8) / scale;
        const dy = (this.shOff[i + 1] * 0.8) / scale;
        g.translate(dx, dy);
        trace(g, r);
        g.translate(-dx, -dy);
        g.fill();
      }
    }
    trace(g, r);
    g.fillStyle = t.base;
    g.fill();
    if (this.look === 'newsprint') {
      g.save();
      g.clip();
      g.fillStyle = this.hatchFill(g);
      g.fillRect(-r, r * 0.1, 2 * r, r);
      g.restore();
    }
    // Inner facet, nudged up-left towards the light.
    g.save();
    g.translate(-r * 0.06, -r * 0.08);
    g.scale(0.56, 0.56);
    trace(g, r);
    g.restore();
    g.fillStyle = t.hi;
    g.globalAlpha = this.look === 'minimal' ? 0.45 : 0.7;
    g.fill();
    g.globalAlpha = 1;
    if (this.look !== 'newsprint') {
      g.save();
      trace(g, r * 0.92);
      g.clip();
      this.sheen(g, -r * 0.3, -r * 0.36, r * 0.85);
      g.restore();
    }
    trace(g, r);
    g.strokeStyle = t.edge;
    g.lineWidth = this.edgeW / scale;
    g.lineJoin = 'round';
    g.stroke();
    g.restore();
  }

  /** A small white glint, upper left of a piece of radius `r` centred near (x, y). */
  private sheen(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
    if (this.look === 'newsprint') return;
    g.fillStyle = '#ffffff';
    g.globalAlpha = this.look === 'minimal' ? 0.35 : this.dark ? 0.45 : 0.6;
    g.beginPath();
    g.ellipse(x, y, r * 0.26, r * 0.16, -0.6, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }

  /** Newsprint shading: fine diagonal ink hatching, 1 CSS pixel lines. */
  private hatchFill(g: CanvasRenderingContext2D): CanvasPattern | string {
    if (!this.hatch) {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const h = c.getContext('2d');
      if (!h) return 'transparent';
      h.strokeStyle = alpha(this.colors.ink, 0.55);
      h.lineWidth = 0.8;
      h.beginPath();
      h.moveTo(0, 4);
      h.lineTo(4, 0);
      h.moveTo(-1, 1);
      h.lineTo(1, -1);
      h.moveTo(3, 5);
      h.lineTo(5, 3);
      h.stroke();
      this.hatch = g.createPattern(c, 'repeat');
      this.hatchScale = 0;
      if (!this.hatch) return 'transparent';
    }
    if (this.hatchScale !== this.scale) {
      this.hatchScale = this.scale;
      this.hatch.setTransform(new DOMMatrix([1 / this.scale, 0, 0, 1 / this.scale, 0, 0]));
    }
    return this.hatch;
  }

  /**
   * The playfield's background over (x, y, w, h): the alternate surface with a faint pattern every
   * `grid` world units (dots in neo, lines in minimal, a soft wash with dots in soft, rules in
   * newsprint), framed with the style's outline. Cached, so it costs one image copy per frame.
   */
  field(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, grid = 20, r = 0, frame = true) {
    const pw = this.canvas.width;
    const ph = this.canvas.height;
    const key = `${pw}x${ph}|${x},${y},${w},${h},${grid},${r},${frame}|${this.look}|${this.colors.cellAlt}|${this.colors.ink}`;
    if (key !== this.bgKey || !this.bg) {
      this.bg ??= document.createElement('canvas');
      this.bg.width = pw;
      this.bg.height = ph;
      const b = this.bg.getContext('2d');
      if (!b) return;
      this.bgKey = key;
      b.setTransform(pw / this.w, 0, 0, ph / this.h, 0, 0);
      this.paintField(b, x, y, w, h, grid, this.r(r), frame);
    }
    g.drawImage(this.bg, 0, 0, this.w, this.h);
  }

  private paintField(b: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, grid: number, r: number, frame: boolean) {
    const c = this.colors;
    b.save();
    b.beginPath();
    b.roundRect(x, y, w, h, r);
    b.fillStyle = c.cellAlt;
    b.fill();
    b.clip();
    if (this.look === 'soft') {
      const wash = b.createLinearGradient(0, y, 0, y + h);
      wash.addColorStop(0, alpha(c.cell, 0.7));
      wash.addColorStop(1, alpha(c.cell, 0));
      b.fillStyle = wash;
      b.fillRect(x, y, w, h);
    }
    const ink = c.ink;
    if (grid > 0) {
      if (this.look === 'minimal') {
        b.strokeStyle = alpha(ink, this.dark ? 0.12 : 0.09);
        b.lineWidth = 1 / this.scale;
        b.beginPath();
        for (let gx = x + grid; gx < x + w - 0.5; gx += grid) {
          b.moveTo(gx, y);
          b.lineTo(gx, y + h);
        }
        for (let gy = y + grid; gy < y + h - 0.5; gy += grid) {
          b.moveTo(x, gy);
          b.lineTo(x + w, gy);
        }
        b.stroke();
      } else if (this.look === 'newsprint') {
        b.strokeStyle = alpha(ink, 0.08);
        b.lineWidth = 1 / this.scale;
        b.beginPath();
        for (let gy = y + grid / 2; gy < y + h; gy += grid / 2) {
          b.moveTo(x, gy);
          b.lineTo(x + w, gy);
        }
        b.stroke();
      } else {
        b.fillStyle = alpha(ink, this.look === 'soft' ? 0.1 : this.dark ? 0.16 : 0.13);
        const d = Math.max(0.8, 1.6 / this.scale) * (this.look === 'soft' ? 1.4 : 1);
        b.beginPath();
        for (let gy = y + grid; gy < y + h - 0.5; gy += grid)
          for (let gx = x + grid; gx < x + w - 0.5; gx += grid) {
            b.moveTo(gx + d, gy);
            b.arc(gx, gy, d, 0, Math.PI * 2);
          }
        b.fill();
      }
    }
    // Inner shade along the top edge: the field sits a little below the frame.
    const shade = b.createLinearGradient(0, y, 0, y + Math.min(14, h * 0.1));
    shade.addColorStop(0, alpha('#000000', this.dark ? 0.28 : this.look === 'newsprint' || this.look === 'minimal' ? 0.04 : 0.08));
    shade.addColorStop(1, alpha('#000000', 0));
    b.fillStyle = shade;
    b.fillRect(x, y, w, h);
    b.restore();
    if (frame) {
      b.strokeStyle = c.ink;
      b.lineWidth = this.lw * 0.8;
      b.beginPath();
      b.roundRect(x, y, w, h, r);
      b.stroke();
    }
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.obs.disconnect();
    this.mq.removeEventListener('change', this.onMq);
  }
}
