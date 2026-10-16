import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeLevelSetDocument,
  decodeDiceEventBatch,
  decodeMapDocument,
  decodeRegistryDocument,
  encodeLevelSetDocument,
  encodeDiceEventBatch,
  encodeMapDocument,
  encodeRegistryDocument,
  resolveDiceCapacities,
  resolveDistanceMetric,
  validateDiceEventBatch,
  validatePlayerStateV2,
  validateLevelSetV2,
  validateNumericMapV2,
  validateTileRegistryV2
} from "../src/tileSystemV2.js";
import { previewAuthoredMigrationV1ToV2 } from "../src/tileSystemMigrationPreview.js";
import { decodeResumePayloadV2, encodeResumeStateV2, RESUME_URL_TARGET_BYTES } from "../src/tileSystemV2ResumeCodec.js";

const chestId = "11111111-1111-4111-8111-111111111111";
const ratId = "22222222-2222-4222-8222-222222222222";

function registryV2() {
  return {
    format: "runner.numeric-tile-registry",
    version: 2,
    nextTileId: 5,
    airTileId: 1,
    settings: { dice: { die1: { maximum: 6 }, die2: { maximum: 6 } } },
    tiles: [
      { id: 1, name: "Air", category: "Environment", capabilities: { traversal: { collision: { mode: "passable", shape: "cell" } } } },
      {
        id: 2,
        name: "Chest",
        category: "Interactables",
        capabilities: {
          states: { initial: "closed", definitions: { closed: {}, open: {} }, transitions: [{ from: "closed", to: "open" }] },
          rewards: [{ id: "key-reward", itemId: 3, quantity: 1 }]
        }
      },
      { id: 3, name: "Key", category: "Items", capabilities: { item: { stackable: true, useTimeCost: 0 } } },
      {
        id: 4,
        name: "Creature example",
        category: "Environment",
        capabilities: {
          vitals: { maximumHealth: 3, defense: 0 },
          rules: [{
            id: "strike",
            priority: 10,
            authorOrder: 1,
            trigger: { events: ["die_changed"], relation: { kind: "distance", minimum: 1, maximum: 2, metric: "manhattan" } },
            conditions: [{ type: "dice_sum", operator: "lessThanOrEqual", value: 3 }],
            actions: [{ type: "damage", target: "runner", amount: 1 }],
            activation: { scope: "attacker_per_player_roll" }
          }]
        }
      }
    ],
    unknownRegistryProperty: { preserve: true }
  };
}

function mapV2() {
  return {
    format: "runner.numeric-map",
    version: 2,
    width: 2,
    height: 1,
    cells: [[2, 1]],
    variants: [[null, null]],
    instanceIds: [[chestId, null]],
    spawn: { x: 1, y: 0 },
    unknownMapProperty: "preserved"
  };
}

function v1Sources() {
  const registry = {
    format: "runner.numeric-tile-registry",
    version: 1,
    nextTileId: 4,
    legacyIdMapping: { ".": 1, P: 2, K: 3 },
    tiles: [
      { id: 1, name: "Air", legacyCode: ".", definition: { air: true, solid: false } },
      { id: 2, name: "Heart pickup", category: "Item", legacyCode: "P", definition: { pickupType: "heart", futureField: { keep: true } } },
      { id: 3, name: "Lock", category: "Interactive", legacyCode: "K", definition: { solid: true, lock: { a: { dice: 1, value: 2 } } } }
    ],
    unknownRegistryProperty: ["preserve", 1]
  };
  const levelSet = {
    schemaVersion: 1,
    defaultLevel: "main",
    levels: {
      main: {
        id: "main",
        name: "Test",
        map: {
          format: "runner.numeric-map",
          version: 1,
          width: 2,
          height: 1,
          cells: [[2, 3]],
          variants: [[null, "a"]],
          spawn: { x: 0, y: 0 }
        },
        exits: {}
      }
    },
    unknownLevelsProperty: { preserve: true }
  };
  return { registry, levelSet };
}

