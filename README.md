# arcade feed

An endless, scroll-snapping feed of one-level arcade games, in English and Québec French. Sister project of [puzzle feed](https://puzzle.garand.dev): same shell, look and themes, but each card is a short real-time (or turn-based) arcade level scored with stars. Static site, no backend; profile and stats live in `localStorage`.

## Development

```sh
mise install          # once: installs the pinned Node
npm ci
npm run dev           # http://localhost:5190 (puzzle feed uses 5180)
npm run check         # fmt:check, lint, typecheck, knip, test — what CI runs
```

## How a card works

1. The card deals a level (`GameDef.create`) and shows it behind a **start gate** (rules, ★★ / ★★★ goals, best score). Nothing moves until the player taps Play (or Space / Enter).
2. While playing, the card runs one `requestAnimationFrame` loop and calls the game's `frame(dt)` (`dt` capped at 1/20 s). Only the visible card ever runs.
3. Scrolling away, hiding the tab, opening a sheet, or P / Esc **pauses**; coming back shows Resume.
4. The game calls `ctx.win()` or `ctx.lose()`. Stars come from the final score (`GameDef.stars(d)` gives the ★★ and ★★★ thresholds; any clear earns ★). The result panel shows score, best, time; Again replays the same seed, Next scrolls on (auto after a clear).
5. Auto-levelling (Easy → Master): up after two ★★★ clears in a row or three clears with ★★+, down after two losses or skips in a row. Picking a level locks it.

## Layout

```
src/
  main.ts          shell: tabs, routing (/, /games, /game/<id>, /play/<id> feed of one game, /stats, /settings)
  core/            types (GameDef, GameCtx), store (profile, best scores, stars, auto-levelling), i18n, rng, telemetry
  ui/              DOM helpers, sheets, help dialog, result panel, confetti
  app/             feed, nav, update banner, card/ (card, frame loop, clock, fit, settings sheet)
  pages/           Games, single game, Profile, Settings
  kits/arena/      canvas playfield in world units: DPR scaling, theme colours, pointer → world, neo-brutalist boxes
  games/<id>/      one game per folder: index.ts (auto-registered), rules.ts (pure logic), style.css
  styles/          tokens and shared components (from puzzle feed) + arcade.css (gate, stars)
test/              vitest (happy-dom): registry contract, store, per-game rules
```

## Adding a game

Create `src/games/<id>/index.ts` exporting a `GameDef` (see `src/core/types.ts` and `src/games/bricks/` as the example):

- `name` / `rules` getters via `L()`, both ≤ 60 characters; `help()` with a goal, 3–6 steps (rules then controls) and tips.
- `category`: `match`, `aim`, `reflex` or `stack` (`src/core/categories.ts`).
- `stars(d)` → `[two, three]` score thresholds, `par(d)` → typical run length in seconds.
- `create(ctx)`: build into `ctx.root` (usually `new Arena(ctx.root, W, H, redraw)`), report with `ctx.score()`, `ctx.lives()`, `ctx.status()`, end with `ctx.win()` / `ctx.lose()`. Return `{ frame, draw, onKey, destroy }`. `onKey` gets keydown and keyup.
- Pointer input on the canvas (`touch-action: none` is set by the arena), so drags never scroll the feed.
- Colours only from theme tokens (`arena.colors`), scoped tone in `style.css`: `[data-puzzle='<id>'] { --accent: var(--pN); }`.
- Keep game logic pure in `rules.ts` and test it (Bricks has an autopilot that must clear every level).
