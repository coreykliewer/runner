export const TILE_REGISTRY_FORMAT = "runner.numeric-tile-registry";
export const TILE_REGISTRY_VERSION = 1;
export const FIRST_TILE_ID = 1;

export function isNumericTileRegistry(value) {
  return isPlainObject(value) &&
    value.format === TILE_REGISTRY_FORMAT &&
    value.version === TILE_REGISTRY_VERSION &&
    Array.isArray(value.tiles);
}

export function createDeterministicLegacyIdMapping(legacyCodes, {
  firstId = FIRST_TILE_ID,
  existingMapping = {}
} = {}) {
  if (!Number.isSafeInteger(firstId) || firstId < FIRST_TILE_ID) {
    throw new Error("firstId must be a positive safe integer.");
  }
  if (!isPlainObject(existingMapping)) throw new Error("existingMapping must be an object.");

  const mapping = {};
  const usedIds = new Set();
  let highestId = firstId - 1;

  for (const [legacyCode, id] of Object.entries(existingMapping)) {
    validateLegacyCode(legacyCode);
    validateTileId(id, `existingMapping.${legacyCode}`);
    if (usedIds.has(id)) throw new Error(`Numeric tile ID ${id} is assigned more than once.`);
    mapping[legacyCode] = id;
    usedIds.add(id);
    highestId = Math.max(highestId, id);
  }

  let nextId = Math.max(firstId, highestId + 1);
  for (const legacyCode of [...new Set(legacyCodes)].sort()) {
    validateLegacyCode(legacyCode);
    if (Object.hasOwn(mapping, legacyCode)) continue;
    while (usedIds.has(nextId)) nextId++;
    if (!Number.isSafeInteger(nextId)) throw new Error("Numeric tile ID space is exhausted.");
    mapping[legacyCode] = nextId;
    usedIds.add(nextId);
    nextId++;
  }

  return mapping;
}

export function migrateLegacyTileDefinitions(legacyDefinitions, {
  mapping = null,
  firstId = FIRST_TILE_ID,
  nextTileId = null,
  metadata = {}
} = {}) {
  if (!isPlainObject(legacyDefinitions)) throw new Error("Legacy tile definitions must be an object.");
  if (!isPlainObject(metadata)) throw new Error("Registry metadata must be an object.");

  const legacyCodes = Object.keys(legacyDefinitions);
  const legacyIdMapping = mapping || createDeterministicLegacyIdMapping(legacyCodes, { firstId });
  for (const code of legacyCodes) {
    if (!Object.hasOwn(legacyIdMapping, code)) throw new Error(`No numeric ID was assigned for legacy tile '${code}'.`);
  }

  const tiles = legacyCodes.map(legacyCode => {
    const definition = legacyDefinitions[legacyCode];
    if (!isPlainObject(definition)) throw new Error(`Legacy tile '${legacyCode}' must be an object.`);
    const id = legacyIdMapping[legacyCode];
    validateTileId(id, `mapping.${legacyCode}`);
    return {
      id,
      name: getDisplayName(definition, legacyCode),
      legacyCode,
      definition: cloneJson(definition)
    };
  }).sort((left, right) => left.id - right.id);

  const maximumId = tiles.reduce((maximum, tile) => Math.max(maximum, tile.id), FIRST_TILE_ID - 1);
  const highestMappedId = Object.values(legacyIdMapping).reduce((maximum, id) => Math.max(maximum, id), FIRST_TILE_ID - 1);
  const minimumNextId = Math.max(maximumId, highestMappedId) + 1;
  const registryNextId = nextTileId == null ? minimumNextId : nextTileId;
  if (!Number.isSafeInteger(registryNextId) || registryNextId < minimumNextId) {
    throw new Error(`nextTileId must be a positive safe integer greater than every active or reserved ID (${minimumNextId - 1}).`);
  }

  const registry = {
    ...cloneJson(metadata),
    format: TILE_REGISTRY_FORMAT,
    version: TILE_REGISTRY_VERSION,
    nextTileId: registryNextId,
    legacyIdMapping: cloneJson(legacyIdMapping),
    airTileId: metadata.airTileId ?? legacyIdMapping["."],
    ...(metadata.playerArtTileId == null && legacyIdMapping.R == null
      ? {}
      : { playerArtTileId: metadata.playerArtTileId ?? legacyIdMapping.R }),
    ...(metadata.defeatedMonsterTileId == null
      ? (() => {
        const defeatedCode = legacyCodes.find(code => legacyDefinitions[code]?.pickupType === "dead");
        return defeatedCode == null ? {} : { defeatedMonsterTileId: legacyIdMapping[defeatedCode] };
      })()
      : { defeatedMonsterTileId: metadata.defeatedMonsterTileId }),
    tiles
  };
  assertNumericTileRegistry(registry);
  return registry;
}