describe("Runner Tile System v2 schemas and codecs", () => {
  it("accepts composable capabilities across categories and resolves level dice overrides", () => {
    const registry = registryV2();
    assert.deepEqual(validateTileRegistryV2(registry), []);
    const levels = {
      schemaVersion: 2,
      defaultLevel: "mine",
      levels: { mine: { map: mapV2(), diceCapacities: { die1: 9 } } }
    };
    assert.deepEqual(validateLevelSetV2(levels, registry), []);
    assert.deepEqual(resolveDiceCapacities(registry, levels.levels.mine), { die1: 9, die2: 6 });
    assert.equal(resolveDistanceMetric({ kind: "distance" }), "manhattan");
    assert.equal(resolveDistanceMetric({ kind: "distance", metric: "chebyshev" }), "chebyshev");
  });

  it("rejects invalid capacities, movement/interaction costs, duplicated spatial range, references, and author order", () => {
    const registry = registryV2();
    registry.settings.dice.die1.maximum = 0;
    registry.tiles[0].capabilities.detection = { maximum: 2 };
    registry.tiles[0].capabilities.traversal = { movement: { entryCost: { default: 1.5 } } };
    registry.tiles[1].capabilities.interaction = { timeCost: -1 };
    registry.tiles[1].capabilities.rewards[0].itemId = 999;
    registry.tiles[3].capabilities.rules[0].authorOrder = 0;
    const paths = validateTileRegistryV2(registry).map(issue => issue.path);
    assert.ok(paths.includes("settings.dice.die1.maximum"));
    assert.ok(paths.includes("tiles[0].capabilities.detection"));
    assert.ok(paths.includes("tiles[0].capabilities.traversal.movement.entryCost.default"));
    assert.ok(paths.includes("tiles[1].capabilities.interaction.timeCost"));
    assert.ok(paths.some(path => path.includes("rewards")));
    assert.ok(paths.includes("tiles[3].capabilities.rules[0].authorOrder"));
  });

  it("reports malformed rule and reward containers without throwing", () => {
    const registry = registryV2();
    registry.tiles[1].capabilities.rewards = { id: "not-an-array" };
    registry.tiles[3].capabilities.rules = { id: "not-an-array" };
    assert.doesNotThrow(() => validateTileRegistryV2(registry));
    const paths = validateTileRegistryV2(registry).map(issue => issue.path);
    assert.ok(paths.includes("tiles[1].capabilities.rewards"));
    assert.ok(paths.includes("tiles[3].capabilities.rules"));
  });

  it("validates v2 placement identity grids and requires IDs for stateful placements", () => {
    const registry = registryV2();
    const map = mapV2();
    map.instanceIds[0][0] = null;
    assert.ok(validateNumericMapV2(map, registry).some(issue => issue.path === "map.instanceIds[0][0]"));
    map.instanceIds[0][0] = ratId;
    map.instanceIds[0][1] = ratId;
    assert.ok(validateNumericMapV2(map, registry).some(issue => /duplicated/.test(issue.message)));
  });

  it("validates inventory stacks/instances separately from stats and source-scoped claims", () => {
    const registry = registryV2();
    const playerState = {
      statistics: { score: 15, health: 5 },
      inventory: {
        stacks: [{ itemId: 3, quantity: 2 }],
        instances: [{ instanceId: "key-instance", itemId: 3, charges: 1 }],
        equipment: [{ slot: "hand", itemInstanceId: "key-instance" }]
      }
    };
    assert.deepEqual(validatePlayerStateV2(playerState, registry), []);
    const invalid = structuredClone(playerState);
    invalid.inventory.stacks.push({ itemId: 3, quantity: 1, name: "Copied key name" });
    invalid.inventory.equipment[0].itemInstanceId = "missing-instance";
    const paths = validatePlayerStateV2(invalid, registry).map(issue => issue.path);
    assert.ok(paths.includes("playerState.inventory.stacks[1].itemId"));
    assert.ok(paths.includes("playerState.inventory.stacks[1].name"));
    assert.ok(paths.includes("playerState.inventory.equipment[0].itemInstanceId"));

    const level = {
      map: mapV2(),
      instanceState: { [chestId]: { state: "open" } },
      rewardClaims: [{ instanceId: chestId, rewardId: "key-reward" }]
    };
    const levelSet = { schemaVersion: 2, defaultLevel: "mine", levels: { mine: level } };
    assert.deepEqual(validateLevelSetV2(levelSet, registry), []);
    level.rewardClaims[0].instanceId = ratId;
    assert.ok(validateLevelSetV2(levelSet, registry).some(issue => issue.path.endsWith("rewardClaims[0].instanceId")));
  });

  it("round-trips unknown registry, map, and level properties without mutation", () => {
    const registry = registryV2();
    const map = mapV2();
    const levels = { schemaVersion: 2, defaultLevel: "mine", levels: { mine: { map, diceCapacities: { die2: 8 }, futureLevelData: [1, 2] } }, futureRootData: true };
    assert.deepEqual(encodeRegistryDocument(decodeRegistryDocument(registry)), registry);
    assert.deepEqual(encodeMapDocument(decodeMapDocument(map, registry), registry), map);
    assert.deepEqual(encodeLevelSetDocument(decodeLevelSetDocument(levels, registry), registry), levels);
  });

  it("keeps v1 registry, map, and level documents readable and lossless", () => {
    const { registry, levelSet } = v1Sources();
    const decodedRegistry = decodeRegistryDocument(registry);
    const decodedLevels = decodeLevelSetDocument(levelSet, registry);
    assert.deepEqual(encodeRegistryDocument(decodedRegistry), registry);
    assert.deepEqual(encodeLevelSetDocument(decodedLevels, registry), levelSet);
    assert.equal(decodeMapDocument(levelSet.levels.main.map, registry).version, 1);
  });
});

