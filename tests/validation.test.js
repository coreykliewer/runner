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

  it("reports invalid tile effects", () => {
    const errors = validateTiles({
      ".": {
        effects: [
          { type: "counter" },
          { type: "stat" },
          { type: "message" },
          { type: "xp", amount: "many" }
        ]
      }
    }).filter(item => item.severity === "error");

    assert.equal(errors.length, 4);
  });
});
