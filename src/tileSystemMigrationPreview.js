import { createHash } from "node:crypto";
import { decodeMap, DEFAULT_COLS, DEFAULT_ROWS } from "./shared/mapCodec.js";
import {
  LEVEL_SET_VERSION_V1,
  NUMERIC_MAP_VERSION_V1,
  TILE_CATEGORIES_V2,
  TILE_REGISTRY_VERSION_V1,
  validateLevelSetDocument,
  validateRegistryDocument
} from "./tileSystemV2.js";

const UUID_NAMESPACE = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
const LEGACY_CATEGORY_MAP = {
  Environmental: "Environment",
  Item: "Items",
  Interactive: "Interactables"
};

const DEFINITION_GROUPS = {
  traversal: ["solid", "gravity", "moveCost", "moveCostTop", "moveCostInside", "insideMoveCost", "bounce", "slope", "fallDamageCancel", "jumpAllowed", "sinkSpeed", "riseSpeed", "autoPush"],
  hazards: ["insideDamage", "topDamage", "fallDamageThreshold", "fallDamageMultiplier"],
  itemRewardCandidates: ["pickupType", "effects", "grantStats", "tags"],
  rules: ["encounterRules"],
  presentation: ["hint", "signMessage", "signHtml", "deathMessage", "pickupMessage", "logKind", "logHtml"],
  legacyVariants: ["monster", "lock", "sign", "exit", "platform", "pickup", "decor", "narrative", "variants"],
  exits: ["exit", "default"]
};
const KNOWN_V1_FIELDS = new Set(Object.values(DEFINITION_GROUPS).flat().concat(["svg", "fog", "air", "playerArt", "a", "b"]));

export function previewAuthoredMigrationV1ToV2(registry, levelSet, { manifest = null, sourceKey = "active-authored-content" } = {}) {
  const diagnostics = [
    ...validateRegistryDocument(registry),
    ...validateLevelSetDocument(levelSet, registry)
  ].map(issue => ({ ...issue }));

  if (registry?.version !== TILE_REGISTRY_VERSION_V1) {
    diagnostics.push({ severity: "error", path: "registry.version", message: "Preview source must be numeric tile registry v1." });
  }
  if (levelSet?.schemaVersion !== LEVEL_SET_VERSION_V1) {
    diagnostics.push({ severity: "error", path: "levels.schemaVersion", message: "Preview source must be level-set schema v1." });
  }

  const tilesById = new Map((registry?.tiles || []).map(tile => [tile.id, tile]));
  const tilePlans = (registry?.tiles || []).map(tile => previewTile(tile));
  for (const plan of tilePlans) {
    if (plan.category?.requiresReview) diagnostics.push({ severity: "warning", path: `tiles[id=${plan.id}].category`, message: `Category '${plan.category.source}' needs mapping to one of the seven approved categories.` });
  }
  const levelPlans = [];
  const proposedLevels = {};

  for (const [levelKey, level] of Object.entries(levelSet?.levels || {})) {
    const map = level?.map;
    const prepared = prepareMapV2Candidate(map, registry, levelKey, diagnostics);
    if (!prepared) {
      levelPlans.push({ levelKey, sourceMapVersion: typeof map === "string" ? "legacy-rle-v1" : map?.version ?? null, placementCandidates: [], proposedMap: null });
      proposedLevels[levelKey] = cloneJson(level);
      continue;
    }
    const sourceMap = prepared.map;
    const variantGrid = sourceMap.variants;
    const placementCandidates = [];
    const instanceIds = Array.from({ length: sourceMap.height }, () => Array(sourceMap.width).fill(null));
    for (const [y, row] of sourceMap.cells.entries()) {
      if (!Array.isArray(row)) continue;
      for (const [x, tileId] of row.entries()) {
        const tile = tilesById.get(tileId);
        if (!tile || !isStatefulOrRewardSource(tile, variantGrid[y]?.[x])) continue;
        const variant = variantGrid[y]?.[x] ?? null;
        const assignmentKey = [sourceKey, levelKey, x, y, tileId, variant ?? ""].join("|");
        const manifestedId = manifest?.assignments?.[assignmentKey];
        const instanceId = isUuid(manifestedId) ? manifestedId : uuidV5(assignmentKey);
        instanceIds[y][x] = instanceId;
        if (manifestedId != null && !isUuid(manifestedId)) {
          diagnostics.push({ severity: "warning", path: `manifest.assignments.${assignmentKey}`, message: "Invalid manifest UUID; deterministic candidate UUID is shown." });
        }
        placementCandidates.push({ x, y, tileId, variant, instanceId, assignmentKey, fromManifest: isUuid(manifestedId) });
        reportLegacyVariant(tile, variant, `${levelKey}.map.cells[${y}][${x}]`, diagnostics);
      }
    }

    const proposedMap = {
      ...prepared.metadata,
      format: "runner.numeric-map",
      version: 2,
      width: sourceMap.width,
      height: sourceMap.height,
      cells: cloneJson(sourceMap.cells),
      variants: cloneJson(variantGrid),
      instanceIds,
      ...(sourceMap.spawn ? { spawn: cloneJson(sourceMap.spawn) } : {})
    };
    proposedLevels[levelKey] = { ...cloneJson(level), map: proposedMap };
    levelPlans.push({
      levelKey,
      sourceMapVersion: prepared.sourceVersion,
      width: sourceMap.width,
      height: sourceMap.height,
      preservedVariantCells: variantGrid.flat().filter(value => value != null).length,
      spawn: cloneJson(sourceMap.spawn ?? null),
      diceCapacities: cloneJson(level.diceCapacities ?? null),
      placementCandidates,
      proposedMap
    });
  }

  diagnostics.sort((left, right) => left.path.localeCompare(right.path) || left.message.localeCompare(right.message));
  return {
    format: "runner.tile-system-migration-preview",
    version: 1,
    writesPerformed: false,
    source: {
      registry: { format: registry?.format ?? null, version: registry?.version ?? null },
      levels: { schemaVersion: levelSet?.schemaVersion ?? null },
      sourceKey
    },
    target: {
      registryVersion: 2,
      levelSetSchemaVersion: 2,
      numericMapVersion: 2
    },
    summary: {
      errorCount: diagnostics.filter(issue => issue.severity === "error").length,
      warningCount: diagnostics.filter(issue => issue.severity === "warning").length,
      candidateMapCount: levelPlans.filter(level => level.proposedMap).length,
      placementCount: levelPlans.reduce((total, level) => total + level.placementCandidates.length, 0)
    },
    registry: {
      tileCount: tilePlans.length,
      minimumNextTileId: Math.max(registry?.nextTileId || 1, ...tilePlans.map(tile => (tile.id || 0) + 1)),
      tilePlans
    },
    levels: levelPlans,
    proposedLevelSet: {
      ...cloneJson(levelSet),
      schemaVersion: 2,
      levels: proposedLevels
    },
    diagnostics
  };
}