export function createEmptyNumericTileRegistry() {
  return {
    format: TILE_REGISTRY_FORMAT,
    version: TILE_REGISTRY_VERSION,
    nextTileId: 2,
    airTileId: 1,
    tiles: [{
      id: 1,
      name: "Air",
      definition: { air: true, solid: false, gravity: true }
    }]
  };
}

export function validateNumericTileRegistry(registry) {
  const issues = [];
  if (!isPlainObject(registry) || registry.format !== TILE_REGISTRY_FORMAT) {
    return [{ severity: "error", path: "format", message: `Registry format must be '${TILE_REGISTRY_FORMAT}'.` }];
  }
  if (registry.version !== TILE_REGISTRY_VERSION) {
    issues.push({ severity: "error", path: "version", message: `Unsupported tile registry version '${registry.version}'.` });
  }
  if (!Array.isArray(registry.tiles)) {
    issues.push({ severity: "error", path: "tiles", message: "tiles must be an array." });
    return issues;
  }

  const seenIds = new Set();
  const seenLegacyCodes = new Set();
  let maximumId = FIRST_TILE_ID - 1;
  if (registry.legacyIdMapping != null) {
    if (!isPlainObject(registry.legacyIdMapping)) {
      issues.push({ severity: "error", path: "legacyIdMapping", message: "legacyIdMapping must be an object." });
    } else {
      const mappedIds = new Set();
      for (const [legacyCode, id] of Object.entries(registry.legacyIdMapping)) {
        try {
          validateLegacyCode(legacyCode);
          validateTileId(id, `legacyIdMapping.${legacyCode}`);
          if (mappedIds.has(id)) {
            issues.push({ severity: "error", path: `legacyIdMapping.${legacyCode}`, message: `Numeric tile ID ${id} is assigned more than once.` });
          }
          mappedIds.add(id);
          maximumId = Math.max(maximumId, id);
        } catch (error) {
          issues.push({ severity: "error", path: `legacyIdMapping.${legacyCode}`, message: error.message });
        }
      }
    }
  }
  for (const [index, tile] of registry.tiles.entries()) {
    const path = `tiles[${index}]`;
    if (!isPlainObject(tile)) {
      issues.push({ severity: "error", path, message: "Tile registry entry must be an object." });
      continue;
    }
    if (!Number.isSafeInteger(tile.id) || tile.id < FIRST_TILE_ID) {
      issues.push({ severity: "error", path: `${path}.id`, message: "Tile ID must be a positive safe integer." });
    } else {
      if (seenIds.has(tile.id)) issues.push({ severity: "error", path: `${path}.id`, message: `Tile ID ${tile.id} is duplicated.` });
      seenIds.add(tile.id);
      maximumId = Math.max(maximumId, tile.id);
    }
    const reservedLegacyCode = isPlainObject(registry.legacyIdMapping)
      ? Object.entries(registry.legacyIdMapping).find(([, mappedId]) => mappedId === tile.id)?.[0]
      : null;
    if (reservedLegacyCode && tile.legacyCode !== reservedLegacyCode) {
      issues.push({ severity: "error", path: `${path}.id`, message: `Tile ID ${tile.id} is reserved for legacy code '${reservedLegacyCode}'.` });
    }
    if (typeof tile.name !== "string" || !tile.name.trim()) {
      issues.push({ severity: "error", path: `${path}.name`, message: "Tile name is required." });
    }
    if (!isPlainObject(tile.definition)) {
      issues.push({ severity: "error", path: `${path}.definition`, message: "Tile definition must be an object." });
    }
    if (tile.legacyCode != null) {
      try {
        validateLegacyCode(tile.legacyCode);
        if (seenLegacyCodes.has(tile.legacyCode)) {
          issues.push({ severity: "error", path: `${path}.legacyCode`, message: `Legacy code '${tile.legacyCode}' is duplicated.` });
        }
        seenLegacyCodes.add(tile.legacyCode);
        if (isPlainObject(registry.legacyIdMapping) && registry.legacyIdMapping[tile.legacyCode] !== tile.id) {
          issues.push({ severity: "error", path: `${path}.legacyCode`, message: "legacyCode does not match legacyIdMapping." });
        }
      } catch (error) {
        issues.push({ severity: "error", path: `${path}.legacyCode`, message: error.message });
      }
    }
  }

  for (const [index, tile] of registry.tiles.entries()) {
    const monsterGroups = [tile.definition?.monster, tile.definition?.variants?.monster];
    for (const group of monsterGroups) {
      if (!isPlainObject(group)) continue;
      for (const [variant, monster] of Object.entries(group)) {
        if (monster?.defeatedTileId != null && (!Number.isSafeInteger(monster.defeatedTileId) || !seenIds.has(monster.defeatedTileId))) {
          issues.push({ severity: "error", path: `tiles[${index}].definition.monster.${variant}.defeatedTileId`, message: "defeatedTileId must reference an active tile ID." });
        }
      }
    }
  }

  if (!Number.isSafeInteger(registry.nextTileId) || registry.nextTileId <= maximumId) {
    issues.push({ severity: "error", path: "nextTileId", message: `nextTileId must be a safe integer greater than the maximum tile ID (${maximumId}).` });
  }
  for (const field of ["airTileId", "playerArtTileId", "defeatedMonsterTileId"]) {
    if (registry[field] == null) continue;
    if (!Number.isSafeInteger(registry[field]) || !seenIds.has(registry[field])) {
      issues.push({ severity: "error", path: field, message: `${field} must reference an active tile ID.` });
    }
  }
  for (const [field, property] of [["airTileId", "air"], ["playerArtTileId", "playerArt"]]) {
    const marked = registry.tiles.filter(tile => tile?.definition?.[property] === true);
    if (registry[field] == null && marked.length > 1) {
      issues.push({ severity: "error", path: field, message: `More than one tile declares ${property}: true; set ${field} explicitly.` });
    }
  }
  return issues;
}

