import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function setup(page, mutate = () => {}) {
  let registry = JSON.parse(await readFile("tiles2.json", "utf8"));
  mutate(registry);
  await page.route("**/tiles2.json*", route => route.fulfill({ json: registry }));
  await page.addInitScript(() => {
    window.propertyWrites = [];
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: async () => ({ name: "tiles2.json",
      createWritable: async () => ({ write: async content => window.propertyWrites.push(content), close: async () => {} }) }) });
  });
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  return { persist: value => { registry = value; } };
}
async function openCapabilities(page) {
  const section = page.locator(".tile-builder-section").filter({ has: page.getByText("Capabilities", { exact: true }) });
  if (!await section.evaluate(node => node.open)) await section.locator(":scope > summary").click();
  const rules = page.locator('.tile-capability-group[data-capability="propertyRules"]');
  if (!await rules.evaluate(node => node.open)) await rules.locator(":scope > summary").click();
}
async function select(page, id) {
  await page.locator(`.tile-card[data-entry-key="numeric:${id}"]`).click();
  await openCapabilities(page);
}
async function createTile(page, name) {
  await page.locator("#addEntry").click();
  await page.locator("#tileCreationName").fill(name);
  await page.locator("#tileCreationCategory").selectOption("Environmental");
  await page.locator("#tileCreationNext").click();
  await page.locator("#tileCreationNext").click();
  await page.locator("#tileCreationCreate").click();
  await openCapabilities(page);
  await page.getByRole("button", { name: "Add Property rules", exact: true }).click();
  return Number(await page.locator(".tile-identity-id strong").textContent());
}
const editor = page => page.locator(".property-rule-editor");
async function addBlock(page) { await editor(page).getByRole("button", { name: "Add property-rule block", exact: true }).click(); }
async function effect(page, block, index, operation, property, value) {
  await editor(page).getByLabel(`Block ${block} effect ${index} operation`, { exact: true }).selectOption(operation);
  await editor(page).getByLabel(`Block ${block} effect ${index} property`, { exact: true }).fill(property);
  await editor(page).getByLabel(`Block ${block} effect ${index} value`, { exact: true }).fill(String(value));
}
async function condition(page, block, property, operator, value) {
  await editor(page).getByLabel(`Block ${block} use IF`, { exact: true }).check();
  await editor(page).getByLabel(`Block ${block} IF property`, { exact: true }).fill(property);
  await editor(page).getByLabel(`Block ${block} comparison`, { exact: true }).selectOption(operator);
  await editor(page).getByLabel(`Block ${block} IF value`, { exact: true }).fill(String(value));
}
async function sample(page, property, value) {
  const names = editor(page).locator('.property-rule-sample input[aria-label$=" property"]');
  for (let index = 0; index < await names.count(); index++) if (await names.nth(index).inputValue() === property) {
    const checkbox = editor(page).getByLabel(`Sample ${index + 1} acquired`, { exact: true });
    if (value === undefined) await checkbox.uncheck();
    else { await checkbox.check(); await editor(page).getByLabel(`Sample ${index + 1} value`, { exact: true }).fill(String(value)); }
    return;
  }
  throw new Error(`Missing sample field for ${property}`);
}
const run = page => editor(page).getByRole("button", { name: "Run property-rule preview", exact: true }).click();
const resultRow = (page, property) => editor(page).locator(".property-rule-results tr").filter({ has: page.locator("th").filter({ hasText: new RegExp(`^${property}$`) }) });
const written = page => page.evaluate(() => JSON.parse(window.propertyWrites.at(-1)));

