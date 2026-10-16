import { resolveDiceCapacities, validateDiceEventBatch } from "./tileSystemV2.js";

const DICE = ["die1", "die2"];

export function createTileSystemV2DiceEngine({
  registry,
  level = {},
  initialDice = { die1: 0, die2: 0 },
  selectedDie = "die1",
  playerRollLimit = null,
  playerRollCount = 0,
  currentRollId = null
} = {}) {
  const capacities = resolveDiceCapacities(registry, level);
  validateCapacities(capacities);
  if (!DICE.includes(selectedDie)) throw new TypeError("selectedDie must be die1 or die2.");
  if (playerRollLimit != null && (!isPositiveInteger(playerRollLimit) || !Number.isSafeInteger(playerRollCount) || playerRollCount < 0)) {
    throw new TypeError("playerRollLimit must be null or a positive integer, and playerRollCount must be a non-negative integer.");
  }
  if (playerRollLimit == null && (!Number.isSafeInteger(playerRollCount) || playerRollCount < 0)) {
    throw new TypeError("playerRollCount must be a non-negative integer.");
  }

  const startingDice = validateDiceRecord(initialDice, capacities, { allowZero: true });
  let state = freezeDeep({
    dice: startingDice,
    capacities: { ...capacities },
    selectedDie,
    playerRollCount,
    playerRollLimit,
    currentRollId: currentRollId ?? (sumDice(startingDice) > 0 ? "initial-roll" : null)
  });

  function getState() {
    return cloneAndFreeze(state);
  }

  return Object.freeze({
    getState,
    selectDie,
    spendTime,
    changeDice,
    startRoll,
    earlyReroll,
    canStartRoll
  });

  function selectDie(die) {
    if (!DICE.includes(die)) return failure("invalid-die", "Die must be die1 or die2.");
    state = freezeDeep({ ...state, selectedDie: die });
    return success(null);
  }

  function canStartRoll() {
    return sumDice(state.dice) === 0 && !rollLimitReached(state);
  }

  function spendTime({ actionId, cost, source = { kind: "time_spend" }, parentActionId = null } = {}) {
    const valid = validateActionIdentity(actionId, parentActionId);
    if (valid) return failure("invalid-action", valid);
    if (!isNonNegativeInteger(cost)) return failure("invalid-cost", "cost must be a non-negative safe integer.");
    if (sumDice(state.dice) < cost) return failure("unaffordable", "Combined remaining time is less than the requested cost.");
    if (cost === 0) return success(null, { spent: 0, remainingTime: sumDice(state.dice) });

    let remainingCost = cost;
    const changes = [];
    for (const die of [state.selectedDie, otherDie(state.selectedDie)]) {
      const points = Math.min(state.dice[die], remainingCost);
      if (points > 0) {
        changes.push({ die, operation: "spend", amount: points });
        remainingCost -= points;
      }
      if (remainingCost === 0) break;
    }
    const result = changeDice({ actionId, parentActionId, source, changes });
    if (!result.ok) return result;
    return { ...result, spent: cost, remainingTime: sumDice(state.dice) };
  }

  function changeDice({ actionId, parentActionId = null, source = { kind: "dice_change" }, changes } = {}) {
    const valid = validateActionIdentity(actionId, parentActionId);
    if (valid) return failure("invalid-action", valid);
    if (!Array.isArray(changes) || changes.length === 0) return failure("invalid-changes", "changes must be a non-empty ordered array.");

    const beforeState = state;
    const nextDice = { ...state.dice };
    const events = [];
    for (const [index, change] of changes.entries()) {
      const invalid = validateChange(change, `changes[${index}]`);
      if (invalid) return failure("invalid-changes", invalid);
      const oldValue = nextDice[change.die];
      const nextValue = calculateNextValue(oldValue, change);
      if (!Number.isSafeInteger(nextValue) || nextValue < 0 || nextValue > state.capacities[change.die]) {
        return failure("capacity-violation", `${change.die} would leave the range 0..${state.capacities[change.die]}.`);
      }
      const reroll = change.operation === "reroll";
      if (oldValue === nextValue && !reroll) continue;
      const before = { ...nextDice };
      nextDice[change.die] = nextValue;
      const after = { ...nextDice };
      events.push(makeEvent({
        actionId,
        parentActionId,
        rollId: state.currentRollId || actionId,
        sequence: events.length + 1,
        die: change.die,
        type: reroll ? "die_rerolled" : "die_changed",
        operation: change.operation,
        before,
        after,
        valueChanged: oldValue !== nextValue,
        source
      }));
    }
    if (events.length === 0) return success(null, { changed: false, remainingTime: sumDice(state.dice) });

    const batch = makeBatch({ actionId, parentActionId, rollId: state.currentRollId || actionId, events });
    const batchIssues = validateDiceEventBatch(batch);
    if (batchIssues.length) return failure("invalid-event-batch", batchIssues.map(item => `${item.path}: ${item.message}`).join("; "));
    state = freezeDeep({ ...state, dice: nextDice });
    return success(batch, { changed: true, remainingTime: sumDice(state.dice), previousState: beforeState });
  }

  function startRoll({ actionId, values, source = { kind: "player_roll" } } = {}) {
    const valid = validateActionIdentity(actionId, null);
    if (valid) return failure("invalid-action", valid);
    if (sumDice(state.dice) > 0) return failure("unused-time-remains", "Use earlyReroll while unused time remains.");
    if (rollLimitReached(state)) return failure("roll-limit-reached", "The configured player roll limit has been reached.");
    const newValues = validateRolledDice(values, state.capacities);
    if (newValues.error) return failure("invalid-roll", newValues.error);
    return commitRoll({ actionId, values: newValues.dice, source, eventType: "die_rolled" });
  }

  function earlyReroll({ actionId, values, source = { kind: "voluntary_reroll" } } = {}) {
    const valid = validateActionIdentity(actionId, null);
    if (valid) return failure("invalid-action", valid);
    if (sumDice(state.dice) === 0) return failure("no-unused-time", "Early reroll requires unused time; use startRoll when both dice are exhausted.");
    if (rollLimitReached(state)) return failure("roll-limit-reached", "The configured player roll limit has been reached.");
    const newValues = validateRolledDice(values, state.capacities);
    if (newValues.error) return failure("invalid-roll", newValues.error);
    return commitRoll({ actionId, values: newValues.dice, source, eventType: "die_rerolled" });
  }

  function commitRoll({ actionId, values, source, eventType }) {
    const nextRollCount = state.playerRollCount + 1;
    const rollId = actionId;
    const nextDice = { ...state.dice };
    const events = [];
    for (const die of DICE) {
      const before = { ...nextDice };
      const oldValue = nextDice[die];
      nextDice[die] = values[die];
      const after = { ...nextDice };
      events.push(makeEvent({
        actionId,
        parentActionId: null,
        rollId,
        sequence: events.length + 1,
        die,
        type: eventType,
        operation: eventType === "die_rerolled" ? "reroll" : "roll",
        before,
        after,
        valueChanged: oldValue !== values[die],
        source
      }));
    }
    const batch = makeBatch({ actionId, parentActionId: null, rollId, events });
    const batchIssues = validateDiceEventBatch(batch);
    if (batchIssues.length) return failure("invalid-event-batch", batchIssues.map(item => `${item.path}: ${item.message}`).join("; "));
    state = freezeDeep({ ...state, dice: nextDice, playerRollCount: nextRollCount, currentRollId: rollId });
    return success(batch, { playerRollCount: nextRollCount, remainingTime: sumDice(state.dice), discardedTime: eventType === "die_rerolled" ? sumDice(batch.events[0].before) : 0 });
  }

  function rollLimitReached(currentState) {
    return currentState.playerRollLimit != null && currentState.playerRollCount >= currentState.playerRollLimit;
  }

  function success(batch, details = {}) {
    return { ok: true, state: getState(), batch: batch ? freezeDeep(batch) : null, diagnostics: [], ...details };
  }

  function failure(code, message) {
    return { ok: false, code, state: getState(), batch: null, diagnostics: [{ severity: "error", code, message }] };
  }
}

