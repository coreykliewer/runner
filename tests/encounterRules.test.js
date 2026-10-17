import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateEncounterDistance,
  encounterConditionMatches,
  encounterPositionMatches,
  evaluateEncounterExpression,
  inferEncounterExpressionType,
  validateEncounterRules,
  createDefaultEncounterRules
} from "../src/encounterRules.js";

describe("universal encounter rules", () => {
  it("evaluates arithmetic dice expressions without executing JavaScript", () => {
    assert.equal(evaluateEncounterExpression("d1 + d2 <= 2", { d1: 1, d2: 1 }), true);
    assert.equal(evaluateEncounterExpression("d1 + d2 <= 2", { d1: 1, d2: 2 }), false);
    assert.equal(evaluateEncounterExpression("(d1 * 2 + d2) % 2 == 1", { d1: 2, d2: 1 }), true);
    assert.throws(() => evaluateEncounterExpression("globalThis.process.exit()", { d1: 1, d2: 1 }), /Unexpected/);
    assert.throws(() => evaluateEncounterExpression("Math.max(d1, d2)", { d1: 1, d2: 2 }), /Unexpected/);
    assert.throws(() => evaluateEncounterExpression("d1 +", { d1: 1, d2: 2 }), /Unexpected/);
  });

  it("supports visual sum, parity, and exact-dice conditions", () => {
    const dice = { d1: 1, d2: 2 };
    assert.equal(encounterConditionMatches({ type: "sum_comparison", operator: "<=", value: 3 }, dice), true);
    assert.equal(encounterConditionMatches({ type: "parity", dice: "sum", parity: "odd" }, dice), true);
    assert.equal(encounterConditionMatches({ type: "exact_dice", die1: 2, die2: 1, ordered: false }, dice), true);
    assert.equal(encounterConditionMatches({ type: "exact_dice", die1: 2, die2: 1, ordered: true }, dice), false);
  });

  it("measures orthogonal and diagonal-inclusive ranges and relative positions", () => {
    assert.equal(calculateEncounterDistance(1, 1, "manhattan"), 2);
    assert.equal(calculateEncounterDistance(1, 1, "chebyshev"), 1);
    assert.equal(encounterPositionMatches(0, -1, "player_above"), true);
    assert.equal(encounterPositionMatches(0, 1, "player_below"), true);
    assert.equal(encounterPositionMatches(-1, 0, "player_left"), true);
    assert.equal(encounterPositionMatches(1, 0, "player_right"), true);
    assert.equal(encounterPositionMatches(1, 1, "player_above"), false);
  });

  it("validates encounter rules and rejects malformed or executable expressions", () => {
    const rules = createDefaultEncounterRules();
    assert.deepEqual(validateEncounterRules(rules), []);
    assert.equal(inferEncounterExpressionType("d1 + d2 <= 2"), "boolean");
    assert.equal(inferEncounterExpressionType("d1 / 2"), "number");
    rules.rules[0].conditions[0] = { type: "expression", expression: "window.alert(1)" };
    const issues = validateEncounterRules(rules);
    assert.equal(issues.some(item => item.path.endsWith(".expression")), true);
  });
});