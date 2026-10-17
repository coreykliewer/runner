import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { evaluatePropertyRules, validatePropertyRules, validateTilePropertyRules, validateRunnerProperties,
  PROPERTY_ID_PATTERN, PROPERTY_OPERATIONS, PROPERTY_COMPARISONS } from "../src/propertyRules.js";

const fixtures = JSON.parse(await readFile(new URL("../fixtures/property-rules.json", import.meta.url), "utf8"));
const effect = (operation, property, value) => ({ operation, property, value });
const condition = (property, operator, value) => ({ property, operator, value });
const document = (...blocks) => ({ version: 1, blocks });
const block = (...then) => ({ then });
const enter = (name, properties) => evaluatePropertyRules(fixtures.tiles[name].propertyRules, properties);

test("Water, Air and Fire are fixture-only data and repeated entries capture fresh snapshots", () => {
  const wet = enter("Water", {});
  assert.deepEqual(wet.properties, { Wet: 3 });
  assert.deepEqual(enter("Water", wet.properties).properties, { Wet: 3 });
  const burning = enter("Fire", wet.properties);
  assert.deepEqual(burning.entrySnapshot, { Wet: 3 });
  assert.deepEqual(burning.properties, { Wet: 1, Steam: 1 });
  assert.deepEqual(burning.blocks.map(item => item.matched), [true, false]);
  // The second IF sees entry Wet=3, not the working Wet=1 left by the first block.
  const nextEntry = enter("Fire", burning.properties);
  assert.deepEqual(nextEntry.properties, { Wet: 1, Steam: 1, Scorched: 1 });
  const dry = enter("Air", burning.properties);
  assert.deepEqual(dry.properties, { Wet: 0, Steam: 1 });
  assert.deepEqual(enter("Air", dry.properties).effects, []);
  assert.deepEqual(enter("Air", {}).properties, {});
});

test("insufficient wetness never consumes it or grants steam; absence does not satisfy a numeric IF", () => {
  assert.deepEqual(enter("Fire", { Wet: 1 }).properties, { Wet: 1, Scorched: 1 });
  assert.deepEqual(enter("Fire", { Wet: 0 }).properties, { Wet: 0, Scorched: 1 });
  assert.deepEqual(enter("Fire", {}).properties, {});
  assert.deepEqual(enter("Fire", { Wet: 2 }).properties, { Wet: 0, Steam: 1 });
});

test("arbitrary property identifiers require no catalog or tile identity", () => {
  const result = evaluatePropertyRules(document(block(effect("add", "arbitrary_charge-7", 4), effect("set", "_custom", 2))), {});
  assert.deepEqual(result.properties, { "arbitrary_charge-7": 4, _custom: 2 });
  const renamed = structuredClone(fixtures.tiles.Fire.propertyRules);
  for (const rule of renamed.blocks) {
    rule.if.property = "a_new_property";
    for (const action of rule.then) action.property = { Wet: "a_new_property", Steam: "another", Scorched: "third" }[action.property];
  }
  assert.deepEqual(evaluatePropertyRules(renamed, { a_new_property: 3 }).properties, { a_new_property: 1, another: 1 });
});

test("Set, Add and Subtract clamp each result and subsequent effects use the clamped working value", () => {
  const rules = document(block(effect("set", "charge", -2), effect("add", "charge", 3),
    effect("subtract", "charge", 8), effect("add", "charge", 2), effect("add", "charge", -8), effect("subtract", "charge", -0.5)));
  const result = evaluatePropertyRules(rules, { charge: 9 });
  assert.deepEqual(result.effects.map(item => item.after.value), [0, 3, 0, 2, 0, 0.5]);
  assert.deepEqual(result.effects.map(item => item.clamped), [true, false, true, false, true, false]);
  assert.deepEqual(result.properties, { charge: 0.5 });
});

test("top-level and nested authored order are both observable", () => {
  const first = block(effect("set", "x", 4), effect("subtract", "x", 2));
  const second = block(effect("add", "x", 3));
  assert.equal(evaluatePropertyRules(document(first, second), {}).properties.x, 5);
  assert.equal(evaluatePropertyRules(document(second, first), {}).properties.x, 2);
  assert.equal(evaluatePropertyRules(document({ then: [...first.then].reverse() }, second), {}).properties.x, 7);
  const result = evaluatePropertyRules(document(first, second), {});
  assert.deepEqual(result.effects.map(item => [item.sequence, item.blockIndex, item.effectIndex]), [[1, 0, 0], [2, 0, 1], [3, 1, 0]]);
});

