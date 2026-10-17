import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { normalizeTileDefinitions } from "../src/tileCompatibility.js";
import { createNumericMap } from "../src/numericMapCodec.js";

const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="${color}"/></svg>`;

async function createRegistry(extraTiles = []) {
  const legacy = JSON.parse(await readFile("tiles2.legacy.json", "utf8"));
  const normalized = normalizeTileDefinitions(legacy);
  const registry = structuredClone(normalized.registry);
  for (const tile of extraTiles) registry.tiles.push(structuredClone(tile));
  const maximum = registry.tiles.reduce((result, tile) => Math.max(result, tile.id), 0);
  registry.nextTileId = Math.max(registry.nextTileId, maximum + 1);
  return registry;
}

function makeMap(registry, { spawn = { x: 1, y: 1 }, placements = [] } = {}) {
  const width = 25;
  const height = 15;
  const cells = Array.from({ length: height }, () => Array(width).fill(registry.airTileId));
  const variants = Array.from({ length: height }, () => Array(width).fill(null));
  const floorId = registry.idsByLegacyCode?.get?.("P") ?? registry.legacyIdMapping.P;
  cells[2].fill(floorId);

  for (const placement of placements) {
    cells[placement.y][placement.x] = placement.id;
    variants[placement.y][placement.x] = placement.variant ?? null;
  }

  return createNumericMap({
    width,
    height,
    cells,
    variants,
    spawn: { ...spawn, artTileId: registry.playerArtTileId }
  });
}

async function launchNumericLevel(page, registry, levels, { narrative = null, achievements = null } = {}) {
  await page.route("**/tiles2.json*", route => route.fulfill({ json: registry }));
  await page.route("**/levels.json*", route => route.fulfill({ json: levels }));
  if (narrative) await page.route("**/fixtures/level1-narrative.json*", route => route.fulfill({ json: narrative }));
  if (achievements) await page.route("**/achievements.json*", route => route.fulfill({ json: achievements }));
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto("/");
  await expect(page.locator("#create-resume-link")).toBeEnabled();
}

test("different numeric monster IDs use their own variants, art, and defeat replacements", async ({ page }) => {
  const registry = await createRegistry([
    {
      id: 104,
      name: "Alpha creature",
      definition: {
        solid: true,
        svg: svg("#222244"),
        monster: {
          alpha: {
            name: "Alpha",
            hp: 1,
            defeatedTileId: 306,
            playerHit: { dice: 1, value: 1, damage: 1 },
            svg: svg("#e33d52")
          }
        }
      }
    },
    {
      id: 205,
      name: "Beta creature",
      definition: {
        solid: true,
        svg: svg("#224422"),
        monster: {
          beta: {
            name: "Beta",
            hp: 1,
            defeatedTileId: 306,
            playerHit: { dice: 1, value: 1, damage: 1 },
            svg: svg("#3dc887")
          }
        }
      }
    },
    { id: 306, name: "Heart remains", definition: { solid: false, gravity: true, pickupType: "heart" } }
  ]);
  registry.defeatedMonsterTileId = registry.tiles.find(tile => tile.legacyCode === "C").id;
  const map = makeMap(registry, { placements: [
    { x: 2, y: 1, id: 104, variant: "alpha" },
    { x: 3, y: 1, id: 205, variant: "beta" }
  ] });

  await launchNumericLevel(page, registry, {
    schemaVersion: 1,
    defaultLevel: "default",
    levels: { default: { id: "default", name: "Numeric monsters", map } }
  });

  await page.waitForFunction(() => {
    const pixels = document.getElementById("game").getContext("2d").getImageData(80, 48, 1, 1).data;
    return pixels[0] > 180 && pixels[1] < 100;
  });
  const artwork = await page.evaluate(() => {
    const context = document.getElementById("game").getContext("2d");
    return [
      [...context.getImageData(80, 48, 1, 1).data],
      [...context.getImageData(112, 48, 1, 1).data]
    ];
  });
  expect(artwork[0][0]).toBeGreaterThan(180);
  expect(artwork[1][1]).toBeGreaterThan(120);

  await page.getByRole("button", { name: "Roll Dice" }).click();
  await page.locator("#btn-right").click();
  await expect(page.locator("#log")).toContainText("Alpha defeated.");
  await page.locator("#btn-right").click();
  await expect(page.locator("#info")).toContainText("Hearts: 6");
  await page.locator("#btn-right").click();
  await expect(page.locator("#log")).toContainText("Beta defeated.");
});

test("different numeric lock IDs use their own dice definitions", async ({ page }) => {
  const registry = await createRegistry([
    { id: 410, name: "Single die lock", definition: { solid: true, lock: { gate: { dice: 1, value: 1 } } } },
    { id: 511, name: "Double six lock", definition: { solid: true, lock: { gate: { dice: 2, sum: 12, messageFail: "Needs a total of twelve." } } } }
  ]);
  const map = makeMap(registry, { placements: [
    { x: 2, y: 1, id: 410, variant: "gate" },
    { x: 3, y: 1, id: 511, variant: "gate" }
  ] });

  await launchNumericLevel(page, registry, {
    schemaVersion: 1,
    defaultLevel: "default",
    levels: { default: { id: "default", name: "Numeric locks", map } }
  });
  await page.getByRole("button", { name: "Roll Dice" }).click();
  await page.locator("#btn-right").click();
  await expect(page.locator("#log")).toContainText("The lock clicks open.");
  await page.locator("#btn-right").click();
  await page.locator("#btn-right").click();
  await expect(page.locator("#log")).toContainText("Needs a total of twelve.");
});

test("arbitrary numeric tiles run universal encounter rules from captured roll snapshots", async ({ page }) => {
  const registry = await createRegistry([
    {
      id: 901,
      name: "Rock",
      category: "Environmental",
      definition: {
        solid: true,
        encounterRules: {
          enabled: true,
          resolution: "all_matches",
          rules: [{
            id: "rock-strike",
            order: 1,
            trigger: { events: ["after_roll"], minDistance: 1, maxDistance: 1, distance: "manhattan", position: "any", repeat: "every_event" },
            conditions: [{ type: "expression", expression: "d1 + d2 <= 2" }],
            actions: [{ type: "damage", amount: 1, message: "Rock strikes for one." }]
          }]
        }
      }
    },
    {
      id: 902,
      name: "Quiet interactive tile",
      category: "Interactive",
      definition: { solid: true }
    },
    {
      id: 903,
      name: "Rat",
      category: "Interactive",
      definition: {
        solid: true,
        encounterRules: {
          enabled: true,
          resolution: "first_match_per_tile",
          rules: [{
            id: "rat-strike",
            order: 1,
            trigger: { events: ["after_roll"], minDistance: 1, maxDistance: 2, distance: "manhattan", position: "any", repeat: "every_event" },
            conditions: [{ type: "expression", expression: "d1 + d2 == 3" }],
            actions: [{ type: "damage", amount: 2, message: "The rat bites for two." }]
          }]
        }
      }
    }
  ]);
  const map = makeMap(registry, {
    spawn: { x: 3, y: 1 },
    placements: [
      { x: 4, y: 1, id: 901 },
      { x: 2, y: 1, id: 902 },
      { x: 3, y: 0, id: 903 }
    ]
  });
  await launchNumericLevel(page, registry, {
    schemaVersion: 1,
    defaultLevel: "default",
    levels: { default: { id: "default", name: "Encounter test", map } }
  });

  const setNextRoll = async (first, second) => page.evaluate(([die1, die2]) => {
    const rolls = [(die1 - 1) / 6, (die2 - 1) / 6];
    let index = 0;
    Math.random = () => rolls[index++] ?? 0;
  }, [first, second]);

  await setNextRoll(1, 1);
  await page.getByRole("button", { name: "Roll Dice" }).click();
  await expect(page.locator("#info")).toContainText("Hearts: 4");
  await expect(page.locator("#log")).toContainText("Rock strikes for one.");
  await expect(page.locator("#log")).not.toContainText("rat bites");

  await setNextRoll(1, 2);
  await page.getByRole("button", { name: "Roll Dice" }).click();
  // The reroll's first snapshot (1,1) also matches the rock's rule.
  await expect(page.locator("#info")).toContainText("Hearts: 1");
  await expect(page.locator("#log")).toContainText("The rat bites for two.");
  const combatLog = await page.locator("#log").innerText();
  expect(combatLog.match(/Rock strikes for one\./g)).toHaveLength(2);
});

test("numeric maps use explicit spawn coordinates and declarative exits", async ({ page }) => {
  const registry = await createRegistry([
    { id: 612, name: "Portal", definition: { solid: false, gravity: true, exit: true, svg: svg("#40b779") } }
  ]);
  const start = makeMap(registry, {
    spawn: { x: 4, y: 1 },
    placements: [{ x: 5, y: 1, id: 612, variant: "north" }]
  });
  const destination = makeMap(registry, { spawn: { x: 6, y: 1 } });

  await launchNumericLevel(page, registry, {
    schemaVersion: 1,
    defaultLevel: "entrance",
    levels: {
      entrance: { id: "entrance", name: "Entrance", map: start, exits: { north: "destination" } },
      destination: { id: "destination", name: "Destination", map: destination }
    }
  });
  await page.getByRole("button", { name: "Roll Dice" }).click();
  const destinationLoad = page.waitForEvent("load");
  await page.locator("#btn-right").click();
  await page.waitForURL(/level=destination/);
  await destinationLoad;
  await expect(page.getByRole("button", { name: "Create Resume Link" })).toBeEnabled();
  await expect(page.locator("#log")).not.toContainText("BOOT ERROR");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("runner:v2:state")));
  expect(saved.version).toBe(2);
  expect(typeof saved.world.mapHash).toBe("string");
});

test("numeric tile IDs reach narrative and achievement contexts without breaking legacy data", async ({ page }) => {
  const registry = await createRegistry([
    { id: 733, name: "Numeric heart", definition: { solid: false, gravity: true, pickupType: "heart" } }
  ]);
  const map = makeMap(registry, { placements: [{ x: 2, y: 1, id: 733 }] });
  await launchNumericLevel(page, registry, {
    schemaVersion: 1,
    defaultLevel: "default",
    levels: { default: { id: "default", name: "Numeric pickup", map } }
  }, {
    narrative: {
      schemaVersion: 1,
      events: [{
        id: "numeric_pickup_event",
        trigger: { type: "pickup", tileId: 733 },
        actions: [{ type: "message", text: "Numeric tile narrative fired." }]
      }]
    },
    achievements: {
      schemaVersion: 1,
      achievements: [{
        id: "numeric_pickup_achievement",
        title: "Numeric tile achievement",
        when: {
          left: "pickup.tileId",
          operator: "equals",
          right: { literal: 733 }
        }
      }]
    }
  });

  await page.getByRole("button", { name: "Roll Dice" }).click();
  await page.locator("#btn-right").click();
  await expect(page.locator("#info")).toContainText("Hearts: 6");
  await expect(page.locator("#log")).toContainText("Numeric tile narrative fired.");
  await expect(page.locator("#log")).toContainText("ACHIEVEMENT: Numeric tile achievement");
});
