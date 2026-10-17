import { createTileSystemV2RuleDispatcher } from "./tileSystemV2RuleDispatcher.js";
import { calculateEncounterDistance, encounterPositionMatches } from "./encounterRules.js";
export { evaluateEncounterExpression } from "./encounterRules.js";
export { createDevelopmentTrace, developmentTraceEnabled } from "./developmentTrace.js";
export { createTileEntryBatch, tileEntryRule, applyTileEntry, restorePropertyEntry } from "./tileEntry.js";

// Enabled authored encounters explicitly replace automatic legacy attacks at this source.
export function encounterOwner(definition) {
  return definition?.encounterRules?.enabled === true ? "dispatcher" : "legacy";
}

export function encounterDispatcherRules(sources, phase) {
  return sources.flatMap(source => {
    if (encounterOwner(source.definition) !== "dispatcher") return [];
    return (source.definition.encounterRules.rules || []).filter(rule => rule.trigger?.events?.includes(phase) ||
      (phase !== "turn_ended" && rule.trigger?.events?.includes("dice_changed"))).map(rule => ({
      id: `${source.instanceId}:${rule.id}`,
      sourceInstanceId: source.instanceId,
      source: { tileId: source.tileId, name: source.name, x: source.x, y: source.y, authoredRuleId: rule.id },
      priority: rule.priority ?? 0,
      authorOrder: rule.order,
      ...(rule.activation ? { activation: rule.activation } : {}),
      trigger: { events: phase === "turn_ended" ? ["turn_ended"] : ["die_changed", "die_rerolled", "die_rolled"], relation: { ...rule.trigger, x: source.x, y: source.y } },
      conditions: (rule.conditions || []).map(condition => ({ type: "encounter", condition })),
      actions: rule.actions
    }));
  });
}

export function createEncounterDispatcher(damage, observer = null, initialLedger = {}, effectHandlers = {}) {
  return createTileSystemV2RuleDispatcher({
    effectHandlers: { ...effectHandlers, damage },
    observer,
    initialLedger,
    relationMatcher: (relation, event, context) => {
      const dx = context.player.x - relation.x;
      const dy = context.player.y - relation.y;
      const distance = calculateEncounterDistance(dx, dy, relation.distance);
      return distance >= relation.minDistance && distance <= relation.maxDistance &&
        encounterPositionMatches(dx, dy, relation.position);
    }
  });
}