export function assertNumericTileRegistry(registry) {
  const issues = validateNumericTileRegistry(registry);
  if (issues.length) {
    const error = new Error(issues.map(item => `${item.path}: ${item.message}`).join("; "));
    error.issues = issues;
    throw error;
  }
  return registry;
}

export function allocateTileId(registry) {
  assertNumericTileRegistry(registry);
  const maximumId = registry.tiles.reduce((maximum, tile) => Math.max(maximum, tile.id), FIRST_TILE_ID - 1);
  const id = Math.max(registry.nextTileId, maximumId + 1);
  if (!Number.isSafeInteger(id + 1)) throw new Error("Numeric tile ID space is exhausted.");
  return {
    id,
    registry: { ...cloneJson(registry), nextTileId: id + 1 }
  };
}

export function addNumericTile(registry, { name, definition = {}, legacyCode = null } = {}) {
  assertNumericTileRegistry(registry);
  if (typeof name !== "string" || !name.trim()) throw new Error("Tile name is required.");
  if (!isPlainObject(definition)) throw new Error("Tile definition must be an object.");
  if (legacyCode != null) validateLegacyCode(legacyCode);
  if (legacyCode != null && (registry.tiles.some(tile => tile.legacyCode === legacyCode) || registry.legacyIdMapping?.[legacyCode] != null)) {
    throw new Error(`Legacy code '${legacyCode}' is already assigned.`);
  }

  const allocated = allocateTileId(registry);
  const legacyIdMapping = getLegacyIdMapping(registry);
  if (legacyCode != null) legacyIdMapping[legacyCode] = allocated.id;
  const nextRegistry = {
    ...allocated.registry,
    legacyIdMapping,
    tiles: [...cloneJson(registry.tiles), {
      id: allocated.id,
      name: name.trim(),
      ...(legacyCode == null ? {} : { legacyCode }),
      definition: cloneJson(definition)
    }]
  };
  assertNumericTileRegistry(nextRegistry);
  return { id: allocated.id, registry: nextRegistry };
}

