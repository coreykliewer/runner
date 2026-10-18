import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { evaluatePropertyRules, createPropertyRuleExecution, validatePropertyRules,
  validateTilePropertyRules, PROPERTY_COMPARISONS, PROPERTY_NATIVE_EFFECTS, PROPERTY_CONDITION_MODES } from "../src/propertyRules.js";
import { createTileEntryBatch, applyTileEntry } from "../src/tileEntry.js";

const fixtures = JSON.parse(await readFile(new URL("../fixtures/property-rules-v2.json", import.meta.url)));
const property = (operation, property, value) => ({ type: "property", operation, property, value });
const comparison = (property, operator, value, mode) => ({ type: "comparison", property, operator, value, ...(mode ? { mode } : {}) });
const rules = (...blocks) => ({ version: 2, blocks });
const always = (...then) => ({ then });
const when = (condition, ...then) => ({ if: condition, then });

// Pure test driver: no gameplay handlers or production/native engine are connected.
function simulate(definition, properties, hearts = 3) {
  const execution = createPropertyRuleExecution(definition, properties);
  const native = [];
  let step = execution.next();
  while (!step.done) {
    native.push(step.value.effect);
    if (step.value.effect.type === "lose_hearts") hearts -= step.value.effect.effect.amount;
    step = execution.next({ status: hearts <= 0 ? "terminal" : "applied" });
  }
  return { ...step.value, hearts, native };
}

test("canonical Burning resets before simulated heart loss, repeats every third entry, and stops narrative on death", () => {
  let properties = {}, hearts = 3;
  const observed = [];
  for (let entry = 0; entry < 6; entry++) {
    const result = simulate(fixtures.Burning, properties, hearts);
    properties = result.properties; hearts = result.hearts;
    observed.push([properties.burning, hearts]);
  }
  assert.deepEqual(observed, [[1, 3], [2, 3], [0, 2], [1, 2], [2, 2], [0, 1]]);
  const lethal = simulate(fixtures.Burning, { burning: 2 }, 1);
  assert.equal(lethal.status, "terminal");
  assert.equal(lethal.properties.burning, 0);
  assert.deepEqual(lethal.native.map(effect => effect.type), ["lose_hearts"]);
});

test("mixed effect order is authoritative: damage before reset retains burning on lethal outcome", () => {
  const reordered = structuredClone(fixtures.Burning);
  [reordered.blocks[1].then[0], reordered.blocks[1].then[1]] = [reordered.blocks[1].then[1], reordered.blocks[1].then[0]];
  const lethal = simulate(reordered, { burning: 2 }, 1);
  assert.equal(lethal.properties.burning, 3);
  assert.equal(lethal.effects.at(-1).type, "lose_hearts");
  assert.equal(simulate(reordered, { burning: 2 }, 2).properties.burning, 0);
});

test("moving blocks changes Current Values qualification and simulated damage outcome", () => {
  const reversed = { ...fixtures.Burning, blocks: [...fixtures.Burning.blocks].reverse() };
  assert.equal(simulate(fixtures.Burning, { burning: 2 }).hearts, 2);
  const result = simulate(reversed, { burning: 2 });
  assert.equal(result.hearts, 3);
  assert.equal(result.properties.burning, 3);
});

test("Entry Values are the default and remain immutable while Current Values see preceding cross-property effects", () => {
  const definition = rules(always(property("set", "charge", 4), property("set", "source", 0)),
    when(comparison("charge", ">=", 4), property("set", "wrong", 1)),
    when(comparison("charge", ">=", 4, "current"), property("add", "output", 2)),
    when(comparison("source", "=", 5, "entry"), property("add", "output", 3)));
  const result = evaluatePropertyRules(definition, { source: 5 });
  assert.deepEqual(result.properties, { source: 0, charge: 4, output: 5 });
  assert.deepEqual(result.blocks.map(block => block.matched), [true, false, true, true]);
  assert.deepEqual(result.entrySnapshot, { source: 5 });
  assert.equal(result.records.filter(record => record.kind === "block")[2].comparison.actual, 4);
});

for (const mode of ["entry", "current"]) {
  test(`${mode} existence checks distinguish absent from acquired zero independently of comparisons`, () => {
    for (const [properties, present] of [[{}, false], [{ custom: 0 }, true]]) {
      for (const type of ["exists", "not_exists"]) {
        const result = evaluatePropertyRules(rules(when({ type, mode, property: "custom" }, property("set", "matched", 1))), properties);
        assert.equal(result.blocks[0].matched, type === "exists" ? present : !present);
      }
      for (const operator of PROPERTY_COMPARISONS) {
        const result = evaluatePropertyRules(rules(when(comparison("custom", operator, 0, mode), property("set", "matched", 1))), properties);
        if (!present) assert.equal(result.blocks[0].matched, false);
        else assert.equal(result.blocks[0].matched, ["=", ">=", "<="].includes(operator));
      }
    }
  });
}

