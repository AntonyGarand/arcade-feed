import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LEVELS, type Difficulty } from '../src/core/types';
import { kindsAt } from '../src/core/variety';
import { runner } from '../src/games/runner';
import {
  APEX_S,
  BAR_GAP,
  birdX,
  COMBO_TIERS,
  coinsFor,
  createLevel,
  DASH_S,
  duck,
  grant,
  KINDS,
  lengthFor,
  LIFE_BONUS,
  livesFor,
  press,
  PW,
  release,
  slackFor,
  speedAt,
  speedFor,
  step,
  type KindId,
  type Power,
  type State,
} from '../src/games/runner/rules';
import { mountGame } from './support/mount';

const DT = 1 / 60;

/** Next obstacle not yet behind the runner (a bird by where it flies now). */
const ahead = (s: State) => s.obstacles.find((o) => !o.smashed && (o.kind === 'bird' ? birdX(o, s.x) + o.w / 2 : o.x + o.w) > s.x - PW / 2);

/**
 * Jump so the top of a full jump is over the middle of each block, pit or low bird, duck under bars,
 * tunnels and high birds, let springs launch you. `late` reacts this many seconds late (a sloppy player).
 */
function autopilot(d: Difficulty, seed: number, late = 0, kind?: KindId) {
  const s = createLevel(d, new Rng(seed), kind);
  for (let t = 0; t < 240; t += DT) {
    const o = ahead(s);
    const v = speedAt(d, s.x, s.pace);
    s.duckKey = false;
    if (o) {
      // Birds fly your way, so they close in slower.
      const close = o.kind === 'bird' ? v * (1 - (o.k ?? 0)) : v;
      const at = o.kind === 'bird' ? birdX(o, s.x) - o.w / 2 : o.x;
      const low = o.kind === 'bar' || o.kind === 'tunnel' || (o.kind === 'bird' && o.h === BAR_GAP);
      if (low) s.duckKey = at - (s.x + PW / 2) < close * (0.1 - late);
      else if (o.kind !== 'spring' && !o.chasm && s.grounded && at + o.w / 2 - s.x <= close * (APEX_S - late)) press(s);
    }
    if (s.grounded && s.holding) release(s);
    const ev = step(s, DT);
    if (ev.won) return { s, win: true };
    if (ev.over) return { s, win: false };
  }
  throw new Error('never ended');
}

