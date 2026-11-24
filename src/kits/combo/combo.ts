/**
 * Combos and the events they unlock. A `Combo` counts hits in a row (with an optional time window),
 * fires `onTier` when the count crosses a milestone so the game can trigger something real (multiball,
 * frenzy, a bonus wave), and `comboPop` / `comboTier` give every game the same juice for it.
 *
 * The counting is pure (no rendering, no randomness): tests can drive it directly.
 */
import { L } from '../../core/i18n';
import type { Fx } from '../arena/fx';
import { haptic, sfx } from '../sound/sound';

/** Default milestones: the counts that fire `onTier` (tier 1 at 5 hits, tier 2 at 10…). */
const TIERS: readonly number[] = [5, 10, 15, 25, 40, 60];

export interface ComboOptions {
  /** Seconds a combo stays alive after a hit (0: it only ends on `break()`). */
  window?: number;
  /** Counts that fire `onTier`, ascending. Default `TIERS`. */
  tiers?: readonly number[];
  /** The combo just reached milestone `tier` (1-based) at `count` hits. */
  onTier?: (tier: number, count: number) => void;
  /** The combo ended (timed out or broken) after `count` hits (only fired for count ≥ 2). */
  onEnd?: (count: number) => void;
}

export class Combo {
  /** Hits in the current combo. */
  count = 0;
  /** Longest combo this run. */
  best = 0;
  /** Highest milestone reached by the current combo (0: none). */
  tier = 0;
  /** Seconds left before the combo times out (when there's a window). */
  left = 0;

  constructor(private readonly opts: ComboOptions = {}) {}

  private get tiers() {
    return this.opts.tiers ?? TIERS;
  }

  /** Fraction of the window left (1 right after a hit), for a draining meter. 1 without a window. */
  get heat(): number {
    const w = this.opts.window ?? 0;
    return w > 0 ? (this.count ? this.left / w : 0) : this.count ? 1 : 0;
  }

  /** Multiplier for points scored inside the combo: ×1, then +1 per milestone reached (×2, ×3…). */
  get mult(): number {
    return 1 + this.tier;
  }

  /** Add `n` hits. Returns the milestone just reached (1-based), or 0. */
  hit(n = 1): number {
    this.count += n;
    this.best = Math.max(this.best, this.count);
    this.left = this.opts.window ?? 0;
    let reached = 0;
    const tiers = this.tiers;
    while (this.tier < tiers.length && this.count >= tiers[this.tier]) reached = ++this.tier;
    if (reached) this.opts.onTier?.(reached, this.count);
    return reached;
  }

  /** Run down the window; ends the combo when it runs out. */
  update(dt: number) {
    if (!this.count || !(this.opts.window ?? 0)) return;
    this.left -= dt;
    if (this.left <= 0) this.break();
  }

  /** End the combo now (a miss, a hit taken). */
  break() {
    const n = this.count;
    this.count = this.tier = 0;
    this.left = 0;
    if (n >= 2) this.opts.onEnd?.(n);
  }
}

/** The hype word for a milestone: "Nice!", "Great!"… */
function tierWord(tier: number): string {
  const words = [
    L('Nice!', 'Beau!'),
    L('Great!', 'Super!'),
    L('Awesome!', 'Génial!'),
    L('Unstoppable!', 'Inarrêtable!'),
    L('Legendary!', 'Légendaire!'),
    L('Godlike!', 'Divin!'),
  ];
  return words[Math.max(0, Math.min(words.length - 1, tier - 1))];
}

/** One combo step: a "×N" pop at (x, y) and a combo note a step higher each time. From ×2 up. */
export function comboPop(fx: Fx, x: number, y: number, count: number, color: string) {
  if (count < 2) return;
  fx.text(x, y - 8, `×${count}`, color, Math.min(22, 11 + count * 0.8), 0.7);
  sfx('combo', { step: count - 1 });
}

/**
 * A milestone reached: a banner across the field (the hype word, or `title`), with `sub` under it
 * (what it unlocked: "Multiball!", "Points ×2"), a flash, a shake and a fanfare.
 */
export function comboTier(fx: Fx, tier: number, color: string, sub = '', title = tierWord(tier)) {
  fx.banner(title, color, sub, 1.3 + Math.min(0.6, tier * 0.1));
  fx.flash(color, 0.12 + Math.min(0.18, tier * 0.04), 0.35);
  fx.shake(2 + tier, 0.25);
  sfx('power', { pitch: Math.min(7, (tier - 1) * 2) });
  if (tier >= 2) haptic(30 + tier * 10);
}
