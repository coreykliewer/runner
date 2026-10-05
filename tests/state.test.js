import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInitialState,
  decodeCarryStats,
  encodeCarryStatsFromRunner,
  loadState,
  saveState
} from "../src/state.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key)
  };
}

describe("state", () => {
  it("encodes and decodes carry stats", () => {
    const encoded = encodeCarryStatsFromRunner({
      hearts: 4,
      score: 12,
      kills: 3,
      turbo: true,
      turboMultiplier: 2
    });

    assert.equal(encoded, "v1.h4.sc.k3.t1.m2");
    assert.deepEqual(decodeCarryStats(encoded), {
      hearts: 4,
      score: 12,
      kills: 3,
      turbo: true,
      turboMultiplier: 2,
      xp: 0,
      counters: {},
      stats: {},
      achievements: [],
      storyFlags: {},
      narrativeEventsSeen: []
    });
  });

  it("encodes and decodes carried progression", () => {
    const encoded = encodeCarryStatsFromRunner({
      hearts: 4,
      score: 12,
      kills: 3,
      turbo: true,
      turboMultiplier: 2,
      xp: 9,
      counters: { dice_roll: 1, move_in_water: 4 },
      stats: { swimming: 1 },
      achievements: [{ id: "first_dice_roll", title: "You rolled the dice." }],
      storyFlags: { tutorial_intro: true },
      narrativeEventsSeen: ["level_1_intro"]
    });
    const decoded = decodeCarryStats(encoded);

    assert.equal(decoded.hearts, 4);
    assert.equal(decoded.score, 12);
    assert.equal(decoded.kills, 3);
    assert.equal(decoded.turbo, true);
    assert.equal(decoded.turboMultiplier, 2);
    assert.equal(decoded.xp, 9);
    assert.deepEqual(decoded.counters, { dice_roll: 1, move_in_water: 4 });
    assert.deepEqual(decoded.stats, { swimming: 1 });
    assert.deepEqual(decoded.achievements, [{ id: "first_dice_roll", title: "You rolled the dice." }]);
    assert.deepEqual(decoded.storyFlags, { tutorial_intro: true });
    assert.deepEqual(decoded.narrativeEventsSeen, ["level_1_intro"]);
  });

  it("persists state to a localStorage-compatible store", () => {
    const storage = memoryStorage();
    const saved = saveState(createInitialState({ levelKey: "a" }), storage);
    const loaded = loadState(storage);

    assert.equal(saved.levelKey, "a");
    assert.equal(loaded.levelKey, "a");
    assert.equal(loaded.version, 2);
  });
});
