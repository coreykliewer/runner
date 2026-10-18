import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluatePropertyRules, createPropertyRuleExecution, validatePropertyRules,
  resolvePropertyName, readBuiltInProperties, findReservedPropertyCollisions } from "../src/propertyRules.js";
import { BUILT_IN_PROPERTY_NAMES, validateBuiltInValues } from "../src/runnerPropertyNames.js";
import { createTileSystemV2DiceEngine } from "../src/tileSystemV2DiceEngine.js";
import { applyTileEntry, createTileEntryBatch } from "../src/tileEntry.js";

const native = { Hearts: 2.5, Diamonds: 3.25, XP: 1.75, Moves: 4 };
const effect = (property, value = 1, operation = "set") => ({ type: "property", property, operation, value });
const rules = (...blocks) => ({ version: 3, blocks });
const block = (...then) => ({ then });
const when = (property, value, { operator = "=", mode, type = "comparison" } = {}) => ({
  if: { type, property, ...(type === "comparison" ? { operator, value } : {}), ...(mode ? { mode } : {}) },
  then: [effect("matched")]
});
const evaluate = (definition, properties = {}, values = native) => evaluatePropertyRules(definition, properties, { nativeValues: values });

test("only the four approved names resolve to native values, case-insensitively in V3 only", () => {
  for (const name of BUILT_IN_PROPERTY_NAMES) for (const alias of [name, name.toLowerCase(), name.toUpperCase()]) {
    assert.deepEqual(resolvePropertyName(alias), { kind: "builtin", name });
    for (const version of [1, 2]) assert.deepEqual(resolvePropertyName(alias, version), { kind: "custom", name: alias });
  }
  for (const name of ["Fall", "Jumps", "Kills", "wet", "Wet", "custom-7", "heart", "score", "experience"]) {
    assert.deepEqual(resolvePropertyName(name), { kind: "custom", name });
  }
});

test("readers use real native fields and authoritative dice totals, never mirrors or achievement max lookup", () => {
  const dice = createTileSystemV2DiceEngine({ registry: { settings: { dice: { die1: { maximum: 6 }, die2: { maximum: 6 } } } }, initialDice: { die1: 2, die2: 4 } });
  const runner = { hearts: 2.5, score: 3.25, xp: 1.75, movementLeft: 999,
    properties: { hearts: 88 }, stats: { hearts: 99, xp: 99 }, counters: { score: 77 } };
  const before = structuredClone(runner);
  const getRemainingMoves = () => Object.values(dice.getState().dice).reduce((a, b) => a + b, 0);
  const snapshot = readBuiltInProperties(runner, { getRemainingMoves });
  assert.deepEqual(snapshot, { ...native, Moves: 6 });
  dice.spendTime({ actionId: "spend", cost: 3 });
  assert.equal(readBuiltInProperties(runner, { getRemainingMoves }).Moves, 3);
  assert.equal(snapshot.Moves, 6);
  assert.deepEqual(runner, before);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => readBuiltInProperties(runner), /authoritative/);
  assert.equal(readBuiltInProperties({ hearts: -0.5, score: 0 }, { getRemainingMoves: () => 0 }).Hearts, -0.5);
});

test("fractional native comparisons and built-in existence at zero use one value for every spelling", () => {
  for (const [name, value] of Object.entries(native)) for (const alias of [name.toLowerCase(), name.toUpperCase()]) {
    const result = evaluate(rules(when(alias, value)));
    assert.equal(result.blocks[0].matched, true);
    assert.equal(result.blocks[0].comparison.property, name);
    assert.equal(result.blocks[0].comparison.authoredProperty, alias);
    assert.deepEqual(result.properties, { matched: 1 });
    for (const type of ["exists", "not_exists"]) {
      const zero = Object.fromEntries(BUILT_IN_PROPERTY_NAMES.map(name => [name, 0]));
      assert.equal(evaluate(rules(when(alias, null, { type })), {}, zero).blocks[0].matched, type === "exists");
    }
  }
});

test("custom case, acquired zero and missing semantics stay separate from reserved native names", () => {
  assert.equal(evaluate(rules(when("wet", 0)), { wet: 0 }).blocks[0].matched, true);
  assert.equal(evaluate(rules(when("Wet", 0)), { wet: 0 }).blocks[0].matched, false);
  assert.equal(evaluate(rules(when("wet", 0, { operator: "!=" }))).blocks[0].matched, false);
  assert.equal(evaluate(rules(when("wet", null, { type: "not_exists" }))).blocks[0].matched, true);
  const result = evaluate(rules(block(effect("wet", 5, "subtract")), when("wet", 0, { mode: "current" })));
  assert.deepEqual(result.properties, { wet: 0, matched: 1 });
});

