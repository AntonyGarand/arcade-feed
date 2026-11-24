import { L } from '../../core/i18n';
import type { KindId, Power } from './rules';

/** What each kind of level is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [L('Classic', 'Classique'), L('Dig the water down to the pipe.', 'Creusez un passage pour l’eau jusqu’au tuyau.')],
  zigzag: () => [L('Switchbacks', 'Lacets'), L('A longer way down, with an extra turn.', 'Un chemin plus long, avec un virage de plus.')],
  caverns: () => [
    L('Caverns', 'Cavernes'),
    L('Big air pockets that swallow stray water.', 'De grandes poches d’air qui avalent l’eau égarée.'),
  ],
  volcano: () => [L('Volcano', 'Volcan'), L('Lava pools: water hardens them into rock.', 'Des mares de lave : l’eau les durcit en roche.')],
  moles: () => [
    L('Mole run', 'Taupes'),
    L('Moles go for the gems: dig at them to scare them.', 'Des taupes visent les gemmes : creusez dessus.'),
  ],
  bedrock: () => [
    L('Bedrock', 'Socle rocheux'),
    L('Thick rock layers with narrow gaps.', 'D’épaisses couches de roche aux passages étroits.'),
  ],
};

/** What each flow-combo milestone unlocks, shown under its banner. */
export const POWER_NAMES: Record<Power, () => string> = {
  purify: () => L('Purified: hazards harmless!', 'Purifié : dangers inoffensifs!'),
  double: () => L('Water points ×2!', 'Points d’eau ×2!'),
  magnet: () => L('Gem magnet!', 'Aimant à gemmes!'),
};
