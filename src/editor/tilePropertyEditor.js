import {
  TILE_PROPERTY_CATEGORIES,
  TILE_PROPERTY_DEFINITIONS,
  getTilePropertyInitialValue,
  getTilePropertyStatusLabel
} from "../tileProperties.js";
import { renderJsonEditor } from "./fieldEditor.js";

const supportedNames = Object.keys(TILE_PROPERTY_DEFINITIONS);

export function renderTilePropertyEditor(container, { value, onChange, suggestions = {} } = {}) {
  let definition = cloneJson(value || {});
  const commit = (next, rerender) => {
    definition = cloneJson(next);
    onChange(cloneJson(definition), { refresh: Boolean(rerender) });
  };
  container.replaceChildren();

  for (const category of TILE_PROPERTY_CATEGORIES) {
    const present = supportedNames.filter(name =>
      TILE_PROPERTY_DEFINITIONS[name].category === category.id && Object.hasOwn(definition, name));
    if (!present.length) continue;

    const section = document.createElement("section");
    section.className = "tile-property-category";
    const heading = document.createElement("h3");
    heading.textContent = category.label;
    section.append(heading);
    for (const name of present) renderProperty(section, name, definition[name]);
    container.append(section);
  }

  renderAddProperty(container, () => definition, (next, options) => commit(next, options?.refresh));

  const customProperties = Object.fromEntries(Object.entries(definition).filter(([name]) => !supportedNames.includes(name)));
  const custom = document.createElement("details");
  custom.className = "tile-custom-properties";
  custom.open = Object.keys(customProperties).length > 0;
  const summary = document.createElement("summary");
  summary.textContent = `Advanced and custom JSON (${Object.keys(customProperties).length})`;
  custom.append(summary);
  const customEditor = document.createElement("div");
  customEditor.className = "tile-custom-editor";
  renderJsonEditor(customEditor, {
    value: customProperties,
    suggestions,
    onChange: (nextCustom, rerender) => {
      const next = Object.fromEntries(Object.entries(definition).filter(([name]) => supportedNames.includes(name)));
      Object.assign(next, nextCustom);
      commit(next, rerender);
    }
  });
  custom.append(customEditor);
  container.append(custom);

  function renderProperty(parent, name, currentValue) {
    const metadata = TILE_PROPERTY_DEFINITIONS[name];
    const row = document.createElement("section");
    row.className = "tile-property-row";
    row.dataset.property = name;
    const head = document.createElement("div");
    head.className = "tile-property-head";
    const title = document.createElement("strong");
    title.textContent = humanize(name);
    const status = document.createElement("span");
    status.className = `tile-property-status status-${metadata.status}`;
    status.textContent = getTilePropertyStatusLabel(metadata.status);
    head.append(title, status);
    const description = document.createElement("p");
    description.className = "tile-property-description";
    description.textContent = `${metadata.description} Runtime fallback: ${metadata.runtimeDefault}`;
    row.append(head, description);

    if (name === "svg") {
      const upload = document.createElement("label");
      upload.className = "field-row artwork-upload";
      const caption = document.createElement("span");
      caption.className = "field-label";
      caption.textContent = "Import SVG file";
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".svg,image/svg+xml";
      input.setAttribute("aria-label", "Import SVG file");
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        const source = await file.text();
        update("svg", source);
        const sourceEditor = row.querySelector(".tile-svg-source");
        if (sourceEditor) sourceEditor.value = source;
        input.value = "";
      });
      upload.append(caption, input);
      row.append(upload);
    }

    if (["hint", "signMessage", "signHtml"].includes(name) && typeof currentValue === "string") {
      const variantText = document.createElement("button");
      variantText.type = "button";
      variantText.className = "quiet-button";
      variantText.textContent = "Use variant-specific text";
      variantText.addEventListener("click", () => update(name, { default: currentValue }, true));
      row.append(variantText);
    }

    if (metadata.type === "boolean") {
      const control = document.createElement("input");
      control.type = "checkbox";
      control.checked = Boolean(currentValue);
      control.setAttribute("aria-label", humanize(name));
      control.addEventListener("change", () => update(name, control.checked));
      row.append(control);
    } else if (metadata.type === "number") {
      const control = document.createElement("input");
      control.type = "number";
      control.step = "any";
      control.value = currentValue == null ? "" : String(currentValue);
      control.setAttribute("aria-label", humanize(name));
      control.addEventListener("change", () => {
        if (control.value === "") return;
        const number = Number(control.value);
        if (Number.isFinite(number)) update(name, number);
      });
      row.append(control);
    } else if (metadata.type === "enum") {
      const control = document.createElement("select");
      control.setAttribute("aria-label", humanize(name));
      for (const choice of metadata.choices || []) control.append(new Option(choice, choice));
      control.value = currentValue == null ? "" : currentValue;
      control.addEventListener("change", () => update(name, control.value));
      row.append(control);
    } else if ((metadata.type === "text" || metadata.type === "multiline" || metadata.type === "svg") &&
      !(currentValue && typeof currentValue === "object" && !Array.isArray(currentValue))) {
      const control = metadata.type === "multiline" || metadata.type === "svg"
        ? document.createElement("textarea")
        : document.createElement("input");
      if (control instanceof HTMLInputElement) control.type = "text";
      control.value = typeof currentValue === "string" ? currentValue : "";
      control.setAttribute("aria-label", humanize(name));
      if (name === "svg") control.classList.add("field-code", "tile-svg-source");
      control.addEventListener("input", () => update(name, control.value));
      row.append(control);
      if (name === "autoPush") attachSuggestions(control, suggestions.tileCodes || []);
    } else {
      const editor = document.createElement("div");
      editor.className = "tile-nested-editor";
      renderJsonEditor(editor, {
        value: currentValue,
        rootLabel: name,
        suggestions,
        onChange: (nextValue, rerender) => update(name, nextValue, rerender)
      });
      row.append(editor);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiet-button tile-property-remove";
    remove.textContent = "Remove property";
    remove.setAttribute("aria-label", `Remove ${humanize(name)}`);
    remove.addEventListener("click", () => {
      const next = cloneJson(definition);
      delete next[name];
      commit(next, true);
    });
    row.append(remove);
    parent.append(row);

    function update(propertyName, nextValue, rerender = false) {
      const next = cloneJson(definition);
      next[propertyName] = nextValue;
      commit(next, rerender);
    }
  }
}

function renderAddProperty(container, getDefinition, onChange) {
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
        option.disabled = Object.hasOwn(definition, name);
        const label = document.createElement("strong");
        label.textContent = humanize(name);
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
      container.querySelector(".tile-custom-properties")?.setAttribute("open", "");
      container.querySelector(".tile-custom-properties .quiet-button")?.click();
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