function makeBatch({ actionId, parentActionId, rollId, events }) {
  return {
    format: "runner.dice-event-batch",
    version: 1,
    actionId,
    parentActionId,
    rollId,
    events
  };
}

function makeEvent({ actionId, parentActionId, rollId, sequence, die, type, operation, before, after, valueChanged, source }) {
  return {
    eventId: `${actionId}:${sequence}`,
    actionId,
    parentActionId,
    sequence,
    type,
    die,
    operation,
    before: { ...before },
    after: { ...after },
    valueChanged,
    rollId,
    source: cloneJson(source || { kind: operation })
  };
}

function validateChange(change, path) {
  if (!change || typeof change !== "object" || Array.isArray(change)) return `${path} must be an object.`;
  if (!DICE.includes(change.die)) return `${path}.die must be die1 or die2.`;
  if (!["spend", "add", "set", "reroll"].includes(change.operation)) return `${path}.operation is unsupported.`;
  if (change.operation === "set" || change.operation === "reroll") {
    if (!isNonNegativeInteger(change.value)) return `${path}.value must be a non-negative safe integer.`;
  } else if (!Number.isSafeInteger(change.amount)) return `${path}.amount must be a safe integer.`;
  if (change.operation === "spend" && change.amount < 0) return `${path}.amount for spend must be non-negative.`;
  if (change.operation === "reroll" && change.value < 1) return `${path}.value for reroll must be positive.`;
  return null;
}

