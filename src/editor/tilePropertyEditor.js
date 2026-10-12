import {
  TILE_PROPERTY_CATEGORIES,
  TILE_EDITOR_CATEGORIES,
  TILE_CAPABILITY_GROUPS,
  TILE_PROPERTY_DEFINITIONS,
  getTilePropertyInitialValue,
  getTilePropertyStatusLabel
} from "../tileProperties.js";
import { renderJsonEditor } from "./fieldEditor.js";
import { VARIANT_BUCKETS } from "../shared/variants.js";

const supportedNames = Object.keys(TILE_PROPERTY_DEFINITIONS);
const variantBucketNames = new Set([...VARIANT_BUCKETS, "variants"]);

export function renderTilePropertyEditor(container, {
  value,
  tileId = null,
  name = "",
  category = "",
  baseDefinition = value || {},
  isVariant = false,
  variant = null,
  variants = [],
  copySources = [],
  onChange,
  onNameChange = () => {},
  onCategoryChange = () => {},
  onSelectVariant = () => {},
  suggestions = {}
} = {}) {
  let definition = cloneJson(value || {});
  const base = cloneJson(baseDefinition || {});
  const copyPreviewUpdaters = [];
  const commit = (next, rerender) => {
    definition = cloneJson(next);
    for (const updatePreview of copyPreviewUpdaters) updatePreview();
    onChange(cloneJson(definition), { refresh: Boolean(rerender) });
    for (const row of container.querySelectorAll(".tile-property-row.is-default")) {
      const value = row.querySelector(".tile-property-effective-default");
      const propertyName = row.dataset.property;
      const metadata = TILE_PROPERTY_DEFINITIONS[propertyName];
      if (value && metadata) value.textContent = `Runtime default: ${effectiveDefault(propertyName, metadata, base, definition)}`;
    }
  };
  container.replaceChildren();

  const identity = section("Identity");
  if (tileId != null) {
    const id = document.createElement("div");
    id.className = "tile-identity-id";
    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = "Stable numeric ID";
    const valueLabel = document.createElement("strong");
    valueLabel.textContent = String(tileId);
    id.append(label, valueLabel);
    identity.append(id);
  }
  if (!isVariant) {
    identity.append(textField("Tile name", name, onNameChange));
    const categoryField = document.createElement("label");
    categoryField.className = "field-row";
    const caption = document.createElement("span");
    caption.className = "field-label";
    caption.textContent = "Editor category";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Editor category");
    select.append(new Option("Uncategorized", ""));
    for (const choice of TILE_EDITOR_CATEGORIES) select.append(new Option(choice, choice));
    select.value = TILE_EDITOR_CATEGORIES.includes(category) ? category : "";
    select.addEventListener("change", () => onCategoryChange(select.value));
    const help = document.createElement("small");
    help.className = "tile-editor-only-help";
    help.textContent = "For authoring and navigation only; it does not change gameplay.";
    categoryField.append(caption, select, help);
    identity.append(categoryField);
  } else {
    const variantIdentity = document.createElement("p");
    variantIdentity.className = "tile-editor-only-help";
    variantIdentity.textContent = `Editing ${variant.bucket} variant "${variant.key}" on tile ${tileId}.`;
    identity.append(variantIdentity);
  }
  container.append(identity);

  const appearance = section("Appearance");
  renderPropertyRow(appearance, "svg", { variant: isVariant, base });
  container.append(appearance);

  const capabilities = section("Capabilities");
  const sourceChoices = copySources.filter(tile => tile.id !== tileId);
  for (const capability of TILE_CAPABILITY_GROUPS) {
    const group = document.createElement("section");
    group.className = "tile-capability-group";
    const heading = document.createElement("div");
    heading.className = "tile-capability-heading";
    const label = document.createElement("h4");
    label.textContent = capability.label;
    heading.append(label);
    let copyPreview = null;
    if (sourceChoices.length && capability.id !== "collision") {
      const copyControls = document.createElement("div");
      copyControls.className = "tile-capability-copy";
      const select = document.createElement("select");
      select.setAttribute("aria-label", `Copy ${capability.label} from tile`);
      select.append(new Option("Choose source tile", ""));
      for (const tile of sourceChoices) select.append(new Option(`${tile.name} (ID ${tile.id})`, String(tile.id)));
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "quiet-button";
      copy.textContent = "Copy settings";
      copy.disabled = true;
      copyPreview = document.createElement("div");
      copyPreview.className = "tile-capability-copy-preview";
      copyPreview.hidden = true;
      copyPreview.setAttribute("aria-live", "polite");
      const copyCapabilitySettings = source => {
        const next = cloneJson(definition);
        for (const propertyName of capability.properties) {
          if (Object.hasOwn(source.definition || {}, propertyName)) next[propertyName] = cloneJson(source.definition[propertyName]);
          else delete next[propertyName];
        }
        return next;
      };
      const renderCopyPreview = () => {
        const source = sourceChoices.find(tile => tile.id === Number(select.value));
        copy.disabled = !source;
        copyPreview.replaceChildren();
        copyPreview.hidden = !source;
        if (!source) return;
        const proposed = copyCapabilitySettings(source);
        const title = document.createElement("strong");
        title.textContent = `Copying ${capability.label} from ${source.name} into ${name || `Tile ${tileId}`}`;
        const changes = document.createElement("ul");
        for (const propertyName of capability.properties) {
          const item = document.createElement("li");
          item.textContent = `${propertyLabel(propertyName)}: ${describePropertyState(propertyName, definition, isVariant, base)} -> ${describePropertyState(propertyName, proposed, isVariant, base)}`;
          changes.append(item);
        }
        copyPreview.append(title, changes);
      };
      copyPreviewUpdaters.push(renderCopyPreview);
      select.addEventListener("change", renderCopyPreview);
      copy.addEventListener("click", () => {
        const source = sourceChoices.find(tile => tile.id === Number(select.value));
        if (!source) return;
        commit(copyCapabilitySettings(source), true);
      });
      copyControls.append(select, copy);
      heading.append(copyControls);
    }
    group.append(heading);
    if (copyPreview) group.append(copyPreview);
    if (sourceChoices.length && capability.id !== "collision") {
      const copyHelp = document.createElement("p");
      copyHelp.className = "tile-editor-only-help";
      copyHelp.textContent = "Preview the proposed changes before applying. Only this capability is copied; missing source values clear the target override, returning base tiles to runtime defaults and variants to inherited values.";
      group.append(copyHelp);
    }
    for (const propertyName of capability.properties) {
      renderPropertyRow(group, propertyName, { variant: isVariant, base });
    }
    capabilities.append(group);
  }
  renderAddProperty(capabilities, () => definition, (next, options) => commit(next, options?.refresh), () => advanced);
  container.append(capabilities);

  const variantSection = section("Variants");
  if (isVariant) renderVariantInheritance(variantSection, definition, base, variant);
  if (variants.length) {
    const list = document.createElement("div");
    list.className = "tile-variant-list";
    for (const entry of variants) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile-variant-link";
      button.textContent = `${entry.bucket} / ${entry.key}${entry.hasArtwork ? " · artwork" : " · no artwork"}`;
      button.setAttribute("aria-label", `Edit ${entry.bucket} variant ${entry.key}`);
      button.addEventListener("click", () => onSelectVariant(entry));
      list.append(button);
    }
    variantSection.append(list);
  } else if (!isVariant) {
    const empty = document.createElement("p");
    empty.className = "tile-editor-only-help";
    empty.textContent = "No variants are defined for this tile.";
    variantSection.append(empty);
  }
  container.append(variantSection);

  const advanced = section("Advanced");
  const advancedProperties = Object.fromEntries(Object.entries(definition).filter(([key]) => !supportedNames.includes(key)));
  const custom = document.createElement("details");
  custom.className = "tile-custom-properties";
  custom.open = false;
  const summary = document.createElement("summary");
  summary.textContent = `Advanced and custom JSON (${Object.keys(advancedProperties).length})`;
  custom.append(summary);
  const customEditor = document.createElement("div");
  customEditor.className = "tile-custom-editor";
  renderJsonEditor(customEditor, {
    value: advancedProperties,
    suggestions,
    onChange: (nextCustom, rerender) => {
      const next = Object.fromEntries(Object.entries(definition).filter(([key]) => supportedNames.includes(key)));
      Object.assign(next, nextCustom);
      commit(next, rerender);
    }
  });
  custom.append(customEditor);
  advanced.append(custom);
  container.append(advanced);

  function section(label) {
    const element = document.createElement("details");
    element.className = "tile-builder-section";
    element.open = false;
    const summary = document.createElement("summary");
    summary.textContent = label;
    element.append(summary);
    return element;
  }

  function renderVariantInheritance(parent, variantDefinition, baseDefinition, variantInfo) {
    const details = document.createElement("div");
    details.className = "tile-inheritance";
    const heading = document.createElement("strong");
    heading.textContent = `Variant ${variantInfo.key} · ${variantInfo.bucket}`;
    const overrides = Object.keys(variantDefinition).filter(key => !variantBucketNames.has(key));
    const explicit = document.createElement("p");
    explicit.textContent = overrides.length ? `Explicit overrides: ${overrides.join(", ")}` : "No explicit property overrides.";
    const inherited = Object.entries(baseDefinition).filter(([key]) => !Object.hasOwn(variantDefinition, key) && !variantBucketNames.has(key));
    const inheritedList = document.createElement("div");
    inheritedList.className = "tile-inherited-list";
    for (const [key, value] of inherited) {
      const row = document.createElement("div");
      const property = document.createElement("code");
      property.textContent = key;
      const summary = document.createElement("span");
      summary.textContent = ` inherited: ${formatValue(value)}`;
      row.append(property, summary);
      inheritedList.append(row);
    }
    details.append(heading, explicit, inheritedList);
    parent.append(details);
  }

  function renderPropertyRow(parent, propertyName, { variant: variantMode = false, base: baseDefinition = {} } = {}) {
    const metadata = TILE_PROPERTY_DEFINITIONS[propertyName];
    const explicit = Object.hasOwn(definition, propertyName);
    const inherited = variantMode && !explicit && Object.hasOwn(baseDefinition, propertyName);
    const currentValue = explicit ? definition[propertyName] : inherited ? baseDefinition[propertyName] : null;
    const row = document.createElement("section");
    row.className = `tile-property-row${inherited ? " is-inherited" : ""}${!explicit && !inherited ? " is-default" : ""}`;
    row.dataset.property = propertyName;
    const head = document.createElement("div");
    head.className = "tile-property-head";
    const title = document.createElement("strong");
    title.textContent = propertyLabel(propertyName);
    const status = document.createElement("span");
    status.className = `tile-property-status status-${metadata.status} state-${explicit ? "explicit" : inherited ? "inherited" : "default"}`;
    status.textContent = explicit ? "Explicit override" : inherited ? "Inherited from base tile" : "Runtime default (not stored)";
    head.append(title, status);
    const description = document.createElement("p");
    description.className = "tile-property-description";
    description.textContent = `${metadata.description} Runtime fallback: ${metadata.runtimeDefault}`;
    row.append(head, description);

    if (explicit) {
      renderPropertyControl(row, propertyName, definition[propertyName]);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "quiet-button tile-property-remove";
      remove.textContent = "Remove override";
      remove.setAttribute("aria-label", `Remove ${propertyLabel(propertyName)} override`);
      remove.addEventListener("click", () => {
        const next = cloneJson(definition);
        delete next[propertyName];
        commit(next, true);
      });
      row.append(remove);
    } else {
      const preview = document.createElement("div");
      preview.className = "tile-property-effective-default";
      preview.textContent = inherited
        ? `Inherited value: ${formatValue(currentValue)}`
        : `Runtime default: ${effectiveDefault(propertyName, metadata, baseDefinition, definition)}`;
      row.append(preview);
      const add = document.createElement("button");
      add.type = "button";
      add.className = "quiet-button";
      add.textContent = inherited ? "Override inherited value" : "Add override";
      add.setAttribute("aria-label", `${inherited ? "Override" : "Add"} ${propertyLabel(propertyName)}`);
      add.addEventListener("click", () => {
        const next = cloneJson(definition);
        next[propertyName] = cloneJson(inherited ? currentValue : getTilePropertyInitialValue(propertyName, { ...baseDefinition, ...definition }));
        commit(next, true);
      });
      row.append(add);
    }
    parent.append(row);
  }

  function renderPropertyControl(parent, propertyName, currentValue) {
    const metadata = TILE_PROPERTY_DEFINITIONS[propertyName];
    const update = (nextValue, rerender = false) => {
      const next = cloneJson(definition);
      next[propertyName] = cloneJson(nextValue);
      commit(next, rerender);
    };
    if (propertyName === "svg") {
      const upload = document.createElement("label");
      upload.className = "field-row artwork-upload";
      const caption = document.createElement("span");
      caption.className = "field-label";
      caption.textContent = "Import SVG file";
      const file = document.createElement("input");
      file.type = "file";
      file.accept = ".svg,image/svg+xml";
      file.setAttribute("aria-label", "Import SVG file");
      file.addEventListener("change", async () => {
        if (!file.files?.[0]) return;
        const source = await file.files[0].text();
        update(source);
        const editor = parent.querySelector(".tile-svg-source");
        if (editor) editor.value = source;
        file.value = "";
      });
      upload.append(caption, file);
      parent.append(upload);
    }
    if (metadata.type === "boolean") {
      const control = document.createElement("input");
      control.type = "checkbox";
      control.checked = Boolean(currentValue);
      control.setAttribute("aria-label", propertyLabel(propertyName));
      control.addEventListener("change", () => update(control.checked));
      parent.append(control);
    } else if (metadata.type === "number") {
      const control = document.createElement("input");
      control.type = "number";
      control.step = "any";
      control.value = currentValue == null ? "" : String(currentValue);
      control.setAttribute("aria-label", propertyLabel(propertyName));
      control.addEventListener("change", () => {
        if (control.value !== "" && Number.isFinite(Number(control.value))) update(Number(control.value));
      });
      parent.append(control);
    } else if (metadata.type === "enum") {
      const control = document.createElement("select");
      control.setAttribute("aria-label", propertyLabel(propertyName));
      const choices = [...new Set([...(currentValue == null ? [] : [String(currentValue)]), ...(metadata.choices || [])])];
      for (const choice of choices) control.append(new Option(choice, choice));
      control.value = currentValue == null ? "" : String(currentValue);
      control.addEventListener("change", () => update(control.value));
      parent.append(control);
    } else if (["text", "multiline", "svg"].includes(metadata.type) &&
      !(currentValue && typeof currentValue === "object" && !Array.isArray(currentValue))) {
      const control = metadata.type === "multiline" || metadata.type === "svg"
        ? document.createElement("textarea")
        : document.createElement("input");
      if (control instanceof HTMLInputElement) control.type = "text";
      control.value = typeof currentValue === "string" ? currentValue : "";
      control.setAttribute("aria-label", propertyLabel(propertyName));
      if (propertyName === "svg") control.classList.add("field-code", "tile-svg-source");
      control.addEventListener("input", () => update(control.value));
      parent.append(control);
      if (propertyName === "autoPush") attachSuggestions(control, suggestions.tileCodes || []);
      if (["hint", "signMessage", "signHtml"].includes(propertyName) && typeof currentValue === "string") {
        const convert = document.createElement("button");
        convert.type = "button";
        convert.className = "quiet-button";
        convert.textContent = "Use variant-specific text";
        convert.addEventListener("click", () => update({ default: currentValue }, true));
        parent.append(convert);
      }
    } else {
      const editor = document.createElement("div");
      editor.className = "tile-nested-editor";
      renderJsonEditor(editor, {
        value: currentValue,
        rootLabel: propertyName,
        suggestions,
        onChange: (nextValue, rerender) => update(nextValue, rerender)
      });
      parent.append(editor);
    }
  }
}

