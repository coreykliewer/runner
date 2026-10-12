# Numeric Tile Compatibility Foundation

Numeric tile/map formats, compatibility adapters, and numeric-ID gameplay dispatch are active. `tiles2.json` is the one active numeric registry, and shipped level maps use numeric JSON grids. The original letter catalog and maps remain exact backups for recovery and legacy import.

## Numeric Tile Registry

The registry format is `runner.numeric-tile-registry`, version `1`:

```json
{
  "format": "runner.numeric-tile-registry",
  "version": 1,
  "nextTileId": 105,
  "airTileId": 1,
  "playerArtTileId": 2,
  "defeatedMonsterTileId": 3,
  "legacyIdMapping": {
    "P": 1,
    "R": 2
  },
  "tiles": [
    {
      "id": 1,
      "name": "Air",
      "legacyCode": ".",
      "definition": {
        "air": true,
        "solid": false,
        "gravity": true,
        "futureProperty": { "preserved": true }
      }
    },
    {
      "id": 2,
      "name": "Runner artwork",
      "legacyCode": "R",
      "definition": { "playerArt": true, "svg": "<svg>...</svg>" }
    }
  ]
}
```

`id` is a positive safe integer. `name` is presentation metadata; all gameplay properties, variants, artwork, and unknown properties remain inside `definition`. `legacyCode` is an optional alias used only to decode legacy map strings and preserve old event/context references. Numeric gameplay does not depend on it. `legacyIdMapping` is a persistent code-to-ID manifest; retaining entries for deleted codes reserves those IDs. `nextTileId` must be greater than every active or reserved ID.

Use `migrateLegacyTileDefinitions()` for a first deterministic mapping. It sorts old keys before assignment. Persist that mapping; do not recompute IDs after migration. `addNumericTile()` allocates at `nextTileId`. `removeNumericTile()` deliberately preserves `nextTileId` and the mapping. These APIs are in [numericTileRegistry.js](../src/numericTileRegistry.js).

The old map alphabet reserves `A` for encoded air. The registry can preserve a legacy `A` definition, but it cannot be addressed through the old map format or projected into old gameplay maps.

## Numeric Map

The JSON-grid format is `runner.numeric-map`, version `1`:

```json
{
  "format": "runner.numeric-map",
  "version": 1,
  "width": 3,
  "height": 1,
  "cells": [[1, 12, 104]],
  "variants": [[null, null, "snake"]],
  "spawn": { "x": 1, "y": 0, "artTileId": 2 }
}
```

`cells` is a rectangular grid of positive numeric tile IDs. `variants` is a same-sized grid of strings or `null`; a null cell has no variant. Numeric gameplay maps require an explicit `spawn` coordinate; `artTileId` is optional and otherwise uses `playerArtTileId`. Additional top-level properties are preserved by `decodeNumericMap()` and `encodeNumericMap()`. See [numericMapCodec.js](../src/numericMapCodec.js).

`detectMapFormat()` does not inspect string contents: strings are the legacy RLE format; objects must carry the explicit numeric format and version. Old URLs continue to use `#map=<legacy>` unchanged. Numeric map URLs use `#mapv=1&map=<JSON>`. `createResumeHash()` preserves old string output and writes that marker only for numeric map objects ([resumeLinks.js](../src/resumeLinks.js)).

## Compatibility Boundary

`normalizeTileDefinitions()` accepts either the old flat catalog or the numeric registry and returns a normalized registry with numeric and legacy-code lookup maps. `decodeMapToNumeric()` migrates a legacy map while preserving per-cell variants; it reports unknown legacy codes instead of inventing definitions. `projectNumericMapToLegacyString()` converts numeric maps only when every referenced ID has a usable `legacyCode`.

The game now stores numeric IDs in its live map grid. Legacy strings are decoded into numeric IDs by `decodeMapForRuntime()`, and legacy `R` spawn markers are converted into explicit spawn coordinates. Numeric maps go directly through the numeric game-map runtime. `game.js` accesses the registry by ID and derives collision, exits, locks, monsters, pickups, hazards, and artwork from each definition and its selected variant. Numeric tiles do not need a `legacyCode` for gameplay.

