import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { dealKind, kindsAt } from '../src/core/variety';
import { Combo } from '../src/kits/combo/combo';

describe('Combo', () => {
  it('fires each milestone once and resets on break', () => {
    const fired: number[] = [];
    const ends: number[] = [];
    const c = new Combo({ tiers: [3, 6], onTier: (t) => fired.push(t), onEnd: (n) => ends.push(n) });
    for (let i = 0; i < 7; i++) c.hit();
    expect(fired).toEqual([1, 2]);
    expect(c.mult).toBe(3);
    c.break();
    expect(ends).toEqual([7]);
    expect(c.count).toBe(0);
    expect(c.best).toBe(7);
    c.hit(3);
    expect(fired).toEqual([1, 2, 1]);
  });

  it('times out after its window', () => {
    const c = new Combo({ window: 1 });
    c.hit();
    c.hit();
    c.update(0.5);
    expect(c.count).toBe(2);
    expect(c.heat).toBeCloseTo(0.5);
    c.update(0.6);
    expect(c.count).toBe(0);
  });
});

describe('dealKind', () => {
  const kinds = [{ id: 'a' }, { id: 'b', min: 3 as const }, { id: 'c', max: 2 as const, weight: 3 }];
  it('only deals kinds allowed at the level', () => {
    expect(kindsAt(1, kinds).map((k) => k.id)).toEqual(['a', 'c']);
    expect(kindsAt(4, kinds).map((k) => k.id)).toEqual(['a', 'b']);
    const rng = new Rng(7);
    for (let i = 0; i < 50; i++) expect(dealKind(rng, 5, kinds).id).not.toBe('c');
  });
  it('is deterministic for a seed', () => {
    expect(dealKind(new Rng(42), 3, kinds)).toBe(dealKind(new Rng(42), 3, kinds));
  });
});
