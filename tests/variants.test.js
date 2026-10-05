import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getVariantBucketEntry, mergeVariantDef, sanitizeVariant } from "../src/shared/variants.js";

describe("variants", () => {
  it("sanitizes variant ids for URL and schema use", () => {
    assert.equal(sanitizeVariant(" Exit 1!! "), "exit1");
    assert.equal(sanitizeVariant("LongVariantNameThatKeepsGoing"), "longvariantn");
    assert.equal(sanitizeVariant(null), "");
  });

  it("finds variant entries in known buckets", () => {
    const base = {
      solid: true,
      lock: {
        a: { dice: 1, value: 4 }
      }
    };
    assert.deepEqual(getVariantBucketEntry(base, "A"), {
      bucket: "lock",
      key: "a",
      entry: { dice: 1, value: 4 }
    });
  });

  it("merges variant definitions over base definitions", () => {
    const merged = mergeVariantDef({
      solid: true,
      hint: "base",
      sign: {
        a: { hint: "variant" }
      }
    }, "a");

    assert.equal(merged.variantBucket, "sign");
    assert.equal(merged.def.solid, true);
    assert.equal(merged.def.hint, "variant");
  });
});
