import { decodeMap, encodeMap, DEFAULT_COLS, DEFAULT_ROWS } from "./shared/mapCodec.js";
import {
  assertNumericTileRegistry,
  normalizeTileRegistry,
  toLegacyTileDefinitions
} from "./numericTileRegistry.js";
import { createNumericMap, decodeNumericMap, detectMapFormat } from "./numericMapCodec.js";

export { detectMapFormat } from "./numericMapCodec.js";

export function isNumericMapDocument(value) {
  try {
    return detectMapFormat(value) === "numeric-json-grid-v1";
  } catch {
    return false;
  }
}

export function normalizeTileDefinitions(value, options = {}) {
  return normalizeTileRegistry(value, options);
}

export function decodeMapToNumeric(value, normalizedRegistry, {
  rows = DEFAULT_ROWS,
  cols = DEFAULT_COLS
} = {}) {
  const registry = getNormalizedRegistry(normalizedRegistry);
  const format = detectMapFormat(value);
  if (format === "numeric-json-grid-v1") {
    const map = decodeNumericMap(value);
    const issues = validateMapTileReferences(map, registry);
    if (issues.length) throw createIssuesError(issues);
    if (map.width !== cols || map.height !== rows) {
      throw new Error(`The current gameplay engine requires ${cols}x${rows} maps; received ${map.width}x${map.height}.`);
    }
    return map;
  }

  return decodeLegacyMapToNumeric(value, registry, { rows, cols, preserveUnknown: false });
}

export function decodeMapForRuntime(value, normalizedRegistry, {
  rows = DEFAULT_ROWS,
  cols = DEFAULT_COLS
} = {}) {
  const registry = getNormalizedRegistry(normalizedRegistry);
  if (detectMapFormat(value) === "numeric-json-grid-v1") {
    const map = decodeNumericMap(value);
    if (map.width !== cols || map.height !== rows) {
      throw new Error(`The current gameplay engine requires ${cols}x${rows} maps; received ${map.width}x${map.height}.`);
    }
    if (!map.spawn) throw new Error("Numeric gameplay maps require explicit spawn coordinates.");
    const issues = validateMapTileReferences(map, registry);
    if (issues.length) throw createIssuesError(issues);
    return map;
  }
  return decodeLegacyMapToNumeric(value, registry, { rows, cols, preserveUnknown: true });
}

export function getAirTileId(normalizedRegistry) {
  const registry = getNormalizedRegistry(normalizedRegistry);
  if (registry.airTileId == null) throw new Error("Tile registry does not identify air; set airTileId or definition.air=true.");
  return registry.airTileId;
}

function decodeLegacyMapToNumeric(value, registry, { rows, cols, preserveUnknown }) {

  const decoded = decodeMap(value, { rows, cols });
  const cells = [];
  const variants = [];
  const issues = [];
  let spawn = null;
  for (let y = 0; y < rows; y++) {
    const cellRow = [];
    const variantRow = [];
    for (let x = 0; x < cols; x++) {
      const legacyCode = decoded.tiles[y][x];
      let id = registry.idsByLegacyCode.get(legacyCode);
      if (id == null) {
        if (preserveUnknown) {
          id = addUnmappedLegacyTile(registry, legacyCode);
        } else {
          issues.push({
            severity: "error",
            path: `map[${y}][${x}]`,
            message: `Legacy tile code '${legacyCode}' has no numeric registry mapping.`
          });
          cellRow.push(null);
          variantRow.push(decoded.variants[y][x] || null);
          continue;
        }
      }

      if (id === registry.playerArtTileId) {
        if (registry.airTileId == null) {
          issues.push({ severity: "error", path: `map[${y}][${x}]`, message: "Legacy spawn marker requires airTileId." });
        } else {
          spawn = { x, y, artTileId: id };
          id = registry.airTileId;
          cellRow.push(id);
          variantRow.push(null);
          continue;
        }
      }
      cellRow.push(id);
      variantRow.push(decoded.variants[y][x] || null);
    }
    cells.push(cellRow);
    variants.push(variantRow);
  }
  if (issues.length) throw createIssuesError(issues);
  return createNumericMap({
    width: cols,
    height: rows,
    cells,
    variants,
    ...(spawn ? { spawn } : {}),
    sourceFormat: "legacy-rle-v1"
  });
}