test("current existence sees newly acquired zero, entry existence does not; case remains significant", () => {
  const result = evaluatePropertyRules(rules(always(property("subtract", "custom", 5)),
    when({ type: "exists", property: "custom", mode: "current" }, property("set", "current_match", 1)),
    when({ type: "not_exists", property: "custom" }, property("set", "entry_match", 1)),
    when({ type: "exists", property: "Custom", mode: "current" }, property("set", "wrong", 1))));
  assert.deepEqual(result.properties, { custom: 0, current_match: 1, entry_match: 1 });
});

test("all property and native effect types remain interleaved and explicitly numbered", () => {
  const definition = rules(always(property("set", "p", 1), { type: "narrative", text: "First" },
    property("add", "p", 2), { type: "achievement", id: "custom_award", title: "Custom award" },
    property("subtract", "p", 1), { type: "lose_hearts", amount: 0.5 }));
  const result = simulate(definition, {});
  const records = result.records.filter(record => record.kind === "effect");
  assert.deepEqual(records.map(record => record.type), ["property", "narrative", "property", "achievement", "property", "lose_hearts"]);
  assert.deepEqual(records.map(record => [record.blockNumber, record.effectNumber]), [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6]]);
  assert.deepEqual(result.native.map(request => request.before.p), [1, 3, 2]);
  assert.deepEqual(records.map(record => record.sequence), [2, 3, 4, 5, 6, 7]);
});

