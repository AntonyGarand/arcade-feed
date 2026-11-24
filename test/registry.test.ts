import { afterEach, describe, expect, it } from 'vitest';
import { _setLocaleForTests } from '../src/core/i18n';
import { CATEGORIES } from '../src/core/categories';
import { LEVELS } from '../src/core/types';
import { GAMES } from '../src/games';
import { mountGame } from './support/mount';

afterEach(() => _setLocaleForTests('en'));

describe('game registry', () => {
  it('finds every game, with unique ids and a known category', () => {
    expect(GAMES.length).toBeGreaterThan(0);
    expect(new Set(GAMES.map((g) => g.id)).size).toBe(GAMES.length);
    for (const g of GAMES) expect(CATEGORIES.map((c) => c.id)).toContain(g.category);
  });

  for (const locale of ['en', 'fr'] as const)
    it(`keeps names and rules short, with a full tutorial (${locale})`, () => {
      _setLocaleForTests(locale);
      for (const g of GAMES) {
        expect(g.name.length, g.id).toBeGreaterThan(0);
        expect(g.rules.length, `${g.id} rules`).toBeLessThanOrEqual(60);
        const help = g.help?.();
        expect(help, `${g.id} help`).toBeDefined();
        expect(help!.steps.length, `${g.id} steps`).toBeGreaterThanOrEqual(3);
        expect(help!.steps.length, `${g.id} steps`).toBeLessThanOrEqual(6);
      }
    });

  it('has rising star goals and a run length at every level', () => {
    for (const g of GAMES)
      for (const d of LEVELS) {
        const [two, three] = g.stars(d);
        expect(two, `${g.id} ${d}`).toBeGreaterThan(0);
        expect(three, `${g.id} ${d}`).toBeGreaterThan(two);
        expect(g.par(d), `${g.id} ${d}`).toBeGreaterThan(0);
      }
  });

  it('mounts and runs every level for a few seconds without throwing or ending at once', () => {
    for (const g of GAMES)
      for (const d of LEVELS) {
        const m = mountGame(g, d, 7);
        expect(m.outcome, `${g.id} ${d}`).toBe('');
        m.run(3);
        m.inst.destroy?.();
        m.root.remove();
      }
  });

  it.each(['en', 'fr'] as const)('gives on-screen buttons keys their game handles, with short labels (%s)', (locale) => {
    _setLocaleForTests(locale);
    for (const g of GAMES) {
      const pad = g.pad?.();
      if (!pad) continue;
      const buttons = [...(pad.left === 'dpad' ? [] : (pad.left ?? [])), ...(pad.right ?? [])];
      const keys = [...buttons.map((b) => b.key), ...(pad.left === 'dpad' ? ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'] : [])];
      for (const b of buttons) expect(b.label.length, `${g.id} ${b.label}`).toBeLessThanOrEqual(18);
      const m = mountGame(g, 1, 7);
      for (const key of keys) {
        expect(m.inst.onKey?.(new KeyboardEvent('keydown', { key })), `${g.id} ${key} down`).toBe(true);
        m.inst.onKey?.(new KeyboardEvent('keyup', { key })); // releases may go unhandled (a tap action)
      }
      m.inst.destroy?.();
      m.root.remove();
    }
  });
});
