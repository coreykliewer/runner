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

Runner is a tile-based canvas game using a 25 x 15 map. The player rolls two dice, spends movement points, jumps, falls with gravity, interacts with hazards, pickups, signs, locks, exits, and monsters, and carries persistent progress between level-boundary checkpoints through local storage or portable URL state.

Important current features:

- Canvas renderer with tile sprites loaded from `tiles2.json`.
- URL hash map loading with `#map=...`.
- URL hash carry-over stats with `#st=...` and portable checkpoint links.
- Dice rolling and selected-die spending.
- Movement, jumping, diagonal jumping, gravity, falling, water/fluid behavior, slopes, bounce, hazards, exits, pickups, locks, signs, monsters, fog, and modal text.
- Separate editor page for painting maps, choosing variants, generating map strings, and opening maps in the game.
- Exit routing from `levels.json`, with validation for missing destination levels and a legacy variant-ID fallback.
- Level-boundary local checkpoints; midlevel world mutations are intentionally not persisted.
- Achievement comparisons reject missing explicit paths while preserving bare named-counter defaults.
- Playwright browser coverage for movement costs and failed attempts, pickup collection, checkpoint restore, mapped exits, and portable resume in a fresh context.

## v2 Target Tracks

1. Continue stabilizing and documenting the prototype.
2. Continue extracting shared runtime responsibilities from `game.js`.
3. Maintain module tests, shell smoke checks, and real-browser gameplay tests with `npm run check`.
4. Split remaining gameplay into movement, interactions, rendering, and input modules.
5. Keep canonical levels and routing in `levels.json`; legacy embedded maps are fallback-only.
6. Maintain validation for tiles, levels, exit mappings, and achievement conditions.
7. Maintain XP, achievements, story flags, narrative events, and portable checkpoint links.
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

- Continue extracting gameplay responsibilities from `game.js` without changing the data-driven tile, level, and achievement contracts.
- Replace remaining duplicate in-file map decoding and variant logic with the shared modules.
- Extend editor authoring for level exit mappings and advanced entities.
- Keep browser coverage focused on player-visible gameplay flows and run `npm run check` before changes are considered complete.