function calculateNextValue(current, change) {
  if (change.operation === "set" || change.operation === "reroll") return change.value;
  if (change.operation === "spend") return current - change.amount;
  return current + change.amount;
}

function validateRolledDice(values, capacities) {
  if (!values || typeof values !== "object") return { error: "values must contain die1 and die2." };
  for (const die of DICE) {
    if (!Number.isSafeInteger(values[die]) || values[die] < 1 || values[die] > capacities[die]) {
      return { error: `${die} roll must be an integer in 1..${capacities[die]}.` };
    }
  }
  return { dice: { die1: values.die1, die2: values.die2 } };
}

function validateDiceRecord(dice, capacities, { allowZero }) {
  if (!dice || typeof dice !== "object") throw new TypeError("initialDice must contain die1 and die2.");
  const minimum = allowZero ? 0 : 1;
  for (const die of DICE) {
    if (!Number.isSafeInteger(dice[die]) || dice[die] < minimum || dice[die] > capacities[die]) {
      throw new TypeError(`initial ${die} must be an integer in ${minimum}..${capacities[die]}.`);
    }
  }
  return { die1: dice.die1, die2: dice.die2 };
}

function validateCapacities(capacities) {
  for (const die of DICE) if (!Number.isSafeInteger(capacities[die]) || capacities[die] < 1) throw new TypeError(`${die} capacity must be a positive safe integer.`);
}

function validateActionIdentity(actionId, parentActionId) {
  if (typeof actionId !== "string" || !actionId.trim()) return "actionId is required.";
  if (parentActionId != null && (typeof parentActionId !== "string" || !parentActionId.trim())) return "parentActionId must be null or a non-empty string.";
  return null;
}

function otherDie(die) { return die === "die1" ? "die2" : "die1"; }
function sumDice(dice) { return dice.die1 + dice.die2; }
function isPositiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function isNonNegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
function cloneJson(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function cloneAndFreeze(value) { return freezeDeep(cloneJson(value)); }
function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}