test("authors Water, Air and Fire visually, previews entry snapshots, and round-trips authored order", async ({ page }) => {
  const persistence = await setup(page);
  const accepted = JSON.parse(await readFile("fixtures/property-rules.json", "utf8"));
  const water = await createTile(page, "Water");
  await addBlock(page); await effect(page, 1, 1, "set", "wet", 5);
  await page.locator("#saveDoc").click();
  expect((await written(page)).tiles.find(tile => tile.id === water).definition.propertyRules).toEqual(accepted.tiles.Water.propertyRules);
  const air = await createTile(page, "Air");
  await addBlock(page); await condition(page, 1, "wet", ">", 0); await effect(page, 1, 1, "subtract", "wet", 1);
  await page.locator("#saveDoc").click();
  expect((await written(page)).tiles.find(tile => tile.id === air).definition.propertyRules).toEqual(accepted.tiles.Air.propertyRules);
  const fire = await createTile(page, "Fire");
  await addBlock(page); await effect(page, 1, 1, "set", "burning", 1);
  await addBlock(page); await condition(page, 2, "wet", ">=", 2); await effect(page, 2, 1, "subtract", "burning", 1);
  await editor(page).getByRole("button", { name: "Add effect to block 2", exact: true }).click();
  await effect(page, 2, 2, "subtract", "wet", 2);
  await page.locator("#saveDoc").click();
  const original = await written(page);
  expect(original.tiles.find(tile => tile.id === fire).definition.propertyRules).toEqual(accepted.tiles.Fire.propertyRules);
  await expect(editor(page)).toContainText("beginning of that entry");
  await expect(editor(page)).toContainText("gravity");
  await sample(page, "wet", 1); await run(page);
  await expect(resultRow(page, "burning").locator("td").nth(1)).toHaveText("Acquired: 1");
  await expect(resultRow(page, "wet").locator("td").nth(1)).toHaveText("Acquired: 1");
  await editor(page).locator(".property-rule-preview-result").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("property-rule-preview.png") });
  await sample(page, "wet", 2); await run(page);
  await expect(resultRow(page, "burning").locator("td").nth(1)).toHaveText("Acquired: 0");
  await expect(resultRow(page, "wet").locator("td").nth(1)).toHaveText("Acquired: 0");
  await sample(page, "wet", undefined); await run(page);
  await expect(resultRow(page, "wet").locator("td").nth(1)).toHaveText("Missing");
  await sample(page, "wet", 0); await run(page);
  await expect(resultRow(page, "wet").locator("td").nth(1)).toHaveText("Acquired: 0");
  await expect(page.locator("#dirtyStatus")).toHaveText("All changes saved");
  await editor(page).getByRole("button", { name: "Move block 2 up", exact: true }).click();
  await editor(page).getByRole("button", { name: "Move block 1 effect 2 up", exact: true }).click();
  await editor(page).getByRole("button", { name: "Duplicate block 1", exact: true }).click();
  await editor(page).getByRole("button", { name: "Delete block 2", exact: true }).click();
  await editor(page).getByRole("button", { name: "Duplicate block 1 effect 1", exact: true }).click();
  await editor(page).getByRole("button", { name: "Delete block 1 effect 2", exact: true }).click();
  await sample(page, "wet", 2); await run(page);
  await expect(resultRow(page, "burning").locator("td").nth(1)).toHaveText("Acquired: 1");
  await page.locator("#saveDoc").click();
  const reordered = await written(page);
  const expected = structuredClone(accepted.tiles.Fire.propertyRules);
  expected.blocks.reverse(); expected.blocks[0].then.reverse();
  expect(reordered.tiles.find(tile => tile.id === fire).definition.propertyRules).toEqual(expected);
  persistence.persist(reordered);
  await page.reload(); await page.locator('.nav-document[data-document="numericTiles"]').click(); await select(page, fire);
  await expect(editor(page).getByLabel("Block 1 effect 1 property", { exact: true })).toHaveValue("wet");
  await page.locator("#exportDoc").click();
  const exported = await written(page);
  expect(exported).toEqual(reordered);
  await page.locator("#fallbackFileInput").setInputFiles({ name: "tiles2.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
  await select(page, fire);
  await page.locator("#exportDoc").click();
  expect(await written(page)).toEqual(exported);
});

