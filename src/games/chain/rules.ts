import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units. */
export const W = 300;
export const H = 420;
/** Marble radius; touching marbles sit D apart along the track. */
export const R = 11;
export const D = 2 * R;
/** The shooter turns in place here; the track spirals in around it. */
export const SHOOTER = { x: 150, y: 222 };
/** Where a fired marble leaves the shooter. */
const MUZZLE = 14;
/** Outer and inner radius of the spiral (before its vertical stretch and wobble). */
const R_OUT = 132;
const R_IN = 55;
/** Track samples every STEP world units of arc length. */
const STEP = 2;
/** Shot speed and the centre distance under which it hits a marble (world units). */
const SPEED = 640;
const HIT = 2 * R - 3;
/** Keyboard aim speed (radians per second). */
const AIM_SPEED = 2.6;
/** Speed of the roll-in, and of a front part sliding back to close a gap (world units per second). */
const INTRO_SPEED = 260;
const RETRACT = 240;
/** Two marbles this close (centre to centre, along the track) touch. */
const TOUCH = D + 0.5;
export const POP_POINTS = 10;
/** Bonus for a clear: all of it if the head never got past the intro mark, none if it reached the hole. */
export const SAFE_BONUS = 600;

/** Colour of a stone: it never matches, and crumbles when a run next to it pops. */
export const STONE = -1;
const STONE_POINTS = 10;
/** Marbles a bomb blows up on each side when it pops. */
const BLAST = 2;
/** A bomb shot blows up this many marbles on each side of where it lands. */
const BOMB_SHOT = 3;
/** Gold coins: radius, points, and the slow-down they give when a shot flies through. */
export const COIN_R = 8;
export const COIN_POINTS = 50;
const COIN_SLOW = 4;
/** Streak milestones (pops in a row without a dud shot) and what each unlocks. */
export const STREAK_TIERS = [3, 6, 10, 15, 21] as const;
const REWARDS = ['slow', 'bomb', 'back', 'wild', 'bomb'] as const;
export type Power = (typeof REWARDS)[number];
/** Slow-mo: seconds, and the chain's speed while it runs. */
export const SLOW_S = 6;
const SLOW_K = 0.35;
/** Push-back: seconds, and how fast the chain rolls back. */
export const BACK_S = 1.6;
const BACK_SPEED = 70;
/** Surging chains: period (seconds) and swing of their speed around the usual. */
const SURGE_T = 8;
const SURGE_K = 0.8;

/** The kinds of level: a plain chain, stones in it, bombs in it, a surging push, coins to shoot. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'powder' },
  { id: 'gold' },
  { id: 'stones', min: 2 },
  { id: 'surge', min: 2 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

export const countFor = (d: Difficulty) => byLevel(d, [22, 30, 38, 46, 54]);
export const coloursFor = (d: Difficulty) => byLevel(d, [3, 4, 5, 5, 6]);
/** Steady push of the chain, world units per second. */
export const speedFor = (d: Difficulty) => byLevel(d, [8, 10, 12.5, 15, 17.5]);
/** Turns of the spiral: fewer is a shorter track. */
export const turnsFor = (d: Difficulty) => byLevel(d, [2.05, 1.9, 1.75, 1.6, 1.45]);
/** Share of the track the chain rolls in quickly before slowing down. */
const introFor = (d: Difficulty) => byLevel(d, [0.3, 0.29, 0.28, 0.27, 0.26]);

export interface Point {
  x: number;
  y: number;
}

export interface Track {
  /** x, y pairs every STEP units of arc length, from the mouth to the hole. */
  pts: number[];
  length: number;
}

export interface Marble {
  /** Colour (and glyph); `STONE` for a stone. */
  k: number;
  /** A bomb: blows up its neighbours when it pops. */
  bomb?: boolean;
  /** Distance along the track (negative: still inside the mouth). */
  p: number;
  id: number;
}

