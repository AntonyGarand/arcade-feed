import { beforeEach, describe, expect, it } from 'vitest';
import { prefs, record, resetProfile, setLevel, stats } from '../src/core/store';

const run = (o: 'cleared' | 'lost', stars: 0 | 1 | 2 | 3, score = 100) =>
  record('demo', { d: prefs('demo').level, o, score, stars, ms: 30_000 });

describe('store', () => {
  beforeEach(() => resetProfile());

  it('keeps the best score and most stars per level', () => {
    run('cleared', 1, 300);
    const r = run('cleared', 2, 500);
    expect(r.best).toBe(true);
    expect(r.prevBest).toBe(300);
    run('lost', 0, 900);
    const s = stats('demo');
    expect(s.best[1]).toBe(900);
    expect(s.stars[1]).toBe(2);
    expect([s.played, s.cleared, s.lost]).toEqual([3, 2, 1]);
  });

  it('levels up after two three-star clears, or three clears with two stars', () => {
    expect(run('cleared', 3).levelChange).toBeUndefined();
    expect(run('cleared', 3).levelChange).toEqual({ from: 1, to: 2 });
    run('cleared', 2);
    run('cleared', 2);
    expect(run('cleared', 2).levelChange).toEqual({ from: 2, to: 3 });
  });

  it('eases off after two losses in a row, but never on a fixed level', () => {
    setLevel('demo', 3);
    run('lost', 0);
    expect(run('lost', 0).levelChange).toBeUndefined();
    expect(prefs('demo').level).toBe(3);
    setLevel('demo', 'auto');
    expect(run('lost', 0).levelChange).toEqual({ from: 3, to: 2 });
  });
});
