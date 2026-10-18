import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createPropertyPlaytest } from "../fixtures/property-rules-playtest.js";

const effect = (property, operation, value) => ({ type: "property", property, operation, value });
const rules = (...then) => ({ version: 3, blocks: [{ then }] });
async function install(page, { definition = rules(effect("Hearts", "add", 1)), properties = {}, hearts = 2.5, score = 3.25, xp = 1.75, onExit = false } = {}) {
  const content = JSON.parse(await readFile("fixtures/property-rules.json", "utf8"));
  const fixture = createPropertyPlaytest(JSON.parse(await readFile("tiles2.legacy.json", "utf8")), content);
  for (const id of Object.values(fixture.ids)) fixture.registry.tiles.find(tile => tile.id === id).definition.propertyRules = structuredClone(definition);
  if (onExit) fixture.registry.tiles.find(tile => tile.definition.exit === true).definition.propertyRules = structuredClone(definition);
  await page.route("**/tiles2.json*", route => route.fulfill({ json: fixture.registry }));
  await page.route("**/levels.json*", route => route.fulfill({ json: fixture.levels }));
  await page.route("**/achievements.json*", route => route.fulfill({ json: { achievements: [
    { id: "native_xp_fixture", title: "Native XP fixture", when: { stat: "xp", atLeast: 2 } },
    { id: "native_score_fixture", title: "Native score fixture", when: { stat: "score", atLeast: 4 } }
  ] } }));
  await page.addInitScript(({ properties, hearts, score, xp }) => {
    if (!sessionStorage.getItem("v3-seeded")) {
      localStorage.setItem("runner:v2:state", JSON.stringify({ version: 2, levelKey: "properties", runner: { properties, hearts, score, xp },
        dice: { dieValue1: 6, dieValue2: 6, rollCount: 1 } }));
      sessionStorage.setItem("v3-seeded", "1");
    }
    Math.random = () => 0.5;
  }, { properties, hearts, score, xp });
  return fixture;
}
async function boot(page, options) {
  await install(page, options);
  await page.goto("/?runnerTrace=1#resume=1");
  await expect(page.locator("#create-resume-link")).toBeEnabled();
}
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem("runner:v2:state")));
const trace = page => page.evaluate(() => window.getRunnerEventTrace().records);
const move = page => page.locator("#btn-right").click();
const announcements = (page, text) => page.locator("#log .log-line").filter({ hasText: text }).count();

for (const [name, field, initial] of [["hEaRtS", "hearts", 2.5], ["DIAMONDS", "score", 3.25], ["xp", "xp", 1.75]]) {
  for (const operation of ["set", "add", "subtract"]) {
    test(`V3 ${name} ${operation} updates the native owner and keeps fractions without custom duplicates`, async ({ page }) => {
      await boot(page, { definition: rules(effect(name, operation, operation === "set" ? 2 : 1)) });
      await move(page);
      const state = await saved(page);
      expect(state.runner[field]).toBe(operation === "set" ? 2 : operation === "add" ? initial + 1 : initial - 1);
      expect(state.runner.properties).toEqual({});
      expect(state.runner.propertyEntry.execution.status).toBe("completed");
      const entry = (await trace(page)).find(record => record.type === "tile_entry").batch.events[0];
      expect(entry.nativeValues).toEqual({ Hearts: 2.5, Diamonds: 3.25, XP: 1.75, Moves: 11 });
      if (field === "hearts" && operation !== "add") expect((await trace(page)).filter(record => record.type === "damage_applied")).toHaveLength(1);
    });
  }
}

