# Runner v2 Upgrade Roadmap

## Current Status

- Branch: `v2-upgrade`
- Baseline commit: `626ab1a65d494d9129823123de9d735954646134`
- Current published app and local checkout match content-wise.
- Current runtime is a static browser app with no build step.

## Version Notes

- `game.js` header says `version 1.5 Final - 3/28`.
- `game.js` `VERSION` constant says `Runner Prototype v1.4 Log`.
- v2 should use one source of truth for user-visible and internal version labels.

## Current Game State

Runner is a tile-based canvas game using a 25 x 15 map. The player rolls two dice, spends movement points, jumps, falls with gravity, interacts with hazards, pickups, signs, locks, exits, and monsters, and carries some stats between levels through URL hash state.

Important current features:

- Canvas renderer with tile sprites loaded from `tiles2.json`.
- URL hash map loading with `#map=...`.
- URL hash carry-over stats with `#st=...`.
- Dice rolling and selected-die spending.
- Movement, jumping, diagonal jumping, gravity, falling, water/fluid behavior, slopes, bounce, hazards, exits, pickups, locks, signs, monsters, fog, and modal text.
- Separate editor page for painting maps, choosing variants, generating map strings, and opening maps in the game.

## v2 Target Tracks

1. Stabilize and document the prototype.
2. Extract shared map, variant, tile, level, and state modules.
3. Add tests and browser smoke checks.
4. Split gameplay into movement, interactions, rendering, and input modules.
5. Separate `levels.json` from tile definitions.
6. Add validation for tiles, levels, and variants.
7. Add XP, achievements, story flags, narrative events, and resume links.
8. Improve editor authoring for advanced entities and narrative events.

## First-Pass Module Plan

- `src/shared/variants.js`: variant sanitizing and variant lookup.
- `src/shared/mapCodec.js`: map row splitting, row encoding/decoding, full-map encoding/decoding.
- `src/shared/tileLoader.js`: tile JSON loading and sprite image preparation.
- `src/state.js`: persistent game state shape, carry stat codec, localStorage persistence.
- `src/validation.js`: tile, level, map, and variant validation.
- `src/events.js`: generic narrative/event engine.

## First Slice Completed On Branch

- Added project test scripts.
- Added v2 roadmap and current-state docs.
- Added golden map fixtures.
- Added shared map codec, variant, and tile-loading modules.
- Added persistent state module with localStorage helpers.
- Added GitHub Actions checks.
- Added Node tests and lightweight browser shell smoke tests.

## Next Slice

- Wire `src/state.js` into `game.js` without changing behavior.
- Move boot levels from `tiles2.json` into `levels.json` at runtime.
- Replace duplicate in-file map decoders with `src/shared/mapCodec.js`.
- Replace duplicate variant logic with `src/shared/variants.js`.
- Add first real browser smoke test with a headless browser once dependency/tooling choice is confirmed.
