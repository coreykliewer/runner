import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { runNarrativeEvents } from "../src/events.js";
import { addXp, setStoryFlag, unlockAchievement } from "../src/progression.js";
import { createInitialState } from "../src/state.js";

describe("progression and narrative events", () => {
  it("adds xp, achievements, and story flags immutably", () => {
    const base = createInitialState();
    const withXp = addXp(base, 7);
    const withAchievement = unlockAchievement(withXp, { id: "first", title: "First" });
    const withFlag = setStoryFlag(withAchievement, "met_voice", true);

    assert.equal(base.runner.xp, 0);
    assert.equal(withXp.runner.xp, 7);
    assert.equal(withAchievement.runner.achievements[0].id, "first");
    assert.equal(withFlag.runner.storyFlags.met_voice, true);
  });

  it("runs one-shot level start narrative events", async () => {
    const narrative = JSON.parse(await readFile("fixtures/level1-narrative.json", "utf8"));
    const first = runNarrativeEvents(narrative.events, {
      type: "level_start",
      level: "default"
    }, createInitialState());

    assert.equal(first.actions.length, 1);
    assert.equal(first.actions[0].type, "message");
    assert.equal(first.state.runner.storyFlags.entered_dungeon, true);
    assert.deepEqual(first.state.world.narrativeEventsSeen, ["level1_intro"]);

    const second = runNarrativeEvents(narrative.events, {
      type: "level_start",
      level: "default"
    }, first.state);

    assert.equal(second.actions.length, 0);
  });

  it("runs pickup progression events", async () => {
    const narrative = JSON.parse(await readFile("fixtures/level1-narrative.json", "utf8"));
    const result = runNarrativeEvents(narrative.events, {
      type: "pickup",
      pickupType: "diamond"
    }, createInitialState());

    assert.equal(result.state.runner.xp, 5);
    assert.equal(result.state.runner.achievements[0].id, "shiny_start");
    assert.equal(result.actions[0].type, "achievement");
    assert.equal(result.actions[0].title, "You found your first diamond.");
    assert.equal(result.actions[0].body, "The dungeon notices shiny habits.");
  });
});
