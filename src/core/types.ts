import type { CategoryId } from './categories';
import { L } from './i18n';
import type { Rng } from './rng';

export type Difficulty = 1 | 2 | 3 | 4 | 5;
export const LEVELS: Difficulty[] = [1, 2, 3, 4, 5];
export const LEVEL_NAMES: Record<Difficulty, string> = {
  get 1() {
    return L('Easy', 'Facile');
  },
  get 2() {
    return L('Medium', 'Moyen');
  },
  get 3() {
    return L('Hard', 'Difficile');
  },
  get 4() {
    return L('Expert', 'Expert');
  },
  get 5() {
    return L('Master', 'Maître');
  },
};
/** Stable English level ids for telemetry (LEVEL_NAMES is localized). */
export const LEVEL_IDS: Record<Difficulty, string> = { 1: 'easy', 2: 'medium', 3: 'hard', 4: 'expert', 5: 'master' };

/** Stars earned by a run: 0 for a loss, 1 to 3 for a clear (from the score, see `GameDef.stars`). */
export type Stars = 0 | 1 | 2 | 3;

/**
 * How-to-play content shown behind the card's "?" button. Write it with L(en, fr).
 * @public
 */
export interface Help {
  /** One or two sentences: what you're trying to achieve. */
  goal: string;
  /** Numbered steps: how to play and the controls (tap, drag, keys). */
  steps: string[];
  /** Optional strategy hints. */
  tips?: string[];
}

/** Icon of an on-screen button. Arrows, turns and ± show only the icon; the rest also show their label. */
export type PadIcon =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'ccw'
  | 'cw'
  | 'minus'
  | 'plus'
  | 'fire'
  | 'launch'
  | 'drop'
  | 'swap'
  | 'jump'
  | 'duck'
  | 'flap'
  | 'thrust'
  | 'undo'
  | 'restart'
  | 'flow';

/**
 * One on-screen button under the field. It sends `key` to the game's `onKey` like the keyboard
 * would: keydown on press, keyup on release, so hold-to-move just works.
 */
export interface PadButton {
  /** `KeyboardEvent.key` the game already handles (`'ArrowLeft'`, `' '`, `'x'`…). */
  key: string;
  icon: PadIcon;
  /** Short name (localised, ≤ 10 characters): the visible label, or the tooltip for icon-only buttons. */
  label: string;
  /** While held, repeat the keydown (with `repeat: true`), like a held key. */
  repeat?: boolean;
}

/**
 * On-screen controls shown under the field, next to the touch controls on the field itself: a group
 * for each thumb. `'dpad'` is the four arrows in an inverted T.
 */
export interface Pad {
  left?: PadButton[] | 'dpad';
  right?: PadButton[];
}

/**
 * The kind of level a game dealt: its layout, twist or enemy mix (picked from `ctx.rng`, so "Again"
 * deals the same one). Shown on the start gate so each card feels different.
 */
export interface Variant {
  /** Stable English id for telemetry (`'windy'`, `'boss'`). */
  id: string;
  /** Short name (localised, ≤ 18 characters): "Windy", "Boss wave". */
  name: string;
  /** One short line (localised, ≤ 60 characters): what's different this time. */
  blurb?: string;
}

/** What a game gets from its card. @public */
export interface GameCtx {
  difficulty: Difficulty;
  /** Every random choice of the level comes from here (the same seed plays the same level). */
  rng: Rng;
  /** Game content goes here. */
  root: HTMLElement;
  /** The current score, shown in the card header. Call it whenever it changes. */
  score: (n: number) => void;
  /**
   * Lives left, shown as hearts in the card header. Call it on every change for games with lives;
   * never call it otherwise.
   */
  lives: (left: number, max: number) => void;
  /** Short status line shown in the card footer (goal progress, moves or time left…). */
  status: (text: string) => void;
  /** Name the kind of level dealt (call once from `create`, before the gate shows). Optional. */
  variant: (v: Variant) => void;
  /** The level is cleared. Call once; stars come from the last score. */
  win: () => void;
  /** The run is over without a clear (out of lives, moves or time). Call once. */
  lose: () => void;
}

export interface GameInstance {
  /**
   * One animation frame while the run is live: started, its card on screen, not paused. `dt` is in
   * seconds, capped at 1/20 s so a hiccup never teleports anything. Turn-based games can leave it out
   * and use it only for animations.
   */
  frame?: (dt: number) => void;
  /** Redraw everything: after a resize, a theme change, or once before the run starts. */
  draw?: () => void;
  /** Keyboard input while this card is live (both keydown and keyup: check `e.type`). Return true if handled. */
  onKey?: (e: KeyboardEvent) => boolean;
  destroy?: () => void;
}

export interface GameDef {
  id: string;
  name: string;
  /** One short line shown under the title. */
  rules: string;
  category: CategoryId;
  /** Tutorial (localised via L()). */
  help?: () => Help;
  /** Starts switched off in the mixed feed (the player can turn it on); still playable from its own page. */
  offByDefault?: boolean;
  /**
   * Score needed for two and three stars at a level. Any clear earns at least one star. Tune them so
   * three stars takes a clean, fast run.
   */
  stars: (d: Difficulty) => readonly [two: number, three: number];
  /** A typical run's length in seconds at a level (shown on the start screen). */
  par: (d: Difficulty) => number;
  /**
   * On-screen buttons under the field (localised via L()). Leave it out for games played by tapping
   * the pieces themselves.
   */
  pad?: () => Pad;
  create(ctx: GameCtx): GameInstance | void;
}

/** Pick per-difficulty value from a 5-tuple. */
export const byLevel = <T>(d: Difficulty, values: readonly [T, T, T, T, T]): T => values[d - 1];

/** Stars for a run that ended with `score`: 0 for a loss, else 1 to 3 against the level's thresholds. */
export function starsFor(def: Pick<GameDef, 'stars'>, d: Difficulty, cleared: boolean, score: number): Stars {
  if (!cleared) return 0;
  const [two, three] = def.stars(d);
  return score >= three ? 3 : score >= two ? 2 : 1;
}
