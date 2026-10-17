import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createPropertyPlaytest } from "../fixtures/property-rules-playtest.js";

async function install(page, { layout = "walk", properties = {}, dice = [6, 6], turbo = false } = {}) {
  const fixture = createPropertyPlaytest(JSON.parse(await readFile("tiles2.legacy.json", "utf8")),
    JSON.parse(await readFile("fixtures/property-rules.json", "utf8")), { layout });
  await page.route("**/tiles2.json*", route => route.fulfill({ json: fixture.registry }));
  await page.route("**/levels.json*", route => route.fulfill({ json: fixture.levels }));
  await page.addInitScript(({ properties, dice, turbo }) => {
    if (!sessionStorage.getItem("properties-seeded")) {
      localStorage.setItem("runner:v2:state", JSON.stringify({ version: 2, levelKey: "properties",
        runner: { hearts: 5, properties, turbo }, dice: { dieValue1: dice[0], dieValue2: dice[1], rollCount: 1 } }));
      sessionStorage.setItem("properties-seeded", "1");
    }
    Math.random = () => 0.5;
  }, { properties, dice, turbo });
  return fixture;
}
async function boot(page, options) {
  await install(page, options);
  await page.goto("/?runnerTrace=1#resume=1");
  await expect(page.locator("#create-resume-link")).toBeEnabled();
}
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem("runner:v2:state")));
const trace = page => page.evaluate(() => window.getRunnerEventTrace().records);
const move = (page, direction) => page.locator(`#btn-${direction}`).click();
const propertyStats = page => page.locator("#info .runner-property-stat");

test("stats read arbitrary acquired properties immediately at the entry boundary and reset on a fresh run", async ({ page }) => {
  await boot(page, { properties: { zeta: 0, alpha: 7 } });
  await expect(propertyStats(page)).toHaveText(["alpha: 7", "zeta: 0"]);
  // Inspect before movement's later UI refresh to verify the rule handler updates it.
  const rows = await page.evaluate(() => {
    enterRunnerCell(2, 1, "stats_test");
    return [...document.querySelectorAll(".runner-property-stat")].map(row => row.textContent);
  });
  expect(rows).toEqual(["alpha: 7", "wet: 5", "zeta: 0"]);
  await expect(page.locator("#info")).toContainText("Hearts: 5");
  await page.evaluate(() => { deathReason = "Stats reset test"; endGame(); });
  await expect(propertyStats(page)).toHaveText(rows);
  await expect(page.locator("#info")).toContainText("Moves: 0");
  await page.reload();
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  await expect(propertyStats(page)).toHaveText(rows);
  await page.goto("/");
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  await expect(propertyStats(page)).toHaveCount(0);
});

test("stats render property names as text without interpreting markup", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    runner.properties = { "<img src=x onerror=alert(1)>": 2 };
    updateInfo();
  });
  await expect(propertyStats(page)).toHaveText(["<img src=x onerror=alert(1)>: 2"]);
  await expect(page.locator("#info img")).toHaveCount(0);
});

test("Water → repeated Air → Fire uses entry snapshots and no stationary or blocked entries", async ({ page }) => {
  await boot(page);
  expect((await saved(page)).runner.propertyEntry.sequence).toBe(0);
  await expect(propertyStats(page)).toHaveCount(0);
  await move(page, "left"); // solid boundary
  await page.locator("#die2").click();
  await page.locator("#roll").click(); // dice changes only on supported spawn
  expect((await trace(page)).filter(r => r.type === "tile_entry")).toHaveLength(0);
  await move(page, "right");
  expect((await saved(page)).runner.properties).toEqual({ wet: 5 });
  await expect(propertyStats(page)).toHaveText(["wet: 5"]);
  await move(page, "right");
  expect((await saved(page)).runner.properties).toEqual({ wet: 4 });
  await move(page, "right");
  expect((await saved(page)).runner.properties).toEqual({ wet: 3 });
  await move(page, "left");
  expect((await saved(page)).runner.properties).toEqual({ wet: 2 });
  await move(page, "right");
  expect((await saved(page)).runner.properties).toEqual({ wet: 1 });
  await move(page, "right");
  expect((await saved(page)).runner.properties).toEqual({ wet: 1, burning: 1 });
  const records = await trace(page);
  expect(records.filter(r => r.type === "tile_entry")).toHaveLength(6);
  const fire = records.filter(r => r.type === "property_rules").at(-1).evaluation;
  expect(fire.entrySnapshot).toEqual({ wet: 1 });
  expect(fire.blocks.map(block => block.matched)).toEqual([true, false]);
  await expect(page.locator("#info")).toContainText("Hearts: 5");
});

