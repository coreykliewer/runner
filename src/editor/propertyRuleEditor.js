import { PROPERTY_COMPARISONS, PROPERTY_OPERATIONS, validatePropertyRules,
  validateRunnerProperties, evaluatePropertyRules } from "../propertyRules.js";

const clone = value => JSON.parse(JSON.stringify(value));
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));

// Unknown instructions must never be reconstructed from the subset understood by a form.
export function propertyRuleFormSupported(value) {
  const numeric = value => value === null || (typeof value === "number" && Number.isFinite(value));
  const comparison = value => only(value, ["property", "operator", "value"]) &&
    typeof value.property === "string" && PROPERTY_COMPARISONS.includes(value.operator) && Object.hasOwn(value, "value") && numeric(value.value);
  const effect = value => only(value, ["property", "operation", "value"]) &&
    typeof value.property === "string" && PROPERTY_OPERATIONS.includes(value.operation) && Object.hasOwn(value, "value") && numeric(value.value);
  return only(value, ["version", "blocks"]) && value.version === 1 && Array.isArray(value.blocks) && value.blocks.every(block =>
    only(block, ["if", "then"]) && (!Object.hasOwn(block, "if") || comparison(block.if)) &&
    Array.isArray(block.then) && block.then.every(effect));
}

export function collectPropertyNames(values) {
  const names = new Set();
  const seen = new WeakSet();
  const add = name => {
    if (typeof name === "string" && !validateRunnerProperties(Object.fromEntries([[name, 0]])).length) names.add(name);
  };
  const visit = value => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const rules = value.propertyRules;
    if (Array.isArray(rules?.blocks)) for (const block of rules.blocks) {
      add(block?.if?.property);
      if (Array.isArray(block?.then)) for (const effect of block.then) add(effect?.property);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(values);
  return [...names].sort();
}

export function renderPropertyRuleEditor(container, { value, propertyNames = [], readOnly = false, onChange = () => {} } = {}) {
  let state = clone(value);
  const samples = [];
  const prefix = `property-rule-${crypto.randomUUID()}`;
  const fields = new Map();
  let suggestions, status, preview, output;
  const ownedNames = () => collectPropertyNames({ propertyRules: state });
  const defaultEffect = () => ({ operation: "set", property: "", value: 0 });

  function commit(mutate, redraw = false) {
    const next = clone(state);
    mutate(next);
    state = next;
    onChange(clone(state), false);
    if (redraw) draw();
    else {
      refreshErrors();
      refreshSuggestions();
      output.textContent = "Rules changed. Run preview again.";
    }
  }

  function addSampleNames() {
    let added = false;
    for (const property of ownedNames()) if (!samples.some(sample => sample.property === property)) {
      samples.push({ property, present: false, value: 0 });
      added = true;
    }
    return added;
  }

  function refreshSuggestions() {
    suggestions.replaceChildren(...[...new Set([...propertyNames, ...ownedNames()])].sort().map(name => new Option(name, name)));
  }

  function bindError(path, parent, input = null) {
    const error = element("small", "property-rule-error");
    error.id = `${prefix}-error-${fields.size}`;
    error.dataset.path = path;
    fields.set(path, { error, input });
    if (input) input.setAttribute("aria-describedby", error.id);
    parent.append(error);
  }

  function refreshErrors() {
    const issues = validatePropertyRules(state);
    status.textContent = issues.length ? "Invalid rules. Save is blocked until the fields are corrected; the saved file is unchanged." : "Valid property rules.";
    for (const [path, { error, input }] of fields) {
      const messages = issues.filter(issue => issue.path === path).map(issue => issue.message);
      error.textContent = messages.join(" ");
      error.hidden = messages.length === 0;
      if (input) input.setAttribute("aria-invalid", String(messages.length > 0));
    }
  }

  function field(parent, label, path, value, change, choices = null, numeric = false) {
    const row = element("label", "property-rule-field");
    row.append(element("span", "", label));
    const input = document.createElement(choices ? "select" : "input");
    input.setAttribute("aria-label", label);
    if (choices) for (const choice of choices) input.append(new Option(choice[1], choice[0]));
    else {
      input.type = numeric ? "number" : "text";
      if (numeric) input.step = "any";
      else { input.setAttribute("list", `${prefix}-names`); input.autocomplete = "off"; }
    }
    input.value = value ?? "";
    input.addEventListener(choices ? "change" : "input", () => change(numeric ? input.value === "" ? null : Number(input.value) : input.value));
    if (!choices && !numeric) input.addEventListener("change", () => {
      if (addSampleNames()) drawSampleRows();
    });
    row.append(input);
    bindError(path, row, input);
    parent.append(row);
  }

  function orderButtons(parent, label, list, index, reorder) {
    for (const [direction, offset] of [["up", -1], ["down", 1]]) {
      const control = button(`Move ${label} ${direction}`, direction === "up" ? "Up" : "Down", () => reorder(offset));
      control.disabled = index + offset < 0 || index + offset >= list.length;
      parent.append(control);
    }
  }

  function draw() {
    fields.clear();
    container.replaceChildren();
    const root = element("section", "property-rule-editor");
    root.append(element("p", "property-rule-help", "Triggers once for each successful tile entry: walking, jumping, gravity, turbo and forced movement. Spawn, resume, blocked movement and stationary dice changes do not trigger entry."),
      element("p", "property-rule-help", "Every IF reads the Runner's properties at the beginning of that entry. Blocks execute top to bottom; THEN effects execute top to bottom on working values, clamped to zero. Missing properties fail every comparison, including !=."));
    suggestions = document.createElement("datalist");
    suggestions.id = `${prefix}-names`;
    root.append(suggestions);
    status = element("p", "property-rule-status");
    status.setAttribute("role", "status");
    root.append(status);
    if (!propertyRuleFormSupported(state)) {
      root.append(element("p", "property-rule-error", "Unsupported property-rule JSON. Read-only: the original JSON is preserved. Export it to edit unsupported instructions without data loss."));
      const details = document.createElement("details");
      details.append(element("summary", "", "Preserved property-rule JSON"), element("pre", "", JSON.stringify(state, null, 2)));
      root.append(details);
    } else {
      const builder = document.createElement("fieldset");
      builder.className = "property-rule-builder";
      builder.disabled = readOnly;
      builder.append(element("legend", "", readOnly ? "Inherited rules — override to edit" : "Authored execution order"));
      state.blocks.forEach((block, index) => {
        const card = element("section", "property-rule-block");
        card.append(element("h4", "", `Block ${index + 1}`));
        const controls = element("div", "property-rule-controls");
        orderButtons(controls, `block ${index + 1}`, state.blocks, index, offset => commit(next => swap(next.blocks, index, offset), true));
        controls.append(button(`Duplicate block ${index + 1}`, "Duplicate block", () => commit(next => next.blocks.splice(index + 1, 0, clone(next.blocks[index])), true)),
          button(`Delete block ${index + 1}`, "Delete block", () => commit(next => next.blocks.splice(index, 1), true)));
        card.append(controls);
        const conditional = document.createElement("input");
        conditional.type = "checkbox";
        conditional.checked = Object.hasOwn(block, "if");
        conditional.setAttribute("aria-label", `Block ${index + 1} use IF`);
        conditional.addEventListener("change", () => commit(next => {
          if (conditional.checked) next.blocks[index].if = { property: "", operator: "=", value: 0 };
          else delete next.blocks[index].if;
        }, true));
        const toggle = element("label", "property-rule-toggle");
        toggle.append(conditional, document.createTextNode("IF condition (off means always)"));
        card.append(toggle);
        const path = `propertyRules.blocks[${index}]`;
        if (block.if) {
          const condition = element("div", "property-rule-fields");
          field(condition, `Block ${index + 1} IF property`, `${path}.if.property`, block.if.property, value => commit(next => { next.blocks[index].if.property = value; }));
          field(condition, `Block ${index + 1} comparison`, `${path}.if.operator`, block.if.operator, value => commit(next => { next.blocks[index].if.operator = value; }), PROPERTY_COMPARISONS.map(value => [value, value]));
          field(condition, `Block ${index + 1} IF value`, `${path}.if.value`, block.if.value, value => commit(next => { next.blocks[index].if.value = value; }), null, true);
          card.append(condition);
        }
        card.append(element("h5", "", "THEN — ordered effects"));
        bindError(`${path}.then`, card);
        block.then.forEach((effect, effectIndex) => {
          const row = element("section", "property-rule-effect");
          const label = `Block ${index + 1} effect ${effectIndex + 1}`;
          row.append(element("strong", "", `Effect ${effectIndex + 1}`));
          const commands = element("div", "property-rule-controls");
          orderButtons(commands, label.toLowerCase(), block.then, effectIndex, offset => commit(next => swap(next.blocks[index].then, effectIndex, offset), true));
          commands.append(button(`Duplicate ${label.toLowerCase()}`, "Duplicate effect", () => commit(next => next.blocks[index].then.splice(effectIndex + 1, 0, clone(next.blocks[index].then[effectIndex])), true)));
          const remove = button(`Delete ${label.toLowerCase()}`, "Delete effect", () => commit(next => next.blocks[index].then.splice(effectIndex, 1), true));
          remove.disabled = block.then.length === 1;
          commands.append(remove);
          row.append(commands);
          const effectPath = `${path}.then[${effectIndex}]`;
          field(row, `${label} operation`, `${effectPath}.operation`, effect.operation, value => commit(next => { next.blocks[index].then[effectIndex].operation = value; }), PROPERTY_OPERATIONS.map(value => [value, value[0].toUpperCase() + value.slice(1)]));
          field(row, `${label} property`, `${effectPath}.property`, effect.property, value => commit(next => { next.blocks[index].then[effectIndex].property = value; }));
          field(row, `${label} value`, `${effectPath}.value`, effect.value, value => commit(next => { next.blocks[index].then[effectIndex].value = value; }), null, true);
          card.append(row);
        });
        card.append(button(`Add effect to block ${index + 1}`, "+ THEN effect", () => commit(next => next.blocks[index].then.push(defaultEffect()), true)));
        builder.append(card);
      });
      builder.append(button("Add property-rule block", "+ Block", () => commit(next => next.blocks.push({ then: [defaultEffect()] }), true)));
      root.append(builder);
    }
    preview = element("section", "property-rule-preview");
    preview.append(element("h4", "", "Test tile entry"), element("p", "", "Unchecked properties are missing. Checked properties are acquired, even when their value is zero. Samples affect this preview only."));
    root.append(preview);
    container.append(root);
    refreshSuggestions();
    refreshErrors();
    addSampleNames();
    drawSamples();
  }

  function drawSamples() {
    preview.querySelector(".property-rule-samples")?.remove();
    const body = element("div", "property-rule-samples");
    body.append(element("div", "property-rule-sample-rows"));
    body.append(button("Add sample property", "+ Sample property", () => { samples.push({ property: "", present: true, value: 0 }); drawSampleRows(); output.textContent = "Sample changed. Run preview again."; }),
      button("Run property-rule preview", "Run preview", runPreview));
    output = element("div", "property-rule-preview-result", "Run preview to inspect one tile entry.");
    output.setAttribute("role", "status");
    body.append(output);
    preview.append(body);
    drawSampleRows();
  }

  function drawSampleRows() {
    const body = preview.querySelector(".property-rule-sample-rows");
    body.replaceChildren();
    samples.forEach((sample, index) => {
      const row = element("div", "property-rule-sample");
      const id = document.createElement("input");
      id.type = "text";
      id.value = sample.property;
      id.setAttribute("aria-label", `Sample ${index + 1} property`);
      id.setAttribute("list", `${prefix}-names`);
      const acquired = document.createElement("input");
      acquired.type = "checkbox";
      acquired.checked = sample.present;
      acquired.setAttribute("aria-label", `Sample ${index + 1} acquired`);
      const value = document.createElement("input");
      value.type = "number";
      value.step = "any";
      value.min = "0";
      value.value = sample.value ?? "";
      value.disabled = !sample.present;
      value.setAttribute("aria-label", `Sample ${index + 1} value`);
      const stale = () => { output.textContent = "Sample changed. Run preview again."; };
      id.addEventListener("input", () => { sample.property = id.value; stale(); });
      acquired.addEventListener("change", () => { sample.present = acquired.checked; value.disabled = !sample.present; stale(); });
      value.addEventListener("input", () => { sample.value = value.value === "" ? null : Number(value.value); stale(); });
      const label = element("label", "property-rule-toggle");
      label.append(acquired, document.createTextNode("Acquired"));
      row.append(id, label, value, button(`Remove sample ${index + 1}`, "Remove sample", () => { samples.splice(index, 1); drawSampleRows(); stale(); }));
      body.append(row);
    });
  }

  function runPreview() {
    output.replaceChildren();
    const ids = samples.map(sample => sample.property);
    const sampleErrors = validateRunnerProperties(Object.fromEntries(samples.map(sample => [sample.property, sample.present ? sample.value : 0])));
    if (new Set(ids).size !== ids.length || sampleErrors.length) {
      output.textContent = "Invalid sample: use unique valid property IDs and finite non-negative acquired values. " + sampleErrors.map(issue => `${issue.path}: ${issue.message}`).join(" ");
      return;
    }
    const result = evaluatePropertyRules(state, Object.fromEntries(samples.filter(sample => sample.present).map(sample => [sample.property, sample.value])));
    if (!result.ok) {
      output.textContent = "Preview not applied. " + result.diagnostics.map(issue => `${issue.path}: ${issue.message}`).join(" ");
      return;
    }
    const table = document.createElement("table");
    table.className = "property-rule-results";
    const header = document.createElement("tr");
    for (const name of ["Property", "Before entry", "After entry"]) header.append(element("th", "", name));
    table.append(header);
    const describe = (properties, id) => Object.hasOwn(properties, id) ? `Acquired: ${properties[id]}` : "Missing";
    for (const id of [...new Set([...ownedNames(), ...ids, ...Object.keys(result.properties)])].sort()) {
      const row = document.createElement("tr");
      row.append(element("th", "", id), element("td", "", describe(result.entrySnapshot, id)), element("td", "", describe(result.properties, id)));
      table.append(row);
    }
    output.append(table);
    const log = document.createElement("ol");
    for (const block of result.blocks) log.append(element("li", "", `Block ${block.blockIndex + 1}: ${block.matched ? "matched" : "IF did not match"}`));
    for (const effect of result.effects) log.append(element("li", "", `Block ${effect.blockIndex + 1} effect ${effect.effectIndex + 1}: ${effect.operation} ${effect.property} ${effect.operand}; ${effect.before.present ? effect.before.value : "Missing"} → ${effect.after.value}${effect.clamped ? " (clamped)" : ""}`));
    output.append(log);
  }

  draw();
}

function swap(list, index, offset) { [list[index], list[index + offset]] = [list[index + offset], list[index]]; }
function element(tag, className = "", text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
}
function button(label, text, callback) {
  const value = element("button", "quiet-button", text);
  value.type = "button";
  value.setAttribute("aria-label", label);
  value.addEventListener("click", callback);
  return value;
}
