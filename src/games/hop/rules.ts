import type { Rng } from '../../core/rng';
import { byLevel, type Difficulty } from '../../core/types';
import { dealKind, type Kind } from '../../core/variety';

/** Playfield in world units (the canvas scales it to the card). Heights ("alt") grow upwards. */
export const W = 300;
export const H = 400;
/** Hopper: half width and body height (its feet are at `alt`). */
export const PR = 10;
export const PH = 20;
/** Platform thickness. */
export const PLAT_H = 10;
const G = 1500;
/** Take-off speed of a bounce, of a spring and of a stomp. */
const JUMP = 620;
export const SPRING = 980;
const STOMP = 680;
/** Highest point of a plain bounce above the platform. */
export const JUMP_H = (JUMP * JUMP) / (2 * G);
const SPRING_H = (SPRING * SPRING) / (2 * G);
/** Sideways: top speed, acceleration while steering, braking when let go. */
const VX = 260;
const ACC = 2200;
const BRAKE = 1800;
/** Half width of a spring pad: land within it to be launched. */
export const SPRING_W = 9;
export const CRIT_R = 11;
export const COIN_R = 7;
export const GEM_R = 8;
const INVULNERABLE_S = 1.5;
/** The camera keeps the hopper in the lower part of the screen. */
const CAM_FRAC = 0.55;
/** Falling this far below the screen's bottom costs a heart. */
const FALL_MARGIN = 30;
/** Screen space below the ground at the start. */
export const CAM_START = -60;

export const LIVES = 3;
export const COIN_POINTS = 10;
export const GEM_POINTS = 50;
export const STOMP_POINTS = 25;
export const LIFE_BONUS = 50;
/** Points per second left under par at the finish. */
export const TIME_POINTS = 10;
/** Every this many height units scores a point. */
export const HEIGHT_UNIT = 10;

/** Height of the finish line. */
export const goalFor = (d: Difficulty) => byLevel(d, [1600, 2000, 2500, 3000, 3500]);
/** Vertical gap between platforms of the climbing path: [least, most]. The most stays well under a bounce. */
const gapFor = (d: Difficulty) =>
  byLevel<[number, number]>(d, [
    [40, 64],
    [46, 72],
    [52, 78],
    [56, 82],
    [60, 86],
  ]);
export const widthFor = (d: Difficulty) => byLevel(d, [66, 60, 54, 50, 46]);
/** Most sideways shift between path platforms. */
const shiftFor = (d: Difficulty) => byLevel(d, [70, 85, 100, 110, 115]);
const movingFor = (d: Difficulty) => byLevel(d, [0, 0.3, 0.25, 0.3, 0.35]);
const ampFor = (d: Difficulty) => byLevel(d, [0, 30, 36, 40, 44]);
const swayFor = (d: Difficulty) => byLevel(d, [0, 1.2, 1.4, 1.6, 1.9]);
const crumbleFor = (d: Difficulty) => byLevel(d, [0, 0, 0.2, 0.25, 0.3]);
export const springsFor = (d: Difficulty) => byLevel(d, [0, 0, 2, 3, 3]);
export const crittersFor = (d: Difficulty) => byLevel(d, [0, 0, 0, 4, 7]);
/** Chance of an extra platform off the path in each gap, and of it crumbling. */
const decoyFor = (d: Difficulty) => byLevel(d, [0.5, 0.45, 0.4, 0.35, 0.3]);
const decoyCrumbleFor = (d: Difficulty) => byLevel(d, [0, 0.2, 0.5, 0.6, 0.7]);
/** A typical clear, in seconds. */
export const parFor = (d: Difficulty) => byLevel(d, [18, 24, 30, 36, 42]);

/** The kinds of climb a level can deal. */
export const KINDS = [
  { id: 'classic', weight: 2 },
  { id: 'springs' },
  { id: 'crumbly', min: 2 },
  { id: 'clouds', min: 2 },
  { id: 'windy', min: 3 },
  { id: 'swarm', min: 3 },
] as const satisfies readonly Kind[];
export type KindId = (typeof KINDS)[number]['id'];

