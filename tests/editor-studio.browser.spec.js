import { expect, test } from "@playwright/test";

test("Studio loads all documents and tracks edits", async ({ page }) => {
  await page.goto("/editor.html");
  await expect(page.locator("#documentNav .nav-document")).toHaveCount(4);
  await expect(page.locator("#workspaceTitle")).toHaveText("Levels / Maps");

  await page.getByLabel("Name", { exact: true }).fill("Browser edited level");
  await expect(page.locator("#dirtyStatus")).toHaveText("Unsaved changes");
  await expect(page.locator('.nav-document[data-document="levels"] .dirty-dot')).toHaveText("Modified");

  for (const [documentId, title] of [
    ["numericTiles", "Tile Catalog"],
    ["narrative", "Narrative Events"],
    ["achievements", "Achievements"]
  ]) {
    await page.locator(`.nav-document[data-document="${documentId}"]`).click();
    await expect(page.locator("#workspaceTitle")).toHaveText(title);
    await expect(page.locator("#entryList .entry-row").first()).toBeVisible();
  }
});

test("Studio imports supported and malformed JSON with a clear result", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator("#fallbackFileInput").setInputFiles({
    name: "story.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, events: [{ id: "imported_event", trigger: {}, actions: [] }] }))
  });
  await expect(page.locator("#workspaceTitle")).toHaveText("Narrative Events");
  await expect(page.locator("#entryList")).toContainText("imported_event");

  await page.locator("#fallbackFileInput").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{")
  });
  await expect(page.locator("#statusText")).toContainText("Malformed JSON");
});

test("Save blocks invalid documents", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="achievements"]').click();
  await page.locator("#addEntry").click();
  await expect(page.locator("#validationSummary")).toHaveAttribute("data-state", "error");
  await page.locator("#saveDoc").click();
  await expect(page.locator("#statusText")).toContainText("Save blocked");
});

test("fallback Save acknowledges warnings and downloads a unique file", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined }));
  await page.goto("/editor.html");
  await page.getByLabel("Name", { exact: true }).fill("Save workflow test");
  page.once("dialog", dialog => dialog.accept());
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveDoc").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^runner-levels-export-\d+\.json$/);
  await expect(page.locator("#dirtyStatus")).toHaveText("All changes saved");
});

test("Export downloads the active document without marking it saved", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined }));
  await page.goto("/editor.html");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportDoc").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^runner-levels-export-\d+\.json$/);
  await expect(page.locator("#dirtyStatus")).toHaveText("All changes saved");
});

test("File System Access pickers import and save an explicitly selected file", async ({ page }) => {
  await page.addInitScript(() => {
    const imported = {
      name: "picked-levels.json",
      getFile: async () => new File([
        JSON.stringify({ schemaVersion: 1, defaultLevel: "start", levels: {
          default: { id: "default", name: "Narrative start", map: "A25" },
          start: { id: "start", name: "Picked level", map: "A25" }
        } })
      ], "picked-levels.json", { type: "application/json" }),
      createWritable: async () => ({
        write: async text => { window.__writtenContent = text; },
        close: async () => {}
      })
    };
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => [imported] });
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: async () => {
      throw new Error("Save should reuse the explicitly opened file handle");
    } });
  });
  await page.goto("/editor.html");
  await page.locator("#openDocs").click();
  await expect(page.locator("#workspaceMeta")).toContainText("picked-levels.json");
  await page.getByLabel("Name", { exact: true }).fill("Saved through file handle");
  await page.locator("#saveDoc").click();
  const written = await page.evaluate(() => window.__writtenContent);
  expect(JSON.parse(written).levels.start.name).toBe("Saved through file handle");
  await expect(page.locator("#dirtyStatus")).toHaveText("All changes saved");
});

