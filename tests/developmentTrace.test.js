import { test } from "node:test";
import assert from "node:assert/strict";
import { createDevelopmentTrace, developmentTraceEnabled } from "../src/developmentTrace.js";
import { createEncounterDispatcher, encounterDispatcherRules } from "../src/encounterIntegration.js";
import { createTileSystemV2DiceEngine } from "../src/tileSystemV2DiceEngine.js";
import { createEncounterPlaytest } from "../fixtures/encounter-playtest.js";
import { readFile } from "node:fs/promises";

test("diagnostics require an explicit local opt-in and retain bounded immutable copies", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(developmentTraceEnabled({ hostname, search: "?runnerTrace=1" }), true);
    assert.equal(developmentTraceEnabled({ hostname, search: "" }), false);
  }
  assert.equal(developmentTraceEnabled({ hostname: "runner.example", search: "?runnerTrace=1" }), false);
  const trace = createDevelopmentTrace({ limit: 2 });
  const event = { type: "dice_mutation", after: { die1: 2, die2: 4 } };
  trace.record(event);
  event.after.die1 = 99;
  const saved = trace.snapshot();
  assert.equal(saved.records[0].after.die1, 2);
  assert.throws(() => { saved.records[0].after.die1 = 8; }, TypeError);
  trace.record({ type: "second" });
  trace.record({ type: "third" });
  assert.deepEqual(trace.snapshot().records.map(r => r.traceSequence), [2, 3]);
  assert.equal(trace.snapshot().dropped, 1);
  assert.equal(saved.records.length, 1);
  trace.clear();
  assert.deepEqual(trace.snapshot(), { dropped: 0, records: [] });
});

test("dispatcher observers explain matches, priority, suppression and effects without changing resolution", async () => {
  const { registry } = createEncounterPlaytest(JSON.parse(await readFile("tiles2.legacy.json", "utf8")));
  const creature = registry.tiles.find(tile => tile.name === "Snapshot sentinel");
  const rules = encounterDispatcherRules([{ definition: creature.definition, instanceId: "placed-sentinel", tileId: creature.id, x: 2, y: 0 }], "after_move");
  const engine = createTileSystemV2DiceEngine({ registry, initialDice: { die1: 2, die2: 4 } });
  const batch = engine.spendTime({ actionId: "move", cost: 3 }).batch;
  const run = observer => {
    let damage = 0;
    const dispatcher = createEncounterDispatcher(effect => { damage += effect.amount; return { traceDetails: { amount: effect.amount } }; }, observer);
    const result = dispatcher.dispatch({ batches: batch, rules, context: { player: { x: 2, y: 1 } } });
    dispatcher.dispatch({ batches: batch, rules, context: { player: { x: 2, y: 1 } } });
    return { result, damage };
  };
  const trace = createDevelopmentTrace();
  const observed = run(record => {
    assert.ok(Object.isFrozen(record));
    trace.record(record);
  });
  assert.deepEqual(run(null), observed);
  assert.deepEqual(run(() => { throw new Error("broken inspector"); }), observed);
  assert.equal(observed.damage, 1);
  const records = trace.snapshot().records;
  assert.deepEqual(records.filter(r => r.type === "consequence_ordered").map(r => r.priority), [10, 0]);
  assert.ok(records.some(r => r.type === "rule_evaluated" && r.matched === false));
  assert.ok(records.some(r => r.type === "attack_suppressed" && r.sourceInstanceId === "placed-sentinel"));
  assert.equal(records.filter(r => r.type === "event_suppressed").length, 2);
  assert.equal(records.find(r => r.type === "consequence_applied").result.amount, 1);
});
