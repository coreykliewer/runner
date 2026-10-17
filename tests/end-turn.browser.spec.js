import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEncounterPlaytest } from "../fixtures/encounter-playtest.js";

const rule = (id, phase, threshold, priority = 0, amount = 1) => ({ id, order: priority + 1, priority,
  ...(phase === "turn_ended" ? { activation: { scope: "once_per_turn" } } : {}),
  trigger: { events: [phase], minDistance: 1, maxDistance: 2, distance: "manhattan", position: "any", repeat: "once_per_roll" },
  conditions: [{ type: "sum_comparison", operator: "<=", value: threshold }], actions: [{ type: "damage", amount, message: id }] });

async function scenario(page, { rules = [], dice = [1, 1], used = 1, hearts = 5, objective = false, water = false } = {}) {
  const { registry, levels } = createEncounterPlaytest(JSON.parse(await readFile("tiles2.legacy.json", "utf8")));
  const creature = registry.tiles.find(tile => tile.name === "Snapshot sentinel");
  creature.definition.encounterRules.rules = rules;
  const level = levels.levels["encounter-playtest"];
  if (objective) level.map.cells[1][1] = registry.tiles.find(tile => tile.definition.exit).id;
  if (water) level.map.cells[1][1] = registry.legacyIdMapping.W;
  await page.route("**/tiles2.json*", route => route.fulfill({ json: registry }));
  await page.route("**/levels.json*", route => route.fulfill({ json: levels }));
  await page.addInitScript(({ dice, used, hearts }) => {
    if (!sessionStorage.getItem("end-turn-seeded")) {
      localStorage.setItem("runner:v2:state", JSON.stringify({ version: 2, levelKey: "encounter-playtest",
        runner: { hearts, score: 0, kills: 0, turbo: false, turboMultiplier: 2 },
        dice: { dieValue1: dice[0], dieValue2: dice[1], selectedDie: "die2", rollCount: used }, world: {} }));
      sessionStorage.setItem("end-turn-seeded", "1");
    }
    window.rngDraws = 0;
    Math.random = () => [1 / 6, 2 / 6][window.rngDraws++] ?? 0;
  }, { dice, used, hearts });
  await page.goto("/?runnerTrace=1#resume=1");
  await expect(page.locator("#create-resume-link")).toBeEnabled();
}
const trace = page => page.evaluate(() => window.getRunnerEventTrace().records);

test("closing snapshots use global priority before explicit turn effects and new-roll events", async ({ page }) => {
  await scenario(page, { rules: [rule("early-low", "dice_changed", 1), rule("late-high", "dice_changed", 0, 10),
    { ...rule("automatic-end", "turn_ended", 0, 50), activation: { scope: "attacker_per_player_roll" } },
    rule("explicit-end", "turn_ended", 0, 100)] });
  await page.locator("#roll").click();
  const records = await trace(page);
  const damage = records.filter(r => r.type === "damage_applied");
  expect(damage.map(r => r.message)).toEqual(["late-high", "explicit-end"]);
  expect(damage[0].snapshot).toEqual({ die1: 0, die2: 0 });
  const ended = records.find(r => r.type === "turn_ended");
  expect(damage[0].traceSequence).toBeLessThan(ended.traceSequence);
  expect(damage[1].traceSequence).toBeGreaterThan(ended.traceSequence);
  expect(records.find(r => r.type === "dice_mutation" && r.event.type === "die_rolled").traceSequence).toBeGreaterThan(damage[1].traceSequence);
  expect(records.some(r => r.type === "attack_suppressed")).toBe(true);
  expect(await page.evaluate(() => window.getRunnerDiceEngineState().playerRollCount)).toBe(2);
  await expect(page.locator("#info")).toContainText("Hearts: 3");
  await page.locator("#roll").click();
  expect((await trace(page)).filter(r => r.type === "damage_applied")).toHaveLength(4);
  expect((await trace(page)).filter(r => r.type === "turn_ended")).toHaveLength(2);
  await expect(page.locator("#log")).toContainText("Out of rolls");
});

