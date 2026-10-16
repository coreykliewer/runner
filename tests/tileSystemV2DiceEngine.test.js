import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTileSystemV2DiceEngine } from "../src/tileSystemV2DiceEngine.js";

function registry({ die1 = 6, die2 = 6 } = {}) {
  return {
    settings: { dice: { die1: { maximum: die1 }, die2: { maximum: die2 } } }
  };
}

describe("Phase 2A dice/time transaction engine", () => {
  it("spends selected die first and emits the required independent overflow snapshots", () => {
    const engine = createTileSystemV2DiceEngine({
      registry: registry(),
      initialDice: { die1: 2, die2: 4 },
      selectedDie: "die1",
      currentRollId: "roll-1"
    });
    const result = engine.spendTime({ actionId: "spend-1", cost: 3 });

    assert.equal(result.ok, true);
    assert.equal(result.remainingTime, 3);
    assert.deepEqual(result.state.dice, { die1: 0, die2: 3 });
    assert.equal(result.batch.events.length, 2);
    assert.deepEqual(result.batch.events.map(event => [event.die, event.before, event.after]), [
      ["die1", { die1: 2, die2: 4 }, { die1: 0, die2: 4 }],
      ["die2", { die1: 0, die2: 4 }, { die1: 0, die2: 3 }]
    ]);
    assert.deepEqual(result.batch.events.map(event => event.sequence), [1, 2]);
    assert.ok(Object.isFrozen(result.batch.events[0].after));
    assert.throws(() => { result.batch.events[0].after.die1 = 5; }, TypeError);
  });

  it("spends overflow from the other selected-first pool without partial spending when unaffordable", () => {
    const engine = createTileSystemV2DiceEngine({
      registry: registry(),
      initialDice: { die1: 2, die2: 4 },
      selectedDie: "die2",
      currentRollId: "roll-1"
    });
    const enough = engine.spendTime({ actionId: "spend-2", cost: 5 });
    assert.equal(enough.ok, true);
    assert.deepEqual(enough.batch.events.map(event => [event.die, event.after]), [
      ["die2", { die1: 2, die2: 0 }],
      ["die1", { die1: 1, die2: 0 }]
    ]);

    const before = engine.getState();
    const rejected = engine.spendTime({ actionId: "spend-3", cost: 4 });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "unaffordable");
    assert.equal(rejected.batch, null);
    assert.deepEqual(rejected.state, before);
    assert.deepEqual(engine.getState(), before);
  });

  it("rejects a later invalid mutation atomically after earlier changes were staged", () => {
    const engine = createTileSystemV2DiceEngine({
      registry: registry(),
      initialDice: { die1: 2, die2: 4 },
      currentRollId: "roll-1"
    });
    const before = engine.getState();
    const result = engine.changeDice({
      actionId: "atomic-1",
      changes: [
        { die: "die1", operation: "add", amount: 1 },
        { die: "die2", operation: "add", amount: 99 }
      ]
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "capacity-violation");
    assert.deepEqual(engine.getState(), before);
  });

  it("resolves level capacities per die over global capacity", () => {
    const engine = createTileSystemV2DiceEngine({
      registry: registry({ die1: 6, die2: 8 }),
      level: { diceCapacities: { die1: 12 } },
      initialDice: { die1: 10, die2: 8 }
    });
    assert.deepEqual(engine.getState().capacities, { die1: 12, die2: 8 });
    assert.equal(engine.changeDice({ actionId: "receive-1", changes: [{ die: "die1", operation: "add", amount: 2 }] }).ok, true);
    assert.equal(engine.changeDice({ actionId: "receive-2", changes: [{ die: "die2", operation: "add", amount: 1 }] }).ok, false);
  });

  it("emits two ordered reroll events when a value is unchanged and charges one roll", () => {
    const engine = createTileSystemV2DiceEngine({
      registry: registry(),
      initialDice: { die1: 4, die2: 2 },
      playerRollCount: 1,
      playerRollLimit: 3,
      currentRollId: "roll-1"
    });
    const result = engine.earlyReroll({ actionId: "reroll-1", values: { die1: 4, die2: 5 } });
    assert.equal(result.ok, true);
    assert.equal(result.discardedTime, 6);
    assert.equal(result.state.playerRollCount, 2);
    assert.equal(result.batch.events.length, 2);
    assert.deepEqual(result.batch.events.map(event => event.type), ["die_rerolled", "die_rerolled"]);
    assert.deepEqual(result.batch.events.map(event => event.valueChanged), [false, true]);
    assert.deepEqual(result.batch.events[0].before, { die1: 4, die2: 2 });
    assert.deepEqual(result.batch.events[0].after, { die1: 4, die2: 2 });
    assert.deepEqual(result.batch.events[1].after, { die1: 4, die2: 5 });
  });

  it("enforces roll limit and distinguishes normal rolls from early rerolls", () => {
    const engine = createTileSystemV2DiceEngine({
      registry: registry(),
      initialDice: { die1: 0, die2: 0 },
      playerRollLimit: 1
    });
    const firstRoll = engine.startRoll({ actionId: "roll-1", values: { die1: 2, die2: 4 } });
    assert.equal(firstRoll.ok, true);
    assert.equal(firstRoll.state.playerRollCount, 1);
    assert.equal(firstRoll.batch.events[0].type, "die_rolled");
    const early = engine.earlyReroll({ actionId: "reroll-limit", values: { die1: 1, die2: 1 } });
    assert.equal(early.ok, false);
    assert.equal(early.code, "roll-limit-reached");
    assert.deepEqual(early.state, firstRoll.state);
    const ordinary = engine.startRoll({ actionId: "roll-early", values: { die1: 1, die2: 1 } });
    assert.equal(ordinary.code, "unused-time-remains");
  });

  it("rejects malformed and out-of-capacity transactions without partial changes", () => {
    const engine = createTileSystemV2DiceEngine({ registry: registry(), initialDice: { die1: 2, die2: 4 } });
    const before = engine.getState();
    assert.equal(engine.spendTime({ actionId: "fraction", cost: 0.5 }).code, "invalid-cost");
    assert.equal(engine.changeDice({ actionId: "over-cap", changes: [{ die: "die1", operation: "set", value: 7 }] }).code, "capacity-violation");
    assert.deepEqual(engine.getState(), before);
    assert.equal(engine.earlyReroll({ actionId: "bad-roll", values: { die1: 0, die2: 4 } }).code, "invalid-roll");
    assert.deepEqual(engine.getState(), before);
  });
});