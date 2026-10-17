import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createPropertyPlaytest } from "../fixtures/property-rules-playtest.js";

const fixtures = JSON.parse(await readFile("fixtures/property-rules-v2.json", "utf8"));
const achievement = { type: "achievement", id: "native_fixture_award", title: "Native fixture award" };
const property = (property, value) => ({ type: "property", operation: "set", property, value });
async function install(page, { rules = fixtures.Burning, properties = {}, hearts = 3, layout = "walk", dice = [6, 6], onExit = false } = {}) {
  const content = JSON.parse(await readFile("fixtures/property-rules.json", "utf8"));
  const fixture = createPropertyPlaytest(JSON.parse(await readFile("tiles2.legacy.json", "utf8")), content, { layout });
  for (const id of Object.values(fixture.ids)) fixture.registry.tiles.find(tile => tile.id === id).definition.propertyRules = structuredClone(rules);
  if (onExit) fixture.registry.tiles.find(tile => tile.definition.exit === true).definition.propertyRules = structuredClone(rules);
  await page.route("**/tiles2.json*", route => route.fulfill({ json: fixture.registry }));
  await page.route("**/levels.json*", route => route.fulfill({ json: fixture.levels }));
  await page.addInitScript(({ properties, hearts, dice }) => {
    if (!sessionStorage.getItem("native-seeded")) {
      localStorage.setItem("runner:v2:state", JSON.stringify({ version: 2, levelKey: "properties",
        runner: { hearts, properties }, dice: { dieValue1: dice[0], dieValue2: dice[1], rollCount: 1 } }));
      sessionStorage.setItem("native-seeded", "1");
    }
    Math.random = () => 0.5;
  }, { properties, hearts, dice });
  return fixture;
}
async function boot(page, options) {
  const fixture = await install(page, options);
  await page.goto("/?runnerTrace=1#resume=1");
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  return fixture;
}
const move = (page, direction = "right") => page.locator(`#btn-${direction}`).click();
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem("runner:v2:state")));
const trace = page => page.evaluate(() => window.getRunnerEventTrace().records);
const logCount = (page, text) => page.locator("#log .log-line").filter({ hasText: text }).count();

test("canonical Burning uses actual native damage every third exposure and logs in authored order", async ({ page }) => {
  await boot(page);
  const observed = [];
  for (const direction of ["right", "right", "left", "right", "left", "right"]) {
    await move(page, direction);
    const state = await saved(page);
    observed.push([state.runner.properties.burning, state.runner.hearts]);
  }
  expect(observed).toEqual([[1, 3], [2, 3], [0, 2], [1, 2], [2, 2], [0, 1]]);
  const records = await trace(page);
  expect(records.filter(record => record.type === "damage_applied")).toHaveLength(2);
  expect(records.filter(record => record.type === "property_native_effect").map(record => record.effect.type))
    .toEqual(["lose_hearts", "narrative", "lose_hearts", "narrative"]);
  await expect(page.locator("#info .runner-property-stat")).toHaveText(["burning: 0"]);
  await expect(page.locator("#log")).toContainText("The accumulated heat hurts.");
});

for (const damageFirst of [false, true]) {
  test(`lethal entry preserves authored ${damageFirst ? "damage-before-reset" : "reset-before-damage"} and cannot replay on reload`, async ({ page }) => {
    const rules = structuredClone(fixtures.Burning);
    if (damageFirst) [rules.blocks[1].then[0], rules.blocks[1].then[1]] = [rules.blocks[1].then[1], rules.blocks[1].then[0]];
    await boot(page, { rules, hearts: 1, properties: { burning: 2 } });
    await move(page);
    const state = await saved(page);
    expect(state.runner.hearts).toBe(0);
    expect(state.runner.properties.burning).toBe(damageFirst ? 3 : 0);
    expect(state.runner.propertyEntry.execution.status).toBe("terminal");
    expect(state.turn.outcome.kind).toBe("death");
    expect((await trace(page)).filter(record => record.type === "damage_applied")).toHaveLength(1);
    await expect(page.locator("#log")).not.toContainText("The accumulated heat hurts.");
    await page.reload();
    await expect(page.locator("#create-resume-link")).toBeEnabled();
    expect((await saved(page)).runner.hearts).toBe(0);
    expect((await trace(page)).filter(record => record.type === "damage_applied")).toHaveLength(0);
    await page.locator("#roll").click();
    expect((await saved(page)).dice.rollCount).toBe(1);
  });
}

test("achievement acquisition and narrative delivery cannot replay; fresh portable resume retains one-time unlock", async ({ page, browser }) => {
  const rules = { version: 2, blocks: [{ then: [achievement, { type: "narrative", text: "Entry narration fixture" }] }] };
  await boot(page, { rules });
  await move(page);
  expect((await saved(page)).runner.achievements.filter(item => item.id === achievement.id)).toHaveLength(1);
  expect(await logCount(page, "Native fixture award")).toBe(1);
  const oldBatch = (await trace(page)).find(record => record.type === "tile_entry").batch;
  await page.evaluate(async ({ batch, rules }) => {
    const { tileEntryRule } = await import("/src/tileEntry.js");
    getRuleDispatcher().dispatch({ batches: batch, rules: [tileEntryRule(batch.events[0].source, { propertyRules: rules })] });
  }, { batch: oldBatch, rules });
  expect(await logCount(page, "Native fixture award")).toBe(1);
  expect(await logCount(page, "Entry narration fixture")).toBe(1);
  await page.locator("#create-resume-link").click();
  const url = await page.locator("#resume-link").inputValue();
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await install(fresh, { rules });
  await fresh.goto(url);
  await expect(fresh.locator("#create-resume-link")).toBeEnabled();
  await fresh.evaluate(async ({ batch, rules }) => {
    const { tileEntryRule } = await import("/src/tileEntry.js");
    getRuleDispatcher().dispatch({ batches: batch, rules: [tileEntryRule(batch.events[0].source, { propertyRules: rules })] });
  }, { batch: oldBatch, rules });
  expect(await logCount(fresh, "Native fixture award")).toBe(0);
  expect(await logCount(fresh, "Entry narration fixture")).toBe(0);
  await fresh.locator("#roll").click();
  await move(fresh);
  expect(await logCount(fresh, "Native fixture award")).toBe(0);
  expect(await logCount(fresh, "Entry narration fixture")).toBe(1); // New legitimate entry.
  expect((await saved(fresh)).runner.achievements.filter(item => item.id === achievement.id)).toHaveLength(1);
  await context.close();
});

