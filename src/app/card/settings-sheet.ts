import { L } from '../../core/i18n';
import { prefs, setLevel, setWeight, type Weight } from '../../core/store';
import { LEVELS, LEVEL_NAMES, type Difficulty, type GameDef } from '../../core/types';
import { btn, h, segmented } from '../../ui/dom';
import { openSheet } from '../../ui/sheet';

export const weightChoices = (): { label: string; value: Weight }[] => [
  { label: L('Off', 'Jamais'), value: 0 },
  { label: L('Less', 'Moins'), value: 1 },
  { label: L('Normal', 'Normal'), value: 2 },
  { label: L('More', 'Plus'), value: 3 },
];

/**
 * The card's cog: difficulty (a level, or Auto), how often the game shows up in the feed, and a way out
 * of the current run (Skip in the feed, a new level on the Games tab).
 */
export function openGameSettings(o: {
  def: GameDef;
  level: Difficulty;
  /** The Games tab: the level picker only changes this card, never the feed's level. */
  lab: boolean;
  done: boolean;
  /** Pauses the run; returns the function that resumes it. */
  pause: () => () => void;
  pickLevel: (d: Difficulty) => void;
  skip: () => void;
}) {
  const resume = o.pause();
  let picked: Difficulty | null = null;
  let skipped = false;
  const auto = !o.lab && !prefs(o.def.id).manual;
  const close = openSheet({
    title: o.def.name,
    puzzle: o.def.id,
    className: 'game-settings',
    body: [
      h('p', { class: 'sheet-lede' }, o.def.rules),
      h(
        'section',
        { class: 'field' },
        h('h3', null, L('Difficulty', 'Difficulté')),
        segmented<Difficulty | 0>(
          [...(o.lab ? [] : [{ label: 'Auto', value: 0 as const }]), ...LEVELS.map((l) => ({ label: LEVEL_NAMES[l], value: l }))],
          auto ? 0 : o.level,
          (v) => {
            if (v === 0) setLevel(o.def.id, 'auto');
            else picked = v;
            close();
          },
          { class: 'seg wrap', 'data-setting': 'level', 'aria-label': L('Difficulty', 'Difficulté') },
        ),
        h(
          'p',
          { class: 'muted small' },
          o.lab
            ? L(
                'Picking a level deals a new one here; the feed keeps its own level.',
                'Choisir un niveau en lance un nouveau ici; le fil garde son propre niveau.',
              )
            : L(
                'Auto raises the level after clears with two or three stars, and eases off after losses.',
                'Auto monte le niveau après des réussites à deux ou trois étoiles, et le baisse après des échecs.',
              ),
        ),
      ),
      h(
        'section',
        { class: 'field' },
        h('h3', null, L('In the feed', 'Dans le fil')),
        segmented(weightChoices(), prefs(o.def.id).weight, (v) => setWeight(o.def.id, v), {
          'aria-label': L('In the feed', 'Dans le fil'),
        }),
      ),
    ],
    footer: [
      o.done
        ? null
        : btn(
            o.lab ? L('Give up', 'Abandonner') : L('Skip', 'Passer'),
            () => {
              skipped = true;
              close();
            },
            'ghost',
          ),
      btn(L('Done', 'OK'), () => close(), 'primary'),
    ],
    onClose: () => {
      if (picked) o.pickLevel(picked);
      else if (skipped) o.skip();
      else resume();
    },
  });
}
