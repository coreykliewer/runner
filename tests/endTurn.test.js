import { test } from "node:test";
import assert from "node:assert/strict";
import { createTileSystemV2DiceEngine } from "../src/tileSystemV2DiceEngine.js";
import { createTileSystemV2RuleDispatcher } from "../src/tileSystemV2RuleDispatcher.js";
import { createTurnEndedBatch, decodeTurnEventBatch } from "../src/turnEvents.js";

const registry = { settings: { dice: { die1: { maximum: 6 }, die2: { maximum: 6 } } } };
test("initial zero dice do not close a nonexistent turn; exhausted active zero dice still end once", () => {
  const idle = createTileSystemV2DiceEngine({ registry });
  assert.equal(idle.endTurn({ actionId: "initial" }).lifecycleBatch, null);
  const active = createTileSystemV2DiceEngine({ registry, playerRollCount: 1 });
  const end = active.endTurn({ actionId: "close" });
  assert.equal(end.batch, null);
  assert.equal(end.lifecycleBatch.events[0].type, "turn_ended");
  assert.equal(active.endTurn({ actionId: "retry" }).lifecycleBatch, null);
  const restored = createTileSystemV2DiceEngine({ registry, playerRollCount: 1,
    currentRollId: end.state.currentRollId, turnPhase: end.state.turnPhase });
  assert.equal(restored.endTurn({ actionId: "resume" }).lifecycleBatch, null);
  assert.throws(() => { end.lifecycleBatch.events[0].after.die1 = 9; }, TypeError);
  assert.throws(() => decodeTurnEventBatch({ ...end.lifecycleBatch, events: [] }));
});

test("discard order ignores selected die, preserves the closing roll, and suppresses unchanged mutations", () => {
  const engine = createTileSystemV2DiceEngine({ registry, initialDice: { die1: 1, die2: 1 },
    selectedDie: "die2", currentRollId: "closing", playerRollCount: 1, playerRollLimit: 1 });
  const end = engine.endTurn({ actionId: "close" });
  assert.deepEqual(end.batch.events.map(e => [e.die, e.after]), [["die1", { die1: 0, die2: 1 }], ["die2", { die1: 0, die2: 0 }]]);
  assert.equal(end.lifecycleBatch.rollId, "closing");
  assert.equal(end.state.playerRollCount, 1);
  assert.equal(engine.startRoll({ actionId: "no-budget", values: { die1: 2, die2: 3 } }).code, "roll-limit-reached");
});

test("restored dispatcher guards suppress attacks and rewards without replaying effects", () => {
  let damage = 0;
  let rewards = 0;
  const handlers = { damage: () => { damage++; }, reward: () => { rewards++; } };
  const batch = createTurnEndedBatch("close", "roll-one", { die1: 0, die2: 0 });
  const attack = { id: "attack", sourceInstanceId: "creature", priority: 0, authorOrder: 1,
    trigger: { events: ["turn_ended"] }, conditions: [{ type: "dice_sum", operator: "==", value: 0 }], actions: [{ type: "damage", amount: 1 }] };
  const reward = { ...attack, id: "reward", activation: { scope: "once_per_turn" }, actions: [{ type: "reward" }] };
  const first = createTileSystemV2RuleDispatcher({ effectHandlers: handlers });
  first.dispatch({ batches: batch, rules: [attack, reward] });
  const restored = createTileSystemV2RuleDispatcher({ effectHandlers: handlers,
    initialLedger: JSON.parse(JSON.stringify(first.getLedgerSnapshot())) });
  restored.dispatch({ batches: batch, rules: [attack, reward] });
  restored.dispatch({ batches: createTurnEndedBatch("other-action", "roll-one", { die1: 0, die2: 0 }), rules: [attack, reward] });
  assert.equal(damage, 1);
  assert.equal(rewards, 1);
});