test("field errors block saving over valid content, while arbitrary IDs and discovered suggestions are editable", async ({ page }) => {
  let sourceId;
  await setup(page, registry => {
    sourceId = registry.tiles[0].id;
    registry.tiles[0].definition.variants = { decor: { suggestion: { propertyRules: { version: 1, blocks: [{ then: [{ operation: "set", property: "from_variant", value: 0 }] }] } } } };
  });
  const id = await createTile(page, "Custom property tile");
  await addBlock(page); await effect(page, 1, 1, "add", "new_charge-7", 2.5);
  const input = editor(page).getByLabel("Block 1 effect 1 property", { exact: true });
  // Real keystrokes must not create samples for each partial property ID.
  await input.fill("");
  await input.pressSequentially("custom_typed");
  await editor(page).getByLabel("Block 1 effect 1 value", { exact: true }).focus();
  expect(await editor(page).locator('.property-rule-sample input[aria-label$=" property"]').evaluateAll(inputs => inputs.map(input => input.value))).toEqual(["new_charge-7", "custom_typed"]);
  await input.fill("new_charge-7");
  const listId = await input.getAttribute("list");
  await expect(page.locator(`[id="${listId}"] option[value="from_variant"]`)).toHaveCount(1);
  await expect(page.locator(`[id="${listId}"] option[value="new_charge-7"]`)).toHaveCount(1);
  await page.locator("#saveDoc").click();
  const valid = await written(page);
  const count = await page.evaluate(() => window.propertyWrites.length);
  await input.fill("bad property");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(editor(page).locator('.property-rule-error[data-path$="then[0].property"]')).toContainText("identifier");
  await page.locator("#saveDoc").click();
  await expect(page.locator("#statusText")).toContainText("Save blocked");
  expect(await page.evaluate(() => window.propertyWrites.length)).toBe(count);
  expect(await written(page)).toEqual(valid);
  await input.fill("new_charge-7");
  const value = editor(page).getByLabel("Block 1 effect 1 value", { exact: true });
  await value.fill("");
  await expect(value).toHaveAttribute("aria-invalid", "true");
  await page.locator("#saveDoc").click();
  expect(await page.evaluate(() => window.propertyWrites.length)).toBe(count);
  await value.fill("-1");
  await page.locator("#saveDoc").click();
  const fixed = await written(page);
  expect(fixed.tiles.find(tile => tile.id === id).definition.propertyRules.blocks[0].then[0].value).toBe(-1);
  expect(fixed.tiles.find(tile => tile.id === sourceId).definition).toEqual(valid.tiles.find(tile => tile.id === sourceId).definition);
});

test("variants preview inherited rules, override independently, and restore inheritance without losing encounters or artwork", async ({ page }) => {
  let id, original;
  const persistence = await setup(page, registry => {
    const tile = registry.tiles[0]; id = tile.id;
    tile.definition.propertyRules = { version: 1, blocks: [{ then: [{ operation: "set", property: "wet", value: 5 }] }] };
    tile.definition.encounterRules = { enabled: true, resolution: "all_matches", rules: [{ id: "opaque", order: 1, priority: 8,
      trigger: { events: ["turn_ended"], minDistance: 0, maxDistance: 1, distance: "manhattan", position: "any", repeat: "once_per_roll" },
      activation: { scope: "once_per_turn" }, conditions: [{ type: "sum_comparison", operator: "<=", value: 0 }], actions: [{ type: "damage", amount: 1 }], future: { keep: true } }] };
    tile.definition.variants = { decor: { alternate: { svg: tile.definition.svg, future: ["keep"] } } };
    original = structuredClone(tile);
  });
  await select(page, id);
  await page.locator(".tile-builder-section > summary").filter({ hasText: /^Variants$/ }).click();
  await page.getByRole("button", { name: "Edit decor variant alternate", exact: true }).click();
  await openCapabilities(page);
  await expect(editor(page)).toContainText("Inherited rules");
  await expect(editor(page).getByRole("button", { name: "Add property-rule block" })).toBeDisabled();
  await run(page);
  await expect(resultRow(page, "wet").locator("td").nth(1)).toHaveText("Acquired: 5");
  await page.getByRole("button", { name: "Override Property rules", exact: true }).click();
  await editor(page).getByLabel("Block 1 effect 1 value", { exact: true }).fill("2");
  await page.locator("#saveDoc").click();
  const overridden = await written(page);
  expect(overridden.tiles.find(tile => tile.id === id).definition.propertyRules).toEqual(original.definition.propertyRules);
  expect(overridden.tiles.find(tile => tile.id === id).definition.variants.decor.alternate.propertyRules.blocks[0].then[0].value).toBe(2);
  persistence.persist(overridden);
  await page.getByRole("button", { name: "Remove Property rules override", exact: true }).click();
  await run(page);
  await expect(resultRow(page, "wet").locator("td").nth(1)).toHaveText("Acquired: 5");
  await page.locator("#saveDoc").click();
  const restored = await written(page);
  expect(restored.tiles.find(tile => tile.id === id)).toEqual(original);
});