test("Save downloads JSON when the selected file handle denies write access", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true,
    value: async () => ({
      name: "protected-levels.json",
      queryPermission: async () => "denied",
      createWritable: async () => { throw new DOMException("Write blocked", "NotAllowedError"); }
    })
  }));
  await page.goto("/editor.html");
  await page.getByLabel("Name", { exact: true }).fill("Fallback save test");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveDoc").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^runner-levels-export-\d+\.json$/);
  await expect(page.locator("#statusText")).toContainText("write access was unavailable");
  await expect(page.locator("#dirtyStatus")).toHaveText("All changes saved");
});

test("Studio loads a legacy map hash into the selected level", async ({ page }) => {
  const map = Array.from({ length: 15 }, () => "A25").join("~");
  await page.goto(`/editor.html#map=${encodeURIComponent(map)}`);
  await expect(page.locator("#mapBox")).toHaveValue(map);
  await expect(page.locator("#dirtyStatus")).toHaveText("Unsaved changes");
});

test("Studio fits a narrow viewport without page-level horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/editor.html");
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
});

test("map canvas fits all rows without vertical scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/editor.html");
  const canvas = await page.locator(".map-scroll").evaluate(element => ({
    viewportHeight: element.clientHeight,
    contentHeight: element.scrollHeight,
    rows: document.querySelectorAll("#grid .map-cell").length / 25
  }));
  expect(canvas.rows).toBe(15);
  expect(canvas.contentHeight).toBeLessThanOrEqual(canvas.viewportHeight + 1);
  await expect(page.locator("#validationSummary")).toHaveAttribute("data-state", "valid");
});

test("Studio edits converted numeric level maps through the numeric tile palette", async ({ page }) => {
  await page.goto("/editor.html");
  await expect(page.locator('.nav-document[data-document="numericTiles"]')).toBeVisible();
  await expect(page.locator("#tilePalette .palette-tile").first()).toHaveAttribute("aria-label", /ID 1$/);
  await expect(page.locator(".map-io")).toBeHidden();

  await page.locator("#tilePalette .palette-tile").nth(1).click();
  await page.getByLabel("Map cell 1, 1", { exact: true }).click();
  await expect(page.locator("#dirtyStatus")).toHaveText("Unsaved changes");
  await expect(page.locator("#validationSummary")).not.toHaveAttribute("data-state", "error");

  const preview = page.waitForEvent("popup");
  await page.locator("#previewDoc").click();
  const game = await preview;
  await expect(game).toHaveURL(/#mapv=1&map=/);
});

test("single numeric tile catalog fills the workspace with SVG artwork cards", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await expect(page.locator("#entryList")).toHaveClass(/tile-catalog/);
  await expect(page.locator(".tile-card").first()).toBeVisible();
  await expect(page.locator(".tile-card img").first()).toHaveAttribute("src", /^data:image\/svg\+xml/);
  const catalog = await page.locator("#entryList").evaluate(element => ({
    height: element.clientHeight,
    contentHeight: element.scrollHeight,
    cardHeight: element.querySelector(".tile-card").getBoundingClientRect().height
  }));
  expect(catalog.height).toBeGreaterThan(300);
  expect(catalog.contentHeight).toBeGreaterThan(catalog.height);
  expect(catalog.cardHeight).toBeLessThan(100);
  expect(await page.locator(".tile-card").count()).toBeGreaterThan(20);
  const snakeCard = page.locator(".tile-card").filter({ hasText: "Snake" });
  await expect(snakeCard).toBeVisible();
  await expect(snakeCard.locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await snakeCard.click();
  await expect(page.locator("#inspectorTitle")).toHaveText("Tile 11 / Snake");
  await expect(page.locator("#inspectorTitle")).toHaveText(/^Tile /);
  await expect(page.locator("#tilePreviewImage")).toBeVisible();
  await page.getByLabel("Grid", { exact: true }).check();
  await expect(page.locator("#tilePreviewCanvas")).toHaveClass(/has-grid/);
  const variant = page.locator('.tile-card.variant-entry[data-entry-key^="numeric-variant:11:"]').first();
  await expect(variant).toBeVisible();
  await variant.click();
  await expect(page.locator(".tile-inheritance")).toContainText("Variant");

  await page.setViewportSize({ width: 320, height: 780 });
  const mobileCatalog = await page.locator("#entryList").evaluate(element => ({
    height: element.clientHeight,
    contentHeight: element.scrollHeight
  }));
  expect(mobileCatalog.contentHeight).toBeGreaterThan(mobileCatalog.height);
});

test("new numeric tiles can be added from the single catalog", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await expect(page.locator("#addEntry")).toHaveText("+ Add numeric tile");
  await page.locator("#addEntry").click();
  await expect(page.locator("#identifierDialog")).toBeVisible();
  await page.getByLabel("Tile name").fill("Mud");
  await page.locator('#identifierForm button[type="submit"]').click();
  await expect(page.locator("#identifierDialog")).not.toBeVisible();
  await expect(page.locator('.tile-card[data-entry-key="numeric:20"]')).toBeVisible();
  await expect(page.locator("#inspectorTitle")).toHaveText("Tile 20 / Mud");
  await expect(page.locator("#dirtyStatus")).toHaveText("Unsaved changes");

  await addSupportedProperty(page, "moveCost");
  await expect(page.getByRole("spinbutton", { name: "Move Cost" })).toHaveValue("1");
  await page.getByRole("spinbutton", { name: "Move Cost" }).fill("3");
  await expect(page.getByRole("spinbutton", { name: "Move Cost" })).toHaveValue("3");
});

