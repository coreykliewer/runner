import { normalizeTileDefinitions } from "../src/tileCompatibility.js";
import { createNumericMap } from "../src/numericMapCodec.js";

// Generated in memory by the opt-in development server and browser tests only.
export function createEncounterPlaytest(legacyTiles) {
  const registry = structuredClone(normalizeTileDefinitions(legacyTiles).registry);
  registry.settings = { ...registry.settings, dice: { die1: { maximum: 6 }, die2: { maximum: 6 } } };
  const pathId = Math.max(...registry.tiles.map(tile => tile.id)) + 1;
  const creatureId = pathId + 1;
  const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`;
  const attack = (id, order, priority, sum, message) => ({
    id, order, priority,
    trigger: { events: ["after_move"], minDistance: 1, maxDistance: 2,
      distance: "manhattan", position: "any", repeat: "once_per_roll" },
    conditions: [{ type: "sum_comparison", operator: "<=", value: sum }],
    actions: [{ type: "damage", amount: 1, message }]
  });
  registry.tiles.push(
    { id: pathId, name: "Three-time path", definition: { solid: false, gravity: true, moveCostTop: 3, svg: svg("#497fa3") } },
    { id: creatureId, name: "Snapshot sentinel", definition: {
      solid: true, svg: svg("#d35c48"),
      monster: { sentinel: { hp: 9, monsterHit: { dice: 2, sum: 3, damage: 4, messageHit: "Legacy duplicate attack" } } },
      encounterRules: { enabled: true, resolution: "all_matches", rules: [
        attack("earlier-low", 1, 0, 4, "Sentinel's lower-priority attack."),
        attack("second-high", 2, 10, 3, "Sentinel hits for 1: dice total reached 3 or less during your move.")
      ] }
    } }
  );
  registry.nextTileId = creatureId + 1;
  const cells = Array.from({ length: 15 }, () => Array(25).fill(registry.airTileId));
  const variants = Array.from({ length: 15 }, () => Array(25).fill(null));
  cells[2].fill(registry.legacyIdMapping.P);
  cells[1][2] = pathId;
  cells[0][2] = creatureId;
  variants[0][2] = "sentinel";
  const map = createNumericMap({ width: 25, height: 15, cells, variants,
    spawn: { x: 1, y: 1, artTileId: registry.playerArtTileId } });
  return { registry, levels: { schemaVersion: 1, defaultLevel: "encounter-playtest", levels: {
    "encounter-playtest": { id: "encounter-playtest", name: "Development encounter playtest", rollLimit: 2, map }
  } } };
}