/** Seconds before a crumbled platform grows back. */
export const REGROW_S = 3.5;
/** Cloud platforms: seconds per cycle, and how long of it they're solid (they fade before vanishing). */
export const CLOUD_CYCLE = 3.2;
export const CLOUD_ON = 2;
/** Strongest wind push (units/s) in a windy climb. */
const WIND = 55;
/** Bats: half width (for hits), and speed range. */
export const BAT_R = 10;

/** Seconds after a climb (landing higher up, or a stomp) before the chain breaks. */
export const CHAIN_WINDOW = 1.6;
/** Chain lengths that fire a combo event: super jumps, a shield, a rocket. */
export const CHAIN_TIERS = [6, 12, 20] as const;
export type Reward = 'super' | 'shield' | 'rocket';
const REWARDS: readonly Reward[] = ['super', 'shield', 'rocket'];
/** Super jumps granted, and their take-off speed; the rocket's. */
const SUPER_JUMPS = 3;
const SUPER = 820;
const ROCKET = 1250;

type PlatKind = 'ground' | 'normal' | 'moving' | 'crumble' | 'cloud';

export interface Plat {
  kind: PlatKind;
  /** Centre x now, centre of its sway, and height of its top. */
  x: number;
  x0: number;
  alt: number;
  w: number;
  /** Sideways sway (moving platforms): amplitude, speed (rad/s), phase. */
  amp: number;
  sway: number;
  phase: number;
  /** Spring pad offset from the centre, if any. */
  spring: number | null;
  /** On the guaranteed climbing path. */
  path: boolean;
  /** Crumbled away; seconds before it grows back. */
  gone: boolean;
  regrow: number;
}

interface Critter {
  x: number;
  x0: number;
  /** Height of its centre. */
  alt: number;
  amp: number;
  phase: number;
  /** Bats fly straight across at `v` units/s (0: a critter swaying in place). */
  v: number;
  dead: boolean;
}

interface Coin {
  x: number;
  alt: number;
  gem: boolean;
  taken: boolean;
}

export interface State {
  d: Difficulty;
  kind: KindId;
  /** Strongest wind push (0: calm). */
  wind: number;
  /** Platforms climbed in a row (and stomps), each within `CHAIN_WINDOW`; seconds left; milestones. */
  chain: number;
  chainLeft: number;
  tier: number;
  /** Super jumps left, a shield against the next hit. */
  supers: number;
  shield: boolean;
  goal: number;
  plats: Plat[];
  critters: Critter[];
  coins: Coin[];
  /** Hopper: centre x, feet height, speeds. */
  x: number;
  alt: number;
  vx: number;
  vy: number;
  /** Steering: -1 left, 0 none, 1 right. */
  dir: -1 | 0 | 1;
  /** Height at the bottom of the screen. */
  cam: number;
  /** Highest the feet have been. */
  best: number;
  lives: number;
  invulnerable: number;
  /** Last solid platform landed on: where a lost heart puts you back. */
  safe: Plat;
  /** Height of the last platform bounced off. */
  landedAlt: number;
  coinsTaken: number;
  gemsTaken: number;
  stomps: number;
  /** Bonuses added at the finish. */
  bonus: number;
  score: number;
  time: number;
  won: boolean;
  over: boolean;
}

/** x wrapped into [0, W). */
const wrap = (x: number) => ((x % W) + W) % W;
/** Horizontal distance on the wrapping field. */
const wdist = (a: number, b: number) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, W - d);
};
/** Signed shortest step from `a` to `b` on the wrapping field. */
export const wdelta = (a: number, b: number) => {
  const d = wrap(b) - wrap(a);
  return d > W / 2 ? d - W : d < -W / 2 ? d + W : d;
};

function plat(kind: PlatKind, x: number, alt: number, w: number, path: boolean): Plat {
  return { kind, x, x0: x, alt, w, amp: 0, sway: 0, phase: 0, spring: null, path, gone: false, regrow: 0 };
}

