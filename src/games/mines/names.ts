import { L } from '../../core/i18n';
import type { KindId, Power } from './rules';

/** What each kind of board is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [L('Classic', 'Classique'), L('A full field, an hourglass and a gem.', 'Un champ complet, un sablier et un joyau.')],
  donut: () => [L('Donut', 'Beigne'), L('A hole in the middle: work around it.', 'Un trou au milieu : contournez-le.')],
  cross: () => [
    L('Cross', 'Croix'),
    L('The corners are cut away: a plus-shaped field.', 'Les coins sont coupés : un champ en forme de plus.'),
  ],
  scatter: () => [L('Potholes', 'Nids-de-poule'), L('Holes scattered across the field.', 'Des trous éparpillés dans le champ.')],
  treasure: () => [
    L('Treasure hunt', 'Chasse au trésor'),
    L('Less time, but hourglasses and gems to find.', 'Moins de temps, mais des sabliers et des joyaux.'),
  ],
  sprint: () => [
    L('Sprint', 'Sprint'),
    L('Half the clock: every cell opened adds time.', 'Moitié du temps : chaque case ouverte en ajoute.'),
  ],
};

/** What each streak milestone unlocks, shown under its banner. */
export const POWER_NAMES: Record<Power, () => string> = {
  freeze: () => L('Clock frozen!', 'Chrono gelé!'),
  scout: () => L('Scout: safe cells opened!', 'Éclaireur : cases sûres!'),
  time: () => L('Extra time!', 'Temps en prime!'),
};