function previewTile(tile) {
  const definition = tile.definition || {};
  const groups = {};
  for (const [group, fields] of Object.entries(DEFINITION_GROUPS)) {
    const present = fields.filter(field => Object.hasOwn(definition, field));
    if (present.length) groups[group] = Object.fromEntries(present.map(field => [field, cloneJson(definition[field])]));
  }
  const variantBuckets = {};
  const variantData = {};
  for (const bucket of DEFINITION_GROUPS.legacyVariants) {
    const group = bucket === "variants" ? definition.variants : definition[bucket];
    if (isPlainObject(group)) {
      variantBuckets[bucket] = Object.keys(group).sort();
      variantData[bucket] = cloneJson(group);
    }
  }
  const unknownDefinitionKeys = Object.keys(definition).filter(key => !KNOWN_V1_FIELDS.has(key)).sort();
  const category = tile.category == null ? null : (LEGACY_CATEGORY_MAP[tile.category] || tile.category);
  const categoryValid = category == null || TILE_CATEGORIES_V2.includes(category);
  const reviewReasons = [];
  if (variantBuckets.monster || variantBuckets.lock) reviewReasons.push("legacy monster/lock rules need author review before conversion");
  if (["pickupType", "effects", "grantStats"].some(key => Object.hasOwn(definition, key))) reviewReasons.push("legacy reward data needs reusable Item-ID mapping");
  if (unknownDefinitionKeys.length) reviewReasons.push("unknown definition fields must be preserved as extensions");
  if (!categoryValid) reviewReasons.push("source category has no approved v2 category mapping");
  return {
    id: tile.id,
    idPreserved: true,
    name: tile.name,
    category: tile.category == null ? null : { source: tile.category, proposed: category, requiresReview: !categoryValid },
    artwork: typeof definition.svg === "string" ? { svg: definition.svg } : null,
    capabilityFieldCandidates: groups,
    legacyVariantBuckets: variantBuckets,
    legacyVariantData: variantData,
    unknownDefinitionKeys,
    unknownDefinitionProperties: Object.fromEntries(unknownDefinitionKeys.map(key => [key, cloneJson(definition[key])])),
    reviewReasons
  };
}

