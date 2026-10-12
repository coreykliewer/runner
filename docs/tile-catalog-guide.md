# Runner Studio Tile Catalog Guide

This guide describes the current numeric tile catalog and the workflows exposed by Runner Studio. It is written as a working reference for both human authors and AI assistants editing this repository.

## Canonical Data

- `tiles2.json` is the single active tile catalog. It uses `runner.numeric-tile-registry` version 1.
- `levels.json` is the active level document. Numeric maps store tile IDs in `cells`, per-cell variant keys in a parallel `variants` grid, and player start coordinates in `spawn`.
- `tiles2.legacy.json` and `levels.legacy.json` are preserved recovery/compatibility copies. They are not the active authoring documents.
- Numeric tile IDs are stable. Deleting a tile retires its ID; the allocator does not reuse it.
- The active catalog currently contains 19 tiles, IDs 1 through 19:

| ID | Name | Editor category |
| --- | --- | --- |
| 1 | Air | Environmental |
| 2 | Bounce | Environmental |
| 3 | Corpse | Item |
| 4 | Diamond | Item |
| 5 | Exit | Interactive |
| 6 | Fog | Environmental |
| 7 | Heart | Item |
| 8 | Sign | Interactive |
| 9 | Lock | Interactive |
| 10 | Lava | Environmental |
| 11 | Monster | Interactive |
| 12 | Platform | Environmental |
| 13 | Runner | Item |
| 14 | Spike | Environmental |
| 15 | Turbo | Interactive |
| 16 | Water | Environmental |
| 17 | Tile X | Uncategorized |
| 18 | Slope down right | Environmental |
| 19 | Slope down left | Environmental |

The registry roles currently point to Air ID 1, Runner artwork ID 13, and defeated-monster replacement ID 3. Roles are catalog-wide metadata, not per-tile properties.

Each tile record has a stable `id`, a display `name`, an optional editor-only `category`, an optional legacy alias, and a `definition` object. The definition holds runtime properties, SVG artwork, variants, and any custom JSON fields. Editor categories (`Environmental`, `Item`, `Interactive`) only organize authoring; they do not affect gameplay.

## Studio Layout

All disclosure panels start collapsed. Expand only the area being edited.

- **Top toolbar:** Open loads content, Validate runs diagnostics, Preview opens the selected map or level in gameplay, Save writes the active document, Export downloads a copy without marking it saved.
- **Content navigation:** Switches the active document. In the numeric tile catalog, use search and category filtering to locate tiles and variant entries.
- **Workspace:** Shows the tile catalog and artwork preview for tile documents, or the map canvas and palette for map/level documents. Tile preview background, zoom, and grid controls affect only the preview.
- **Entry actions:** Add creates an entry appropriate to the active document. For numeric tiles, Duplicate clones the selected base tile into a newly allocated ID. Delete opens a dependency check.
- **Inspector / Properties:** Edits the selected document entry. For a base numeric tile, it contains the Tile Builder sections described below.
- **Registry Roles:** A separate collapsible panel shown for the numeric tile registry. It assigns the Air tile, Runner artwork tile, and defeated-monster replacement tile.
- **Diagnostics / Validation:** A collapsible validation summary and issue list. Errors block Save; warnings require confirmation.

## Tile Builder Sections

### Identity

Shows the stable numeric ID (read-only), editable tile name, and editor category. A tile's ID is its map identity; changing its name does not change maps that use it.

### Appearance

Edits the tile's `svg` artwork source. Import an SVG file or edit the SVG source. The workspace preview validates and renders safe artwork. The preview controls are not gameplay properties. Use **Discard artwork changes** to discard uncommitted artwork edits when that control is available.

### Capabilities

Contains grouped, supported gameplay properties. A property marked “Runtime default (not stored)” is currently omitted from JSON; add it only when the tile needs an explicit override. “Remove override” deletes the stored property and returns it to runtime fallback behavior.

Capability groups:

- **Collision:** `solid` blocks ordinary movement when true; `fallDamageCancel` controls fall damage on landing. They are separately editable. Collision no longer has a source-copy picker.
- **Movement:** `moveCost`, `moveCostTop`, `moveCostInside`, and compatibility alias `insideMoveCost` control movement-point costs. More specific fields take precedence over the shared fallback.
- **Physics:** `gravity`, `bounce`, `slope`, fall-damage threshold/multiplier, and advanced physics fields. `jumpAllowed`, `sinkSpeed`, `riseSpeed`, and `autoPush` are retained, but the current editor metadata marks them as having no confirmed gameplay effect.
- **Damage and Hazards:** `insideDamage` and `topDamage` describe damage while inside or on top of a tile.
- **Items and Rewards:** `pickupType`, `effects`, `grantStats`, and `tags` define pickup rewards and generic context tags.
- **Text and Messaging:** hints, signs, death/pickup messages, and message-log settings.