describe('runner rules', () => {
  it('deals the same track from the same seed', () => {
    const a = createLevel(3, new Rng(8));
    expect(a.kind).toBe(createLevel(3, new Rng(8)).kind);
    expect(a.obstacles).toEqual(createLevel(3, new Rng(8)).obstacles);
    expect(a.coins).toEqual(createLevel(3, new Rng(8)).coins);
    expect(a.obstacles).not.toEqual(createLevel(3, new Rng(9)).obstacles);
    expect(a.coins.length).toBe(coinsFor(3));
  });

  it('gets harder: longer, faster, denser, fewer lives, new obstacle kinds', () => {
    for (const d of LEVELS.slice(1)) {
      const lo = (d - 1) as Difficulty;
      expect(lengthFor(d)).toBeGreaterThan(lengthFor(lo));
      expect(speedFor(d)).toBeGreaterThan(speedFor(lo));
      expect(slackFor(d)).toBeLessThan(slackFor(lo));
      expect(livesFor(d)).toBeLessThanOrEqual(livesFor(lo));
    }
    const kinds = (d: Difficulty) => new Set(createLevel(d, new Rng(1), 'city').obstacles.map((o) => o.kind));
    expect([...kinds(1)]).toEqual(['block']);
    expect(kinds(2).has('pit')).toBe(true);
    expect(kinds(4).has('bar')).toBe(true);
    // Speed also ramps within the run.
    expect(speedAt(1, lengthFor(1))).toBeGreaterThan(speedAt(1, 0));
  });

  it('jumps higher when held than when tapped', () => {
    const peak = (hold: boolean) => {
      const s = createLevel(1, new Rng(1), 'city');
      press(s);
      if (!hold) release(s);
      let top = 0;
      for (let i = 0; i < 40; i++) {
        step(s, DT);
        top = Math.max(top, s.y);
      }
      return top;
    };
    expect(peak(true)).toBeGreaterThan(peak(false) * 2);
  });

  it('is cleared by a well-timed autopilot at every level, a sloppy one scoring less', () => {
    for (const d of LEVELS) {
      const runs = [1, 2, 3, 4, 5, 6].map((seed) => autopilot(d, seed));
      const [two, three] = runner.stars(d);
      for (const r of runs) {
        expect(r.win, `level ${d}`).toBe(true);
        expect(r.s.score, `level ${d}`).toBeGreaterThanOrEqual(three);
        expect(r.s.score).toBeGreaterThanOrEqual(r.s.lives * LIFE_BONUS);
      }
      // Jumping a little early is forgiven: every obstacle leaves some slack.
      for (const seed of [1, 2, 3]) expect(autopilot(d, seed, -0.08).win, `level ${d} early`).toBe(true);
      // A tenth of a second late misses coins (or worse): never three stars on a city run, and less
      // than three on average in every kind (slower birds forgive a late jump a little).
      const sloppy = [1, 2, 3].map((seed) => autopilot(d, seed, 0.1, 'city')).filter((r) => r.win);
      expect(sloppy.filter((r) => r.s.score >= three)).toEqual([]);
      for (const { id } of kindsAt(d, KINDS)) {
        const scores = [1, 2, 3].map((seed) => autopilot(d, seed, 0.1, id).s.score);
        expect(scores.reduce((a, b) => a + b) / 3, `${id} level ${d}`).toBeLessThan(three);
      }
      expect(two).toBeLessThan(three);
    }
  });

  it('costs a heart for a block, a pit or a bar, and ends at zero', () => {
    for (const d of [1, 3, 5] as const) {
      const s = createLevel(d, new Rng(2), 'city');
      let hurt = 0;
      let over = false;
      for (let t = 0; t < 120 && !over; t += DT) {
        const ev = step(s, DT); // never jump
        if (ev.hurt) hurt++;
        over = ev.over;
      }
      expect(over, `level ${d}`).toBe(true);
      expect(hurt).toBe(livesFor(d));
    }
  });

  it('cancels the hop a swipe starts with, so a swipe down under a bar never lifts you into it', () => {
    const s = createLevel(5, new Rng(3), 'city');
    const bar = s.obstacles.find((o) => o.kind === 'bar')!;
    s.x = bar.x - 30;
    press(s); // the press that starts the swipe jumps…
    step(s, DT);
    step(s, DT);
    duck(s); // …and the swipe down undoes it
    expect(s.grounded).toBe(true);
    expect(s.y).toBe(0);
    let hurt = false;
    for (let i = 0; i < 20; i++) hurt ||= step(s, DT).hurt;
    expect(hurt).toBe(false);
  });

  it('ducks under a bar with a swipe', () => {
    const s = createLevel(5, new Rng(3), 'city');
    const bar = s.obstacles.find((o) => o.kind === 'bar')!;
    s.x = bar.x - 40;
    duck(s);
    let hurt = false;
    for (let i = 0; i < 20; i++) hurt ||= step(s, DT).hurt;
    expect(hurt).toBe(false);
    expect(s.x).toBeGreaterThan(bar.x + bar.w);
  });
});

