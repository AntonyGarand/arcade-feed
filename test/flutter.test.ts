import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { flutter } from '../src/games/flutter';
import {
  BIRD_R,
  caveAt,
  COL_W,
  COMBO_TIERS,
  createLevel,
  flap,
  FLYER_R,
  FX,
  gapFor,
  GATE_POINTS,
  gatesFor,
  grant,
  GROUND,
  KINDS,
  LIFE_BONUS,
  livesFor,
  nextColumn,
  pickupsFor,
  speedFor,
  step,
  swingFor,
  TRAIL,
  type KindId,
  type State,
} from '../src/games/flutter/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/**
 * The plain policy: flap whenever the flyer sinks below a line (a flap peaks ~40 above it), set in the
 * next gap: near its star or the next coin with `greedy`, and around a bird in the way.
 */
function band(s: State, greedy: boolean) {
  const c = nextColumn(s);
  if (!c) return;
  // A sliding gate: aim where it will be once the flyer gets there.
  const gy = c.amp ? c.gy0 + c.amp * Math.sin((s.flight + Math.max(0, c.x - s.dist - FX) / s.speed) * 1.5 + c.phase) : c.gy;
  const top = gy - c.gap / 2;
  const bottom = gy + c.gap / 2;
  let line = Math.max(top + 54, Math.min(bottom - 14, gy + 20));
  const next = greedy ? s.pickups.find((p) => !p.taken && p.x - s.dist > FX - 4 && p.x <= c.x + COL_W) : undefined;
  if (next) line = next.coin ? next.y + 22 : Math.max(top + 54, Math.min(bottom - 14, next.y - c.gy + gy + 20));
  const bird = s.birds.find((b) => !b.gone && b.x - s.dist - FX > -BIRD_R - FLYER_R && b.x - s.dist - FX < 90);
  if (bird && bird.y0 > gy) line = Math.min(line, bird.y0 - bird.amp - BIRD_R - FLYER_R - 4);
  else if (bird) line = Math.max(line, bird.y0 + bird.amp + BIRD_R + FLYER_R + 44);
  const w = caveAt(s, s.dist + FX + 30);
  if (w) line = Math.max(w[0] + 50, Math.min(w[1] - 14, line));
  // In a draft a flap carries further (or less far) than the ~40 the line allows for.
  const at = s.dist + FX;
  const g = 900 + s.drafts.reduce((f, d) => f + (at >= d.x0 - 20 && at <= d.x1 ? d.force : 0), 0);
  line += 270 ** 2 / (2 * g) - 40;
  if (s.y + s.vy * DT > line) flap(s);
}

/** Fly the band policy, aimed at the pickups (greedy) or at the middle of each gap. */
function autopilot(d: Difficulty, seed: number, greedy = true, kind: KindId = 'meadow') {
  const s = createLevel(d, new Rng(seed), kind);
  flap(s);
  for (let t = 0; t < 200; t += DT) {
    band(s, greedy);
    const ev = step(s, DT);
    if (ev.won) return { s, win: true };
    if (ev.over) return { s, win: false };
  }
  throw new Error('never ended');
}

