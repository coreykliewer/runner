import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { checkAchievementRules, normalizeAchievementRules } from "../src/achievements.js";
import { createInitialState } from "../src/state.js";

describe("achievement rules", () => {
  async function loadRules() {
    return JSON.parse(await readFile("achievements.json", "utf8"));
  }

  it("loads achievements from data", async () => {
    const rules = normalizeAchievementRules(await loadRules());
    assert.equal(rules[0].id, "first_diamond");
    assert.equal(rules[0].when.stat, "score");
  });

  it("unlocks achievements when watched stats reach thresholds", async () => {
    const rules = await loadRules();
    const result = checkAchievementRules(createInitialState({
      runner: {
        score: 1,
        kills: 0,
        xp: 0,
        achievements: []
      }
    }), rules);

    assert.equal(result.unlocked.length, 1);
    assert.equal(result.unlocked[0].id, "first_diamond");
    assert.equal(result.state.runner.achievements[0].id, "first_diamond");
  });

  it("does not emit already unlocked achievements again", async () => {
    const rules = await loadRules();
    const first = checkAchievementRules(createInitialState({
      runner: {
        score: 1,
        achievements: []
      }
    }), rules);
    const second = checkAchievementRules(first.state, rules);

    assert.equal(second.unlocked.length, 0);
    assert.equal(second.state.runner.achievements.length, 1);
  });

  it("can unlock multiple achievements after several stats change", async () => {
    const rules = await loadRules();
    const result = checkAchievementRules(createInitialState({
      runner: {
        score: 1,
        kills: 1,
        xp: 5,
        achievements: []
      }
    }), rules);

    assert.deepEqual(result.unlocked.map(item => item.id), [
      "first_diamond",
      "first_kill",
      "first_xp"
    ]);
  });
});
