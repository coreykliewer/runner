import { test, expect } from "@playwright/test";
import { decodeCarryStats } from "../src/state.js";

const baseMap = (firstRow) => [firstRow, ...Array(14).fill("P25")].join("~");
const movementMap = baseMap("P1R1W1A22");
const sourceMap = baseMap("P1R1D1E{north_gate}1A21");
const destinationMap = baseMap("P1R1A23");
const bottomMap = row => [...Array(13).fill("A25"), row, "P25"].join("~");

async function installRollLimitFixture(page, map, exits = {}) {
  await page.route("**/levels.json*", async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        defaultLevel: "default",
        levels: {
          default: { map, exits, rollLimit: 1 },
          destination: { map: destinationMap }
        }
      }
    });
  });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
}

async function installGameFixtures(page, { routeLevels = false, movementPoints = null } = {}) {
  await page.route("**/tiles2.json*", async route => {
    const response = await route.fetch();
    const tiles = await response.json();
    tiles.W.moveCost = 2;
    await route.fulfill({ response, json: tiles });
  });

  if (routeLevels) {
    await page.route("**/levels.json*", async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: {
          defaultLevel: "default",
          levels: {
            default: {
              map: sourceMap,
              exits: { north_gate: "destination" }
            },
            north_gate: { map: baseMap("P1R1A23") },
            destination: { map: destinationMap }
          }
        }
      });
    });
  }

  await page.addInitScript(points => {
    Math.random = () => 0;
    if (points === null) return;
    localStorage.setItem("runner:v2:state", JSON.stringify({
      version: 2,
      levelKey: "default",
      runner: {
        hearts: 5,
        score: 0,
        kills: 0,
        turbo: false,
        turboMultiplier: 2,
        xp: 0,
        counters: {},
        stats: {},
        achievements: [],
        storyFlags: {}
      },
      dice: {
        dieValue1: points,
        dieValue2: 0,
        selectedDie: "die1",
        rollCount: 0
      },
      world: {}
    }));
  }, movementPoints);
}

async function openMovementMap(page, movementPoints) {
  await installGameFixtures(page, { movementPoints });
  const map = encodeURIComponent(movementMap);
  await page.goto(`/#resume=1&map=${map}`);
  await expect(page.locator("#die1")).toHaveText(String(movementPoints));
  await page.locator("#btn-right").click();
}

test("movement costs block zero and insufficient points, but allow sufficient points", async ({ browser }) => {
  for (const [points, shouldUnlock, remaining] of [[0, true, "0"], [1, true, "1"], [3, false, "1"]]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openMovementMap(page, points);
    if (shouldUnlock) {
      await expect(page.locator("#log")).toContainText("ACHIEVEMENT: Roll before you move.");
    } else {
      await expect(page.locator("#log")).not.toContainText("ACHIEVEMENT: Roll before you move.");
    }
    await expect(page.locator("#die1")).toHaveText(remaining);
    if (points === 3) {
      await expect(page.locator("#log")).toContainText("Right");
    } else {
      await expect(page.locator("#log")).not.toContainText("Right");
    }
    await context.close();
  }
});