function renderAddProperty(container, getDefinition, onChange, getAdvancedSection) {
  const details = document.createElement("details");
  details.className = "tile-add-property";
  const summary = document.createElement("summary");
  summary.textContent = "Add Property";
  details.append(summary);
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search properties";
  search.setAttribute("aria-label", "Search supported properties");
  const list = document.createElement("div");
  list.className = "tile-property-options";
  details.append(search, list);

  const renderOptions = () => {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const definition = getDefinition();
    for (const category of TILE_PROPERTY_CATEGORIES) {
      const names = supportedNames.filter(name => {
        const metadata = TILE_PROPERTY_DEFINITIONS[name];
        return metadata.category === category.id &&
          (!query || `${name} ${metadata.description}`.toLowerCase().includes(query));
      });
      if (!names.length) continue;
      const group = document.createElement("section");
      const heading = document.createElement("h4");
      heading.textContent = category.label;
      group.append(heading);
      for (const name of names) {
        const metadata = TILE_PROPERTY_DEFINITIONS[name];
        const option = document.createElement("button");
        option.type = "button";
        option.className = "tile-property-option";
        option.dataset.propertyName = name;
        option.disabled = Object.hasOwn(definition, name);
        const label = document.createElement("strong");
        label.textContent = propertyLabel(name);
        const type = document.createElement("small");
        type.textContent = `${metadata.type} · ${option.disabled ? "Already present" : getTilePropertyStatusLabel(metadata.status)}`;
        const description = document.createElement("span");
        description.textContent = metadata.description;
        option.append(label, type, description);
        option.addEventListener("click", () => {
          const currentDefinition = getDefinition();
          const next = cloneJson(currentDefinition);
          next[name] = getTilePropertyInitialValue(name, currentDefinition);
          onChange(next, { refresh: true });
          details.open = false;
        });
        group.append(option);
      }
      list.append(group);
    }
    const addCustom = document.createElement("button");
    addCustom.type = "button";
    addCustom.className = "quiet-button";
    addCustom.textContent = "Add custom JSON property";
    addCustom.addEventListener("click", () => {
      details.open = false;
      const advanced = getAdvancedSection?.();
      if (advanced) advanced.open = true;
      const custom = advanced?.querySelector(".tile-custom-properties");
      if (custom) custom.open = true;
      advanced?.querySelector(".tile-custom-properties .quiet-button")?.click();
    });
    list.append(addCustom);
  };

  search.addEventListener("input", renderOptions);
  renderOptions();
  container.append(details);
}