/** Is a cloud platform solid at time `t`? (Other platforms always are.) */
export const solid = (p: Plat, t: number) => p.kind !== 'cloud' || (((t + p.phase) % CLOUD_CYCLE) + CLOUD_CYCLE) % CLOUD_CYCLE < CLOUD_ON;

/** The wind's push at time `t`: it swells and turns around slowly. */
export const windAt = (s: State, t: number) => s.wind * Math.sin(t * 0.5);

/** Span of x a jump from `a` to `b` sweeps: its centre and half length (sway included). */
function arc(a: Plat, b: Plat) {
  const d = wdelta(a.x0, b.x0);
  return { c: wrap(a.x0 + d / 2), r: Math.abs(d) / 2 + Math.max(a.amp, b.amp) + PR };
}

/**
 * Deal a climb from the seed: a path of platforms whose gaps all fit inside one bounce (and one
 * sideways dash), then extras, springs, critters kept away from the path, coins and gems.
 */
export function createLevel(d: Difficulty, rng: Rng, kindId?: KindId): State {
  const kind = kindId ?? dealKind(rng, d, KINDS).id;
  const goal = goalFor(d);
  const crumble = kind === 'crumbly' ? 0.45 : crumbleFor(d);
  const cloud = kind === 'clouds' ? 0.4 : 0;
  const [gmin, gmax] = gapFor(d);
  const pw = widthFor(d);
  const shift = shiftFor(d);
  const ground = plat('ground', W / 2, 0, W, true);
  const path: Plat[] = [ground];
  let x = W / 2;
  let alt = 0;
  while (alt < goal - 60) {
    alt += rng.int(gmin, gmax);
    const n = path.length;
    // The first step sits off to the side, so a hopper left alone keeps bouncing on the ground.
    const dx = n === 1 ? rng.pick([-1, 1]) * rng.int(64, Math.max(70, shift)) : rng.int(-shift, shift);
    x = wrap(x + dx);
    const r = rng.next();
    // A cloud only follows a platform you can bounce on while waiting for it (not a cloud or a crumbling one).
    const wait = path[n - 1].kind !== 'cloud' && path[n - 1].kind !== 'crumble';
    const pk: PlatKind =
      n > 3 && r < crumble
        ? 'crumble'
        : n > 2 && r < crumble + cloud
          ? wait
            ? 'cloud'
            : 'normal'
          : n > 2 && r < crumble + cloud + movingFor(d)
            ? 'moving'
            : 'normal';
    const p = plat(pk, x, alt, pw, true);
    if (pk === 'cloud') p.phase = rng.next() * CLOUD_CYCLE;
    if (pk === 'moving') {
      p.amp = ampFor(d);
      p.sway = swayFor(d) * (0.8 + rng.next() * 0.4);
      p.phase = rng.next() * Math.PI * 2;
      p.x = wrap(p.x0 + p.amp * Math.sin(p.phase));
    }
    path.push(p);
  }
  // Springs on a few plain platforms of the path, spread along the climb.
  const plain = path.filter((p, i) => p.kind === 'normal' && i > 3 && i < path.length - 3);
  // A spring park has plenty more springs (but no more gems than usual: one over each of the first few).
  const gems = springsFor(d) + (kind === 'springs' ? 1 : 0);
  const springs = springsFor(d) + (kind === 'springs' ? 5 : 0);
  for (let k = 0; k < springs && plain.length; k++) {
    const band = plain.filter((_, i) => Math.floor((i * springs) / plain.length) === k);
    const p = rng.pick(band.length ? band : plain);
    p.spring = rng.int(-pw / 2 + SPRING_W, pw / 2 - SPRING_W);
  }

  // Critters hover in a gap, as far as possible from every jump that passes their height.
  const critters: Critter[] = [];
  const want = crittersFor(d) + (kind === 'swarm' ? 2 : 0);
  if (want) {
    const slots = rng.shuffle(path.map((_, i) => i).filter((i) => i >= 5 && i < path.length - 2));
    for (const i of slots) {
      if (critters.length >= want) break;
      const calt = (path[i].alt + path[i + 1].alt) / 2;
      if (critters.some((c) => Math.abs(c.alt - calt) < 200)) continue;
      const arcs = path.slice(0, -1).flatMap((a, j) => {
        const b = path[j + 1];
        const top = a.alt + (a.spring != null ? SPRING_H : JUMP_H) + PH;
        return calt + CRIT_R + 30 > a.alt && calt - CRIT_R - 30 < top ? [arc(a, b)] : [];
      });
      let bestX = 0;
      let bestD = -1;
      for (let k = 0; k < 30; k++) {
        const cx = (k * W) / 30 + rng.next() * 4;
        const dd = Math.min(...arcs.map((a) => wdist(cx, a.c) - a.r));
        if (dd > bestD) [bestX, bestD] = [cx, dd];
      }
      const amp = 14;
      if (bestD < amp + CRIT_R + PR + 26) continue;
      const phase = rng.next() * Math.PI * 2;
      critters.push({ x: wrap(bestX + amp * Math.sin(phase)), x0: bestX, alt: calt, amp, phase, v: 0, dead: false });
    }
  }
  // A swarm adds bats flying straight across, each in its own band of the climb.
  if (kind === 'swarm') {
    const bats = byLevel(d, [0, 0, 3, 4, 5]);
    const band = (goal - 500) / bats;
    for (let k = 0; k < bats; k++) {
      const balt = 400 + band * (k + 0.2 + rng.next() * 0.6);
      critters.push({
        x: rng.next() * W,
        x0: rng.next() * W,
        alt: balt,
        amp: 0,
        phase: 0,
        v: rng.int(55, 85) * (rng.chance(0.5) ? -1 : 1),
        dead: false,
      });
    }
  }

  // Extra platforms between the path ones, clear of critters and of the start.
  const extras: Plat[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    const lo = path[i].alt + 18;
    const hi = path[i + 1].alt - 18;
    if (hi <= lo || lo < 140 || !rng.chance(decoyFor(d))) continue;
    const dalt = rng.int(lo, hi);
    const dx = rng.next() * W;
    if (critters.some((c) => Math.abs(c.alt - dalt) < 90 && wdist(c.x0, dx) < 80)) continue;
    extras.push(plat(rng.chance(decoyCrumbleFor(d)) ? 'crumble' : 'normal', dx, dalt, Math.round(pw * 0.9), false));
  }

  // Coins just above the next platform of the path; gems high over each spring.
  const coins: Coin[] = [];
  for (let i = 1; i < path.length; i++) {
    const p = path[i];
    if (i % 4 === 0) for (let k = 0; k < 3; k++) coins.push({ x: p.x0, alt: p.alt + 26 + k * 18, gem: false, taken: false });
    else if (rng.chance(0.5)) coins.push({ x: p.x0, alt: p.alt + 30, gem: false, taken: false });
    if (p.spring != null && coins.filter((c) => c.gem).length < gems)
      coins.push({ x: wrap(p.x0 + p.spring), alt: p.alt + SPRING_H * 0.8, gem: true, taken: false });
  }

  const plats = [...path, ...extras].sort((a, b) => a.alt - b.alt);
  return {
    d,
    kind,
    wind: kind === 'windy' ? WIND * (rng.chance(0.5) ? -1 : 1) : 0,
    chain: 0,
    chainLeft: 0,
    tier: 0,
    supers: 0,
    shield: false,
    goal,
    plats,
    critters,
    coins,
    x: W / 2,
    alt: 0,
    vx: 0,
    vy: JUMP,
    dir: 0,
    cam: CAM_START,
    best: 0,
    lives: LIVES,
    invulnerable: 0,
    safe: ground,
    landedAlt: 0,
    coinsTaken: 0,
    gemsTaken: 0,
    stomps: 0,
    bonus: 0,
    score: 0,
    time: 0,
    won: false,
    over: false,
  };
}

