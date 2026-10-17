import { test } from "node:test";
import assert from "node:assert/strict";
import { createEncounterDispatcher, encounterDispatcherRules, encounterOwner } from "../src/encounterIntegration.js";
import { createTileSystemV2DiceEngine } from "../src/tileSystemV2DiceEngine.js";

test("spatial authored attacks use captured snapshots and share global attacker priority", () => {
  const engine = createTileSystemV2DiceEngine({ registry: { settings: { dice: { die1: { maximum: 6 }, die2: { maximum: 6 } } } }, initialDice: { die1: 2, die2: 4 } });
  const batch = engine.spendTime({ actionId: "move", cost: 3 }).batch;
  assert.deepEqual(batch.events.map(e => e.after), [{ die1: 0, die2: 4 }, { die1: 0, die2: 3 }]);
  const makeRule = (id, value, priority, order) => ({ id, priority, order, trigger: { events: ["after_move"], minDistance: 1, maxDistance: 1, distance: "manhattan", position: "player_left" }, conditions: [{ type: "sum_comparison", operator: "<=", value }], actions: [{ type: "damage", amount: 1 }] });
  const definition = { encounterRules: { enabled: true, rules: [makeRule("early", 4, 0, 1), makeRule("late", 3, 10, 2)] } };
  assert.equal(encounterOwner(definition), "dispatcher");
  assert.equal(encounterOwner({ monster: {} }), "legacy");
  const rules = encounterDispatcherRules([{ definition, instanceId: "creature", x: 3, y: 1 }], "after_move");
  const seen = [];
  const dispatcher = createEncounterDispatcher((action, context) => seen.push(context));
  dispatcher.dispatch({ batches: batch, rules, context: { player: { x: 1, y: 1 } } });
  assert.equal(seen.length, 0);
  // A fresh dispatcher represents actual gameplay dispatch after movement settles.
  const active = createEncounterDispatcher((action, context) => { seen.push(context); });
  active.dispatch({ batches: batch, rules, context: { player: { x: 2, y: 1 } } });
  assert.equal(seen.length, 1);
  assert.match(seen[0].rule.id, /late$/);
  assert.equal(seen[0].event.after.die2, 3);
  active.dispatch({ batches: batch, rules, context: { player: { x: 2, y: 1 } } });
  assert.equal(seen.length, 1);
  const next = engine.spendTime({ actionId: "next-move", cost: 1 }).batch;
  active.dispatch({ batches: next, rules, context: { player: { x: 2, y: 1 } } });
  assert.equal(seen.length, 1, "another action in the same roll cannot attack again");
  const tied = createEncounterDispatcher((action, context) => { seen.push(context); });
  const ties = rules.map(rule => ({ ...rule, priority: 0 }));
  tied.dispatch({ batches: batch, rules: ties.reverse(), context: { player: { x: 2, y: 1 } } });
  assert.match(seen[1].rule.id, /early$/, "authored order breaks priority ties");
});