interface Shot {
  x: number;
  y: number;
  dx: number;
  dy: number;
  k: number;
  /** A combo reward fired with it. */
  power: 'bomb' | 'wild' | null;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  colours: number;
  track: Track;
  /** Ordered from the tail (pushed from the mouth) to the head (nearest the hole). */
  chain: Marble[];
  speed: number;
  /** While the head is short of this track distance, the chain rolls in quickly. */
  intro: number;
  shot: Shot | null;
  /** Colour loaded in the shooter, and the one after it. */
  cur: number;
  next: number;
  /** Aim angle (radians, 0 = right, −π/2 = up), and the keyboard turn held: −1, 0 or 1. */
  aim: number;
  turn: number;
  score: number;
  /** Pops in a row since the last shot landed (each multiplies the points). */
  combo: number;
  /** Pops in a row across shots; a shot that lands without popping ends it. */
  streak: number;
  /** Streak milestones reached (index into `STREAK_TIERS`). */
  tier: number;
  /** Seconds of slow-mo and push-back left. */
  slow: number;
  back: number;
  /** A combo reward loaded in the shooter: the next shot is a bomb or a wild marble. */
  power: 'bomb' | 'wild' | null;
  /** Gold coins floating between the loops (gold rush). */
  coins: Point[];
  /** Seconds since the start (surging chains). */
  t: number;
  popped: number;
  shots: number;
  /** Furthest the head got along the track. */
  reach: number;
  over: boolean;
  nextId: number;
  rng: Rng;
}

/** A seeded spiral from the outer mouth around the shooter to the hole near it, resampled evenly. */
function buildTrack(d: Difficulty, rng: Rng): Track {
  const turns = turnsFor(d) * Math.PI * 2;
  const dir = rng.chance(0.5) ? 1 : -1;
  const a0 = rng.next() * Math.PI * 2;
  const lobes = rng.int(2, 3);
  const amp = 3 + rng.next() * 5;
  const phase = rng.next() * Math.PI * 2;
  const ay = 1.24 + rng.next() * 0.08;
  const raw: number[] = [];
  const n = 2400;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const th = turns * f;
    const r = R_OUT - (R_OUT - R_IN) * f + amp * Math.sin(lobes * th + phase);
    const a = a0 + dir * th;
    raw.push(SHOOTER.x + Math.cos(a) * r, SHOOTER.y + Math.sin(a) * r * ay);
  }
  // Resample at even arc lengths.
  const pts = [raw[0], raw[1]];
  let want = STEP;
  let run = 0;
  for (let i = 2; i < raw.length; i += 2) {
    const x0 = raw[i - 2];
    const y0 = raw[i - 1];
    const seg = Math.hypot(raw[i] - x0, raw[i + 1] - y0);
    while (run + seg >= want) {
      const f = (want - run) / seg;
      pts.push(x0 + (raw[i] - x0) * f, y0 + (raw[i + 1] - y0) * f);
      want += STEP;
    }
    run += seg;
  }
  return { pts, length: (pts.length / 2 - 1) * STEP };
}

/** The point `p` along the track (clamped to its ends). */
export function pointAt(t: Track, p: number): Point {
  const last = t.pts.length / 2 - 1;
  const f = Math.max(0, Math.min(last, p / STEP));
  const i = Math.min(last - 1, Math.floor(f));
  const u = f - i;
  return {
    x: t.pts[i * 2] + (t.pts[i * 2 + 2] - t.pts[i * 2]) * u,
    y: t.pts[i * 2 + 1] + (t.pts[i * 2 + 3] - t.pts[i * 2 + 1]) * u,
  };
}