test("all conditional blocks read one entry snapshot across same-property and cross-property writes", () => {
  const rules = document(
    block(effect("set", "newly_acquired", 10), effect("set", "fuel", 0)),
    { if: condition("newly_acquired", ">", 0), then: [effect("set", "incorrect", 1)] },
    { if: condition("fuel", "=", 5), then: [effect("add", "output", 2), effect("add", "output", 3)] }
  );
  const result = evaluatePropertyRules(rules, { fuel: 5 });
  assert.deepEqual(result.properties, { newly_acquired: 10, fuel: 0, output: 5 });
  assert.deepEqual(result.blocks.map(item => item.matched), [true, false, true]);
  assert.equal(result.blocks[2].comparison.actual, 5);
  assert.equal(evaluatePropertyRules(rules, result.properties).properties.incorrect, 1);
});

for (const [operator, expected] of [["=", false], ["!=", true], [">", false], ["<", true], [">=", false], ["<=", true]]) {
  test(`comparison '${operator}' distinguishes missing from acquired zero`, () => {
    const rules = document({ if: condition("p", operator, 1), then: [effect("set", "matched", 1)] });
    const absent = evaluatePropertyRules(rules, {});
    assert.equal(absent.blocks[0].matched, false);
    assert.deepEqual(absent.blocks[0].comparison, { property: "p", operator, expected: 1, present: false, actual: null, matched: false });
    assert.equal(evaluatePropertyRules(rules, { p: 0 }).blocks[0].matched, expected);
  });
}

test("equal boundary comparisons and acquired zero are explicit, including no-change effects", () => {
  for (const [operator, expected] of [["=", true], ["!=", false], [">", false], ["<", false], [">=", true], ["<=", true]]) {
    const rules = document({ if: condition("p", operator, 0), then: [effect("set", "matched", 1)] });
    assert.equal(evaluatePropertyRules(rules, { p: 0 }).blocks[0].matched, expected);
    assert.equal(evaluatePropertyRules(rules, {}).blocks[0].matched, false);
  }
  for (const operation of PROPERTY_OPERATIONS) {
    const rules = document(block(effect(operation, "p", 0)));
    const acquired = evaluatePropertyRules(rules, {});
    assert.deepEqual(acquired.effects[0].before, { present: false, value: null });
    assert.equal(acquired.effects[0].acquired, true);
    assert.equal(acquired.effects[0].valueChanged, true);
    assert.ok(Object.hasOwn(acquired.properties, "p"));
    const repeated = evaluatePropertyRules(rules, acquired.properties);
    assert.equal(repeated.effects[0].acquired, false);
    assert.equal(repeated.effects[0].valueChanged, false);
  }
  const subtracted = evaluatePropertyRules(document(block(effect("subtract", "empty", 3))), {});
  assert.deepEqual(subtracted.properties, { empty: 0 });
  assert.equal(subtracted.effects[0].clamped, true);
});

