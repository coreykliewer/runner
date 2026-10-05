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
    assert.equal(result.state.runner.stats.diamond, 1);
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

  it("can unlock achievements from open-ended runner counters and grant stats", async () => {
    const rules = await loadRules();
    const result = checkAchievementRules(createInitialState({
      runner: {
        counters: {
          right: 1,
          left: 1,
          jump: 1,
          double_jump: 1,
          fall: 1,
          dice_roll: 1,
          fall_in_water: 1
        },
        stats: {},
        achievements: []
      }
    }), rules);

    assert.deepEqual(result.unlocked.map(item => item.id), [
      "first_right",
      "first_left",
      "first_jump",
      "first_double_jump",
      "first_fall",
      "first_dice_roll",
      "first_fall_in_water"
    ]);
    assert.deepEqual(result.state.runner.stats, {
      right: 1,
      left: 1,
      jump: 1,
      double_jump: 1,
      fall: 1,
      dice_roll: 1,
      fall_in_water: 1
    });
  });

  it("keeps counters driving later achievements after a stat has been granted", () => {
    const rules = [
      {
        id: "first_roll",
        title: "First roll",
        when: { stat: "dice_roll", atLeast: 1 },
        grantStats: { dice_roll: 1 }
      },
      {
        id: "ten_rolls",
        title: "Ten rolls",
        when: { stat: "dice_roll", atLeast: 10 },
        grantStats: { dice_master: 1 }
      }
    ];

    const first = checkAchievementRules(createInitialState({
      runner: {
        counters: { dice_roll: 1 },
        stats: {},
        achievements: []
      }
    }), rules);
    const tenth = checkAchievementRules({
      ...first.state,
      runner: {
        ...first.state.runner,
        counters: { dice_roll: 10 }
      }
    }, rules);

    assert.deepEqual(tenth.unlocked.map(item => item.id), ["ten_rolls"]);
    assert.equal(tenth.state.runner.stats.dice_roll, 1);
    assert.equal(tenth.state.runner.stats.dice_master, 1);
  });

  it("unlocks a swimming stat after enough water movement", async () => {
    const rules = await loadRules();
    const result = checkAchievementRules(createInitialState({
      runner: {
        counters: { move_in_water: 100 },
        stats: {},
        achievements: []
      }
    }), rules);

    assert.deepEqual(result.unlocked.map(item => item.id), ["hundred_water_moves"]);
    assert.equal(result.state.runner.stats.swimming, 1);
  });

  it("supports value-to-value comparison conditions", () => {
    const rules = [{
      id: "low_resource",
      title: "Low resource",
      when: {
        left: "runtime.available",
        operator: "lessThan",
        right: "target.required"
      }
    }];
    const result = checkAchievementRules(createInitialState({
      runner: { achievements: [] }
    }), rules, {
      runtime: { available: 2 },
      target: { required: 3 }
    });

    assert.deepEqual(result.unlocked.map(item => item.id), ["low_resource"]);
  });

  it("supports compound achievement conditions", () => {
    const rules = [{
      id: "turbo_without_movement",
      title: "Optimistic.",
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
    }];
    const result = checkAchievementRules(createInitialState({
      runner: { achievements: [] }
    }), rules, {
      movementPoints: 0,
      pickup: { type: "turbo" }
    });

    assert.deepEqual(result.unlocked.map(item => item.id), ["turbo_without_movement"]);
  });

  it("does not unlock turbo-without-movement for other pickups", () => {
    const rules = [{
      id: "turbo_without_movement",
      title: "Optimistic.",
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
    }];
    const result = checkAchievementRules(createInitialState({
      runner: { achievements: [] }
    }), rules, {
      movementPoints: 0,
      pickup: { type: "diamond" }
    });

    assert.deepEqual(result.unlocked, []);
  });

  it("does not unlock turbo-without-movement when movement remains", () => {
    const rules = [{
      id: "turbo_without_movement",
      title: "Optimistic.",
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
    }];
    const result = checkAchievementRules(createInitialState({
      runner: { achievements: [] }
    }), rules, {
      movementPoints: 1,
      pickup: { type: "turbo" }
    });

    assert.deepEqual(result.unlocked, []);
  });

});
