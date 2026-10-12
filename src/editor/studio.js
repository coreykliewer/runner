import { decodeMap, encodeMap, splitRowsFlexible, DEFAULT_COLS, DEFAULT_ROWS } from "../shared/mapCodec.js";
import { VARIANT_BUCKETS } from "../shared/variants.js";
import { validateContentDocuments, validateMap, validateTiles } from "../validation.js";
import {
  addNumericTile,
  createEmptyNumericTileRegistry,
  duplicateNumericTile,
  migrateLegacyTileDefinitions,
  removeNumericTile
} from "../numericTileRegistry.js";
import { createNumericMap, decodeNumericMap } from "../numericMapCodec.js";
import { decodeMapToNumeric, normalizeTileDefinitions } from "../tileCompatibility.js";
import { ContentDocumentStore, ALL_CONTENT_DOCUMENTS, CONTENT_DOCUMENTS, createExportName, identifyDocument, parseJsonDocument } from "./documentStore.js";
import { renderJsonEditor } from "./fieldEditor.js";
import { renderTilePropertyEditor } from "./tilePropertyEditor.js";
import { sanitizeSvgArtwork } from "./svgArtwork.js";
import { TILE_EDITOR_CATEGORIES, TILE_CAPABILITY_GROUPS, TILE_PROPERTY_DEFINITIONS } from "../tileProperties.js";

const store = new ContentDocumentStore();
const TILE_CREATION_CAPABILITY_GROUPS = [
  ...TILE_CAPABILITY_GROUPS,
  {
    id: "appearance",
    label: "Appearance",
    properties: Object.keys(TILE_PROPERTY_DEFINITIONS).filter(name => TILE_PROPERTY_DEFINITIONS[name].category === "artwork")
  }
];
const elements = {
  nav: document.getElementById("documentNav"),
  workspaceTitle: document.getElementById("workspaceTitle"),
  workspaceMeta: document.getElementById("workspaceMeta"),
  entryList: document.getElementById("entryList"),
  tileWorkspace: document.getElementById("tileWorkspace"),
  tileSearch: document.getElementById("tileSearch"),
  tileSearchInput: document.getElementById("tileSearchInput"),
  tilePreview: document.getElementById("tilePreview"),
  tilePreviewTitle: document.getElementById("tilePreviewTitle"),
  tilePreviewId: document.getElementById("tilePreviewId"),
  tilePreviewCanvas: document.getElementById("tilePreviewCanvas"),
  tilePreviewImage: document.getElementById("tilePreviewImage"),
  tilePreviewError: document.getElementById("tilePreviewError"),
  registryRolesPanel: document.getElementById("registryRolesPanel"),
  registryRoleFields: document.getElementById("registryRoleFields"),
  inspectorTitle: document.getElementById("inspectorTitle"),
  inspectorFields: document.getElementById("inspectorFields"),
  validationList: document.getElementById("validationList"),
  validationSummary: document.getElementById("validationSummary"),
  status: document.getElementById("statusText"),
  dirtyStatus: document.getElementById("dirtyStatus"),
  tilePalette: document.getElementById("tilePalette"),
  grid: document.getElementById("grid"),
  variantBox: document.getElementById("variantBox"),
  mapBox: document.getElementById("mapBox"),
  mapEditor: document.getElementById("mapEditor"),
  fileInput: document.getElementById("fallbackFileInput")
};

let activeDocument = "levels";
let selection = { kind: "entry", key: "default" };
let validationIssues = [];
let tileImages = {};
let tileArtworkErrors = {};
let selectedTile = ".";
let selectedNumericTileId = null;
let brushVariant = "";
let mapTiles = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill("."));
let mapVariants = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(""));
let numericMapCells = null;
let cells = [];
let identifierDialogResolver = null;
let identifierValidator = null;
let dependencyDialogResolver = null;
let tileCreationDraft = null;
let mapCellSizeFrame = null;

initialize();

async function initialize() {
  bindToolbar();
  buildMapGrid();
  try {
    await store.loadAll();
    loadTileImages();
    selectDefaultEntry();
    loadMapFromUrl();
    renderNavigation();
    renderWorkspace();
    renderTilePalette();
    renderInspector();
    runValidation();
    document.getElementById("newNumericDoc").disabled = false;
    updateStatus(store.get("numericTiles").sourceName === "Recovered from tiles2.legacy.json"
      ? "Tile catalog recovered from backup; Save to repair tiles2.json"
      : "Four content documents loaded");
  } catch (error) {
    updateStatus(error.message, true);
    elements.validationSummary.textContent = "Content load failed";
    elements.validationList.textContent = error.message;
  }
}

