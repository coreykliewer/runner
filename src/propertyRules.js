// Standalone Stage A contract. No gameplay, persistence, or editor dependencies.
export const PROPERTY_RULES_VERSION = 1;
export const PROPERTY_OPERATIONS = Object.freeze(["set", "add", "subtract"]);
export const PROPERTY_COMPARISONS = Object.freeze(["=", "!=", ">", "<", ">=", "<="]);
export const PROPERTY_ID_PATTERN = "^[A-Za-z_][A-Za-z0-9_-]{0,63}(?![\\s\\S])";
const reservedIds = new Set(["__proto__", "prototype", "constructor"]);
const propertyId = new RegExp(PROPERTY_ID_PATTERN);

export function validatePropertyRules(value, path = "propertyRules") {
  const issues = [];
  if (!object(value, path, ["version", "blocks"], issues)) return issues;
  if (value.version !== PROPERTY_RULES_VERSION) issues.push(error(`${path}.version`, "unsupported_version", "version must be 1."));
  if (!Array.isArray(value.blocks)) {
    issues.push(error(`${path}.blocks`, "invalid_structure", "blocks must be an array."));
    return issues;
  }
  value.blocks.forEach((block, blockIndex) => {
    const blockPath = `${path}.blocks[${blockIndex}]`;
    if (!object(block, blockPath, ["if", "then"], issues)) return;
    if (Object.hasOwn(block, "if")) {
      const condition = block.if;
      const conditionPath = `${blockPath}.if`;
      if (object(condition, conditionPath, ["property", "operator", "value"], issues)) {
        validateId(condition.property, `${conditionPath}.property`, issues);
        if (!PROPERTY_COMPARISONS.includes(condition.operator)) issues.push(error(`${conditionPath}.operator`, "invalid_operator", "Use =, !=, >, <, >= or <=."));
        validateNumber(condition.value, `${conditionPath}.value`, issues);
      }
    }
    if (!Array.isArray(block.then) || block.then.length === 0) {
      issues.push(error(`${blockPath}.then`, "invalid_structure", "then must be a non-empty array."));
      return;
    }
    block.then.forEach((effect, effectIndex) => {
      const effectPath = `${blockPath}.then[${effectIndex}]`;
      if (!object(effect, effectPath, ["operation", "property", "value"], issues)) return;
      validateId(effect.property, `${effectPath}.property`, issues);
      if (!PROPERTY_OPERATIONS.includes(effect.operation)) issues.push(error(`${effectPath}.operation`, "unsupported_operation", "Use set, add or subtract."));
      validateNumber(effect.value, `${effectPath}.value`, issues);
    });
  });
  return issues;
}

// Only the optional field is inspected. Other tile fields are neither interpreted nor changed.
export function validateTilePropertyRules(definition, path = "tile") {
  if (!isObject(definition)) return [error(path, "invalid_structure", "Tile definition must be an object.")];
  return Object.hasOwn(definition, "propertyRules")
    ? validatePropertyRules(definition.propertyRules, `${path}.propertyRules`) : [];
}

export function validateRunnerProperties(properties, path = "properties") {
  if (!isObject(properties)) return [error(path, "invalid_structure", "Runner properties must be an object.")];
  const issues = [];
  for (const [id, value] of Object.entries(properties)) {
    const entryPath = `${path}[${JSON.stringify(id)}]`;
    validateId(id, entryPath, issues);
    validateNumber(value, entryPath, issues);
    if (typeof value === "number" && value < 0) issues.push(error(entryPath, "negative_state", "Existing property values must be at least zero."));
  }
  return issues;
}

// One invocation represents one entry. The caller owns entry identity and replay prevention.
export function evaluatePropertyRules(rules, properties = {}) {
  const stateIssues = validateRunnerProperties(properties);
  const diagnostics = [...validatePropertyRules(rules), ...stateIssues];
  const entrySnapshot = stateIssues.length ? null : freeze({ ...properties });
  const result = { format: "runner.property-rule-evaluation", version: 1, ok: false,
    entrySnapshot, properties: entrySnapshot, blocks: [], effects: [], diagnostics };
  if (diagnostics.length) return freeze(result);

  const working = { ...entrySnapshot };
  for (const [blockIndex, block] of rules.blocks.entries()) {
    const comparison = Object.hasOwn(block, "if") ? compare(block.if, entrySnapshot) : null;
    const matched = comparison === null || comparison.matched;
    result.blocks.push({ blockIndex, matched, comparison, effectCount: matched ? block.then.length : 0 });
    if (!matched) continue;
    for (const [effectIndex, effect] of block.then.entries()) {
      const present = Object.hasOwn(working, effect.property);
      const before = present ? working[effect.property] : 0;
      const raw = effect.operation === "set" ? effect.value
        : effect.operation === "add" ? before + effect.value : before - effect.value;
      if (!Number.isFinite(raw)) {
        // No partial commit or applied-effect output on arithmetic failure.
        result.diagnostics.push(error(`propertyRules.blocks[${blockIndex}].then[${effectIndex}]`, "numeric_overflow", "Arithmetic must produce a finite number; the entry was not applied."));
        result.effects = [];
        return freeze(result);
      }
      const after = Math.max(0, raw);
      working[effect.property] = after;
      result.effects.push({ sequence: result.effects.length + 1, blockIndex, effectIndex,
        property: effect.property, operation: effect.operation, operand: effect.value,
        before: { present, value: present ? before : null }, after: { present: true, value: after },
        acquired: !present, valueChanged: !present || before !== after, clamped: raw < 0 });
    }
  }
  result.ok = true;
  result.properties = working;
  return freeze(result);
}

function compare(condition, snapshot) {
  const present = Object.hasOwn(snapshot, condition.property);
  const actual = present ? snapshot[condition.property] : null;
  let matched = false;
  if (present) {
    switch (condition.operator) {
      case "=": matched = actual === condition.value; break;
      case "!=": matched = actual !== condition.value; break;
      case ">": matched = actual > condition.value; break;
      case "<": matched = actual < condition.value; break;
      case ">=": matched = actual >= condition.value; break;
      case "<=": matched = actual <= condition.value; break;
    }
  }
  return { property: condition.property, operator: condition.operator, expected: condition.value, present, actual, matched };
}

function validateId(value, path, issues) {
  if (typeof value !== "string" || !propertyId.test(value) || reservedIds.has(value)) {
    issues.push(error(path, "invalid_property_id", "Use a 1–64 character identifier starting with a letter or underscore, followed by letters, digits, underscores or hyphens; prototype keys are reserved."));
  }
}

function validateNumber(value, path, issues) {
  if (typeof value !== "number" || !Number.isFinite(value)) issues.push(error(path, "invalid_number", "Value must be a finite number."));
}

function object(value, path, fields, issues) {
  if (!isObject(value)) {
    issues.push(error(path, "invalid_structure", "Expected an object."));
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) issues.push(error(`${path}.${key}`, "unsupported_field", "Unrecognized property-rule field; source JSON was not changed."));
  }
  return true;
}

function isObject(value) {
  return value !== null && typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function error(path, code, message) { return { severity: "error", path, code, message }; }
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
