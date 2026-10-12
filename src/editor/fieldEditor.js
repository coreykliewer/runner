const enumFields = {
  operator: ["lessThan", "atMost", "equals", "notEquals", "greaterThan", "atLeast"],
  parity: ["even", "odd"],
  slope: ["left", "right"],
  type: ["message", "xp", "achievement", "story_flag", "counter", "heart", "score", "setFlag"]
};

export function renderJsonEditor(container, { value, onChange, suggestions = {}, skipKeys = [], rootLabel = "value" }) {
  let currentValue = cloneJson(value);
  const omitted = new Set(skipKeys);

  const commit = (path, nextValue, rerender = false) => {
    currentValue = updateAt(currentValue, path, nextValue);
    onChange(cloneJson(currentValue), rerender, path);
    if (rerender) render();
  };

  const render = () => {
    container.replaceChildren();
    if (currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) {
      for (const [key, child] of Object.entries(currentValue)) {
        if (!omitted.has(key)) renderNode(container, key, child, [key]);
      }
      renderObjectActions(container, [], currentValue, suggestions, rootLabel);
    } else {
      renderNode(container, rootLabel, currentValue, []);
    }
  };

  const renderNode = (parent, key, nodeValue, path) => {
    if (Array.isArray(nodeValue)) {
      renderArray(parent, key, nodeValue, path);
      return;
    }
    if (nodeValue && typeof nodeValue === "object") {
      const section = document.createElement("section");
      section.className = "field-object";
      const heading = document.createElement("div");
      heading.className = "field-object-heading";
      heading.textContent = humanize(key);
      section.append(heading);
      for (const [childKey, childValue] of Object.entries(nodeValue)) {
        renderNode(section, childKey, childValue, [...path, childKey]);
      }
      renderObjectActions(section, path, nodeValue, suggestions, rootLabel);
      parent.append(section);
      return;
    }
    renderPrimitive(parent, key, nodeValue, path);
  };

  const renderPrimitive = (parent, key, nodeValue, path) => {
    const field = document.createElement("label");
    field.className = "field-row";
    const caption = document.createElement("span");
    caption.className = "field-label";
    caption.textContent = humanizeField(key, path);
    field.append(caption);

    if (typeof nodeValue === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = nodeValue;
      input.addEventListener("change", () => commit(path, input.checked));
      field.classList.add("field-boolean");
      field.append(input);
    } else if (typeof nodeValue === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = String(nodeValue);
      input.addEventListener("change", () => {
        if (input.value !== "") commit(path, Number(input.value));
      });
      field.append(input);
    } else {
      const input = createTextControl(key, nodeValue, path, suggestions);
      const eventName = key.toLowerCase() === "svg" ? "change" : "input";
      input.addEventListener(eventName, () => commit(path, input.value));
      field.append(input);
      attachSuggestions(input, suggestionsFor(key.toLowerCase(), suggestions));
    }
    parent.append(field);
  };

  const renderArray = (parent, key, items, path) => {
    const section = document.createElement("section");
    section.className = "field-array";
    const heading = document.createElement("div");
    heading.className = "field-object-heading";
    heading.textContent = humanize(key);
    section.append(heading);

    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "field-array-row";
      const itemEditor = document.createElement("div");
      itemEditor.className = "field-array-value";
      renderNode(itemEditor, `Item ${index + 1}`, item, [...path, index]);
      const remove = button("Remove row", "Remove");
      remove.addEventListener("click", () => {
        const next = items.slice();
        next.splice(index, 1);
        commit(path, next, true);
      });
      row.append(itemEditor, remove);
      section.append(row);
    });

    const add = button(`Add ${humanize(key).toLowerCase()} row`, "+ Add row");
    add.addEventListener("click", () => commit(path, [...items, defaultArrayItem(key, items)], true));
    section.append(add);
    parent.append(section);
  };

  const renderObjectActions = (parent, path, objectValue, suggestionValues, currentRootLabel) => {
    const add = button("Add key and value", "+ Add property");
    add.addEventListener("click", () => {
      if (parent.querySelector(":scope > .property-adder")) return;

      const form = document.createElement("div");
      form.className = "property-adder";
      const name = document.createElement("input");
      name.type = "text";
      name.placeholder = "Property name";
      name.setAttribute("aria-label", "Property name");
      const keySuggestions = path[0] === "grantStats" || (!path.length && currentRootLabel === "grantStats")
        ? suggestionValues.stats || []
        : [];
      const type = document.createElement("select");
      type.setAttribute("aria-label", "Property type");
      for (const [value, label] of [["string", "Text"], ["number", "Number"], ["boolean", "Boolean"], ["object", "Object"], ["array", "Array"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        type.append(option);
      }
      const error = document.createElement("span");
      error.className = "property-adder-error";
      error.setAttribute("role", "alert");
      const actions = document.createElement("div");
      actions.className = "property-adder-actions";
      const cancel = button("Cancel adding property", "Cancel");
      cancel.addEventListener("click", () => form.remove());
      const create = button("Create property", "Create");
      create.addEventListener("click", () => {
        const propertyName = name.value.trim();
        const currentObject = getAt(currentValue, path);
        if (!propertyName) {
          error.textContent = "Enter a property name.";
          name.focus();
          return;
        }
        if (Object.hasOwn(currentObject, propertyName)) {
          error.textContent = `Property '${propertyName}' already exists.`;
          name.focus();
          return;
        }
        commit(path, { ...currentObject, [propertyName]: initialValueForType(type.value) }, true);
      });
      actions.append(cancel, create);
      form.append(name, type, error, actions);
      parent.append(form);
      attachSuggestions(name, keySuggestions);
      name.focus();
    });
    parent.append(add);
  };

  render();
}

function createTextControl(key, value, path, suggestions) {
  const fieldName = key.toLowerCase();
  const choices = choicesForField(fieldName, path);
  let input;
  if (choices) {
    input = document.createElement("select");
    const options = [...new Set([...(value == null ? [] : [String(value)]), ...choices])];
    for (const optionValue of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue || "Select";
      input.append(option);
    }
    input.value = value == null ? "" : String(value);
    if (!input.value) input.insertBefore(new Option("Select", ""), input.firstChild);
    return input;
  }

  const multiline = ["text", "body", "hint", "message", "messagefail", "messagehit", "deathmessage", "pickupmessage", "map", "svg"].includes(fieldName);
  input = multiline ? document.createElement("textarea") : document.createElement("input");
  if (!multiline) input.type = "text";
  input.value = value == null ? "" : String(value);
  if (fieldName === "svg" || fieldName === "map") input.classList.add("field-code");
  return input;
}

function choicesForField(fieldName, path) {
  const pathText = path.join(".");
  if (fieldName === "operator") return enumFields.operator;
  if (fieldName === "parity") return enumFields.parity;
  if (fieldName === "slope") return enumFields.slope;
  if (fieldName === "type" && pathText.includes("actions")) return ["message", "xp", "achievement", "story_flag"];
  if (fieldName === "type" && pathText.includes("effects")) return ["counter", "xp", "heart", "score", "message", "setFlag"];
  if (fieldName === "type" && pathText.includes("trigger")) return ["level_start", "pickup"];
  return null;
}

function suggestionsFor(fieldName, suggestions) {
  const map = {
    id: ["ids"],
    event: ["eventIds"],
    level: ["levelIds"],
    destination: ["levelIds"],
    defaultlevel: ["levelIds"],
    tile: ["tileCodes"],
    variant: ["variants"],
    stat: ["stats"],
    flag: ["flags"]
  };
  return [...new Set((map[fieldName] || []).flatMap(key => suggestions[key] || []))];
}

function attachSuggestions(input, values) {
  if (!values.length) return;
  const listId = `suggestions-${Math.random().toString(36).slice(2)}`;
  const list = document.createElement("datalist");
  list.id = listId;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    list.append(option);
  }
  input.setAttribute("list", listId);
  input.after(list);
}

