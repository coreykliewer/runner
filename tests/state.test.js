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
      turboMultiplier: 2
    });
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