The **Add Property** disclosure searches supported properties, shows their category, type, runtime status, and description, and adds the selected property's initial value. Adding a property creates an explicit value; it does not guarantee that an unconfirmed field has gameplay behavior.

Movement and other eligible capability groups have a source picker and **Copy settings** action. Copy applies only that group's explicit properties from the selected source tile. It is a one-time copy, not inheritance. Properties omitted on the source are removed from the target and revert to runtime defaults; unrelated capabilities are unchanged.

### Variants

Lists the selected tile's discovered variant entries. Selecting an entry in the list navigates to that variant for editing. A base tile with no variants shows an empty-state message. The section does not contain a dedicated “Add Variant” button; see [Variant Workflows](#variant-workflows).

### Advanced

Contains custom JSON properties not represented by the supported property controls. Unknown fields are preserved when editing. The nested JSON editor can add objects, arrays, and key/value properties. Use this area for variant buckets and runtime fields that have no dedicated control, and validate after changing them.

When editing a variant, the inspector identifies its bucket and key. Variant properties can override base-tile properties; omitted properties inherit from the base tile. The inspector labels explicit, inherited, and runtime-default values. A variant-specific override can be removed to inherit the base value again.

## Add, Duplicate, Edit, and Delete Tiles

### Add

1. Select the numeric tile catalog in Content navigation.
2. Choose **Add numeric tile**.
3. Enter a descriptive name. Studio allocates the next stable numeric ID and starts with an empty definition.
4. Set the editor category in Identity, add only needed properties in Capabilities, and add artwork in Appearance.
5. Review Diagnostics and Save.

### Duplicate

1. Select a base tile, not one of its variant entries.
2. Choose **Duplicate**.
3. Studio clones the tile data into a new tile with a newly allocated ID. Review the copied name, properties, variants, category, and artwork before saving.

### Edit

Select a base tile or one of its variant entries, expand the relevant section, and edit the displayed controls. Changes mark the document unsaved. Editing the name/category does not modify gameplay behavior unless a gameplay property is also changed.

### Delete

Select a tile or variant entry and choose **Delete**. Studio checks map cells, registry roles, and supported references. Resolve blocking references before deletion. Deleting a base tile retires its numeric ID permanently. Deleting a variant removes that variant entry; map cells that still reference the same tile ID and variant key block the deletion.

## Variant Workflows

### Data Model

Variant definitions live under a bucket in the tile definition. Current bucket names include `monster`, `lock`, `sign`, `exit`, `platform`, `pickup`, `decor`, and `narrative`. Data can be stored in the legacy-compatible top-level bucket form, such as `definition.monster`, or the nested form `definition.variants.monster`.

Numeric maps store each cell's tile ID in `cells[y][x]` and its optional variant key in `variants[y][x]`. The key is a sanitized string (lowercase letters/numbers plus `_` or `-`, up to 12 characters). The map cell's tile ID chooses the tile; its variant key chooses that tile's matching variant definition/artwork.

### Add a Variant

There is no dedicated variant-creation button. Add a variant through Advanced custom JSON:

1. Select the base tile and expand **Advanced** and **Advanced and custom JSON**.
2. If the needed bucket does not exist, use **Add key and value** to add it as an object, for example `monster` with type `Object`.
3. In that bucket, add a child property whose key is the desired variant key, such as `snake`, and set its value to an object.
4. Add the variant's fields to that object. For example, a monster variant may include `name`, `hp`, `playerHit`, `monsterHit`, messages, and `svg`; a lock variant may include dice-rule fields, messages, and `svg`.
5. Validate and Save. The new variant appears as a separate catalog entry under its base tile.

Use the current schema/runtime and validation definitions when authoring bucket-specific fields; arbitrary JSON can be preserved even when the editor does not know its gameplay meaning.

### Edit a Variant

1. Select the variant entry beneath its base tile in the catalog.
2. Expand Identity, Appearance, Capabilities, or Advanced as appropriate.
3. Edit explicit fields. Remove an override to inherit the base tile's value.
4. Validate and Save.

### Remove a Variant

1. Select the variant entry in the catalog.
2. Choose **Delete** and review the dependency dialog.
3. If map cells still use this tile ID and variant key, repaint them with another tile/variant or clear their brush variant first. Then retry deletion.

