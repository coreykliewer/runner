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

test("responsive layouts keep panels accessible and the board proportional across viewport sizes", async ({ page }) => {
  const viewports = [
    { name: "desktop", width: 1920, height: 1080, columns: "three", fullHeightPanels: true },
    { name: "laptop", width: 1366, height: 768, columns: "three", fullHeightPanels: true },
    { name: "small laptop", width: 1280, height: 720, columns: "three", fullHeightPanels: true },
    { name: "tablet", width: 1024, height: 768, columns: "stacked", fullHeightPanels: false },
    { name: "phone portrait", width: 390, height: 844, columns: "stacked", fullHeightPanels: false },
    { name: "phone landscape", width: 844, height: 390, columns: "three", fullHeightPanels: true },
    { name: "short desktop", width: 1366, height: 400, columns: "three", fullHeightPanels: true }
  ];

  await page.goto("/");

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => window.scrollTo(0, 0));

    const layout = await page.evaluate(() => {
      const rect = selector => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height
        };
      };
      const frame = rect("#game-frame");
      const left = rect("#controlCenter");
      const board = rect("#game-container");
      const right = rect("#log");
      const canvas = rect("#game");
      return {
        viewport: [innerWidth, innerHeight],
        document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        frame,
        display: getComputedStyle(document.querySelector("#game-frame")).display,
        left,
        board,
        canvas,
        right,
        overflow: [
          getComputedStyle(document.querySelector("#controlCenter")).overflowY,
          getComputedStyle(document.querySelector("#log")).overflowY
        ]
      };
    });
    const label = viewport.name;

    expect(layout.viewport, `${label}: viewport`).toEqual([viewport.width, viewport.height]);
    expect(layout.document[0], `${label}: document horizontal overflow`).toBeLessThanOrEqual(viewport.width);
    expect(layout.frame.left, `${label}: frame left edge`).toBeGreaterThanOrEqual(0);
    expect(layout.frame.right, `${label}: frame right edge`).toBeLessThanOrEqual(viewport.width);
    expect(layout.left.width, `${label}: left panel width`).toBeGreaterThan(0);
    expect(layout.left.height, `${label}: left panel height`).toBeGreaterThan(0);
    expect(layout.right.width, `${label}: right panel width`).toBeGreaterThan(0);
    expect(layout.right.height, `${label}: right panel height`).toBeGreaterThan(0);
    expect(layout.overflow, `${label}: panel overflow behavior`).toEqual(["auto", "auto"]);
    expect(layout.canvas.width / layout.canvas.height, `${label}: canvas aspect ratio`).toBeCloseTo(800 / 510, 3);
    expect(layout.board.width, `${label}: board width`).toBeGreaterThan(0);
    expect(layout.board.height, `${label}: board height`).toBeGreaterThan(0);
    expect(layout.board.bottom, `${label}: board is visible in or reachable by page scrolling`).toBeLessThanOrEqual(layout.document[1] + 1);

    if (viewport.fullHeightPanels) {
      expect(layout.left.top, `${label}: left panel top`).toBe(0);
      expect(layout.right.top, `${label}: right panel top`).toBe(0);
      expect(layout.left.height, `${label}: left panel height`).toBe(viewport.height);
      expect(layout.right.height, `${label}: right panel height`).toBe(viewport.height);
      if (viewport.name === "short desktop") {
        expect(layout.document[1], `${label}: board remains reachable below the viewport`).toBeGreaterThan(viewport.height);
      }
    }

    if (viewport.columns === "three") {
      expect(layout.display, `${label}: three-column layout`).toBe("grid");
      expect(layout.left.right, `${label}: left panel precedes board`).toBeLessThanOrEqual(layout.board.left);
      expect(layout.board.right, `${label}: board precedes right panel`).toBeLessThanOrEqual(layout.right.left);
    } else {
      expect(layout.display, `${label}: stacked layout`).toBe("grid");
      expect(layout.left.top, `${label}: panels follow board`).toBeGreaterThanOrEqual(layout.board.bottom);
      expect(layout.right.top, `${label}: panels share a row`).toBe(layout.left.top);
    }

    const scrollState = await page.evaluate(() => {
      for (const selector of ["#controlCenter", "#log"]) {
        const panel = document.querySelector(selector);
        for (let index = 0; index < 16; index++) {
          const content = document.createElement("div");
          content.dataset.layoutTestContent = "true";
          content.style.cssText = "flex: 0 0 120px; height: 120px";
          panel.append(content);
        }
      }
      const left = document.querySelector("#controlCenter");
      const right = document.querySelector("#log");
      const documentHeight = document.documentElement.scrollHeight;
      left.scrollTop = 120;
      right.scrollTop = 240;
      return {
        left: [left.scrollTop, left.scrollHeight > left.clientHeight],
        right: [right.scrollTop, right.scrollHeight > right.clientHeight],
        documentHeight,
        heightAfterPanelContent: document.documentElement.scrollHeight
      };
    });

    expect(scrollState.left, `${label}: left panel scrolls independently`).toEqual([120, true]);
    expect(scrollState.right, `${label}: right panel scrolls independently`).toEqual([240, true]);
    expect(scrollState.heightAfterPanelContent, `${label}: panel content does not extend the page`).toBe(scrollState.documentHeight);
    await page.evaluate(() => {
      document.querySelectorAll("[data-layout-test-content]").forEach(element => element.remove());
      document.querySelectorAll("#controlCenter, #log").forEach(panel => panel.scrollTop = 0);
    });
  }
});