describe('flutter rules', () => {
  it('deals the same kind and columns from the same seed', () => {
    const a = createLevel(3, new Rng(9));
    const b = createLevel(3, new Rng(9));
    expect(a.kind).toBe(b.kind);
    expect(a.cols).toEqual(b.cols);
    expect(a.pickups).toEqual(b.pickups);
    expect(a.birds).toEqual(b.birds);
    expect(createLevel(3, new Rng(9)).cols).not.toEqual(createLevel(3, new Rng(10)).cols);
  });

  it('deals different kinds across seeds, each allowed at its level', () => {
    for (const d of LEVELS) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 80; seed++) seen.add(createLevel(d, new Rng(seed)).kind);
      expect([...seen].sort()).toEqual(
        kindsAt(d, KINDS)
          .map((k) => k.id)
          .sort(),
      );
    }
  });

  it('gets harder: more gates, tighter gaps, faster, wilder swings, fewer lives', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(gatesFor(d)).toBeGreaterThan(gatesFor(lo));
      expect(gapFor(d)).toBeLessThan(gapFor(lo));
      expect(speedFor(d)).toBeGreaterThan(speedFor(lo));
      expect(swingFor(d)).toBeGreaterThan(swingFor(lo));
      expect(livesFor(d)).toBeLessThanOrEqual(livesFor(lo));
    }
  });

  it('hovers until the first flap', () => {
    const s = createLevel(1, new Rng(1));
    for (let i = 0; i < 300; i++) step(s, DT);
    expect(s.dist).toBe(0);
    expect(s.lives).toBe(livesFor(1));
  });

  it('is cleared by a flapping autopilot at every level', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed));
      const wins = runs.filter((r) => r.win);
      expect(wins.length, `level ${d}`).toBeGreaterThanOrEqual(5);
      const [two, three] = flutter.stars(d);
      for (const r of wins) {
        expect(r.s.score).toBeGreaterThanOrEqual(gatesFor(d) * GATE_POINTS + LIFE_BONUS);
        expect(r.s.score, `level ${d} two stars`).toBeGreaterThanOrEqual(two);
      }
      // A clean, greedy run reaches three stars on most seeds.
      expect(wins.filter((r) => r.s.score >= three).length, `level ${d} three stars`).toBeGreaterThanOrEqual(3);
      // Ignoring the stars rarely earns three (the combo magnet can still reel some in).
      const lazy = [1, 2, 3, 4, 5, 6].filter((seed) => autopilot(d, seed, false).s.score >= three);
      expect(lazy.length, `level ${d} lazy three stars`).toBeLessThanOrEqual(2);
    }
  });

  it('deals every kind allowed at a level with the same pickup value, and each can be cleared', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const s0 = createLevel(d, new Rng(7), id);
        expect(s0.cols.length).toBe(gatesFor(d));
        const value = s0.pickups.reduce((v, p) => v + (p.coin ? 1 / TRAIL : 1), 0);
        expect(value, `${id} ${d}`).toBeCloseTo(pickupsFor(d));
        const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed, true, id));
        const wins = runs.filter((r) => r.win);
        expect(wins.length, `${id} level ${d}`).toBeGreaterThanOrEqual(4);
        const [two, three] = flutter.stars(d);
        for (const r of wins) expect(r.s.score, `${id} level ${d} two stars`).toBeGreaterThanOrEqual(two);
        // Ignoring the pickups stays below three stars on average in every kind.
        const lazy = [1, 2, 3].reduce((t, seed) => t + autopilot(d, seed, false, id).s.score, 0) / 3;
        expect(lazy, `${id} level ${d}`).toBeLessThan(three);
      }
  });

  it('kinds bring their own pieces: moving gates, cave walls, drafts, coins, birds', () => {
    const slide = createLevel(3, new Rng(2), 'sliding');
    expect(slide.cols.slice(1).every((c) => c.amp > 0)).toBe(true);
    flap(slide);
    const gy = slide.cols[3].gy;
    for (let i = 0; i < 30; i++) step(slide, DT);
    expect(slide.cols[3].gy).not.toBe(gy);

    const cave = createLevel(3, new Rng(2), 'cave');
    expect(cave.cols[0].gap).toBeGreaterThan(cave.cols[cave.cols.length - 1].gap);
    const between = cave.cols[1].x + COL_W + 20;
    const w = caveAt(cave, between)!;
    expect(w[0]).toBeLessThan(w[1]);
    expect(caveAt(createLevel(3, new Rng(2), 'meadow'), between)).toBeNull();

    expect(createLevel(3, new Rng(2), 'windy').drafts.length).toBeGreaterThan(0);
    expect(createLevel(3, new Rng(2), 'trails').pickups.every((p) => p.coin)).toBe(true);
    expect(createLevel(3, new Rng(2), 'flock').birds.length).toBeGreaterThan(0);
  });

  it('a bird costs a heart and scatters', () => {
    const s = createLevel(3, new Rng(5), 'flock');
    flap(s);
    const b = s.birds[0];
    s.dist = b.x - FX;
    s.y = b.y;
    s.vy = 0;
    s.cols = [];
    s.pickups = [];
    const ev = step(s, DT);
    expect(ev.hurt).toBe(true);
    expect(ev.bird).not.toBeNull();
    expect(b.gone).toBe(true);
    expect(s.lives).toBe(livesFor(3) - 1);
  });

  it('a clean streak unlocks a shield, then a magnet, then slow motion', () => {
    const s = createLevel(5, new Rng(3), 'meadow');
    flap(s);
    const unlocked: string[] = [];
    for (let t = 0; t < 200 && unlocked.length < 3; t += DT) {
      band(s, true);
      const ev = step(s, DT);
      if (ev.unlocked) unlocked.push(ev.unlocked);
      if (ev.won || ev.over) break;
    }
    expect(unlocked).toEqual(['shield', 'magnet', 'slow']);
    expect(s.combo).toBeGreaterThanOrEqual(COMBO_TIERS[2]);
  });

  it('the shield takes a crash instead of a heart, and keeps the combo', () => {
    const s = createLevel(2, new Rng(4));
    flap(s);
    grant(s, 'shield');
    s.combo = 7;
    s.y = GROUND;
    s.vy = 0;
    const ev = step(s, DT);
    expect(ev.shielded).toBe(true);
    expect(ev.hurt).toBe(false);
    expect(s.shield).toBe(false);
    expect(s.lives).toBe(livesFor(2));
    expect(s.combo).toBe(7);
  });

  it('slow motion slows the scroll; the magnet reels pickups in', () => {
    const a = createLevel(3, new Rng(8), 'meadow');
    const b = createLevel(3, new Rng(8), 'meadow');
    flap(a);
    flap(b);
    grant(b, 'slow');
    step(a, DT);
    step(b, DT);
    expect(b.dist).toBeLessThan(a.dist);

    const s = createLevel(3, new Rng(8), 'trails');
    flap(s);
    grant(s, 'magnet');
    const p = s.pickups[0];
    s.dist = p.x - FX - 40;
    s.y = p.y + 30;
    s.cols = [];
    s.drafts = [];
    let got = false;
    for (let i = 0; i < 30 && !got; i++) {
      s.vy = 0;
      got = step(s, DT).coins > 0;
    }
    expect(got).toBe(true);
  });

  it('loses a life per crash, respawns in the gap, and ends at zero', () => {
    const s = createLevel(2, new Rng(4), 'meadow');
    flap(s);
    let hurt = 0;
    let over = false;
    const respawns: number[] = [];
    const gaps: number[] = [];
    for (let t = 0; t < 60 && !over; t += DT) {
      const ev = step(s, DT); // never flap again: drop to the ground
      if (ev.hurt) hurt++;
      if (ev.hurt && !ev.over) {
        respawns.push(s.y);
        gaps.push(nextColumn(s)!.gy);
      }
      over = ev.over;
    }
    expect(over).toBe(true);
    expect(respawns).toEqual(gaps);
    expect(hurt).toBe(livesFor(2));
  });
});