function defaultArrayItem(key, existing) {
  const last = key.toLowerCase();
  if (last === "actions") return { type: "message", text: "" };
  if (last === "events") return { id: "", trigger: { type: "level_start" }, actions: [] };
  if (last === "achievements") return { id: "", title: "", when: { stat: "", atLeast: 1 } };
  if (last === "all" || last === "any") return { stat: "", atLeast: 1 };
  if (last === "effects") return { type: "counter", stat: "", amount: 1 };
  if (last === "exact") return 1;
  const sample = existing.find(item => item !== null && item !== undefined);
  if (typeof sample === "number") return 0;
  if (typeof sample === "boolean") return false;
  if (sample && typeof sample === "object") return {};
  return "";
}

function updateAt(root, path, value) {
  if (path.length === 0) return cloneJson(value);
  const next = cloneJson(root);
  let target = next;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path[path.length - 1]] = cloneJson(value);
  return next;
}

function button(label, text) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "quiet-button";
  element.textContent = text;
  element.setAttribute("aria-label", label);
  return element;
}

function humanize(value) {
  return String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, char => char.toUpperCase());
}

function humanizeField(value, path) {
  if (path[0] === "spawn" && (value === "x" || value === "y")) return `Spawn ${value.toUpperCase()}`;
  return humanize(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getAt(root, path) {
  return path.reduce((value, key) => value?.[key], root);
}

function initialValueForType(type) {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "object") return {};
  if (type === "array") return [];
  return "";
}