test("Entry snapshots remain immutable and Current native values refresh only from explicit adapter acknowledgements", () => {
  const definition = rules(block(effect("hEaRtS", 1, "add")),
    { ...when("HEARTS", 3.5, { mode: "current" }), then: [effect("current_match")] },
    { ...when("hearts", 2.5), then: [effect("entry_match")] });
  const properties = {};
  const values = { ...native };
  const execution = createPropertyRuleExecution(definition, properties, { nativeValues: values });
  const request = execution.next().value;
  assert.equal(request.effect.nativeProperty, "Hearts");
  assert.equal(request.effect.effect.property, "hEaRtS");
  assert.equal(request.effect.nativeValues.Hearts, 2.5);
  values.Hearts = 900;
  definition.blocks.reverse();
  assert.throws(() => { request.effect.nativeValues.Hearts = 4; }, TypeError);
  const result = execution.next({ status: "applied", nativeValues: { ...native, Hearts: 3.5 } }).value;
  assert.deepEqual(result.properties, { current_match: 1, entry_match: 1 });
  assert.equal(result.entryNativeValues.Hearts, 2.5);
  assert.equal(result.nativeValues.Hearts, 3.5);
  assert.equal(Object.hasOwn(result.properties, "hEaRtS"), false);
});

test("current custom and native conditions, achievements and narration follow exact authored mixed order", () => {
  const definition = rules(block(effect("charge", 1, "add")),
    { if: { type: "comparison", mode: "current", property: "charge", operator: ">=", value: 1 },
      then: [effect("XP", 2, "add"), { type: "achievement", id: "authored", title: "Authored" },
        { type: "narrative", text: "After award" }, effect("charge", 0)] },
    { ...when("xp", 3.75, { mode: "current" }), then: [effect("qualified")] });
  const execution = createPropertyRuleExecution(definition, {}, { nativeValues: native });
  const observed = [];
  let step = execution.next();
  while (!step.done) {
    observed.push(step.value.effect.nativeProperty || step.value.effect.type);
    step = execution.next({ status: "applied", nativeValues: { ...native, XP: 3.75 } });
  }
  assert.deepEqual(observed, ["XP", "achievement", "narrative"]);
  assert.deepEqual(step.value.properties, { charge: 0, qualified: 1 });
  assert.deepEqual(step.value.records.filter(item => item.kind === "effect").map(item => item.effect.property || item.type),
    ["charge", "XP", "achievement", "narrative", "charge", "qualified"]);
});

test("alternative block order changes qualification without any automatic effect sorting", () => {
  const change = block(effect("charge", 1, "add"));
  const condition = { if: { type: "comparison", mode: "current", property: "charge", operator: ">=", value: 1 }, then: [effect("Diamonds", 1, "add")] };
  assert.equal(evaluate(rules(change, condition)).status, "native_effect_required");
  assert.equal(evaluate(rules(condition, change)).status, "completed");
});

test("native terminal and uncertain outcomes stop later effects and preserve exact acknowledged fractional state", () => {
  const definition = rules(block(effect("marker", 0), effect("Hearts", 1, "subtract"), effect("should_not_run", 1)));
  const execution = createPropertyRuleExecution(definition, {}, { nativeValues: { ...native, Hearts: 0.5 } });
  execution.next();
  const result = execution.next({ status: "terminal", nativeValues: { ...native, Hearts: -0.5 } }).value;
  assert.equal(result.status, "terminal");
  assert.deepEqual(result.properties, { marker: 0 });
  assert.equal(result.nativeValues.Hearts, -0.5);
  const failed = createPropertyRuleExecution(definition, {}, { nativeValues: native });
  failed.next();
  const failure = failed.next({ status: "failed", nativeValues: { ...native, Hearts: 1.5 } }).value;
  assert.equal(failure.status, "failed");
  assert.equal(failure.nativeValues.Hearts, 1.5);
});

test("native acknowledgements cannot silently reuse stale values or invent missing built-ins", () => {
  for (const acknowledgement of [{ status: "applied" }, { status: "terminal" },
    { status: "applied", nativeValues: { Hearts: 2 } }, { status: "applied", nativeValues: { ...native, Moves: 1.5 } }]) {
    const execution = createPropertyRuleExecution(rules(block(effect("XP", 1, "add"), effect("wrong", 1))), {}, { nativeValues: native });
    execution.next();
    const result = execution.next(acknowledgement).value;
    assert.equal(result.status, "failed");
    assert.equal(result.ok, false);
    assert.equal(result.properties.wrong, undefined);
    assert.ok(result.diagnostics.some(item => item.code === "native_effect_failed"));
  }
});

