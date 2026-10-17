import { test } from "node:test";
import assert from "node:assert/strict";
import { createTileSystemV2DiceEngine } from "../src/tileSystemV2DiceEngine.js";

for (const [die1, die2] of [[0, 1], [1, 0], [0, 0], [1, 1]]) {
  for (const budget of ["remaining", "exhausted", "unlimited"]) {
    test(`dice engine Roll at (${die1},${die2}) with ${budget} rolls`, () => {
      const limit = budget === "unlimited" ? null : 2;
      const used = budget === "exhausted" ? 2 : 1;
      const engine = createTileSystemV2DiceEngine({
        registry: { settings: { dice: { die1: { maximum: 6 }, die2: { maximum: 6 } } } },
        initialDice: { die1, die2 }, playerRollLimit: limit, playerRollCount: used
      });
      const before = engine.getState();
      const action = { actionId: "roll-attempt", values: { die1: 2, die2: 3 } };
      const closing = engine.endTurn({ actionId: "close" });
      assert.equal(closing.discardedTime, die1 + die2);
      assert.deepEqual(engine.getState().dice, { die1: 0, die2: 0 });
      assert.equal(engine.endTurn({ actionId: "duplicate" }).lifecycleBatch, null);
      const closed = engine.getState();
      const result = engine.startRoll(action);
      if (budget === "exhausted") {
        assert.equal(result.ok, false);
        assert.equal(result.code, "roll-limit-reached");
        assert.equal(result.batch, null);
        assert.deepEqual(engine.getState(), closed);
        return;
      }
      assert.equal(result.ok, true);
      assert.equal(result.discardedTime, 0);
      assert.equal(result.state.playerRollCount, used + 1);
      assert.deepEqual(result.state.dice, { die1: 2, die2: 3 });
      assert.deepEqual(result.batch.events.map(event => event.after), [{ die1: 2, die2: 0 }, { die1: 2, die2: 3 }]);
      assert.deepEqual(result.batch.events[0].before, { die1: 0, die2: 0 });
      assert.ok(Object.isFrozen(result.batch.events[0].after));
      if (budget === "remaining") {
        const blocked = engine.earlyReroll({ ...action, actionId: "one-too-many" });
        assert.equal(blocked.code, "roll-limit-reached");
        assert.equal(engine.getState().playerRollCount, 2);
      }
    });
  }
}
