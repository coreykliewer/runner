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

function getInitialMonsterHp(tile, variant, tiles) {
  if (tile !== "M") return null;
  return tiles?.M?.monster?.[variant]?.hp ?? 1;
}