/** Unit direction of travel at `p`. */
function tangentAt(t: Track, p: number): Point {
  const a = pointAt(t, p - STEP);
  const b = pointAt(t, p + STEP);
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

/** Colours still in the chain, in order (stones aren't a colour). */
export function present(chain: readonly Marble[]): number[] {
  return [...new Set(chain.map((m) => m.k))].filter((k) => k >= 0).sort((a, b) => a - b);
}

/** Seeded spots for gold coins, in the gaps between the loops and clear of the shooter. */
function placeCoins(track: Track, n: number, rng: Rng): Point[] {
  const coins: Point[] = [];
  for (let tries = 0; tries < 400 && coins.length < n; tries++) {
    const x = rng.int(COIN_R + 4, W - COIN_R - 4);
    const y = rng.int(COIN_R + 4, H - COIN_R - 4);
    if (Math.hypot(x - SHOOTER.x, y - SHOOTER.y) < 40) continue;
    if (coins.some((c) => Math.hypot(c.x - x, c.y - y) < 50)) continue;
    let near = Infinity;
    for (let i = 0; i < track.pts.length; i += 2) near = Math.min(near, Math.hypot(track.pts[i] - x, track.pts[i + 1] - y));
    if (near < R + COIN_R + 2) continue;
    coins.push({ x, y });
  }
  return coins;
}

const pickColour = (s: State) => {
  const left = present(s.chain);
  return left.length ? s.rng.pick(left) : 0;
};

export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const colours = coloursFor(d);
  const track = buildTrack(d, rng);
  const n = countFor(d);
  const kinds: number[] = [];
  let prev = -1;
  while (kinds.length < n) {
    let k = rng.int(0, colours - 2);
    if (k >= prev && prev >= 0) k++;
    const run = rng.chance(0.2) ? 3 : rng.int(1, 2);
    for (let i = 0; i < run && kinds.length < n; i++) kinds.push(k);
    prev = k;
  }
  // The head starts at the mouth, the rest queued behind it.
  const chain: Marble[] = kinds.map((k, i) => ({ k, p: -(n - 1 - i) * D, id: i }));
  // Stones replace marbles here and there (never two side by side, never at the head).
  const stones = kind === 'stones' ? Math.round(n / 7) : 0;
  for (let placed = 0, tries = 0; placed < stones && tries < 200; tries++) {
    const i = rng.int(1, n - 3);
    if ([i - 1, i, i + 1].some((j) => chain[j].k === STONE)) continue;
    chain[i].k = STONE;
    placed++;
  }
  // Bombs: lots in a powder keg, a couple from level 3 in a classic chain.
  const bombs = kind === 'powder' ? Math.round(n / 6) : kind === 'classic' && d >= 3 ? 2 : 0;
  const plain = rng.shuffle(chain.filter((m) => m.k !== STONE));
  for (let i = 0; i < bombs && plain.length; i++) plain.pop()!.bomb = true;
  const s: State = {
    d,
    kind,
    colours,
    track,
    chain,
    speed: speedFor(d),
    intro: track.length * introFor(d),
    shot: null,
    cur: 0,
    next: 0,
    aim: -Math.PI / 2,
    turn: 0,
    score: 0,
    combo: 0,
    streak: 0,
    tier: 0,
    slow: 0,
    back: 0,
    power: null,
    coins: kind === 'gold' ? placeCoins(track, 5, rng) : [],
    t: 0,
    popped: 0,
    shots: 0,
    reach: 0,
    over: false,
    nextId: n,
    rng,
  };
  s.cur = pickColour(s);
  s.next = pickColour(s);
  return s;
}

const head = (s: State) => s.chain.at(-1)?.p ?? 0;
/** Share of the track the head has covered (0 at the mouth, 1 at the hole). */
export const progress = (s: State) => Math.max(0, Math.min(1, head(s) / s.track.length));
const touching = (a: Marble, b: Marble) => b.p - a.p <= TOUCH;
/** On screen (out of the mouth, not yet in the hole): only these can be hit. */
const visible = (s: State, m: Marble) => m.p >= 0 && m.p <= s.track.length;

/** Aim at a point (pointer). */
export function aimAt(s: State, x: number, y: number) {
  if (Math.hypot(x - SHOOTER.x, y - SHOOTER.y) > 4) s.aim = Math.atan2(y - SHOOTER.y, x - SHOOTER.x);
}

export interface Aim {
  /** Index of the marble the shot would hit, or −1 for a miss. */
  hit: number;
  /** Where the shot would be when it touches (or leaves the field). */
  x: number;
  y: number;
  /** It lands on the head side of the marble it hits. */
  after: boolean;
}

/** Which side of marble `j` a shot touching at (x, y) goes in. */
const sideOf = (s: State, j: number, x: number, y: number) => {
  const m = pointAt(s.track, s.chain[j].p);
  const t = tangentAt(s.track, s.chain[j].p);
  return (x - m.x) * t.x + (y - m.y) * t.y > 0;
};

