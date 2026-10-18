import test from "node:test";
import assert from "node:assert/strict";
import { createTileEntryBatch, decodeTileEntryBatch, executeTileEntry } from "../src/tileEntry.js";
import { readBuiltInProperties } from "../src/runnerPropertyNames.js";
import { createCheckpointState, migrateState, encodeCarryStatsFromRunner, decodeCarryStats } from "../src/state.js";
import { setXp, addXp } from "../src/progression.js";

test("fractional native values survive checkpoint and portable transport without polluting runtime custom state", () => {
  for (const hearts of [0.1, 2.5, -0.5, 1e20, Number.MAX_VALUE]) {
    const runner = { hearts, score: 3.141592653589793, kills: 2.25, xp: 1.75, properties: { custom: 0 } };
    const carry = decodeCarryStats(encodeCarryStatsFromRunner(runner));
    const checkpoint = migrateState(createCheckpointState("test", runner)).runner;
    for (const key of ["hearts", "score", "kills", "xp"]) {
      assert.equal(carry[key], runner[key]);
      assert.equal(checkpoint[key], runner[key]);
    }
    assert.deepEqual(carry.properties, { custom: 0 });
    assert.equal(Object.hasOwn(carry, "exactNative"), false);
  }
});

test("older integer links and encoder output remain unchanged", () => {
  assert.equal(encodeCarryStatsFromRunner({ hearts: 4, score: 12, kills: 3, turbo: true, turboMultiplier: 2 }), "v1.h4.sc.k3.t1.m2");
  const state = decodeCarryStats("v1.h4.sc.k3.t1.m2");
  assert.deepEqual([state.hearts, state.score, state.kills], [4, 12, 3]);
  assert.equal(decodeCarryStats("v1.h-1.s0.k0.t0.m2").hearts, 0);
});

test("malformed exact fields cannot overwrite unrelated state or introduce invalid native values", () => {
  const payload = { exactNative: { hearts: "2.5", score: -1, kills: null, xp: 999, properties: { Hearts: 88 } } };
  const encoded = Buffer.from(encodeURIComponent(JSON.stringify(payload))).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const decoded = decodeCarryStats(`v1.h4.s3.k1.t0.m2.p${encoded}`);
  assert.deepEqual([decoded.hearts, decoded.score, decoded.kills, decoded.xp], [4, 3, 1, 0]);
  assert.equal(decoded.properties, undefined);
});

test("progression target setter preserves legacy additive behavior and exact small targets after large XP", () => {
  const state = { runner: { xp: 1e20, achievements: ["retained"] } };
  const next = setXp(state, 1);
  assert.equal(next.runner.xp, 1);
  assert.deepEqual(next.runner.achievements, ["retained"]);
  assert.equal(state.runner.xp, 1e20);
  assert.equal(addXp({ runner: { xp: 0.5 } }, 1).runner.xp, 1.5);
  assert.throws(() => setXp(state, Infinity), /finite/);
});

function setup(properties = {}) {
  const runner = { hearts: 2.5, score: 3.25, xp: 1.75, properties, propertyEntry: { runId: "v3", sequence: 0 } };
  const readNativeValues = () => readBuiltInProperties(runner, { getRemainingMoves: () => 4 });
  const event = createTileEntryBatch({ entryState: runner.propertyEntry, properties,
    from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, source: { instanceId: "fixture" }, cause: "test", nativeValues: readNativeValues() }).events[0];
  const saves = [];
  return { runner, event, readNativeValues, saves, checkpoint: () => saves.push(structuredClone(runner)) };
}

test("V3 driver captures Entry Values once, acknowledges Current Values, checkpoints and suppresses replay", () => {
  const f = setup();
  const action = { rules: { version: 3, blocks: [{ then: [{ type: "property", operation: "add", property: "Hearts", value: 1 }] },
    { if: { type: "comparison", mode: "current", property: "hearts", operator: "=", value: 3.5 }, then: [{ type: "property", operation: "set", property: "current", value: 1 }] },
    { if: { type: "comparison", property: "HEARTS", operator: "=", value: 2.5 }, then: [{ type: "property", operation: "set", property: "entry", value: 1 }] }] } };
  let calls = 0;
  const options = { checkpoint: f.checkpoint, readNativeValues: f.readNativeValues, handlers: { property: () => {
    calls++;
    assert.equal(f.saves.at(-1).propertyEntry.execution.status, "pending");
    f.runner.hearts += 1;
  } } };
  const result = executeTileEntry(action, f.event, f.runner, options);
  assert.equal(result.evaluation.status, "completed");
  assert.deepEqual(f.runner.properties, { current: 1, entry: 1 });
  const restored = migrateState(createCheckpointState("test", f.runner)).runner;
  assert.equal(executeTileEntry(action, f.event, restored, options).applied, false);
  assert.equal(calls, 1);
  assert.equal(f.event.nativeValues.Hearts, 2.5);
  assert.equal(result.evaluation.nativeValues.Hearts, 3.5);
});

test("V3 collisions and Moves writes are consumed without any native attempt or silent merge", () => {
  for (const collision of [true, false]) {
    const f = setup(collision ? { hearts: 99 } : {});
    const action = { rules: { version: 3, blocks: [{ then: [{ type: "property", operation: "set", property: collision ? "Hearts" : "Moves", value: 1 }] }] } };
    const result = executeTileEntry(action, f.event, f.runner, { checkpoint: f.checkpoint, readNativeValues: f.readNativeValues,
      handlers: { property: () => assert.fail("invalid native write") } });
    assert.equal(result.evaluation.status, "invalid");
    assert.equal(f.runner.hearts, 2.5);
    assert.deepEqual(f.runner.properties, collision ? { hearts: 99 } : {});
    assert.equal(f.runner.propertyEntry.sequence, 1);
  }
});

test("native entry snapshots are immutable and malformed snapshots fail event validation", () => {
  const f = setup();
  assert.throws(() => { f.event.nativeValues.Hearts = 9; }, TypeError);
  const batch = createTileEntryBatch({ entryState: { runId: "test", sequence: 0 }, properties: {}, from: { x: 1, y: 1 },
    to: { x: 2, y: 1 }, source: { instanceId: "test" }, cause: "test", nativeValues: f.readNativeValues() });
  const invalid = structuredClone(batch); invalid.events[0].nativeValues.Moves = 0.5;
  assert.throws(() => decodeTileEntryBatch(invalid), /Invalid/);
});
