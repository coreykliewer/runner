import test from "node:test";
import assert from "node:assert/strict";
import { getRunnerPropertyStats } from "../src/runnerPropertyStats.js";

test("stats retain acquired zero, omit absent and nonnumeric values, and ignore inherited properties", () => {
  const properties = Object.assign(Object.create({ inherited: 8 }), {
    zeta: 3, acquired: 0, text: "2", invalid: NaN, infinite: Infinity
  });
  assert.deepEqual(getRunnerPropertyStats(properties), [["acquired", 0], ["zeta", 3]]);
  assert.deepEqual(getRunnerPropertyStats(), []);
});

test("stats use deterministic property-name order without mutating the authoritative map", () => {
  const properties = Object.freeze({ z: 1, a: 2, A: 3 });
  assert.deepEqual(getRunnerPropertyStats(properties), [["A", 3], ["a", 2], ["z", 1]]);
  assert.deepEqual(Object.keys(properties), ["z", "a", "A"]);
});