/** Where a shot fired now at `aim` goes, with the chain where it is (ray against circles). */
export function trace(s: State, aim: number): Aim {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  let best = Infinity;
  let hit = -1;
  for (let j = 0; j < s.chain.length; j++) {
    if (!visible(s, s.chain[j])) continue;
    const m = pointAt(s.track, s.chain[j].p);
    const vx = m.x - SHOOTER.x;
    const vy = m.y - SHOOTER.y;
    const proj = vx * dx + vy * dy;
    const perp = vx * vx + vy * vy - proj * proj;
    if (proj <= 0 || perp >= HIT * HIT) continue;
    const t = proj - Math.sqrt(HIT * HIT - perp);
    if (t < best) [best, hit] = [t, j];
  }
  if (hit < 0) {
    // To the edge of the field.
    const tx = dx > 0 ? (W - SHOOTER.x) / dx : dx < 0 ? -SHOOTER.x / dx : Infinity;
    const ty = dy > 0 ? (H - SHOOTER.y) / dy : dy < 0 ? -SHOOTER.y / dy : Infinity;
    best = Math.min(tx, ty);
  }
  const x = SHOOTER.x + dx * best;
  const y = SHOOTER.y + dy * best;
  return { hit, x, y, after: hit >= 0 && sideOf(s, hit, x, y) };
}

export function shoot(s: State): boolean {
  if (s.shot || s.over) return false;
  const dx = Math.cos(s.aim);
  const dy = Math.sin(s.aim);
  s.shot = { x: SHOOTER.x + dx * MUZZLE, y: SHOOTER.y + dy * MUZZLE, dx, dy, k: s.cur, power: s.power };
  s.power = null;
  s.cur = s.next;
  s.next = pickColour(s);
  s.shots++;
  return true;
}

/** Swap the loaded marble with the next one. */
export function swapNext(s: State) {
  if (!s.over) [s.cur, s.next] = [s.next, s.cur];
}

/** Push marbles forward so none overlaps the one behind it. */
function settle(chain: Marble[]) {
  for (let i = 1; i < chain.length; i++) if (chain[i].p < chain[i - 1].p + D) chain[i].p = chain[i - 1].p + D;
}

/** Put a marble of colour `k` next to marble `j` (on its head side if `after`). Returns its index. */
export function insert(s: State, j: number, after: boolean, k: number): number {
  const m = s.chain[j];
  const at = after ? j + 1 : j;
  s.chain.splice(at, 0, { k, p: after ? m.p + D : m.p, id: s.nextId++ });
  settle(s.chain);
  return at;
}

/** The run of touching same-colour marbles through index `i`, as [first, last]. */
export function groupAt(chain: readonly Marble[], i: number): [number, number] {
  const k = chain[i].k;
  let lo = i;
  let hi = i;
  if (k === STONE) return [lo, hi];
  while (lo > 0 && chain[lo - 1].k === k && touching(chain[lo - 1], chain[lo])) lo--;
  while (hi < chain.length - 1 && chain[hi + 1].k === k && touching(chain[hi], chain[hi + 1])) hi++;
  return [lo, hi];
}

export interface Pop {
  marbles: (Point & { k: number })[];
  combo: number;
  gain: number;
  /** Where bombs went off in it. */
  blasts: Point[];
}

export interface Events {
  /** A shot joined the chain: its marble's id and where it touched. */
  landed: { id: number; x: number; y: number; k: number } | null;
  /** A shot left the field, here. */
  missed: Point | null;
  pops: Pop[];
  /** Coins a shot flew through. */
  coins: Point[];
  /** A streak milestone reached (1-based) and what it unlocked; 0 for none. */
  tier: number;
  unlocked: Power | null;
  won: boolean;
  lost: boolean;
  /** The safety bonus added on a clear. */
  bonus: number;
}

