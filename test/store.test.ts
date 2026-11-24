import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportProfile, getProfile, importProfile, prefs, record, resetProfile, retireGames, setLevel, stats } from '../src/core/store';

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

describe('retired games', () => {
  /** A saved profile that still has a removed game (swap) next to a current one (bricks). */
  const saved = () => {
    const st = { played: 4, cleared: 3, lost: 1, skipped: 0, time: 1000, best: { 1: 900 }, stars: { 1: 3 }, recent: [] };
    const pr = { level: 2, manual: false, weight: 2, since: 0 };
    return JSON.stringify({
      v: 1,
      name: 'Old',
      created: 0,
      theme: 'system',
      autoAdvance: true,
      startLevel: 1,
      types: { swap: pr, bricks: pr },
      stats: { swap: st, bricks: st },
      days: {},
      offApplied: ['swap'],
    });
  };

  it('drops their stats from a saved profile on load, keeping the rest', async () => {
    localStorage.setItem('arcade-feed:v1', saved());
    vi.resetModules();
    const store = await import('../src/core/store');
    const { GAMES } = await import('../src/games');
    expect(GAMES.some((g) => g.id === 'swap')).toBe(false);
    const p = store.getProfile();
    expect(p.stats['swap']).toBeUndefined();
    expect(p.types['swap']).toBeUndefined();
    expect(p.offApplied).not.toContain('swap');
    expect(p.stats['bricks'].best[1]).toBe(900);
    expect(JSON.parse(localStorage.getItem('arcade-feed:v1')!).stats.swap).toBeUndefined();
    // The current games still record normally.
    expect(store.record('bricks', { d: 1, o: 'cleared', score: 950, stars: 3, ms: 1 }).best).toBe(true);
    localStorage.clear();
  });

  it('drops them from an imported profile too', () => {
    retireGames(['swap']);
    importProfile(saved());
    expect(getProfile().stats['swap']).toBeUndefined();
    expect(getProfile().types['bricks'].level).toBe(2);
    expect(JSON.parse(exportProfile()).stats.swap).toBeUndefined();
    resetProfile();
  });
});
