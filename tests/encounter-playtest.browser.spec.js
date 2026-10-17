import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createEncounterPlaytest } from "../fixtures/encounter-playtest.js";

const origin = "http://127.0.0.1:8766";
let server;
test.beforeAll(async () => {
  server = spawn(process.execPath, ["scripts/dev-server.mjs", "8766", "--encounter-playtest"], { windowsHide: true });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Playtest server did not start")), 10000);
    server.once("error", error => { clearTimeout(timeout); reject(error); });
    server.once("exit", code => { clearTimeout(timeout); reject(new Error("Playtest server exited: " + code)); });
    server.stdout.on("data", data => { if (data.toString().includes("Runner dev server:")) { clearTimeout(timeout); resolve(); } });
  });
});
test.afterAll(() => { server?.kill(); });

async function open(page, query = "?runnerTrace=1&fog=off") {
  await page.goto(origin + "/" + query);
  await expect(page.locator("#create-resume-link")).toBeEnabled();
}
const records = page => page.evaluate(() => window.getRunnerEventTrace().records);

test("development scenario explains snapshots, boundaries, suppression, rerolls and roll exhaustion", async ({ page }) => {
  await open(page);
  await page.locator("#roll").click();
  await page.locator("#die1").click();
  await page.locator("#btn-right").click();
  await expect(page.locator("#info")).toContainText("Hearts: 4");
  await expect(page.locator("#log")).toContainText("dice total reached 3 or less during your move");
  await expect(page.locator("#log")).not.toContainText("Legacy duplicate");
  let trace = await records(page);
  const action = trace.find(r => r.type === "player_action" && r.action === "movement");
  expect(action).toMatchObject({ selectedDie: "die1", timeCost: 3, spent: 3, before: { die1: 2, die2: 4 } });
  const mutations = trace.filter(r => r.type === "dice_mutation" && r.event.actionId === action.actionId);
  expect(mutations.map(r => r.event.after)).toEqual([{ die1: 0, die2: 4 }, { die1: 0, die2: 3 }]);
  const damage = trace.find(r => r.type === "damage_applied");
  const boundary = trace.find(r => r.type === "action_boundary" && r.actionIds.includes(action.actionId));
  expect(boundary.player).toEqual({ x: 2, y: 1 });
  expect(boundary.traceSequence).toBeLessThan(damage.traceSequence);
  expect(damage).toMatchObject({ actionId: action.actionId, amount: 1, snapshot: { die1: 0, die2: 3 }, source: { x: 2, y: 0, authoredRuleId: "second-high" } });
  expect(damage.sourceInstanceId).toBeTruthy();
  expect(trace.some(r => r.type === "legacy_hook_skipped" && r.sourceInstanceId === damage.sourceInstanceId)).toBe(true);
  expect(trace.filter(r => r.type === "consequence_ordered").map(r => [r.priority, r.authorOrder])).toEqual([[10, 2], [0, 1]]);
  await page.locator("#btn-left").click();
  await expect(page.locator("#info")).toContainText("Hearts: 4");
  trace = await records(page);
  expect(trace.filter(r => r.type === "damage_applied")).toHaveLength(1);
  expect(trace.some(r => r.type === "attack_suppressed" && r.actionId !== action.actionId && r.rollId === action.rollId)).toBe(true);
  await page.locator("#roll").click();
  await expect(page.locator("#info")).toContainText("Times rolled: 2");
  await expect(page.locator("#log")).toContainText("Final roll!");
  trace = await records(page);
  expect(trace.find(r => r.type === "player_action" && r.action === "early_reroll")).toMatchObject({ discardedTime: 2, timeCost: 0 });
  await page.locator("#roll").click();
  expect((await records(page)).some(r => r.type === "roll_limit" && r.outcome === "blocked_with_time_remaining")).toBe(true);
  await page.locator("#btn-right").click();
  await expect(page.locator("#info")).toContainText("Hearts: 3");
  await expect(page.locator("#info")).toContainText("Moves: 0");
  await page.locator("#roll").click();
  await page.locator("#roll").click();
  await expect(page.locator("#log")).toContainText("Out of rolls");
  trace = await records(page);
  expect(trace.filter(r => r.type === "roll_limit" && r.outcome === "death")).toHaveLength(1);
  expect(trace.filter(r => r.type === "game_over")).toHaveLength(1);
  expect(trace.filter(r => r.type === "damage_applied")).toHaveLength(2);
  expect((await page.locator("#log").innerText()).match(/Game over/g)).toHaveLength(1);
  expect(await page.evaluate(() => {
    const snapshot = window.getRunnerEventTrace();
    return Object.isFrozen(snapshot.records) && Object.isFrozen(snapshot.records.find(r => r.type === "dice_mutation").event.after);
  })).toBe(true);
  await page.getByRole("button", { name: "Refresh diagnostic trace" }).click();
  await expect(page.locator("#encounter-playtest pre")).toContainText("attack_suppressed");
});