test("Current and Entry Values combine custom/native effects and one-time native stat achievements", async ({ page }) => {
  const definition = { version: 3, blocks: [
    { then: [effect("custom_charge", "add", 1), effect("Hearts", "add", 1), effect("XP", "add", 1), effect("Diamonds", "add", 1), effect("XP", "add", 1)] },
    { if: { type: "comparison", mode: "current", property: "hearts", operator: "=", value: 3.5 }, then: [effect("current_health", "set", 1), { type: "narrative", text: "Current native health matched" }] },
    { if: { type: "comparison", property: "HEARTS", operator: "=", value: 2.5 }, then: [effect("entry_health", "set", 1)] },
    { if: { type: "comparison", mode: "current", property: "xp", operator: "=", value: 3.75 }, then: [effect("current_xp", "set", 1)] },
    { if: { type: "comparison", mode: "current", property: "custom_charge", operator: "=", value: 1 }, then: [effect("Diamonds", "subtract", 1)] },
    { if: { type: "comparison", mode: "entry", property: "Moves", operator: "=", value: 11 }, then: [effect("moves_match", "set", 1)] }
  ] };
  await boot(page, { definition }); await move(page);
  const state = await saved(page);
  expect([state.runner.hearts, state.runner.score, state.runner.xp]).toEqual([3.5, 3.25, 3.75]);
  expect(state.runner.properties).toEqual({ custom_charge: 1, current_health: 1, entry_health: 1, current_xp: 1, moves_match: 1 });
  expect(await announcements(page, "Native XP fixture")).toBe(1);
  expect(await announcements(page, "Native score fixture")).toBe(1);
  await expect(page.locator("#log")).toContainText("Current native health matched");
});

for (const healFirst of [true, false]) {
  test(`authored native order ${healFirst ? "healing before damage survives" : "damage before healing stops the sequence"}`, async ({ page }) => {
    const effects = [effect("Hearts", "add", 1), effect("Hearts", "subtract", 1)];
    if (!healFirst) effects.reverse();
    await boot(page, { hearts: 0.5, definition: rules(...effects, effect("after", "set", 1)) });
    await move(page);
    const state = await saved(page);
    expect(state.runner.hearts).toBe(healFirst ? 0.5 : 0);
    expect(state.runner.properties).toEqual(healFirst ? { after: 1 } : {});
    expect(state.runner.propertyEntry.execution.status).toBe(healFirst ? "completed" : "terminal");
  });
}

test("Set Hearts to zero invokes existing death flow before exit transition and stops later effects", async ({ page }) => {
  await boot(page, { onExit: true, definition: rules(effect("before", "set", 0), effect("Hearts", "set", 0), effect("Hearts", "add", 5), { type: "narrative", text: "Must not run" }) });
  await page.evaluate(() => { runner.x = 5; runner.y = 1; });
  await move(page);
  expect((await saved(page)).runner.hearts).toBe(0);
  expect((await saved(page)).runner.properties).toEqual({ before: 0 });
  expect((await saved(page)).turn.outcome.kind).toBe("death");
  expect((await saved(page)).levelKey).toBe("properties");
  await expect(page.locator("#log")).not.toContainText("Must not run");
  await page.reload(); await expect(page.locator("#create-resume-link")).toBeEnabled();
  expect((await saved(page)).runner.hearts).toBe(0);
  expect((await trace(page)).filter(record => record.type === "damage_applied")).toHaveLength(0);
});

test("small Set targets remain exact even when old native health or XP is very large", async ({ page }) => {
  await boot(page, { hearts: 1e20, xp: 1e20, definition: rules(effect("Hearts", "set", 1), effect("XP", "set", 1)) });
  await move(page);
  expect((await saved(page)).runner.hearts).toBe(1);
  expect((await saved(page)).runner.xp).toBe(1);
  expect((await saved(page)).turn.outcome).toBe(null);
});

test("large Set healing targets remain exact from fractional starting health", async ({ page }) => {
  await boot(page, { definition: rules(effect("Hearts", "set", Number.MAX_SAFE_INTEGER)) });
  await move(page);
  expect((await saved(page)).runner.hearts).toBe(Number.MAX_SAFE_INTEGER);
});

