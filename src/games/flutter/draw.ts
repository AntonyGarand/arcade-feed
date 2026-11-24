/** Drawing for Flutter's level pieces: gusts, cave walls, coins and birds. */
import { alpha, mix } from '../../kits/arena/color';
import type { Arena } from '../../kits/arena/arena';
import { BIRD_R, caveAt, COIN_R, GROUND, W, type State } from './rules';

/** Gusts: a tinted band with chevrons drifting the way the air pushes. */
export function drawDrafts(g: CanvasRenderingContext2D, arena: Arena, s: State) {
  const c = arena.colors;
  for (const d of s.drafts) {
    const x0 = d.x0 - s.dist;
    const x1 = d.x1 - s.dist;
    if (x1 < -10 || x0 > W + 10) continue;
    const up = d.force < 0;
    const col = up ? c.p[4] : c.p[5];
    g.fillStyle = alpha(col, arena.dark ? 0.12 : 0.1);
    g.fillRect(x0, 0, x1 - x0, GROUND);
    g.strokeStyle = alpha(arena.dark ? col : mix(col, c.ink, 0.25), 0.55);
    g.lineWidth = arena.lw;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const off = (arena.time * Math.abs(d.force) * 0.12) % 44;
    const dy = up ? -5 : 5;
    for (let k = 0; k < 2; k++) {
      const cx = x0 + ((x1 - x0) * (k + 1)) / 3;
      for (let y0 = -44; y0 < GROUND + 44; y0 += 44) {
        const cy = (up ? y0 + 44 - off : y0 + off) + k * 22;
        if (cy < 6 || cy > GROUND - 6) continue;
        g.beginPath();
        g.moveTo(cx - 6, cy - dy / 2);
        g.lineTo(cx, cy + dy / 2);
        g.lineTo(cx + 6, cy - dy / 2);
        g.stroke();
      }
    }
    g.lineCap = 'butt';
  }
}

/** Cave: rock ceiling and floor between the columns, one path each, with a bumpy rim. */
export function drawCave(g: CanvasRenderingContext2D, arena: Arena, s: State, rock: string) {
  if (!s.cave) return;
  const c = arena.colors;
  g.fillStyle = alpha(c.coal, arena.dark ? 0.18 : 0.08);
  g.fillRect(0, 0, W, GROUND);
  const runs: [number, number, number][][] = [];
  let run: [number, number, number][] = [];
  for (let x = -12; x <= W + 12; x += 4) {
    const w = caveAt(s, x + s.dist);
    if (w) run.push([x, w[0], w[1]]);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  const bump = (x: number) => Math.sin((x + s.dist) * 0.21) * 2.5;
  const edge = arena.tone(rock).edge;
  for (const r of runs)
    for (const ceil of [true, false]) {
      g.beginPath();
      g.moveTo(r[0][0], ceil ? -8 : GROUND + 4);
      for (const [x, top, bottom] of r) g.lineTo(x, ceil ? top + bump(x) : bottom - bump(x));
      g.lineTo(r[r.length - 1][0], ceil ? -8 : GROUND + 4);
      g.closePath();
      g.fillStyle = rock;
      g.fill();
      g.strokeStyle = edge;
      g.lineWidth = arena.lw;
      g.stroke();
    }
}

/** A spinning coin. */
export function drawCoin(g: CanvasRenderingContext2D, arena: Arena, x: number, y: number) {
  const c = arena.colors;
  const k = Math.abs(Math.cos(arena.time * 4 + x * 0.05));
  g.save();
  g.translate(x, y);
  g.scale(0.35 + 0.65 * k, 1);
  arena.ball(g, 0, 0, COIN_R, c.p[3], false);
  g.strokeStyle = arena.tone(c.p[3]).edge;
  g.lineWidth = arena.lw * 0.6;
  g.beginPath();
  g.arc(0, 0, COIN_R * 0.55, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** A bird: round body, a beating wing, an angry eye and a beak pointing at you. */
export function drawBird(g: CanvasRenderingContext2D, arena: Arena, x: number, y: number, seed: number) {
  const c = arena.colors;
  const tone = arena.tone(c.bad);
  const beat = Math.sin(arena.time * 14 + seed);
  g.fillStyle = tone.hi;
  g.strokeStyle = tone.edge;
  g.lineWidth = arena.lw * 0.6;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x + 1, y - 2);
  g.lineTo(x + 9, y - 4 - beat * 9);
  g.lineTo(x + 6, y + 1);
  g.closePath();
  g.fill();
  g.stroke();
  arena.ball(g, x, y, BIRD_R, c.bad);
  g.fillStyle = c.p[0];
  g.strokeStyle = arena.tone(c.p[0]).edge;
  g.beginPath();
  g.moveTo(x - BIRD_R + 2, y - 3);
  g.lineTo(x - BIRD_R - 6, y);
  g.lineTo(x - BIRD_R + 2, y + 3);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = c.paper;
  g.beginPath();
  g.arc(x - 3, y - 3, 2.8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = c.coal;
  g.beginPath();
  g.arc(x - 3.8, y - 2.8, 1.3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = c.coal;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(x - 6.5, y - 7.5);
  g.lineTo(x - 0.5, y - 5.5);
  g.stroke();
}