for (const unsupported of ["version", "field", "operation"]) {
  test(`unsupported property-rule ${unsupported} remains read-only and lossless`, async ({ page }) => {
    let id, rules;
    await setup(page, registry => {
      const tile = registry.tiles[0]; id = tile.id;
      rules = { version: 1, blocks: [{ then: [{ operation: "set", property: "wet", value: 5 }] }] };
      if (unsupported === "version") rules.version = 3;
      if (unsupported === "field") rules.blocks[0].then[0].future = { keep: true };
      if (unsupported === "operation") rules.blocks[0].then[0].operation = "multiply";
      tile.definition.propertyRules = rules;
    });
    await select(page, id);
    await expect(editor(page)).toContainText("original JSON is preserved");
    await expect(editor(page).getByRole("button", { name: "Add property-rule block" })).toHaveCount(0);
    await page.locator(".tile-builder-section > summary").filter({ hasText: /^Identity$/ }).click();
    await page.locator("#inspectorFields").getByLabel("Tile name", { exact: true }).fill("Unsupported data preserved");
    await page.locator("#saveDoc").click();
    await expect(page.locator("#statusText")).toContainText("Save blocked");
    await page.locator("#exportDoc").click();
    expect((await written(page)).tiles.find(tile => tile.id === id).definition.propertyRules).toEqual(rules);
  });
}

test("authors arbitrary V2 thresholds, native effects and order-dependent terminal previews entirely through controls", async ({ page }) => {
  const persistence = await setup(page);
  const id = await createTile(page, "Threshold fixture");
  await editor(page).getByRole("button", { name: "Upgrade property rules to version 2" }).click();
  await addBlock(page); await effect(page, 1, 1, "add", "charge_x", 1);
  await addBlock(page); await condition(page, 2, "charge_x", ">=", 3);
  await editor(page).getByLabel("Block 2 condition values", { exact: true }).selectOption("current");
  await effect(page, 2, 1, "set", "charge_x", 0);
  for (const [index, type] of [[2, "lose_hearts"], [3, "achievement"], [4, "narrative"]]) {
    await editor(page).getByRole("button", { name: "Add effect to block 2", exact: true }).click();
    await editor(page).getByLabel(`Block 2 effect ${index} type`, { exact: true }).selectOption(type);
  }
  await editor(page).getByLabel("Block 2 effect 2 amount", { exact: true }).fill("1");
  await editor(page).getByLabel("Block 2 effect 3 achievement ID", { exact: true }).fill("sample_award");
  await editor(page).getByLabel("Block 2 effect 3 achievement title", { exact: true }).fill("Sample award");
  await editor(page).getByLabel("Block 2 effect 4 narrative text", { exact: true }).fill("Threshold reached");
  await page.locator("#saveDoc").click();
  const original = await written(page);
  const rules = original.tiles.find(tile => tile.id === id).definition.propertyRules;
  expect(rules.version).toBe(2);
  expect(rules.blocks[1].then.map(effect => effect.type)).toEqual(["property", "lose_hearts", "achievement", "narrative"]);
  await page.evaluate(() => localStorage.setItem("runner:v2:state", "preview sentinel"));
  await sample(page, "charge_x", 2); await run(page);
  await expect(resultRow(page, "charge_x").locator("td").nth(1)).toHaveText("Acquired: 0");
  const preview = editor(page).locator(".property-rule-preview-result");
  await expect(preview).toContainText("Simulated hearts: 3 → 2");
  await expect(preview).toContainText("SIMULATED Unlock achievement: Sample award");
  await expect(preview).toContainText("SIMULATED Narrative: Threshold reached");
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("property-rules-v2-preview.png") });
  await editor(page).getByRole("button", { name: "Use preview result as next sample entry" }).click();
  await sample(page, "charge_x", 2); await run(page);
  await expect(preview).toContainText("Achievement already unlocked: Sample award");
  await expect(preview).toContainText("Simulated hearts: 2 → 1");
  expect(await page.evaluate(() => localStorage.getItem("runner:v2:state"))).toBe("preview sentinel");
  await expect(page.locator("#dirtyStatus")).toHaveText("All changes saved");
  await editor(page).getByLabel("Sample hearts", { exact: true }).fill("1");
  await run(page);
  await expect(preview).toContainText("Simulated death: subsequent effects stopped");
  await expect(preview).not.toContainText("SIMULATED Narrative");
  await expect(resultRow(page, "charge_x").locator("td").nth(1)).toHaveText("Acquired: 0");
  const up = editor(page).getByRole("button", { name: "Move block 2 effect 2 up", exact: true });
  await up.focus(); await up.press("Enter");
  await expect(editor(page).getByRole("button", { name: "Move block 2 effect 1 down", exact: true })).toBeFocused();
  await run(page);
  await expect(resultRow(page, "charge_x").locator("td").nth(1)).toHaveText("Acquired: 3");
  await page.locator("#exportDoc").click();
  expect((await written(page)).tiles.find(tile => tile.id === id).definition.propertyRules.blocks[1].then.map(effect => effect.type))
    .toEqual(["lose_hearts", "property", "achievement", "narrative"]);
  await editor(page).getByRole("button", { name: "Move block 2 up", exact: true }).click();
  await run(page);
  await expect(preview).toContainText("Simulated hearts: 1 → 1");
  await expect(preview).not.toContainText("Simulated death");
  await page.locator("#saveDoc").click();
  const reordered = await written(page);
  persistence.persist(reordered);
  await page.reload(); await page.locator('.nav-document[data-document="numericTiles"]').click(); await select(page, id);
  await expect(editor(page).getByLabel("Block 1 effect 1 type", { exact: true })).toHaveValue("lose_hearts");
  await page.locator("#exportDoc").click();
  expect(await written(page)).toEqual(reordered);
  await page.locator("#fallbackFileInput").setInputFiles({ name: "tiles2.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(reordered)) });
  await select(page, id);
  await page.locator("#exportDoc").click();
  expect(await written(page)).toEqual(reordered);
});