export const progress = (s: State) => Math.min(1, Math.max(0, s.best / s.goal));

export interface StepEvents {
  /** Platform landed on (and bounced off), if any. */
  landed: Plat | null;
  spring: boolean;
  crumbled: Plat | null;
  taken: Coin[];
  stomped: Critter | null;
  /** A heart lost: bumped a critter, or fell off the bottom. */
  hurt: 'bump' | 'fall' | null;
  /** The shield took a hit instead (no heart lost). */
  shielded: boolean;
  /** Chain milestone reached this step (1-based, 0: none), and its reward. */
  tier: number;
  reward: Reward | null;
  /** A super jump or the rocket took off this step. */
  boost: 'super' | 'rocket' | null;
  won: boolean;
  over: boolean;
}

/** Advance the game by `dt` seconds. */
export function step(s: State, dt: number): StepEvents {
  const ev: StepEvents = {
    landed: null,
    spring: false,
    crumbled: null,
    taken: [],
    stomped: null,
    hurt: null,
    shielded: false,
    tier: 0,
    reward: null,
    boost: null,
    won: false,
    over: false,
  };
  if (s.won || s.over) return ev;
  s.time += dt;
  s.invulnerable = Math.max(0, s.invulnerable - dt);
  for (const p of s.plats) {
    if (p.amp) p.x = wrap(p.x0 + p.amp * Math.sin(p.sway * s.time + p.phase));
    if (p.gone && (p.regrow -= dt) <= 0) p.gone = false;
  }
  for (const c of s.critters) c.x = wrap(c.v ? c.x0 + c.v * s.time : c.x0 + c.amp * Math.sin(1.3 * s.time + c.phase));
  if (s.chain && (s.chainLeft -= dt) <= 0) s.chain = s.tier = s.chainLeft = 0;

  // Sideways: speed towards the steering, with a quick brake when let go; the wind pushes on top.
  const target = s.dir * VX;
  const a = s.dir ? ACC : BRAKE;
  s.vx = s.vx < target ? Math.min(target, s.vx + a * dt) : Math.max(target, s.vx - a * dt);
  s.x = wrap(s.x + (s.vx + windAt(s, s.time)) * dt);

  const before = s.alt;
  s.vy -= G * dt;
  s.alt += s.vy * dt;

  // Platforms only catch you from above, while falling.
  if (s.vy < 0) {
    let hit: Plat | null = null;
    for (const p of s.plats)
      if (
        !p.gone &&
        solid(p, s.time) &&
        before >= p.alt &&
        s.alt <= p.alt &&
        wdist(s.x, p.x) <= p.w / 2 + PR * 0.7 &&
        (!hit || p.alt > hit.alt)
      )
        hit = p;
    if (hit) {
      // Climbing to a higher platform keeps the chain going.
      if (hit.alt > s.landedAlt + 1) climb(s, ev);
      s.alt = hit.alt;
      s.landedAlt = hit.alt;
      ev.landed = hit;
      ev.spring = hit.spring != null && wdist(s.x, hit.x + hit.spring) <= SPRING_W + PR * 0.5;
      s.vy = ev.spring ? SPRING : JUMP;
      if (ev.reward === 'rocket') s.vy = ROCKET;
      else if (s.supers > 0 && !ev.spring) {
        s.supers--;
        s.vy = SUPER;
        ev.boost = 'super';
      }
      if (hit.kind === 'crumble') {
        hit.gone = true;
        hit.regrow = REGROW_S;
        ev.crumbled = hit;
      } else if (hit.kind !== 'cloud') s.safe = hit;
    }
  }

  for (const c of s.critters) {
    if (c.dead) continue;
    const dy = s.alt + PH / 2 - c.alt;
    if (Math.hypot(wdist(s.x, c.x), dy) >= CRIT_R + PR) continue;
    if (s.vy < 0 && s.alt >= c.alt - 2) {
      c.dead = true;
      s.vy = STOMP;
      s.stomps++;
      ev.stomped = c;
      climb(s, ev);
    } else if (!s.invulnerable) ev.hurt = 'bump';
  }

  for (const c of s.coins) {
    if (c.taken) continue;
    if (Math.hypot(wdist(s.x, c.x), s.alt + PH / 2 - c.alt) < (c.gem ? GEM_R : COIN_R) + PR + 2) {
      c.taken = true;
      if (c.gem) s.gemsTaken++;
      else s.coinsTaken++;
      ev.taken.push(c);
    }
  }

  s.best = Math.max(s.best, s.alt);
  s.cam = Math.max(s.cam, s.alt - H * CAM_FRAC);
  if (!ev.hurt && s.alt < s.cam - FALL_MARGIN) ev.hurt = 'fall';
  if (ev.hurt) s.chain = s.tier = s.chainLeft = 0;
  if (ev.hurt && s.shield) {
    // The shield takes the hit: a bump only makes the hopper blink; a fall puts it back on its platform.
    s.shield = false;
    ev.shielded = true;
    if (ev.hurt === 'fall') respawn(s);
    else s.invulnerable = INVULNERABLE_S;
    ev.hurt = null;
  }
  if (ev.hurt) {
    s.lives--;
    if (s.lives <= 0) {
      s.over = ev.over = true;
      return ev;
    }
    respawn(s);
  }

  if (s.best >= s.goal) {
    s.won = ev.won = true;
    s.bonus = s.lives * LIFE_BONUS + Math.max(0, Math.round((parFor(s.d) - s.time) * TIME_POINTS));
  }
  s.score = scoreOf(s);
  return ev;
}

