import { CATEGORIES } from '../core/categories';
import { setDefaultOff } from '../core/store';
import type { GameDef } from '../core/types';

/**
 * Every game folder's `index.ts` that exports a GameDef is registered automatically
 * (`src/games/<id>/index.ts`). Helpers next to it, and shared engines in `src/kits/`, are plain modules.
 */
const modules = import.meta.glob<Record<string, unknown>>('./*/index.ts', { eager: true });

const isDef = (v: unknown): v is GameDef =>
  !!v && typeof v === 'object' && typeof (v as GameDef).id === 'string' && typeof (v as GameDef).create === 'function';

const found = new Map<string, GameDef>();
for (const mod of Object.values(modules)) for (const v of Object.values(mod)) if (isDef(v)) found.set(v.id, v);

const catOrder = (d: GameDef) => CATEGORIES.findIndex((c) => c.id === d.category);

export const GAMES: GameDef[] = [...found.values()].sort((a, b) => catOrder(a) - catOrder(b) || a.name.localeCompare(b.name));

setDefaultOff(GAMES.filter((d) => d.offByDefault).map((d) => d.id));
