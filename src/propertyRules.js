// Standalone Stage A contract. No gameplay, persistence, or editor dependencies.
export const PROPERTY_RULES_VERSION = 1;
export const PROPERTY_RULES_VERSIONS = Object.freeze([1, 2]);
export const PROPERTY_CONDITION_MODES = Object.freeze(["entry", "current"]);
export const PROPERTY_NATIVE_EFFECTS = Object.freeze(["lose_hearts", "narrative", "achievement"]);
export const PROPERTY_OPERATIONS = Object.freeze(["set", "add", "subtract"]);
export const PROPERTY_COMPARISONS = Object.freeze(["=", "!=", ">", "<", ">=", "<="]);
export const PROPERTY_ID_PATTERN = "^[A-Za-z_][A-Za-z0-9_-]{0,63}(?![\\s\\S])";
const reservedIds = new Set(["__proto__", "prototype", "constructor"]);
const propertyId = new RegExp(PROPERTY_ID_PATTERN);

export function validatePropertyRules(value, path = "propertyRules") {
  const issues = [];
  if (!object(value, path, ["version", "blocks"], issues)) return issues;
  if (!PROPERTY_RULES_VERSIONS.includes(value.version)) issues.push(error(`${path}.version`, "unsupported_version", "version must be 1 or 2."));
  const v2 = value.version === 2;
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
      const existence = v2 && ["exists", "not_exists"].includes(condition?.type);
      const fields = v2 ? ["type", "mode", "property", ...(existence ? [] : ["operator", "value"])] : ["property", "operator", "value"];
      if (object(condition, conditionPath, fields, issues)) {
        validateId(condition.property, `${conditionPath}.property`, issues);
        if (v2) {
          if (!["comparison", "exists", "not_exists"].includes(condition.type)) issues.push(error(`${conditionPath}.type`, "unsupported_condition", "Use comparison, exists or not_exists."));
          if (Object.hasOwn(condition, "mode") && !PROPERTY_CONDITION_MODES.includes(condition.mode)) issues.push(error(`${conditionPath}.mode`, "invalid_mode", "Use entry or current."));
        }
        if (!existence) {
          if (!PROPERTY_COMPARISONS.includes(condition.operator)) issues.push(error(`${conditionPath}.operator`, "invalid_operator", "Use =, !=, >, <, >= or <=."));
          validateNumber(condition.value, `${conditionPath}.value`, issues);
        }
      }
    }
    if (!Array.isArray(block.then) || block.then.length === 0) {
      issues.push(error(`${blockPath}.then`, "invalid_structure", "then must be a non-empty array."));
      return;
    }
    block.then.forEach((effect, effectIndex) => {
      const effectPath = `${blockPath}.then[${effectIndex}]`;
      if (v2 && effect?.type !== "property") {
        validateNativeEffect(effect, effectPath, issues);
        return;
      }
      if (!object(effect, effectPath, [...(v2 ? ["type"] : []), "operation", "property", "value"], issues)) return;
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
  const execution = createPropertyRuleExecution(rules, properties);
  const step = execution.next();
  if (step.done) return step.value;
  execution.return();
  return freeze({ ...step.value.evaluation, ok: false, status: "native_effect_required",
    pendingEffect: step.value.effect,
    diagnostics: [error(step.value.path, "native_effect_required", "A native adapter must acknowledge this effect before execution can continue.")] });
}

// One ordered interpreter. Native instructions suspend; this module performs no I/O.
// Each yielded instruction requires exactly one applied/terminal/failed acknowledgement.
export function* createPropertyRuleExecution(rules, properties = {}) {
  const stateIssues = validateRunnerProperties(properties);
  const diagnostics = [...validatePropertyRules(rules), ...stateIssues];
  const entrySnapshot = stateIssues.length ? null : freeze({ ...properties });
  const result = { format: "runner.property-rule-evaluation", version: 1, ok: false,
    entrySnapshot, properties: entrySnapshot, blocks: [], effects: [], diagnostics };
  const v2 = rules?.version === 2;
  if (v2) Object.assign(result, { rulesVersion: 2, status: "invalid", records: [] });
  if (diagnostics.length) return freeze(result);

  // Own the entire definition before yielding: caller edits cannot change a suspended entry.
  if (v2) rules = { ...rules, blocks: rules.blocks.map(block => ({ ...block,
    ...(block.if ? { if: { ...block.if } } : {}), then: block.then.map(effect => ({ ...effect })) })) };
  const working = { ...entrySnapshot };
  const snapshot = () => ({ ...working });
  const record = details => { if (v2) result.records.push({ sequence: result.records.length + 1, ...details }); };
  for (const [blockIndex, block] of rules.blocks.entries()) {
    const mode = v2 ? block.if?.mode || "entry" : "entry";
    const comparison = Object.hasOwn(block, "if") ? compare(block.if, mode === "current" ? working : entrySnapshot) : null;
    const matched = comparison === null || comparison.matched;
    result.blocks.push({ blockIndex, matched, comparison, effectCount: matched ? block.then.length : 0 });
    record({ kind: "block", blockIndex, blockNumber: blockIndex + 1, mode, matched, comparison,
      snapshot: mode === "current" ? snapshot() : { ...entrySnapshot } });
    if (!matched) continue;
    for (const [effectIndex, effect] of block.then.entries()) {
      const location = { blockIndex, effectIndex, blockNumber: blockIndex + 1, effectNumber: effectIndex + 1,
        effectKey: `block:${blockIndex + 1}/effect:${effectIndex + 1}` };
      const path = `propertyRules.blocks[${blockIndex}].then[${effectIndex}]`;
      if (v2 && effect.type !== "property") {
        const request = freeze({ ...location, type: effect.type, effect: { ...effect }, before: snapshot() });
        const acknowledgement = yield freeze({ effect: request, path,
          evaluation: JSON.parse(JSON.stringify({ ...result, properties: working, status: "awaiting_native" })) });
        const status = acknowledgement?.status;
        const valid = ["applied", "terminal", "failed"].includes(status);
        const outcome = valid ? status : "failed";
        result.effects.push({ sequence: result.effects.length + 1, ...location, type: effect.type, effect: { ...effect }, status: outcome });
        record({ kind: "effect", ...location, type: effect.type, effect: { ...effect }, status: outcome, before: snapshot(), after: snapshot() });
        if (outcome !== "applied") {
          result.properties = working;
          result.ok = outcome === "terminal";
          result.status = outcome;
          if (outcome === "failed") result.diagnostics.push(error(path, valid ? "native_effect_failed" : "invalid_native_acknowledgement",
            "Execution stopped. Earlier effects remain applied; the failed native action must not be retried automatically."));
          return freeze(result);
        }
        continue;
      }
      const present = Object.hasOwn(working, effect.property);
      const before = present ? working[effect.property] : 0;
      const raw = effect.operation === "set" ? effect.value
        : effect.operation === "add" ? before + effect.value : before - effect.value;
      if (!Number.isFinite(raw)) {
        // V1 rolls back atomically; V2 retains an already executed prefix.
        result.diagnostics.push(error(path, "numeric_overflow", v2
          ? "Arithmetic must produce a finite number; execution stopped with earlier effects retained."
          : "Arithmetic must produce a finite number; the entry was not applied."));
        if (v2) {
          result.properties = working;
          result.status = "failed";
          record({ kind: "effect", ...location, type: "property", status: "failed", before: snapshot(), after: snapshot() });
        } else result.effects = [];
        return freeze(result);
      }
      const after = Math.max(0, raw);
      const beforeSnapshot = v2 ? snapshot() : null;
      working[effect.property] = after;
      result.effects.push({ ...(v2 ? { ...location, type: "property", status: "applied" } : {}),
        sequence: result.effects.length + 1, blockIndex, effectIndex,
        property: effect.property, operation: effect.operation, operand: effect.value,
        before: { present, value: present ? before : null }, after: { present: true, value: after },
        acquired: !present, valueChanged: !present || before !== after, clamped: raw < 0 });
      record({ kind: "effect", ...location, type: "property", status: "applied", effect: { ...effect }, before: beforeSnapshot, after: snapshot() });
    }
  }
  result.ok = true;
  result.properties = working;
  if (v2) result.status = "completed";
  return freeze(result);
}

function compare(condition, snapshot) {
  const present = Object.hasOwn(snapshot, condition.property);
  const actual = present ? snapshot[condition.property] : null;
  let matched = false;
  if (condition.type === "exists") matched = present;
  else if (condition.type === "not_exists") matched = !present;
  else if (present) {
    switch (condition.operator) {
      case "=": matched = actual === condition.value; break;
      case "!=": matched = actual !== condition.value; break;
      case ">": matched = actual > condition.value; break;
      case "<": matched = actual < condition.value; break;
      case ">=": matched = actual >= condition.value; break;
      case "<=": matched = actual <= condition.value; break;
    }
  }
  if (["exists", "not_exists"].includes(condition.type)) return { type: condition.type, property: condition.property, present, actual, matched };
  return { property: condition.property, operator: condition.operator, expected: condition.value, present, actual, matched };
}

function validateNativeEffect(effect, path, issues) {
  const fields = { lose_hearts: ["type", "amount"], narrative: ["type", "text"], achievement: ["type", "id", "title", "body"] };
  const type = effect?.type;
  if (!object(effect, path, Object.hasOwn(fields, type) ? fields[type] : ["type"], issues)) return;
  if (!PROPERTY_NATIVE_EFFECTS.includes(type)) {
    issues.push(error(`${path}.type`, "unsupported_effect", "Use property, lose_hearts, narrative or achievement."));
  } else if (type === "lose_hearts") {
    validateNumber(effect.amount, `${path}.amount`, issues);
    if (typeof effect.amount === "number" && effect.amount <= 0) issues.push(error(`${path}.amount`, "invalid_amount", "Heart loss must be positive."));
  } else {
    const required = type === "narrative" ? ["text"] : ["id", "title"];
    for (const field of [...required, ...(Object.hasOwn(effect, "body") ? ["body"] : [])]) {
      if (typeof effect[field] !== "string" || !effect[field].trim()) issues.push(error(`${path}.${field}`, "invalid_text", "Use non-empty text."));
    }
  }
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
