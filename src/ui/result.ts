import { L, P } from '../core/i18n';
import { LEVEL_NAMES, type Difficulty, type Stars } from '../core/types';
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

const icon = (d: string, cls = 'win-check') => s('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true' }, s('path', { d }));
const tile = (label: string, value: string, cls = '') =>
  h('div', { class: `win-tile ${cls}`.trim() }, h('span', null, label), h('strong', null, value));

/** Stars out of three; empty ones still show, so the goal is visible. */
export function starRow(n: Stars, cls = 'win-stars') {
  return h(
    'p',
    { class: cls, role: 'img', 'aria-label': `${P(n, ['star', 'stars'], ['étoile', 'étoiles'])} ${L('of 3', 'sur 3')}` },
    ...[1, 2, 3].map((i) => h('span', { class: i <= n ? 'on' : '', 'aria-hidden': 'true' }, '★')),
  );
}

/** Level pill: five pips filled up to the level, its name, and "auto" when auto-levelling picks it. */
export function levelTag(level: Difficulty, auto = false) {
  return h(
    'span',
    { class: 'lvl-tag', 'data-level': level },
    h('span', { class: 'lvl-pips', 'aria-hidden': 'true' }, ...[1, 2, 3, 4, 5].map((i) => h('i', { class: i <= level ? 'on' : '' }))),
    LEVEL_NAMES[level],
    auto ? h('small', null, 'auto') : null,
  );
}

/**
 * The score against the star goals: a bar that fills up to the score, with ticks at the ★★ and ★★★
 * thresholds (and the best score, when it's another one).
 */
function goalBar(w: RunInfo) {
  const [two, three] = w.goals;
  const top = Math.max(three * 1.12, w.score, w.best ?? 0) || 1;
  const pct = (v: number) => `${Math.min(100, (100 * v) / top).toFixed(1)}%`;
  const mark = (v: number, label: string, cls: string) =>
    h('span', { class: `win-mark ${cls} ${w.score >= v ? 'hit' : ''}`.trim(), style: `left:${pct(v)}` }, h('b', null, label));
  return h(
    'div',
    { class: 'win-bar', 'aria-hidden': 'true' },
    h('span', { class: 'win-fill', style: `--to:${pct(w.score)}` }),
    w.best != null && w.best > w.score ? h('span', { class: 'win-best', style: `left:${pct(w.best)}`, title: L('Best', 'Record') }) : null,
    mark(two, '★★', 'two'),
    mark(three, '★★★', 'three'),
  );
}

/** The panel laid over a finished run: stars, score against the goals and the best, time, level change. */
export function resultCard(w: RunInfo): HTMLElement {
  const tag = w.newBest
    ? h('span', { class: 'win-tag' }, L('New best!', 'Nouveau record!'))
    : w.firstClear
      ? h('span', { class: 'win-tag' }, L('First clear', 'Première fois'))
      : null;
  const next = w.cleared && w.stars < 3 ? w.goals[w.stars - 1] : undefined;
  const title = w.cleared ? (w.stars === 3 ? L('Perfect!', 'Parfait!') : L('Cleared!', 'Réussi!')) : L('Game over', 'Partie terminée');
  return h(
    'div',
    {
      class: `win ${w.cleared ? '' : 'lost'} ${w.stars === 3 ? 'perfect' : ''}`.trim().replace(/\s+/g, ' '),
      role: 'dialog',
      'aria-label': w.cleared ? L('Level cleared', 'Niveau réussi') : L('Game over', 'Partie terminée'),
    },
    h(
      'div',
      { class: 'win-card' },
      h('div', { class: 'win-badge' }, icon(w.cleared ? 'M5 12.5l4.5 4.5L19 7.5' : 'M7 7l10 10M17 7L7 17')),
      h('h3', { class: 'win-title' }, title),
      h('p', { class: 'win-sub' }, `${w.name} · ${w.level}`),
      w.cleared ? starRow(w.stars) : null,
      h(
        'div',
        { class: 'win-time' },
        h('div', { class: 'win-label' }, h('span', null, L('Score', 'Score')), tag),
        h('strong', { class: 'win-clock' }, String(w.score)),
        goalBar(w),
        next != null
          ? h('div', { class: 'win-was' }, L(`${next - w.score} more for the next star`, `encore ${next - w.score} pour l’étoile suivante`))
          : null,
      ),
      h(
        'div',
        { class: 'win-stats' },
        tile(L('Best', 'Record'), w.best == null ? '—' : String(w.best), w.newBest ? 'new' : ''),
        tile(L('Time', 'Temps'), fmtTime(w.ms)),
        tile(L('Clears', 'Réussites'), String(w.clears)),
      ),
      w.levelUp
        ? h(
            'div',
            { class: `win-level ${w.levelUp.up ? 'up' : 'down'}` },
            icon(w.levelUp.up ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6', 'win-level-icon'),
            h('span', null, w.levelUp.up ? L('Level up!', 'Niveau supérieur!') : L('Easing off', 'On ralentit')),
            h('strong', null, w.levelUp.to),
          )
        : null,
      w.advanceMs ? h('div', { class: 'win-advance', style: `animation-duration:${w.advanceMs}ms` }) : null,
      h('p', { class: 'win-hint' }, L('Tap to see the board', 'Touchez pour voir le jeu')),
    ),
  );
}
