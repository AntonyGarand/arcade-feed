/**
 * Level variety: games deal one of several kinds of level (a layout, a twist, an enemy mix) so two
 * cards of the same game rarely feel alike. Picks come from the level's rng, so "Again" deals the
 * same kind.
 */
import type { Rng } from './rng';
import type { Difficulty } from './types';

/** One kind of level a game can deal. */
export interface Kind {
  /** Stable English id (telemetry, tests). */
  id: string;
  /** Lowest level that can deal it (default 1). */
  min?: Difficulty;
  /** Highest level that can deal it (default 5). */
  max?: Difficulty;
  /** Relative odds among the kinds allowed at the level (default 1). */
  weight?: number;
}

/** The kinds allowed at level `d`. */
export const kindsAt = <K extends Kind>(d: Difficulty, kinds: readonly K[]): K[] =>
  kinds.filter((k) => d >= (k.min ?? 1) && d <= (k.max ?? 5));

/** Pick a kind for level `d` by weight among the allowed ones (the first kind if none is allowed). */
export function dealKind<K extends Kind>(rng: Rng, d: Difficulty, kinds: readonly K[]): K {
  const ok = kindsAt(d, kinds);
  if (!ok.length) return kinds[0];
  const total = ok.reduce((t, k) => t + (k.weight ?? 1), 0);
  let r = rng.next() * total;
  for (const k of ok) if ((r -= k.weight ?? 1) < 0) return k;
  return ok[ok.length - 1];
}
