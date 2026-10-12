import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { ContentDocumentStore, CONTENT_DOCUMENTS, OPTIONAL_CONTENT_DOCUMENTS, identifyDocument, parseJsonDocument } from "../src/editor/documentStore.js";
import { createEmptyNumericTileRegistry } from "../src/numericTileRegistry.js";
import { createNumericMap } from "../src/numericMapCodec.js";

describe("editor content document store", () => {
  it("loads required documents and the available numeric registry", async () => {
    const store = new ContentDocumentStore({
      fetchImpl: async url => ({
        ok: true,
        json: async () => JSON.parse(await readFile(url, "utf8"))
      })
    });

    await store.loadAll();
    const expectedDocuments = [...CONTENT_DOCUMENTS, ...OPTIONAL_CONTENT_DOCUMENTS.filter(document => document.url)];
    assert.deepEqual([...store.documents.keys()], expectedDocuments.map(document => document.id));
    assert.equal(identifyDocument(store.get("numericTiles").value), "numericTiles");
    assert.equal(store.get("narrative").value.events.length > 0, true);
    for (const definition of CONTENT_DOCUMENTS) {
      const original = JSON.parse(await readFile(definition.url, "utf8"));
      assert.deepEqual(JSON.parse(store.serialize(definition.id)), original);
    }
  });

  it("round-trips unknown fields and tracks changes independently", () => {
    const store = new ContentDocumentStore();
    const original = {
      schemaVersion: 1,
      levels: { start: { id: "start", map: "P1", futureField: { preserved: true } } }
    };
    store.replace("levels", original);
    store.update("levels", document => {
      document.levels.start.name = "Edited";
    });

    assert.equal(store.get("levels").dirty, true);
    assert.deepEqual(JSON.parse(store.serialize("levels")).levels.start.futureField, { preserved: true });
    store.replace("achievements", { achievements: [] });
    assert.equal(store.get("achievements").dirty, false);
    store.markSaved("levels");
    assert.equal(store.get("levels").dirty, false);
  });

  it("imports supported JSON and reports malformed input", () => {
    const store = new ContentDocumentStore();
    const record = store.importText('{"events":[],"extra":true}', { sourceName: "custom.json" });

    assert.equal(record.id, "narrative");
    assert.equal(record.sourceName, "custom.json");
    assert.equal(record.value.extra, true);
    assert.throws(() => parseJsonDocument("{"), /Malformed JSON/);
    assert.throws(() => store.importText('{"nope":true}'), /does not match/);
  });

  it("stores, imports, and serializes optional numeric documents independently", () => {
    const store = new ContentDocumentStore();
    const registry = createEmptyNumericTileRegistry();
    const map = createNumericMap({ width: 1, height: 1, cells: [[1]], spawn: { x: 0, y: 0 } });
    store.create("numericTiles", registry, { sourceName: "numeric-registry.json" });
    store.create("numericMap", map, { sourceName: "numeric-map.json" });
    assert.equal(store.get("numericTiles").dirty, true);
    assert.equal(store.get("numericMap").dirty, true);
    assert.deepEqual(JSON.parse(store.serialize("numericTiles")), registry);
    assert.deepEqual(JSON.parse(store.serialize("numericMap")), map);
    assert.equal(store.importText(JSON.stringify(registry)).id, "numericTiles");
    assert.equal(store.importText(JSON.stringify(map)).id, "numericMap");
  });
});