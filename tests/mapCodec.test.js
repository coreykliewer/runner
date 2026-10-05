import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import {
  decodeMap,
  decodeRowToTilesAndVariants,
  encodeMap,
  encodeRowWithVariants,
  splitRowsFlexible
} from "../src/shared/mapCodec.js";

describe("map codec", () => {
  it("splits canonical, legacy, and newline row formats", () => {
    assert.deepEqual(splitRowsFlexible("A1~P1"), ["A1", "P1"]);
    assert.deepEqual(splitRowsFlexible("A1.P1"), ["A1", "P1"]);
    assert.deepEqual(splitRowsFlexible("A1\r\nP1"), ["A1", "P1"]);
  });

  it("decodes brace variants and strips variants from air", () => {
    const row = decodeRowToTilesAndVariants("A2E{Exit 1!!}1M{snake}1", 5);
    assert.deepEqual(row.tiles, [".", ".", "E", "M", "."]);
    assert.deepEqual(row.variants, ["", "", "exit1", "snake", ""]);
  });

  it("still accepts legacy single-letter variants", () => {
    const row = decodeRowToTilesAndVariants("Ma1Kc1A3", 5);
    assert.deepEqual(row.tiles, ["M", "K", ".", ".", "."]);
    assert.deepEqual(row.variants, ["a", "c", "", "", ""]);
  });

  it("encodes rows with run lengths and brace variants", () => {
    const encoded = encodeRowWithVariants(
      [".", ".", "E", "E", "P"],
      ["", "", "a", "a", ""],
      5
    );
    assert.equal(encoded, "A2E{a}2P1");
  });

  it("round-trips golden maps into canonical encoding", async () => {
    const golden = JSON.parse(await readFile("fixtures/golden-maps.json", "utf8"));

    for (const fixture of golden.maps) {
      const decoded = decodeMap(fixture.encoded, {
        rows: golden.rows,
        cols: golden.cols
      });
      const encoded = encodeMap(decoded.tiles, decoded.variants, {
        rows: golden.rows,
        cols: golden.cols
      });
      const decodedAgain = decodeMap(encoded, {
        rows: golden.rows,
        cols: golden.cols
      });
      assert.deepEqual(decodedAgain, decoded, fixture.id);
    }
  });
});
