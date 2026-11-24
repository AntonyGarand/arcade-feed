import { L } from '../../core/i18n';
import type { Pad, PadButton, PadIcon } from '../../core/types';
import { h, s } from '../../ui/dom';

/** Stroked 24×24 icon paths (currentColor). */
const ICONS: Record<PadIcon, string[]> = {
  left: ['M15 5l-7 7 7 7'],
  right: ['M9 5l7 7-7 7'],
  up: ['M5 15l7-7 7 7'],
  down: ['M5 9l7 7 7-7'],
  ccw: ['M5 12a7 7 0 1 0 2.1-5', 'M5 4v4.5h4.5'],
  cw: ['M19 12a7 7 0 1 1-2.1-5', 'M19 4v4.5h-4.5'],
  minus: ['M5 12h14'],
  plus: ['M5 12h14', 'M12 5v14'],
  fire: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5'],
  launch: ['M12 20V5', 'M6 11l6-6 6 6'],
  drop: ['M12 4v15', 'M6 13l6 6 6-6', 'M5 21h14'],
  swap: ['M5 8h13', 'M15 5l3 3-3 3', 'M19 16H6', 'M9 13l-3 3 3 3'],
  jump: ['M6 14l6-6 6 6', 'M6 20l6-6 6 6'],
  duck: ['M6 4l6 6 6-6', 'M6 10l6 6 6-6', 'M5 20h14'],
  flap: ['M3 13c3-5 6-6 9-3c3-3 6-2 9 3', 'M12 10v9'],
  thrust: ['M12 3l5 9h-10z', 'M9.5 16l2.5 5 2.5-5'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  restart: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v4.5h4.5'],
  flow: ['M3 12c3-4 6-4 9 0s6 4 9 0', 'M3 17c3-4 6-4 9 0s6 4 9 0'],
};

/** Icons that speak for themselves: the button shows no text (the label is its name and tooltip). */
const ICON_ONLY = new Set<PadIcon>(['left', 'right', 'up', 'down', 'ccw', 'cw', 'minus', 'plus']);

const icon = (name: PadIcon) =>
  s('svg', { viewBox: '0 0 24 24', class: 'pad-icon', 'aria-hidden': 'true' }, ...ICONS[name].map((d) => s('path', { d })));

const dpad = (): PadButton[] => [
  { key: 'ArrowUp', icon: 'up', label: L('Up', 'Haut') },
  { key: 'ArrowLeft', icon: 'left', label: L('Left', 'Gauche') },
  { key: 'ArrowDown', icon: 'down', label: L('Down', 'Bas') },
  { key: 'ArrowRight', icon: 'right', label: L('Right', 'Droite') },
];

/** Delay before a held `repeat` button starts repeating, then the time between repeats (like a keyboard). */
const REPEAT_DELAY = 260;
const REPEAT_EVERY = 70;

export interface PadHandlers {
  /** A button went down (`repeat` for auto-repeat while held) or up. */
  key: (e: KeyboardEvent) => void;
}

/**
 * The on-screen controls under the field: buttons that send the game the keys its keyboard controls
 * already use. Each button follows its own pointer, so several can be held at once (steer and fire).
 */
export class PadView {
  readonly el: HTMLElement;
  /** Release every held button (a new level, the run ended). */
  readonly releaseAll: () => void;

  constructor(pad: Pad, on: PadHandlers) {
    const releases: (() => void)[] = [];
    const make = (b: PadButton) => {
      const only = ICON_ONLY.has(b.icon);
      const el = h(
        'button',
        {
          type: 'button',
          class: `pad-btn${only ? ' icon-only' : ''}`,
          'data-key': b.key,
          title: b.label,
          'aria-label': b.label,
          // Buttons never take focus: Space / Enter must keep driving the game, not re-click a button.
          tabindex: '-1',
        },
        icon(b.icon),
        only ? null : h('span', null, b.label),
      );
      let id = -1;
      let timer = 0;
      const send = (type: 'keydown' | 'keyup', repeat = false) => on.key(new KeyboardEvent(type, { key: b.key, repeat }));
      const release = () => {
        if (id === -1) return;
        id = -1;
        clearTimeout(timer);
        el.classList.remove('held');
        send('keyup');
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (id !== -1) return;
        id = e.pointerId;
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('held');
        send('keydown');
        if (b.repeat) {
          const again = () => {
            send('keydown', true);
            timer = window.setTimeout(again, REPEAT_EVERY);
          };
          timer = window.setTimeout(again, REPEAT_DELAY);
        }
      });
      const up = (e: PointerEvent) => e.pointerId === id && release();
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      releases.push(release);
      return el;
    };
    const group = (side: 'left' | 'right', list: PadButton[] | 'dpad' | undefined) => {
      if (!list) return h('div', { class: `pad-group ${side}` });
      if (list === 'dpad') return h('div', { class: `pad-group ${side} dpad` }, ...dpad().map(make));
      return h('div', { class: `pad-group ${side}` }, ...list.map(make));
    };
    this.el = h(
      'div',
      { class: 'pad', role: 'group', 'aria-label': L('Game controls', 'Commandes du jeu') },
      group('left', pad.left),
      group('right', pad.right),
    );
    this.releaseAll = () => releases.forEach((r) => r());
  }
}
