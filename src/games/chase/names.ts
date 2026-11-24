import { L } from '../../core/i18n';
import type { KindId } from './maze';
import type { Power } from './rules';

/** What each kind of maze is called on the start gate: name and blurb. */
export const KIND_NAMES: Record<KindId, () => [name: string, blurb: string]> = {
  classic: () => [
    L('Hedge maze', 'Labyrinthe'),
    L('The classic maze, with one side passage.', 'Le labyrinthe classique, avec un passage sur le côté.'),
  ],
  meadow: () => [
    L('Open meadow', 'Pré ouvert'),
    L('Loops everywhere: room to run, and to be cornered.', 'Des boucles partout : de quoi fuir, et être cerné.'),
  ],
  tunnels: () => [L('Tunnels', 'Tunnels'), L('Three side passages wrap around the maze.', 'Trois passages sur les côtés font le tour.')],
  night: () => [
    L('Night maze', 'Labyrinthe de nuit'),
    L('You only see near the mouse; berries light it up.', 'Vous ne voyez qu’autour de la souris; les baies éclairent.'),
  ],
  hawks: () => [
    L('Hawk hunt', 'Chasse aux faucons'),
    L('Hawks swoop fast down a straight corridor.', 'Les faucons foncent dans les couloirs droits.'),
  ],
  ghosts: () => [
    L('Ghost owls', 'Hiboux fantômes'),
    L('A slow ghost owl drifts right through the hedges.', 'Un hibou fantôme lent traverse les haies.'),
  ],
};

/** What each streak milestone unlocked, for its banner. */
export const POWER_NAMES: Record<Power, () => string> = {
  dash: () => L('Dash!', 'Sprint!'),
  magnet: () => L('Seed magnet!', 'Aimant à graines!'),
  scare: () => L('Owls scared!', 'Hiboux effrayés!'),
  frenzy: () => L('Dash, magnet and scare!', 'Sprint, aimant et frousse!'),
};
