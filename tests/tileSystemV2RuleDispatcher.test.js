import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTileSystemV2RuleDispatcher } from "../src/tileSystemV2RuleDispatcher.js";

function makeBatch({ actionId, parentActionId = null, rollId = "roll-1", changes, source = { kind: "test" } }) {
  let current = { die1: changes[0]?.before?.die1 ?? 0, die2: changes[0]?.before?.die2 ?? 0 };
  const events = changes.map((change, index) => {
    const before = { ...current };
    current = { ...current, [change.die]: change.value };
    return {
      eventId: `${actionId}:${index + 1}`,
      actionId,
      parentActionId,
      sequence: index + 1,
      type: change.type || "die_changed",
      die: change.die,
      operation: change.operation || (change.type === "die_rerolled" ? "reroll" : "spend"),
      before,
      after: { ...current },
      valueChanged: before[change.die] !== current[change.die],
      rollId,
      source: { ...source, ...(change.source || {}) }
    };
  });
  return { format: "runner.dice-event-batch", version: 1, actionId, parentActionId, rollId, events };
}

function rule({ id, priority = 0, authorOrder = 1, condition = { type: "dice_sum", operator: ">=", value: 0 }, effect, activation, sourceInstanceId } = {}) {
  return {
    id,
    priority,
    authorOrder,
    ...(sourceInstanceId ? { sourceInstanceId } : {}),
    trigger: { events: ["die_changed"], ...(effect?.eventType ? { events: [effect.eventType] } : {}) },
    conditions: [condition],
    actions: [{ type: effect.type, ...(effect.value === undefined ? {} : { value: effect.value }), ...(effect.target ? { target: effect.target } : {}) }],
    ...(activation ? { activation: { scope: activation } } : {})
  };
}

