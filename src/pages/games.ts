import { helpButton } from '../ui/help';
import { L, P } from '../core/i18n';
import { CATEGORIES, type CategoryId } from '../core/categories';
import { prefs, setLevel, setWeight, stats } from '../core/store';
import { LEVELS, LEVEL_NAMES, type GameDef } from '../core/types';
import { cogIcon, h, segmented } from '../ui/dom';
import { openSheet } from '../ui/sheet';
import { starRow } from '../ui/result';
import { weightChoices } from '../app/card/settings-sheet';

let filter: CategoryId | 'all' = 'all';

/**
 * Games tab: every game grouped by category. Each row plays a level of that game; its cog holds the
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
        h('p', { class: 'muted small' }, d.rules),
        h('h3', null, L('Difficulty', 'Difficulté')),
        levelBox,
        h('h3', null, L('In the feed', 'Dans le fil')),
        segmented(weightChoices(), prefs(d.id).weight, (v) => setWeight(d.id, v)),
      ],
      onClose: () => {
        if (/^\/games\/?$/.test(location.pathname)) rerender();
      },
    });
  };

  /** One row per game: art, name, rules and stats. The whole row plays it; "?" and the cog sit above the link. */
  const tile = (d: GameDef) => {
    const st = stats(d.id);
    const pr = prefs(d.id);
    const best = st.best[pr.level];
    const chips = [
      `${pr.manual ? '' : 'Auto · '}${LEVEL_NAMES[pr.level]}`,
      st.cleared ? L(`${st.cleared} cleared`, `${st.cleared} réussis`) : null,
      best != null ? `${L('best', 'record')} ${best}` : null,
    ];
    return h(
      'article',
      { class: `lab-tile ${pr.weight === 0 ? 'off' : ''}`, 'data-puzzle': d.id },
      h('div', { class: 'tile-art', 'aria-hidden': 'true' }, d.name.slice(0, 1)),
      h(
        'div',
        { class: 'tile-main' },
        h(
          'header',
          null,
          h('h2', null, h('a', { class: 'tile-link', href: `/game/${d.id}`, 'aria-label': `${L('Play', 'Jouer')} ${d.name}` }, d.name)),
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
        h('p', { class: 'rules' }, d.rules),
        h(
          'p',
          { class: 'lab-meta' },
          starRow(st.stars[pr.level] ?? 0, 'lvl-stars'),
          ...chips.filter((c): c is string => !!c).map((c) => h('span', null, c)),
        ),
      ),
      h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '▶'),
    );
  };

  const cats = CATEGORIES.map((c) => ({ ...c, games: defs.filter((d) => d.category === c.id) })).filter((c) => c.games.length);
  const shown = filter === 'all' ? cats : cats.filter((c) => c.id === filter);
  const chip = (id: CategoryId | 'all', label: string, n: number) =>
    h(
      'button',
      {
        type: 'button',
        class: `chip-filter ${filter === id ? 'on' : ''}`,
        'aria-pressed': String(filter === id),
        onclick: () => {
          filter = id;
          rerender();
        },
      },
      label,
      h('span', null, n),
    );

  el.replaceChildren(
    h(
      'div',
      { class: 'page wide games' },
      h('h1', null, L('Games', 'Jeux')),
      h(
        'p',
        { class: 'muted' },
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
          h('h3', null, c.name, h('span', { class: 'cat-blurb' }, c.blurb)),
          h('div', { class: 'lab-grid' }, ...c.games.map(tile)),
        ),
      ),
    ),
  );
}