test("pure evaluation suspends at native effects and existing gameplay entry cannot partially commit native rules", () => {
  const result = evaluatePropertyRules(fixtures.Burning, { burning: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.status, "native_effect_required");
  assert.equal(result.properties.burning, 0); // informational prefix, not committed gameplay
  assert.equal(result.pendingEffect.type, "lose_hearts");
  const entryState = { runId: "standalone", sequence: 0 };
  const batch = createTileEntryBatch({ entryState, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, cause: "test",
    source: { instanceId: "standalone:1:0" }, properties: { burning: 2 } });
  const applied = applyTileEntry({ rules: fixtures.Burning }, batch.events[0], { burning: 2 }, entryState);
  assert.deepEqual(applied.properties, { burning: 2 });
  assert.equal(applied.entryState.sequence, 1);
  assert.equal(applyTileEntry({ rules: fixtures.Burning }, batch.events[0], applied.properties, applied.entryState).applied, false);
});

test("native requests are yielded once; advancing past completion cannot replay actions", () => {
  const execution = createPropertyRuleExecution(rules(always({ type: "narrative", text: "A" }, { type: "narrative", text: "B" })));
  const first = execution.next();
  const second = execution.next({ status: "applied" });
  assert.notEqual(first.value.effect.effectKey, second.value.effect.effectKey);
  const final = execution.next({ status: "applied" });
  assert.equal(final.value.effects.length, 2);
  assert.equal(execution.next({ status: "applied" }).done, true);
});

for (const acknowledgement of [{ status: "failed" }, undefined, { status: "unknown" }]) {
  test(`native failure or missing acknowledgement stops with earlier effects retained: ${JSON.stringify(acknowledgement)}`, () => {
    const execution = createPropertyRuleExecution(rules(always(property("set", "p", 2),
      { type: "achievement", id: "award", title: "Award" }, property("set", "wrong", 1))));
    execution.next();
    const result = execution.next(acknowledgement).value;
    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.deepEqual(result.properties, { p: 2 });
    assert.equal(result.effects.length, 2);
    assert.equal(result.effects.at(-1).status, "failed");
    assert.equal(execution.next().done, true);
  });
}

test("definitions and incoming snapshots are owned and outputs frozen while execution is suspended", () => {
  const definition = rules(always(property("set", "p", 1), { type: "narrative", text: "One" }, property("add", "p", 2)));
  const properties = { initial: 0 };
  const execution = createPropertyRuleExecution(definition, properties);
  const request = execution.next().value;
  definition.blocks[0].then[2].value = 100;
  properties.initial = 99;
  assert.throws(() => { request.effect.before.p = 50; }, TypeError);
  const result = execution.next({ status: "applied" }).value;
  assert.deepEqual(result.properties, { initial: 0, p: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(Object.isFrozen(result.records[0].snapshot), true);
});

test("V2 property overflow stops and retains the preceding execution prefix", () => {
  const result = simulate(rules(always(property("set", "p", 2), { type: "narrative", text: "Before" },
    property("add", "large", Number.MAX_VALUE), property("set", "wrong", 1))), { large: Number.MAX_VALUE });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.properties, { large: Number.MAX_VALUE, p: 2 });
  assert.equal(result.diagnostics[0].code, "numeric_overflow");
  assert.equal(result.records.at(-1).status, "failed");
});

test("Poison and renamed arbitrary properties use the same ordered contract", () => {
  const poison = simulate(fixtures.Poison, { poison: 3 }, 5);
  assert.equal(poison.hearts, 3);
  assert.equal(poison.properties.poison, 0);
  const renamed = JSON.parse(JSON.stringify(fixtures.Poison).replaceAll('"poison"', '"custom-7"'));
  assert.deepEqual(simulate(renamed, { "custom-7": 3 }, 5).properties, { "custom-7": 0 });
});

test("V1 Water/Air/Fire and equivalent V2 property-only definitions produce identical outcomes", async () => {
  const legacy = JSON.parse(await readFile(new URL("../fixtures/property-rules.json", import.meta.url)));
  for (const tile of Object.values(legacy.tiles)) {
    const converted = { version: 2, blocks: tile.propertyRules.blocks.map(block => ({
      ...(block.if ? { if: { type: "comparison", ...block.if } } : {}),
      then: block.then.map(effect => ({ type: "property", ...effect })) })) };
    for (const properties of [{}, { wet: 0 }, { wet: 1 }, { wet: 2 }, { wet: 5, burning: 0 }]) {
      assert.deepEqual(evaluatePropertyRules(converted, properties).properties, evaluatePropertyRules(tile.propertyRules, properties).properties);
    }
  }
});

test("V2 rejects malformed structures, modes, existence operands, native actions and unknown fields before yielding", () => {
  const valid = rules(always(property("set", "p", 2)));
  const invalid = [
    rules(when({ type: "exists", property: "p", operator: "=", value: 0 }, property("set", "p", 2))),
    rules(when({ type: "exists", property: "p", mode: null }, property("set", "p", 2))),
    rules(when({ property: "p", operator: "=", value: 0 }, property("set", "p", 2))),
    rules(when(comparison("p", "==", 0, "later"), property("set", "p", 2))),
    rules(always({ type: "property", operation: "multiply", property: "p", value: 2 })),
    rules(always({ type: "heal", amount: 1 })), rules(always({ operation: "set", property: "p", value: 2 })),
    rules(always(null)), rules(null), rules(always({ type: "narrative", text: " " })),
    rules(always({ type: "narrative", text: "Hello", html: true })),
    rules(always({ type: "achievement", id: "award" })),
    rules(always({ type: "achievement", id: "", title: "Award" })),
    rules(when({ type: "not_exists", property: "__proto__" }, property("set", "p", 2)))
  ];
  for (const amount of [0, -1, null, "1", Infinity, NaN]) invalid.push(rules(always({ type: "lose_hearts", amount })));
  for (const definition of invalid) {
    const before = structuredClone(definition);
    const lateInvalid = rules(always({ type: "narrative", text: "Must not yield" }), ...definition.blocks);
    const first = createPropertyRuleExecution(lateInvalid, { p: 1 }).next();
    assert.equal(first.done, true);
    assert.equal(first.value.ok, false);
    assert.deepEqual(first.value.properties, { p: 1 });
    assert.deepEqual(first.value.effects, []);
    assert.deepEqual(definition, before);
    assert.ok(validatePropertyRules(definition).length);
  }
  assert.deepEqual(validateTilePropertyRules({ propertyRules: valid, svg: "preserved", other: [1] }), []);
  assert.deepEqual(validatePropertyRules({ version: 2, blocks: [] }), []);
});

test("schema versions and V2 vocabularies agree with the standalone validator", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/runner-property-rules.schema.json", import.meta.url)));
  assert.deepEqual(schema.oneOf.map(branch => branch.properties.version.const), [1, 2, 3]);
  assert.deepEqual(schema.$defs.v2Condition.oneOf[0].properties.mode.enum, [...PROPERTY_CONDITION_MODES]);
  assert.deepEqual(schema.$defs.v2Effect.oneOf.slice(1).map(branch => branch.properties.type.const), [...PROPERTY_NATIVE_EFFECTS]);
  for (const fixture of Object.values(fixtures)) assert.deepEqual(validatePropertyRules(fixture), []);
});