export function removeNumericTile(registry, id) {
  assertNumericTileRegistry(registry);
  validateTileId(id, "id");
  if (!registry.tiles.some(tile => tile.id === id)) throw new Error(`Tile ID ${id} does not exist.`);
  const nextRegistry = {
    ...cloneJson(registry),
    tiles: registry.tiles.filter(tile => tile.id !== id).map(tile => cloneJson(tile))
  };
  assertNumericTileRegistry(nextRegistry);
  return nextRegistry;
}

export function normalizeTileRegistry(value, options = {}) {
  let registry;
  let sourceFormat;
  if (isNumericTileRegistry(value)) {
    assertNumericTileRegistry(value);
    registry = cloneJson(value);
    sourceFormat = "numeric";
  } else {
    if (isPlainObject(value) && Object.hasOwn(value, "format")) {
      throw new Error(`Unsupported tile registry format '${value.format}'.`);
    }
    registry = migrateLegacyTileDefinitions(value, options);
    sourceFormat = "legacy";
  }

  const definitionsById = new Map(registry.tiles.map(tile => [tile.id, tile]));
  const idsByLegacyCode = new Map(registry.tiles
    .filter(tile => tile.legacyCode != null)
    .map(tile => [tile.legacyCode, tile.id]));
  const airTileId = registry.airTileId ?? registry.tiles.find(tile => tile.definition.air === true)?.id ?? idsByLegacyCode.get(".");
  const playerArtTileId = registry.playerArtTileId ?? registry.tiles.find(tile => tile.definition.playerArt === true)?.id ?? idsByLegacyCode.get("R");
  return { registry, sourceFormat, definitionsById, idsByLegacyCode, airTileId, playerArtTileId };
}

export function toLegacyTileDefinitions(normalizedRegistry, { requireLegacyCode = false } = {}) {
  const normalized = normalizedRegistry?.definitionsById instanceof Map
    ? normalizedRegistry
    : normalizeTileRegistry(normalizedRegistry);
  const definitions = {};
  const unprojectedIds = [];

  for (const tile of normalized.registry.tiles) {
    if (tile.legacyCode == null) {
      unprojectedIds.push(tile.id);
      continue;
    }
    if (Object.hasOwn(definitions, tile.legacyCode)) throw new Error(`Legacy code '${tile.legacyCode}' is assigned more than once.`);
    definitions[tile.legacyCode] = cloneJson(tile.definition);
  }
  if (requireLegacyCode && unprojectedIds.length) {
    throw new Error(`The legacy gameplay adapter cannot project tile IDs without legacyCode: ${unprojectedIds.join(", ")}.`);
  }
  return { definitions, unprojectedIds };
}

function getDisplayName(definition, legacyCode) {
  const candidate = definition.displayName ?? definition.name;
  return typeof candidate === "string" && candidate.trim() ? candidate : `Tile ${legacyCode}`;
}

function validateLegacyCode(code) {
  if (typeof code !== "string" || !/^[A-Za-z.]$/.test(code)) {
    throw new Error(`Legacy code '${code}' must be one ASCII letter or '.'.`);
  }
}

function validateTileId(id, path) {
  if (!Number.isSafeInteger(id) || id < FIRST_TILE_ID) {
    throw new Error(`${path} must be a positive safe integer.`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getLegacyIdMapping(registry) {
  if (registry.legacyIdMapping) return cloneJson(registry.legacyIdMapping);
  return Object.fromEntries(registry.tiles
    .filter(tile => tile.legacyCode != null)
    .map(tile => [tile.legacyCode, tile.id]));
}

export function duplicateNumericTile(registry, id, { name = null } = {}) {
  assertNumericTileRegistry(registry);
  validateTileId(id, "id");
  const original = registry.tiles.find(tile => tile.id === id);
  if (!original) throw new Error(`Tile ID ${id} does not exist.`);
  const allocated = allocateTileId(registry);
  const duplicate = {
    ...cloneJson(original),
    id: allocated.id,
    name: typeof name === "string" && name.trim() ? name.trim() : `${original.name} copy`
  };
  delete duplicate.legacyCode;
  const nextRegistry = {
    ...allocated.registry,
    tiles: [...cloneJson(registry.tiles), duplicate]
  };
  assertNumericTileRegistry(nextRegistry);
  return { id: allocated.id, registry: nextRegistry };
}