test("pickup rewards carry into a mapped exit checkpoint and portable link", async ({ page, browser }) => {
  await installGameFixtures(page, { routeLevels: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Roll Dice" }).click();
  await expect(page.locator("#die1")).toHaveText("1");

  await page.locator("#btn-right").click();
  await expect(page.locator("#log")).toContainText("My precious!");
  await page.locator("#btn-right").click();
  await page.waitForURL(/level=destination/);

  const transitionHash = new URLSearchParams(new URL(page.url()).hash.slice(1));
  expect(transitionHash.get("level")).toBe("destination");
  expect(decodeCarryStats(transitionHash.get("st")).score).toBe(1);

  const savedCheckpoint = await page.evaluate(() => JSON.parse(localStorage.getItem("runner:v2:state")));
  expect(savedCheckpoint.levelKey).toBe("destination");
  expect(savedCheckpoint.runner.score).toBe(1);
  expect(savedCheckpoint.world.pickupsCollected).toEqual([]);

  await page.goto("/#resume=1");
  await page.reload();
  await expect(page.locator("#info")).toContainText("Diamonds: 1");
  await expect(page.locator("#log")).not.toContainText("My precious!");
  await page.getByRole("button", { name: "Create Resume Link" }).click();
  const portableUrl = await page.locator("#resume-link").inputValue();
  const portableHash = new URLSearchParams(new URL(portableUrl).hash.slice(1));
  expect(portableHash.get("level")).toBe("destination");
  expect(portableHash.get("map")).toBeNull();
  expect(decodeCarryStats(portableHash.get("st")).score).toBe(1);

  const freshContext = await browser.newContext();
  const freshPage = await freshContext.newPage();
  await installGameFixtures(freshPage, { routeLevels: true });
  await freshPage.goto(portableUrl);
  await expect(freshPage).toHaveURL(/level=destination/);
  await expect(freshPage.locator("#log")).not.toContainText("My precious!");
  await freshPage.getByRole("button", { name: "Create Resume Link" }).click();
  const freshCheckpointUrl = await freshPage.locator("#resume-link").inputValue();
  const freshHash = new URLSearchParams(new URL(freshCheckpointUrl).hash.slice(1));
  expect(freshHash.get("level")).toBe("destination");
  expect(decodeCarryStats(freshHash.get("st")).score).toBe(1);
  await freshContext.close();
});

test("the final permitted roll grants movement and can complete the level", async ({ page }) => {
  const exitMap = bottomMap("P1R1A1E{finish}1A21");
  await installRollLimitFixture(page, exitMap, { finish: "destination" });
  await page.goto("/");
  await page.getByRole("button", { name: "Roll Dice" }).click();
  await expect(page.locator("#info")).toContainText("Moves: 2");
  await expect(page.locator("#info")).toContainText("Rolls used: 1 (100%)");
  await expect(page.locator("#log")).not.toContainText("Game over");
  await page.getByRole("button", { name: "Roll Dice" }).click();
  await expect(page.locator("#info")).toContainText("Moves: 2");
  await expect(page.locator("#info")).toContainText("Times rolled: 1");
  await expect(page.locator("#log")).not.toContainText("Game over");

  const rollLog = await page.locator("#log").innerText();
  expect(rollLog.indexOf("Rolled 1+1 = 2")).toBeLessThan(
    rollLog.indexOf("Final roll! No rolls remaining after this one.")
  );

  await page.locator("#btn-right").click();
  await expect(page.locator("#log")).toContainText("Right");
  await expect(page.locator("#info")).toContainText("Moves: 1");
  await page.locator("#btn-right").click();
  await page.waitForURL(/level=destination/);
  await expect(page.locator("#log")).not.toContainText("Out of rolls");
});

test("death occurs once when another roll is needed and none remain", async ({ page }) => {
  await installRollLimitFixture(page, bottomMap("P1R1A23"));
  await page.goto("/");
  await page.getByRole("button", { name: "Roll Dice" }).click();
  await expect(page.locator("#info")).toContainText("Moves: 2");
  await page.locator("#btn-right").click();
  await page.locator("#btn-right").click();
  await expect(page.locator("#info")).toContainText("Moves: 0");
  await expect(page.locator("#log")).not.toContainText("Game over");

  await page.getByRole("button", { name: "Roll Dice" }).click();
  await expect(page.locator("#log")).toContainText("Out of rolls");
  await page.getByRole("button", { name: "Roll Dice" }).click();

  const logText = await page.locator("#log").innerText();
  expect(logText.match(/Out of rolls: you used all 1 rolls without finishing the level\./g)).toHaveLength(1);
  expect(logText.match(/Game over/g)).toHaveLength(1);
});

test("reloading during the final roll restores movement points and roll count", async ({ page }) => {
  await installRollLimitFixture(page, bottomMap("P1R1A23"));
  await page.goto("/");
  await page.getByRole("button", { name: "Roll Dice" }).click();
  await page.locator("#btn-right").click();

  const savedDice = await page.evaluate(() => JSON.parse(localStorage.getItem("runner:v2:state")).dice);
  expect(savedDice).toMatchObject({ dieValue1: 0, dieValue2: 1, rollCount: 1 });

  await page.goto("/#resume=1");
  await expect(page.locator("#die1")).toHaveText("0");
  await expect(page.locator("#die2")).toHaveText("1");
  await expect(page.locator("#info")).toContainText("Moves: 1");
  await expect(page.locator("#info")).toContainText("Rolls used: 1 (100%)");
  await expect(page.locator("#log")).not.toContainText("Game over");
});

test("desktop side panels fill the viewport and scroll independently without changing the board or mobile layout", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");

  const desktopLayout = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const frame = document.querySelector("#game-frame");
    const frameStyle = getComputedStyle(frame);
    const left = rect("#controlCenter");
    const right = rect("#log");
    const board = rect("#game-container");
    return {
      viewport: [innerWidth, innerHeight],
      documentHeight: document.documentElement.scrollHeight,
      frameHeight: rect("#game-frame").height,
      frameTop: rect("#game-frame").top,
      leftHeight: left.height,
      leftTop: left.top,
      rightHeight: right.height,
      rightTop: right.top,
      board: { width: board.width, height: board.height },
      overflow: [
        getComputedStyle(document.querySelector("#controlCenter")).overflowY,
        getComputedStyle(document.querySelector("#log")).overflowY
      ]
    };
  });

  expect(desktopLayout.viewport).toEqual([1600, 900]);
  expect(desktopLayout.documentHeight).toBe(900);
  expect(desktopLayout.frameHeight).toBe(900);
  expect(desktopLayout.leftTop).toBe(desktopLayout.frameTop);
  expect(desktopLayout.rightTop).toBe(desktopLayout.frameTop);
  expect(desktopLayout.leftHeight).toBe(900);
  expect(desktopLayout.rightHeight).toBe(900);
  expect(desktopLayout.board).toEqual({ width: 800, height: 510 });
  expect(desktopLayout.overflow).toEqual(["auto", "auto"]);

  await page.evaluate(() => {
    for (const selector of ["#controlCenter", "#log"]) {
      const panel = document.querySelector(selector);
      for (let index = 0; index < 12; index++) {
        const content = document.createElement("div");
        content.style.cssText = "flex: 0 0 120px; height: 120px";
        panel.append(content);
      }
    }
  });
  const panelScroll = await page.evaluate(() => {
    const left = document.querySelector("#controlCenter");
    const right = document.querySelector("#log");
    left.scrollTop = 120;
    right.scrollTop = 240;
    return {
      left: { top: left.scrollTop, overflowing: left.scrollHeight > left.clientHeight },
      right: { top: right.scrollTop, overflowing: right.scrollHeight > right.clientHeight },
      documentHeight: document.documentElement.scrollHeight
    };
  });
  expect(panelScroll.left).toEqual({ top: 120, overflowing: true });
  expect(panelScroll.right).toEqual({ top: 240, overflowing: true });
  expect(panelScroll.documentHeight).toBe(900);

  await page.setViewportSize({ width: 1600, height: 700 });
  const resizedPanelHeight = await page.locator("#controlCenter").evaluate(element => element.getBoundingClientRect().height);
  expect(resizedPanelHeight).toBe(700);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => {
    const game = document.querySelector("#game-container").getBoundingClientRect();
    const left = document.querySelector("#controlCenter").getBoundingClientRect();
    const right = document.querySelector("#log").getBoundingClientRect();
    return {
      display: getComputedStyle(document.querySelector("#game-frame")).display,
      gameBottom: game.bottom,
      leftTop: left.top,
      rightTop: right.top
    };
  });
  expect(mobileLayout.display).toBe("grid");
  expect(mobileLayout.leftTop).toBeGreaterThanOrEqual(mobileLayout.gameBottom);
  expect(mobileLayout.rightTop).toBe(mobileLayout.leftTop);
});