import { L } from './i18n';
import type { PadButton, PadIcon } from './types';

/** One on-screen button (see `GameDef.pad`). */
export const btn = (key: string, icon: PadIcon, label: string, repeat?: boolean): PadButton =>
  repeat ? { key, icon, label, repeat } : { key, icon, label };

/** ◀ ▶ held to move or aim (ArrowLeft / ArrowRight). */
export const leftRight = (repeat?: boolean): PadButton[] => [
  btn('ArrowLeft', 'left', L('Left', 'Gauche'), repeat),
  btn('ArrowRight', 'right', L('Right', 'Droite'), repeat),
];

/** ▲ ▼ to aim up or down (ArrowUp / ArrowDown). */
export const aimUpDown = (): PadButton[] => [
  btn('ArrowUp', 'up', L('Aim up', 'Viser haut')),
  btn('ArrowDown', 'down', L('Aim down', 'Viser bas')),
];

/** − + for less or more power. */
export const power = (less: string, more: string): PadButton[] => [
  btn(less, 'minus', L('Less power', 'Moins fort')),
  btn(more, 'plus', L('More power', 'Plus fort')),
];
