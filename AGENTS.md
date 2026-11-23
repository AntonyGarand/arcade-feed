# Agent notes

- Read `README.md` (commands, layout, game contract) before changing code.
- `npm run check` must pass before committing. Run `npm run fmt` after editing; don't hand-format.
- One game per folder, `src/games/<id>/index.ts` exporting a `GameDef` (auto-discovered: don't add a registry entry). Its pure logic goes next to it (`rules.ts`), tested in `test/<id>.test.ts`. Engines shared by games go in `src/kits/<name>/` (`kits/arena` is the canvas playfield).
- Layers (lint-enforced): `src/core` has no rendering and imports no other layer; `src/ui` is generic DOM building blocks; `src/app` is the shell (feed, nav, card); games never import each other or the app.
- Tests mount games with `mountGame()` from `test/support/mount.ts`; don't hand-write a `GameCtx`.
- All randomness comes from `ctx.rng` (the same seed must deal the same level; "Again" replays it). All user-visible text goes through `L(en, fr)`, written in Québec French with "vous".
- Static site meant for GitHub Pages (arcade.garand.dev). Don't introduce a backend or server hosting.