test("sufficient wetness extinguishes burning fully; repeated Air retains acquired zero", async ({ page }) => {
  await boot(page);
  for (let step = 0; step < 4; step++) await move(page, "right");
  expect((await saved(page)).runner.properties).toEqual({ wet: 1, burning: 0 });
  await move(page, "left");
  expect((await saved(page)).runner.properties).toEqual({ wet: 0, burning: 0 });
  await expect(propertyStats(page)).toHaveText(["burning: 0", "wet: 0"]);
  await move(page, "left");
  expect((await saved(page)).runner.properties).toEqual({ wet: 0, burning: 0 });
  const result = (await trace(page)).filter(r => r.type === "property_rules").at(-1).evaluation;
  expect(result.effects).toEqual([]);
  await page.reload();
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  expect((await saved(page)).runner.properties).toEqual({ wet: 0, burning: 0 });
  expect((await trace(page)).filter(r => r.type === "tile_entry")).toEqual([]);
  await expect(propertyStats(page)).toHaveText(["burning: 0", "wet: 0"]);
});

for (const dice of [[6, 6], [1, 0]]) {
  test(`gravity emits one entry per cell with ${dice[0] + dice[1]} starting time`, async ({ page }) => {
    await boot(page, { layout: "gravity", dice });
    await move(page, "right");
    if (dice[0] + dice[1] > 1) {
      // Step gravity entered Water; explicit down then enters Air and Fire.
      expect((await saved(page)).runner.properties).toEqual({ wet: 5 });
      await move(page, "down");
      await move(page, "down");
    }
    expect((await saved(page)).runner.properties).toEqual({ wet: 2, burning: 0 });
    const entries = (await trace(page)).filter(r => r.type === "tile_entry").map(r => r.batch.events[0]);
    expect(entries.map(e => e.to)).toEqual([{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }]);
    expect(new Set(entries.map(e => e.eventId)).size).toBe(4);
    expect(entries[1].cause).toBe(dice[0] + dice[1] > 1 ? "gravity_step" : "gravity_full");
  });
}

test("turbo enters both cells exactly once", async ({ page }) => {
  await boot(page, { turbo: true });
  await move(page, "right");
  expect((await saved(page)).runner.properties).toEqual({ wet: 4 });
  expect((await trace(page)).filter(r => r.type === "tile_entry").map(r => r.batch.events[0].cause)).toEqual(["turbo", "turbo"]);
});

test("unaffordable movement and forced-down against a floor are not entries", async ({ page }) => {
  await boot(page, { dice: [0, 0] });
  for (const direction of ["right", "up", "down"]) await move(page, direction);
  expect((await saved(page)).runner.properties).toEqual({});
  expect((await saved(page)).runner.propertyEntry.sequence).toBe(0);
  expect((await trace(page)).filter(r => r.type === "tile_entry")).toEqual([]);
});

test("a pending bounce enters its destination once without spending dice", async ({ page }) => {
  await boot(page, { layout: "bounce" });
  await page.evaluate(() => {
    runner.bouncePending = true;
    runner.bounceHeightRemaining = 1;
    doBounceStep();
  });
  expect((await saved(page)).runner.properties).toEqual({ wet: 5 });
  const entries = (await trace(page)).filter(r => r.type === "tile_entry");
  expect(entries).toHaveLength(1);
  expect(entries[0].batch.events[0].cause).toBe("bounce");
  expect((await saved(page)).dice).toMatchObject({ dieValue1: 6, dieValue2: 6 });
});

