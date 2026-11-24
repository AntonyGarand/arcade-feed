import { L } from '../../core/i18n';
import type { KindId, Power } from './rules';

/** What each kind of level is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [L('Classic', 'Classique'), L('Lay a long pipe before the flow starts.', 'Posez un long tuyau avant que le flot parte.')],
  reservoir: () => [
    L('Reservoirs', 'Réservoirs'),
    L('Fixed tanks: slow to fill, count as two pipes.', 'Des réservoirs fixes : lents, ils comptent pour deux.'),
  ],
  maze: () => [
    L('Maze', 'Labyrinthe'),
    L('Walls cut the board, with a little more time.', 'Des murs coupent la grille, avec un peu plus de temps.'),
  ],
  flood: () => [L('Flash flood', 'Crue subite'), L('A long countdown, then a fast flow.', 'Un long décompte, puis un flot rapide.')],
  oneway: () => [
    L('One-way', 'Sens unique'),
    L('Fixed pipes with arrows: one way through only.', 'Des tuyaux fixes fléchés : un seul sens permis.'),
  ],
};

/** What each chain-combo milestone unlocks, shown under its banner. */
export const POWER_NAMES: Record<Power, () => string> = {
  freeze: () => L('Flow frozen!', 'Flot gelé!'),
  perfect: () => L('Perfect piece!', 'Pièce parfaite!'),
  double: () => L('Flow points ×2!', 'Points du flot ×2!'),
};
