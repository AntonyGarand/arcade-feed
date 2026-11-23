import './arena.css';

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
}

/**
 * A canvas playfield in fixed world units (`w` × `h`), scaled to the card: its CSS width is
 * `var(--board)`, the backing store follows the device pixel ratio, and drawing happens in world units.
 * Colours come from the theme tokens and refresh (then `onTheme` redraws) when the theme changes.
 */
export class Arena {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D | null;
  colors!: Palette;
  /** Border width (--bw) in world units. */
  lw = 2;
  /** Shadow offset (--sh) in world units. */
  sh = 3;
  private scale = 1;
  /** --bw and --sh in CSS pixels. */
  private bwPx = 2.5;
  private shPx = 4;
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
    };
    this.bwPx = parseFloat(v('--bw', '2.5')) || 2.5;
    this.shPx = parseFloat(v('--sh', '4')) || 0;
  }

  /**
   * Start a frame: match the backing store to the canvas's size on screen, map world units to pixels,
   * and clear to the surface colour. Returns null when there's nothing to draw on (no 2D context, or
   * the canvas isn't laid out yet).
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
    g.setTransform(pw / this.w, 0, 0, ph / this.h, 0, 0);
    g.fillStyle = this.colors.cell;
    g.fillRect(0, 0, this.w, this.h);
    return g;
  }

  /** A pointer position in world units (may fall outside the field during a drag). */
  toWorld(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / (r.width || 1)) * this.w, y: ((e.clientY - r.top) / (r.height || 1)) * this.h };
  }

  /** Neo-brutalist block: hard offset shadow, flat fill, ink outline. */
  box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, r = 3, shadow = true) {
    if (shadow && this.sh) {
      g.fillStyle = this.colors.drop;
      g.beginPath();
      g.roundRect(x + this.sh * 0.6, y + this.sh * 0.6, w, h, r);
      g.fill();
    }
    g.fillStyle = fill;
    g.strokeStyle = this.colors.ink;
    g.lineWidth = this.lw * 0.8;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
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

  destroy() {
    this.obs.disconnect();
    this.mq.removeEventListener('change', this.onMq);
  }
}
