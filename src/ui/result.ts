import { L, P } from '../core/i18n';
import type { Stars } from '../core/types';
import { fmtTime, h, s } from './dom';

export interface RunInfo {
  cleared: boolean;
  /** Game name and level label, shown under the title. */
  name: string;
  level: string;
  score: number;
  stars: Stars;
  ms: number;
  /** Best score at this level, this run included; undefined when it's the first. */
  best: number | undefined;
  /** This run beat the previous best. */
  newBest: boolean;
  firstClear: boolean;
  /** Score needed for two and three stars. */
  goals: readonly [number, number];
  /** Clears of this game so far, this one included. */
  clears: number;
  levelUp?: { up: boolean; to: string } | undefined;
  /** Auto-advance delay: shows a draining bar along the bottom of the panel. */
  advanceMs?: number | undefined;
}

const icon = (d: string) => s('svg', { viewBox: '0 0 24 24', class: 'win-check', 'aria-hidden': 'true' }, s('path', { d }));
const tile = (label: string, value: string) => h('div', { class: 'win-tile' }, h('span', null, label), h('strong', null, value));

/** Stars out of three; empty ones still show, so the goal is visible. */
export function starRow(n: Stars, cls = 'win-stars') {
  return h(
    'p',
    { class: cls, role: 'img', 'aria-label': `${P(n, ['star', 'stars'], ['étoile', 'étoiles'])} ${L('of 3', 'sur 3')}` },
    ...[1, 2, 3].map((i) => h('span', { class: i <= n ? 'on' : '', 'aria-hidden': 'true' }, '★')),
  );
}

/** The panel laid over a finished run: stars, score, best, time, level change. */
export function resultCard(w: RunInfo): HTMLElement {
  const tag = w.newBest
    ? h('span', { class: 'win-tag' }, L('New best', 'Nouveau record'))
    : w.firstClear
      ? h('span', { class: 'win-tag' }, L('First clear', 'Première fois'))
      : null;
  const next = w.cleared && w.stars < 3 ? w.goals[w.stars - 1] : undefined;
  return h(
    'div',
    {
      class: `win ${w.cleared ? '' : 'lost'}`.trim(),
      role: 'dialog',
      'aria-label': w.cleared ? L('Level cleared', 'Niveau réussi') : L('Game over', 'Partie terminée'),
    },
    h(
      'div',
      { class: 'win-card' },
      h('div', { class: 'win-badge' }, icon(w.cleared ? 'M5 12.5l4.5 4.5L19 7.5' : 'M7 7l10 10M17 7L7 17')),
      h('h3', { class: 'win-title' }, w.cleared ? L('Cleared!', 'Réussi!') : L('Game over', 'Partie terminée')),
      h('p', { class: 'win-sub' }, `${w.name} · ${w.level}`),
      w.cleared ? starRow(w.stars) : null,
      h(
        'div',
        { class: 'win-time' },
        h('div', { class: 'win-label' }, h('span', null, L('Score', 'Score')), tag),
        h('strong', { class: 'win-clock' }, String(w.score)),
        next != null ? h('div', { class: 'win-was' }, L(`${next} for the next star`, `${next} pour l’étoile suivante`)) : null,
      ),
      h(
        'div',
        { class: 'win-stats' },
        tile(L('Best', 'Record'), w.best == null ? '—' : String(w.best)),
        tile(L('Time', 'Temps'), fmtTime(w.ms)),
        tile(L('3 stars', '3 étoiles'), String(w.goals[1])),
        tile(L('Clears', 'Réussites'), String(w.clears)),
      ),
      w.levelUp
        ? h(
            'div',
            { class: `win-level ${w.levelUp.up ? 'up' : 'down'}` },
            `${w.levelUp.up ? L('Level up', 'Niveau supérieur') : L('Easing off', 'On ralentit')} → ${w.levelUp.to}`,
          )
        : null,
      w.advanceMs ? h('div', { class: 'win-advance', style: `animation-duration:${w.advanceMs}ms` }) : null,
      h('p', { class: 'win-hint' }, L('Tap to see the board', 'Touchez pour voir le jeu')),
    ),
  );
}
