import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { collectPropertyNames, propertyRuleFormSupported } from "../src/editor/propertyRuleEditor.js";
import { validateTiles } from "../src/validation.js";
import { ContentDocumentStore } from "../src/editor/documentStore.js";

const valid = { version: 1, blocks: [{ if: { property: "wet", operator: ">", value: 0 }, then: [{ operation: "subtract", property: "wet", value: 1 }] }] };

test("property suggestions discover base, nested variant and legacy JSON without imposing a catalog", () => {
  const definitions = [{ propertyRules: valid, variants: { decor: { custom: { propertyRules: { version: 1, blocks: [
    { then: [{ operation: "set", property: "new_charge-7", value: 3 }] }
  ] } } } } }, { monster: { other: { propertyRules: { version: 1, blocks: [{ if: { property: "_arbitrary", operator: "=", value: 0 }, then: [] }] } } } },
    { propertyRules: { blocks: [null, { if: { property: "__proto__" }, then: [{ property: "bad id" }, null] }] } }, null];
  const before = structuredClone(definitions);
  assert.deepEqual(collectPropertyNames(definitions), ["_arbitrary", "new_charge-7", "wet"]);
  assert.deepEqual(definitions, before);
  const cycle = {}; cycle.self = cycle;
  assert.deepEqual(collectPropertyNames(cycle), []);
});

test("the form permits repairable field errors but refuses to reinterpret unsupported JSON", () => {
  assert.equal(propertyRuleFormSupported(valid), true);
  assert.equal(propertyRuleFormSupported({ version: 1, blocks: [] }), true);
  const draft = structuredClone(valid);
  draft.blocks[0].if.property = "not a valid id";
  draft.blocks[0].then[0].value = null;
  assert.equal(propertyRuleFormSupported(draft), true);
  for (const mutate of [
    value => { value.version = 2; }, value => { value.extension = { keep: true }; },
    value => { value.blocks[0].then[0].operation = "multiply"; },
    value => { value.blocks[0].if.operator = "=="; },
    value => { value.blocks[0].then[0].extra = ["keep"]; },
    value => { value.blocks[0].then[0].value = "3"; },
    value => { value.blocks[0].if = null; }, value => { value.blocks = [null]; }
  ]) {
    const unsupported = structuredClone(valid); mutate(unsupported);
    const before = structuredClone(unsupported);
    assert.equal(propertyRuleFormSupported(unsupported), false);
    assert.deepEqual(unsupported, before);
  }
});

test("Studio validation checks property rules in base tiles and variants with precise field paths", async () => {
  const registry = JSON.parse(await readFile("tiles2.json", "utf8"));
  registry.tiles[0].definition.propertyRules = valid;
  registry.tiles[0].definition.variants = { decor: { custom: { propertyRules: structuredClone(valid) } } };
  assert.deepEqual(validateTiles(registry).filter(issue => issue.severity === "error"), []);
  registry.tiles[0].definition.variants.decor.custom.propertyRules.blocks[0].then[0].value = null;
  const path = "tiles[0].definition.decor.custom.propertyRules.blocks[0].then[0].value";
  assert.ok(validateTiles(registry).some(issue => issue.path === path && issue.severity === "error"));
  const invalid = structuredClone(valid); invalid.blocks[0].if.property = "bad property";
  assert.ok(validateTiles({ W: { propertyRules: invalid } }).some(issue => issue.path === "tiles.W.propertyRules.blocks[0].if.property"));
  assert.ok(validateTiles({ W: { propertyRules: null } }).some(issue => issue.path === "tiles.W.propertyRules"));
});

test("unsupported property and encounter definitions survive unrelated Studio edits and serialization", async () => {
  const registry = JSON.parse(await readFile("tiles2.json", "utf8"));
  const tile = registry.tiles[0];
  tile.definition.propertyRules = { ...valid, future: { preserved: [1, 2] } };
  tile.definition.encounterRules = { enabled: true, rules: [{ futureEncounter: ["preserve"] }] };
  const definition = structuredClone(tile.definition);
  const store = new ContentDocumentStore();
  store.replace("numericTiles", registry);
  store.update("numericTiles", next => { next.tiles[0].name = "Unrelated name edit"; });
  assert.deepEqual(JSON.parse(store.serialize("numericTiles")).tiles[0].definition, definition);
  assert.ok(validateTiles(registry).some(issue => issue.path.endsWith("propertyRules.future")));
});