test("numeric tile properties use typed controls, preserve custom JSON, and restore fallbacks on removal", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await expect(page.locator(".tile-property-category h3").first()).toHaveText("Collision and Physics");

  await addSupportedProperty(page, "fallDamageCancel");
  const fallCancel = page.getByRole("checkbox", { name: "Fall Damage Cancel" });
  await expect(fallCancel).not.toBeChecked();
  await page.getByRole("button", { name: "Remove Fall Damage Cancel" }).click();
  await expect(page.locator('[data-property="fallDamageCancel"]')).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Gravity" }).uncheck();
  await addSupportedProperty(page, "fallDamageCancel");
  await expect(page.getByRole("checkbox", { name: "Fall Damage Cancel" })).toBeChecked();

  await addSupportedProperty(page, "bounce");
  await expect(page.getByRole("spinbutton", { name: "Bounce" })).toHaveValue("0");
  await page.getByRole("spinbutton", { name: "Bounce" }).fill("2.5");
  await page.getByRole("spinbutton", { name: "Bounce" }).dispatchEvent("change");

  await addSupportedProperty(page, "pickupType");
  await page.getByLabel("Pickup Type", { exact: true }).selectOption("turbo");
  await page.getByLabel("Hint", { exact: true }).fill("A typed multiline hint");
  await addSupportedProperty(page, "tags");
  await page.getByRole("button", { name: "Add tags row" }).click();
  await page.getByLabel("Item 1").fill("water");
  await addSupportedProperty(page, "grantStats");
  await page.locator('[data-property="grantStats"]').getByRole("button", { name: "Add key and value" }).click();
  const grantName = page.getByLabel("Property name");
  const grantList = await grantName.getAttribute("list");
  expect(grantList).toBeTruthy();
  await expect(page.locator(`#${grantList} option[value="score"]`)).toHaveCount(1);
  await grantName.fill("bonus");
  await page.getByLabel("Property type").selectOption("number");
  await page.getByRole("button", { name: "Create property" }).click();
  await expect(page.getByLabel("Bonus")).toHaveValue("0");

  await addSupportedProperty(page, "effects");
  await page.getByRole("button", { name: "Add effects row" }).click();
  const effectStat = page.getByLabel("Stat", { exact: true });
  const effectStatList = await effectStat.getAttribute("list");
  expect(effectStatList).toBeTruthy();
  await expect(page.locator(`#${effectStatList} option[value="score"]`)).toHaveCount(1);
  await effectStat.fill("score");

  await page.locator(".tile-add-property summary").click();
  await page.getByRole("button", { name: "Add custom JSON property" }).click();
  await page.getByLabel("Property name").fill("futureRule");
  await page.getByLabel("Property type").selectOption("string");
  await page.getByRole("button", { name: "Create property" }).click();
  await expect(page.getByLabel("Future Rule")).toBeVisible();
  await page.getByLabel("Future Rule").fill("keep me");
  await expect(page.locator("#validationSummary")).not.toHaveAttribute("data-state", "error");
  await addSupportedProperty(page, "autoPush");
  const autoPush = page.locator('[data-property="autoPush"] input[aria-label="Auto Push"]');
  const tileSuggestions = await autoPush.getAttribute("list");
  expect(tileSuggestions).toBeTruthy();
  await expect(page.locator(`#${tileSuggestions} option[value="P"]`)).toHaveCount(1);
});