test("Moves writes and invalid native operands reject the entire definition before yielding", () => {
  for (const name of ["Moves", "moves", "MOVES", "mOvEs"]) for (const operation of ["set", "add", "subtract"]) {
    assert.ok(validatePropertyRules(rules(block(effect(name, 1, operation)))).some(item => item.code === "read_only_property"));
  }
  for (const name of ["Hearts", "Diamonds", "XP"]) for (const operand of [-1, 0.5, "1", null, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
    const definition = rules(block({ type: "narrative", text: "Must not yield" }, effect(name, operand)));
    const first = createPropertyRuleExecution(definition, {}, { nativeValues: native }).next();
    assert.equal(first.done, true);
    assert.equal(first.value.status, "invalid");
    assert.deepEqual(first.value.effects, []);
  }
  for (const name of ["Hearts", "Diamonds", "XP"]) for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(validatePropertyRules(rules(block(effect(name, value)))), []);
  }
  assert.deepEqual(validatePropertyRules(rules(block(effect("custom", -0.5, "add")))), []);
  assert.ok(validatePropertyRules(rules(block({ type: "lose_hearts", amount: 0.5 }))).length);
  assert.deepEqual(validatePropertyRules({ version: 2, blocks: [block({ type: "lose_hearts", amount: 0.5 })] }), []);
});

test("native snapshots fail closed, never default to disconnected zero copies", () => {
  const definition = rules(when("Hearts", 0));
  for (const nativeValues of [undefined, null, {}, { ...native, hearts: 0 }, { ...native, Diamonds: -1 }, { ...native, XP: NaN }]) {
    const result = evaluatePropertyRules(definition, {}, { nativeValues });
    assert.equal(result.ok, false);
    assert.equal(result.status, "invalid");
    assert.deepEqual(result.effects, []);
  }
  assert.deepEqual(validateBuiltInValues(native), []);
});

test("legacy collision reports are precise and V1/V2 meanings are not converted or merged", () => {
  for (const version of [1, 2]) {
    const then = version === 1 ? [{ operation: "add", property: "hEaRtS", value: 1 }] : [effect("hEaRtS", 1, "add")];
    const definition = { version, blocks: [{ if: { ...(version === 2 ? { type: "comparison" } : {}), property: "XP", operator: "=", value: 4 }, then }] };
    const before = structuredClone(definition);
    const collisions = findReservedPropertyCollisions(definition, { hEaRtS: 7, XP: 4 });
    assert.deepEqual(collisions.map(item => item.canonicalName), ["XP", "Hearts", "Hearts", "XP"]);
    assert.ok(collisions.every(item => item.path && item.code === "reserved_property_collision"));
    assert.deepEqual(evaluatePropertyRules(definition, { hEaRtS: 7, XP: 4 }).properties, { hEaRtS: 8, XP: 4 });
    assert.deepEqual(definition, before);
  }
  const stored = { Hearts: 7, wet: 0 };
  const result = evaluate(rules(block(effect("custom", 1))), stored);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.code === "reserved_property_collision"));
  assert.deepEqual(stored, { Hearts: 7, wet: 0 });
  assert.deepEqual(findReservedPropertyCollisions(null, { legacy_hearts: 7 }), []);
});

test("old gameplay entry integration cannot activate V3 or change native/custom values in Phase A", () => {
  const definition = rules(block(effect("marker", 1), effect("Hearts", 1, "subtract")));
  const entryState = { runId: "phase-a", sequence: 0 };
  const batch = createTileEntryBatch({ entryState, from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, properties: {}, cause: "test", source: { instanceId: "test" } });
  const result = applyTileEntry({ rules: definition }, batch.events[0], {}, entryState);
  assert.equal(result.evaluation.status, "invalid");
  assert.deepEqual(result.properties, {});
  const standalone = evaluate(definition);
  assert.equal(standalone.status, "native_effect_required");
  assert.deepEqual(standalone.properties, { marker: 1 }); // Informational only, never a live commit.
});

test("V3 results are deterministic immutable JSON and schema restrictions match alias resolution", async () => {
  const definition = rules(when("xp", 1.75));
  const before = structuredClone(definition);
  const result = evaluate(definition);
  assert.deepEqual(evaluate(definition), result);
  assert.deepEqual(definition, before);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.throws(() => { result.entryNativeValues.XP = 0; }, TypeError);
  assert.equal(Object.isFrozen(native), false);
  const schema = JSON.parse(await readFile(new URL("../schemas/runner-property-rules.schema.json", import.meta.url)));
  assert.deepEqual(schema.oneOf.map(branch => branch.properties.version.const), [1, 2, 3]);
  const constraints = schema.$defs.v3Effect.oneOf[0].allOf;
  const nativePattern = new RegExp(constraints[1].if.properties.property.pattern);
  const movesPattern = new RegExp(constraints[0].not.properties.property.pattern);
  for (const name of ["Hearts", "hearts", "DIAMONDS", "XP", "mOvEs", "wet", "heart", "Moves\n"]) {
    assert.equal(nativePattern.test(name), resolvePropertyName(name).kind === "builtin");
    assert.equal(movesPattern.test(name), resolvePropertyName(name).name === "Moves");
  }
  assert.equal(constraints[1].then.properties.value.minimum, 0);
  assert.equal(schema.$defs.v3Effect.oneOf[1].properties.amount.minimum, 1);
});
