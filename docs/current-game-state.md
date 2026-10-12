# Current Game State

## Runtime

The current app is served as static files:

- `index.html` loads `style.css` and `game.js`.
- `editor.html` loads `editor.css` and the Runner Studio controller in `src/editor/studio.js`.
- Runner Studio manages `levels.json`, the single numeric tile catalog in `tiles2.json`, `fixtures/level1-narrative.json`, and `achievements.json` as separate editable documents. It uses the shared codecs and content validators; browser file pickers are used when available, with JSON import/download fallbacks.
- `tiles2.json` is the canonical `runner.numeric-tile-registry` document used by gameplay and Studio. The original letter-keyed catalog and maps are retained in `tiles2.legacy.json` and `levels.legacy.json` as recovery/import sources.
- `levels.json` contains canonical numeric JSON-grid maps and exit-variant-to-level mappings. Embedded maps in the legacy catalog remain a fallback.
- Every current level map uses stable numeric tile IDs and explicit spawn data; no second active tile catalog is loaded.

There is no bundler or build step. Run `npm test` for module tests, `npm run smoke` for HTML wiring checks, `npm run test:browser` for Playwright browser tests, or `npm run check` for all checks.

## Responsive Layout

- Wide screens place the controls and event log on either side of the game board. Both panels fill the viewport height and scroll independently when their contents overflow.
- At widths up to 1200px, the board sits above the controls and log in a two-column panel row. The panels remain independently scrollable.
- At widths up to 810px, the board scales to fit the viewport while preserving its 800:510 aspect ratio. Phone landscape between 600px and 900px returns to a three-column layout with a proportionally scaled board and compact panels.
- Short tablet-height viewports reserve a 240px panel row below the board; the page can scroll to keep the full board reachable.

## Checkpoints and Resume

- Local saves preserve level-boundary checkpoints and the current dice state during an active roll. Starting a level records its persistent Runner progress; taking an exit records the destination level and the carried progress together.
- A checkpoint restores the destination level's canonical map and spawn, plus saved die values and roll count. Midlevel map mutations and positions are not saved, so a pickup collected before reaching the next checkpoint can reappear after a reload.
- **Create Resume Link** serializes the checkpoint level and persistent Runner progress into the URL. It works in a fresh browser without local storage. `#resume=1` remains available for resuming a checkpoint in the same browser.
- Exits use the current level's `exits` mapping in `levels.json`. For older data without a mapping, the exit variant is treated as a destination level ID.
- Achievement comparisons with missing dotted paths (for example `damage.amount`) fail. Bare stat names retain their existing counter lookup behavior.
- Movement-attempt achievements are evaluated before movement points are spent, using the same calculated target cost as movement.

## Controls

- Roll Dice: sets movement points from two dice.
- Arrow buttons: move left, right, down, and jump up.
- Diagonal jump buttons: jump up-left and up-right.
- Keyboard:
  - `A` / left arrow: move left.
  - `D` / right arrow: move right.
  - `S` / down arrow: move down.
  - `W` / up arrow: jump up.
  - `Q`: diagonal jump up-left.
  - `E`: diagonal jump up-right.
- Clicking dice selects a die for single-die spending behavior.
- Clicking nearby tiles inspects hints/sign text.
- Space, Enter, Escape, or clicking a modal closes modal text.

## Map Shape

- Default grid size: 25 columns by 15 rows.
- Canonical row separator: `~`.
- Legacy row separator: `.`.
- Air is represented internally as `.`, but encoded as `A`.
- Rows shorter than 25 cells are padded with air.
- Rows longer than 25 cells are truncated.
- Maps shorter than 15 rows are padded with air rows.

## Map Encoding

Map rows are run-length encoded.

- `P25`: 25 platform tiles.
- `A10`: 10 air tiles.
- `E{a}1`: one exit tile with variant `a`.
- `M{snake}1`: one monster tile with variant `snake`.
- Legacy single-letter variants such as `Ma1` are still accepted by the game decoder.

The editor currently writes brace variants: `T{variant}N`.

## Tile Schema Notes

Common tile fields:

- `solid`: whether the tile blocks movement.
- `gravity`: whether gravity applies inside the tile.
- `moveCost`: default movement cost.
- `insideMoveCost`: movement cost while inside fluid/no-gravity tiles.
- `jumpAllowed`: whether jumping is allowed from/through the tile.
- `hint`: inspect text.
- `deathMessage`: damage/death/status text used by several interactions.
- `svg`: base tile sprite.
- `exit`: marks a tile as an exit.
- `pickupType`: pickup behavior key.
- `pickupMessage`: pickup log text.
- `topDamage`: damage while standing/landing on top.
- `insideDamage`: damage while inside the tile.
- `bounce`: bounce height or bounce behavior.
- `slope`: `left` or `right`.
- `lock`, `monster`, `sign`, `exit`, `platform`, `pickup`, `decor`: variant buckets.

Movement behavior and costs remain data-driven in `tiles2.json`; level routing belongs in `levels.json`; achievement conditions belong in `achievements.json`.