/** Score marbles `lo..hi` out of the chain (and the bombs and stones they take along) as one pop. */
function remove(s: State, from: number, to: number, ev: Events, blasted: Point[] = []) {
  const c = s.chain;
  let lo = from;
  let hi = to;
  // Bombs in the range blow up their neighbours, which may be bombs too.
  const lit = new Set<number>();
  for (let grew = true; grew;) {
    grew = false;
    for (let i = lo; i <= hi; i++)
      if (c[i].bomb && !lit.has(i)) {
        lit.add(i);
        blasted.push(pointAt(s.track, c[i].p));
        lo = Math.max(0, Math.min(lo, i - BLAST));
        hi = Math.min(c.length - 1, Math.max(hi, i + BLAST));
        grew = true;
      }
  }
  // Stones right next to the pop crumble.
  if (lo > 0 && c[lo - 1].k === STONE && touching(c[lo - 1], c[lo])) lo--;
  if (hi < c.length - 1 && c[hi + 1].k === STONE && touching(c[hi], c[hi + 1])) hi++;
  const gone = c.splice(lo, hi - lo + 1);
  s.combo++;
  const gain = gone.reduce((t, m) => t + (m.k === STONE ? STONE_POINTS : POP_POINTS * s.combo), 0);
  s.score += gain;
  s.popped += gone.length;
  ev.pops.push({ marbles: gone.map((m) => ({ ...pointAt(s.track, m.p), k: m.k })), combo: s.combo, gain, blasts: blasted });
  s.streak++;
  if (s.tier < STREAK_TIERS.length && s.streak >= STREAK_TIERS[s.tier]) {
    const p = REWARDS[s.tier++];
    grant(s, p);
    ev.tier = s.tier;
    ev.unlocked = p;
  }
}

/** Pop the run through `i` if it holds 3 or more. */
function tryPop(s: State, i: number, ev: Events): boolean {
  const [lo, hi] = groupAt(s.chain, i);
  if (hi - lo < 2) return false;
  remove(s, lo, hi, ev);
  return true;
}

/** Turn a streak reward on: slow-mo, a push-back, or a bomb or wild marble in the shooter. */
export function grant(s: State, p: Power) {
  if (p === 'slow') s.slow = SLOW_S;
  else if (p === 'back') {
    s.back = BACK_S;
    // Don't let the quick roll-in undo it.
    s.intro = Math.min(s.intro, head(s) - BACK_S * BACK_SPEED - D);
  } else s.power = p;
}

/** The colour a wild marble landing at index `at` takes: the neighbour's that makes the longest run. */
function wildColour(s: State, at: number): number {
  let best = -1;
  let k = s.chain[at].k;
  for (const j of [at - 1, at + 1]) {
    const m = s.chain[j];
    if (!m || m.k === STONE) continue;
    s.chain[at].k = m.k;
    const [lo, hi] = groupAt(s.chain, at);
    if (hi - lo > best) [best, k] = [hi - lo, m.k];
  }
  return k;
}

/** Settle a shot in the chain next to marble `j`, popping its run if it makes 3. */
export function land(s: State, j: number, after: boolean, k: number, x: number, y: number, ev: Events, power: Shot['power'] = null) {
  const i = insert(s, j, after, k);
  ev.landed = { id: s.chain[i].id, x, y, k };
  s.combo = 0;
  if (power === 'bomb') {
    remove(s, Math.max(0, i - BOMB_SHOT), Math.min(s.chain.length - 1, i + BOMB_SHOT), ev, [{ x, y }]);
    return;
  }
  if (power === 'wild') s.chain[i].k = ev.landed.k = wildColour(s, i);
  // A shot that pops nothing ends the streak.
  if (!tryPop(s, i, ev)) s.streak = s.tier = 0;
}

