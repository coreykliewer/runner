import { decodeDiceEventBatch } from "./tileSystemV2.js";

export const MAX_CHILD_ACTIONS_PER_ROOT = 64;

export function createTileSystemV2RuleDispatcher({
  effectHandlers = {},
  relationMatcher = null,
  maxChildActions = MAX_CHILD_ACTIONS_PER_ROOT
} = {}) {
  if (!Number.isSafeInteger(maxChildActions) || maxChildActions < 0 || maxChildActions > MAX_CHILD_ACTIONS_PER_ROOT) {
    throw new TypeError(`maxChildActions must be an integer from 0 to ${MAX_CHILD_ACTIONS_PER_ROOT}.`);
  }

  const processedEventIds = new Set();
  const appliedConsequenceKeys = new Set();
  const attackerRollKeys = new Set();

  return Object.freeze({
    dispatch,
    getLedgerSnapshot
  });

  function dispatch({ batches, rules = [], state = {}, context = {} } = {}) {
    const batchQueue = normalizeBatches(batches);
    const diagnostics = [];
    const applied = [];
    let currentState = cloneJson(state ?? {});
    const childActionCounts = new Map();
    const stoppedRootActions = new Set();

    for (let queueIndex = 0; queueIndex < batchQueue.length; queueIndex++) {
      const queued = batchQueue[queueIndex];
      const batch = decodeAndFreezeBatch(queued.batch, diagnostics);
      if (!batch) continue;
      const activeRules = queued.rules ?? rules;
      const childQueue = [];
      const pendingConsequences = [];
      const rootActionId = queued.rootActionId ?? batch.actionId;
      const cycleSignatures = queued.cycleSignatures ?? new Set();

      for (const event of batch.events) {
        if (processedEventIds.has(event.eventId)) {
          diagnostics.push(diagnostic("duplicate_event", `Event '${event.eventId}' was already processed.`));
          continue;
        }
        processedEventIds.add(event.eventId);

        const matchingRules = [];
        for (const [ruleIndex, rule] of (Array.isArray(activeRules) ? activeRules : []).entries()) {
          const match = matchRule(rule, event, queued.context ?? context, relationMatcher, diagnostics, ruleIndex);
          if (match) matchingRules.push({ rule, ruleIndex, sourceInstanceId: match.sourceInstanceId });
        }
        matchingRules.sort((left, right) => right.rule.priority - left.rule.priority ||
          left.rule.authorOrder - right.rule.authorOrder || left.ruleIndex - right.ruleIndex);

        for (const matched of matchingRules) {
          const rule = matched.rule;
          const sourceInstanceId = matched.sourceInstanceId;
          const consequenceKey = `${batch.actionId}|${rule.id}|${sourceInstanceId ?? "global"}`;
          if (appliedConsequenceKeys.has(consequenceKey)) continue;
          const usesAttackGuard = rule.activation?.scope === "attacker_per_player_roll" ||
            (rule.activation?.scope == null && (rule.actions || []).some(action => action?.type === "damage" && (action.target == null || action.target === "runner")));
          if (usesAttackGuard) {
            if (!sourceInstanceId) {
              diagnostics.push(diagnostic("missing_attacker_instance", `Rule '${rule.id}' requires a sourceInstanceId for attacker-per-roll activation.`));
              continue;
            }
            const attackKey = `${batch.rollId}|${sourceInstanceId}`;
            if (attackerRollKeys.has(attackKey)) continue;
            attackerRollKeys.add(attackKey);
          }
          appliedConsequenceKeys.add(consequenceKey);
          for (const [effectIndex, effect] of (rule.actions || []).entries()) {
            pendingConsequences.push({
              actionId: batch.actionId,
              rootActionId,
              rollId: batch.rollId,
              event,
              rule,
              sourceInstanceId,
              effect,
              effectIndex,
              ruleIndex: matched.ruleIndex,
              context: queued.context ?? context
            });
          }
        }
      }

      pendingConsequences.sort((left, right) => right.rule.priority - left.rule.priority ||
        left.rule.authorOrder - right.rule.authorOrder ||
        left.event.sequence - right.event.sequence ||
        left.ruleIndex - right.ruleIndex || left.effectIndex - right.effectIndex);

      for (const consequence of pendingConsequences) {
        const cycleSignature = makeCycleSignature(consequence);
        if (cycleSignatures.has(cycleSignature)) {
          diagnostics.push(diagnostic("action_cycle_detected", `Repeated child-action cycle detected at rule '${consequence.rule.id}'.`, consequence));
          continue;
        }
        cycleSignatures.add(cycleSignature);
        const handler = getHandler(effectHandlers, consequence.effect?.type);
        if (!handler) {
          diagnostics.push(diagnostic("unregistered_effect", `No handler registered for typed effect '${consequence.effect?.type}'.`, consequence));
          continue;
        }
        let result;
        try {
          result = handler(cloneJson(consequence.effect), freezeDeep({
            actionId: consequence.actionId,
            rootActionId: consequence.rootActionId,
            rollId: consequence.rollId,
            event: consequence.event,
            rule: cloneJson(consequence.rule),
            sourceInstanceId: consequence.sourceInstanceId,
            state: freezeDeep(cloneJson(currentState)),
            context: freezeDeep(cloneJson(consequence.context))
          })) || {};
        } catch (error) {
          diagnostics.push(diagnostic("effect_handler_error", `Effect '${consequence.effect?.type}' failed: ${error.message}`, consequence));
          continue;
        }
        if (Object.hasOwn(result, "state")) currentState = cloneJson(result.state);
        for (const item of result.diagnostics || []) diagnostics.push({ severity: item.severity || "warning", ...item });
        applied.push({
          actionId: consequence.actionId,
          eventId: consequence.event.eventId,
          ruleId: consequence.rule.id,
          sourceInstanceId: consequence.sourceInstanceId,
          effectType: consequence.effect?.type,
          effectIndex: consequence.effectIndex
        });

        for (const child of result.childActions || []) {
          if (stoppedRootActions.has(rootActionId)) break;
          const childActionCount = childActionCounts.get(rootActionId) || 0;
          if (childActionCount >= maxChildActions) {
            stoppedRootActions.add(rootActionId);
            diagnostics.push(diagnostic("child_action_limit", `Root action '${rootActionId}' reached the ${maxChildActions}-child-action limit; remaining child actions were not queued.`, consequence));
            break;
          }
          const childBatch = child?.batch;
          if (!childBatch) {
            diagnostics.push(diagnostic("invalid_child_action", "Effect handler returned a child action without an event batch.", consequence));
            continue;
          }
          if (childBatch.parentActionId !== consequence.actionId) {
            diagnostics.push(diagnostic("invalid_child_parent", `Child action '${childBatch.actionId}' must name '${consequence.actionId}' as parentActionId.`, consequence));
            continue;
          }
          childActionCounts.set(rootActionId, childActionCount + 1);
          childQueue.push({
            batch: childBatch,
            rules: child.rules ?? activeRules,
            context: child.context ?? consequence.context,
            rootActionId,
            cycleSignatures: new Set(cycleSignatures),
            actionSignature: child.signature ?? null
          });
        }
      }
      batchQueue.push(...childQueue);
    }

    return freezeDeep({
      state: cloneJson(currentState),
      applied,
      diagnostics,
      processedChildActions: [...childActionCounts.values()].reduce((sum, count) => sum + count, 0),
      stoppedAddingChildren: stoppedRootActions.size > 0,
      stoppedRootActions: [...stoppedRootActions]
    });
  }

  function getLedgerSnapshot() {
    return freezeDeep({
      processedEventIds: [...processedEventIds],
      appliedConsequenceKeys: [...appliedConsequenceKeys],
      attackerRollKeys: [...attackerRollKeys]
    });
  }
}

