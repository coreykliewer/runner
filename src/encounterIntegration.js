import { createTileSystemV2RuleDispatcher } from "./tileSystemV2RuleDispatcher.js";
import { calculateEncounterDistance, encounterPositionMatches } from "./encounterRules.js";
export { evaluateEncounterExpression } from "./encounterRules.js";

// Enabled authored encounters explicitly replace automatic legacy attacks at this source.
export function encounterOwner(definition) {
  return definition?.encounterRules?.enabled === true ? "dispatcher" : "legacy";
}

export function encounterDispatcherRules(sources, phase) {
  return sources.flatMap(source => {
    if (encounterOwner(source.definition) !== "dispatcher") return [];
    return (source.definition.encounterRules.rules || []).filter(rule => rule.trigger?.events?.includes(phase)).map(rule => ({
      id: `${source.instanceId}:${rule.id}`,
      sourceInstanceId: source.instanceId,
      priority: rule.priority ?? 0,
      authorOrder: rule.order,
      trigger: { events: ["die_changed", "die_rerolled", "die_rolled"], relation: { ...rule.trigger, x: source.x, y: source.y } },
      conditions: (rule.conditions || []).map(condition => ({ type: "encounter", condition })),
      actions: rule.actions
    }));
  });
}

export function createEncounterDispatcher(damage) {
  return createTileSystemV2RuleDispatcher({
    effectHandlers: { damage },
    relationMatcher: (relation, event, context) => {
      const dx = context.player.x - relation.x;
      const dy = context.player.y - relation.y;
      const distance = calculateEncounterDistance(dx, dy, relation.distance);
      return distance >= relation.minDistance && distance <= relation.maxDistance &&
        encounterPositionMatches(dx, dy, relation.position);
    }
  });
}