### Place a Variant on a Map

1. Open a numeric map or select a level map.
2. Select the tile ID in the palette.
3. Enter its variant key in **Brush variant**. The field is sanitized as typed.
4. Paint cells. The key is stored in the map's parallel `variants` grid.
5. To remove a cell's variant, clear **Brush variant** and repaint that cell with the intended tile. Shift-click or right-click picks a cell's tile and variant into the brush.

Use the same tile ID with different keys when cells should use different definitions from that tile's bucket. Use separate tile IDs when each entity should be a separately named/selectable tile.

## Current Monster and Lock State

The current catalog still stores monster and lock behavior in variant buckets: Lock ID 9 has keys `a` through `d`; Monster ID 11 includes a Snake entry under its `monster` bucket. Runtime combat/lock lookup still reads the map cell's variant key. They have not yet been converted to standalone per-monster/per-lock tile definitions.

The current design direction from the user is to make monsters and locks separate tiles rather than require variants for them. This is a requested future change, not an implemented schema/runtime migration. Until that change is explicitly carried through the editor, runtime, maps, validation, tests, and docs, preserve the existing format and its compatibility behavior. Other uses such as exit destinations and variant-specific signs may still benefit from variants.

## Save, Export, and Recovery

- Save first runs validation. Errors block saving; warnings prompt for confirmation.
- With a permitted file handle, Save writes the active file. A denied write downloads a uniquely named copy, clears the stale handle, and states that the original was not overwritten. The document remains unsaved until the downloaded copy is opened/selected and saved successfully.
- Export downloads a copy but does not mark the document saved.
- Check the status beside the toolbar for “Unsaved changes” versus “All changes saved.” Do not assume a downloaded export replaced `tiles2.json`.
- If the active catalog is empty or malformed, recovery can rebuild it from `tiles2.legacy.json`. Verify Diagnostics and Save the repaired active catalog deliberately.

## ChatGPT Context and Editing Rules

When continuing work on this project, treat the following as repository facts:

1. The active tile source is `tiles2.json`; active numeric maps are in `levels.json`. The `.legacy.json` files are recovery/compatibility copies.
2. Never reuse or renumber tile IDs. Prefer the existing Studio helpers and tests over hand-editing IDs or maps.
3. A map's numeric cell ID and its optional variant key are separate data. Preserve both when migrating or editing maps.
4. Tile categories are editor-only. Check runtime reads before claiming a property has an effect; the metadata distinguishes active, compatibility, and unconfirmed fields.
5. Tile deletion can affect maps, registry roles, and other definitions. Use the dependency checks and validate after changes.
6. The user prefers all disclosure sections collapsed initially. Collision properties are edited directly; the Collision source-copy picker was removed, while other capability-copy controls remain.
7. The user prefers monsters and locks to become separate tiles rather than rely on variants. This migration is not implemented yet; maintain current compatibility until implementing it end to end.
8. Validation snapshot for 2026-10-12: `npm run check` stops at `validates migrated game content and preserves the legacy source backups` (84/85 unit tests pass); the failing equality compares the active numeric registry against legacy backup data. `npm run smoke` passes (2/2). The last reported focused Playwright run had one catalog-card overflow failure at `tests/editor-studio.browser.spec.js:218`; SVG editing and numeric tile CRUD passed. The separately started full browser run did not return a final summary in captured output. Rerun the suites before reporting them as passing, and do not rewrite catalog/backups just to hide the equality failure.

## Source Files

- `tiles2.json`: active numeric catalog and current tile definitions.
- `levels.json`: active maps, tile IDs, variant grids, and spawn coordinates.
- `editor.html`: Studio shell, toolbar, map brush controls, Registry Roles, and Diagnostics.
- `src/editor/studio.js`: selection, tile/map CRUD, variant entry navigation, dependencies, save/export, and role controls.
- `src/editor/tilePropertyEditor.js`: Tile Builder sections, supported property editing, capability copy, and variant links.
- `src/tileProperties.js`: supported property metadata, capability groups, defaults, and gameplay-status labels.
- `src/shared/variants.js`: variant buckets, key sanitization, and resolution helpers.
- `src/numericTileRegistry.js`, `src/numericMapCodec.js`, `src/validation.js`: registry/map formats and validation.
- `game.js`, `src/gameMapRuntime.js`: runtime tile behavior and map adaptation.
- `tests/editor-studio.browser.spec.js`, `tests/numeric-gameplay.browser.spec.js`: primary Studio and numeric gameplay browser coverage.