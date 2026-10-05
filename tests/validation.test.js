import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { validateAchievements, validateLevels, validateMap, validateTiles } from "../src/validation.js";

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
              left: "pickup.type",
              operator: "equals",
              right: { literal: "turbo" }
            },
            {
              left: "movementPoints",
              operator: "lessThan",
              right: { literal: 1 }
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
});