describe("Phase 2A deterministic rule dispatcher", () => {
  it("evaluates the cost-3 spend against each independently captured snapshot", () => {
    const batch = makeBatch({
      actionId: "spend-1",
      changes: [
        { die: "die1", before: { die1: 2, die2: 4 }, value: 0 },
        { die: "die2", value: 3 }
      ],
      source: { kind: "movement" }
    });
    const seen = [];
    const result = createTileSystemV2RuleDispatcher({
      effectHandlers: {
        record: (effect, context) => {
          seen.push({ tag: effect.value, snapshot: context.event.after });
          return {};
        }
      }
    }).dispatch({
      batches: batch,
      rules: [
        rule({ id: "snapshot-0-4", authorOrder: 1, condition: { type: "dice_sum", operator: "==", value: 4 }, effect: { type: "record", value: "first" } }),
        rule({ id: "snapshot-0-3", authorOrder: 2, condition: { type: "dice_sum", operator: "==", value: 3 }, effect: { type: "record", value: "second" } })
      ]
    });
    assert.deepEqual(batch.events.map(event => event.after), [{ die1: 0, die2: 4 }, { die1: 0, die2: 3 }]);
    assert.deepEqual(seen, [
      { tag: "first", snapshot: { die1: 0, die2: 4 } },
      { tag: "second", snapshot: { die1: 0, die2: 3 } }
    ]);
    assert.ok(Object.isFrozen(result.applied));
  });

  it("runs higher priority first, then stable author order, and suppresses duplicate consequences per action", () => {
    const order = [];
    const batch = makeBatch({ actionId: "multi-snapshot", changes: [
      { die: "die1", before: { die1: 3, die2: 3 }, value: 2 },
      { die: "die2", value: 2 }
    ] });
    const result = createTileSystemV2RuleDispatcher({
      effectHandlers: { mark: effect => { order.push(effect.value); return {}; } }
    }).dispatch({
      batches: batch,
      rules: [
        rule({ id: "low", priority: 1, authorOrder: 1, effect: { type: "mark", value: "low" } }),
        rule({ id: "high-late", priority: 10, authorOrder: 2, effect: { type: "mark", value: "high-late" } }),
        rule({ id: "high-first", priority: 10, authorOrder: 1, effect: { type: "mark", value: "high-first" } })
      ]
    });
    assert.deepEqual(order, ["high-first", "high-late", "low"]);
    assert.equal(result.applied.filter(entry => entry.ruleId === "high-first").length, 1);
    assert.equal(result.applied.filter(entry => entry.ruleId === "high-late").length, 1);
    assert.equal(result.applied.filter(entry => entry.ruleId === "low").length, 1);
    assert.equal(result.applied.find(entry => entry.ruleId === "high-first").eventId, "multi-snapshot:1");
  });

  it("orders consequences by priority across different snapshots in one action", () => {
    const order = [];
    const batch = makeBatch({ actionId: "priority-snapshots", changes: [
      { die: "die1", before: { die1: 2, die2: 4 }, value: 0 },
      { die: "die2", value: 3 }
    ] });
    createTileSystemV2RuleDispatcher({
      effectHandlers: { mark: effect => { order.push(effect.value); return {}; } }
    }).dispatch({
      batches: batch,
      rules: [
        rule({ id: "early-low", priority: 1, authorOrder: 1, condition: { type: "dice_sum", operator: "==", value: 4 }, effect: { type: "mark", value: "early-low" } }),
        rule({ id: "late-high", priority: 10, authorOrder: 1, condition: { type: "dice_sum", operator: "==", value: 3 }, effect: { type: "mark", value: "late-high" } })
      ]
    });
    assert.deepEqual(order, ["late-high", "early-low"]);
  });

  it("defaults Runner-targeting damage to once per attacker instance per player roll across actions", () => {
    let attacks = 0;
    const dispatcher = createTileSystemV2RuleDispatcher({ effectHandlers: { damage: () => { attacks++; return {}; } } });
    const attackRule = {
      id: "bite", priority: 1, authorOrder: 1, sourceInstanceId: "attacker-1",
      trigger: { events: ["die_changed"] },
      conditions: [{ type: "dice_sum", operator: ">=", value: 0 }],
      actions: [{ type: "damage", target: "runner", amount: 1 }]
    };
    const result = dispatcher.dispatch({
      batches: [
        makeBatch({ actionId: "a1", rollId: "roll-x", changes: [{ die: "die1", before: { die1: 0, die2: 0 }, value: 1 }], source: { kind: "attacker", instanceId: "attacker-1" } }),
        makeBatch({ actionId: "a2", rollId: "roll-x", changes: [{ die: "die2", before: { die1: 1, die2: 0 }, value: 1 }], source: { kind: "attacker", instanceId: "attacker-1" } })
      ],
      rules: [attackRule]
    });
    assert.equal(attacks, 1);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(dispatcher.getLedgerSnapshot().attackerRollKeys.length, 1);
  });

  it("lets the higher-priority same-attacker rule win across different dice snapshots without duplicate attacks", () => {
    const appliedAttacks = [];
    const dispatcher = createTileSystemV2RuleDispatcher({
      effectHandlers: { damage: (effect, context) => { appliedAttacks.push({ amount: effect.amount, eventId: context.event.eventId }); return {}; } }
    });
    const batch = makeBatch({
      actionId: "move-cost-3",
      rollId: "roll-7",
      changes: [
        { die: "die1", before: { die1: 2, die2: 4 }, value: 0 },
        { die: "die2", value: 3 }
      ],
      source: { kind: "movement", instanceId: "rat-instance" }
    });
    const lowPriorityAttack = {
      id: "rat-attack-on-first-snapshot",
      priority: 10,
      authorOrder: 1,
      sourceInstanceId: "rat-instance",
      trigger: { events: ["die_changed"] },
      conditions: [{ type: "dice_sum", operator: "==", value: 4 }],
      actions: [{ type: "damage", target: "runner", amount: 1 }]
    };
    const highPriorityAttack = {
      id: "rat-attack-on-second-snapshot",
      priority: 20,
      authorOrder: 1,
      sourceInstanceId: "rat-instance",
      trigger: { events: ["die_changed"] },
      conditions: [{ type: "dice_sum", operator: "==", value: 3 }],
      actions: [{ type: "damage", target: "runner", amount: 2 }]
    };

    const result = dispatcher.dispatch({ batches: batch, rules: [lowPriorityAttack, highPriorityAttack] });
    assert.deepEqual(batch.events.map(event => event.after), [{ die1: 0, die2: 4 }, { die1: 0, die2: 3 }]);
    assert.deepEqual(appliedAttacks, [{ amount: 2, eventId: "move-cost-3:2" }]);
    assert.equal(result.applied.length, 1);
    assert.equal(dispatcher.getLedgerSnapshot().attackerRollKeys.length, 1);
  });

  it("queues consequence-created child actions FIFO and stops a repeated cycle", () => {
    const order = [];
    const parent = makeBatch({ actionId: "root", changes: [{ die: "die1", before: { die1: 0, die2: 0 }, value: 1 }], source: { kind: "root" } });
    const childBatch = (actionId, parentActionId, sourceKind) => makeBatch({
      actionId,
      parentActionId,
      changes: [{ die: "die2", before: { die1: 1, die2: 0 }, value: 1, source: { kind: sourceKind } }],
      source: { kind: sourceKind }
    });
    const result = createTileSystemV2RuleDispatcher({
      effectHandlers: {
        spawn: (_effect, context) => {
          order.push(context.event.source.kind);
          if (context.event.source.kind === "root") return { childActions: [
            { batch: childBatch("child-a", "root", "child-a") },
            { batch: childBatch("child-b", "root", "child-b") }
          ] };
          return {};
        }
      }
    }).dispatch({ batches: parent, rules: [rule({ id: "spawner", effect: { type: "spawn" } })] });
    assert.deepEqual(order, ["root", "child-a", "child-b"]);
    assert.equal(result.processedChildActions, 2);

    let cycleChildId = 0;
    const cycleDispatcher = createTileSystemV2RuleDispatcher({
      effectHandlers: { spawn: (_effect, context) => ({ childActions: [{ batch: childBatch(`cycle-child-${++cycleChildId}`, context.actionId, "root") }] }) }
    });
    const cycleResult = cycleDispatcher.dispatch({ batches: parent, rules: [rule({ id: "spawner", effect: { type: "spawn" } })] });
    assert.ok(cycleResult.diagnostics.some(item => item.code === "action_cycle_detected"));
  });

  it("stops at 64 child actions with a diagnostic and preserves completed state", () => {
    const root = makeBatch({ actionId: "limit-root", changes: [{ die: "die1", before: { die1: 0, die2: 0 }, value: 1, source: { instanceId: "step-0" } }], source: { kind: "step", instanceId: "step-0" } });
    const dispatcher = createTileSystemV2RuleDispatcher({
      effectHandlers: {
        advance: (_effect, context) => {
          const nextIndex = Number(context.event.source.instanceId.slice(5)) + 1;
          const nextSource = `step-${nextIndex}`;
          return {
            state: { completed: nextIndex },
            childActions: [{
              batch: makeBatch({
                actionId: `child-${nextIndex}`,
                parentActionId: context.actionId,
                changes: [{ die: "die1", before: { die1: 0, die2: 0 }, value: 1, source: { instanceId: nextSource } }],
                source: { kind: "step", instanceId: nextSource }
              })
            }]
          };
        }
      }
    });
    const result = dispatcher.dispatch({ batches: root, rules: [rule({ id: "advance", effect: { type: "advance" } })] });
    assert.equal(result.processedChildActions, 64);
    assert.equal(result.state.completed, 65);
    assert.equal(result.stoppedAddingChildren, true);
    assert.ok(result.diagnostics.some(item => item.code === "child_action_limit"));
  });

  it("returns diagnostics for invalid batches and unregistered generic effect types", () => {
    const valid = makeBatch({ actionId: "generic", changes: [{ die: "die1", before: { die1: 0, die2: 0 }, value: 1 }] });
    const dispatcher = createTileSystemV2RuleDispatcher();
    const invalid = structuredClone(valid);
    invalid.events[0].sequence = 0;
    const result = dispatcher.dispatch({
      batches: [invalid, valid],
      rules: [rule({ id: "unhandled", effect: { type: "custom_typed_effect" } })]
    });
    assert.ok(result.diagnostics.some(item => item.code === "invalid_event_batch"));
    assert.ok(result.diagnostics.some(item => item.code === "unregistered_effect"));
  });
});