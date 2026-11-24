import { L } from '../../core/i18n';
import type { KindId, Power } from './rules';

/** What each kind of jar is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [
    L('Classic jar', 'Bocal classique'),
    L('Just fruit, and a rare rainbow wildcard.', 'Que des fruits, et un rare joker arc-en-ciel.'),
  ],
  narrow: () => [L('Narrow jar', 'Bocal étroit'), L('A slim jar: stack with care.', 'Un bocal mince : empilez avec soin.')],
  rocks: () => [
    L('Rockfall', 'Éboulis'),
    L('Rocks never merge: merge next to them to crumble them.', 'Les roches restent : fusionnez à côté pour les casser.'),
  ],
  bombs: () => [
    L('Bombs away', 'Bombardement'),
    L('Bombs clear the small fruit and rocks where they land.', 'Les bombes effacent les petits fruits et roches proches.'),
  ],
  rising: () => [
    L('Rising floor', 'Plancher montant'),
    L('The floor creeps up; big merges push it down.', 'Le plancher monte; les grosses fusions le font redescendre.'),
  ],
  rainbow: () => [
    L('Rainbow', 'Arc-en-ciel'),
    L('Lots of wildcards that merge with any fruit.', 'Plein de jokers qui fusionnent avec n’importe quel fruit.'),
  ],
};

/** What each chain milestone unlocks, shown under its banner. */
export const POWER_NAMES: Record<Power, () => string> = {
  wild: () => L('Wildcard next!', 'Joker au prochain!'),
  tidy: () => L('Tidy up: small fruit pop!', 'Ménage : les petits éclatent!'),
  grow: () => L('Small fruit grow!', 'Les petits grossissent!'),
};
