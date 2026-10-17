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

for (const intermediateOnly of [false, true]) {
test("movement snapshots, ownership and roll limit (intermediate only: " + intermediateOnly + ")", async ({ page }) => {
  const rule = (id, value, priority, amount, order) => ({ id, priority, order,
    trigger: { events: ["after_move"], minDistance: 1, maxDistance: 1, distance: "manhattan", position: "player_left", repeat: "every_event" },
    conditions: [{ type: "expression", expression: "d1 + d2 <= " + value }],
    actions: [{ type: "damage", amount, message: id }] });
  const registry = await createRegistry([
    { id: 910, name: "Costly path", definition: { solid: false, gravity: true, moveCostTop: 3 } },
    { id: 911, name: "Fixture creature", definition: { solid: true,
      monster: { fixture: { hp: 9, monsterHit: { dice: 2, sum: 3, damage: 4, messageHit: "Legacy duplicate" } } },
      encounterRules: { enabled: true, resolution: "all_matches", rules: intermediateOnly ? [{ ...rule("snapshot strike", 4, 10, 1, 1), conditions: [{ type: "expression", expression: "d1 + d2 == 4" }] }] : [rule("snapshot strike", 3, 10, 1, 2), rule("early competing strike", 4, 0, 2, 1)] }
    } }
  ]);
  const map = makeMap(registry, { placements: [{ x: 2, y: 1, id: 910 }, { x: 3, y: 1, id: 911, variant: "fixture" }] });
  await launchNumericLevel(page, registry, { schemaVersion: 1, defaultLevel: "default", levels: { default: { id: "default", name: "Snapshot fixture", map } } });
  await page.evaluate(() => { let i = 0; const rolls = [1 / 6, 3 / 6]; Math.random = () => rolls[i++] ?? 0; });
  await page.getByRole("button", { name: "Roll Dice" }).click();
  await expect(page.locator("#info")).toContainText("Hearts: 5");
  await page.locator("#btn-right").click();
  await expect(page.locator("#info")).toContainText("Hearts: 4");
  await expect(page.locator("#log")).toContainText("snapshot strike");
  await expect(page.locator("#log")).not.toContainText("early competing strike");
  await expect(page.locator("#log")).not.toContainText("Legacy duplicate");
  const batches = await page.evaluate(() => window.getRunnerDiceEventBatches());
  expect(batches.at(-1).events.map(e => e.after)).toEqual([{ die1: 0, die2: 4 }, { die1: 0, die2: 3 }]);
  await page.locator("#btn-left").click();
  await page.locator("#btn-right").click();
  await expect(page.locator("#info")).toContainText("Hearts: 4");
});

}
