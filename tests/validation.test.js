import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { validateAchievements, validateLevels, validateMap, validateTiles } from "../src/validation.js";
import { resolveExitDestination } from "../src/levelRouting.js";
import { getRollLimitState } from "../src/rollLimit.js";

describe("validation", () => {
  it("validates the current tile file shape", async () => {
    const tiles = JSON.parse(await readFile("tiles2.json", "utf8"));
    const errors = validateTiles(tiles).filter(item => item.severity === "error");
    assert.deepEqual(errors, []);
  });

  it("validates separated levels against current tiles", async () => {
    const tiles = JSON.parse(await readFile("tiles2.json", "utf8"));
    const levels = JSON.parse(await readFile("levels.json", "utf8"));
    const errors = validateLevels(levels, tiles).filter(item => item.severity === "error");
    assert.deepEqual(errors, []);
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
