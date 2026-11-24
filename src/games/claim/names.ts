import { L } from '../../core/i18n';
import type { KindId, Power } from './rules';

/** What each kind of field is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  open: () => [L('Open field', 'Champ libre'), L('A wide field and its usual hunters.', 'Un grand terrain et ses chasseurs habituels.')],
  rocks: () => [
    L('Rocky field', 'Champ rocheux'),
    L('Rocks in the field: close your lines on them.', 'Des rochers dans le terrain : fermez vos lignes dessus.'),
  ],
  swarm: () => [
    L('Swarm', 'Essaim'),
    L('Lots of slow sparks: trap them in pockets.', 'Plein d’étincelles lentes : enfermez-les en poches.'),
  ],
  minefield: () => [
    L('Minefield', 'Champ de mines'),
    L('Mines in the open: draw around them.', 'Des mines dans le terrain : tracez autour.'),
  ],
  hunt: () => [L('The hunt', 'La traque'), L('A seeker spark chases your line.', 'Une étincelle chercheuse traque votre ligne.')],
  comet: () => [L('Comets', 'Comètes'), L('Fewer sparks, but very fast ones.', 'Moins d’étincelles, mais très rapides.')],
};

export const POWER_NAMES: Record<Power, () => string> = {
  freeze: () => L('Sparks frozen!', 'Étincelles gelées!'),
  shield: () => L('Shield!', 'Bouclier!'),
  double: () => L('Points ×2!', 'Points ×2!'),
  storm: () => L('Freeze + shield!', 'Gel + bouclier!'),
};