/** One more step in the chain (a climb or a stomp): milestones grant rewards. */
function climb(s: State, ev: StepEvents) {
  s.chain++;
  s.chainLeft = CHAIN_WINDOW;
  if (s.tier < CHAIN_TIERS.length && s.chain >= CHAIN_TIERS[s.tier]) {
    ev.reward = REWARDS[s.tier];
    ev.tier = ++s.tier;
    grant(s, ev.reward);
    if (ev.reward === 'rocket') ev.boost = 'rocket';
  }
}

/** Give a chain reward: super jumps, a shield, or a rocket (on the next bounce, or right away in the air). */
export function grant(s: State, r: Reward) {
  if (r === 'super') s.supers = SUPER_JUMPS;
  else if (r === 'shield') s.shield = true;
  else {
    s.vy = ROCKET;
    s.invulnerable = Math.max(s.invulnerable, 1);
  }
}

const scoreOf = (s: State) =>
  Math.floor(Math.min(s.best, s.goal) / HEIGHT_UNIT) +
  s.coinsTaken * COIN_POINTS +
  s.gemsTaken * GEM_POINTS +
  s.stomps * STOMP_POINTS +
  s.bonus;

/** Back over the last solid platform, blinking, with the camera brought down to it. */
function respawn(s: State) {
  const p = s.safe;
  s.x = p.x;
  s.alt = p.alt + 40;
  s.vx = 0;
  s.vy = 0;
  s.landedAlt = p.alt;
  s.invulnerable = INVULNERABLE_S;
  s.cam = Math.min(s.cam, p.alt - 90);
}

/**
 * A simple pilot (tests): steer towards the lowest path platform above the last one bounced off (and
 * still on screen after a spring), where it is now, easing off before it overshoots.
 */
export function pilot(s: State): -1 | 0 | 1 {
  const floor = Math.max(s.landedAlt + 4, s.cam + 50);
  let next = s.plats.find((p) => p.path && !p.gone && p.alt > floor);
  if (!next) return 0;
  // A cloud that won't be there when the hopper comes down on it: bounce in place a while longer.
  const rise = s.vy * s.vy + 2 * G * (s.alt - next.alt);
  const land = rise >= 0 ? (s.vy + Math.sqrt(rise)) / G : 0;
  const here = s.plats.find((p) => p.alt === s.landedAlt && !p.gone);
  // Falling below it already: come back down onto the platform underneath instead.
  if (here && ((next.kind === 'cloud' && !solid(next, s.time + land)) || (s.vy <= 0 && s.alt < next.alt))) next = here;
  const d = wdelta(s.x, next.x);

  const stop = Math.sign(s.vx) === Math.sign(d) ? (s.vx * s.vx) / (2 * BRAKE) : 0;
  return Math.abs(d) < 4 + stop ? 0 : d > 0 ? 1 : -1;
}
