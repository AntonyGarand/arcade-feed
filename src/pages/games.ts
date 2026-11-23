import { helpButton } from '../ui/help';
import { L, P } from '../core/i18n';
import { CATEGORIES, type CategoryId } from '../core/categories';
import { prefs, setLevel, setWeight, stats } from '../core/store';
import { LEVELS, LEVEL_NAMES, type GameDef } from '../core/types';
import { cogIcon, h, s, segmented } from '../ui/dom';
import { openSheet } from '../ui/sheet';
import { starRow } from '../ui/result';
import { weightChoices } from '../app/card/settings-sheet';
import { categoryIcon, gameArt } from '../app/art';

let filter: CategoryId | 'all' = 'all';

const playIcon = () =>
  s('svg', { viewBox: '0 0 24 24', class: 'play-icon', 'aria-hidden': 'true' }, s('path', { d: 'M8 5.5v13l10.5-6.5z' }));

/**
 * Games tab: every game grouped by category. Each tile plays a level of that game; its cog holds the
 * game's level and how often it shows up in the feed.
 */
export function renderGames(el: HTMLElement, defs: GameDef[]) {
  const rerender = () => renderGames(el, defs);

  /** Level and feed frequency, behind the tile's cog. */
  const openTileSettings = (d: GameDef) => {
    const levelBox = h('div', { class: 'level-box' });
    const drawLevel = () => {
      const p = prefs(d.id);
      levelBox.replaceChildren(
        segmented<(typeof LEVELS)[number] | 0>(
          [{ label: 'Auto', value: 0 }, ...LEVELS.map((l) => ({ label: LEVEL_NAMES[l], value: l }))],
          p.manual ? p.level : 0,
          (v) => {
            setLevel(d.id, v === 0 ? 'auto' : v);
            drawLevel();
          },
          { class: 'seg wrap', 'aria-label': L('Difficulty', 'Difficulté') },
        ),
      );
    };
    drawLevel();
    openSheet({
      title: d.name,
      puzzle: d.id,
      className: 'game-settings',
      body: [
        h('p', { class: 'sheet-lede' }, d.rules),
        h(
          'section',
          { class: 'field' },
          h('h3', null, L('Difficulty', 'Difficulté')),
          levelBox,
          h(
            'p',
            { class: 'muted small' },
            L(
              'Auto raises the level after clears with two or three stars, and eases off after losses.',
              'Auto monte le niveau après des réussites à deux ou trois étoiles, et le baisse après des échecs.',
            ),
          ),
        ),
        h(
          'section',
          { class: 'field' },
          h('h3', null, L('In the feed', 'Dans le fil')),
          segmented(weightChoices(), prefs(d.id).weight, (v) => setWeight(d.id, v), { 'aria-label': L('In the feed', 'Dans le fil') }),
        ),
      ],
      onClose: () => {
        if (/^\/games\/?$/.test(location.pathname)) rerender();
      },
    });
  };

  /**
   * One tile per game: art on top (level badge, "?" and cog over it), then name, rules, stars and best.
   * The name's link is stretched over the whole tile; the buttons sit above it.
   */
  const tile = (d: GameDef) => {
    const st = stats(d.id);
    const pr = prefs(d.id);
    const best = st.best[pr.level];
    const off = pr.weight === 0;
    return h(
      'article',
      { class: `lab-tile ${off ? 'off' : ''}`.trim(), 'data-puzzle': d.id },
      h(
        'div',
        { class: 'tile-art' },
        gameArt(d),
        h('span', { class: 'tile-level' }, LEVEL_NAMES[pr.level], pr.manual ? null : h('small', null, 'auto')),
        h(
          'span',
          { class: 'tile-tools' },
          helpButton(d, { quiet: true }),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn cog-btn',
              title: L('Options', 'Options'),
              'aria-label': `${d.name} — ${L('options', 'options')}`,
              onclick: () => openTileSettings(d),
            },
            cogIcon(),
          ),
        ),
        h('span', { class: 'tile-go', 'aria-hidden': 'true' }, playIcon()),
      ),
      h(
        'div',
        { class: 'tile-main' },
        h('h2', null, h('a', { class: 'tile-link', href: `/game/${d.id}`, 'aria-label': `${L('Play', 'Jouer')} ${d.name}` }, d.name)),
        h('p', { class: 'rules' }, d.rules),
        h(
          'div',
          { class: 'lab-meta' },
          starRow(st.stars[pr.level] ?? 0, 'lvl-stars'),
          best != null ? h('span', { class: 'tile-best' }, h('small', null, L('best', 'record')), String(best)) : null,
          off ? h('span', { class: 'tile-off' }, L('Not in feed', 'Hors du fil')) : null,
        ),
      ),
    );
  };

  const cats = CATEGORIES.map((c) => ({ ...c, games: defs.filter((d) => d.category === c.id) })).filter((c) => c.games.length);
  const shown = filter === 'all' ? cats : cats.filter((c) => c.id === filter);
  const chip = (id: CategoryId | 'all', label: string, n: number) =>
    h(
      'button',
      {
        type: 'button',
        class: `chip-filter ${filter === id ? 'on' : ''}`.trim(),
        'aria-pressed': String(filter === id),
        onclick: () => {
          filter = id;
          rerender();
        },
      },
      categoryIcon(id),
      label,
      h('span', { class: 'chip-n' }, n),
    );
  const starsWon = defs.reduce((n, d) => n + (stats(d.id).stars[prefs(d.id).level] ?? 0), 0);

  el.replaceChildren(
    h(
      'div',
      { class: 'page wide games' },
      h(
        'div',
        { class: 'page-head' },
        h('h1', null, L('Games', 'Jeux')),
        h(
          'p',
          { class: 'head-stat', title: L('Stars at the current level of each game', 'Étoiles au niveau actuel de chaque jeu') },
          h('span', { class: 'head-star', 'aria-hidden': 'true' }, '★'),
          h('strong', null, starsWon),
          h('span', { class: 'muted' }, ` / ${defs.length * 3}`),
        ),
      ),
      h(
        'p',
        { class: 'muted lede' },
        L(
          `${P(defs.length, ['game', 'games'], ['jeu', 'jeux'])}. Tap one to play a level. The cog sets its level and how often it shows up in the Feed tab.`,
          `${P(defs.length, ['game', 'games'], ['jeu', 'jeux'])}. Touchez un jeu pour jouer un niveau. La roue dentée règle son niveau et sa fréquence dans l’onglet Fil.`,
        ),
      ),
      cats.length > 1
        ? h(
            'div',
            { class: 'games-bar' },
            h(
              'div',
              { class: 'filters', role: 'toolbar', 'aria-label': L('Categories', 'Catégories') },
              chip('all', L('All', 'Tous'), defs.length),
              ...cats.map((c) => chip(c.id, c.name, c.games.length)),
            ),
          )
        : null,
      ...shown.map((c) =>
        h(
          'section',
          { class: 'cat', id: `cat-${c.id}` },
          h('h3', null, categoryIcon(c.id), c.name, h('span', { class: 'cat-blurb' }, c.blurb)),
          h('div', { class: 'lab-grid' }, ...c.games.map(tile)),
        ),
      ),
    ),
  );
}