test("inputs remain untouched and results are independent, frozen, deterministic JSON", () => {
  const rules = structuredClone(fixtures.tiles.Fire.propertyRules);
  const properties = { Wet: 3, other: 8 };
  const originalRules = structuredClone(rules);
  const originalProperties = structuredClone(properties);
  const result = evaluatePropertyRules(rules, properties);
  assert.deepEqual(evaluatePropertyRules(rules, properties), result);
  assert.deepEqual(rules, originalRules);
  assert.deepEqual(properties, originalProperties);
  assert.equal(Object.isFrozen(properties), false);
  assert.equal(Object.isFrozen(rules), false);
  rules.blocks[0].then[0].value = 99;
  properties.Wet = 99;
  assert.equal(result.entrySnapshot.Wet, 3);
  assert.equal(result.effects[0].operand, 2);
  assert.throws(() => { result.entrySnapshot.Wet = 0; }, TypeError);
  assert.throws(() => { result.properties.Steam = 0; }, TypeError);
  assert.throws(() => { result.blocks[0].comparison.actual = 0; }, TypeError);
  assert.throws(() => { result.effects[0].after.value = 99; }, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("tile validation ignores unrelated fields and existing production tiles need no migration", async () => {
  const tile = { id: 99999, name: "Unrelated display name", svg: "original", extension: { retained: [1] }, ...fixtures.tiles.Water };
  const before = structuredClone(tile);
  assert.deepEqual(validateTilePropertyRules(tile), []);
  assert.deepEqual(tile, before);
  assert.deepEqual(validateTilePropertyRules({ propertyRules: null }).map(item => item.code), ["invalid_structure"]);
  assert.equal(validateTilePropertyRules(null).length, 1);
  const catalog = JSON.parse(await readFile(new URL("../tiles2.json", import.meta.url), "utf8"));
  for (const entry of catalog.tiles) assert.deepEqual(validateTilePropertyRules(entry.definition), []);
});

test("JSON Schema and validator agree on operation/comparison vocabulary and ID syntax", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/runner-property-rules.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(schema.$defs.effect.properties.operation.enum, [...PROPERTY_OPERATIONS]);
  assert.deepEqual(schema.$defs.condition.properties.operator.enum, [...PROPERTY_COMPARISONS]);
  assert.equal(schema.$defs.propertyId.pattern, PROPERTY_ID_PATTERN);
  assert.deepEqual(validatePropertyRules(document()), []);
  const empty = evaluatePropertyRules(document(), { retained: 0 });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.properties, { retained: 0 });
  assert.deepEqual(empty.effects, []);
});

test("malformed structures, IDs, operations, operators, values and extra fields fail atomically without rewriting", () => {
  const valid = document(block(effect("set", "p", 2)));
  const malformed = [null, [], {}, { version: 2, blocks: [] }, { version: 1, blocks: {} },
    document(null), document({}), document({ then: [] }), document({ then: [null] }),
    document({ if: null, then: valid.blocks[0].then }), document({ then: [{ property: "p", value: 2 }] }),
    { ...valid, unknown: true }, document({ ...valid.blocks[0], typo: 1 })];
  for (const id of ["", " ", " wet", "wet ", "wet\n", "a.b", "a/b", "a".repeat(65), "__proto__", "constructor", "prototype", "9starts", 3, null]) {
    malformed.push(document(block(effect("add", id, 1))));
    malformed.push(document({ if: condition(id, "=", 1), then: valid.blocks[0].then }));
  }
  for (const operation of ["multiply", "Set", "ADD", "", null, 1]) malformed.push(document(block(effect(operation, "p", 2))));
  for (const operator of ["==", "===", "<>", "", null, 1]) malformed.push(document({ if: condition("p", operator, 0), then: valid.blocks[0].then }));
  for (const value of ["2", null, true, {}, [], NaN, Infinity, -Infinity, undefined]) {
    malformed.push(document(block(effect("set", "p", value))));
    malformed.push(document({ if: condition("p", "=", value), then: valid.blocks[0].then }));
  }
  malformed.push(document(block({ ...effect("set", "p", 2), unexpected: true })));
  malformed.push(document({ if: { ...condition("p", "=", 1), unexpected: true }, then: valid.blocks[0].then }));
  for (const rules of malformed) {
    const before = structuredClone(rules);
    assert.ok(validatePropertyRules(rules).length > 0);
    const result = evaluatePropertyRules(rules, { p: 1 });
    assert.equal(result.ok, false);
    assert.deepEqual(result.properties, { p: 1 });
    assert.deepEqual(result.effects, []);
    assert.ok(result.diagnostics.every(item => item.severity === "error" && item.path && item.code));
    assert.deepEqual(rules, before);
  }
  const lateInvalid = document(block(effect("set", "p", 2)), block(effect("multiply", "p", 3)));
  assert.deepEqual(evaluatePropertyRules(lateInvalid, { p: 1 }).properties, { p: 1 });
});

test("invalid Runner property snapshots and numeric overflow never partially apply effects", () => {
  const rules = document(block(effect("add", "p", Number.MAX_VALUE)));
  for (const properties of [null, [], { p: "1" }, { p: -1 }, { p: NaN }, { p: Infinity }, JSON.parse('{"__proto__":2}')]) {
    assert.ok(validateRunnerProperties(properties).length);
    const result = evaluatePropertyRules(rules, properties);
    assert.equal(result.ok, false);
    assert.equal(result.entrySnapshot, null);
    assert.equal(result.properties, null);
    assert.deepEqual(result.effects, []);
  }
  const overflow = document(block(effect("set", "other", 3)), ...rules.blocks);
  const result = evaluatePropertyRules(overflow, { p: Number.MAX_VALUE });
  assert.equal(result.ok, false);
  assert.deepEqual(result.properties, { p: Number.MAX_VALUE });
  assert.deepEqual(result.effects, []);
  assert.equal(result.diagnostics[0].code, "numeric_overflow");
  assert.equal(result.diagnostics[0].path, "propertyRules.blocks[1].then[0]");
  assert.equal(Object.hasOwn(result.properties, "other"), false);
});