function matchRule(rule, event, context, relationMatcher, diagnostics, ruleIndex) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    diagnostics.push(diagnostic("invalid_rule", `Rule at index ${ruleIndex} is not an object.`));
    return null;
  }
  if (typeof rule.id !== "string" || !rule.id.trim() || !Number.isSafeInteger(rule.priority) || !Number.isSafeInteger(rule.authorOrder)) {
    diagnostics.push(diagnostic("invalid_rule_order", `Rule at index ${ruleIndex} requires id, integer priority, and integer authorOrder.`));
    return null;
  }
  if (!rule.trigger?.events?.includes(event.type)) return null;
  if (rule.trigger.relation != null) {
    if (typeof relationMatcher !== "function") {
      diagnostics.push(diagnostic("spatial_matcher_unavailable", `Rule '${rule.id}' has a spatial relation but no relationMatcher was provided.`));
      return null;
    }
    if (!relationMatcher(rule.trigger.relation, event, context)) return null;
  }
  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) return null;
  for (const condition of rule.conditions) {
    try {
      if (!conditionMatches(condition, event, context)) return null;
    } catch (error) {
      diagnostics.push(diagnostic("condition_error", `Rule '${rule.id}' condition failed safely: ${error.message}.`));
      return null;
    }
  }
  return { sourceInstanceId: rule.sourceInstanceId ?? event.source?.instanceId ?? null };
}