test("SVG upload, validation, preview refresh, and discard keep source separate from safe rendering", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await addSupportedProperty(page, "svg");
  await expect(page.locator("#tilePreviewError")).toContainText("No SVG artwork");
  await expect(page.locator("#validationSummary")).not.toHaveAttribute("data-state", "error");

  const validSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#347c79"/></svg>';
  await page.getByLabel("Import SVG file").setInputFiles({
    name: "tile.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(validSvg)
  });
  await expect(page.getByLabel("Svg", { exact: true })).toHaveValue(validSvg);
  await expect(page.locator("#tilePreviewImage")).toBeVisible();
  const sanitized = await page.evaluate(async () => {
    const { sanitizeSvgArtwork } = await import("/src/editor/svgArtwork.js");
    return sanitizeSvgArtwork('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><style>rect{fill:url(https://example.test/x)}</style><image href="https://example.test/x"/></svg>');
  });
  expect(sanitized.valid).toBe(true);
  expect(sanitized.source).not.toMatch(/script|style|onload|example\.test/i);

  await page.locator("#newNumericDoc").click();
  await page.locator("#createNumericMap").click();
  await expect(page.getByRole("button", { name: "Select Tile ., ID 1" })).toBeVisible();
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await page.locator('.tile-card[data-entry-key="numeric:1"]').click();

  await page.getByLabel("Svg", { exact: true }).fill("<svg><g></svg>");
  await expect(page.locator("#tilePreviewError")).toContainText("malformed");
  await expect(page.locator("#validationList")).toContainText("numericTiles.tiles[0].definition.svg");
  await page.locator("#saveDoc").click();
  await expect(page.locator("#statusText")).toContainText("Save blocked");

  await page.getByLabel("Svg", { exact: true }).fill(validSvg);
  await expect(page.locator("#validationSummary")).toHaveAttribute("data-state", "valid");
  await page.locator("#discardTileArtwork").click();
  await expect(page.locator("#tilePreviewError")).toContainText("No SVG artwork");
});