test("initial water damage does not invent a turn end; active water damage runs once before rolling", async ({ page }) => {
  await scenario(page, { water: true, used: 0, dice: [0, 0] });
  await page.locator("#roll").click();
  expect((await trace(page)).filter(r => r.type === "turn_ended")).toHaveLength(0);
  expect((await trace(page)).filter(r => r.type === "damage_applied")).toHaveLength(1);
  await expect(page.locator("#info")).toContainText("Hearts: 4");
  await page.locator("#roll").click();
  expect((await trace(page)).filter(r => r.type === "turn_ended")).toHaveLength(1);
  expect((await trace(page)).filter(r => r.type === "damage_applied")).toHaveLength(2);
  await expect(page.locator("#info")).toContainText("Hearts: 3");
  await page.locator("#roll").click();
  expect((await trace(page)).filter(r => r.type === "damage_applied")).toHaveLength(3);
  expect((await trace(page)).filter(r => r.type === "turn_ended")).toHaveLength(2);
  await expect(page.locator("#log")).toContainText("Out of rolls");
});

for (const used of [0, 1]) {
  test(`lethal water damage prevents the next roll (prior rolls: ${used})`, async ({ page }) => {
    await scenario(page, { water: true, hearts: 1, used, dice: used ? [0, 1] : [0, 0] });
    await page.locator("#roll").click();
    expect(await page.evaluate(() => window.rngDraws)).toBe(0);
    expect(await page.evaluate(() => window.getRunnerDiceEngineState().playerRollCount)).toBe(used);
    expect((await trace(page)).filter(r => r.type === "damage_applied")).toHaveLength(1);
    expect((await trace(page)).filter(r => r.type === "turn_ended")).toHaveLength(used);
    await expect(page.locator("#log")).toContainText("Game over");
  });
}

for (const phase of ["dice_changed", "turn_ended"]) {
  test(`lethal ${phase} prevents RNG, a new roll and objective success; death survives reload`, async ({ page }) => {
    await scenario(page, { objective: true, rules: [rule("lethal", phase, 0, 0, 5)] });
    await page.locator("#roll").click();
    await expect(page.locator("#log")).toContainText("Game over");
    expect(await page.evaluate(() => window.rngDraws)).toBe(0);
    expect(await page.evaluate(() => window.getRunnerDiceEngineState().playerRollCount)).toBe(1);
    expect((await trace(page)).some(r => r.type === "objective_complete")).toBe(false);
    expect((await trace(page)).some(r => r.type === "dice_mutation" && r.event.type === "die_rolled")).toBe(false);
    await page.reload();
    await expect(page.locator("#create-resume-link")).toBeEnabled();
    await page.locator("#roll").click();
    expect((await trace(page)).filter(r => ["damage_applied", "game_over", "turn_ended"].includes(r.type))).toEqual([]);
    expect(await page.evaluate(() => window.rngDraws)).toBe(0);
  });
}

test("surviving end-turn resolution completes the objective ahead of roll-limit death", async ({ page }) => {
  await scenario(page, { objective: true, used: 2, rules: [rule("final-hit", "turn_ended", 0)] });
  await page.locator("#roll").click();
  await expect(page.locator("#log")).toContainText("Level complete.");
  await expect(page.locator("#log")).not.toContainText("Out of rolls");
  expect(await page.evaluate(() => window.rngDraws)).toBe(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("runner:v2:state")));
  expect(saved.runner.hearts).toBe(4);
  expect(saved.turn.outcome.kind).toBe("success");
  // Roll completion is terminal in this level, rather than movement-based exit routing.
  expect(saved.levelKey).toBe("encounter-playtest");
  expect(saved.dice.rollCount).toBe(2);
  await expect(page).toHaveURL(/#resume=1$/);
  await page.reload();
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  await page.locator("#roll").click();
  expect((await trace(page)).filter(r => ["damage_applied", "objective_complete", "turn_ended"].includes(r.type))).toEqual([]);
});

test("a movement attack guard survives resume and remains active while closing its roll", async ({ page }) => {
  await scenario(page, { dice: [2, 4], used: 2, rules: [rule("guarded", "dice_changed", 3)] });
  await page.locator("#btn-right").click();
  await expect(page.locator("#info")).toContainText("Hearts: 4");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("runner:v2:state")));
  expect(saved.turn.ledger.attackerRollKeys).toHaveLength(1);
  await page.reload();
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  await page.locator("#roll").click();
  expect((await trace(page)).filter(r => r.type === "damage_applied")).toHaveLength(0);
  expect((await trace(page)).some(r => r.type === "attack_suppressed")).toBe(true);
  await expect(page.locator("#info")).toContainText("Hearts: 4");
  await expect(page.locator("#log")).toContainText("Out of rolls");
});
