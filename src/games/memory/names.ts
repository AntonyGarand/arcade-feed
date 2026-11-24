import { L } from '../../core/i18n';
import type { KindId, Power } from './rules';

/** What each kind of level is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [
    L('Classic', 'Classique'),
    L('A square grid; golden tiles give extra time.', 'Une grille carrée; les cases dorées donnent du temps.'),
  ],
  shapes: () => [L('Odd grid', 'Grille bizarre'), L('A bigger grid with its corners cut off.', 'Une grille plus grande aux coins coupés.')],
  shift: () => [
    L('Sliding grid', 'Grille glissante'),
    L('The board slides one step: tap where the tiles went.', 'La grille glisse d’un cran : touchez les cases déplacées.'),
  ],
  decoys: () => [
    L('Decoys', 'Leurres'),
    L('Red crossed tiles flash too: don’t tap them!', 'Des cases rouges barrées s’allument aussi : évitez-les!'),
  ],
  flicker: () => [L('Flicker', 'Scintillement'), L('The tiles light up one at a time.', 'Les cases s’allument une à la fois.')],
  quick: () => [L('Quick look', 'Coup d’œil'), L('The tiles show for a shorter moment.', 'Les cases s’allument moins longtemps.')],
};

/** What each streak milestone unlocks, shown under its banner. */
export const POWER_NAMES: Record<Power, () => string> = {
  time: () => L('Extra time!', 'Temps en prime!'),
  look: () => L('Longer look next round!', 'Plus long coup d’œil!'),
  heart: () => L('Heart back!', 'Un cœur de retour!'),
};