describe('runner level kinds', () => {
  it('deals several kinds of run across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(createLevel(4, new Rng(seed)).kind);
    expect(seen.size).toBe(kindsAt(4, KINDS).length);
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map((seed) => createLevel(1, new Rng(seed)).kind))).toEqual(new Set(['city', 'woods']));
  });

  it('gives each kind its own pieces, the same coins, and a run a good player clears with every coin', () => {
    for (const d of LEVELS)
      for (const { id } of kindsAt(d, KINDS)) {
        const s = createLevel(d, new Rng(5), id);
        const pieces = new Set(s.obstacles.map((o) => o.kind));
        expect(s.coins.length, `${id} ${d}`).toBe(coinsFor(d));
        const signature: Record<KindId, boolean> = {
          city: s.pace === 1 && !pieces.has('bird') && !pieces.has('tunnel') && !pieces.has('spring'),
          woods: pieces.has('bird'),
          springs: pieces.has('spring') && s.obstacles.some((o) => o.chasm),
          underpass: pieces.has('tunnel'),
          sprint: s.pace > 1 && s.length > lengthFor(d) && !pieces.has('bar'),
        };
        expect(signature[id], `${id} ${d}`).toBe(true);
        for (const seed of [1, 2, 3]) {
          const r = autopilot(d, seed, 0, id);
          expect(r.win, `${id} level ${d} seed ${seed}`).toBe(true);
          expect(r.s.collected, `${id} level ${d} seed ${seed}`).toBe(coinsFor(d));
          expect(r.s.score).toBeGreaterThanOrEqual(runner.stars(d)[1]);
          // Every kind runs about as long (par only sees the level).
          expect(r.s.time).toBeGreaterThan(runner.par(d) * 0.8);
          expect(r.s.time).toBeLessThan(runner.par(d) * 1.25);
        }
      }
  });

  it('flies a spring over a chasm on its own, and a tap mid-flight does not cut it short', () => {
    const s = createLevel(3, new Rng(2), 'springs');
    const i = s.obstacles.findIndex((o) => o.kind === 'spring');
    const chasm = s.obstacles[i + 1];
    expect(chasm.chasm).toBe(true);
    s.x = s.obstacles[i].x - 40;
    let sprung = false;
    let hurt = false;
    for (let t = 0; t < 2; t += DT) {
      const ev = step(s, DT);
      if (ev.sprung) {
        sprung = true;
        press(s);
        release(s);
      }
      hurt ||= ev.hurt;
    }
    expect(sprung).toBe(true);
    expect(hurt).toBe(false);
    expect(s.x).toBeGreaterThan(chasm.x + chasm.w);
  });

  it('keeps one swiped duck going all the way through a long tunnel', () => {
    const s = createLevel(3, new Rng(1), 'underpass');
    const tunnel = s.obstacles.find((o) => o.kind === 'tunnel')!;
    expect(tunnel.w).toBeGreaterThan(100);
    s.x = tunnel.x - 30;
    duck(s);
    let hurt = false;
    while (s.x < tunnel.x + tunnel.w + PW) hurt ||= step(s, DT).hurt;
    expect(hurt).toBe(false);
  });

  it('hits you with a bird unless you jump a low one or duck a high one', () => {
    const s0 = createLevel(4, new Rng(3), 'woods');
    for (const h of [4, BAR_GAP]) {
      const i = s0.obstacles.findIndex((o) => o.kind === 'bird' && o.h === h);
      expect(i).toBeGreaterThanOrEqual(0);
      const run = (dodge: boolean) => {
        const s = createLevel(4, new Rng(3), 'woods');
        const bird = s.obstacles[i];
        s.x = bird.x - 160;
        let hurt = false;
        for (let t = 0; t < 1.5; t += DT) {
          const gap = birdX(bird, s.x) - s.x;
          const close = speedAt(4, s.x) * (1 - bird.k!);
          if (dodge && h === BAR_GAP) s.duckKey = gap < close * 0.25 && gap > -20;
          if (dodge && h !== BAR_GAP && s.grounded && gap <= close * APEX_S && gap > 0) press(s);
          hurt ||= step(s, DT).hurt;
        }
        return hurt;
      };
      expect(run(false), `bird at ${h}`).toBe(true);
      expect(run(true), `bird at ${h}`).toBe(false);
    }
  });
});

