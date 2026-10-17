import { normalizeTileDefinitions } from "../src/tileCompatibility.js";
import { createNumericMap } from "../src/numericMapCodec.js";

// Browser-test content only. Production catalogs and levels are never changed.
export function createPropertyPlaytest(legacy, fixtures, { layout = "walk" } = {}) {
  const registry = structuredClone(normalizeTileDefinitions(legacy).registry);
  const ids = {};
  for (const [name, definition] of Object.entries(fixtures.tiles)) {
    const id = registry.nextTileId++;
    ids[name] = id;
    registry.tiles.push({ id, name: `Property fixture ${name}`, definition: {
      solid: false, gravity: true, moveCost: 1, fallDamageCancel: true,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#5588aa"/></svg>',
      ...structuredClone(definition)
    } });
  }
  const cells = Array.from({ length: 15 }, () => Array(25).fill(registry.airTileId));
  const variants = Array.from({ length: 15 }, () => Array(25).fill(null));
  cells[2].fill(registry.legacyIdMapping.P);
  cells[1][0] = registry.legacyIdMapping.P;
  ["Water", "Air", "Air", "Fire"].forEach((name, index) => { cells[1][index + 2] = ids[name]; });
  const exit = registry.tiles.find(tile => tile.definition.exit === true);
  cells[1][6] = exit.id;
  variants[1][6] = "next";
  if (layout === "gravity") {
    cells[2][2] = ids.Water;
    cells[3][2] = ids.Air;
    cells[4][2] = ids.Fire;
    cells[5].fill(registry.legacyIdMapping.P);
    cells[1][2] = registry.airTileId;
  }
  if (layout === "bounce") cells[0][1] = ids.Water;
  const map = createNumericMap({ width: 25, height: 15, cells, variants,
    spawn: { x: 1, y: 1, artTileId: registry.playerArtTileId } });
  const destination = structuredClone(map);
  destination.cells[1][1] = ids.Fire; // Restoring at spawn must not count as an entry.
  return { registry, ids, levels: { schemaVersion: 1, defaultLevel: "properties", levels: {
    properties: { map, exits: { next: "destination" } }, destination: { map: destination }
  } } };
}
