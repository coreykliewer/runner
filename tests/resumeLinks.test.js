import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLocalResumeHash,
  createLocalResumeUrl,
  createResumeHash,
  createResumeUrl
} from "../src/resumeLinks.js";
import { decodeCarryStats } from "../src/state.js";

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

  it("creates portal transition hashes with destination level metadata", () => {
    const map = "P25~A1E{a}1A23";
    const hash = createResumeHash({
      map,
      level: "a",
      runner: {
        hearts: 4,
        score: 0,
        kills: 0,
        turbo: false,
        turboMultiplier: 2
      }
    });

    assert.equal(hash, "#map=P25~A1E%7Ba%7D1A23&st=v1.h4.s0.k0.t0.m2&level=a");
  });

  it("carries progression through portal transition hashes", () => {
    const hash = createResumeHash({
      map: "P25",
      level: "a",
      runner: {
        hearts: 4,
        score: 2,
        kills: 1,
        turbo: false,
        turboMultiplier: 2,
        xp: 7,
        counters: { dice_roll: 1 },
        stats: { diamond: 1 },
        achievements: [{ id: "first_diamond", title: "You found your first diamond." }],
        storyFlags: { tutorial_intro: true }
      }
    });
    const rawStats = new URLSearchParams(hash.slice(1)).get("st");
    const carried = decodeCarryStats(rawStats);

    assert.deepEqual(carried.counters, { dice_roll: 1 });
    assert.deepEqual(carried.stats, { diamond: 1 });
    assert.deepEqual(carried.achievements, [{ id: "first_diamond", title: "You found your first diamond." }]);
    assert.deepEqual(carried.storyFlags, { tutorial_intro: true });
    assert.equal(carried.xp, 7);
  });

  it("creates explicit local resume links", () => {
    assert.equal(createLocalResumeHash(), "#resume=1");
    assert.equal(createLocalResumeUrl("index.html#old"), "index.html#resume=1");
  });
});
