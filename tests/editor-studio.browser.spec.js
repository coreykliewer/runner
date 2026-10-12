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

test("Studio recovers an empty numeric catalog from the legacy backup", async ({ page }) => {
  await page.route("**/tiles2.json*", route => route.fulfill({ status: 200, contentType: "application/json", body: "" }));
  await page.goto("/editor.html");
  await expect(page.locator("#statusText")).toContainText("recovered from backup");
  await expect(page.locator('.nav-document[data-document="numericTiles"] .dirty-dot')).toHaveText("Modified");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await expect(page.locator(".tile-card").filter({ hasText: "Tile W" })).toBeVisible();
  await expect(page.locator("#validationSummary")).not.toHaveAttribute("data-state", "error");
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

test("Diagnostics panel can collapse and expand without hiding its summary", async ({ page }) => {
  await page.goto("/editor.html");
  const panel = page.locator(".validation-panel");
  const summary = panel.locator(":scope > summary");
  await expect(panel).not.toHaveAttribute("open", "");
  await expect(page.locator("#validationSummary")).toBeVisible();
  await expect(page.locator("#validationList")).toBeHidden();
  await summary.click();
  await expect(panel).toHaveAttribute("open", "");
  await expect(page.locator("#validationList")).toBeVisible();
  await expect(page.locator("#validationSummary")).toBeVisible();
  await summary.click();
  await expect(panel).not.toHaveAttribute("open", "");
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
  expect(download.suggestedFilename()).toMatch(/^protected-levels-download-\d+\.json$/);
  await expect(page.locator("#statusText")).toContainText("original was not overwritten");
  await expect(page.locator("#workspaceMeta")).toContainText("levels.json - unsaved changes");
  await expect(page.locator("#dirtyStatus")).toHaveText("Unsaved changes");
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
  expect(catalog.cardHeight).toBeLessThan(120);
  expect(await page.locator(".tile-card").count()).toBeGreaterThan(20);
  const desktopOverflow = await page.locator(".tile-card").evaluateAll(cards => cards.some(card => {
    const cardBounds = card.getBoundingClientRect();
    return [...card.querySelectorAll(":scope > span:not(.tile-card-art), small")].some(text => {
      const bounds = text.getBoundingClientRect();
      return text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1 ||
        bounds.right > cardBounds.right + 1 || bounds.bottom > cardBounds.bottom + 1;
    });
  }));
  expect(desktopOverflow).toBe(false);
  const snakeCard = page.locator(".tile-card").filter({ hasText: "Snake" });
  await expect(snakeCard).toBeVisible();
  await expect(snakeCard.locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await snakeCard.click();
  await expect(page.locator("#inspectorTitle")).toHaveText("Tile 11 / Snake");
  await expect(page.locator("#inspectorTitle")).toHaveText(/^Tile /);
  await expect(page.locator("#tilePreviewImage")).toBeVisible();
  await page.getByLabel("Grid", { exact: true }).check();
  await expect(page.locator("#tilePreviewCanvas")).toHaveClass(/has-grid/);
  const variants = page.locator(".tile-builder-section").filter({ has: page.getByText("Variants", { exact: true }) });
  await variants.locator(":scope > summary").click();
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
  const mobileOverflow = await page.locator(".tile-card").evaluateAll(cards => cards.some(card => {
    const cardBounds = card.getBoundingClientRect();
    return [...card.querySelectorAll(":scope > span:not(.tile-card-art), small")].some(text => {
      const bounds = text.getBoundingClientRect();
      return text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1 ||
        bounds.right > cardBounds.right + 1 || bounds.bottom > cardBounds.bottom + 1;
    });
  }));
  expect(mobileOverflow).toBe(false);
});

test("new numeric tiles can be added from the single catalog", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await expect(page.locator("#addEntry")).toHaveText("+ Add numeric tile");
  await page.locator("#addEntry").click();
  await expect(page.locator("#identifierDialog")).toBeVisible();
  await page.locator("#identifierDialog").getByLabel("Tile name").fill("Mud");
  await page.locator('#identifierForm button[type="submit"]').click();
  await expect(page.locator("#identifierDialog")).not.toBeVisible();
  await expect(page.locator('.tile-card[data-entry-key="numeric:20"]')).toBeVisible();
  await expect(page.locator("#inspectorTitle")).toHaveText("Tile 20 / Mud");
  await expect(page.getByLabel("Editor category", { exact: true })).toHaveValue("Environmental");
  await page.getByLabel("Filter tiles by editor category").selectOption("Environmental");
  await expect(page.locator('.tile-card[data-entry-key="numeric:20"]')).toBeVisible();
  await page.getByLabel("Filter tiles by editor category").selectOption("Interactive");
  await expect(page.locator('.tile-card[data-entry-key="numeric:20"]')).toHaveCount(0);
  await page.getByLabel("Filter tiles by editor category").selectOption("");
  await expect(page.locator("#dirtyStatus")).toHaveText("Unsaved changes");

  await addSupportedProperty(page, "moveCost");
  await expect(page.getByRole("spinbutton", { name: "Move Cost" })).toHaveValue("1");
  await page.getByRole("spinbutton", { name: "Move Cost" }).fill("3");
  await expect(page.getByRole("spinbutton", { name: "Move Cost" })).toHaveValue("3");
});

test("numeric tile properties use typed controls, preserve custom JSON, and restore fallbacks on removal", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await expect(page.locator(".tile-builder-section > summary")).toHaveText([
    "Identity", "Appearance", "Capabilities", "Variants", "Advanced"
  ]);

  await addSupportedProperty(page, "fallDamageCancel");
  const fallCancel = page.getByRole("checkbox", { name: "Fall Damage Cancel" });
  await expect(fallCancel).not.toBeChecked();
  await page.getByRole("button", { name: "Remove Fall Damage Cancel" }).click();
  await expect(page.locator('[data-property="fallDamageCancel"] .tile-property-status')).toHaveText("Runtime default (not stored)");
  await expect(page.getByRole("button", { name: "Add Fall Damage Cancel" })).toBeVisible();

  await page.getByRole("checkbox", { name: "Gravity" }).uncheck();
  await expect(page.locator('[data-property="fallDamageCancel"] .tile-property-effective-default')).toHaveText("Effective default: true");
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

test("Tile Builder categories are editor-only and capability copies stay independent", async ({ page }) => {
  let persistedRegistry = null;
  await page.route("**/tiles2.json*", async route => {
    if (persistedRegistry) return route.fulfill({ json: persistedRegistry });
    return route.continue();
  });
  await page.addInitScript(() => {
    window.__savedTileJson = null;
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        name: "tiles2.json",
        createWritable: async () => ({
          write: async content => { window.__savedTileJson = content; },
          close: async () => {}
        })
      })
    });
  });
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  const sections = await page.locator(".tile-builder-section > summary").allTextContents();
  expect(sections).toEqual(["Identity", "Appearance", "Capabilities", "Variants", "Advanced"]);
  expect(await page.locator(".tile-builder-section").evaluateAll(items => items.every(item => !item.open))).toBe(true);

  await page.locator('.tile-card[data-entry-key="numeric:16"]').click();
  const identity = page.locator(".tile-builder-section").filter({ has: page.getByText("Identity", { exact: true }) });
  await identity.locator(":scope > summary").click();
  const capabilities = page.locator(".tile-builder-section").filter({ has: page.getByText("Capabilities", { exact: true }) });
  await capabilities.locator(":scope > summary").click();
  const collision = page.locator(".tile-capability-group").filter({ has: page.getByRole("heading", { name: "Collision" }) });
  await expect(collision.locator("select")).toHaveCount(0);
  await expect(collision.locator('[data-property="solid"]')).toBeVisible();
  await expect(collision.locator('[data-property="fallDamageCancel"]')).toBeVisible();
  const waterMoveCost = page.locator('[data-property="moveCost"] input[aria-label="Move Cost"]');
  await expect(waterMoveCost).toHaveValue("1");
  await waterMoveCost.fill("4");
  await waterMoveCost.dispatchEvent("change");
  await page.getByLabel("Editor category", { exact: true }).selectOption("Item");
  const movement = page.locator(".tile-capability-group").filter({ has: page.getByRole("heading", { name: "Movement" }) });
  await movement.getByLabel("Copy Movement from tile").selectOption("1");
  await movement.getByRole("button", { name: "Copy settings" }).click();
  await expect(page.locator('[data-property="moveCost"] input[aria-label="Move Cost"]')).toHaveValue("1");
  await expect(page.getByRole("checkbox", { name: "Gravity" })).not.toBeChecked();
  await expect(page.locator("#validationSummary")).not.toHaveAttribute("data-state", "error");

  const copiedMoveCost = page.locator('[data-property="moveCost"] input[aria-label="Move Cost"]');
  await copiedMoveCost.fill("5");
  await copiedMoveCost.dispatchEvent("change");
  const advanced = page.locator(".tile-builder-section").filter({ has: page.getByText("Advanced", { exact: true }) });
  await advanced.locator(":scope > summary").click();
  await advanced.locator(".tile-custom-properties > summary").click();
  await advanced.getByRole("button", { name: "Add key and value" }).click();
  await page.getByLabel("Property name").fill("futureRule");
  await page.getByLabel("Property type").selectOption("string");
  await page.getByRole("button", { name: "Create property" }).click();
  await page.getByLabel("Future Rule").fill("keep this field");
  await page.locator("#saveDoc").click();
  await expect(page.locator("#dirtyStatus")).toHaveText("All changes saved");
  const savedRegistry = await page.evaluate(() => JSON.parse(window.__savedTileJson));
  persistedRegistry = savedRegistry;
  const air = savedRegistry.tiles.find(tile => tile.id === 1);
  const water = savedRegistry.tiles.find(tile => tile.id === 16);
  expect(air.definition.moveCost).toBe(1);
  expect(water.definition.moveCost).toBe(5);
  expect(water.definition.gravity).toBe(false);
  expect(water.definition.tags).toEqual(["water"]);
  expect(water.definition.futureRule).toBe("keep this field");
  expect(typeof water.definition.svg).toBe("string");
  expect(water.category).toBe("Item");
  expect(water.definition.category).toBeUndefined();
  await page.reload();
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await page.locator('.tile-card[data-entry-key="numeric:16"]').click();
  await expect(page.getByLabel("Editor category", { exact: true })).toHaveValue("Item");
  await expect(page.locator('[data-property="moveCost"] input[aria-label="Move Cost"]')).toHaveValue("5");
  await expect(page.getByLabel("Future Rule", { exact: true })).toHaveValue("keep this field");
  await expect(page.locator("#dirtyStatus")).toHaveText("All changes saved");
});