test("malformed authored rules are atomic and observable while the successful entry remains consumed", async ({ page }) => {
  const fixture = await install(page);
  fixture.registry.tiles.find(tile => tile.id === fixture.ids.Water).definition.propertyRules.blocks.push({ then: [{ operation: "unknown", property: "wet", value: 2 }] });
  await page.goto("/?runnerTrace=1#resume=1");
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  await move(page, "right");
  expect((await saved(page)).runner.properties).toEqual({});
  expect((await saved(page)).runner.propertyEntry.sequence).toBe(1);
  const result = (await trace(page)).find(r => r.type === "property_rules");
  expect(result.evaluation.ok).toBe(false);
  expect(result.diagnostics.some(d => d.code === "unsupported_operation")).toBe(true);
});

test("local and fresh-browser portable resume retain property values and entry sequence without spawn effects", async ({ page, browser }) => {
  await boot(page);
  await move(page, "right");
  await move(page, "right");
  const before = (await saved(page)).runner;
  const oldWaterEntry = (await trace(page)).find(r => r.type === "tile_entry").batch;
  await page.reload();
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  expect((await saved(page)).runner.properties).toEqual(before.properties);
  expect((await saved(page)).runner.propertyEntry).toEqual(before.propertyEntry);
  expect((await trace(page)).filter(r => r.type === "tile_entry")).toEqual([]);
  await move(page, "right"); // canonical spawn -> legitimate new Water entry
  expect((await saved(page)).runner.propertyEntry.sequence).toBe(before.propertyEntry.sequence + 1);
  for (let step = 0; step < 3; step++) await move(page, "right");
  await Promise.all([page.waitForEvent("load"), move(page, "right")]);
  await page.waitForURL(/level=destination/);
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  const destination = await saved(page);
  expect(destination.levelKey).toBe("destination");
  expect(destination.runner.properties).toEqual({ wet: 1, burning: 0 });
  await expect(propertyStats(page)).toHaveText(["burning: 0", "wet: 1"]);
  const metadata = destination.runner.propertyEntry;
  await page.locator("#create-resume-link").click();
  const url = await page.locator("#resume-link").inputValue();
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await install(fresh);
  await fresh.goto(url);
  await expect(fresh.locator("#create-resume-link")).toBeEnabled();
  expect((await saved(fresh)).runner.properties).toEqual(destination.runner.properties);
  await expect(propertyStats(fresh)).toHaveText(["burning: 0", "wet: 1"]);
  expect((await saved(fresh)).runner.propertyEntry).toEqual(metadata);
  const fixtureRules = JSON.parse(await readFile("fixtures/property-rules.json", "utf8")).tiles.Water.propertyRules;
  // Portable links carry the high-water marker, not the old dispatcher's ledger.
  await fresh.evaluate(async ({ batch, rules }) => {
    const { tileEntryRule } = await import("/src/tileEntry.js");
    getRuleDispatcher().dispatch({ batches: batch, rules: [tileEntryRule(batch.events[0].source, { propertyRules: rules })] });
    savePersistentGameState({ checkpoint: true });
  }, { batch: oldWaterEntry, rules: fixtureRules });
  expect((await saved(fresh)).runner.properties).toEqual(destination.runner.properties);
  expect((await saved(fresh)).runner.propertyEntry).toEqual(metadata);
  expect((await trace(fresh)).some(r => r.type === "property_rules" && r.applied === false)).toBe(true);
  // Destination spawn itself is Fire, but restoring there must not apply it.
  await fresh.locator("#roll").click(); // Portable checkpoints start without an active dice roll.
  await move(fresh, "right");
  expect((await saved(fresh)).runner.properties).toEqual({ wet: 5, burning: 0 });
  await expect(propertyStats(fresh)).toHaveText(["burning: 0", "wet: 5"]);
  expect((await saved(fresh)).runner.propertyEntry.sequence).toBe(metadata.sequence + 1);
  await context.close();
});
