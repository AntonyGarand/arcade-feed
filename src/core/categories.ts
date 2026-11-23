export type CategoryId = 'match' | 'aim' | 'reflex' | 'stack';

import { L } from './i18n';

export interface Category {
  id: CategoryId;
  readonly name: string;
  readonly blurb: string;
}

/** Display order of categories on the Games tab and in Settings. */
export const CATEGORIES: Category[] = [
  {
    id: 'match',
    get name() {
      return L('Match', 'Associer');
    },
    get blurb() {
      return L('Swap, link and pop colours.', 'Échangez, reliez et éclatez les couleurs.');
    },
  },
  {
    id: 'aim',
    get name() {
      return L('Aim & bounce', 'Viser et rebondir');
    },
    get blurb() {
      return L('Angles, shots and ricochets.', 'Angles, tirs et ricochets.');
    },
  },
  {
    id: 'reflex',
    get name() {
      return L('Reflex', 'Réflexes');
    },
    get blurb() {
      return L('Dodge, tap and time it right.', 'Esquivez, touchez et visez le bon moment.');
    },
  },
  {
    id: 'stack',
    get name() {
      return L('Stack & drop', 'Empiler et lâcher');
    },
    get blurb() {
      return L('Fit, merge and build up.', 'Placez, fusionnez et montez.');
    },
  },
];