function bindToolbar() {
  document.getElementById("openDocs").addEventListener("click", openDocuments);
  document.getElementById("validateDocs").addEventListener("click", runValidation);
  document.getElementById("previewDoc").addEventListener("click", previewSelectedLevel);
  document.getElementById("saveDoc").addEventListener("click", saveActiveDocument);
  document.getElementById("exportDoc").addEventListener("click", exportActiveDocument);
  document.getElementById("newNumericDoc").addEventListener("click", openNumericDocumentDialog);
  document.getElementById("addEntry").addEventListener("click", addEntry);
  document.getElementById("tileCreationCancel").addEventListener("click", closeTileCreationDialog);
  document.getElementById("tileCreationBack").addEventListener("click", () => setTileCreationStep(tileCreationDraft.step - 1));
  document.getElementById("tileCreationNext").addEventListener("click", advanceTileCreationStep);
  document.getElementById("tileCreationCreate").addEventListener("click", createTileFromWizard);
  document.getElementById("tileCreationName").addEventListener("input", clearTileCreationErrors);
  document.getElementById("tileCreationCategory").addEventListener("change", updateTileCreationCategoryHelp);
  document.getElementById("tileCreationSourceSearch").addEventListener("input", renderTileCreationSources);
  for (const radio of document.querySelectorAll('input[name="tileStartMode"]')) {
    radio.addEventListener("change", updateTileCreationMode);
  }
  document.getElementById("tileCreationForm").addEventListener("submit", event => {
    event.preventDefault();
    if (tileCreationDraft?.step === 3) createTileFromWizard();
    else advanceTileCreationStep();
  });
  document.getElementById("tileCreationDialog").addEventListener("cancel", event => {
    event.preventDefault();
    closeTileCreationDialog();
  });
  document.getElementById("duplicateEntry").addEventListener("click", duplicateSelectedTile);
  document.getElementById("deleteEntry").addEventListener("click", deleteEntry);
  document.getElementById("loadMap").addEventListener("click", loadMapFromText);
  document.getElementById("generateMap").addEventListener("click", syncMapToDocument);
  document.getElementById("clearMap").addEventListener("click", clearMap);
  document.getElementById("dynamicMap").addEventListener("click", generateCave);
  document.getElementById("openMap").addEventListener("click", previewSelectedLevel);
  elements.variantBox.addEventListener("input", () => {
    brushVariant = sanitizeBrushVariant(elements.variantBox.value);
    elements.variantBox.value = brushVariant;
  });
  elements.tileSearchInput.addEventListener("input", renderWorkspace);
  document.getElementById("tileCategoryFilter").addEventListener("change", renderWorkspace);
  document.getElementById("tilePreviewBackground").addEventListener("input", event => {
    elements.tilePreviewCanvas.style.backgroundColor = event.target.value;
  });
  document.getElementById("tilePreviewGrid").addEventListener("change", event => {
    elements.tilePreviewCanvas.classList.toggle("has-grid", event.target.checked);
  });
  document.getElementById("tilePreviewZoom").addEventListener("input", event => {
    elements.tilePreviewImage.style.setProperty("--preview-zoom", String(Number(event.target.value) / 2));
  });
  document.getElementById("discardTileArtwork").addEventListener("click", discardSelectedArtwork);
  elements.mapBox.addEventListener("change", loadMapFromText);
  elements.fileInput.addEventListener("change", async event => {
    const files = [...event.target.files];
    await importFiles(files);
    event.target.value = "";
  });
  document.getElementById("identifierForm").addEventListener("submit", event => {
    event.preventDefault();
    const input = document.getElementById("identifierInput");
    const value = input.value.trim();
    const error = identifierValidator?.(value);
    if (error) {
      document.getElementById("identifierError").textContent = error;
      input.focus();
      return;
    }
    finishIdentifierDialog(value);
  });
  document.getElementById("cancelIdentifier").addEventListener("click", () => finishIdentifierDialog(null));
  document.getElementById("identifierDialog").addEventListener("cancel", event => {
    event.preventDefault();
    finishIdentifierDialog(null);
  });
  document.getElementById("createNumericRegistry").addEventListener("click", createBlankNumericRegistry);
  document.getElementById("convertNumericRegistry").addEventListener("click", convertLegacyRegistry);
  document.getElementById("createNumericMap").addEventListener("click", createBlankNumericMap);
  document.getElementById("convertNumericMap").addEventListener("click", convertSelectedLegacyMap);
  document.getElementById("closeNumericDocument").addEventListener("click", () => document.getElementById("numericDocumentDialog").close());
  document.getElementById("cancelDependencyDelete").addEventListener("click", () => dependencyDialogResolver?.(false));
  document.getElementById("confirmDependencyDelete").addEventListener("click", () => dependencyDialogResolver?.(true));
  document.getElementById("dependencyDialog").addEventListener("cancel", event => {
    event.preventDefault();
    dependencyDialogResolver?.(false);
  });
  window.addEventListener("beforeunload", event => {
    if (![...store.documents.values()].some(document => document.dirty)) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function selectDefaultEntry() {
  const levelFile = store.get("levels").value;
  selection = { kind: "entry", key: levelFile.defaultLevel || Object.keys(levelFile.levels)[0] };
  if (!selection.key) selection = { kind: "settings" };
  loadSelectedMap();
}

function renderNavigation() {
  elements.nav.replaceChildren();
  document.querySelector(".nav-footnote").textContent = store.has("numericTiles") || store.has("numericMap")
    ? "Runtime and numeric documents"
    : "Four runtime documents";
  for (const definition of ALL_CONTENT_DOCUMENTS.filter(item => store.has(item.id))) {
    const record = store.get(definition.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-document";
    button.dataset.document = definition.id;
    button.setAttribute("aria-current", String(activeDocument === definition.id));
    const title = document.createElement("span");
    title.textContent = definition.label;
    const status = document.createElement("span");
    status.className = record.dirty ? "dirty-dot is-dirty" : "dirty-dot";
    status.textContent = record.dirty ? "Modified" : "Saved";
    button.append(title, status);
    button.addEventListener("click", () => selectDocument(definition.id));
    elements.nav.append(button);
  }
  elements.dirtyStatus.textContent = [...store.documents.values()].some(document => document.dirty)
    ? "Unsaved changes"
    : "All changes saved";
}

function selectDocument(id) {
  activeDocument = id;
  selectDefaultEntryForDocument();
  renderNavigation();
  renderWorkspace();
  renderTilePalette();
  renderInspector();
  runValidation();
}

function selectDefaultEntryForDocument() {
  const record = store.get(activeDocument);
  if (activeDocument === "levels") {
    const key = record.value.defaultLevel || Object.keys(record.value.levels)[0];
    selection = key ? { kind: "entry", key } : { kind: "settings" };
  } else if (activeDocument === "tiles") {
    const key = Object.keys(record.value)[0];
    selection = key == null ? { kind: "settings" } : { kind: "entry", key };
  } else if (activeDocument === "numericTiles") {
    const firstTile = record.value.tiles[0];
    selection = firstTile ? { kind: "entry", key: firstTile.id } : { kind: "settings" };
  } else if (activeDocument === "numericMap") {
    selection = { kind: "settings" };
    loadSelectedMap();
  } else {
    const collection = record.value[record.collection] || [];
    selection = collection.length ? { kind: "entry", key: 0 } : { kind: "settings" };
  }
  if (activeDocument === "levels") loadSelectedMap();
}

function renderWorkspace() {
  const definition = ALL_CONTENT_DOCUMENTS.find(item => item.id === activeDocument);
  const record = store.get(activeDocument);
  elements.workspaceTitle.textContent = definition.label;
  elements.workspaceMeta.textContent = `${record.sourceName}${record.dirty ? " - unsaved changes" : ""}`;
  elements.entryList.replaceChildren();
  const isTileCatalog = activeDocument === "tiles" || activeDocument === "numericTiles";
  elements.tileWorkspace.classList.toggle("is-active", isTileCatalog);
  elements.tileSearch.hidden = !isTileCatalog;
  elements.tilePreview.hidden = !isTileCatalog || selection.kind !== "entry";
  elements.entryList.classList.toggle("tile-catalog", isTileCatalog);
  elements.entryList.hidden = activeDocument === "numericMap";

  const settings = document.createElement("button");
  settings.type = "button";
  settings.className = `entry-row${selection.kind === "settings" ? " is-selected" : ""}`;
  settings.textContent = "Document settings";
  settings.addEventListener("click", () => selectEntry({ kind: "settings" }));
  if (activeDocument !== "tiles") elements.entryList.append(settings);

  const addLabels = {
    levels: "Add level",
    tiles: "Add legacy tile",
    numericTiles: "Add numeric tile",
    narrative: "Add event",
    achievements: "Add achievement"
  };
  document.getElementById("addEntry").textContent = `+ ${addLabels[activeDocument] || "Add item"}`;
  document.getElementById("workspaceTitle").textContent = activeDocument === "numericMap"
    ? `Numeric Map - ${record.value.name || "Untitled"}`
    : definition.label;

  const searchText = elements.tileSearchInput.value.trim().toLowerCase();
  const categoryFilter = document.getElementById("tileCategoryFilter").value;
  for (const entry of getEntries(record)) {
    if (isTileCatalog && categoryFilter && (categoryFilter === "uncategorized" ? Boolean(entry.category) : entry.category !== categoryFilter)) continue;
    if (isTileCatalog && searchText && !`${entry.title} ${entry.subtitle} ${entry.key} ${entry.category || ""}`.toLowerCase().includes(searchText)) continue;
    const button = document.createElement("button");
    button.type = "button";
    const isSelected = selection.kind === "entry" && selection.key === entry.key &&
      (selection.variant?.bucket || "") === (entry.selection?.variant?.bucket || "") &&
      (selection.variant?.key || "") === (entry.selection?.variant?.key || "") &&
      Boolean(selection.variant?.nested) === Boolean(entry.selection?.variant?.nested);
    button.className = `entry-row${isTileCatalog ? " tile-card" : ""}${entry.selection?.variant ? " variant-entry" : ""}${isSelected ? " is-selected" : ""}`;
    button.dataset.entryKey = String(entry.catalogId ?? entry.key);
    if (isTileCatalog) {
      const artwork = document.createElement("span");
      artwork.className = "tile-card-art";
      const image = tileImages[entry.artKey] || tileImages[entry.key];
      if (image?.complete && image.naturalWidth) {
        const thumbnail = document.createElement("img");
        thumbnail.src = image.src;
        thumbnail.alt = `${entry.title} tile artwork`;
        artwork.append(thumbnail);
      } else {
        artwork.textContent = entry.selection?.variant ? entry.selection.variant.key : entry.title;
        const invalid = tileArtworkErrors[entry.artKey || entry.key];
        artwork.setAttribute("aria-label", invalid ? `${entry.title} has invalid SVG artwork` : `${entry.title} has no SVG artwork`);
        artwork.classList.toggle("is-invalid-artwork", Boolean(invalid));
      }
      button.append(artwork);
    }
    const primary = document.createElement("span");
    primary.textContent = entry.title;
    const secondary = document.createElement("small");
    secondary.textContent = entry.subtitle;
    button.append(primary, secondary);
    button.addEventListener("click", () => selectEntry(entry.selection || { kind: "entry", key: entry.key }));
    elements.entryList.append(button);
  }
  renderTilePreview();

  document.getElementById("addEntry").disabled = activeDocument === "levels" && selection.kind !== "settings" && !record.value.levels;
  document.getElementById("addEntry").hidden = activeDocument === "numericMap";
  const numericBaseTileSelected = activeDocument === "numericTiles" && selection.kind === "entry" && !selection.variant;
  document.getElementById("duplicateEntry").hidden = !numericBaseTileSelected;
  document.getElementById("duplicateEntry").disabled = !numericBaseTileSelected;
  document.getElementById("deleteEntry").disabled = selection.kind !== "entry" || activeDocument === "numericMap";
  document.getElementById("mapEditor").hidden = !((activeDocument === "levels" && selection.kind === "entry") || activeDocument === "numericMap");
  const legacyMapControls = document.querySelector(".map-io");
  legacyMapControls.hidden = activeDocument !== "levels" || isNumericLevelMapSelected();
  document.getElementById("previewDoc").disabled = !((activeDocument === "levels" && selection.kind === "entry") || activeDocument === "numericMap");
  if (activeDocument === "levels" && selection.kind === "entry") loadSelectedMap();
}

function getEntries(record) {
  if (record.id === "numericTiles") {
    const entries = [];
    for (const tile of record.value.tiles) {
      entries.push({
        key: tile.id,
        catalogId: `numeric:${tile.id}`,
        title: tile.name,
        subtitle: `ID ${tile.id} · ${tile.category || "Uncategorized"} · Base tile`,
        category: tile.category || "",
        selection: { kind: "entry", key: tile.id },
        artKey: String(tile.id)
      });
      for (const bucket of VARIANT_BUCKETS) {
        for (const [nested, group] of [
          [false, tile.definition?.[bucket]],
          [true, tile.definition?.variants?.[bucket]]
        ]) {
          for (const [variantKey, variantDefinition] of Object.entries(group || {})) {
            entries.push({
              key: tile.id,
              catalogId: `numeric-variant:${tile.id}:${bucket}:${variantKey}${nested ? ":nested" : ""}`,
              title: variantDefinition?.name || variantKey,
              subtitle: `ID ${tile.id} / ${bucket} / ${variantKey}${nested ? " / nested" : ""}`,
              category: tile.category || "",
              selection: { kind: "entry", key: tile.id, variant: { bucket, key: variantKey, nested } },
              artKey: `${tile.id}:${bucket}:${variantKey}`
            });
          }
        }
      }
    }
    return entries;
  }
  const collection = record.collection ? record.value[record.collection] : record.value;
  if (record.id === "tiles" && collection && typeof collection === "object") {
    const entries = [];
    for (const [code, definition] of Object.entries(collection)) {
      entries.push({
        key: code,
        catalogId: `tile:${code}`,
        title: code,
        subtitle: definition?.pickupType || (definition?.exit ? "Exit" : definition?.solid ? "Solid" : definition?.gravity === false ? "Fluid" : "Tile"),
        category: definition?.category || "",
        selection: { kind: "entry", key: code },
        artKey: code
      });
      for (const bucket of VARIANT_BUCKETS) {
        for (const [variantKey, variantDefinition] of Object.entries(definition?.[bucket] || {})) {
          entries.push({
            key: code,
            catalogId: `variant:${code}:${bucket}:${variantKey}`,
            title: variantDefinition.name || variantKey,
            subtitle: `${code} / ${bucket} / ${variantKey}`,
            category: definition?.category || "",
            selection: { kind: "entry", key: code, variant: { bucket, key: variantKey } },
            artKey: `${code}:${bucket}:${variantKey}`
          });
        }
      }
    }
    return entries;
  }
  if (Array.isArray(collection)) {
    return collection.map((item, index) => ({
      key: index,
      title: item?.title || item?.name || item?.id || `Entry ${index + 1}`,
      subtitle: item?.id || `Index ${index}`
    }));
  }
  if (collection && typeof collection === "object") {
    return Object.entries(collection).map(([key, item]) => ({
      key,
      title: item?.name || item?.title || key,
      subtitle: record.id === "tiles"
        ? item?.pickupType || (item?.exit ? "Exit" : item?.solid ? "Solid" : item?.gravity === false ? "Fluid" : "Tile")
        : key
    }));
  }
  return [];
}

function selectEntry(nextSelection) {
  selection = nextSelection;
  if (activeDocument === "levels") loadSelectedMap();
  renderWorkspace();
  renderInspector();
}

function selectedValue() {
  const record = store.get(activeDocument);
  if (selection.kind === "settings") {
    if (activeDocument === "numericMap") return record.value;
    if (!record.collection) return {};
    const settings = { ...record.value };
    delete settings[record.collection];
    return settings;
  }
  if (activeDocument === "numericTiles") {
    const tile = record.value.tiles.find(item => item.id === selection.key);
    if (!tile) return undefined;
    if (selection.variant) {
      const groups = selection.variant.nested ? tile.definition.variants : tile.definition;
      return groups?.[selection.variant.bucket]?.[selection.variant.key];
    }
    const editable = { ...tile };
    delete editable.id;
    delete editable.legacyCode;
    return editable;
  }
  if (activeDocument === "tiles") {
    return selection.variant
      ? record.value[selection.key]?.[selection.variant.bucket]?.[selection.variant.key]
      : record.value[selection.key];
  }
  return record.value[record.collection]?.[selection.key];
}

function renderInspector({ preserveTileBuilderState = false } = {}) {
  const tileBuilderState = preserveTileBuilderState
    ? [...elements.inspectorFields.querySelectorAll(".tile-builder-section, .tile-custom-properties")].map(section => section.open)
    : null;
  const record = store.get(activeDocument);
  const value = selectedValue();
  elements.registryRolesPanel.hidden = activeDocument !== "numericTiles";
  if (elements.registryRolesPanel.hidden) elements.registryRoleFields.replaceChildren();
  const selectionName = selection.kind === "settings"
    ? "Document settings"
    : activeDocument === "tiles"
      ? selection.variant
        ? `Tile ${selection.key} / ${value?.name || selection.variant.key}`
        : `Tile ${selection.key}`
      : activeDocument === "numericTiles"
        ? selection.variant
          ? `Tile ${selection.key} / ${value?.name || selection.variant.key}`
          : `Tile ${selection.key} / ${value?.name || "Unnamed"}`
      : activeDocument === "levels"
        ? record.value.levels[selection.key]?.name || selection.key
        : value?.title || value?.name || value?.id || `Entry ${Number(selection.key) + 1}`;
  elements.inspectorTitle.textContent = selectionName;
  elements.inspectorFields.replaceChildren();

  if (value == null) {
    elements.inspectorFields.textContent = "Select an entry to edit its properties.";
    return;
  }
  if ((activeDocument === "tiles" || activeDocument === "numericTiles") && selection.kind === "entry") {
    renderVisualTileInspector(value);
    if (tileBuilderState) {
      elements.inspectorFields.querySelectorAll(".tile-builder-section, .tile-custom-properties").forEach((section, index) => {
        if (index < tileBuilderState.length) section.open = tileBuilderState[index];
      });
    }
    if (activeDocument === "numericTiles") renderNumericRegistryRoleControls(record.value);
    return;
  }
  renderJsonEditor(elements.inspectorFields, {
    value,
    suggestions: collectSuggestions(),
    skipKeys: activeDocument === "numericTiles" && selection.kind === "settings"
      ? ["tiles", "airTileId", "playerArtTileId", "defeatedMonsterTileId"]
      : activeDocument === "levels" && selection.kind === "entry" ? ["map"]
      : activeDocument === "numericTiles" && selection.kind === "entry" ? ["id", "legacyCode"]
        : activeDocument === "numericMap" ? ["cells", "variants"]
          : [],
    onChange: (nextValue, rerender, changedPath) => {
      updateSelectedValue(nextValue);
      if (rerender) renderInspector();
      if (activeDocument === "numericTiles" && !selection.variant && changedPath?.at(-1) === "name") {
        elements.inspectorTitle.textContent = `Tile ${selection.key} / ${nextValue.name || "Unnamed"}`;
        renderWorkspace();
      }
      if ((activeDocument === "tiles" || activeDocument === "numericTiles") && changedPath?.at(-1) === "svg") loadTileImages();
      renderNavigation();
      renderWorkspaceMeta();
      runValidation();
    }
  });
  if (activeDocument === "numericTiles") {
    renderNumericRegistryRoleControls(record.value);
  }
  if (activeDocument === "numericTiles" && selection.kind === "entry") {
    const identifier = document.createElement("label");
    identifier.className = "field-row numeric-tile-id";
    const caption = document.createElement("span");
    caption.className = "field-label";
    caption.textContent = "Numeric tile ID (stable)";
    const idInput = document.createElement("input");
    idInput.type = "number";
    idInput.value = String(selection.key);
    idInput.readOnly = true;
    idInput.setAttribute("aria-label", "Numeric tile ID, read only");
    identifier.append(caption, idInput);
    elements.inspectorFields.prepend(identifier);
  }
}

function renderVisualTileInspector(value) {
  const registry = activeDocument === "numericTiles" ? store.get("numericTiles").value : null;
  const tile = registry?.tiles.find(item => item.id === selection.key);
  const definition = selection.variant
    ? value
    : activeDocument === "numericTiles" ? value.definition || {} : value;
  const variantEntries = activeDocument === "numericTiles"
    ? getEntries(store.get("numericTiles")).filter(entry => entry.key === selection.key && entry.selection?.variant)
    : [];
  const propertyEditor = document.createElement("div");
  propertyEditor.className = "tile-property-editor";
  renderTilePropertyEditor(propertyEditor, {
    value: definition,
    tileId: activeDocument === "numericTiles" ? selection.key : null,
    name: selection.variant ? tile?.name : tile?.name || definition?.name || String(selection.key),
    category: selection.variant ? tile?.category : tile?.category || definition?.category || "",
    baseDefinition: getBaseTileDefinition(),
    isVariant: Boolean(selection.variant),
    variant: selection.variant || null,
    variants: variantEntries.map(entry => ({
      bucket: entry.selection.variant.bucket,
      key: entry.selection.variant.key,
      nested: entry.selection.variant.nested,
      hasArtwork: typeof getVariantDefinition(entry.selection)?.svg === "string"
    })),
    copySources: (registry?.tiles || []).map(item => ({ id: item.id, name: item.name, definition: item.definition })),
    suggestions: collectSuggestions(),
    onNameChange: nextName => {
      if (activeDocument === "numericTiles" && tile) {
        store.update("numericTiles", next => {
          const current = next.tiles.find(item => item.id === selection.key);
          if (current) current.name = nextName;
        });
        elements.inspectorTitle.textContent = `Tile ${selection.key} / ${nextName || "Unnamed"}`;
        elements.tilePreviewTitle.textContent = nextName || "Unnamed";
        renderNavigation();
        renderWorkspaceMeta();
        renderWorkspace();
        runValidation();
      } else {
        updateSelectedTileDefinition({ ...getSelectedTileDefinition(), name: nextName });
        renderWorkspace();
        runValidation();
      }
    },
    onCategoryChange: nextCategory => {
      if (activeDocument === "numericTiles" && tile) {
        store.update("numericTiles", next => {
          const current = next.tiles.find(item => item.id === selection.key);
          if (!current) return;
          if (nextCategory) current.category = nextCategory;
          else delete current.category;
        });
        renderNavigation();
        renderWorkspaceMeta();
        runValidation();
      } else {
        const next = { ...getSelectedTileDefinition() };
        if (nextCategory) next.category = nextCategory;
        else delete next.category;
        updateSelectedTileDefinition(next);
        renderNavigation();
        renderWorkspaceMeta();
        runValidation();
      }
    },
    onSelectVariant: nextVariant => {
      const entry = variantEntries.find(item =>
        item.selection.variant.bucket === nextVariant.bucket &&
        item.selection.variant.key === nextVariant.key &&
        Boolean(item.selection.variant.nested) === Boolean(nextVariant.nested));
      if (entry) selectEntry(entry.selection);
    },
    onChange: (nextDefinition, options = {}) => {
      updateSelectedTileDefinition(nextDefinition);
      if (options.refresh) renderInspector({ preserveTileBuilderState: true });
      renderNavigation();
      renderWorkspaceMeta();
      if (Object.hasOwn(nextDefinition, "svg") || Object.hasOwn(definition, "svg")) loadTileImages();
      else renderWorkspace();
      runValidation();
    }
  });
  elements.inspectorFields.append(propertyEditor);
}

function getVariantDefinition(variantSelection) {
  if (activeDocument === "numericTiles") {
    const tile = store.get("numericTiles").value.tiles.find(item => item.id === variantSelection.key);
    const groups = variantSelection.variant.nested ? tile?.definition?.variants : tile?.definition;
    return groups?.[variantSelection.variant.bucket]?.[variantSelection.variant.key];
  }
  return store.get("tiles").value[variantSelection.key]?.[variantSelection.variant.bucket]?.[variantSelection.variant.key];
}

function renderVariantInheritance(variantDefinition) {
  const base = getBaseTileDefinition();
  const inherited = Object.entries(base).filter(([name]) => !Object.hasOwn(variantDefinition, name) && !VARIANT_BUCKETS.includes(name) && name !== "variants");
  const overrides = Object.keys(variantDefinition).filter(name => !VARIANT_BUCKETS.includes(name) && name !== "variants");
  const section = document.createElement("section");
  section.className = "tile-inheritance";
  const heading = document.createElement("strong");
  heading.textContent = `Variant ${selection.variant.key} · ${selection.variant.bucket}`;
  const explicit = document.createElement("p");
  explicit.textContent = overrides.length ? `Explicit overrides: ${overrides.join(", ")}` : "No explicit property overrides.";
  const inheritedList = document.createElement("div");
  inheritedList.className = "tile-inherited-list";
  for (const [name, inheritedValue] of inherited) {
    const item = document.createElement("div");
    const propertyName = document.createElement("code");
    propertyName.textContent = name;
    const summary = document.createElement("span");
    summary.textContent = ` inherited: ${JSON.stringify(inheritedValue)}`;
    item.append(propertyName, summary);
    inheritedList.append(item);
  }
  section.append(heading, explicit, inheritedList);
  elements.inspectorFields.append(section);
}

function getBaseTileDefinition() {
  if (activeDocument === "numericTiles") {
    return store.get("numericTiles").value.tiles.find(tile => tile.id === selection.key)?.definition || {};
  }
  return getLegacyTileDefinitions()[selection.key] || {};
}

function getLegacyTileDefinitions() {
  if (store.has("tiles")) return store.get("tiles").value;
  if (!store.has("numericTiles")) return {};
  return Object.fromEntries(store.get("numericTiles").value.tiles
    .filter(tile => tile.legacyCode != null)
    .map(tile => [tile.legacyCode, tile.definition]));
}

function updateSelectedTileDefinition(nextDefinition) {
  if (activeDocument === "numericTiles") {
    store.update("numericTiles", registry => {
      const tile = registry.tiles.find(item => item.id === selection.key);
      if (!tile) return;
      if (!selection.variant) {
        tile.definition = nextDefinition;
        return;
      }
      const groups = selection.variant.nested ? (tile.definition.variants ||= {}) : tile.definition;
      (groups[selection.variant.bucket] ||= {})[selection.variant.key] = nextDefinition;
    });
    return;
  }
  store.update("tiles", tiles => {
    if (!selection.variant) tiles[selection.key] = nextDefinition;
    else (tiles[selection.key][selection.variant.bucket] ||= {})[selection.variant.key] = nextDefinition;
  });
}

function renderTilePreview() {
  if (!elements.tilePreview || elements.tilePreview.hidden) return;
  const entry = getEntries(store.get(activeDocument)).find(item =>
    item.selection?.key === selection.key &&
    (item.selection?.variant?.bucket || "") === (selection.variant?.bucket || "") &&
    (item.selection?.variant?.key || "") === (selection.variant?.key || "") &&
    Boolean(item.selection?.variant?.nested) === Boolean(selection.variant?.nested));
  if (!entry) return;
  const tile = activeDocument === "numericTiles"
    ? store.get("numericTiles").value.tiles.find(item => item.id === selection.key)
    : null;
  const baseName = activeDocument === "numericTiles" ? tile?.name || "Unnamed" : `Tile ${selection.key}`;
  elements.tilePreviewTitle.textContent = `${baseName}${selection.variant ? ` / ${selection.variant.key}` : ""}`;
  elements.tilePreviewId.textContent = activeDocument === "numericTiles" ? `ID ${selection.key}` : `Tile ${selection.key}`;
  const image = tileImages[entry.artKey] || (selection.variant ? tileImages[String(selection.key)] : null);
  const error = tileArtworkErrors[entry.artKey] || "";
  elements.tilePreviewImage.hidden = !image?.complete || !image.naturalWidth;
  elements.tilePreviewImage.removeAttribute("src");
  if (!elements.tilePreviewImage.hidden) elements.tilePreviewImage.src = image.src;
  elements.tilePreviewError.hidden = !elements.tilePreviewImage.hidden;
  elements.tilePreviewError.classList.toggle("is-invalid", Boolean(error));
  elements.tilePreviewError.textContent = error || "No SVG artwork for this tile or variant.";
}

function discardSelectedArtwork() {
  const record = store.get(activeDocument);
  const savedRoot = record.savedValue;
  let savedDefinition = activeDocument === "numericTiles"
    ? savedRoot?.tiles?.find(tile => tile.id === selection.key)?.definition
    : savedRoot?.[selection.key];
  if (selection.variant) {
    const groups = selection.variant.nested ? savedDefinition?.variants : savedDefinition;
    savedDefinition = groups?.[selection.variant.bucket]?.[selection.variant.key];
  }
  const nextDefinition = cloneJson(getSelectedTileDefinition());
  if (typeof savedDefinition?.svg === "string") nextDefinition.svg = savedDefinition.svg;
  else delete nextDefinition.svg;
  updateSelectedTileDefinition(nextDefinition);
  renderInspector();
  renderNavigation();
  renderWorkspaceMeta();
  loadTileImages();
  runValidation();
}

function getSelectedTileDefinition() {
  const value = selectedValue();
  if (selection.variant) return value || {};
  return activeDocument === "numericTiles" ? value?.definition || {} : value || {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function renderNumericRegistryRoleControls(registry) {
  elements.registryRoleFields.replaceChildren();
  const section = document.createElement("section");
  section.className = "numeric-role-controls field-object";
  const heading = document.createElement("div");
  heading.className = "field-object-heading";
  heading.textContent = "Registry roles";
  section.append(heading);
  const roles = [
    ["airTileId", "Air tile", true],
    ["playerArtTileId", "Runner artwork", false],
    ["defeatedMonsterTileId", "Defeated monster replacement", false]
  ];
  for (const [fieldName, labelText, required] of roles) {
    const label = document.createElement("label");
    label.className = "field-row";
    const caption = document.createElement("span");
    caption.className = "field-label";
    caption.textContent = labelText;
    const select = document.createElement("select");
    select.setAttribute("aria-label", labelText);
    if (!required) {
      const none = new Option("Not set", "");
      select.append(none);
    }
    for (const tile of registry.tiles) {
      const option = new Option(`${tile.name} (ID ${tile.id})`, String(tile.id));
      select.append(option);
    }
    select.value = registry[fieldName] == null ? "" : String(registry[fieldName]);
    select.addEventListener("change", () => {
      const nextId = select.value === "" ? null : Number(select.value);
      store.update("numericTiles", value => {
        if (nextId == null) delete value[fieldName];
        else value[fieldName] = nextId;
      });
      renderNavigation();
      renderWorkspaceMeta();
      runValidation();
    });
    label.append(caption, select);
    section.append(label);
  }
  elements.registryRoleFields.append(section);
}

function updateSelectedValue(nextValue) {
  store.update(activeDocument, documentValue => {
    if (selection.kind === "settings") {
      const collection = store.get(activeDocument).collection;
      if (!collection) return nextValue;
      const next = { ...documentValue };
      for (const key of Object.keys(next)) {
        if (key !== collection && !Object.hasOwn(nextValue, key)) delete next[key];
      }
      for (const [key, value] of Object.entries(nextValue)) next[key] = value;
      return next;
    }
    if (activeDocument === "numericTiles") {
      const index = documentValue.tiles.findIndex(item => item.id === selection.key);
      if (index < 0) return documentValue;
      const tile = documentValue.tiles[index];
      if (selection.variant) {
        const groups = selection.variant.nested ? tile.definition.variants : tile.definition;
        groups[selection.variant.bucket][selection.variant.key] = nextValue;
      } else {
        documentValue.tiles[index] = { ...tile, ...nextValue, id: tile.id };
      }
    } else if (activeDocument === "tiles") {
      if (selection.variant) {
        documentValue[selection.key][selection.variant.bucket][selection.variant.key] = nextValue;
      } else {
        documentValue[selection.key] = nextValue;
      }
    } else if (Array.isArray(documentValue[store.get(activeDocument).collection])) {
      documentValue[store.get(activeDocument).collection][selection.key] = nextValue;
    } else {
      documentValue[store.get(activeDocument).collection][selection.key] = nextValue;
    }
    return documentValue;
  });
}

function collectSuggestions() {
  const levels = store.get("levels").value.levels || {};
  const tiles = getLegacyTileDefinitions();
  const events = store.get("narrative").value.events || [];
  const achievements = store.get("achievements").value.achievements || [];
  const stats = new Set();
  const flags = new Set();

  for (const definition of Object.values(tiles)) {
    for (const name of Object.keys(definition?.grantStats || {})) stats.add(name);
    for (const effect of definition?.effects || []) {
      if (effect?.stat) stats.add(effect.stat);
      if (effect?.flag) flags.add(effect.flag);
    }
  }
  for (const achievement of achievements) {
    for (const name of Object.keys(achievement?.grantStats || achievement?.rewards?.stats || {})) stats.add(name);
    if (achievement?.when?.stat) stats.add(achievement.when.stat);
  }
  for (const event of events) {
    for (const action of event?.actions || []) if (action?.flag) flags.add(action.flag);
  }

  return {
    ids: [...new Set([...events.map(item => item?.id), ...achievements.map(item => item?.id), ...Object.keys(levels)])].filter(Boolean),
    eventIds: events.map(item => item?.id).filter(Boolean),
    levelIds: Object.keys(levels),
    tileCodes: Object.keys(tiles),
    variants: [...new Set(Object.values(tiles).flatMap(definition => VARIANT_BUCKETS.flatMap(bucket => Object.keys(definition?.[bucket] || {}))))],
    stats: [...new Set([...stats, "hearts", "score", "kills", "xp", "movementPoints", "dice.rollCount", "target.moveCost", "damage.amount", "pickup.type"])],
    flags: [...flags]
  };
}

function openTileCreationDialog() {
  tileCreationDraft = { step: 1, mode: "blank", sourceId: null };
  document.getElementById("tileCreationName").value = "";
  document.getElementById("tileCreationCategory").value = "";
  document.getElementById("tileCreationSourceSearch").value = "";
  document.getElementById("tileCreationError").textContent = "";
  document.getElementById("tileCreationStepError").textContent = "";
  document.querySelector('input[name="tileStartMode"][value="blank"]').checked = true;
  renderTileCreationCapabilityOptions();
  updateTileCreationCategoryHelp();
  updateTileCreationMode();
  setTileCreationStep(1);
  document.getElementById("tileCreationDialog").showModal();
  document.getElementById("tileCreationName").focus();
}

function closeTileCreationDialog() {
  tileCreationDraft = null;
  const dialog = document.getElementById("tileCreationDialog");
  if (dialog.open) dialog.close();
}

function clearTileCreationErrors() {
  document.getElementById("tileCreationError").textContent = "";
  document.getElementById("tileCreationStepError").textContent = "";
}

function updateTileCreationCategoryHelp() {
  const descriptions = {
    Environmental: "Terrain, atmosphere, and world surfaces.",
    Item: "Collectibles and rewards the player can gather.",
    Interactive: "Doors, signs, creatures, and other active world objects."
  };
  const category = document.getElementById("tileCreationCategory").value;
  document.getElementById("tileCreationCategoryHelp").textContent = category
    ? `${descriptions[category]} This category only organizes the catalog; it does not add gameplay behavior.`
    : "Choose how this tile is organized in the catalog. Category does not add gameplay behavior.";
}

function updateTileCreationMode() {
  if (!tileCreationDraft) return;
  const mode = document.querySelector('input[name="tileStartMode"]:checked')?.value || "blank";
  tileCreationDraft.mode = mode;
  const needsSource = mode !== "blank";
  document.getElementById("tileCreationSourcePicker").hidden = !needsSource;
  document.getElementById("tileCreationCapabilityOptions").hidden = mode !== "capabilities";
  if (needsSource) renderTileCreationSources();
  clearTileCreationErrors();
}

function setTileCreationStep(step) {
  if (!tileCreationDraft) return;
  tileCreationDraft.step = step;
  document.getElementById("tileCreationStepCount").textContent = `Step ${step} of 3`;
  for (const panel of document.querySelectorAll("[data-tile-creation-step]")) {
    panel.hidden = Number(panel.dataset.tileCreationStep) !== step;
  }
  for (const item of document.querySelectorAll(".tile-creation-progress [data-step]")) {
    if (Number(item.dataset.step) === step) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  }
  document.getElementById("tileCreationBack").hidden = step === 1;
  document.getElementById("tileCreationNext").hidden = step === 3;
  document.getElementById("tileCreationCreate").hidden = step !== 3;
  document.getElementById("tileCreationNext").textContent = step === 2 ? "Review" : "Next";
  clearTileCreationErrors();
  if (step === 3) renderTileCreationReview();
  document.querySelector(`[data-tile-creation-step="${step}"] h3`)?.focus();
}

function advanceTileCreationStep() {
  if (!tileCreationDraft) return;
  clearTileCreationErrors();
  if (tileCreationDraft.step === 1) {
    const name = document.getElementById("tileCreationName").value.trim();
    const category = document.getElementById("tileCreationCategory").value;
    if (!name) {
      document.getElementById("tileCreationError").textContent = "Enter a tile name.";
      document.getElementById("tileCreationName").focus();
      return;
    }
    if (!TILE_EDITOR_CATEGORIES.includes(category)) {
      document.getElementById("tileCreationError").textContent = "Choose an editor category.";
      document.getElementById("tileCreationCategory").focus();
      return;
    }
    tileCreationDraft.name = name;
    tileCreationDraft.category = category;
    setTileCreationStep(2);
    return;
  }

  if (tileCreationDraft.step === 2) {
    if (tileCreationDraft.mode !== "blank" && !getTileCreationSource()) {
      document.getElementById("tileCreationStepError").textContent = "Choose a source tile or switch to Start blank.";
      document.getElementById("tileCreationSourceSearch").focus();
      return;
    }
    if (tileCreationDraft.mode === "capabilities" && getSelectedTileCreationGroups().length === 0) {
      document.getElementById("tileCreationStepError").textContent = "Select at least one capability group.";
      document.getElementById("tileCreationCapabilityList").querySelector("input")?.focus();
      return;
    }
    setTileCreationStep(3);
  }
}

function renderTileCreationCapabilityOptions() {
  const container = document.getElementById("tileCreationCapabilityList");
  container.replaceChildren();
  for (const capability of TILE_CREATION_CAPABILITY_GROUPS) {
    const label = document.createElement("label");
    label.className = "tile-copy-capability";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = capability.id;
    checkbox.dataset.capabilityId = capability.id;
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = capability.label;
    const properties = document.createElement("small");
    properties.textContent = capability.properties
      .map(propertyName => TILE_PROPERTY_DEFINITIONS[propertyName]?.label || propertyName)
      .join(" · ");
    text.append(name, properties);
    label.append(checkbox, text);
    container.append(label);
  }
}

function getSelectedTileCreationGroups() {
  const selected = new Set([...document.querySelectorAll("#tileCreationCapabilityList input:checked")].map(input => input.value));
  return TILE_CREATION_CAPABILITY_GROUPS.filter(group => selected.has(group.id));
}

function getTileCreationSource() {
  if (tileCreationDraft?.sourceId == null) return null;
  return store.get("numericTiles").value.tiles.find(tile => tile.id === tileCreationDraft.sourceId) || null;
}

function renderTileCreationSources() {
  const container = document.getElementById("tileCreationSourceResults");
  const status = document.getElementById("tileCreationSourceStatus");
  container.replaceChildren();
  if (!tileCreationDraft) return;
  const query = document.getElementById("tileCreationSourceSearch").value.trim().toLowerCase();
  const results = store.get("numericTiles").value.tiles.filter(tile =>
    !query || `${tile.name} ${tile.id} ${tile.category || ""}`.toLowerCase().includes(query));
  for (const tile of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile-source-option";
    button.setAttribute("aria-pressed", String(tileCreationDraft.sourceId === tile.id));
    button.setAttribute("aria-label", `Choose ${tile.name}, ID ${tile.id}, ${tile.category || "Uncategorized"}`);
    const artwork = tileImages[String(tile.id)];
    if (artwork?.complete && artwork.naturalWidth) {
      const image = document.createElement("img");
      image.src = artwork.src;
      image.alt = "";
      button.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "tile-source-placeholder";
      placeholder.textContent = tile.name.slice(0, 2).toUpperCase();
      button.append(placeholder);
    }
    const info = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = `${tile.name} (ID ${tile.id})`;
    const summary = document.createElement("small");
    summary.textContent = `${tile.category || "Uncategorized"} · ${summarizeTileDefinition(tile.definition)}`;
    info.append(title, summary);
    button.append(info);
    button.addEventListener("click", () => {
      tileCreationDraft.sourceId = tile.id;
      renderTileCreationSources();
      status.textContent = `Selected ${tile.name} (ID ${tile.id}).`;
      clearTileCreationErrors();
    });
    container.append(button);
  }
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "tile-creation-help";
    empty.textContent = "No tiles match this search.";
    container.append(empty);
  }
  if (!getTileCreationSource()) status.textContent = "Choose a source tile.";
}

function summarizeTileDefinition(definition = {}) {
  const groups = TILE_CREATION_CAPABILITY_GROUPS
    .filter(group => group.properties.some(propertyName => Object.hasOwn(definition, propertyName)))
    .map(group => group.label);
  const variants = countTileVariants(definition);
  const customCount = Object.keys(definition).filter(key =>
    !Object.hasOwn(TILE_PROPERTY_DEFINITIONS, key) && !VARIANT_BUCKETS.includes(key) && key !== "variants").length;
  const parts = [groups.length ? groups.join(", ") : "No configured capabilities"];
  parts.push(typeof definition.svg === "string" && definition.svg ? "Artwork" : "No artwork");
  if (customCount) parts.push(`${customCount} custom field${customCount === 1 ? "" : "s"}`);
  if (variants) parts.push(`${variants} variant entr${variants === 1 ? "y" : "ies"}`);
  return parts.join(" · ");
}

function countTileVariants(definition = {}) {
  let count = 0;
  for (const bucket of VARIANT_BUCKETS) {
    count += Object.keys(definition[bucket] || {}).length;
    count += Object.keys(definition.variants?.[bucket] || {}).length;
  }
  return count;
}

function buildTileCreationDefinition(source) {
  if (tileCreationDraft.mode === "blank") return {};
  if (!source) return {};
  if (tileCreationDraft.mode === "entire") return cloneJson(source.definition || {});
  const definition = {};
  for (const group of getSelectedTileCreationGroups()) {
    for (const propertyName of group.properties) {
      if (Object.hasOwn(source.definition || {}, propertyName)) {
        definition[propertyName] = cloneJson(source.definition[propertyName]);
      }
    }
  }
  return definition;
}

function renderTileCreationReview() {
  const source = getTileCreationSource();
  const definition = buildTileCreationDefinition(source);
  const groups = getSelectedTileCreationGroups();
  document.getElementById("tileCreationReviewName").textContent = tileCreationDraft.name;
  document.getElementById("tileCreationReviewCategory").textContent = tileCreationDraft.category;
  document.getElementById("tileCreationReviewSource").textContent = tileCreationDraft.mode === "blank"
    ? "Start blank"
    : `${source.name} (ID ${source.id}) · ${tileCreationDraft.mode === "entire" ? "entire definition" : "selected capabilities only"}`;
  if (tileCreationDraft.mode === "capabilities") {
    document.getElementById("tileCreationReviewCapabilities").textContent = groups.map(group => {
      const copied = group.properties.filter(propertyName => Object.hasOwn(source.definition || {}, propertyName));
      const labels = copied.map(propertyName => TILE_PROPERTY_DEFINITIONS[propertyName]?.label || propertyName);
      return `${group.label}: ${labels.length ? labels.join(", ") : "no explicit source properties"}`;
    }).join("; ");
  } else if (tileCreationDraft.mode === "entire") {
    document.getElementById("tileCreationReviewCapabilities").textContent = "All definition properties and custom JSON";
  } else {
    document.getElementById("tileCreationReviewCapabilities").textContent = "None";
  }
  document.getElementById("tileCreationReviewArtwork").textContent = definition.svg ? "SVG artwork will be copied" : "No SVG artwork";
  document.getElementById("tileCreationReviewSummary").textContent = summarizeTileDefinition(definition);

  const notice = document.getElementById("tileCreationVariantNotice");
  const variantCount = tileCreationDraft.mode === "entire" ? countTileVariants(definition) : 0;
  notice.hidden = variantCount === 0;
  if (variantCount) {
    const hasEncounterVariants = Boolean(definition.monster || definition.lock || definition.variants?.monster || definition.variants?.lock);
    notice.textContent = `The complete definition includes ${variantCount} variant entr${variantCount === 1 ? "y" : "ies"}. Variant data is copied as-is;${hasEncounterVariants ? " monster/lock data retains the existing variant-based runtime interpretation and does not create a new independent encounter mechanic." : " this does not add new runtime behavior."}`;
  }
}

function createTileFromWizard() {
  if (!tileCreationDraft || tileCreationDraft.step !== 3) return;
  const source = getTileCreationSource();
  if (tileCreationDraft.mode !== "blank" && !source) {
    document.getElementById("tileCreationError").textContent = "Choose a source tile before creating.";
    return;
  }
  try {
    const definition = buildTileCreationDefinition(source);
    const result = addNumericTile(store.get("numericTiles").value, {
      name: tileCreationDraft.name,
      definition
    });
    const created = result.registry.tiles.find(tile => tile.id === result.id);
    created.category = tileCreationDraft.category;
    store.update("numericTiles", () => result.registry);
    const { id, name } = created;
    activeDocument = "numericTiles";
    selection = { kind: "entry", key: id };
    closeTileCreationDialog();
    loadTileImages();
    renderNavigation();
    renderWorkspace();
    renderInspector();
    const identity = elements.inspectorFields.querySelector(".tile-builder-section");
    if (identity) identity.open = true;
    renderTilePalette();
    runValidation();
    updateStatus(`Created ${name} (ID ${id}). Changes are unsaved. Identity is open; Capabilities and Appearance are ready below.`);
  } catch (error) {
    document.getElementById("tileCreationError").textContent = error.message;
  }
}

async function addEntry() {
  const record = store.get(activeDocument);
  if (activeDocument === "numericTiles") {
    openTileCreationDialog();
    return;
  } else if (activeDocument === "tiles") {
    const code = await requestIdentifier({
      title: "Add tile",
      label: "Tile code",
      help: "Choose one unused letter for this tile.",
      maxLength: 1,
      validate: value => {
        if (!/^[A-Za-z]$/.test(value)) return "Tile code must be one letter.";
        if (Object.hasOwn(store.get("tiles").value, value)) return `Tile '${value}' already exists.`;
        return "";
      }
    });
    if (!code) return;
    store.update(activeDocument, value => { value[code] = {}; });
    loadTileImages();
    selection = { kind: "entry", key: code };
  } else if (activeDocument === "levels") {
    const id = await requestIdentifier({
      title: "Add level",
      label: "Level identifier",
      help: "Choose a unique key for the new level.",
      maxLength: 80,
      validate: value => {
        if (!value) return "Level identifier is required.";
        if (Object.hasOwn(store.get("levels").value.levels, value)) return `Level '${value}' already exists.`;
        return "";
      }
    });
    if (!id) return;
    store.update(activeDocument, value => {
      value.levels[id] = { id, name: id, map: encodeMap(mapTiles, mapVariants) };
    });
    selection = { kind: "entry", key: id };
  } else {
    const collection = record.value[record.collection];
    store.update(activeDocument, value => {
      const items = value[record.collection];
      items.push(activeDocument === "narrative"
        ? { id: "", trigger: { type: "level_start" }, actions: [] }
        : { id: "", title: "", when: { stat: "", atLeast: 1 } });
    });
    selection = { kind: "entry", key: collection.length };
  }
  renderNavigation();
  renderWorkspace();
  renderInspector();
  runValidation();
}

function duplicateSelectedTile() {
  if (activeDocument !== "numericTiles" || selection.kind !== "entry" || selection.variant) return;
  const registry = store.get("numericTiles").value;
  const source = registry.tiles.find(tile => tile.id === selection.key);
  if (!source) return;
  const result = duplicateNumericTile(registry, source.id);
  store.update("numericTiles", () => result.registry);
  selection = { kind: "entry", key: result.id };
  loadTileImages();
  renderNavigation();
  renderWorkspace();
  renderInspector();
  runValidation();
}

function requestIdentifier({ title, label, help, maxLength, validate }) {
  const dialog = document.getElementById("identifierDialog");
  const input = document.getElementById("identifierInput");
  document.getElementById("identifierTitle").textContent = title;
  document.getElementById("identifierLabel").textContent = label;
  document.getElementById("identifierHelp").textContent = help;
  document.getElementById("identifierError").textContent = "";
  input.value = "";
  input.maxLength = maxLength;
  identifierValidator = validate;

  return new Promise(resolve => {
    identifierDialogResolver = resolve;
    dialog.showModal();
    input.focus();
  });
}

function finishIdentifierDialog(value) {
  if (!identifierDialogResolver) return;
  const resolve = identifierDialogResolver;
  identifierDialogResolver = null;
  identifierValidator = null;
  document.getElementById("identifierDialog").close();
  resolve(value);
}

function deleteEntry() {
  if (selection.kind !== "entry") return;
  if (activeDocument === "numericTiles") {
    requestNumericTileDelete(selection.key, selection.variant || null);
    return;
  }
  const label = activeDocument === "tiles"
    ? selection.variant ? `${selection.key} / ${selectedValue()?.name || selection.variant.key}` : selection.key
    : String(selectedValue()?.id || selectedValue()?.name || selection.key);
  if (!window.confirm(`Delete '${label}' from ${store.get(activeDocument).label}?`)) return;
  const record = store.get(activeDocument);
  store.update(activeDocument, value => {
    if (activeDocument === "tiles" && selection.variant) delete value[selection.key][selection.variant.bucket][selection.variant.key];
    else if (activeDocument === "tiles") delete value[selection.key];
    else if (Array.isArray(value[record.collection])) value[record.collection].splice(selection.key, 1);
    else delete value[record.collection][selection.key];
  });
  if (activeDocument === "tiles") loadTileImages();
  if (activeDocument === "tiles" && selection.variant) selection = { kind: "entry", key: selection.key };
  else if (activeDocument === "tiles") selectDefaultEntryForDocument();
  else selection = { kind: "settings" };
  renderNavigation();
  renderWorkspace();
  renderInspector();
  runValidation();
}

async function requestNumericTileDelete(tileId, variant = null) {
  const dependencies = collectNumericTileDependencies(tileId, variant);
  const target = { tileId, variant };
  document.getElementById("dependencyTitle").textContent = variant ? "Delete tile variant?" : "Delete numeric tile?";
  document.getElementById("dependencySummary").textContent = variant
    ? `ID ${tileId}, variant ${variant.bucket}.${variant.key}`
    : `Tile ID ${tileId} will be permanently retired. Its ID will not be reused.`;
  document.getElementById("dependencyError").textContent = dependencies.blocking.length
    ? "Resolve these references before deleting this tile."
    : "No active references found. The numeric ID will remain retired.";
  const list = document.getElementById("dependencyList");
  list.replaceChildren();
  for (const reference of [...dependencies.blocking, ...dependencies.reservations]) {
    const item = document.createElement("li");
    item.textContent = reference;
    list.append(item);
  }
  const confirm = document.getElementById("confirmDependencyDelete");
  confirm.disabled = dependencies.blocking.length > 0;
  confirm.textContent = dependencies.blocking.length ? "Resolve references first" : "Delete and retire ID";
  return new Promise(resolve => {
    dependencyDialogResolver = async accepted => {
      if (accepted && dependencies.blocking.length === 0) {
        const record = store.get("numericTiles");
        if (target.variant) {
          store.update("numericTiles", value => {
            const tile = value.tiles.find(item => item.id === target.tileId);
            const groups = target.variant.nested ? tile.definition.variants : tile.definition;
            delete groups[target.variant.bucket][target.variant.key];
          });
        } else {
          store.update("numericTiles", value => removeNumericTile(value, target.tileId));
        }
        if (!target.variant && selection.key === target.tileId) {
          const first = store.get("numericTiles").value.tiles[0];
          selection = first ? { kind: "entry", key: first.id } : { kind: "settings" };
        } else if (target.variant) {
          selection = { kind: "entry", key: target.tileId };
        }
        loadTileImages();
        renderNavigation();
        renderWorkspace();
        renderInspector();
        runValidation();
        updateStatus(`${record.value.tiles.length - store.get("numericTiles").value.tiles.length} tile deleted`);
      }
      finishDependencyDelete(accepted);
      resolve(accepted && dependencies.blocking.length === 0);
    };
    document.getElementById("dependencyDialog").showModal();
  });
}

function finishDependencyDelete(accepted) {
  const dialog = document.getElementById("dependencyDialog");
  dependencyDialogResolver = null;
  if (dialog.open) dialog.close();
  if (!accepted) return;
}

function collectNumericTileDependencies(tileId, variant = null) {
  const blocking = [];
  const reservations = [];
  const registry = store.get("numericTiles").value;
  const matches = (id, cellVariant) => id === tileId && (!variant || cellVariant === variant.key);
  const reportCell = (path, id, cellVariant) => {
    if (matches(id, cellVariant)) blocking.push(`${path}${cellVariant ? ` (variant ${cellVariant})` : ""}`);
  };

  if (registry.airTileId === tileId) blocking.push("Registry role: airTileId");
  if (registry.playerArtTileId === tileId) blocking.push("Registry role: playerArtTileId");
  if (registry.defeatedMonsterTileId === tileId) blocking.push("Registry role: defeatedMonsterTileId");
  for (const [legacyCode, id] of Object.entries(registry.legacyIdMapping || {})) {
    if (id === tileId) reservations.push(`Retired legacy alias reservation: ${legacyCode} -> ${id}`);
  }

  if (store.has("numericMap")) {
    const map = store.get("numericMap").value;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) reportCell(`numericMap.cells[${y}][${x}]`, map.cells[y][x], map.variants?.[y]?.[x]);
    }
    if (map.spawn?.artTileId === tileId) blocking.push("numericMap.spawn.artTileId");
  }

  const checkMap = (encoded, path) => {
    if (isNumericMapDocumentSafe(encoded)) {
      for (let y = 0; y < encoded.height; y++) {
        for (let x = 0; x < encoded.width; x++) reportCell(`${path}.cells[${y}][${x}]`, encoded.cells[y][x], encoded.variants?.[y]?.[x]);
      }
      if (encoded.spawn?.artTileId === tileId) blocking.push(`${path}.spawn.artTileId`);
      return;
    }
    if (typeof encoded !== "string") return;
    const normalized = normalizeTileDefinitions(registry);
    const decoded = decodeMap(encoded);
    for (let y = 0; y < decoded.tiles.length; y++) {
      for (let x = 0; x < decoded.tiles[y].length; x++) {
        const mappedId = normalized.idsByLegacyCode.get(decoded.tiles[y][x]);
        reportCell(`${path}[${y}][${x}]`, mappedId, decoded.variants[y][x]);
      }
    }
  };

  for (const [levelId, level] of Object.entries(store.get("levels").value.levels || {})) {
    checkMap(level.map, `levels.${levelId}.map`);
  }
  for (const exitTile of registry.tiles.filter(tile => tile.definition?.exit === true)) {
    for (const [key, value] of Object.entries(exitTile.definition)) {
      if (["default", "a", "b"].includes(key) || key.startsWith("Level-") || key.startsWith("exit")) {
        checkMap(value, `numericTiles.${exitTile.id}.definition.${key}`);
      }
    }
  }

  for (const [index, event] of (store.get("narrative").value.events || []).entries()) {
    const trigger = event?.trigger || {};
    const aliases = registry.tiles.filter(tile => tile.id === tileId).map(tile => tile.legacyCode).filter(Boolean);
    if ((trigger.tileId === tileId || aliases.includes(trigger.tile)) && (!variant || trigger.variant === variant.key)) {
      blocking.push(`narrative.events[${index}].trigger`);
    }
  }

  for (const [index, tile] of registry.tiles.entries()) {
    for (const bucket of ["monster", "variants.monster"]) {
      const group = bucket === "monster" ? tile.definition?.monster : tile.definition?.variants?.monster;
      for (const [key, monster] of Object.entries(group || {})) {
        if (monster?.defeatedTileId === tileId) blocking.push(`numericTiles.tiles[${index}].definition.${bucket}.${key}.defeatedTileId`);
      }
    }
  }

  return { blocking: [...new Set(blocking)], reservations: [...new Set(reservations)] };
}

function isNumericMapDocumentSafe(value) {
  return value && typeof value === "object" && value.format === "runner.numeric-map" && value.version === 1;
}

function isNumericLevelMapSelected() {
  return activeDocument === "levels" && selection.kind === "entry" &&
    isNumericMapDocumentSafe(store.get("levels").value.levels?.[selection.key]?.map);
}

function isNumericMapEditing() {
  return activeDocument === "numericMap" || isNumericLevelMapSelected();
}

function loadSelectedMap() {
  if (activeDocument === "numericMap") {
    const map = store.get("numericMap").value;
    numericMapCells = map.cells.map(row => row.slice());
    mapVariants = map.variants.map(row => row.slice());
    selectedNumericTileId = numericMapCells[0]?.[0] ?? store.get("numericTiles").value.tiles[0]?.id ?? null;
    elements.mapBox.value = "";
    drawMap();
    return;
  }
  if (activeDocument !== "levels" || selection.kind !== "entry") return;
  const encoded = store.get("levels").value.levels?.[selection.key]?.map || "";
  if (isNumericMapDocumentSafe(encoded)) {
    numericMapCells = encoded.cells.map(row => row.slice());
    mapVariants = encoded.variants.map(row => row.slice());
    selectedNumericTileId = numericMapCells[0]?.[0] ?? (store.has("numericTiles") ? store.get("numericTiles").value.airTileId : null);
    elements.mapBox.value = "";
    drawMap();
    return;
  }
  mapTiles = decodeMap(encoded).tiles;
  mapVariants = decodeMap(encoded).variants;
  elements.mapBox.value = encoded;
  drawMap();
}

function loadMapFromUrl() {
  const encoded = new URLSearchParams(window.location.hash.slice(1)).get("map");
  if (!encoded || activeDocument !== "levels" || selection.kind !== "entry") return;
  if (splitRowsFlexible(encoded).length !== DEFAULT_ROWS) {
    updateStatus("Map in URL has an invalid row count", true);
    return;
  }
  const decoded = decodeMap(encoded);
  mapTiles = decoded.tiles;
  mapVariants = decoded.variants;
  elements.mapBox.value = encoded;
  store.update("levels", value => { value.levels[selection.key].map = encoded; });
  renderNavigation();
  renderWorkspaceMeta();
  runValidation();
  drawMap();
}

function buildMapGrid() {
  elements.grid.replaceChildren();
  cells = [];
  for (let y = 0; y < DEFAULT_ROWS; y++) {
    const row = [];
    for (let x = 0; x < DEFAULT_COLS; x++) {
      const cell = document.createElement("canvas");
      cell.className = "map-cell";
      cell.width = 24;
      cell.height = 24;
      cell.setAttribute("aria-label", `Map cell ${x + 1}, ${y + 1}`);
      cell.addEventListener("contextmenu", event => event.preventDefault());
      cell.addEventListener("pointerdown", event => {
        if (isNumericMapEditing()) {
          if (!numericMapCells || !store.has("numericTiles")) return;
          if (event.button === 2 || event.shiftKey) {
            selectedNumericTileId = numericMapCells[y][x];
            brushVariant = mapVariants[y][x] || "";
            elements.variantBox.value = brushVariant;
            renderTilePalette();
            return;
          }
          numericMapCells[y][x] = selectedNumericTileId;
          mapVariants[y][x] = selectedNumericTileId === store.get("numericTiles").value.airTileId ? null : brushVariant || null;
          drawCell(cell, x, y);
          syncMapToDocument();
          return;
        }
        if (event.button === 2 || event.shiftKey) {
          selectedTile = mapTiles[y][x];
          brushVariant = mapVariants[y][x];
          elements.variantBox.value = brushVariant;
          highlightPalette();
          return;
        }
        mapTiles[y][x] = selectedTile;
        mapVariants[y][x] = selectedTile === "." ? "" : brushVariant;
        drawCell(cell, x, y);
        syncMapToDocument();
      });
      elements.grid.append(cell);
      row.push(cell);
    }
    cells.push(row);
  }
  const mapScroll = document.querySelector(".map-scroll");
  if (mapScroll && typeof ResizeObserver === "function") {
    new ResizeObserver(scheduleMapCellSize).observe(mapScroll);
  }
  window.addEventListener("resize", scheduleMapCellSize);
  scheduleMapCellSize();
}

function scheduleMapCellSize() {
  if (mapCellSizeFrame != null) window.cancelAnimationFrame(mapCellSizeFrame);
  mapCellSizeFrame = window.requestAnimationFrame(() => {
    mapCellSizeFrame = window.requestAnimationFrame(() => {
      mapCellSizeFrame = null;
      updateMapCellSize();
    });
  });
}

function updateMapCellSize() {
  const mapScroll = document.querySelector(".map-scroll");
  if (!mapScroll) return;
  const styles = getComputedStyle(mapScroll);
  const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
  const availableWidth = mapScroll.clientWidth - horizontalPadding;
  if (availableWidth <= 0) return;
  const widthLimitedCellSize = Math.floor((availableWidth - 34) / DEFAULT_COLS);
  const cellSize = Math.max(1, Math.min(24, widthLimitedCellSize));
  elements.grid.style.setProperty("--map-cell-size", `${cellSize}px`);
}

function drawMap() {
  for (let y = 0; y < DEFAULT_ROWS; y++) {
    for (let x = 0; x < DEFAULT_COLS; x++) drawCell(cells[y][x], x, y);
  }
}

function drawCell(cell, x, y) {
  const context = cell.getContext("2d");
  if (isNumericMapEditing() && numericMapCells) {
    const id = numericMapCells[y][x];
    const variant = mapVariants[y][x];
    const image = getNumericTileImage(id, variant);
    context.clearRect(0, 0, 24, 24);
    if (image?.complete && image.naturalWidth) {
      context.drawImage(image, 0, 0, 24, 24);
    } else {
      const airTileId = store.has("numericTiles") ? store.get("numericTiles").value.airTileId : null;
      context.fillStyle = id === airTileId ? "#111615" : "#394d48";
      context.fillRect(0, 0, 24, 24);
      context.fillStyle = "#fff";
      context.font = "8px Bahnschrift, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(id), 12, 12);
    }
    drawVariantLabel(context, variant);
    return;
  }
  const code = mapTiles[y][x] || ".";
  context.clearRect(0, 0, 24, 24);
  const image = tileImages[code];
  if (image?.complete && image.naturalWidth) context.drawImage(image, 0, 0, 24, 24);
  else {
    context.fillStyle = code === "." ? "#111615" : code === "W" ? "#3f9fa5" : code === "L" ? "#e05b43" : code === "P" ? "#394d48" : code === "E" ? "#8dbb58" : "#111615";
    context.fillRect(0, 0, 24, 24);
    context.fillStyle = code === "." ? "#52615b" : "#fff";
    context.font = "12px Bahnschrift, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(code, 12, 12);
  }
  drawVariantLabel(context, mapVariants[y][x]);
}

function drawVariantLabel(context, variant) {
  if (!variant) return;
  context.fillStyle = "rgba(20, 35, 31, .88)";
  context.fillRect(0, 0, Math.min(24, variant.length * 6 + 4), 9);
  context.fillStyle = "#fff";
  context.font = "7px sans-serif";
  context.textAlign = "left";
  context.fillText(variant.slice(0, 4), 2, 7);
}

function loadTileImages() {
  tileImages = {};
  tileArtworkErrors = {};
  const tiles = getLegacyTileDefinitions();
  const registerSvg = (imageKey, svg) => {
    if (typeof svg !== "string" || !svg.trim()) return;
    const sanitized = sanitizeSvgArtwork(svg);
    if (!sanitized.valid) {
      tileArtworkErrors[imageKey] = sanitized.error;
      return;
    }
    const image = new Image();
    image.onload = () => {
      drawMap();
      if (Object.values(tileImages).every(loadedImage => loadedImage.complete)) {
        renderTilePalette();
        if (activeDocument === "tiles" || activeDocument === "numericTiles") renderWorkspace();
      }
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized.source)}`;
    tileImages[imageKey] = image;
  };
  for (const [code, definition] of Object.entries(tiles)) {
    if (typeof definition?.svg === "string") registerSvg(code, definition.svg);
    for (const bucket of VARIANT_BUCKETS) {
      for (const [variantKey, variantDefinition] of Object.entries(definition?.[bucket] || {})) {
        if (typeof variantDefinition?.svg === "string") {
          registerSvg(`${code}:${bucket}:${variantKey}`, variantDefinition.svg);
        }
      }
    }
  }
  if (store.has("numericTiles")) {
    for (const tile of store.get("numericTiles").value.tiles) {
      if (typeof tile.definition?.svg === "string") registerSvg(String(tile.id), tile.definition.svg);
      for (const bucket of VARIANT_BUCKETS) {
        const groups = [tile.definition?.[bucket], tile.definition?.variants?.[bucket]];
        for (const group of groups) {
          for (const [variantKey, variant] of Object.entries(group || {})) {
            if (typeof variant?.svg === "string") registerSvg(`${tile.id}:${bucket}:${variantKey}`, variant.svg);
          }
        }
      }
    }
  }
  renderTilePalette();
  if (activeDocument === "tiles" || activeDocument === "numericTiles") renderWorkspace();
}

function renderTilePalette() {
  elements.tilePalette.replaceChildren();
  if (isNumericMapEditing() && store.has("numericTiles")) {
    for (const tile of store.get("numericTiles").value.tiles) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `palette-tile${tile.id === selectedNumericTileId ? " is-selected" : ""}`;
      button.title = `${tile.name} (ID ${tile.id})`;
      button.setAttribute("aria-label", `Select ${tile.name}, ID ${tile.id}`);
      const image = tileImages[String(tile.id)];
      if (image?.complete && image.naturalWidth) {
        const icon = document.createElement("img");
        icon.src = image.src;
        icon.alt = "";
        button.append(icon);
      } else {
        button.textContent = String(tile.id);
      }
      button.addEventListener("click", () => {
        selectedNumericTileId = tile.id;
        renderTilePalette();
      });
      elements.tilePalette.append(button);
    }
    return;
  }
  for (const [code, definition] of Object.entries(getLegacyTileDefinitions())) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `palette-tile${code === selectedTile ? " is-selected" : ""}`;
    button.title = code;
    button.setAttribute("aria-label", `Select tile ${code}`);
    const image = tileImages[code];
    if (image?.complete && image.naturalWidth) {
      const icon = document.createElement("img");
      icon.src = image.src;
      icon.alt = "";
      button.append(icon);
    } else {
      button.textContent = code;
    }
    button.addEventListener("click", () => {
      selectedTile = code;
      renderTilePalette();
    });
    elements.tilePalette.append(button);
  }
}

function getNumericTileImage(id, variantKey = null) {
  if (id == null || !store.has("numericTiles")) return null;
  const registry = store.get("numericTiles").value;
  const tile = registry.tiles.find(item => item.id === id);
  if (!tile) return null;
  if (variantKey) {
    for (const bucket of VARIANT_BUCKETS) {
      const entry = tile.definition?.[bucket]?.[variantKey] || tile.definition?.variants?.[bucket]?.[variantKey];
      if (entry) return tileImages[`${id}:${bucket}:${variantKey}`] || tileImages[String(id)];
    }
  }
  return tileImages[String(id)];
}

function highlightPalette() {
  for (const button of elements.tilePalette.querySelectorAll(".palette-tile")) {
    button.classList.toggle("is-selected", button.title === selectedTile);
  }
}

function syncMapToDocument() {
  if (activeDocument === "numericMap") {
    store.update("numericMap", value => {
      value.cells = numericMapCells.map(row => row.slice());
      value.variants = mapVariants.map(row => row.slice());
    });
    renderNavigation();
    renderWorkspaceMeta();
    runValidation();
    return;
  }
  if (activeDocument !== "levels" || selection.kind !== "entry") return;
  const currentMap = store.get("levels").value.levels?.[selection.key]?.map;
  if (isNumericMapDocumentSafe(currentMap)) {
    store.update("levels", value => {
      const map = value.levels[selection.key].map;
      map.cells = numericMapCells.map(row => row.slice());
      map.variants = mapVariants.map(row => row.slice());
    });
    renderNavigation();
    renderWorkspaceMeta();
    runValidation();
    return;
  }
  const encoded = encodeMap(mapTiles, mapVariants);
  elements.mapBox.value = encoded;
  store.update("levels", value => { value.levels[selection.key].map = encoded; });
  renderNavigation();
  renderWorkspaceMeta();
  runValidation();
}

function loadMapFromText() {
  const encoded = elements.mapBox.value.trim();
  const rows = splitRowsFlexible(encoded);
  if (rows.length !== DEFAULT_ROWS) {
    updateStatus(`Map requires ${DEFAULT_ROWS} rows`, true);
    return;
  }
  if (activeDocument === "numericMap") {
    const normalized = normalizeTileDefinitions(store.get("numericTiles").value);
    const converted = decodeMapToNumeric(encoded, normalized);
    numericMapCells = converted.cells;
    mapVariants = converted.variants;
    store.update("numericMap", value => {
      value.cells = numericMapCells.map(row => row.slice());
      value.variants = mapVariants.map(row => row.slice());
      if (converted.spawn) value.spawn = converted.spawn;
    });
    drawMap();
    renderWorkspaceMeta();
    runValidation();
    return;
  }
  mapTiles = decodeMap(encoded).tiles;
  mapVariants = decodeMap(encoded).variants;
  syncMapToDocument();
  drawMap();
}

function clearMap() {
  if (isNumericMapEditing()) {
    if (!store.has("numericTiles")) return updateStatus("A numeric tile registry is required to edit this map", true);
    const airTileId = store.get("numericTiles").value.airTileId;
    numericMapCells = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(airTileId));
    mapVariants = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(null));
    syncMapToDocument();
    drawMap();
    return;
  }
  mapTiles = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill("."));
  mapVariants = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(""));
  syncMapToDocument();
  drawMap();
}

function generateCave() {
  if (isNumericMapEditing()) {
    if (!store.has("numericTiles")) return updateStatus("A numeric tile registry is required to generate this map", true);
    const registry = store.get("numericTiles").value;
    const floorTile = registry.tiles.find(tile => tile.id !== registry.airTileId && tile.definition?.solid === true);
    if (!floorTile) return updateStatus("Numeric registry has no solid tile for cave walls", true);
    numericMapCells = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(registry.airTileId));
    mapVariants = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(null));
    let top = 2;
    let bottom = DEFAULT_ROWS - 3;
    for (let x = 0; x < DEFAULT_COLS; x++) {
      const roll = Math.random();
      if (roll < 0.05 && top > 1) top--;
      else if (roll < 0.1 && top < DEFAULT_ROWS - 5) top++;
      if (roll < 0.15 && bottom > top + 5) bottom--;
      else if (roll < 0.25 && bottom < DEFAULT_ROWS - 1) bottom++;
      for (let y = 0; y < top; y++) numericMapCells[y][x] = floorTile.id;
      for (let y = bottom; y < DEFAULT_ROWS; y++) numericMapCells[y][x] = floorTile.id;
    }
    syncMapToDocument();
    drawMap();
    return;
  }
  mapTiles = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill("."));
  mapVariants = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(""));
  let top = 2;
  let bottom = DEFAULT_ROWS - 3;
  for (let x = 0; x < DEFAULT_COLS; x++) {
    const roll = Math.random();
    if (roll < 0.05 && top > 1) top--;
    else if (roll < 0.1 && top < DEFAULT_ROWS - 5) top++;
    if (roll < 0.15 && bottom > top + 5) bottom--;
    else if (roll < 0.25 && bottom < DEFAULT_ROWS - 1) bottom++;
    for (let y = 0; y < top; y++) mapTiles[y][x] = "P";
    for (let y = bottom; y < DEFAULT_ROWS; y++) mapTiles[y][x] = "P";
  }
  syncMapToDocument();
  drawMap();
}

function openNumericDocumentDialog() {
  document.getElementById("numericDocumentDialog").showModal();
  const hasRegistry = store.has("numericTiles");
  const hasMap = store.has("numericMap");
  document.getElementById("createNumericRegistry").disabled = hasRegistry;
  document.getElementById("convertNumericRegistry").disabled = hasRegistry;
  document.getElementById("createNumericRegistry").hidden = hasRegistry;
  document.getElementById("convertNumericRegistry").hidden = hasRegistry;
  document.getElementById("createNumericMap").disabled = !hasRegistry || hasMap;
  document.getElementById("convertNumericMap").disabled = !hasRegistry || hasMap || activeDocument !== "levels" || selection.kind !== "entry";
}

function activateNumericDocument(id) {
  activeDocument = id;
  selectDefaultEntryForDocument();
  renderNavigation();
  renderWorkspace();
  renderTilePalette();
  renderInspector();
  runValidation();
}

function createBlankNumericRegistry() {
  if (store.has("numericTiles")) return updateStatus("A numeric registry is already loaded", true);
  store.create("numericTiles", createEmptyNumericTileRegistry(), { sourceName: "New numeric registry" });
  document.getElementById("numericDocumentDialog").close();
  loadTileImages();
  activateNumericDocument("numericTiles");
  updateStatus("New numeric registry created; save or export it as a separate file");
}

function convertLegacyRegistry() {
  if (store.has("numericTiles")) return updateStatus("A numeric registry is already loaded", true);
  try {
    const numeric = migrateLegacyTileDefinitions(getLegacyTileDefinitions());
    store.create("numericTiles", numeric, { sourceName: "Converted copy of tiles2.json" });
    document.getElementById("numericDocumentDialog").close();
    loadTileImages();
    activateNumericDocument("numericTiles");
    updateStatus("Numeric copy created; the original tiles2.json remains unchanged");
  } catch (error) {
    updateStatus(error.message, true);
  }
}

function createBlankNumericMap() {
  if (!store.has("numericTiles")) return updateStatus("Create or copy a numeric registry first", true);
  if (store.has("numericMap")) return updateStatus("A numeric map is already loaded; export it before starting another", true);
  const registry = store.get("numericTiles").value;
  const airTileId = registry.airTileId;
  if (airTileId == null) return updateStatus("Set the numeric registry air tile role first", true);
  const cells = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(airTileId));
  const variants = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(null));
  const spawn = {
    x: Math.min(1, DEFAULT_COLS - 1),
    y: Math.min(1, DEFAULT_ROWS - 1),
    ...(registry.playerArtTileId == null ? {} : { artTileId: registry.playerArtTileId })
  };
  store.create("numericMap", createNumericMap({ name: "Untitled numeric map", width: DEFAULT_COLS, height: DEFAULT_ROWS, cells, variants, spawn }), { sourceName: "New numeric map" });
  document.getElementById("numericDocumentDialog").close();
  activateNumericDocument("numericMap");
  updateStatus("Numeric map created; save or export it as a separate file");
}

function convertSelectedLegacyMap() {
  if (!store.has("numericTiles")) return updateStatus("Create or copy a numeric registry first", true);
  if (store.has("numericMap")) return updateStatus("A numeric map is already loaded; export it before converting another", true);
  if (activeDocument !== "levels" || selection.kind !== "entry") return updateStatus("Select a level map to convert", true);
  const level = store.get("levels").value.levels[selection.key];
  try {
    const registry = normalizeTileDefinitions(store.get("numericTiles").value);
    const converted = decodeMapToNumeric(level.map, registry);
    const map = createNumericMap({ ...converted, name: level.name || selection.key, sourceLevel: selection.key });
    store.create("numericMap", map, { sourceName: `Converted map from ${selection.key}` });
    document.getElementById("numericDocumentDialog").close();
    activateNumericDocument("numericMap");
    updateStatus("Numeric map copy created; the original levels.json remains unchanged");
  } catch (error) {
    updateStatus(error.message, true);
  }
}

async function openDocuments() {
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: "Runner content JSON", accept: { "application/json": [".json"] } }]
      });
      const files = await Promise.all(handles.map(handle => handle.getFile()));
      await importFiles(files, handles);
    } catch (error) {
      if (error.name !== "AbortError") updateStatus(error.message, true);
    }
  } else {
    elements.fileInput.click();
  }
}

async function importFiles(files, handles = []) {
  let importedTiles = false;
  for (const [index, file] of files.entries()) {
    try {
      const text = await file.text();
      const value = parseJsonDocument(text);
      const id = identifyDocument(value);
      const existing = store.has(id) ? store.get(id) : null;
      if (existing?.dirty && !window.confirm(`Discard unsaved changes to ${existing.label}?`)) continue;
      if (existing) store.replace(id, value, { sourceName: file.name, fileHandle: handles[index] || null });
      else store.create(id, value, { sourceName: file.name, fileHandle: handles[index] || null });
      if (id === "tiles") importedTiles = true;
      activeDocument = id;
      selectDefaultEntryForDocument();
    } catch (error) {
      updateStatus(`${file.name}: ${error.message}`, true);
    }
  }
  if (importedTiles) loadTileImages();
  renderNavigation();
  renderWorkspace();
  renderInspector();
  runValidation();
}

async function saveActiveDocument() {
  const record = store.get(activeDocument);
  if (!record.dirty) {
    updateStatus(`${record.label} has no unsaved changes`);
    return;
  }
  const issues = runValidation();
  const errors = issues.filter(item => item.severity === "error").length;
  const warnings = issues.filter(item => item.severity === "warning").length;
  if (errors) {
    updateStatus(`Save blocked by ${errors} validation error${errors === 1 ? "" : "s"}`, true);
    return;
  }
  if (warnings && !window.confirm(`There are ${warnings} validation warning${warnings === 1 ? "" : "s"}. Save anyway?`)) return;
  try {
    let handle = record.fileHandle;
    if (!handle && typeof window.showSaveFilePicker === "function") {
      handle = await window.showSaveFilePicker({
        suggestedName: record.fileName,
        types: [{ description: "JSON document", accept: { "application/json": [".json"] } }]
      });
    }
    if (handle) {
      try {
        await writeThroughHandle(handle, store.serialize(activeDocument));
        store.markSaved(activeDocument, { sourceName: handle.name, fileHandle: handle });
      } catch (error) {
        if (error.name === "AbortError") throw error;
        const fallbackName = downloadedCopyName(handle.name || record.fileName);
        downloadText(fallbackName, store.serialize(activeDocument));
        store.clearFileHandle(activeDocument);
        renderNavigation();
        renderWorkspaceMeta();
        updateStatus(`Could not overwrite ${handle.name || record.fileName}; downloaded ${fallbackName}. The original was not overwritten.`);
        return;
      }
    } else {
      downloadText(uniqueDownloadName(activeDocument), store.serialize(activeDocument));
      store.markSaved(activeDocument);
    }
    renderNavigation();
    renderWorkspaceMeta();
    updateStatus(`${record.label} saved`);
  } catch (error) {
    if (error.name !== "AbortError") updateStatus(error.message, true);
  }
}

async function writeThroughHandle(handle, content) {
  if (typeof handle.queryPermission === "function") {
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission === "prompt" && typeof handle.requestPermission === "function") {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    if (permission === "denied") throw new Error("Write permission was denied for the selected file.");
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
    await writable.close();
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
}

async function exportActiveDocument() {
  const record = store.get(activeDocument);
  try {
    if (typeof window.showSaveFilePicker === "function") {
      const handle = await window.showSaveFilePicker({
        suggestedName: createExportName(activeDocument),
        types: [{ description: "JSON export", accept: { "application/json": [".json"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(store.serialize(activeDocument));
      await writable.close();
    } else {
      downloadText(`${createExportName(activeDocument).replace(".json", `-${Date.now()}.json`)}`, store.serialize(activeDocument));
    }
    updateStatus(`${record.label} exported`);
  } catch (error) {
    if (error.name !== "AbortError") updateStatus(error.message, true);
  }
}

function downloadText(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function uniqueDownloadName(id) {
  return createExportName(id).replace(".json", `-${Date.now()}.json`);
}

function downloadedCopyName(targetName) {
  const fileName = String(targetName).split(/[\\/]/).pop() || "runner-content.json";
  const baseName = fileName.toLowerCase().endsWith(".json") ? fileName.slice(0, -5) : fileName;
  return `${baseName}-download-${Date.now()}.json`;
}

function previewSelectedLevel() {
  if (activeDocument === "numericMap") {
    const map = store.get("numericMap").value;
    window.open(`index.html#mapv=1&map=${encodeURIComponent(JSON.stringify(map))}`, "_blank", "noopener");
    return;
  }
  if (activeDocument !== "levels" || selection.kind !== "entry") return;
  const map = store.get("levels").value.levels[selection.key]?.map;
  if (!map) return updateStatus("Selected level has no map", true);
  if (isNumericMapDocumentSafe(map)) {
    window.open(`index.html#mapv=1&map=${encodeURIComponent(JSON.stringify(map))}`, "_blank", "noopener");
  } else {
    window.open(`index.html#map=${encodeURIComponent(map)}`, "_blank", "noopener");
  }
}

function runValidation() {
  if (!store.documents.size) return [];
  validationIssues = validateContentDocuments({
    levels: store.get("levels").value,
    tiles: getLegacyTileDefinitions(),
    numericTiles: store.has("numericTiles") ? store.get("numericTiles").value : null,
    narrative: store.get("narrative").value,
    achievements: store.get("achievements").value
  });
  if (store.has("tiles")) collectSvgValidationIssues(store.get("tiles").value, "tiles", validationIssues);
  if (store.has("numericTiles")) collectSvgValidationIssues(store.get("numericTiles").value, "numericTiles", validationIssues);
  if (store.has("numericMap")) {
    if (store.has("numericTiles")) {
      validationIssues.push(...validateMap(store.get("numericMap").value, store.get("numericTiles").value, {}, "numericMap"));
    } else {
      validationIssues.push({ severity: "error", path: "numericMap", message: "A numeric tile registry is required to validate this map." });
    }
  }
  renderValidation();
  return validationIssues;
}

function collectSvgValidationIssues(value, path, issues) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && typeof value.svg === "string" && value.svg.trim()) {
    const result = sanitizeSvgArtwork(value.svg);
    if (!result.valid) issues.push({ severity: "error", path: `${path}.svg`, message: result.error });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "svg") continue;
    collectSvgValidationIssues(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, issues);
  }
}

