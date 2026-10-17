import { evaluatePropertyRules, validateRunnerProperties } from "./propertyRules.js";

export function restorePropertyEntry(value, runId) {
  return value && typeof value.runId === "string" && value.runId.trim() &&
    Number.isSafeInteger(value.sequence) && value.sequence >= 0
    ? { runId: value.runId, sequence: value.sequence }
    : typeof runId === "string" && runId.trim() ? { runId, sequence: 0 } : null;
}

export function createTileEntryBatch({ entryState, from, to, cause, source, properties, rollId = null }) {
  const sequence = entryState.sequence + 1;
  const actionId = `${entryState.runId}:entry:${sequence}`;
  return decodeTileEntryBatch({ format: "runner.tile-entry-batch", version: 1,
    actionId, parentActionId: null, rollId, events: [{ type: "tile_entered", eventId: actionId,
      actionId, parentActionId: null, rollId, sequence: 1, entrySequence: sequence,
      runId: entryState.runId, from, to, cause, source, before: properties, after: properties }] });
}

export function decodeTileEntryBatch(value) {
  const batch = JSON.parse(JSON.stringify(value));
  const event = batch?.events?.[0];
  const point = value => value && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y);
  if (batch?.format !== "runner.tile-entry-batch" || batch.version !== 1 || !Array.isArray(batch.events) || batch.events.length !== 1 ||
      !event || event.type !== "tile_entered" || typeof event.runId !== "string" || !event.runId.trim() ||
      !Number.isSafeInteger(event.entrySequence) || event.entrySequence < 1 ||
      batch.actionId !== `${event.runId}:entry:${event.entrySequence}` || event.eventId !== batch.actionId || event.actionId !== batch.actionId ||
      batch.parentActionId !== null || event.parentActionId !== null || event.sequence !== 1 || event.rollId !== batch.rollId ||
      !point(event.from) || !point(event.to) || (event.from.x === event.to.x && event.from.y === event.to.y) ||
      typeof event.cause !== "string" || !event.cause || typeof event.source?.instanceId !== "string" || !event.source.instanceId ||
      validateRunnerProperties(event.before).length || validateRunnerProperties(event.after).length ||
      JSON.stringify(event.before) !== JSON.stringify(event.after)) throw new TypeError("Invalid tile-entry batch.");
  return freeze(batch);
}

export function tileEntryRule(source, definition) {
  return { id: "tile-entry-properties", sourceInstanceId: source.instanceId, source,
    priority: 0, authorOrder: 0, trigger: { events: ["tile_entered"] }, conditions: [{ type: "tile_entry" }],
    actions: [{ type: "property_rules", ...(Object.hasOwn(definition, "propertyRules") ? { rules: definition.propertyRules } : {}) }] };
}

export function applyTileEntry(action, event, properties, entryState) {
  if (event.runId !== entryState.runId || event.entrySequence !== entryState.sequence + 1) {
    return { applied: false, diagnostics: [{ code: "entry_replay_or_out_of_order", eventId: event.eventId }] };
  }
  const evaluation = Object.hasOwn(action, "rules") ? evaluatePropertyRules(action.rules, event.before) : null;
  return { applied: true, properties: evaluation?.ok ? evaluation.properties : properties,
    entryState: { runId: event.runId, sequence: event.entrySequence }, evaluation,
    diagnostics: evaluation?.diagnostics || [] };
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
