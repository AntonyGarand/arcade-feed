import { L } from '../../core/i18n';
import type { KindId, Power } from './rules';

/** What each kind of level is called on the start gate. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  toss: () => [L('Classic toss', 'Lancer classique'), L('Fruit tossed up from below.', 'Des fruits lancés d’en bas.')],
  rain: () => [
    L('Fruit rain', 'Pluie de fruits'),
    L('Fruit falls from the sky: slice it on the way down.', 'Les fruits tombent du ciel : tranchez-les au vol.'),
  ],
  festival: () => [
    L('Festival', 'Festival'),
    L('Extra gold and frost fruit, fewer bombs.', 'Plus de fruits dorés et givrés, moins de bombes.'),
  ],
  volley: () => [
    L('Volleys', 'Salves'),
    L('Big bunches thrown at once: one stroke, many fruit.', 'De grosses grappes d’un coup : un trait, plusieurs fruits.'),
  ],
  bombs: () => [
    L('Bomb squad', 'Escouade de bombes'),
    L('Bombs in nearly every wave: watch your blade.', 'Des bombes à presque chaque vague : attention à la lame.'),
  ],
  sides: () => [
    L('Crossfire', 'Tirs croisés'),
    L('Fruit flies in from the sides of the field.', 'Les fruits arrivent par les côtés du terrain.'),
  ],
};

/** What each streak milestone unlocks, shown under its banner. */
export const POWER_NAMES: Record<Power, () => string> = {
  slow: () => L('Slow motion!', 'Ralenti!'),
  frenzy: () => L('Fruit frenzy!', 'Frénésie de fruits!'),
  shield: () => L('Bomb shield!', 'Bouclier anti-bombe!'),
  double: () => L('Points ×2!', 'Points ×2!'),
};
