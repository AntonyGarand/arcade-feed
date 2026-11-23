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

## Games

| Category     | Game (id)                         | One level                                                                        |
| ------------ | --------------------------------- | -------------------------------------------------------------------------------- |
| Match        | Swap (`swap`)                     | match-3: reach a target score within a move limit                                |
| Match        | Clusters (`clusters`)             | pop same-colour groups until at most a few blocks are left                       |
| Match        | Marble Chain (`chain`)            | pop a rolling marble chain by shooting 3 of a kind before it reaches the hole    |
| Aim & bounce | Bricks (`bricks`)                 | break every brick with a paddle and three lives                                  |
| Aim & bounce | Pegs (`pegs`)                     | shoot balls through a peg field to clear the orange pegs                         |
| Aim & bounce | Bubble Pop (`bubbles`)            | clear every bubble before the dropping ceiling crosses the line                  |
| Aim & bounce | Sky Guard (`skyguard`)            | intercept a wave of missiles with at least one city standing                     |
| Aim & bounce | Mini Golf (`golf`)                | sink one seeded hole within the stroke limit                                     |
| Aim & bounce | Archery (`archery`)               | reach a points total with a few arrows, against gravity and wind                 |
| Aim & bounce | Snip (`snip`)                     | cut ropes in the right order and timing to drop a sweet into a hungry critter    |
| Aim & bounce | Sling (`sling`)                   | fling a few stones to pop every grumpy blob sheltered in wood and stone forts    |
| Aim & bounce | Pinball (`pinball`)               | reach a target score with three balls on a seeded flipper table                  |
| Reflex       | Dodge (`dodge`)                   | survive a timed run of falling and flying hazards                                |
| Reflex       | Snake (`snake`)                   | eat a number of pellets on a walled map without crashing                         |
| Reflex       | Whack (`whack`)                   | tap a number of critters before the timer, never the spiky decoys                |
| Reflex       | Rocks (`rocks`)                   | shoot every rock and its fragments in a wrap-around field                        |
| Reflex       | Formation (`formation`)           | clear a marching formation before it lands                                       |
| Reflex       | Paddle Duel (`duel`)              | beat the rival paddle to a target score                                          |
| Reflex       | Slice (`slice`)                   | swipe through every tossed fruit without slicing the bombs                       |
| Reflex       | Maze Chase (`chase`)              | eat every seed in a hedge maze while dodging the hunting owls                    |
| Reflex       | Claim (`claim`)                   | fence off a share of the field while sparks and crawlers hunt your line          |
| Run & fly    | Flutter (`flutter`)               | flap through a number of gates                                                   |
| Run & fly    | Runner (`runner`)                 | jump and duck your way to the finish line                                        |
| Run & fly    | Lander (`lander`)                 | touch down softly and upright on a pad with limited fuel                         |
| Run & fly    | Crossing (`crossing`)             | hop across roads and rivers to fill the home slots in time                       |
| Run & fly    | Hop (`hop`)                       | bounce from platform to platform up to the finish flag                           |
| Stack & drop | Falling Blocks (`falling-blocks`) | clear a number of lines from a rubble start without topping out                  |
| Stack & drop | Fruit Merge (`merge`)             | drop and merge pieces up to a target size before the jar overflows               |
| Stack & drop | Tower (`tower`)                   | time each drop to stack a tower to a target height                               |
| Think        | Doubles (`doubles`)               | slide and combine tiles up to a target within a move limit                       |
| Think        | Mines (`mines`)                   | open every safe cell of a no-guess mine field against the clock                  |
| Think        | Crates (`crates`)                 | push every crate onto a goal within a move limit                                 |
| Think        | Echo (`echo`)                     | repeat a growing sequence of pads for a number of rounds                         |
| Think        | Dig (`dig`)                       | dig tunnels to lead a share of the water into the pipe, avoiding rock and sludge |
| Think        | Pipeline (`pipeline`)             | lay pipes so the flow passes enough of them before it spills                     |

## Layout

```
src/
  main.ts          shell: tabs, routing (/, /games, /game/<id>, /play/<id> feed of one game, /stats, /settings)
  core/            types (GameDef, GameCtx), store (profile, best scores, stars, auto-levelling), i18n, rng, telemetry
  ui/              DOM helpers, sheets, help dialog, result panel, confetti
  app/             feed, nav, update banner, card/ (card, frame loop, clock, fit, settings sheet)
  pages/           Games, single game, Profile, Settings
  kits/arena/      canvas playfield in world units: DPR scaling, theme colours, pointer → world, style-aware pieces
                   (box, block, ball, gem, field), fx (bursts, rings, floating text, shake, flash), easing
  kits/gesture/    pointer gestures on the canvas (press, drag, swipe, tap, release) and arrow/WASD key directions
  kits/glyph/      shapes that pair with palette colours, a second cue for colour-matched pieces
  kits/sound/      8-bit sound effects synthesised with Web Audio (no files), and short vibrations
  games/<id>/      one game per folder: index.ts (auto-registered), rules.ts (pure logic), style.css
  styles/          tokens and shared components (from puzzle feed) + arcade.css (gate, stars)
test/              vitest (happy-dom): registry contract, store, per-game rules
```

## Adding a game

Create `src/games/<id>/index.ts` exporting a `GameDef` (see `src/core/types.ts` and `src/games/bricks/` as the example):

- `name` / `rules` getters via `L()`, both ≤ 60 characters; `help()` with a goal, 3–6 steps (rules then controls) and tips.
- `category`: `match`, `aim`, `reflex`, `move`, `stack` or `think` (`src/core/categories.ts`).
- `stars(d)` → `[two, three]` score thresholds, `par(d)` → typical run length in seconds.
- `create(ctx)`: build into `ctx.root` (usually `new Arena(ctx.root, W, H, redraw)`), report with `ctx.score()`, `ctx.lives()`, `ctx.status()`, end with `ctx.win()` / `ctx.lose()`. Return `{ frame, draw, onKey, destroy }`. `onKey` gets keydown and keyup.
- Sound: call `sfx(name)` from `kits/sound` at each discrete event (a hit, a pop, a shot), with `pitch` or a combo `step` so repeats don’t grate, and `haptic(ms)` for big impacts only. The card already plays the start, lost-life, win and lose sounds.
- Pointer input on the canvas (`touch-action: none` is set by the arena), so drags never scroll the feed.
- Colours only from theme tokens (`arena.colors`), scoped tone in `style.css`: `[data-puzzle='<id>'] { --accent: var(--pN); }`.
- Keep game logic pure in `rules.ts` and test it (Bricks has an autopilot that must clear every level).
