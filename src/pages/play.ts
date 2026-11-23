import { sheetOpen } from '../ui/sheet';
import { L } from '../core/i18n';
import { Card } from '../app/card/card';
import { prefs } from '../core/store';
import type { Difficulty, GameDef } from '../core/types';
import { h } from '../ui/dom';

/** One game opened from the Games tab (`/game/<id>`), outside the feed. */
export class PlayView {
  readonly el = h('div', { class: 'lab' });
  private card: Card | null = null;
  private shown = false;

  constructor() {
    const onKey = (e: KeyboardEvent) => {
      if (!this.shown || !this.card || sheetOpen()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.card.onKey(e)) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    document.addEventListener('visibilitychange', () => this.card?.setActive(this.shown && !document.hidden));
  }

  /** Play `def` at `level` (default: its current level). "New level" deals another one at the same level. */
  open(def: GameDef, level?: Difficulty) {
    this.close();
    const start = (lvl: Difficulty) => {
      this.card?.setActive(false);
      this.card?.destroy();
      const card = new Card(def, (c) => start(c.level), { lab: true, level: lvl });
      this.card = card;
      this.el.replaceChildren(
        h(
          'div',
          { class: 'lab-bar' },
          h('a', { class: 'btn ghost', href: '/games' }, L('← Games', '← Jeux')),
          h('a', { class: 'btn ghost', href: `/play/${def.id}` }, L('Feed of this game', 'Fil de ce jeu')),
        ),
        card.el,
      );
      card.mount();
      card.setActive(this.shown && !document.hidden);
    };
    start(level ?? prefs(def.id).level);
  }

  setShown(shown: boolean) {
    this.shown = shown;
    this.card?.setActive(shown && !document.hidden);
  }

  close() {
    this.card?.setActive(false);
    this.card?.destroy();
    this.card = null;
  }
}
