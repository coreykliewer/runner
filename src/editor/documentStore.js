import { assertNumericTileRegistry, isNumericTileRegistry } from "../numericTileRegistry.js";
import { decodeNumericMap, isNumericMapDocument } from "../numericMapCodec.js";

export const CONTENT_DOCUMENTS = [
  { id: "levels", label: "Levels / Maps", fileName: "levels.json", url: "levels.json", collection: "levels" },
  { id: "numericTiles", label: "Tile Catalog", fileName: "tiles2.json", url: "tiles2.json", collection: "tiles" },
  { id: "narrative", label: "Narrative Events", fileName: "level1-narrative.json", url: "fixtures/level1-narrative.json", collection: "events" },
  { id: "achievements", label: "Achievements", fileName: "achievements.json", url: "achievements.json", collection: "achievements" }
];

export const OPTIONAL_CONTENT_DOCUMENTS = [
  { id: "tiles", label: "Legacy Tile Catalog (Imported)", fileName: "tiles2.legacy.json", url: null, collection: null },
  { id: "numericMap", label: "Numeric Map", fileName: "runner-numeric-map-v1.json", url: null, collection: null }
];

export const ALL_CONTENT_DOCUMENTS = [...CONTENT_DOCUMENTS, ...OPTIONAL_CONTENT_DOCUMENTS];

const definitionsById = new Map(ALL_CONTENT_DOCUMENTS.map(definition => [definition.id, definition]));

export class ContentDocumentStore {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl === globalThis.fetch && typeof fetchImpl === "function"
      ? fetchImpl.bind(globalThis)
      : fetchImpl;
    this.documents = new Map();
  }

  async loadAll() {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("A fetch implementation is required to load content documents.");
    }

    const loaded = await Promise.all(CONTENT_DOCUMENTS.map(async definition => {
      const response = await this.fetchImpl(definition.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Unable to load ${definition.fileName}: HTTP ${response.status}`);
      const value = await response.json();
      assertDocumentShape(definition.id, value);
      return [definition.id, makeRecord(definition, value, definition.fileName)];
    }));

    const optional = await Promise.all(OPTIONAL_CONTENT_DOCUMENTS
      .filter(definition => definition.url)
      .map(async definition => {
        try {
          const response = await this.fetchImpl(definition.url, { cache: "no-store" });
          if (!response.ok) return null;
          const value = await response.json();
          assertDocumentShape(definition.id, value);
          return [definition.id, makeRecord(definition, value, definition.fileName)];
        } catch {
          return null;
        }
      }));
    this.documents = new Map([...loaded, ...optional.filter(Boolean)]);
    return this.documents;
  }

  get(id) {
    const record = this.documents.get(id);
    if (!record) throw new Error(`Content document '${id}' is not loaded.`);
    return record;
  }

  has(id) {
    return this.documents.has(id);
  }

  update(id, updateValue) {
    const current = this.get(id);
    const nextValue = cloneJson(current.value);
    const result = updateValue(nextValue);
    const value = result === undefined ? nextValue : result;
    assertDocumentShape(id, value);
    const next = { ...current, value, dirty: !sameJson(value, current.savedValue) };
    this.documents.set(id, next);
    return next;
  }

  replace(id, value, { sourceName = null, fileHandle = null } = {}) {
    const definition = definitionsById.get(id);
    if (!definition) throw new Error(`Unknown content document '${id}'.`);
    assertDocumentShape(id, value);
    const record = makeRecord(definition, value, sourceName || definition.fileName);
    record.fileHandle = fileHandle;
    this.documents.set(id, record);
    return record;
  }

  create(id, value, { sourceName = null, fileHandle = null } = {}) {
    const definition = definitionsById.get(id);
    if (!definition) throw new Error(`Unknown content document '${id}'.`);
    assertDocumentShape(id, value);
    const record = makeRecord(definition, value, sourceName || definition.fileName);
    record.fileHandle = fileHandle;
    record.savedValue = null;
    record.dirty = true;
    this.documents.set(id, record);
    return record;
  }

  importText(text, { sourceName = "import.json", fileHandle = null } = {}) {
    const value = parseJsonDocument(text);
    const id = identifyDocument(value);
    return this.replace(id, value, { sourceName, fileHandle });
  }

  serialize(id) {
    return `${JSON.stringify(this.get(id).value, null, 2)}\n`;
  }

  markSaved(id, { sourceName = null, fileHandle = undefined } = {}) {
    const current = this.get(id);
    const next = {
      ...current,
      savedValue: cloneJson(current.value),
      dirty: false,
      sourceName: sourceName || current.sourceName,
      fileHandle: fileHandle === undefined ? current.fileHandle : fileHandle
    };
    this.documents.set(id, next);
    return next;
  }
}

export function parseJsonDocument(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Malformed JSON: ${error.message}`);
  }
}

export function identifyDocument(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (isNumericTileRegistry(value)) return "numericTiles";
    if (isNumericMapDocument(value)) return "numericMap";
    if (value.levels && typeof value.levels === "object") return "levels";
    if (Array.isArray(value.events)) return "narrative";
    if (Array.isArray(value.achievements)) return "achievements";
    if (Object.values(value).every(definition => definition && typeof definition === "object" && !Array.isArray(definition))) {
      return "tiles";
    }
  }
  throw new Error("JSON document does not match a supported Runner content document.");
}

export function createExportName(id) {
  const definition = definitionsById.get(id);
  if (!definition) throw new Error(`Unknown content document '${id}'.`);
  return `runner-${id}-export.json`;
}

function assertDocumentShape(id, value) {
  const validObject = value && typeof value === "object" && !Array.isArray(value);
  if (!validObject) throw new Error(`${definitionsById.get(id)?.fileName || id} must contain a JSON object.`);

  if (id === "levels" && (!value.levels || typeof value.levels !== "object" || Array.isArray(value.levels))) {
    throw new Error("levels.json must contain a levels object.");
  }
  if (id === "narrative" && !Array.isArray(value.events)) {
    throw new Error("level1-narrative.json must contain an events array.");
  }
  if (id === "achievements" && !Array.isArray(value.achievements)) {
    throw new Error("achievements.json must contain an achievements array.");
  }
  if (id === "numericTiles") assertNumericTileRegistry(value);
  if (id === "numericMap") decodeNumericMap(value);
}

function makeRecord(definition, value, sourceName) {
  const savedValue = cloneJson(value);
  return {
    ...definition,
    value: cloneJson(value),
    savedValue,
    dirty: false,
    sourceName,
    fileHandle: null
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}