describe("authored-content migration preview", () => {
  it("is deterministic, reports category/field proposals, preserves variants, and never mutates inputs", () => {
    const { registry, levelSet } = v1Sources();
    const originalRegistry = structuredClone(registry);
    const originalLevels = structuredClone(levelSet);
    const first = previewAuthoredMigrationV1ToV2(registry, levelSet);
    const second = previewAuthoredMigrationV1ToV2(registry, levelSet);

    assert.deepEqual(first, second);
    assert.equal(first.writesPerformed, false);
    assert.deepEqual(registry, originalRegistry);
    assert.deepEqual(levelSet, originalLevels);
    assert.equal(first.registry.tilePlans.find(tile => tile.id === 2).category.proposed, "Items");
    assert.equal(first.registry.tilePlans.find(tile => tile.id === 2).idPreserved, true);
    assert.deepEqual(first.registry.tilePlans.find(tile => tile.id === 2).unknownDefinitionKeys, ["futureField"]);
    assert.deepEqual(first.registry.tilePlans.find(tile => tile.id === 3).legacyVariantBuckets.lock, ["a"]);
    assert.deepEqual(first.registry.tilePlans.find(tile => tile.id === 2).unknownDefinitionProperties, { futureField: { keep: true } });
    assert.deepEqual(first.registry.tilePlans.find(tile => tile.id === 3).legacyVariantData.lock.a, { dice: 1, value: 2 });
    assert.equal(first.registry.tilePlans.find(tile => tile.id === 2).artwork, null);
    const placements = first.levels[0].placementCandidates;
    assert.equal(placements.length, 2);
    assert.equal(placements[0].instanceId, second.levels[0].placementCandidates[0].instanceId);
    assert.notEqual(placements[0].instanceId, placements[1].instanceId);
    assert.match(placements[0].instanceId, /^[0-9a-f-]{36}$/);
    assert.ok(placements.every(placement => placement.fromManifest === false));
    assert.equal(first.levels[0].proposedMap.version, 2);
    assert.deepEqual(first.levels[0].proposedMap.variants, levelSet.levels.main.map.variants);
    assert.equal(first.levels[0].proposedMap.cells[0][1], 3);
    assert.equal(first.levels[0].proposedMap.instanceIds[0][1], placements[1].instanceId);
  });

  it("reuses persisted manifest UUIDs and reports invalid assignments", () => {
    const { registry, levelSet } = v1Sources();
    const first = previewAuthoredMigrationV1ToV2(registry, levelSet);
    const candidate = first.levels[0].placementCandidates[0];
    const manifest = { assignments: { [candidate.assignmentKey]: "33333333-3333-4333-8333-333333333333" } };
    const withManifest = previewAuthoredMigrationV1ToV2(registry, levelSet, { manifest });
    assert.equal(withManifest.levels[0].placementCandidates[0].instanceId, manifest.assignments[candidate.assignmentKey]);
    assert.equal(withManifest.levels[0].placementCandidates[0].fromManifest, true);
    const badManifest = { assignments: { [candidate.assignmentKey]: "not-a-uuid" } };
    assert.ok(previewAuthoredMigrationV1ToV2(registry, levelSet, { manifest: badManifest }).diagnostics.some(issue => issue.severity === "warning"));
  });

  it("previews legacy RLE maps without losing spawn or variant information", () => {
    const registry = {
      format: "runner.numeric-tile-registry",
      version: 1,
      nextTileId: 4,
      legacyIdMapping: { ".": 1, R: 2, P: 3 },
      airTileId: 1,
      playerArtTileId: 2,
      tiles: [
        { id: 1, name: "Air", legacyCode: ".", definition: { air: true } },
        { id: 2, name: "Runner art", legacyCode: "R", definition: { playerArt: true } },
        { id: 3, name: "Pickup", legacyCode: "P", definition: { pickupType: "heart" } }
      ]
    };
    const levelSet = { schemaVersion: 1, defaultLevel: "start", levels: { start: { map: "R1P{a}1" } } };
    const preview = previewAuthoredMigrationV1ToV2(registry, levelSet);
    const proposed = preview.levels[0].proposedMap;
    assert.equal(proposed.version, 2);
    assert.deepEqual(proposed.spawn, { x: 0, y: 0, artTileId: 2 });
    assert.equal(proposed.cells[0][1], 3);
    assert.equal(proposed.variants[0][1], "a");
    assert.ok(proposed.instanceIds[0][1]);
  });

  it("preview CLI writes only its report and refuses apply/write modes", async () => {
    const folder = await mkdtemp(join(tmpdir(), "runner-v2-preview-"));
    try {
      const paths = {
        registry: join(folder, "tiles.json"),
        levels: join(folder, "levels.json")
      };
      const source = v1Sources();
      const registryText = `${JSON.stringify(source.registry, null, 2)}\n`;
      const levelsText = `${JSON.stringify(source.levelSet, null, 2)}\n`;
      await writeFile(paths.registry, registryText);
      await writeFile(paths.levels, levelsText);
      const output = execFileSync(process.execPath, [
        "scripts/preview-tile-system-v2.mjs",
        "--registry", paths.registry,
        "--levels", paths.levels
      ], { encoding: "utf8" });
      assert.equal(JSON.parse(output).writesPerformed, false);
      assert.equal(await readFile(paths.registry, "utf8"), registryText);
      assert.equal(await readFile(paths.levels, "utf8"), levelsText);
      const applyAttempt = spawnSync(process.execPath, ["scripts/preview-tile-system-v2.mjs", "--apply"], { encoding: "utf8" });
      assert.equal(applyAttempt.status, 2);
      assert.match(applyAttempt.stderr, /preview-only/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe("versioned compressed resume codec", () => {
  it("round-trips a compact state in an explicit v2 URL without changing the current hash codec", async () => {
    const state = { statistics: { score: 3 }, inventory: { stacks: [{ itemId: 90005, quantity: 2 }] } };
    const encoded = await encodeResumeStateV2(state, { baseUrl: "https://example.test/game?x=1" });
    assert.equal(encoded.delivery, "url");
    assert.ok(encoded.encodedBytes <= RESUME_URL_TARGET_BYTES);
    const url = new URL(encoded.url);
    const params = new URLSearchParams(url.hash.slice(1));
    assert.equal(params.get("resumev"), "2");
    assert.deepEqual(await decodeResumePayloadV2(params.get("payload")), state);
  });

  it("returns a compressed download payload rather than truncating an oversized URL", async () => {
    const state = { narrative: "story ".repeat(600), inventory: { stacks: [{ itemId: 90005, quantity: 1 }] } };
    const encoded = await encodeResumeStateV2(state, { baseUrl: "game.html", maxUrlLength: 80 });
    assert.equal(encoded.delivery, "download");
    assert.equal(encoded.filename, "runner-resume-v2.json.gz");
    assert.equal(encoded.mimeType, "application/gzip");
    assert.deepEqual(await decodeResumePayloadV2(encoded.bytes), state);
  });
});

describe("versioned dice event batch schema", () => {
  it("preserves selected-first spend snapshots and accepts unchanged reroll events", () => {
    const batch = {
      format: "runner.dice-event-batch",
      version: 1,
      actionId: "spend-1",
      parentActionId: null,
      rollId: "roll-1",
      events: [
        {
          eventId: "spend-1:1", actionId: "spend-1", parentActionId: null, sequence: 1,
          type: "die_changed", die: "die1", operation: "spend",
          before: { die1: 2, die2: 4 }, after: { die1: 0, die2: 4 }, valueChanged: true,
          rollId: "roll-1", source: { kind: "movement" }
        },
        {
          eventId: "spend-1:2", actionId: "spend-1", parentActionId: null, sequence: 2,
          type: "die_changed", die: "die2", operation: "spend",
          before: { die1: 0, die2: 4 }, after: { die1: 0, die2: 3 }, valueChanged: true,
          rollId: "roll-1", source: { kind: "movement" }
        }
      ]
    };
    assert.deepEqual(validateDiceEventBatch(batch), []);
    assert.deepEqual(encodeDiceEventBatch(decodeDiceEventBatch(batch)), batch);
    const reroll = {
      format: "runner.dice-event-batch",
      version: 1,
      actionId: "reroll-1",
      parentActionId: null,
      rollId: "roll-2",
      events: [{
        eventId: "reroll-1:1", actionId: "reroll-1", parentActionId: null, sequence: 1,
        type: "die_rerolled", die: "die1", operation: "reroll",
        before: { die1: 4, die2: 2 }, after: { die1: 4, die2: 2 }, valueChanged: false,
        rollId: "roll-2", source: { kind: "voluntary_reroll" }
      }]
    };
    assert.deepEqual(validateDiceEventBatch(reroll), []);
  });

  it("rejects unordered events, inconsistent snapshots, and mismatched action identities", () => {
    const batch = {
      format: "runner.dice-event-batch", version: 1, actionId: "a", parentActionId: null, rollId: "r",
      events: [2, 1].map(sequence => ({
        eventId: `a:${sequence}`, actionId: "other", parentActionId: null, sequence,
        type: "die_changed", die: "die1", operation: "spend",
        before: { die1: 2, die2: 1 }, after: { die1: 2, die2: 1 }, valueChanged: true,
        rollId: "wrong", source: { kind: "movement" }
      }))
    };
    const paths = validateDiceEventBatch(batch).map(issue => issue.path);
    assert.ok(paths.includes("events[1].sequence"));
    assert.ok(paths.includes("events[0].actionId"));
    assert.ok(paths.includes("events[0].valueChanged"));
    assert.ok(paths.includes("events[0].rollId"));
  });
});