test("checkpoint, level transition and fresh portable resume preserve fractional native values and consumed entry", async ({ page, browser }) => {
  const definition = rules(effect("Hearts", "add", 1));
  await boot(page, { definition }); await move(page);
  const batch = (await trace(page)).find(record => record.type === "tile_entry").batch;
  await page.reload(); await expect(page.locator("#create-resume-link")).toBeEnabled();
  expect((await saved(page)).runner.hearts).toBe(3.5);
  for (let step = 0; step < 4; step++) await move(page);
  await Promise.all([page.waitForEvent("load"), move(page)]);
  await page.waitForURL(/level=destination/); await expect(page.locator("#create-resume-link")).toBeEnabled();
  const before = await saved(page);
  expect([before.runner.hearts, before.runner.score, before.runner.xp]).toEqual([7.5, 3.25, 1.75]);
  await page.locator("#create-resume-link").click(); const url = await page.locator("#resume-link").inputValue();
  const context = await browser.newContext(); const fresh = await context.newPage();
  await install(fresh, { definition }); await fresh.goto(url);
  await expect(fresh.locator("#create-resume-link")).toBeEnabled();
  expect([(await saved(fresh)).runner.hearts, (await saved(fresh)).runner.score, (await saved(fresh)).runner.xp]).toEqual([7.5, 3.25, 1.75]);
  await fresh.evaluate(async ({ batch, definition }) => {
    const { tileEntryRule } = await import("/src/tileEntry.js");
    getRuleDispatcher().dispatch({ batches: batch, rules: [tileEntryRule(batch.events[0].source, { propertyRules: definition })] });
  }, { batch, definition });
  expect((await saved(fresh)).runner.hearts).toBe(7.5);
  expect((await trace(fresh)).filter(record => record.type === "property_native_effect")).toHaveLength(0);
  await fresh.locator("#roll").click(); await move(fresh);
  expect((await saved(fresh)).runner.hearts).toBe(8.5);
  await context.close();
});

test("restored legacy name collisions stop V3 without merging custom values or attempting native writes", async ({ page }) => {
  await boot(page, { properties: { hEaRtS: 99, custom: 0 }, definition: rules(effect("Hearts", "set", 1)) }); await move(page);
  const state = await saved(page);
  expect(state.runner.hearts).toBe(2.5);
  expect(state.runner.properties).toEqual({ hEaRtS: 99, custom: 0 });
  expect(state.runner.propertyEntry.execution.diagnostics.some(item => item.code === "reserved_property_collision")).toBe(true);
  expect((await trace(page)).filter(record => record.type === "property_native_effect")).toHaveLength(0);
  await expect(page.locator("#log")).toContainText("a saved custom property uses a reserved name");
});

test("Moves writes reject the whole sequence, preserving authoritative dice and native health", async ({ page }) => {
  await boot(page, { definition: rules(effect("Hearts", "set", 1), effect("mOvEs", "set", 100)) }); await move(page);
  expect((await saved(page)).runner.hearts).toBe(2.5);
  expect((await saved(page)).dice.dieValue1 + (await saved(page)).dice.dieValue2).toBe(11);
  expect((await saved(page)).runner.propertyEntry.execution.diagnostics.some(item => item.code === "read_only_property")).toBe(true);
});

test("native healing throwing after a side effect is uncertain, consumed and not replayed on restore", async ({ page }) => {
  await boot(page, { definition: rules(effect("Hearts", "add", 1), effect("after", "set", 1)) });
  await page.evaluate(() => { const original = healRunner; healRunner = (...args) => { original(...args); throw new Error("Injected after healing"); }; });
  await move(page);
  expect((await saved(page)).runner.hearts).toBe(3.5);
  expect((await saved(page)).runner.properties).toEqual({});
  expect((await saved(page)).runner.propertyEntry.execution.status).toBe("uncertain");
  await page.reload(); await expect(page.locator("#create-resume-link")).toBeEnabled();
  expect((await saved(page)).runner.hearts).toBe(3.5);
});

for (const version of [1, 2]) {
  test(`Version ${version} Hearts remains custom and old integer carry links keep their meaning`, async ({ page }) => {
    const definition = { version, blocks: [{ then: [{ ...(version === 2 ? { type: "property" } : {}), property: "Hearts", operation: "set", value: 99 }] }] };
    await install(page, { definition });
    await page.goto("/?runnerTrace=1#level=properties&st=v1.h4.sc.k3.t0.m2");
    await expect(page.locator("#create-resume-link")).toBeEnabled();
    expect((await saved(page)).runner.hearts).toBe(4);
    expect((await saved(page)).runner.score).toBe(12);
    await page.locator("#roll").click(); await move(page);
    expect((await saved(page)).runner.hearts).toBe(4);
    expect((await saved(page)).runner.properties.Hearts).toBe(99);
  });
}