function isStatefulOrRewardSource(tile, variant) {
  const definition = tile.definition || {};
  const variantKey = typeof variant === "string" ? variant : null;
  const hasConfiguredVariant = variantKey && ["monster", "lock"].some(bucket => {
    const group = definition[bucket] || definition.variants?.[bucket];
    return isPlainObject(group) && Object.hasOwn(group, variantKey);
  });
  return Boolean(hasConfiguredVariant || definition.pickupType || definition.effects?.length || definition.grantStats || definition.encounterRules);
}

function prepareMapV2Candidate(map, registry, levelKey, diagnostics) {
  if (typeof map === "string") return prepareLegacyMap(map, registry, levelKey, diagnostics);
  if (!map || map.version !== NUMERIC_MAP_VERSION_V1 || !Array.isArray(map.cells)) return null;
  const variants = Array.isArray(map.variants)
    ? cloneJson(map.variants)
    : Array.from({ length: map.height }, () => Array(map.width).fill(null));
  return {
    sourceVersion: NUMERIC_MAP_VERSION_V1,
    map: { ...map, variants },
    metadata: Object.fromEntries(Object.entries(map).filter(([key]) => !["format", "version", "width", "height", "cells", "variants", "spawn"].includes(key)))
  };
}

function prepareLegacyMap(encoded, registry, levelKey, diagnostics) {
  const decoded = decodeMap(encoded, { rows: DEFAULT_ROWS, cols: DEFAULT_COLS });
  const cells = [];
  const variants = [];
  let spawn = null;
  const mapping = registry?.legacyIdMapping || {};
  for (let y = 0; y < DEFAULT_ROWS; y++) {
    const cellRow = [];
    const variantRow = [];
    for (let x = 0; x < DEFAULT_COLS; x++) {
      const code = decoded.tiles[y][x];
      let id = mapping[code];
      if (id == null) {
        diagnostics.push({ severity: "error", path: `${levelKey}.map[${y}][${x}]`, message: `Legacy tile code '${code}' has no numeric registry mapping.` });
        cellRow.push(null);
        variantRow.push(decoded.variants[y][x] || null);
        continue;
      }
      if (id === registry.playerArtTileId) {
        if (spawn) diagnostics.push({ severity: "error", path: `${levelKey}.map[${y}][${x}]`, message: "Legacy map contains multiple Runner spawn markers." });
        else spawn = { x, y, artTileId: id };
        id = registry.airTileId;
      }
      if (!Number.isSafeInteger(id) || id < 1) {
        diagnostics.push({ severity: "error", path: `${levelKey}.map[${y}][${x}]`, message: "Legacy map conversion requires a valid airTileId for the Runner spawn marker." });
        cellRow.push(null);
      } else cellRow.push(id);
      variantRow.push(id === registry.airTileId ? null : decoded.variants[y][x] || null);
    }
    cells.push(cellRow);
    variants.push(variantRow);
  }
  if (!spawn) diagnostics.push({ severity: "error", path: `${levelKey}.map`, message: "Legacy map has no Runner spawn marker." });
  return {
    sourceVersion: "legacy-rle-v1",
    map: { width: DEFAULT_COLS, height: DEFAULT_ROWS, cells, variants, ...(spawn ? { spawn } : {}) },
    metadata: {}
  };
}

function reportLegacyVariant(tile, variant, path, diagnostics) {
  if (!variant) return;
  const definition = tile.definition || {};
  for (const bucket of ["monster", "lock"]) {
    const group = definition[bucket] || definition.variants?.[bucket];
    if (isPlainObject(group) && !Object.hasOwn(group, variant)) {
      diagnostics.push({ severity: "warning", path, message: `Variant '${variant}' has no matching ${bucket} entry; author review is required.` });
    }
  }
}

function uuidV5(value) {
  const digest = createHash("sha1").update(UUID_NAMESPACE).update(String(value), "utf8").digest().subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}