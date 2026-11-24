import { L } from '../../core/i18n';
import type { KindId, Power } from './rules';

/** What each kind of level is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [L('Classic', 'Classique'), L('Watch the pads, then repeat them.', 'Regardez les pastilles, puis répétez-les.')],
  rush: () => [L('Rush', 'Accéléré'), L('Each playback is quicker than the last.', 'Chaque lecture va plus vite que la précédente.')],
  wide: () => [L('Big ring', 'Grand anneau'), L('Two more pads on the ring.', 'Deux pastilles de plus sur l’anneau.')],
  reverse: () => [
    L('Backwards', 'À rebours'),
    L('Tap the sequence back from last to first.', 'Touchez la suite de la dernière à la première.'),
  ],
  swap: () => [L('Shuffle', 'Brassage'), L('Pads trade places after each round.', 'Les pastilles changent de place à chaque ronde.')],
  tricks: () => [
    L('Tricksters', 'Leurres'),
    L('Grey decoy flashes sneak into the playback.', 'Des leurres gris se glissent dans la lecture.'),
  ],
};

/** What each combo milestone unlocks, shown under its banner. */
export const POWER_NAMES: Record<Power, () => string> = {
  shield: () => L('Shield: one slip forgiven', 'Bouclier : une erreur pardonnée'),
  double: () => L('Points ×2!', 'Points ×2!'),
  hint: () => L('Hints on!', 'Indices activés!'),
  slow: () => L('Slow replay!', 'Lecture lente!'),
  heart: () => L('Bonus heart!', 'Cœur en prime!'),
};