describe('runner combo', () => {
  it('a clean run unlocks a magnet, then a shield, then a dash', () => {
    const s = createLevel(3, new Rng(4), 'city');
    const got: Power[] = [];
    const at: number[] = [];
    for (let t = 0; t < 60 && got.length < 3; t += DT) {
      const o = ahead(s);
      const v = speedAt(3, s.x);
      s.duckKey = o?.kind === 'bar' && o.x - (s.x + PW / 2) < v * 0.1;
      if (o && o.kind !== 'bar' && s.grounded && o.x + o.w / 2 - s.x <= v * APEX_S) press(s);
      if (s.grounded && s.holding) release(s);
      const ev = step(s, DT);
      if (ev.unlocked) got.push(ev.unlocked);
      if (ev.unlocked) at.push(s.combo);
    }
    expect(got).toEqual(['magnet', 'shield', 'dash']);
    expect(at).toEqual(COMBO_TIERS.slice(0, 3));
    expect(s.dash).toBeGreaterThan(0);
    expect(s.shield).toBe(1);
  });

  it('a bump ends the combo; a shield takes the bump instead of a heart and keeps it', () => {
    const s = createLevel(1, new Rng(2), 'city');
    const crate = s.obstacles[0];
    s.x = crate.x - 40;
    s.combo = 7;
    s.tier = 1;
    grant(s, 'shield');
    let ev = step(s, DT);
    for (let t = 0; t < 0.5 && !ev.shielded; t += DT) ev = step(s, DT);
    expect(ev.shielded).toBe(true);
    expect(s.lives).toBe(livesFor(1));
    expect(s.shield).toBe(0);
    expect(s.combo).toBe(7);
    const next = s.obstacles[1];
    s.x = next.x - 40;
    s.invulnerable = 0;
    let hurt = false;
    for (let t = 0; t < 0.5 && !hurt; t += DT) hurt = step(s, DT).hurt;
    expect(hurt).toBe(true);
    expect(s.combo).toBe(0);
    expect(s.lives).toBe(livesFor(1) - 1);
  });

  it('a dash smashes crates and skims across holes without a jump', () => {
    const s = createLevel(3, new Rng(6), 'city');
    const crate = s.obstacles.find((o) => o.kind === 'block')!;
    const pit = s.obstacles.find((o) => o.kind === 'pit')!;
    s.x = crate.x - 30;
    grant(s, 'dash');
    expect(s.dash).toBe(DASH_S);
    let smashed = 0;
    let hurt = false;
    while (s.x < crate.x + crate.w + PW) {
      const ev = step(s, DT);
      smashed += ev.smashed.length;
      hurt ||= ev.hurt;
    }
    expect(smashed).toBe(1);
    expect(crate.smashed).toBe(true);
    s.x = pit.x - 30;
    grant(s, 'dash');
    while (s.x < pit.x + pit.w + PW) hurt ||= step(s, DT).hurt;
    expect(hurt).toBe(false);
    expect(s.falling).toBe(false);
    expect(s.y).toBe(0);
  });

  it('the magnet pulls in coins just out of reach', () => {
    const s = createLevel(1, new Rng(1), 'city');
    s.coins = [{ x: 30, y: 40, taken: false, g: 0 }];
    for (let t = 0; t < 0.3; t += DT) step(s, DT);
    expect(s.collected).toBe(0);
    s.x = 0;
    s.coins[0].x = 30;
    grant(s, 'magnet');
    for (let t = 0; t < 0.3; t += DT) step(s, DT);
    expect(s.collected).toBe(1);
  });
});

describe('runner card', () => {
  const key = (m: ReturnType<typeof mountGame>, type: 'keydown' | 'keyup', k: string) =>
    m.inst.onKey?.(new KeyboardEvent(type, { key: k }));

  it('names the kind of run on the start gate', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const m = mountGame(runner, 5, seed);
      const v = m.variant!;
      expect(v.name.length).toBeLessThanOrEqual(18);
      expect(v.blurb!.length).toBeLessThanOrEqual(60);
      seen.add(v.id);
      m.inst.destroy?.();
      m.root.remove();
    }
    expect(seen.size).toBe(kindsAt(5, KINDS).length);
  });

  for (const d of [1, 5] as const)
    it(`mounts at level ${d}, runs and jumps with the keyboard`, () => {
      const m = mountGame(runner, d, 4);
      expect(m.lives).toEqual([livesFor(d), livesFor(d)]);
      expect(m.status).not.toBe('');
      expect(key(m, 'keydown', ' ')).toBe(true);
      m.run(0.2);
      expect(key(m, 'keyup', ' ')).toBe(true);
      expect(key(m, 'keydown', 'ArrowDown')).toBe(true);
      m.run(0.3);
      key(m, 'keyup', 'ArrowDown');
      const before = m.status;
      m.run(1.5);
      expect(m.outcome).toBe('');
      expect(m.status).not.toBe(before);
      // Never jumping again: the obstacles take every heart.
      m.run(90);
      expect(m.outcome).toBe('lose');
      m.inst.destroy?.();
      m.root.remove();
    });
});
