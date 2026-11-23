/**
 * Small colour maths for the arena: theme tokens come back from getComputedStyle as hex or rgb(),
 * and the drawing helpers need lighter / darker / translucent versions of them.
 */

type Rgba = [r: number, g: number, b: number, a: number];

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()` (comma or space syntax). Null otherwise. */
export function parse(c: string): Rgba | null {
  const s = c.trim().toLowerCase();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((x) => parseInt(x + x, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  if (s === 'transparent') return [0, 0, 0, 0];
  const m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p: string, max: number) => (p.endsWith('%') ? (parseFloat(p) / 100) * max : parseFloat(p));
  const out: Rgba = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255), parts[3] == null ? 1 : num(parts[3], 1)];
  return out.some(Number.isNaN) ? null : out;
}

const hex2 = (v: number) =>
  Math.round(Math.max(0, Math.min(255, v)))
    .toString(16)
    .padStart(2, '0');

function css([r, g, b, a]: Rgba): string {
  return a >= 1 ? `#${hex2(r)}${hex2(g)}${hex2(b)}` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(a.toFixed(3))})`;
}

/** `a` blended towards `b` by `t` (0 → a, 1 → b). Unparseable colours come back as `a`. */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return a;
  return css([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t, x[3] + (y[3] - x[3]) * t]);
}

/** `c` with its alpha multiplied by `a`. */
export function alpha(c: string, a: number): string {
  const x = parse(c);
  if (!x) return c;
  return css([x[0], x[1], x[2], x[3] * a]);
}

/** Relative luminance, 0 (black) to 1 (white); 1 for an unparseable colour. */
export function luma(c: string): number {
  const x = parse(c);
  if (!x) return 1;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(x[0]) + 0.7152 * lin(x[1]) + 0.0722 * lin(x[2]);
}
