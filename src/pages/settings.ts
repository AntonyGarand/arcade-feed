import { getProfile, prefs, resetAllToAuto, setWeight, update, type Style, type Theme } from '../core/store';
import { LEVELS, LEVEL_NAMES, type GameDef } from '../core/types';
import { h, segmented } from '../ui/dom';
import { L, LOCALES, P, locale, setLocale, type Locale } from '../core/i18n';
import { analyticsEnabled, setAnalyticsEnabled } from '../core/analytics';

/** One setting: its name and an optional hint on the left, the control on the right (below on phones). */
const setting = (name: string, hint: string | null, control: HTMLElement) =>
  h(
    'div',
    { class: 'setting' },
    h('div', null, h('div', { class: 'setting-name' }, name), hint ? h('div', { class: 'muted small' }, hint) : null),
    control,
  );

/** A titled group of settings in its own panel. */
const group = (title: string, ...kids: (HTMLElement | null)[]) =>
  h('section', { class: 'panel settings-group' }, h('h2', null, title), ...kids);

/**
 * The style picker: one card per style with a little "Aa" sample drawn in that style's corners, border,
 * shadow and font (in the current light / dark colours). A radio group, like `segmented`.
 */
function stylePicker(current: Style, onpick: (v: Style) => void) {
  const options: { value: Style; label: string; hint: string }[] = [
    { value: 'neo', label: L('Neo', 'Néo'), hint: L('Bold and colourful', 'Franc et coloré') },
    { value: 'minimal', label: L('Minimal', 'Minimal'), hint: L('Quiet and clean', 'Sobre et épuré') },
    { value: 'soft', label: L('Soft', 'Doux'), hint: L('Round and pastel', 'Arrondi et pastel') },
    { value: 'newsprint', label: L('Newsprint', 'Journal'), hint: L('The paper’s games page', 'La page des jeux du journal') },
  ];
  const el = h('div', { class: 'style-picker', role: 'radiogroup', 'aria-label': L('Theme', 'Thème') });
  const draw = (cur: Style) =>
    el.replaceChildren(
      ...options.map((o) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(o.value === cur),
            class: `style-opt ${o.value === cur ? 'on' : ''}`.trim(),
            'data-v': o.value,
            onclick: () => {
              onpick(o.value);
              draw(o.value);
            },
          },
          h('span', { class: 'style-sample', 'aria-hidden': 'true' }, 'Aa'),
          h('span', { class: 'style-name' }, o.label),
          h('span', { class: 'style-hint' }, o.hint),
        ),
      ),
    );
  draw(current);
  return el;
}

const onOff = (on: boolean, pick: (on: boolean) => void, label: string) =>
  segmented(
    [
      { label: L('On', 'Oui'), value: 1 },
      { label: L('Off', 'Non'), value: 0 },
    ],
    on ? 1 : 0,
    (v) => pick(v === 1),
    { 'aria-label': label },
  );

export function renderSettings(el: HTMLElement, defs: GameDef[]) {
  const p = getProfile();
  const off = defs.filter((d) => prefs(d.id).weight === 0).length;
  const fixed = defs.filter((d) => prefs(d.id).manual).length;
  el.replaceChildren(
    h(
      'div',
      { class: 'page settings' },
      h('h1', null, L('Settings', 'Réglages')),
      group(
        L('Look', 'Apparence'),
        h(
          'div',
          { class: 'setting stacked' },
          h('div', null, h('div', { class: 'setting-name' }, L('Theme', 'Thème'))),
          stylePicker(p.style ?? 'neo', (v) => update({ style: v })),
        ),
        setting(
          L('Light or dark', 'Clair ou sombre'),
          L('Black is dark with pure-black surfaces.', 'Noir : le mode sombre avec des fonds noirs purs.'),
          segmented<Theme>(
            [
              { label: L('System', 'Système'), value: 'system' },
              { label: L('Light', 'Clair'), value: 'light' },
              { label: L('Dark', 'Sombre'), value: 'dark' },
              { label: L('Black', 'Noir'), value: 'oled' },
            ],
            p.theme,
            (v) => update({ theme: v }),
            { 'aria-label': L('Light or dark', 'Clair ou sombre') },
          ),
        ),
        setting(
          L('Language', 'Langue'),
          L('Interface and game texts.', 'Interface et textes des jeux.'),
          segmented<Locale>(
            LOCALES.map((l) => ({ label: l.name, value: l.id })),
            locale(),
            (v) => setLocale(v),
            { 'aria-label': L('Language', 'Langue') },
          ),
        ),
      ),
      group(
        L('Play', 'Jeu'),
        setting(
          L('Auto-advance', 'Avance automatique'),
          L('Scroll to the next game after a clear.', 'Passer au jeu suivant après une réussite.'),
          onOff(p.autoAdvance, (on) => update({ autoAdvance: on }), L('Auto-advance', 'Avance automatique')),
        ),
        setting(
          L('Starting level', 'Niveau de départ'),
          L('For games you have not played yet.', 'Pour les jeux pas encore joués.'),
          segmented(
            LEVELS.map((l) => ({ label: LEVEL_NAMES[l], value: l })),
            p.startLevel,
            (v) => update({ startLevel: v }),
            { class: 'seg wrap', 'aria-label': L('Starting level', 'Niveau de départ') },
          ),
        ),
      ),
      group(
        L('Games', 'Jeux'),
        h(
          'p',
          { class: 'muted small group-note' },
          L(
            'How often each game shows up in the feed, and its level, are set on its tile in ',
            'La fréquence de chaque jeu dans le fil et son niveau se règlent sur sa tuile dans l’onglet ',
          ),
          h('a', { href: '/games' }, L('Games', 'Jeux')),
          L(
            '. Auto raises the level after clears with two or three stars, and eases off after losses. Picking a level yourself locks it.',
            '. Le mode Auto monte le niveau après des réussites à deux ou trois étoiles, et le baisse après des échecs. Choisir un niveau vous-même le fixe.',
          ),
        ),
        h(
          'div',
          { class: 'row settings-games' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: !off,
              onclick: () => {
                defs.forEach((d) => prefs(d.id).weight === 0 && setWeight(d.id, 2));
                renderSettings(el, defs);
              },
            },
            off
              ? `${L('Turn on', 'Réactiver')} ${P(off, ['hidden game', 'hidden games'], ['jeu masqué', 'jeux masqués'])}`
              : L('Every game is on', 'Tous les jeux sont actifs'),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: !fixed,
              onclick: () => {
                resetAllToAuto();
                renderSettings(el, defs);
              },
            },
            fixed
              ? `${L('Set', 'Remettre')} ${P(fixed, ['fixed level', 'fixed levels'], ['niveau fixe', 'niveaux fixes'])} ${L('to Auto', 'en Auto')}`
              : L('Every level is Auto', 'Tous les niveaux sont en Auto'),
          ),
        ),
      ),
      group(
        L('Privacy', 'Confidentialité'),
        setting(
          L('Anonymous stats', 'Statistiques anonymes'),
          L(
            'Shares play stats (game, level, score, time, result) and page visits to help tune the games. Your name never leaves this device.',
            'Partage des statistiques de jeu (jeu, niveau, score, temps, résultat) et les pages visitées pour ajuster les jeux. Votre nom ne quitte jamais cet appareil.',
          ),
          onOff(analyticsEnabled(), setAnalyticsEnabled, L('Anonymous stats', 'Statistiques anonymes')),
        ),
      ),
      h('p', { class: 'muted small app-version' }, `arcade feed · ${__APP_VERSION__}`),
    ),
  );
}
