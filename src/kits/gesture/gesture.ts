/** Directions on a grid: up, right, down, left (clockwise from up). */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

/** The arrow or WASD key's direction, or -1 for any other key. */
export function keyDir(key: string): Dir | -1 {
  switch (key.toLowerCase()) {
    case 'arrowup':
    case 'w':
      return 0;
    case 'arrowright':
    case 'd':
      return 1;
    case 'arrowdown':
    case 's':
      return 2;
    case 'arrowleft':
    case 'a':
      return 3;
    default:
      return -1;
  }
}

/** The main direction of a motion. */
const dirOf = (dx: number, dy: number): Dir => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);

export interface Point {
  x: number;
  y: number;
}

export interface GestureOptions {
  /** Pointer position (client coordinates) → world units, usually `arena.toWorld`. */
  toWorld: (e: PointerEvent) => Point;
  /** World distance a press must travel to stop being a tap (and to count as a swipe). */
  slop: number;
  /** Fire `onSwipe` again each time the pointer travels `slop` more (snake turns); otherwise once per press. */
  repeat?: boolean;
  onDown?: (p: Point) => void;
  /** Pointer moved while pressed (`from` is where the press started), or a mouse hovered over the canvas. */
  onMove?: (p: Point, from: Point | null) => void;
  /** The press travelled `slop` in direction `dir` (from the press, or from the last swipe with `repeat`). */
  onSwipe?: (dir: Dir, from: Point, p: Point) => void;
  /** Released without travelling `slop`. */
  onTap?: (p: Point) => void;
  /** Released after a drag; `speed` is the release velocity in world units per second. */
  onRelease?: (p: Point, from: Point, speed: Point) => void;
}

/**
 * Pointer gestures on a canvas: press, drag, swipe, tap, release, in world units. The pointer is
 * captured, so a drag that leaves the field keeps steering (and never scrolls the feed: the arena sets
 * `touch-action: none`). Returns a function that removes the listeners.
 */
export function gestures(el: HTMLElement, o: GestureOptions): () => void {
  let id = -1;
  let start: Point | null = null;
  let origin: Point | null = null;
  let moved = false;
  let swiped = false;
  // Last two samples, for the release speed.
  let prev = { x: 0, y: 0, t: 0 };
  let last = { x: 0, y: 0, t: 0 };

  const down = (e: PointerEvent) => {
    if (id !== -1) return;
    id = e.pointerId;
    el.setPointerCapture?.(e.pointerId);
    const p = o.toWorld(e);
    start = p;
    origin = p;
    moved = false;
    swiped = false;
    prev = last = { ...p, t: e.timeStamp };
    o.onDown?.(p);
  };
  const move = (e: PointerEvent) => {
    const p = o.toWorld(e);
    if (e.pointerId !== id || !start || !origin) {
      if (id === -1 && e.pointerType === 'mouse') o.onMove?.(p, null);
      return;
    }
    if (e.timeStamp - last.t > 8) {
      prev = last;
      last = { ...p, t: e.timeStamp };
    }
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    if (!moved && Math.hypot(p.x - start.x, p.y - start.y) >= o.slop) moved = true;
    o.onMove?.(p, start);
    if (o.onSwipe && (o.repeat || !swiped) && Math.max(Math.abs(dx), Math.abs(dy)) >= o.slop) {
      swiped = true;
      o.onSwipe(dirOf(dx, dy), origin, p);
      origin = p;
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id || !start) return;
    id = -1;
    const p = o.toWorld(e);
    const from = start;
    start = origin = null;
    if (e.type === 'pointercancel') return;
    if (!moved) o.onTap?.(p);
    else {
      const ms = Math.max(16, e.timeStamp - prev.t);
      o.onRelease?.(p, from, { x: ((p.x - prev.x) * 1000) / ms, y: ((p.y - prev.y) * 1000) / ms });
    }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
