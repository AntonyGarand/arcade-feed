/**
 * Shapes that tell colour-matched pieces apart without relying on colour (Marble Chain marbles, Fruit Merge
 * sizes): glyph `k` always pairs with palette colour `k`, so the shape is a second cue.
 */
const GLYPHS = 8;

/** Trace glyph `k` centred on (x, y), fitting a circle of radius `r`. Call fill/stroke afterwards. */
export function glyphPath(g: CanvasRenderingContext2D, k: number, x: number, y: number, r: number) {
  g.beginPath();
  const poly = (n: number, rot: number, inner = 0) => {
    const pts = inner ? n * 2 : n;
    for (let i = 0; i < pts; i++) {
      const a = rot + (i * Math.PI * 2) / pts;
      const rr = inner && i % 2 ? inner : r;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
  };
  switch (k % GLYPHS) {
    case 0: // circle
      g.arc(x, y, r * 0.92, 0, Math.PI * 2);
      break;
    case 1: // diamond
      poly(4, -Math.PI / 2);
      break;
    case 2: // square
      g.roundRect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6, r * 0.2);
      break;
    case 3: // triangle
      poly(3, -Math.PI / 2);
      break;
    case 4: // star
      poly(5, -Math.PI / 2, r * 0.48);
      break;
    case 5: // hexagon
      poly(6, 0);
      break;
    case 6: {
      // plus
      const a = r * 0.36;
      const b = r * 0.92;
      g.moveTo(x - a, y - b);
      for (const [px, py] of [
        [a, -b],
        [a, -a],
        [b, -a],
        [b, a],
        [a, a],
        [a, b],
        [-a, b],
        [-a, a],
        [-b, a],
        [-b, -a],
        [-a, -a],
      ])
        g.lineTo(x + px, y + py);
      g.closePath();
      break;
    }
    default: // four-point star
      poly(4, -Math.PI / 2, r * 0.42);
  }
}
