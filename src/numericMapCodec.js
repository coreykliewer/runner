import { sanitizeVariant } from "./shared/variants.js";

export const NUMERIC_MAP_FORMAT = "runner.numeric-map";
export const NUMERIC_MAP_VERSION = 1;

export function createNumericMap({ cells, variants = null, width, height, ...metadata } = {}) {
  const map = {
    ...cloneJson(metadata),
    format: NUMERIC_MAP_FORMAT,
    version: NUMERIC_MAP_VERSION,
    width,
    height,
    cells: cloneJson(cells),
    variants: variants == null ? createEmptyVariants(width, height) : cloneJson(variants)
  };
  return decodeNumericMap(map);
}

export function detectMapFormat(value) {
  if (typeof value === "string") return "legacy-rle-v1";
  if (isPlainObject(value) && value.format === NUMERIC_MAP_FORMAT && value.version === NUMERIC_MAP_VERSION) {
    return "numeric-json-grid-v1";
  }
  if (isPlainObject(value) && value.format === NUMERIC_MAP_FORMAT) {
    throw new Error(`Unsupported numeric map version '${value.version}'.`);
  }
  throw new Error("Map format must be a legacy map string or a versioned numeric JSON grid.");
}

export function isNumericMapDocument(value) {
  try {
    return detectMapFormat(value) === "numeric-json-grid-v1";
  } catch {
    return false;
  }
}

export function decodeNumericMap(value) {
  if (detectMapFormat(value) !== "numeric-json-grid-v1") {
    throw new Error("Expected a versioned numeric JSON-grid map object.");
  }
  const map = cloneJson(value);
  const issues = validateNumericMap(map);
  if (issues.length) {
    const error = new Error(issues.map(item => `${item.path}: ${item.message}`).join("; "));
    error.issues = issues;
    throw error;
  }
  if (map.variants == null) map.variants = createEmptyVariants(map.width, map.height);
  return map;
}

export function encodeNumericMap(value) {
  return decodeNumericMap(value);
}

export function validateNumericMap(map) {
  const issues = [];
  if (!isPlainObject(map) || map.format !== NUMERIC_MAP_FORMAT) {
    return [{ severity: "error", path: "format", message: `Map format must be '${NUMERIC_MAP_FORMAT}'.` }];
  }
  if (map.version !== NUMERIC_MAP_VERSION) {
    issues.push({ severity: "error", path: "version", message: `Unsupported numeric map version '${map.version}'.` });
  }
  if (!Number.isSafeInteger(map.width) || map.width < 1) {
    issues.push({ severity: "error", path: "width", message: "width must be a positive safe integer." });
  }
  if (!Number.isSafeInteger(map.height) || map.height < 1) {
    issues.push({ severity: "error", path: "height", message: "height must be a positive safe integer." });
  }
  if (!Array.isArray(map.cells)) {
    issues.push({ severity: "error", path: "cells", message: "cells must be a two-dimensional array." });
  } else if (Number.isSafeInteger(map.height) && map.cells.length !== map.height) {
    issues.push({ severity: "error", path: "cells", message: "cell row count must match height." });
  }
  if (Array.isArray(map.cells)) {
    for (const [y, row] of map.cells.entries()) {
      if (!Array.isArray(row)) {
        issues.push({ severity: "error", path: `cells[${y}]`, message: "Each cell row must be an array." });
        continue;
      }
      if (Number.isSafeInteger(map.width) && row.length !== map.width) {
        issues.push({ severity: "error", path: `cells[${y}]`, message: "Cell column count must match width." });
      }
      for (const [x, id] of row.entries()) {
        if (!Number.isSafeInteger(id) || id < 1) {
          issues.push({ severity: "error", path: `cells[${y}][${x}]`, message: "Tile ID must be a positive safe integer." });
        }
      }
    }
  }

  if (map.variants != null) {
    if (!Array.isArray(map.variants)) {
      issues.push({ severity: "error", path: "variants", message: "variants must be a two-dimensional array." });
    } else {
      if (Number.isSafeInteger(map.height) && map.variants.length !== map.height) {
        issues.push({ severity: "error", path: "variants", message: "variant row count must match height." });
      }
      for (const [y, row] of map.variants.entries()) {
        if (!Array.isArray(row)) {
          issues.push({ severity: "error", path: `variants[${y}]`, message: "Each variant row must be an array." });
          continue;
        }
        if (Number.isSafeInteger(map.width) && row.length !== map.width) {
          issues.push({ severity: "error", path: `variants[${y}]`, message: "Variant column count must match width." });
        }
        for (const [x, variant] of row.entries()) {
          if (variant != null && typeof variant !== "string") {
            issues.push({ severity: "error", path: `variants[${y}][${x}]`, message: "Cell variant must be a string or null." });
          } else if (variant != null && sanitizeVariant(variant) !== variant) {
            issues.push({ severity: "error", path: `variants[${y}][${x}]`, message: "Cell variant must be sanitized." });
          }
        }
      }
    }
  }
  if (map.spawn != null) {
    if (!isPlainObject(map.spawn)) {
      issues.push({ severity: "error", path: "spawn", message: "spawn must be an object with x and y coordinates." });
    } else {
      if (!Number.isSafeInteger(map.spawn.x) || map.spawn.x < 0 || map.spawn.x >= map.width) {
        issues.push({ severity: "error", path: "spawn.x", message: "spawn.x must be within the map width." });
      }
      if (!Number.isSafeInteger(map.spawn.y) || map.spawn.y < 0 || map.spawn.y >= map.height) {
        issues.push({ severity: "error", path: "spawn.y", message: "spawn.y must be within the map height." });
      }
      if (map.spawn.artTileId != null && (!Number.isSafeInteger(map.spawn.artTileId) || map.spawn.artTileId < 1)) {
        issues.push({ severity: "error", path: "spawn.artTileId", message: "spawn.artTileId must be a positive safe integer." });
      }
    }
  }
  return issues;
}

function createEmptyVariants(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return [];
  return Array.from({ length: height }, () => Array(width).fill(null));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}