describe('flutter card', () => {
  const press = (m: ReturnType<typeof mountGame>, type: 'keydown' | 'keyup') => m.inst.onKey?.(new KeyboardEvent(type, { key: ' ' }));

  it('names the kind of level on the gate', () => {
    for (let seed = 1; seed < 6; seed++) {
      const m = mountGame(flutter, 3, seed);
      expect(m.variant?.id).toBe(createLevel(3, new Rng(seed)).kind);
      expect(m.variant!.name.length).toBeLessThanOrEqual(18);
      expect((m.variant!.blurb ?? '').length).toBeLessThanOrEqual(60);
      m.inst.destroy?.();
      m.root.remove();
    }
  });

  for (const d of [1, 5] as const)
    it(`mounts at level ${d}, flies with Space and reports progress`, () => {
      const m = mountGame(flutter, d, 3);
      expect(m.lives).toEqual([livesFor(d), livesFor(d)]);
      expect(m.status).not.toBe('');
      m.run(2);
      expect(m.outcome).toBe('');
      const before = m.status;
      // A flap every 0.6 s holds the height (the first column is still a little way off).
      for (let i = 0; i < 2; i++) {
        expect(press(m, 'keydown')).toBe(true);
        press(m, 'keyup');
        m.run(0.6);
      }
      expect(m.outcome).toBe('');
      expect(m.status).not.toBe(before);
      // Stop flapping: the flyer drops and the lives run out.
      m.run(30);
      expect(m.outcome).toBe('lose');
      m.inst.destroy?.();
      m.root.remove();
    });
});
