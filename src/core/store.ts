import type { Difficulty, Stars } from './types';

export type Outcome = 'cleared' | 'lost' | 'skipped';
/** 0 = off, 1 = less, 2 = normal, 3 = more */
export type Weight = 0 | 1 | 2 | 3;
export type Theme = 'system' | 'light' | 'dark' | 'oled';
/** Look of the whole app (styles/themes.css), on top of light / dark. */
export type Style = 'neo' | 'minimal' | 'soft' | 'newsprint';

export interface Result {
  d: Difficulty;
  o: Outcome;
  score: number;
  stars: Stars;
  /** Length of the run (ms, paused time excluded). */
  ms: number;
  at: number;
  /** Played outside the feed (Games tab): counts in stats and auto-levelling. */
  lb?: true;
}

export interface TypePrefs {
  level: Difficulty;
  /** true once the player picked a level by hand: auto-levelling stops for this game. */
  manual: boolean;
  weight: Weight;
  /** Timestamp of the last level change; only results after it count for auto-levelling. */
  since: number;
}

export interface TypeStats {
  played: number;
  cleared: number;
  lost: number;
  skipped: number;
  /** Time spent in runs (ms, paused time excluded). */
  time: number;
  /** Best score per level. */
  best: Partial<Record<Difficulty, number>>;
  /** Most stars earned per level. */
  stars: Partial<Record<Difficulty, Stars>>;
  recent: Result[];
}

export interface Profile {
  v: 1;
  name: string;
  created: number;
  theme: Theme;
  /** Absent = Neo. */
  style?: Style;
  autoAdvance: boolean;
  startLevel: Difficulty;
  types: Record<string, TypePrefs>;
  stats: Record<string, TypeStats>;
  /** Clears per local day (`dayKey`). */
  days: Record<string, number>;
  /** Games whose off-by-default was already applied, so turning one back on sticks. */
  offApplied?: string[];
}

const KEY = 'arcade-feed:v1';

function fresh(): Profile {
  return { v: 1, name: '', created: Date.now(), theme: 'system', autoAdvance: true, startLevel: 1, types: {}, stats: {}, days: {} };
}

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.v === 1) return { ...fresh(), ...p };
    }
  } catch {
    /* corrupt storage: start over */
  }
  return fresh();
}

let profile = load();

const defaultOff = new Set<string>();

/** Switch these games off in the feed, once per profile: a player who turns one back on keeps it. */
export function setDefaultOff(ids: string[]) {
  for (const id of ids) defaultOff.add(id);
  applyDefaultOff();
}

function applyDefaultOff() {
  const done = (profile.offApplied ??= []);
  let changed = false;
  for (const id of defaultOff) {
    if (done.includes(id)) continue;
    prefs(id).weight = 0;
    done.push(id);
    changed = true;
  }
  if (changed) save();
}

type Listener = (kind: 'level' | 'weight' | 'profile' | 'record', id?: string) => void;
const listeners = new Set<Listener>();
export const onChange = (fn: Listener) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit: Listener = (kind, id) => listeners.forEach((fn) => fn(kind, id));

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* quota / private mode: keep in memory */
  }
}

export const getProfile = () => profile;

export function update(patch: Partial<Pick<Profile, 'name' | 'theme' | 'style' | 'autoAdvance' | 'startLevel'>>) {
  Object.assign(profile, patch);
  save();
  emit('profile');
}

export function prefs(id: string): TypePrefs {
  return (profile.types[id] ??= { level: profile.startLevel, manual: false, weight: 2, since: Date.now() });
}

export function stats(id: string): TypeStats {
  return (profile.stats[id] ??= { played: 0, cleared: 0, lost: 0, skipped: 0, time: 0, best: {}, stars: {}, recent: [] });
}

/** Set a fixed level (manual) or hand control back to auto-levelling. */
export function setLevel(id: string, level: Difficulty | 'auto') {
  const p = prefs(id);
  if (level === 'auto') {
    p.manual = false;
  } else {
    p.manual = true;
    if (p.level !== level) p.since = Date.now();
    p.level = level;
  }
  save();
  emit('level', id);
}

export function setWeight(id: string, w: Weight) {
  prefs(id).weight = w;
  save();
  emit('weight', id);
}

export function resetAllToAuto() {
  for (const p of Object.values(profile.types)) p.manual = false;
  save();
  emit('level');
}

/** A "day" for streaks starts at 4 am, so a late-night session counts as one day. */
const DAY_START_HOURS = 4;
export const dayKey = (t = Date.now()) => new Date(t - DAY_START_HOURS * 3_600_000).toLocaleDateString('en-CA');

export interface RecordOutcome {
  levelChange?: { from: Difficulty; to: Difficulty };
  /** Beat the previous best score at this level. */
  best?: boolean;
  /** Best score at this level before this run, if any. */
  prevBest?: number | undefined;
  /** First time this level was cleared. */
  firstClear?: boolean;
}

/**
 * Record a finished run and run auto-levelling: up after 2 three-star clears in a row, or 3 clears with
 * at least two stars; down after 2 losses or skips in a row. A manual level never moves.
 */
export function record(id: string, r: Omit<Result, 'at'>): RecordOutcome {
  const s = stats(id);
  const p = prefs(id);
  const out: RecordOutcome = {};
  s.played++;
  s.time += r.ms;
  if (r.o === 'cleared') {
    s.cleared++;
    out.firstClear = !s.stars[r.d];
    if (r.stars > (s.stars[r.d] ?? 0)) s.stars[r.d] = r.stars;
    const k = dayKey();
    profile.days[k] = (profile.days[k] ?? 0) + 1;
  } else if (r.o === 'lost') s.lost++;
  else s.skipped++;
  if (r.o !== 'skipped') {
    const prev = s.best[r.d];
    out.prevBest = prev;
    if (prev == null || r.score > prev) {
      s.best[r.d] = r.score;
      out.best = prev != null && r.score > prev;
    }
  }

  s.recent.push({ ...r, at: Date.now() });
  if (s.recent.length > 30) s.recent.splice(0, s.recent.length - 30);

  if (!p.manual) {
    const rel = s.recent.filter((x) => x.d === p.level && x.at >= p.since);
    const last = (n: number) => (rel.length >= n ? rel.slice(-n) : null);
    let to = p.level;
    if (p.level < 5 && (last(2)?.every((x) => x.stars === 3) || last(3)?.every((x) => x.stars >= 2))) to = (p.level + 1) as Difficulty;
    else if (p.level > 1 && last(2)?.every((x) => x.o !== 'cleared')) to = (p.level - 1) as Difficulty;
    if (to !== p.level) {
      out.levelChange = { from: p.level, to };
      p.level = to;
      p.since = Date.now();
    }
  }
  save();
  if (out.levelChange) emit('level', id);
  emit('record', id);
  return out;
}

/** Days in a row (ending today or yesterday) with at least one clear. */
export function dayStreak(): number {
  const d = new Date();
  if (!profile.days[dayKey(d.getTime())]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (profile.days[dayKey(d.getTime())]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function exportProfile(): string {
  return JSON.stringify(profile, null, 2);
}

export function importProfile(json: string) {
  const p = JSON.parse(json);
  if (!p || p.v !== 1 || typeof p.types !== 'object' || typeof p.stats !== 'object') throw new Error('Not an arcade feed profile');
  profile = { ...fresh(), ...p };
  applyDefaultOff();
  save();
  emit('profile');
  emit('level');
}

export function resetProfile() {
  profile = fresh();
  applyDefaultOff();
  save();
  emit('profile');
  emit('level');
}