test("SVG upload, validation, preview refresh, and discard keep source separate from safe rendering", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await addSupportedProperty(page, "svg");
  const appearance = page.locator(".tile-builder-section").filter({ has: page.getByText("Appearance", { exact: true }) });
  await appearance.locator(":scope > summary").click();
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
  await expect(page.getByRole("button", { name: "Select Air, ID 1" })).toBeVisible();
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await page.locator('.tile-card[data-entry-key="numeric:1"]').click();
  const airAppearance = page.locator(".tile-builder-section").filter({ has: page.getByText("Appearance", { exact: true }) });
  await airAppearance.locator(":scope > summary").click();

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
  await page.locator("#identifierDialog").getByLabel("Tile name").fill("Amber crawler");
  await page.locator('#identifierForm button[type="submit"]').click();
  await expect(page.locator("#inspectorTitle")).toHaveText("Tile 20 / Amber crawler");

  const capabilities = page.locator(".tile-builder-section").filter({ has: page.getByText("Capabilities", { exact: true }) });
  await capabilities.locator(":scope > summary").click();
  await page.getByText("Add Property", { exact: true }).click();
  await page.getByLabel("Search supported properties").fill("solid");
  await page.getByRole("button", { name: /^Solid boolean/ }).click();
  await expect(page.getByRole("checkbox", { name: "Solid" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Solid" }).check();

  await page.locator("#duplicateEntry").click();
  await expect(page.locator("#inspectorTitle")).toHaveText("Tile 21 / Amber crawler copy");
  await capabilities.locator(":scope > summary").click();
  await expect(page.getByRole("checkbox", { name: "Solid" })).toBeChecked();
  const identity = page.locator(".tile-builder-section").filter({ has: page.getByText("Identity", { exact: true }) });
  await identity.locator(":scope > summary").click();
  await page.locator("#inspectorFields").getByLabel("Tile name", { exact: true }).fill("Copper crawler");
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
  await page.getByRole("button", { name: "Select Air, ID 1" }).click();
  await page.getByLabel("Map cell 5, 5").click();
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  await page.locator('.tile-card[data-entry-key="numeric:21"]').click();
  await page.locator("#deleteEntry").click();
  await expect(page.locator("#confirmDependencyDelete")).toBeEnabled();
  await page.locator("#confirmDependencyDelete").click();
  await expect(page.locator('.tile-card[data-entry-key="numeric:21"]')).toHaveCount(0);

  await page.locator("#addEntry").click();
  await page.locator("#identifierDialog").getByLabel("Tile name").fill("Next tile");
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

test("Registry Roles is a separate collapsible area above Properties", async ({ page }) => {
  await page.goto("/editor.html");
  await page.locator('.nav-document[data-document="numericTiles"]').click();
  const roles = page.locator("#registryRolesPanel");
  const summary = roles.locator(":scope > summary");
  await expect(roles).toBeVisible();
  await expect(roles).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("Air tile")).toBeHidden();
  const positions = await page.evaluate(() => ({
    rolesBottom: document.querySelector("#registryRolesPanel").getBoundingClientRect().bottom,
    propertiesTop: document.querySelector(".inspector-heading").getBoundingClientRect().top
  }));
  expect(positions.rolesBottom).toBeLessThanOrEqual(positions.propertiesTop);
  await summary.click();
  await expect(roles).toHaveAttribute("open", "");
  await expect(page.getByLabel("Air tile")).toHaveValue("1");
  await summary.click();
  await expect(roles).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("Air tile")).toBeHidden();
  await expect(page.locator(".inspector-heading")).toBeVisible();
  await summary.click();
  await expect(page.getByLabel("Air tile")).toHaveValue("1");
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
  const capabilities = page.locator(".tile-builder-section").filter({ has: page.getByText("Capabilities", { exact: true }) });
  if (!await capabilities.evaluate(section => section.open)) await capabilities.locator(":scope > summary").click();
  await page.locator(".tile-add-property summary").click();
  await page.getByLabel("Search supported properties").fill(name);
  const label = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, char => char.toUpperCase());
  await page.locator(".tile-property-option").filter({ has: page.getByText(label, { exact: true }) }).click();
}