export function conditionMatches(condition, event, context = {}) {
  if (!condition || typeof condition !== "object" || !event?.after) return false;
  const dice = event.after;
  switch (condition.type) {
    case "dice_sum":
      return compare(dice.die1 + dice.die2, condition.operator, condition.value);
    case "dice_value":
      return compare(dice[condition.die], condition.operator, condition.value);
    case "inventory_quantity":
      return compare(inventoryQuantity(context.inventory, condition.itemId), condition.operator, condition.value);
    case "item_used":
      return event.type === "item_used" && Number(event.source?.itemId ?? context.itemUsedId) === condition.itemId;
    case "state_equals": {
      const states = context.states || context.instanceState || {};
      return states[condition.target] === condition.value;
    }
    default:
      return false;
  }
}

function inventoryQuantity(inventory, itemId) {
  if (!inventory || !Number.isSafeInteger(itemId)) return 0;
  let quantity = 0;
  for (const stack of inventory.stacks || []) if (stack?.itemId === itemId) quantity += Number(stack.quantity) || 0;
  for (const instance of inventory.instances || []) if (instance?.itemId === itemId) quantity++;
  return quantity;
}

function compare(left, operator, right) {
  switch (operator) {
    case "<":
    case "lessThan": return left < right;
    case "<=":
    case "lessThanOrEqual": return left <= right;
    case "==":
    case "equals": return left === right;
    case "!=":
    case "notEquals": return left !== right;
    case ">=":
    case "greaterThanOrEqual": return left >= right;
    case ">":
    case "greaterThan": return left > right;
    default: return false;
  }
}

function normalizeBatches(batches) {
  const values = Array.isArray(batches) ? batches : batches ? [batches] : [];
  return values.map(batch => ({ batch, rules: null, context: null, rootActionId: null, cycleSignatures: new Set() }));
}

function decodeAndFreezeBatch(batch, diagnostics) {
  try {
    return freezeDeep(decodeDiceEventBatch(batch));
  } catch (error) {
    diagnostics.push(diagnostic("invalid_event_batch", error.message));
    return null;
  }
}

function getHandler(handlers, type) {
  return handlers instanceof Map ? handlers.get(type) : handlers?.[type];
}

function makeCycleSignature(consequence) {
  return stableStringify({
    ruleId: consequence.rule.id,
    sourceInstanceId: consequence.sourceInstanceId,
    effect: consequence.effect,
    effectIndex: consequence.effectIndex,
    dice: consequence.event.after
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function diagnostic(code, message, details = {}) {
  return { severity: "warning", code, message, ...(details.rule?.id ? { ruleId: details.rule.id } : {}) };
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}