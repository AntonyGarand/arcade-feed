import { L } from '../core/i18n';
import { openSheet } from './sheet';
import type { GameDef } from '../core/types';
import { btn, h } from './dom';

const SEEN_KEY = 'arcade-feed:help-seen';

function seenSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}
const helpSeen = (id: string) => seenSet().has(id);
function markSeen(id: string) {
  const s = seenSet();
  s.add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/** Show the how-to-play sheet: goal, steps and tips. */
function openHelp(def: GameDef, onClose?: () => void) {
  markSeen(def.id);
  const help = def.help?.();
  let close = () => {};
  close = openSheet({
    title: def.name,
    puzzle: def.id,
    className: 'help',
    body: [
      h('div', { class: 'help-goal' }, h('span', { class: 'help-goal-tag' }, L('Goal', 'Objectif')), h('p', null, help?.goal ?? def.rules)),
      help?.steps.length
        ? h(
            'section',
            null,
            h('h3', null, L('How to play', 'Comment jouer')),
            h('ol', { class: 'help-steps' }, ...help.steps.map((s) => h('li', null, s))),
          )
        : null,
      help?.tips?.length
        ? h(
            'section',
            null,
            h('h3', null, L('Tips', 'Astuces')),
            h('ul', { class: 'help-tips' }, ...help.tips.map((s) => h('li', null, s))),
          )
        : null,
      h(
        'p',
        { class: 'help-levels muted small' },
        L(
          'Five levels, Easy to Master. On Auto, the level rises when you clear with two or three stars.',
          'Cinq niveaux, de Facile à Maître. En mode Auto, le niveau monte quand vous réussissez avec deux ou trois étoiles.',
        ),
      ),
    ],
    footer: [btn(L('Got it', 'Compris'), () => close(), 'primary')],
    onClose: () => onClose?.(),
  });
}

/**
 * The round "?" icon button on cards and game tiles. Unseen games get a highlighted, pulsing button
 * unless `quiet` (long lists, where every row pulsing would be noise).
 */
export function helpButton(def: GameDef, opts: { onOpen?: () => void; onClose?: () => void; quiet?: boolean } = {}) {
  const b = h(
    'button',
    {
      type: 'button',
      class: `icon-btn help-btn ${opts.quiet || helpSeen(def.id) ? '' : 'fresh'}`,
      title: L('How to play', 'Comment jouer'),
      'aria-label': `${L('How to play', 'Comment jouer')}: ${def.name}`,
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        opts.onOpen?.();
        openHelp(def, () => {
          b.classList.remove('fresh');
          opts.onClose?.();
        });
      },
    },
    '?',
  );
  return b;
}
