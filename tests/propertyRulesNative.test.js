import test from "node:test";
import assert from "node:assert/strict";
import { createTileEntryBatch, executeTileEntry, restorePropertyEntry } from "../src/tileEntry.js";
import { createCheckpointState, migrateState, encodeCarryStatsFromRunner, decodeCarryStats } from "../src/state.js";

const property = (property, value) => ({ type: "property", operation: "set", property, value });
function setup() {
  const runner = { properties: {}, propertyEntry: { runId: "native", sequence: 0 }, hearts: 3 };
  const event = createTileEntryBatch({ entryState: runner.propertyEntry, from: { x: 1, y: 1 }, to: { x: 2, y: 1 },
    cause: "test", source: { instanceId: "fixture:2:1" }, properties: {} }).events[0];
  const action = { rules: { version: 2, blocks: [{ then: [property("charge", 0), { type: "lose_hearts", amount: 1 },
    { type: "narrative", text: "after" }, property("finished", 1)] }] } };
  const saves = [];
  const checkpoint = () => saves.push(structuredClone(runner));
  return { runner, event, action, saves, checkpoint };
}

test("consumed identity and property prefix are durable before native calls, and each call is checkpointed", () => {
  const f = setup(), order = [];
  const result = executeTileEntry(f.action, f.event, f.runner, { checkpoint: f.checkpoint, handlers: {
    lose_hearts: () => {
      assert.equal(f.saves.at(-1).propertyEntry.sequence, 1);
      assert.equal(f.saves.at(-1).propertyEntry.execution.status, "pending");
      assert.deepEqual(f.saves.at(-1).properties, { charge: 0 });
      f.runner.hearts--; order.push("damage");
    }, narrative: () => { assert.equal(f.saves.at(-1).hearts, 2); order.push("narrative"); }
  } });
  assert.deepEqual(order, ["damage", "narrative"]);
  assert.equal(result.evaluation.status, "completed");
  assert.deepEqual(f.runner.properties, { charge: 0, finished: 1 });
  assert.equal(f.runner.propertyEntry.execution.status, "completed");
});

test("a handler throwing after damage retains the side effect, stops later effects, and cannot replay", () => {
  const f = setup(); let calls = 0;
  const options = { checkpoint: f.checkpoint, handlers: {
    lose_hearts: () => { calls++; f.runner.hearts--; throw new Error("after damage"); },
    narrative: () => assert.fail("must stop")
  } };
  const result = executeTileEntry(f.action, f.event, f.runner, options);
  assert.equal(f.runner.hearts, 2);
  assert.deepEqual(f.runner.properties, { charge: 0 });
  assert.equal(result.evaluation.status, "failed");
  assert.equal(f.runner.propertyEntry.execution.status, "uncertain");
  assert.ok(result.diagnostics.some(item => item.code === "native_effect_uncertain"));
  assert.equal(executeTileEntry(f.action, f.event, f.runner, options).applied, false);
  assert.equal(calls, 1);
});

test("terminal outcome is distinct from failure and stops subsequent effects", () => {
  const f = setup(); f.runner.hearts = 1;
  const result = executeTileEntry(f.action, f.event, f.runner, { checkpoint: f.checkpoint,
    isTerminal: () => f.runner.hearts <= 0, handlers: { lose_hearts: () => { f.runner.hearts--; } } });
  assert.equal(result.evaluation.status, "terminal");
  assert.equal(f.runner.propertyEntry.execution.status, "terminal");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(Object.hasOwn(f.runner.properties, "finished"), false);
});

test("checkpoint failure before a native call prevents its execution", () => {
  const f = setup();
  const result = executeTileEntry(f.action, f.event, f.runner, { checkpoint: () => { throw new Error("quota"); },
    handlers: { lose_hearts: () => assert.fail("not durable") } });
  assert.equal(f.runner.hearts, 3);
  assert.ok(result.diagnostics.some(item => item.code === "native_checkpoint_before_failed"));
  assert.equal(Object.hasOwn(f.runner.properties, "finished"), false);
});

test("post-action storage failure leaves durable pending guard; checkpoint/resume/carry restore never retries", () => {
  const f = setup(); let calls = 0;
  const result = executeTileEntry(f.action, f.event, f.runner, { checkpoint: () => {
    if (f.saves.length) throw new Error("post-action quota");
    f.checkpoint();
  }, handlers: { lose_hearts: () => { calls++; f.runner.hearts--; } } });
  assert.ok(result.diagnostics.some(item => item.code === "native_checkpoint_after_failed"));
  const checkpoint = createCheckpointState("properties", f.saves[0]);
  const restored = migrateState(checkpoint).runner;
  assert.equal(restored.propertyEntry.execution.status, "uncertain");
  assert.ok(restored.propertyEntry.execution.diagnostics.some(item => item.code === "native_outcome_uncertain_restore"));
  const carried = decodeCarryStats(encodeCarryStatsFromRunner(restored));
  assert.equal(carried.propertyEntry.execution.status, "uncertain");
  assert.equal(executeTileEntry(f.action, f.event, carried, { checkpoint: f.checkpoint,
    handlers: { lose_hearts: () => { calls++; } } }).applied, false);
  assert.equal(calls, 1);
});

test("invalid definitions consume identity without applying prefixes or calling native adapters", () => {
  const f = setup(); f.action.rules.blocks[0].then.push({ type: "invalid" });
  const result = executeTileEntry(f.action, f.event, f.runner, { checkpoint: f.checkpoint,
    handlers: { lose_hearts: () => assert.fail("invalid") } });
  assert.deepEqual(f.runner.properties, {});
  assert.equal(result.evaluation.status, "invalid");
  assert.equal(f.runner.propertyEntry.sequence, 1);
  assert.equal(restorePropertyEntry({ runId: "old", sequence: 2 }, "new").execution, undefined);
});
