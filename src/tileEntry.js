import { evaluatePropertyRules, createPropertyRuleExecution, validateRunnerProperties } from "./propertyRules.js";
import { validateBuiltInValues } from "./runnerPropertyNames.js";

export function restorePropertyEntry(value, runId) {
  const execution = restoreExecution(value?.execution);
  return value && typeof value.runId === "string" && value.runId.trim() &&
    Number.isSafeInteger(value.sequence) && value.sequence >= 0
    ? { runId: value.runId, sequence: value.sequence, ...(execution ? { execution } : {}) }
    : typeof runId === "string" && runId.trim() ? { runId, sequence: 0 } : null;
}

function restoreExecution(value) {
  if (!value || typeof value.eventId !== "string" ||
      !["pending", "completed", "failed", "uncertain", "terminal"].includes(value.status)) return null;
  const diagnostics = Array.isArray(value.diagnostics) ? value.diagnostics.filter(item =>
    item && typeof item.code === "string" && typeof item.message === "string")
    .map(item => ({ code: item.code, message: item.message })) : [];
  if (value.status === "pending") diagnostics.unshift({ code: "native_outcome_uncertain_restore",
    message: "A pending native attempt was restored; its entry remains consumed and will not be retried." });
  return { eventId: value.eventId, status: value.status === "pending" ? "uncertain" : value.status,
    effectKey: typeof value.effectKey === "string" ? value.effectKey : null,
    diagnostics };
}

// Adapts the existing interpreter to authoritative state and strict checkpoints.
// This function schedules no effects and never retries a consumed entry.
export function executeTileEntry(action, event, runner, { checkpoint, handlers, readNativeValues, isTerminal = () => false, observe = () => {} }) {
  const previous = runner.propertyEntry;
  if (event.runId !== previous.runId || event.entrySequence !== previous.sequence + 1) {
    return { applied: false, diagnostics: [{ code: "entry_replay_or_out_of_order", eventId: event.eventId }] };
  }
  const v3 = action.rules?.version === 3;
  const execution = createPropertyRuleExecution(action.rules, event.before, v3 ? { nativeValues: event.nativeValues } : {});
  let step = execution.next();
  const entry = { runId: event.runId, sequence: event.entrySequence,
    execution: { eventId: event.eventId, status: "completed", effectKey: null, diagnostics: [] } };
  runner.propertyEntry = entry;
  const diagnostics = entry.execution.diagnostics;
  let uncertain = false;
  const report = (code, error) => {
    const item = { code, message: String(error?.message || error) };
    diagnostics.push(item);
    try { observe({ type: "property_native_diagnostic", eventId: event.eventId, ...item }); } catch { /* Diagnostic only. */ }
  };
  while (!step.done) {
    const request = step.value.effect;
    runner.properties = step.value.evaluation.properties;
    entry.execution.effectKey = request.effectKey;
    entry.execution.status = "pending";
    let status;
    try {
      checkpoint(); // Must succeed before a handler can cause any side effect.
    } catch (error) {
      report("native_checkpoint_before_failed", error);
      status = "failed";
    }
    if (!status) {
      try {
        const handler = handlers[request.type];
        if (typeof handler !== "function") throw new Error(`No native adapter for ${request.type}`);
        handler(request.effect, request);
        status = isTerminal() ? "terminal" : "applied";
      } catch (error) {
        uncertain = true;
        report("native_effect_uncertain", error);
        status = "failed";
      }
    }
    let nativeValues;
    if (v3) {
      try { nativeValues = readNativeValues(); }
      catch (error) { uncertain = true; report("native_snapshot_after_failed", error); status = "failed"; }
    }
    entry.execution.status = uncertain ? "uncertain" : status === "applied" ? "completed" : status;
    try { checkpoint(); } catch (error) {
      uncertain = true;
      entry.execution.status = "uncertain";
      report("native_checkpoint_after_failed", error);
      status = "failed";
    }
    try { observe({ type: "property_native_effect", eventId: event.eventId, source: event.source,
      effectKey: request.effectKey, effect: request.effect, status: entry.execution.status, terminal: isTerminal() }); } catch { /* Diagnostic only. */ }
    step = execution.next({ status, ...(v3 && nativeValues ? { nativeValues } : {}) });
  }
  const evaluation = step.value;
  // Invalid definitions have no prefix to commit; runtime failures retain their prefix.
  if (evaluation.status !== "invalid") runner.properties = evaluation.properties;
  entry.execution.status = uncertain ? "uncertain" : evaluation.status === "completed" ? "completed" : evaluation.status === "terminal" ? "terminal" : "failed";
  diagnostics.push(...evaluation.diagnostics.map(item => ({ code: item.code, message: item.message })));
  try { checkpoint(); } catch (error) {
    entry.execution.status = "uncertain";
    report("native_checkpoint_final_failed", error);
  }
  return { applied: true, evaluation, diagnostics: [...diagnostics], entryState: entry, properties: runner.properties };
}

export function createTileEntryBatch({ entryState, from, to, cause, source, properties, rollId = null, nativeValues }) {
  const sequence = entryState.sequence + 1;
  const actionId = `${entryState.runId}:entry:${sequence}`;
  return decodeTileEntryBatch({ format: "runner.tile-entry-batch", version: 1,
    actionId, parentActionId: null, rollId, events: [{ type: "tile_entered", eventId: actionId,
      actionId, parentActionId: null, rollId, sequence: 1, entrySequence: sequence,
      runId: entryState.runId, from, to, cause, source, before: properties, after: properties,
      ...(nativeValues !== undefined ? { nativeValues } : {}) }] });
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
      JSON.stringify(event.before) !== JSON.stringify(event.after) ||
      (Object.hasOwn(event, "nativeValues") && validateBuiltInValues(event.nativeValues).length)) throw new TypeError("Invalid tile-entry batch.");
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
