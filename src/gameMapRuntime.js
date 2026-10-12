import { decodeMap as decodeSharedMap, DEFAULT_COLS, DEFAULT_ROWS } from "./shared/mapCodec.js";

export function decodeGameMap(encoded, {
  tiles = {},
  rows = DEFAULT_ROWS,
  cols = DEFAULT_COLS
} = {}) {
  const decoded = decodeSharedMap(encoded, { rows, cols });
  const grid = [];
  const signVariantMap = [];
  const monsterStateMap = [];
  const bounceHeight = [];
  const sinkDelayMap = [];

  for (let y = 0; y < rows; y++) {
    const gridRow = [];
    const variantRow = [];
    const monsterRow = [];

    for (let x = 0; x < cols; x++) {
      const tile = decoded.tiles[y][x] || ".";
      const variant = decoded.variants[y][x] || null;

      gridRow.push(tile);
      variantRow.push(variant);
      monsterRow.push(getInitialMonsterHp(tile, variant, tiles));
    }

    grid.push(gridRow);
    signVariantMap.push(variantRow);
    monsterStateMap.push(monsterRow);
    bounceHeight.push(Array(cols).fill(0));
    sinkDelayMap.push(Array(cols).fill(null));
  }

  return {
    grid,
    signVariantMap,
    monsterStateMap,
    bounceHeight,
    sinkDelayMap
  };
}

export function buildNumericGameMap(map, normalizedRegistry) {
  const registry = normalizedRegistry?.definitionsById instanceof Map
    ? normalizedRegistry
    : normalizedRegistry;
  const grid = map.cells.map(row => row.slice());
  const signVariantMap = map.variants.map(row => row.slice());
  const monsterStateMap = [];
  const bounceHeight = [];
  const sinkDelayMap = [];

  for (let y = 0; y < map.height; y++) {
    const monsterRow = [];
    for (let x = 0; x < map.width; x++) {
      const tile = registry.definitionsById.get(grid[y][x]);
      const variant = signVariantMap[y][x];
      const monsterVariant = getVariantGroup(tile?.definition, "monster")?.[variant];
      const monsterGroup = getVariantGroup(tile?.definition, "monster");
      monsterRow.push(monsterGroup ? (monsterVariant?.hp ?? 1) : null);
    }
    monsterStateMap.push(monsterRow);
    bounceHeight.push(Array(map.width).fill(0));
    sinkDelayMap.push(Array(map.width).fill(null));
  }

  return {
    grid,
    signVariantMap,
    monsterStateMap,
    bounceHeight,
    sinkDelayMap,
    spawn: map.spawn || null
  };
}

function getInitialMonsterHp(tile, variant, tiles) {
  const definition = tiles?.[tile];
  const monsterGroup = getVariantGroup(definition, "monster");
  if (!monsterGroup) return null;
  const monster = monsterGroup[variant];
  return monster?.hp ?? 1;
}

function getVariantGroup(definition, bucket) {
  const nested = definition?.variants?.[bucket];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  const legacy = definition?.[bucket];
  return legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy : null;
}