test("ordinary player mode does not expose or collect the development trace", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  await page.locator("#roll").click();
  expect(await page.evaluate(() => typeof window.getRunnerEventTrace)).toBe("undefined");
  await expect(page.locator("#encounter-playtest")).toHaveCount(0);
});

test("generic damage feedback omits an intermediate triggering condition", async ({ page }) => {
  const { registry } = createEncounterPlaytest(JSON.parse(await readFile("tiles2.legacy.json", "utf8")));
  const creature = registry.tiles.find(tile => tile.name === "Snapshot sentinel");
  const rule = creature.definition.encounterRules.rules[1];
  rule.conditions = [{ type: "sum_comparison", operator: "==", value: 4 }];
  rule.actions[0].message = "";
  creature.definition.encounterRules.rules = [rule];
  await page.route("**/tiles2.json*", route => route.fulfill({ json: registry }));
  await open(page);
  await page.locator("#roll").click();
  await page.locator("#btn-right").click();
  await expect(page.locator("#log")).toContainText("You take 1 damage.");
  await expect(page.locator("#info")).toContainText("Moves: 3");
  const damage = (await records(page)).find(r => r.type === "damage_applied");
  expect(damage.snapshot).toEqual({ die1: 0, die2: 4 });
  expect(damage.message).toBe("You take 1 damage.");
});

test("early reroll can attack from a mixed old/new snapshot that differs from the displayed roll", async ({ page }) => {
  const { registry } = createEncounterPlaytest(JSON.parse(await readFile("tiles2.legacy.json", "utf8")));
  const creature = registry.tiles.find(tile => tile.name === "Snapshot sentinel");
  const rule = creature.definition.encounterRules.rules[1];
  rule.trigger.events = ["after_roll"];
  rule.conditions = [{ type: "expression", expression: "d1 == 1 && d2 == 4" }];
  rule.actions[0].message = "Sentinel catches the reroll at (1,4).";
  creature.definition.encounterRules.rules = [rule];
  await page.route("**/tiles2.json*", route => route.fulfill({ json: registry }));
  await open(page);
  await page.locator("#roll").click();
  await expect(page.locator("#info")).toContainText("Hearts: 5");
  await page.locator("#roll").click();
  await expect(page.locator("#info")).toContainText("Hearts: 4");
  await expect(page.locator("#die1")).toHaveText("1");
  await expect(page.locator("#die2")).toHaveText("2");
  const trace = await records(page);
  const damage = trace.find(r => r.type === "damage_applied");
  expect(damage.snapshot).toEqual({ die1: 1, die2: 4 });
  const boundary = trace.find(r => r.type === "action_boundary" && r.actionIds.includes(damage.actionId));
  expect(boundary.traceSequence).toBeLessThan(damage.traceSequence);
  expect(trace.filter(r => r.type === "damage_applied")).toHaveLength(1);
  expect(trace.find(r => r.type === "player_action" && r.action === "early_reroll").discardedTime).toBe(6);
});

test("lethal encounter uses the existing death flow once at the resolved movement boundary", async ({ page }) => {
  const { registry } = createEncounterPlaytest(JSON.parse(await readFile("tiles2.legacy.json", "utf8")));
  const creature = registry.tiles.find(tile => tile.name === "Snapshot sentinel");
  creature.definition.encounterRules.rules[1].actions[0].amount = 5;
  await page.route("**/tiles2.json*", route => route.fulfill({ json: registry }));
  await open(page);
  await page.locator("#roll").click();
  await page.locator("#btn-right").click();
  await expect(page.locator("#log")).toContainText("Game over");
  await page.locator("#btn-left").click();
  await page.locator("#roll").click();
  const trace = await records(page);
  const damage = trace.filter(r => r.type === "damage_applied");
  expect(damage).toHaveLength(1);
  expect(damage[0]).toMatchObject({ lethal: true, heartsAfter: 0, player: { x: 2, y: 1 } });
  expect(trace.filter(r => r.type === "game_over")).toHaveLength(1);
  expect((await page.locator("#log").innerText()).match(/Game over/g)).toHaveLength(1);
});