The adapter still uses `legacyCode` only to decode old map strings, preserve legacy narrative/achievement context fields, and read old embedded exit maps. Unknown legacy cells encountered by the runtime are retained as temporary, empty numeric definitions instead of disappearing. The strict migration function reports them so content conversion can require review.

Registry metadata now supports `airTileId`, `playerArtTileId`, and `defeatedMonsterTileId`. Legacy migration infers them from `.`/`R` and the `pickupType: "dead"` definition. Numeric maps use `spawn: { x, y, artTileId? }`, so the map does not need an `R` tile. Monster variant definitions may specify `defeatedTileId` to override the registry-wide defeated-monster replacement.

The current game canvas remains 25x15. Numeric gameplay maps with other dimensions are rejected instead of being silently truncated or padded. Runner Studio loads and edits the single numeric registry in `tiles2.json` and paints numeric level maps. Legacy catalog JSON remains available from the backup or by explicit import; it is not a second default catalog.

## Current Runtime Behavior

The gameplay grid now stores numeric tile IDs. `tileAt()` returns a numeric ID or `null` at the board boundary; `tileDataAt()` resolves the tile definition and the cell's variant. Out-of-bounds collision remains an engine sentinel, not a registered tile. Rendering, collision, movement costs, hazards, pickups/effects, stat grants, slopes, bounce, and exits read JSON definitions.

Special interaction dispatch is property-driven:

- A solid tile with a matching `lock` variant uses that variant's dice rule.
- A solid tile with a matching `monster` variant uses that variant's combat data and per-cell HP.
- `exit: true` marks any tile ID as an exit; the cell variant still selects the level route.
- The defeated-monster destination is `monster.<variant>.defeatedTileId`, falling back to registry `defeatedMonsterTileId`, then to air.
- The runner start position comes from numeric map `spawn: { x, y, artTileId? }`; legacy R markers are extracted by the adapter.
- Air is `airTileId`; it is no longer encoded as a gameplay letter in the numeric grid.
- SVGs and variant SVGs are prepared by iterating definitions and variant buckets; rendering selects the current cell's variant image before the base image.

New registry metadata fields are `airTileId`, `playerArtTileId`, and `defeatedMonsterTileId`. The `air` and `playerArt` properties can identify those roles during registry normalization. A monster variant may add `defeatedTileId`. Numeric maps require `spawn`; old string maps do not.

Narrative events now match optional numeric `trigger.tileId`; the old `trigger.tile` path remains supported using `legacyCode` aliases where available. Achievement contexts include numeric `tileId` while retaining legacy `ch` where an alias exists. Existing state version/key and carry-stat encoding are unchanged. `world.mapHash` remains a string (numeric map documents are JSON-stringified there); old `#map=` string links still load, while numeric custom-map links require `mapv=1`.

Studio edits the one numeric registry in `tiles2.json`; there is no separate active numeric registry file. `levels.json` contains numeric maps. The migration utility is `scripts/migrate-numeric-content.mjs`; it previews by default and only writes with `--apply`. The exact pre-migration files are `tiles2.legacy.json` and `levels.legacy.json`.

The conversion was explicitly applied. Runtime readers continue to support old maps and links; do not overwrite the preserved backups. The editor saves through a selected file handle when permitted and falls back to a JSON download if the browser denies write access.

## Migration Maintenance

1. Use the migration utility in preview mode before applying it to another content set; it reports unresolved map cells or missing spawn markers.
2. Keep the preserved legacy backups. Conversion uses the shared decoder so variants stay aligned with cells.
3. Keep gameplay dispatch property-driven; tile identity must not imply behavior.
4. Keep dual map readers for old links and imported content. New writers should emit explicit versioned numeric maps.
5. Never compact IDs. Keep deleted IDs reserved in the mapping and allocate only at or above `nextTileId`.

The compatibility tests use the current `tiles2.json`, canonical and embedded level maps, and `fixtures/golden-maps.json`. The stale golden map contains lowercase codes not present in the catalog; strict migration reports these as unresolved, while runtime compatibility preserves them as temporary empty definitions. Browser tests exercise numeric monsters, locks, exits, variants/art, explicit spawn, numeric narrative/achievement references, and existing letter-based gameplay/saves/links.