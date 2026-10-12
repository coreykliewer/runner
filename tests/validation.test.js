import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { validateAchievements, validateContentDocuments, validateLevels, validateMap, validateNarrative, validateTiles } from "../src/validation.js";
import { resolveExitDestination } from "../src/levelRouting.js";
import { getRollLimitState } from "../src/rollLimit.js";
import { TILE_CAPABILITY_GROUPS, TILE_EDITOR_CATEGORIES, TILE_PROPERTY_CATEGORIES, TILE_PROPERTY_DEFINITIONS, getTilePropertyInitialValue } from "../src/tileProperties.js";

describe("validation", () => {
  it("validates the current tile file shape", async () => {
    const tiles = JSON.parse(await readFile("tiles2.json", "utf8"));
    const errors = validateTiles(tiles).filter(item => item.severity === "error");
    assert.deepEqual(errors, []);
  });

  it("validates separated levels against current tiles", async () => {
    const tiles = JSON.parse(await readFile("tiles2.json", "utf8"));
    const levels = JSON.parse(await readFile("levels.json", "utf8"));
    assert.deepEqual(validateLevels(levels, tiles), []);
    assert.deepEqual(validateMap(levels.levels.default.map, tiles), []);
  });

  it("routes exit variants through the current level mapping", () => {
    const levels = {
      levels: {
        entrance: { exits: { north_gate: "waterworks" } },
        waterworks: { map: "P1" }
      }
    };

    assert.equal(resolveExitDestination(levels, "entrance", "north_gate"), "waterworks");
    assert.equal(resolveExitDestination(levels, "entrance", "waterworks"), "waterworks");
  });

  it("rejects exit mappings to levels that do not exist", () => {
    const errors = validateLevels({ levels: { entrance: { map: "P1", exits: { gate: "missing" } } } }, { P: {} }, {
      rows: 1,
      cols: 1
    }).filter(item => item.severity === "error");

    assert.equal(errors.some(item => item.path === "levels.entrance.exits.gate"), true);
  });

  it("reports unknown tiles", () => {
    const issues = validateMap("Q1", { ".": {} }, { rows: 1, cols: 1 });
    assert.equal(issues[0].severity, "error");
    assert.match(issues[0].message, /Unknown tile/);
  });

  it("validates achievements", async () => {
    const achievements = JSON.parse(await readFile("achievements.json", "utf8"));
    const errors = validateAchievements(achievements).filter(item => item.severity === "error");
    assert.deepEqual(errors, []);
  });

  it("validates narrative event structure and supported actions", async () => {
    const narrative = JSON.parse(await readFile("fixtures/level1-narrative.json", "utf8"));
    assert.deepEqual(validateNarrative(narrative).filter(item => item.severity === "error"), []);

    const invalid = validateNarrative({
      events: [{ id: "broken", trigger: [], actions: [{ type: "teleport" }] }]
    });
    assert.equal(invalid.some(item => item.path === "events[0].trigger"), true);
    assert.equal(invalid.some(item => item.path === "events[0].actions[0].type"), true);
  });

  it("validates cross-document event, achievement, and tile references", () => {
    const issues = validateContentDocuments({
      levels: { defaultLevel: "start", levels: { start: { map: "E{gate}1", narrative: ["missing_event"] } } },
      tiles: { E: { exit: true } },
      narrative: { events: [{
        id: "event",
        trigger: { level: "missing_level", tile: "Q" },
        actions: [{ type: "achievement", id: "missing_achievement" }]
      }] },
      achievements: { achievements: [] }
    });

    assert.equal(issues.some(item => item.path === "levels.start.narrative[0]"), true);
    assert.equal(issues.some(item => item.path === "events[0].trigger.level"), true);
    assert.equal(issues.some(item => item.path === "events[0].trigger.tile"), true);
    assert.equal(issues.some(item => item.path === "events[0].actions[0].id"), true);
    assert.equal(issues.some(item => item.path === "levels.start.exits.gate" && item.severity === "warning"), true);
  });

  it("validates numeric registries, numeric level maps, and both tile reference forms", () => {
    const tiles = {
      format: "runner.numeric-tile-registry",
      version: 1,
      nextTileId: 4,
      airTileId: 1,
      playerArtTileId: 2,
      legacyIdMapping: { ".": 1, R: 2, E: 3 },
      tiles: [
        { id: 1, name: "Air", legacyCode: ".", definition: { solid: false, gravity: true } },
        { id: 2, name: "Runner", legacyCode: "R", definition: {} },
        { id: 3, name: "Exit", legacyCode: "E", definition: { exit: true } }
      ]
    };
    const cells = Array.from({ length: 15 }, () => Array(25).fill(1));
    const variants = Array.from({ length: 15 }, () => Array(25).fill(null));
    cells[1][1] = 1;
    cells[1][2] = 3;
    const numericMap = {
      format: "runner.numeric-map",
      version: 1,
      width: 25,
      height: 15,
      cells,
      variants,
      spawn: { x: 1, y: 1, artTileId: 2 }
    };
    const issues = validateContentDocuments({
      tiles,
      levels: {
        schemaVersion: 1,
        defaultLevel: "default",
        levels: { default: { map: numericMap, exits: { default: "destination" } }, destination: { map: numericMap } }
      },
      narrative: { events: [
        { id: "old", trigger: { tile: "E" }, actions: [] },
        { id: "new", trigger: { tileId: 999 }, actions: [] }
      ] },
      achievements: { achievements: [] }
    });

    assert.equal(issues.some(item => item.severity === "error"), true);
    assert.equal(issues.some(item => item.path === "events[0].trigger.tile"), false);
    assert.equal(issues.some(item => item.path === "events[1].trigger.tileId"), true);

    const invalidSpawn = structuredClone(numericMap);
    invalidSpawn.spawn.artTileId = 999;
    assert.equal(validateMap(invalidSpawn, tiles).some(item => item.path === "map.spawn.artTileId"), true);
  });

  it("validates achievement value comparisons", () => {
    const errors = validateAchievements({
      achievements: [{
        id: "comparison",
        title: "Comparison",
        when: {
          left: "movementPoints",
          operator: "lessThan",
          right: "target.moveCost"
        }
      }]
    }).filter(item => item.severity === "error");

    assert.deepEqual(errors, []);
  });

  it("validates compound achievement conditions", () => {
    const errors = validateAchievements({
      achievements: [{
        id: "compound",
        title: "Compound",
        when: {
          all: [
            {
              left: "movement.attempted",
              operator: "equals",
              right: { literal: true }
            },
            {
              left: "movementPoints",
              operator: "lessThan",
              right: "target.moveCost"
            },
            {
              left: "dice.rollCount",
              operator: "equals",
              right: { literal: 0 }
            }
          ]
        }
      }]
    }).filter(item => item.severity === "error");

    assert.deepEqual(errors, []);
  });

  it("reports invalid achievement value comparisons", () => {
    const errors = validateAchievements({
      achievements: [{
        id: "comparison",
        title: "Comparison",
        when: {
          left: "movementPoints",
          operator: "between"
        }
      }]
    }).filter(item => item.severity === "error");

    assert.equal(errors.length, 2);
  });

  it("reports invalid tile effects", () => {
    const errors = validateTiles({
      ".": {
        effects: [
          { type: "counter" },
          { type: "message" },
          { type: "xp", amount: "many" }
        ]
      }
    }).filter(item => item.severity === "error");

    assert.equal(errors.length, 3);
  });

  it("validates tile stat grants", () => {
    const errors = validateTiles({
      W: {
        tags: ["water"],
        grantStats: {
          in_water: 1
        }
      }
    }).filter(item => item.severity === "error");

    assert.deepEqual(errors, []);
  });

  it("centralizes the visual tile property categories and fallback-aware initial values", () => {
    assert.deepEqual(TILE_EDITOR_CATEGORIES, ["Environmental", "Item", "Interactive"]);
    assert.deepEqual(TILE_CAPABILITY_GROUPS.slice(0, 3).map(group => group.label), ["Collision", "Movement", "Physics"]);
    assert.deepEqual(TILE_PROPERTY_CATEGORIES.map(category => category.label), [
      "Collision and Physics",
      "Movement",
      "Damage and Hazards",
      "Pickups and Rewards",
      "Text and Messaging",
      "Artwork",
      "Advanced and Compatibility"
    ]);
    for (const name of [
      "solid", "gravity", "bounce", "slope", "fallDamageCancel", "moveCost", "moveCostTop",
      "moveCostInside", "insideMoveCost", "insideDamage", "topDamage", "fallDamageThreshold",
      "fallDamageMultiplier", "pickupType", "effects", "grantStats", "tags", "hint",
      "signMessage", "signHtml", "deathMessage", "pickupMessage", "logKind", "logHtml", "svg",
      "jumpAllowed", "sinkSpeed", "riseSpeed", "autoPush"
    ]) {
      assert.ok(TILE_PROPERTY_DEFINITIONS[name], `${name} has shared metadata`);
      assert.ok(TILE_PROPERTY_DEFINITIONS[name].description);
      assert.ok(TILE_PROPERTY_DEFINITIONS[name].runtimeDefault);
    }
    assert.equal(getTilePropertyInitialValue("moveCostTop", { moveCost: 4 }), 4);
    assert.equal(getTilePropertyInitialValue("moveCostInside", { insideMoveCost: 6, moveCost: 4 }), 6);
    assert.equal(getTilePropertyInitialValue("fallDamageCancel", { gravity: false }), true);
    assert.deepEqual(getTilePropertyInitialValue("insideDamage"), { amount: 0, when: "instant" });
  });

  it("rejects invalid supported tile property types and preserves unknown property validation", () => {
    const issues = validateTiles({
      P: {
        moveCost: "fast",
        signHtml: 3,
        tags: {},
        slope: "up",
        jumpAllowed: "yes",
        insideDamage: { amount: "2" },
        effects: [{ type: "xp", amount: "2" }],
        grantStats: { score: "2" },
        futureRule: { keep: true }
      }
    });
    for (const path of [
      "tiles.P.moveCost", "tiles.P.signHtml", "tiles.P.slope", "tiles.P.jumpAllowed", "tiles.P.tags",
      "tiles.P.insideDamage.amount", "tiles.P.effects[0].amount", "tiles.P.grantStats.score"
    ]) {
      assert.equal(issues.some(item => item.path === path && item.severity === "error"), true, path);
    }
    assert.equal(issues.some(item => item.path === "tiles.P.futureRule"), false);
  });

  it("validates lock, monster, and overlay variant properties", () => {
    const issues = validateTiles({
      K: {
        exit: { gate: { svg: 7 } },
        lock: { gate: { dice: 3 } }
      },
      M: {
        monster: { snake: { hp: "many", playerHit: { dice: 1, value: "high" } } }
      }
    });

    assert.equal(issues.some(item => item.path === "tiles.K.exit.gate.svg"), true);
    assert.equal(issues.some(item => item.path === "tiles.K.lock.gate.dice"), true);
    assert.equal(issues.some(item => item.path === "tiles.M.monster.snake.hp"), true);
    assert.equal(issues.some(item => item.path === "tiles.M.monster.snake.playerHit.value"), true);
  });

  it("accepts positive integer roll limits and rejects invalid values", () => {
    const valid = validateLevels({
      levels: {
        default: {
          map: "P1",
          rollLimit: 10
        }
      }
    }, { P: {} }, { rows: 1, cols: 1 }).filter(item => item.severity === "error");

    const invalid = validateLevels({
      levels: {
        default: {
          map: "P1",
          rollLimit: 0
        }
      }
    }, { P: {} }, { rows: 1, cols: 1 }).filter(item => item.severity === "error");

    const nested = validateLevels({
      levels: {
        default: {
          map: "P1",
          rollLimit: "abc"
        }
      }
    }, { P: {} }, { rows: 1, cols: 1 }).filter(item => item.severity === "error");

    assert.equal(valid.length, 0);
    assert.equal(invalid.some(item => item.path === "levels.default.rollLimit"), true);
    assert.equal(nested.some(item => item.path === "levels.default.rollLimit"), true);
  });

  it("computes roll-limit state without a configured limit", () => {
    assert.deepEqual(getRollLimitState({ rollLimit: null, rollsUsed: 3 }), {
      rollLimit: null,
      rollsUsed: 3,
      rollsRemaining: null,
      percentConsumed: 0
    });
  });
});
