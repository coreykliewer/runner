import { test } from "node:test";
import assert from "node:assert/strict";
import { createTileEntryBatch, decodeTileEntryBatch, tileEntryRule, applyTileEntry, restorePropertyEntry } from "../src/tileEntry.js";
import { createEncounterDispatcher } from "../src/encounterIntegration.js";
import { createCheckpointState, saveState, loadState, encodeCarryStatsFromRunner, decodeCarryStats } from "../src/state.js";

const source = { instanceId: "level:2:1:any", tileId: 90001, x: 2, y: 1 };
const rules = { version: 1, blocks: [{ then: [{ operation: "add", property: "custom", value: 1 }] }] };
const batch = (entryState, properties) => createTileEntryBatch({ entryState, properties, source,
  from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, cause: "walk" });

test("entry snapshots are immutable; same-cell and malformed events cannot enter the dispatcher", () => {
  const properties = { zero: 0 };
  const event = batch({ runId: "run", sequence: 0 }, properties);
  properties.zero = 5;
  assert.equal(event.events[0].before.zero, 0);
  assert.throws(() => { event.events[0].before.zero = 8; }, TypeError);
  assert.throws(() => decodeTileEntryBatch({ ...event, events: [] }));
  const stationary = structuredClone(event);
  stationary.events[0].to = stationary.events[0].from;
  assert.throws(() => decodeTileEntryBatch(stationary));
  const changed = structuredClone(event);
  changed.events[0].after.zero = 2;
  assert.throws(() => decodeTileEntryBatch(changed));
});

test("shared dispatcher suppresses duplicate entries; restored high-water metadata also blocks replay", () => {
  let properties = {};
  let entryState = { runId: "run", sequence: 0 };
  const dispatcher = () => createEncounterDispatcher(() => { throw new Error("No damage should run"); }, null, {}, {
    property_rules: (action, context) => {
      const result = applyTileEntry(action, context.event, properties, entryState);
      if (result.applied) { properties = result.properties; entryState = result.entryState; }
      return result;
    }
  });
  const first = batch(entryState, properties);
  const rule = tileEntryRule(source, { propertyRules: rules });
  const active = dispatcher();
  active.dispatch({ batches: first, rules: [rule] });
  active.dispatch({ batches: first, rules: [rule] });
  assert.equal(properties.custom, 1);
  entryState = JSON.parse(JSON.stringify(entryState));
  dispatcher().dispatch({ batches: first, rules: [rule] });
  assert.equal(properties.custom, 1);
  const next = batch(entryState, properties);
  dispatcher().dispatch({ batches: next, rules: [rule] });
  assert.equal(properties.custom, 2);
  assert.equal(entryState.sequence, 2);
});

test("invalid effects commit only entry identity, not partial property changes; no-rule entries advance identity", () => {
  const state = { runId: "run", sequence: 0 };
  const first = batch(state, { custom: 0 });
  const invalid = { version: 1, blocks: [...rules.blocks, { then: [{ operation: "unsupported", property: "custom", value: 3 }] }] };
  const result = applyTileEntry({ rules: invalid }, first.events[0], { custom: 0 }, state);
  assert.deepEqual(result.properties, { custom: 0 });
  assert.equal(result.evaluation.ok, false);
  assert.equal(result.entryState.sequence, 1);
  const noRule = applyTileEntry({}, batch(result.entryState, result.properties).events[0], result.properties, result.entryState);
  assert.equal(noRule.entryState.sequence, 2);
  assert.deepEqual(noRule.properties, { custom: 0 });
});

test("checkpoint and portable carried progress preserve properties, zero presence and replay metadata across levels", () => {
  const runner = { hearts: 5, properties: { wet: 0, burning: 1 }, propertyEntry: { runId: "run", sequence: 7 } };
  const checkpoint = createCheckpointState("destination", runner);
  let stored;
  const storage = { setItem: (key, value) => { stored = value; }, getItem: () => stored };
  saveState(checkpoint, storage);
  const loaded = loadState(storage);
  assert.deepEqual(loaded.runner.properties, runner.properties);
  assert.deepEqual(loaded.runner.propertyEntry, runner.propertyEntry);
  const portable = decodeCarryStats(encodeCarryStatsFromRunner(loaded.runner));
  assert.deepEqual(portable.properties, runner.properties);
  assert.ok(Object.hasOwn(portable.properties, "wet"));
  assert.equal(Object.hasOwn(portable.properties, "absent"), false);
  assert.deepEqual(portable.propertyEntry, runner.propertyEntry);
  stored = JSON.stringify({ version: 2, runner: { hearts: 4 } });
  assert.deepEqual(loadState(storage).runner.properties, {});
  assert.deepEqual(restorePropertyEntry(loadState(storage).runner.propertyEntry, "new-run"), { runId: "new-run", sequence: 0 });
});