test("numeric registry authoring creates, duplicates, edits, and safely deletes tiles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await expect(page.locator("#workspaceTitle")).toHaveText("Tile Catalog");
  await expect(page.getByLabel("Air tile")).toHaveValue("1");

  await page.locator("#addEntry").click();
  await page.getByLabel("Tile name").fill("Amber crawler");
  await page.locator('#identifierForm button[type="submit"]').click();
  await expect(page.locator("#inspectorTitle")).toHaveText("Tile 20 / Amber crawler");

  await page.getByText("Add Property", { exact: true }).click();
  await page.getByLabel("Search supported properties").fill("solid");
  await page.getByRole("button", { name: /^Solid boolean/ }).click();
  await expect(page.getByRole("checkbox", { name: "Solid" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Solid" }).check();

  await page.locator("#duplicateEntry").click();
  await expect(page.locator("#inspectorTitle")).toHaveText("Tile 21 / Amber crawler copy");
  await expect(page.getByRole("checkbox", { name: "Solid" })).toBeChecked();
  await page.getByLabel("Name", { exact: true }).fill("Copper crawler");
  await expect(page.locator('.tile-card[data-entry-key="numeric:21"]')).toContainText("Copper crawler");

  await page.locator("#newNumericDoc").click();
  await page.locator("#createNumericMap").click();
  await expect(page.locator("#workspaceTitle")).toHaveText("Numeric Map - Untitled numeric map");
  await expect(page.locator("#entryList")).toBeHidden();
  await expect(page.locator(".map-io")).toBeHidden();
  await expect(page.getByLabel("Spawn X")).toHaveValue("1");
  await expect(page.getByLabel("Spawn Y")).toHaveValue("1");
  await page.getByLabel("Spawn X").fill("6");
  await page.getByLabel("Spawn X").dispatchEvent("change");
  await page.getByRole("button", { name: "Select Copper crawler, ID 21" }).click();
  await page.getByLabel("Map cell 5, 5").click();
  await expect(page.locator("#dirtyStatus")).toHaveText("Unsaved changes");

  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await page.locator('.tile-card[data-entry-key="numeric:21"]').click();
  await page.locator("#deleteEntry").click();
  await expect(page.locator("#dependencyDialog")).toBeVisible();
  await expect(page.locator("#dependencyList")).toContainText("numericMap.cells[4][4]");
  await expect(page.locator("#confirmDependencyDelete")).toBeDisabled();
  await page.locator("#cancelDependencyDelete").click();

  await page.locator('.nav-document[data-document="numericMap"]').click();
  await page.getByRole("button", { name: "Select Tile ., ID 1" }).click();
  await page.getByLabel("Map cell 5, 5").click();
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await page.locator('.tile-card[data-entry-key="numeric:21"]').click();
  await page.locator("#deleteEntry").click();
  await expect(page.locator("#confirmDependencyDelete")).toBeEnabled();
  await page.locator("#confirmDependencyDelete").click();
  await expect(page.locator('.tile-card[data-entry-key="numeric:21"]')).toHaveCount(0);

  await page.locator("#addEntry").click();
  await page.getByLabel("Tile name").fill("Next tile");
  await page.locator('#identifierForm button[type="submit"]').click();
  await expect(page.locator("#inspectorTitle")).toHaveText("Tile 22 / Next tile");
});

test("Studio exposes only one active numeric tile catalog", async ({ page }) => {
  await page.goto("/editor.html");
  await expect(page.locator("#documentNav .nav-document")).toHaveCount(4);
  await expect(page.locator('.nav-document[data-document="tiles"]')).toHaveCount(0);
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await expect(page.locator("#workspaceTitle")).toHaveText("Tile Catalog");
  await expect(page.locator("#workspaceMeta")).toContainText("tiles2.json");
  await expect(page.locator(".tile-card").filter({ hasText: "Snake" })).toBeVisible();
  await expect(page.locator("#validationSummary")).not.toHaveAttribute("data-state", "error");
});

test("selected numeric level can open as a standalone map with spawn data", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator("#newNumericDoc").click();
  await page.locator("#convertNumericMap").click();
  await expect(page.locator("#workspaceTitle")).toContainText("Numeric Map");
  await expect(page.getByLabel("Spawn X")).toHaveValue("2");
  await expect(page.getByLabel("Spawn Y")).toHaveValue("2");
  await expect(page.locator("#dirtyStatus")).toHaveText("Unsaved changes");
});

async function addSupportedProperty(page, name) {
  await page.locator(".tile-add-property summary").click();
  await page.getByLabel("Search supported properties").fill(name);
  const label = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, char => char.toUpperCase());
  await page.locator(".tile-property-option").filter({ has: page.getByText(label, { exact: true }) }).click();
}
