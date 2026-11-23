export type CategoryId = 'match' | 'aim' | 'reflex' | 'move' | 'stack' | 'think';

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
    id: 'move',
    get name() {
      return L('Run & fly', 'Courir et voler');
    },
    get blurb() {
      return L('Jump, flap, cross and land.', 'Sautez, volez, traversez et posez-vous.');
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
  {
    id: 'think',
    get name() {
      return L('Think', 'Réflexion');
    },
    get blurb() {
      return L('Slide, sweep, push and remember.', 'Glissez, déminez, poussez et retenez.');
    },
  },
];