function addUnmappedLegacyTile(registry, legacyCode) {
  const existingId = registry.idsByLegacyCode.get(legacyCode);
  if (existingId != null) return existingId;
  let id = registry.registry.nextTileId;
  while (registry.definitionsById.has(id)) id++;
  if (!Number.isSafeInteger(id + 1)) throw new Error("Numeric tile ID space is exhausted while preserving an unknown legacy tile.");
  const tile = { id, name: `Unmapped legacy tile ${legacyCode}`, legacyCode, definition: {} };
  registry.registry.tiles.push(tile);
  registry.registry.legacyIdMapping ||= {};
  registry.registry.legacyIdMapping[legacyCode] = id;
  registry.registry.nextTileId = id + 1;
  registry.definitionsById.set(id, tile);
  registry.idsByLegacyCode.set(legacyCode, id);
  return id;
}

export function projectNumericMapToLegacyString(value, normalizedRegistry) {
  const registry = getNormalizedRegistry(normalizedRegistry);
  const map = decodeNumericMap(value);
  if (map.width !== DEFAULT_COLS || map.height !== DEFAULT_ROWS) {
    throw new Error(`The current gameplay engine requires ${DEFAULT_COLS}x${DEFAULT_ROWS} maps; received ${map.width}x${map.height}.`);
  }
  const issues = validateMapTileReferences(map, registry);
  if (issues.length) throw createIssuesError(issues);

  const tiles = [];
  for (let y = 0; y < map.height; y++) {
    const row = [];
    for (let x = 0; x < map.width; x++) {
      const id = map.cells[y][x];
      const tile = registry.definitionsById.get(id);
      if (tile.legacyCode == null) {
        issues.push({ severity: "error", path: `cells[${y}][${x}]`, message: `Tile ID ${id} has no legacyCode for the current gameplay engine.` });
        row.push(".");
      } else if (tile.legacyCode === "A") {
        issues.push({ severity: "error", path: `cells[${y}][${x}]`, message: "Legacy code 'A' is reserved for air and cannot be projected into a legacy map." });
        row.push(".");
      } else {
        row.push(tile.legacyCode);
      }
    }
    tiles.push(row);
  }
  if (issues.length) throw createIssuesError(issues);

  if (map.spawn) {
    const artTileId = map.spawn.artTileId ?? registry.playerArtTileId;
    const spawnTile = registry.definitionsById.get(artTileId);
    if (!spawnTile?.legacyCode || spawnTile.legacyCode === "A") {
      throw new Error(`Spawn art tile ID ${artTileId} has no usable legacyCode.`);
    }
    if (map.cells[map.spawn.y][map.spawn.x] !== registry.airTileId) {
      throw new Error("A spawn on a non-air cell cannot be projected to a legacy map without losing terrain.");
    }
    tiles[map.spawn.y][map.spawn.x] = spawnTile.legacyCode;
  }

  return encodeMap(tiles, map.variants, { rows: map.height, cols: map.width });
}

export function projectTileRegistryToLegacy(normalizedRegistry, { requireLegacyCode = false } = {}) {
  const registry = getNormalizedRegistry(normalizedRegistry);
  return toLegacyTileDefinitions(registry, { requireLegacyCode });
}

export function validateMapTileReferences(value, normalizedRegistry) {
  const registry = getNormalizedRegistry(normalizedRegistry);
  const map = decodeNumericMap(value);
  const issues = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const id = map.cells[y][x];
      if (!registry.definitionsById.has(id)) {
        issues.push({ severity: "error", path: `cells[${y}][${x}]`, message: `Tile ID ${id} does not exist in the registry.` });
      }
    }
  }
  if (map.spawn?.artTileId != null && !registry.definitionsById.has(map.spawn.artTileId)) {
    issues.push({ severity: "error", path: "spawn.artTileId", message: `Tile ID ${map.spawn.artTileId} does not exist in the registry.` });
  }
  return issues;
}

export function assertNumericTileRegistryForCompatibility(registry) {
  return assertNumericTileRegistry(registry);
}

function getNormalizedRegistry(value) {
  if (value?.definitionsById instanceof Map && value?.idsByLegacyCode instanceof Map) return value;
  return normalizeTileRegistry(value);
}

function createIssuesError(issues) {
  const error = new Error(issues.map(item => `${item.path}: ${item.message}`).join("; "));
  error.issues = issues;
  return error;
}