test("a real damage handler throwing after a side effect remains consumed, reports uncertainty, and stops later effects", async ({ page }) => {
  await boot(page, { properties: { burning: 2 } });
  await page.evaluate(() => {
    const original = takeDamage;
    takeDamage = (...args) => { original(...args); throw new Error("Injected failure after damage"); };
  });
  await move(page);
  const state = await saved(page);
  expect(state.runner.hearts).toBe(2);
  expect(state.runner.properties.burning).toBe(0);
  expect(state.runner.propertyEntry.execution.status).toBe("uncertain");
  expect(state.runner.propertyEntry.execution.diagnostics.some(item => item.code === "native_effect_uncertain")).toBe(true);
  expect(state.turn.outcome).toBe(null);
  await expect(page.locator("#log")).not.toContainText("The accumulated heat hurts.");
  await expect(page.locator("#log")).toContainText("A tile effect could not finish");
  await page.reload();
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  expect((await saved(page)).runner.hearts).toBe(2);
  expect((await trace(page)).filter(record => record.type === "damage_applied")).toHaveLength(0);
});

test("storage failure before a native effect prevents damage and narrative", async ({ page }) => {
  await boot(page, { properties: { burning: 2 } });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      const state = key === "runner:v2:state" ? JSON.parse(value) : null;
      if (state?.runner?.propertyEntry?.execution?.status === "pending") throw new Error("Injected quota");
      return original.call(this, key, value);
    };
  });
  await move(page);
  expect((await saved(page)).runner.hearts).toBe(3);
  expect((await saved(page)).runner.propertyEntry.execution.status).toBe("failed");
  expect((await trace(page)).filter(record => record.type === "damage_applied")).toHaveLength(0);
  await expect(page.locator("#log")).not.toContainText("The accumulated heat hurts.");
});

test("gravity entry during a Roll transaction checkpoints consumed identity before lethal damage", async ({ page }) => {
  await boot(page, { layout: "gravity", hearts: 1, properties: { burning: 2 }, dice: [0, 0] });
  await page.evaluate(() => { runner.x = 2; runner.y = 1; }); // Unsupported position, so Roll invokes full gravity.
  await page.locator("#roll").click();
  const state = await saved(page);
  expect(state.runner.hearts).toBe(0);
  expect(state.runner.propertyEntry.sequence).toBe(1);
  expect(state.runner.propertyEntry.execution.status).toBe("terminal");
  expect(state.turn.outcome.kind).toBe("death");
  expect((await trace(page)).filter(record => record.type === "tile_entry")).toHaveLength(1);
  await expect(page.locator("#log")).not.toContainText("The accumulated heat hurts.");
  await page.reload();
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  expect((await saved(page)).runner.hearts).toBe(0);
});

test("Entry/Current conditions and mixed native effects keep authored order, then persist across a level transition", async ({ page }) => {
  const rules = { version: 2, blocks: [
    { then: [property("arbitrary", 1)] },
    { if: { type: "exists", mode: "entry", property: "arbitrary" }, then: [{ type: "lose_hearts", amount: 1 }] },
    { if: { type: "exists", mode: "current", property: "arbitrary" }, then: [achievement,
      { type: "narrative", text: "Mixed ordered fixture" }, property("after", 0)] }
  ] };
  await boot(page, { rules, hearts: 9 });
  await move(page);
  expect((await saved(page)).runner.hearts).toBe(9);
  expect((await saved(page)).runner.properties).toEqual({ arbitrary: 1, after: 0 });
  expect((await trace(page)).filter(record => record.type === "property_native_effect").map(record => record.effect.type))
    .toEqual(["achievement", "narrative"]);
  for (let step = 0; step < 3; step++) await move(page);
  await Promise.all([page.waitForEvent("load"), move(page)]);
  await page.waitForURL(/level=destination/);
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  expect((await saved(page)).runner.achievements.filter(item => item.id === achievement.id)).toHaveLength(1);
  expect((await saved(page)).runner.properties).toEqual({ arbitrary: 1, after: 0 });
  expect((await saved(page)).runner.hearts).toBe(6);
});

test("lethal exit entry resolves death before a movement-based level transition", async ({ page }) => {
  await boot(page, { onExit: true, hearts: 1, properties: { burning: 2 } });
  await page.evaluate(() => { runner.x = 5; runner.y = 1; });
  await move(page);
  expect((await saved(page)).levelKey).toBe("properties");
  expect((await saved(page)).turn.outcome.kind).toBe("death");
  expect((await saved(page)).runner.properties.burning).toBe(0);
  expect(page.url()).not.toContain("level=destination");
});
