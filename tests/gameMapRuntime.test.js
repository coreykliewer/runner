import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeGameMap } from "../src/gameMapRuntime.js";

describe("game map runtime adapter", () => {
  it("builds grid and side arrays from shared map decoding", () => {
    const runtime = decodeGameMap("A1E{a}1M{snake}1K{b}1", {
      rows: 2,
      cols: 4,
      tiles: {
        M: {
          monster: {
            snake: { hp: 3 }
          }
        }
      }
    });

    assert.deepEqual(runtime.grid, [
      [".", "E", "M", "K"],
      [".", ".", ".", "."]
    ]);
    assert.deepEqual(runtime.signVariantMap, [
      [null, "a", "snake", "b"],
      [null, null, null, null]
    ]);
    assert.deepEqual(runtime.monsterStateMap, [
      [null, null, 3, null],
      [null, null, null, null]
    ]);
    assert.deepEqual(runtime.bounceHeight, [
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ]);
    assert.deepEqual(runtime.sinkDelayMap, [
      [null, null, null, null],
      [null, null, null, null]
    ]);
  });

  it("defaults unknown monster variants to one hit point", () => {
    const runtime = decodeGameMap("M{missing}1", {
      rows: 1,
      cols: 1,
      tiles: { M: { monster: {} } }
    });

    assert.deepEqual(runtime.monsterStateMap, [[1]]);
  });
});