function renderValidation() {
  const errors = validationIssues.filter(item => item.severity === "error").length;
  const warnings = validationIssues.filter(item => item.severity === "warning").length;
  elements.validationSummary.textContent = `${errors} errors / ${warnings} warnings`;
  elements.validationSummary.dataset.state = errors ? "error" : warnings ? "warning" : "valid";
  elements.validationList.replaceChildren();
  if (!validationIssues.length) {
    const clear = document.createElement("p");
    clear.className = "validation-clear";
    clear.textContent = "All loaded content passes validation.";
    elements.validationList.append(clear);
    return;
  }
  for (const item of validationIssues) {
    const row = document.createElement("div");
    row.className = `validation-item is-${item.severity}`;
    const severity = document.createElement("strong");
    severity.textContent = item.severity;
    const path = document.createElement("code");
    path.textContent = item.path;
    const message = document.createElement("span");
    message.textContent = item.message;
    row.append(severity, path, message);
    elements.validationList.append(row);
  }
}

function renderWorkspaceMeta() {
  const record = store.get(activeDocument);
  elements.workspaceMeta.textContent = `${record.sourceName}${record.dirty ? " - unsaved changes" : ""}`;
}

function updateStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.dataset.state = isError ? "error" : "ready";
  elements.dirtyStatus.textContent = [...store.documents.values()].some(record => record.dirty) ? "Unsaved changes" : "All changes saved";
}

function sanitizeBrushVariant(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 12);
}
