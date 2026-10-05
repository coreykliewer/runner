import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { validateLevels, validateMap, validateTiles } from "../src/validation.js";

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
});
