import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { decodeMap } from "../src/shared/mapCodec.js";
import {
  addNumericTile,
  createDeterministicLegacyIdMapping,
  migrateLegacyTileDefinitions,
  normalizeTileRegistry,
  removeNumericTile,
  toLegacyTileDefinitions,
  validateNumericTileRegistry
} from "../src/numericTileRegistry.js";
import {
  createNumericMap,
  decodeNumericMap,
  detectMapFormat,
  encodeNumericMap
} from "../src/numericMapCodec.js";
import {
  decodeMapForRuntime,
  decodeMapToNumeric,
  normalizeTileDefinitions,
  projectNumericMapToLegacyString,
  projectTileRegistryToLegacy,
  validateMapTileReferences
} from "../src/tileCompatibility.js";
import { validateLevels } from "../src/validation.js";

describe("numeric tile compatibility foundation", () => {
  it("validates migrated game content and preserves the legacy source backups", async () => {
    const [registry, levels, legacyTiles, tileBackup, levelBackup] = await Promise.all([
      readFile("tiles2.json", "utf8").then(JSON.parse),
      readFile("levels.json", "utf8").then(JSON.parse),
      readFile("tiles2.legacy.json", "utf8").then(JSON.parse),
      readFile("tiles2.legacy.json", "utf8").then(JSON.parse),
      readFile("levels.legacy.json", "utf8").then(JSON.parse)
    ]);

    assert.deepEqual(tileBackup, legacyTiles);
    const legacyProjection = projectTileRegistryToLegacy(normalizeTileDefinitions(registry));
    const projected = legacyProjection.definitions;
    assert.deepEqual(legacyProjection.unprojectedIds, registry.tiles.filter(tile => tile.legacyCode == null).map(tile => tile.id));
    assert.equal(projected.K.fallDamageCancel, false);
    assert.equal(projected.K.moveCost, 1);
    delete projected.K.fallDamageCancel;
    delete projected.K.moveCost;
    assert.deepEqual(projected, legacyTiles);
    assert.deepEqual(validateNumericTileRegistry(registry), []);
    assert.equal(validateLevels(levels, registry).filter(issue => issue.severity === "error").length, 0);
    for (const [levelId, level] of Object.entries(levels.levels)) {
      assert.equal(level.map.format, "runner.numeric-map");
      assert.deepEqual(validateMapTileReferences(level.map, registry), []);
      assert.deepEqual(level.map, decodeMapToNumeric(levelBackup.levels[levelId].map, registry));
      assert.ok(level.map.spawn);
      assert.equal(level.map.width, 25);
      assert.equal(level.map.height, 15);
    }
  });

  it("preserves valid authoring categories and reports unsupported category values", () => {
    const registry = migrateLegacyTileDefinitions({ P: { solid: true, futureRule: { keep: true } } });
    registry.tiles[0].category = "Environmental";
    assert.deepEqual(validateNumericTileRegistry(registry), []);
    assert.deepEqual(registry.tiles[0].definition.futureRule, { keep: true });

    registry.tiles[0].category = "Combat";
    assert.equal(validateNumericTileRegistry(registry).some(issue => issue.path === "tiles[0].category"), true);
  });

  it("assigns a deterministic mapping independent of object key order", () => {
    const first = createDeterministicLegacyIdMapping(["Z", "P", ".", "M"]);
    const second = createDeterministicLegacyIdMapping(["M", ".", "Z", "P"]);
    assert.deepEqual(first, second);
    assert.deepEqual(Object.keys(first), [".", "M", "P", "Z"]);
    assert.deepEqual(new Set(Object.values(first)).size, 4);
  });

  it("migrates the current catalog without dropping unknown data, variants, or SVG", async () => {
    const legacy = JSON.parse(await readFile("tiles2.legacy.json", "utf8"));
    legacy.F.futureProperty = { nested: ["preserved"] };
    const registry = migrateLegacyTileDefinitions(legacy);
    const projected = toLegacyTileDefinitions(normalizeTileRegistry(registry), { requireLegacyCode: true });

    assert.deepEqual(projected.definitions, legacy);
    assert.equal(registry.tiles.find(tile => tile.legacyCode === "M").definition.monster.a.svg, legacy.M.monster.a.svg);
    assert.deepEqual(registry.tiles.find(tile => tile.legacyCode === "F").definition.futureProperty, { nested: ["preserved"] });
    assert.deepEqual(validateNumericTileRegistry(registry), []);
  });

  it("allocates stable positive IDs and does not reuse deleted IDs or legacy aliases", () => {
    const registry = migrateLegacyTileDefinitions({ P: { solid: true } });
    const added = addNumericTile(registry, { name: "Water", definition: { gravity: false }, legacyCode: "W" });
    const deleted = removeNumericTile(added.registry, added.id);
    const next = addNumericTile(deleted, { name: "New tile", definition: {} });

    assert.equal(next.id, added.id + 1);
    assert.equal(next.registry.nextTileId, next.id + 1);
    assert.equal(next.registry.legacyIdMapping.W, added.id);
    assert.throws(() => addNumericTile(deleted, { name: "Alias reuse", legacyCode: "W" }), /already assigned/);

    const withRetiredMapping = migrateLegacyTileDefinitions({ P: {} }, {
      mapping: { P: 2, Q: 40 }
    });
    assert.equal(addNumericTile(withRetiredMapping, { name: "After retired ID" }).id, 41);

    const handAuthored = {
      format: "runner.numeric-tile-registry",
      version: 1,
      nextTileId: 8,
      tiles: [{ id: 7, name: "Existing", legacyCode: "P", definition: { solid: true } }]
    };
    const withNewTile = addNumericTile(handAuthored, { name: "Added", legacyCode: "W" });
    assert.deepEqual(withNewTile.registry.legacyIdMapping, { P: 7, W: 8 });
  });

  it("rejects duplicate IDs, invalid IDs, and an allocator counter that can reuse IDs", () => {
    const valid = migrateLegacyTileDefinitions({ P: {} });
    const duplicate = structuredClone(valid);
    duplicate.tiles.push({ ...structuredClone(duplicate.tiles[0]) });
    assert.equal(validateNumericTileRegistry(duplicate).some(issue => issue.path.endsWith(".id")), true);

    const invalidId = structuredClone(valid);
    invalidId.tiles[0].id = 0;
    assert.equal(validateNumericTileRegistry(invalidId).some(issue => issue.path === "tiles[0].id"), true);

    const reusable = structuredClone(valid);
    reusable.nextTileId = 1;
    assert.equal(validateNumericTileRegistry(reusable).some(issue => issue.path === "nextTileId"), true);

    assert.throws(
      () => migrateLegacyTileDefinitions({ P: { air: true }, W: { air: true } }),
      /More than one tile declares air/
    );
  });

  it("detects map format by type and explicit version, not numeric-looking string contents", () => {
    assert.equal(detectMapFormat("12,3|4"), "legacy-rle-v1");
    const numeric = createNumericMap({ width: 2, height: 1, cells: [[12, 3]] });
    assert.equal(detectMapFormat(numeric), "numeric-json-grid-v1");
    assert.throws(() => detectMapFormat({ format: "runner.numeric-map", version: 2 }), /Unsupported numeric map version/);
  });

  it("round-trips multi-digit tile IDs, variants, and unknown map fields", () => {
    const map = createNumericMap({
      width: 3,
      height: 1,
      cells: [[1, 12, 104]],
      variants: [[null, "", "snake"]],
      futureMapField: { keep: true }
    });
    const encoded = encodeNumericMap(map);
    const decoded = decodeNumericMap(JSON.parse(JSON.stringify(encoded)));

    assert.deepEqual(decoded, map);
    assert.deepEqual(decoded.cells[0], [1, 12, 104]);
    assert.deepEqual(decoded.variants[0], [null, "", "snake"]);
    assert.deepEqual(decoded.futureMapField, { keep: true });
  });

  it("checks numeric map dimensions, positive IDs, and per-cell variant types", () => {
    assert.throws(() => createNumericMap({ width: 2, height: 1, cells: [[1, 0]] }), /positive safe integer/);
    assert.throws(() => createNumericMap({ width: 2, height: 1, cells: [[1]] }), /column count must match width/);
    assert.throws(() => createNumericMap({ width: 1, height: 1, cells: [[1]], variants: [[4]] }), /string or null/);
  });

  it("migrates current level and fallback maps and round-trips mapped golden fixtures", async () => {
    const legacyTiles = JSON.parse(await readFile("tiles2.legacy.json", "utf8"));
    const levels = JSON.parse(await readFile("levels.legacy.json", "utf8"));
    const golden = JSON.parse(await readFile("fixtures/golden-maps.json", "utf8"));
    const normalized = normalizeTileDefinitions(legacyTiles);

    for (const legacyMap of [levels.levels.default.map, legacyTiles.E.default]) {
      const numeric = decodeMapToNumeric(legacyMap, normalized);
      const projected = projectNumericMapToLegacyString(numeric, normalized);
      assert.deepEqual(decodeMap(projected), decodeMap(legacyMap));
    }

    let migratedFixtureCount = 0;
    for (const fixture of golden.maps) {
      try {
        const numeric = decodeMapToNumeric(fixture.encoded, normalized, { rows: golden.rows, cols: golden.cols });
        const projected = projectNumericMapToLegacyString(numeric, normalized);
        assert.deepEqual(
          decodeMap(projected, { rows: golden.rows, cols: golden.cols }),
          decodeMap(fixture.encoded, { rows: golden.rows, cols: golden.cols }),
          fixture.id
        );
        migratedFixtureCount++;
      } catch (error) {
        if (fixture.id !== "default-from-tiles2") throw error;
        assert.match(error.message, /Legacy tile code '[abc]'/);
      }
    }
    assert.equal(migratedFixtureCount, 2);
  });

  it("extracts legacy runner markers into explicit spawn data and round-trips them", () => {
    const normalized = normalizeTileDefinitions({
      ".": { solid: false, gravity: true },
      R: { playerArt: true, svg: "<svg/>" },
      P: { solid: true, gravity: true }
    });
    const legacy = "A1R1P3";
    const numeric = decodeMapToNumeric(legacy, normalized, { rows: 1, cols: 5 });

    assert.deepEqual(numeric.spawn, { x: 1, y: 0, artTileId: normalized.playerArtTileId });
    assert.equal(numeric.cells[0][1], normalized.airTileId);
    assert.equal(projectNumericMapToLegacyString(create25x15Map(numeric, normalized.airTileId), normalized).includes("R"), true);
  });

  it("preserves unknown legacy cells in the runtime-only compatibility adapter", () => {
    const normalized = normalizeTileDefinitions({ ".": { solid: false, gravity: true } });
    const runtimeMap = decodeMapForRuntime("b1", normalized, { rows: 1, cols: 1 });
    const unknownId = runtimeMap.cells[0][0];

    assert.equal(typeof unknownId, "number");
    assert.equal(normalized.definitionsById.get(unknownId).legacyCode, "b");
    assert.deepEqual(normalized.definitionsById.get(unknownId).definition, {});
  });

    it("rejects numeric gameplay grids that the current fixed-size engine cannot render", () => {
      const normalized = normalizeTileDefinitions({ ".": { air: true, solid: false } });
      const map = createNumericMap({ width: 1, height: 1, cells: [[normalized.airTileId]], spawn: { x: 0, y: 0 } });
      assert.throws(() => decodeMapForRuntime(map, normalized), /requires 25x15 maps/);
    });

  it("reports unknown numeric map references without silently projecting them", async () => {
    const legacy = JSON.parse(await readFile("tiles2.legacy.json", "utf8"));
    const normalized = normalizeTileDefinitions(legacy);
    const cells = Array.from({ length: 15 }, () => Array(25).fill(normalized.registry.tiles[0].id));
    cells[0][0] = 99999;
    const map = createNumericMap({ width: 25, height: 15, cells });
    assert.equal(validateMapTileReferences(map, normalized)[0].path, "cells[0][0]");
    assert.throws(() => projectNumericMapToLegacyString(map, normalized), /does not exist in the registry/);
  });
});

function create25x15Map(smallMap, airTileId) {
  const cells = Array.from({ length: 15 }, () => Array(25).fill(airTileId));
  const variants = Array.from({ length: 15 }, () => Array(25).fill(null));
  for (let y = 0; y < Math.min(15, smallMap.height); y++) {
    for (let x = 0; x < Math.min(25, smallMap.width); x++) {
      cells[y][x] = smallMap.cells[y][x];
      variants[y][x] = smallMap.variants[y][x];
    }
  }
  return createNumericMap({ width: 25, height: 15, cells, variants, spawn: smallMap.spawn });
}