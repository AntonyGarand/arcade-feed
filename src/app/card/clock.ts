/** Length of one run: runs while the game is live, pauses otherwise. */
export class Clock {
  private elapsed = 0;
  /** `now()` when the clock last started, or null while paused. */
  private since: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  get running() {
    return this.since !== null;
  }

  reset() {
    this.elapsed = 0;
    this.since = null;
  }

  start() {
    this.since ??= this.now();
  }

  stop() {
    if (this.since !== null) this.elapsed += this.now() - this.since;
    this.since = null;
  }

  /** Milliseconds played so far. */
  time() {
    return this.elapsed + (this.since !== null ? this.now() - this.since : 0);
  }
}
