import test from "node:test";
import assert from "node:assert/strict";
import { previewPropertyRuleEntry } from "../src/editor/propertyRulePreview.js";
import { propertyRuleFormSupported } from "../src/editor/propertyRuleEditor.js";

const property = (operation, property, value) => ({ type: "property", operation, property, value });
const rules = { version: 2, blocks: [
  { then: [property("add", "charge_x", 1)] },
  { if: { type: "comparison", mode: "current", property: "charge_x", operator: ">=", value: 3 },
    then: [property("set", "charge_x", 0), { type: "lose_hearts", amount: 1 },
      { type: "achievement", id: "sample_award", title: "Sample Award" }, { type: "narrative", text: "Sample narrative" }] }
] };

test("V2 form exposes supported mixtures and existence conditions without normalizing unknown fields", () => {
  assert.equal(propertyRuleFormSupported(rules), true);
  for (const type of ["exists", "not_exists"]) assert.equal(propertyRuleFormSupported({ version: 2,
    blocks: [{ if: { type, property: "p" }, then: [property("set", "p", 0)] }] }), true);
  for (const mutate of [value => { value.version = 3; },
    value => { value.blocks[1].if.mode = "future"; },
    value => { value.blocks[1].then[1].future = { preserve: true }; },
    value => { value.blocks[1].then[1].type = "future"; },
    value => { value.blocks[1].if.future = 1; }]) {
    const invalid = structuredClone(rules); mutate(invalid);
    const before = structuredClone(invalid);
    assert.equal(propertyRuleFormSupported(invalid), false);
    assert.deepEqual(invalid, before);
  }
  const repairable = structuredClone(rules); repairable.blocks[1].then[1].amount = null;
  assert.equal(propertyRuleFormSupported(repairable), true);
});

test("preview uses sequential current semantics and can carry sample properties, hearts and one-time achievements", () => {
  let properties = {}, hearts = 3, achievements = [];
  const before = structuredClone(rules);
  const history = [];
  for (let entry = 0; entry < 6; entry++) {
    const result = previewPropertyRuleEntry(rules, properties, { hearts, achievements });
    assert.equal(result.simulated, true);
    properties = result.evaluation.properties; hearts = result.hearts; achievements = result.achievements;
    history.push([properties.charge_x, hearts]);
    if (entry === 5) assert.ok(result.native.some(item => item.description.startsWith("Achievement already unlocked")));
  }
  assert.deepEqual(history, [[1, 3], [2, 3], [0, 2], [1, 2], [2, 2], [0, 1]]);
  assert.equal(achievements.length, 1);
  assert.deepEqual(rules, before);
});

test("mixed ordering controls preview terminal prefix and skipped narrative/achievement", () => {
  const result = previewPropertyRuleEntry(rules, { charge_x: 2 }, { hearts: 1 });
  assert.equal(result.evaluation.properties.charge_x, 0);
  assert.equal(result.evaluation.status, "terminal");
  assert.equal(result.achievements.length, 0);
  assert.equal(result.native.length, 1);
  const reversed = structuredClone(rules);
  [reversed.blocks[1].then[0], reversed.blocks[1].then[1]] = [reversed.blocks[1].then[1], reversed.blocks[1].then[0]];
  assert.equal(previewPropertyRuleEntry(reversed, { charge_x: 2 }, { hearts: 1 }).evaluation.properties.charge_x, 3);
  reversed.blocks.reverse();
  assert.equal(previewPropertyRuleEntry(reversed, { charge_x: 2 }, { hearts: 1 }).hearts, 1);
});

test("preview preserves acquired zero, uses Entry Values by default, and validates before simulating", () => {
  const entry = structuredClone(rules); delete entry.blocks[1].if.mode;
  assert.equal(previewPropertyRuleEntry(entry, { charge_x: 2 }).native.length, 0);
  assert.deepEqual(previewPropertyRuleEntry({ version: 2, blocks: [{ if: { type: "exists", property: "p" },
    then: [property("set", "matched", 0)] }] }, { p: 0 }).evaluation.properties, { p: 0, matched: 0 });
  for (const hearts of [null, 0, -1, Infinity, NaN]) assert.equal(previewPropertyRuleEntry(rules, {}, { hearts }).evaluation.ok, false);
  const invalid = structuredClone(rules); invalid.blocks[1].then.at(-1).unknown = true;
  const result = previewPropertyRuleEntry(invalid, { charge_x: 2 });
  assert.equal(result.evaluation.ok, false);
  assert.deepEqual(result.native, []);
});