/** Move the chain: the rear part is pushed from the mouth, every part in front slides back to meet it. */
function roll(s: State, dt: number, ev: Events) {
  const c = s.chain;
  if (!c.length) return;
  // Fast while the head is short of the intro mark (at the start, or after a big clear), easing in.
  const short = s.intro - head(s);
  let v = speedFor(s.d);
  if (s.kind === 'surge') v *= 1 + SURGE_K * Math.sin((s.t / SURGE_T) * Math.PI * 2);
  if (s.slow > 0) v *= SLOW_K;
  s.speed = s.back > 0 ? -BACK_SPEED : short > 0 ? v + (INTRO_SPEED - v) * Math.max(0.12, Math.min(1, short / 90)) : v;
  const gaps = new Set<number>();
  for (let i = 0; i + 1 < c.length; i++) if (!touching(c[i], c[i + 1])) gaps.add(c[i].id);
  let i = 0;
  // Rear part.
  while (i < c.length) {
    c[i].p += s.speed * dt;
    if (i + 1 < c.length && gaps.has(c[i].id)) break;
    i++;
  }
  // Each part in front slides back towards the one behind it.
  for (i++; i < c.length;) {
    const back = Math.min(RETRACT * dt, c[i].p - c[i - 1].p - D);
    do c[i].p -= Math.max(0, back);
    while (!gaps.has(c[i].id) && ++i < c.length);
    i++;
  }
  settle(c);
  // Gaps that just closed between two marbles of a colour may pop: a chain reaction.
  for (const id of gaps) {
    const a = c.findIndex((m) => m.id === id);
    if (a < 0 || a + 1 >= c.length || !touching(c[a], c[a + 1]) || c[a].k !== c[a + 1].k || c[a].k === STONE) continue;
    tryPop(s, a, ev);
  }
}

/** Keep the shooter loaded with colours still in the chain. */
function reload(s: State) {
  const left = present(s.chain);
  if (!left.length) return;
  if (!left.includes(s.cur)) s.cur = left.includes(s.next) ? s.next : pickColour(s);
  if (!left.includes(s.next)) s.next = pickColour(s);
}

/** Advance by `dt` seconds: keyboard aim, the chain, and the shot in flight. */
export function step(s: State, dt: number): Events {
  const ev: Events = { landed: null, missed: null, pops: [], coins: [], tier: 0, unlocked: null, won: false, lost: false, bonus: 0 };
  if (s.over) return ev;
  s.t += dt;
  s.slow = Math.max(0, s.slow - dt);
  s.back = Math.max(0, s.back - dt);
  if (s.turn) s.aim += s.turn * AIM_SPEED * dt;
  roll(s, dt, ev);
  const shot = s.shot;
  if (shot) {
    let left = SPEED * dt;
    while (left > 0 && s.shot) {
      const h = Math.min(4, left);
      left -= h;
      shot.x += shot.dx * h;
      shot.y += shot.dy * h;
      // Coins: the shot flies straight through them.
      for (let c = s.coins.length - 1; c >= 0; c--) {
        const coin = s.coins[c];
        if (Math.hypot(coin.x - shot.x, coin.y - shot.y) > R + COIN_R) continue;
        s.coins.splice(c, 1);
        s.score += COIN_POINTS;
        s.slow = Math.max(s.slow, COIN_SLOW);
        ev.coins.push(coin);
      }
      for (let j = 0; j < s.chain.length; j++) {
        if (!visible(s, s.chain[j])) continue;
        const m = pointAt(s.track, s.chain[j].p);
        if ((m.x - shot.x) ** 2 + (m.y - shot.y) ** 2 < HIT * HIT) {
          s.shot = null;
          land(s, j, sideOf(s, j, shot.x, shot.y), shot.k, shot.x, shot.y, ev, shot.power);
          break;
        }
      }
      if (s.shot && (shot.x < -R || shot.x > W + R || shot.y < -R || shot.y > H + R)) {
        s.shot = null;
        ev.missed = { x: shot.x, y: shot.y };
      }
    }
  }
  s.reach = Math.max(s.reach, head(s));
  // Only stones left: they crumble.
  if (s.chain.length && !present(s.chain).length) remove(s, 0, s.chain.length - 1, ev);
  if (!s.chain.length) {
    s.over = true;
    ev.won = true;
    const safe = Math.max(0, Math.min(1, (s.track.length - s.reach) / (s.track.length - s.intro)));
    ev.bonus = Math.round((SAFE_BONUS * safe) / 10) * 10;
    s.score += ev.bonus;
  } else if (head(s) >= s.track.length) {
    s.over = true;
    ev.lost = true;
  } else if (ev.pops.length) reload(s);
  return ev;
}