test("V2 existence controls distinguish missing and zero, preserve entry defaults, and validate native fields inline", async ({ page }) => {
  await setup(page);
  const id = await createTile(page, "Existence fixture");
  await addBlock(page); await condition(page, 1, "new_charge", "=", 0); await effect(page, 1, 1, "set", "matched", 0);
  await editor(page).getByRole("button", { name: "Upgrade property rules to version 2" }).click();
  await editor(page).getByLabel("Block 1 condition type", { exact: true }).selectOption("exists");
  await expect(editor(page).getByLabel("Block 1 comparison", { exact: true })).toHaveCount(0);
  await expect(editor(page).getByLabel("Block 1 condition values", { exact: true })).toHaveValue("entry");
  await run(page);
  await expect(resultRow(page, "matched").locator("td").nth(1)).toHaveText("Missing");
  await sample(page, "new_charge", 0); await run(page);
  await expect(resultRow(page, "matched").locator("td").nth(1)).toHaveText("Acquired: 0");
  await editor(page).getByLabel("Block 1 condition type", { exact: true }).selectOption("not_exists");
  await run(page);
  await expect(resultRow(page, "matched").locator("td").nth(1)).toHaveText("Missing");
  await sample(page, "new_charge", undefined); await run(page);
  await expect(resultRow(page, "matched").locator("td").nth(1)).toHaveText("Acquired: 0");
  await page.locator("#saveDoc").click();
  const valid = await written(page);
  await editor(page).getByLabel("Block 1 effect 1 type", { exact: true }).selectOption("lose_hearts");
  const amount = editor(page).getByLabel("Block 1 effect 1 amount", { exact: true });
  await amount.fill("0");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(editor(page).locator('[data-path="propertyRules.blocks[0].then[0].amount"]')).toContainText("positive");
  await page.locator("#saveDoc").click();
  expect(await written(page)).toEqual(valid);
  await expect(page.locator("#statusText")).toContainText("Save blocked");
  await amount.fill("2");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
  await editor(page).getByLabel("Block 1 effect 1 type", { exact: true }).selectOption("narrative");
  await expect(editor(page).getByLabel("Block 1 effect 1 narrative text", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await editor(page).getByLabel("Block 1 effect 1 narrative text", { exact: true }).fill("Missing property narrative");
  await page.locator("#saveDoc").click();
  const saved = (await written(page)).tiles.find(tile => tile.id === id).definition.propertyRules;
  expect(saved.blocks[0].if).toEqual({ type: "not_exists", property: "new_charge" });
});

test("V2 variants retain exact mixed order, inherited JSON, artwork and opaque encounters", async ({ page }) => {
  let original, id;
  const persistence = await setup(page, registry => {
    const tile = registry.tiles[0]; id = tile.id;
    tile.definition.propertyRules = { version: 2, blocks: [{ then: [
      { type: "property", operation: "set", property: "custom", value: 0 },
      { type: "narrative", text: "Variant text" }, { type: "achievement", id: "variant_award", title: "Variant award" },
      { type: "lose_hearts", amount: 1 }] }] };
    tile.definition.encounterRules = { enabled: false, resolution: "all_matches", rules: [], future: { keep: [1, 2] } };
    tile.definition.variants = { decor: { alternate: { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', future: "preserved" } } };
    original = structuredClone(tile);
  });
  await select(page, id);
  await page.locator(".tile-builder-section > summary").filter({ hasText: /^Variants$/ }).click();
  await page.getByRole("button", { name: "Edit decor variant alternate", exact: true }).click();
  await openCapabilities(page);
  await expect(editor(page).getByLabel("Block 1 effect 1 type", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Override Property rules", exact: true }).click();
  await editor(page).getByRole("button", { name: "Move block 1 effect 4 up", exact: true }).click();
  await editor(page).getByRole("button", { name: "Move block 1 effect 3 up", exact: true }).click();
  await editor(page).getByRole("button", { name: "Move block 1 effect 1 down", exact: true }).click();
  await editor(page).getByRole("button", { name: "Move block 1 effect 4 up", exact: true }).click();
  await editor(page).getByRole("button", { name: "Duplicate block 1 effect 2", exact: true }).click();
  await editor(page).getByRole("button", { name: "Delete block 1 effect 3", exact: true }).click();
  await page.locator("#saveDoc").click();
  await expect(page.locator("#dirtyStatus")).toHaveText("All changes saved");
  await page.locator("#exportDoc").click();
  const exported = await written(page);
  const tile = exported.tiles.find(tile => tile.id === id);
  expect(tile.definition.propertyRules).toEqual(original.definition.propertyRules);
  expect(tile.definition.encounterRules).toEqual(original.definition.encounterRules);
  expect(tile.definition.variants.decor.alternate.svg).toBe(original.definition.variants.decor.alternate.svg);
  expect(tile.definition.variants.decor.alternate.propertyRules.blocks[0].then.map(effect => effect.type))
    .toEqual(["lose_hearts", "property", "achievement", "narrative"]);
  persistence.persist(exported);
  await page.reload(); await page.locator('.nav-document[data-document="numericTiles"]').click(); await select(page, id);
  await page.locator(".tile-builder-section > summary").filter({ hasText: /^Variants$/ }).click();
  await page.getByRole("button", { name: "Edit decor variant alternate", exact: true }).click();
  await openCapabilities(page);
  await expect(editor(page).getByLabel("Block 1 effect 1 type", { exact: true })).toHaveValue("lose_hearts");
  await page.getByRole("button", { name: "Remove Property rules override", exact: true }).click();
  await page.locator("#saveDoc").click();
  await page.locator("#exportDoc").click();
  expect((await written(page)).tiles.find(tile => tile.id === id)).toEqual(original);
});

for (const location of ["condition", "effect"]) {
  test(`V2 future ${location} fields remain read-only and lossless`, async ({ page }) => {
    let id, rules;
    await setup(page, registry => {
      const tile = registry.tiles[0]; id = tile.id;
      rules = { version: 2, blocks: [{ if: { type: "exists", property: "p" }, then: [{ type: "narrative", text: "Preserved" }] }] };
      (location === "condition" ? rules.blocks[0].if : rules.blocks[0].then[0]).future = { keep: [0, "value"] };
      tile.definition.propertyRules = rules;
    });
    await select(page, id);
    await expect(editor(page)).toContainText("original JSON is preserved");
    await expect(editor(page).getByRole("button", { name: "Add property-rule block" })).toHaveCount(0);
    await page.locator("#exportDoc").click();
    expect((await written(page)).tiles.find(tile => tile.id === id).definition.propertyRules).toEqual(rules);
  });
}
