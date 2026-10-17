// Lifecycle events use the same dispatcher, without pretending to mutate a die.
export function createTurnEndedBatch(actionId, rollId, dice) {
  return decodeTurnEventBatch({ format: "runner.turn-event-batch", version: 1,
    actionId, parentActionId: null, rollId, events: [{
      eventId: `${actionId}:ended`, actionId, parentActionId: null, rollId,
      sequence: 1, type: "turn_ended", before: { ...dice }, after: { ...dice },
      source: { kind: "end_turn" }
    }] });
}

export function decodeTurnEventBatch(value) {
  const batch = JSON.parse(JSON.stringify(value));
  const event = batch?.events?.[0];
  if (batch?.format !== "runner.turn-event-batch" || batch.version !== 1 || batch.events.length !== 1 ||
      ![batch.actionId, batch.rollId, event?.eventId].every(id => typeof id === "string" && id.trim()) ||
      event.type !== "turn_ended" || event.actionId !== batch.actionId || event.rollId !== batch.rollId ||
      batch.parentActionId !== null || event.parentActionId !== null || event.sequence !== 1 ||
      event.source?.kind !== "end_turn" ||
      ![event.before?.die1, event.before?.die2, event.after?.die1, event.after?.die2].every(n => n === 0)) {
    throw new TypeError("Invalid turn-ended event batch.");
  }
  return freeze(batch);
}

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
