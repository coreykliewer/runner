import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

describe("browser smoke fixtures", () => {
  it("keeps the game shell wired to expected assets and DOM ids", async () => {
    const html = await readFile("index.html", "utf8");
    assert.match(html, /<canvas id="game"/);
    assert.match(html, /id="roll"/);
    assert.match(html, /id="messageModal"/);
    assert.match(html, /src="game\.js"/);
    assert.match(html, /href="style\.css"/);
  });

  it("keeps the editor shell wired to expected assets and DOM ids", async () => {
    const html = await readFile("editor.html", "utf8");
    assert.match(html, /id="variantBox"/);
    assert.match(html, /id="tilePalette"/);
    assert.match(html, /id="grid"/);
    assert.match(html, /id="mapBox"/);
    assert.match(html, /src="editor\.js"/);
  });
});
