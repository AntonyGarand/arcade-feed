/** Longest step handed to a game: after a hiccup (a slow frame, a GC pause) things slow down instead of jumping. */
const MAX_DT = 1 / 20;

/**
 * requestAnimationFrame loop for the live card. Calls `step(dt)` with the seconds since the last frame,
 * capped at `MAX_DT`. Only one card runs at a time, and only while its run is live.
 */
export class FrameLoop {
  private raf = 0;
  private last = 0;

  constructor(private readonly step: (dt: number) => void) {}

  get running() {
    return this.raf !== 0;
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(MAX_DT, Math.max(0, (t - this.last) / 1000));
      this.last = t;
      this.raf = requestAnimationFrame(tick);
      this.step(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
