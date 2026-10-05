import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createResumeHash, createResumeUrl } from "../src/resumeLinks.js";

describe("resume links", () => {
  it("creates compact hashes with map and carry stats", () => {
    const hash = createResumeHash({
      map: "A1~P1",
      runner: {
        hearts: 3,
        score: 2,
        kills: 1,
        turbo: false,
        turboMultiplier: 2
      },
      level: "default",
      fog: false
    });

    assert.equal(hash, "#map=A1~P1&st=v1.h3.s2.k1.t0.m2&level=default&fog=off");
  });

  it("appends resume hashes to clean base URLs", () => {
    assert.equal(createResumeUrl("index.html#old", { map: "A1" }), "index.html#map=A1");
  });
});
