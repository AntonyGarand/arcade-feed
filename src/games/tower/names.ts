import { L } from '../../core/i18n';
import type { KindId, Power } from './rules';

/** What each kind of level is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [L('Classic', 'Classique'), L('Steady slides, a few golden blocks.', 'Des glissades régulières, quelques blocs dorés.')],
  windy: () => [
    L('Windy', 'Venteux'),
    L('Gusts speed the block up one way, slow it the other.', 'Les rafales accélèrent ou freinent le bloc.'),
  ],
  crane: () => [
    L('Crane', 'Grue'),
    L('The block swings on a cable: fastest in the middle.', 'Le bloc se balance au câble : plus vite au milieu.'),
  ],
  shrink: () => [
    L('Melting blocks', 'Blocs fondants'),
    L('Each block shrinks while it slides: drop it fast.', 'Chaque bloc rapetisse en glissant : lâchez-le vite.'),
  ],
  ice: () => [
    L('Ice blocks', 'Blocs de glace'),
    L('Icy blocks skid on a little: drop them early.', 'Les blocs glacés dérapent un peu : lâchez-les plus tôt.'),
  ],
  heavy: () => [
    L('Heavy load', 'Charge lourde'),
    L('Dark steel blocks slide faster but count double.', 'Les blocs d’acier glissent plus vite mais comptent double.'),
  ],
};

/** What each streak milestone unlocks, shown under its banner. */
export const POWER_NAMES: Record<Power, () => string> = {
  wide: () => L('Block rebuilt wider!', 'Bloc rélargi!'),
  slow: () => L('Slow crane!', 'Grue au ralenti!'),
  magnet: () => L('Magnet: easy perfects!', 'Aimant : parfaits faciles!'),
};
