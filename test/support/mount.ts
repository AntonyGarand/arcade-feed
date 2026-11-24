import { Rng } from '../../src/core/rng';
import type { Difficulty, GameDef, GameInstance, Variant } from '../../src/core/types';

export interface Mounted {
  def: GameDef;
  root: HTMLElement;
  inst: GameInstance;
  /** Last values the game reported through its ctx. */
  score: number;
  lives: [left: number, max: number] | null;
  status: string;
  /** The kind of level the game said it dealt, if any. */
  variant: Variant | null;
  /** '' while the run is going. */
  outcome: '' | 'win' | 'lose';
  /** Run `frame()` for `seconds` of game time in 1/60 s steps, stopping when the run ends. */
  run: (seconds: number) => void;
}

/** Mount a game the way the card does, recording what it reports. */
export function mountGame(def: GameDef, difficulty: Difficulty, seed = 1): Mounted {
  const root = document.createElement('div');
  document.body.append(root);
  const m: Mounted = {
    def,
    root,
    inst: {},
    score: 0,
    lives: null,
    status: '',
    variant: null,
    outcome: '',
    run(seconds) {
      for (let t = 0; t < seconds && !m.outcome; t += 1 / 60) m.inst.frame?.(1 / 60);
    },
  };
  m.inst =
    def.create({
      difficulty,
      rng: new Rng(seed),
      root,
      score: (n) => (m.score = n),
      lives: (left, max) => (m.lives = [left, max]),
      status: (t) => (m.status = t),
      variant: (v) => (m.variant = v),
      win: () => (m.outcome ||= 'win'),
      lose: () => (m.outcome ||= 'lose'),
    }) || {};
  m.inst.draw?.();
  return m;
}