function humanize(value) {
  return String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, char => char.toUpperCase());
}

function propertyLabel(name) {
  return TILE_PROPERTY_DEFINITIONS[name]?.label || humanize(name);
}

function describePropertyState(name, value, variantMode, baseDefinition) {
  if (Object.hasOwn(value, name)) return `Explicit: ${formatValue(value[name])}`;
  if (variantMode && Object.hasOwn(baseDefinition, name)) return `Inherited: ${formatValue(baseDefinition[name])}`;
  return `Runtime default: ${effectiveDefault(name, TILE_PROPERTY_DEFINITIONS[name], baseDefinition, value)}`;
}

function effectiveDefault(name, metadata, baseDefinition, definition) {
  if (["moveCostTop", "moveCostInside", "insideMoveCost", "fallDamageCancel"].includes(name)) {
    return formatValue(getTilePropertyInitialValue(name, { ...baseDefinition, ...definition }));
  }
  return metadata.runtimeDefault;
}

function formatValue(value) {
  if (value === "") return "empty string";
  if (value === null) return "not set";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function textField(labelText, value, onInput) {
  const field = document.createElement("label");
  field.className = "field-row";
  const caption = document.createElement("span");
  caption.className = "field-label";
  caption.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.setAttribute("aria-label", labelText);
  input.addEventListener("input", () => onInput(input.value));
  field.append(caption, input);
  return field;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function attachSuggestions(input, values) {
  if (!values.length) return;
  const list = document.createElement("datalist");
  list.id = `tile-suggestions-${Math.random().toString(36).slice(2)}`;
  for (const value of values) list.append(new Option(value, value));
  input.setAttribute("list", list.id);
  input.after(list);
}
