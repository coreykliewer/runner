import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const fixtureOrigin = "http://127.0.0.1:8767";
let fixtureServer;
test.beforeAll(async () => {
  fixtureServer = spawn(process.execPath, ["scripts/dev-server.mjs", "8767", "--encounter-playtest"], { windowsHide: true });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Reroll fixture server did not start")), 10000);
    fixtureServer.once("error", error => { clearTimeout(timeout); reject(error); });
    fixtureServer.once("exit", code => { clearTimeout(timeout); reject(new Error("Reroll fixture server exited: " + code)); });
    fixtureServer.stdout.on("data", data => {
      if (data.toString().includes("Runner dev server:")) { clearTimeout(timeout); resolve(); }
    });
  });
});
test.afterAll(() => { fixtureServer?.kill(); });

async function restore(page, { mode, die1, die2, budget }) {
  const levelKey = mode === "normal" ? "default" : "encounter-playtest";
  const limit = budget === "unlimited" ? null : mode === "normal" ? 1 : 2;
  const rollCount = budget === "exhausted" ? limit : limit == null ? 3 : limit - 1;
  await page.route("**/levels.json*", async route => {
    const response = await route.fetch();
    const levels = await response.json();
    // Preserve each server's real map/catalog, changing only the test's roll budget.
    if (limit == null) delete levels.levels[levelKey].rollLimit;
    else levels.levels[levelKey].rollLimit = limit;
    await route.fulfill({ response, json: levels });
  });
  await page.addInitScript(state => {
    // Do not reseed when checking persistence through the subsequent reload.
    if (!sessionStorage.getItem("reroll-regression-seeded")) {
      localStorage.setItem("runner:v2:state", JSON.stringify(state));
      sessionStorage.setItem("reroll-regression-seeded", "1");
    }
  }, { version: 2, levelKey,
    runner: { hearts: 5, score: 0, kills: 0, turbo: false, turboMultiplier: 2 },
    dice: { dieValue1: die1, dieValue2: die2, selectedDie: "die1", rollCount }, world: {} });
  const origin = mode === "normal" ? "" : fixtureOrigin;
  await page.goto(origin + "/" + (mode === "normal" ? "" : "?runnerTrace=1") + "#resume=1");
  await expect(page.locator("#create-resume-link")).toBeEnabled();
  await page.evaluate(() => {
    window.regressionRngDraws = 0;
    const values = [1 / 6, 2 / 6];
    Math.random = () => values[window.regressionRngDraws++] ?? 0;
  });
  expect(await page.evaluate(() => window.getCurrentRollLimitState())).toMatchObject({
    rollLimit: limit, rollsUsed: rollCount, rollsRemaining: limit == null ? null : limit - rollCount
  });
  return { limit, rollCount };
}

for (const mode of ["normal", "fixture"]) {
  for (const [die1, die2] of [[0, 1], [1, 0], [0, 0], [1, 1]]) {
    for (const budget of ["remaining", "exhausted", "unlimited"]) {
      test(mode + " End Turn + Roll at (" + die1 + "," + die2 + ") with " + budget + " rolls", async ({ page }) => {
        const { rollCount } = await restore(page, { mode, die1, die2, budget });
        await page.locator("#roll").click();
        const batches = await page.evaluate(() => window.getRunnerDiceEventBatches());
        const changes = batches.flatMap(b => b.events).filter(e => e.source.kind === "end_turn");
        const snapshots = [];
        if (die1) snapshots.push({ die1: 0, die2 });
        if (die2) snapshots.push({ die1: 0, die2: 0 });
        expect(changes.map(e => e.after)).toEqual(snapshots);
        expect(changes.every(e => e.valueChanged)).toBe(true);
        const state = await page.evaluate(() => window.getRunnerDiceEngineState());
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("runner:v2:state")));
        if (budget === "exhausted") {
          await expect(page.locator("#log")).toContainText("Out of rolls");
          expect(state.dice).toEqual({ die1: 0, die2: 0 });
          expect(state.playerRollCount).toBe(rollCount);
          expect(await page.evaluate(() => window.regressionRngDraws)).toBe(0);
          expect(saved.turn.outcome.kind).toBe("death");
          expect(batches.flatMap(b => b.events).some(e => e.type === "die_rolled")).toBe(false);
          await page.locator("#roll").click();
          expect((await page.locator("#log").innerText()).match(/Game over/g)).toHaveLength(1);
          await expect(page.locator("#die1")).toHaveText("0");
          await expect(page.locator("#die2")).toHaveText("0");
        } else {
          expect(state.dice).toEqual({ die1: 2, die2: 3 });
          expect(state.playerRollCount).toBe(rollCount + 1);
          expect(await page.evaluate(() => window.regressionRngDraws)).toBe(2);
          const events = batches.at(-1).events;
          expect(events.map(e => e.after)).toEqual([{ die1: 2, die2: 0 }, { die1: 2, die2: 3 }]);
          expect(events[0].before).toEqual({ die1: 0, die2: 0 });
          expect(saved.turn.phase).toBe("active");
          expect(saved.turn.rollId).toBe(state.currentRollId);
        }
        expect(saved.dice.rollCount).toBe(state.playerRollCount);
        expect(await page.evaluate(() => window.getRunnerDiceEventBatches().every(b => Object.isFrozen(b.events[0].after)))).toBe(true);
        if (mode === "fixture") {
          const ended = await page.evaluate(() => window.getRunnerEventTrace().records.filter(r => r.type === "turn_ended"));
          expect(ended).toHaveLength(die1 + die2 > 0 || rollCount > 0 ? 1 : 0);
        }
        await page.reload();
        await expect(page.locator("#create-resume-link")).toBeEnabled();
        expect(await page.evaluate(() => window.getRunnerDiceEngineState().dice)).toEqual(state.dice);
        expect(await page.evaluate(() => window.getRunnerDiceEngineState().playerRollCount)).toBe(state.playerRollCount);
        expect(await page.evaluate(() => window.getRunnerDiceEventBatches())).toEqual([]);
        if (budget === "exhausted") {
          await page.locator("#roll").click();
          expect(await page.evaluate(() => window.getRunnerDiceEventBatches())).toEqual([]);
          await expect(page.locator("#log")).not.toContainText("Game over");
        }
      });
    }
  }
}
