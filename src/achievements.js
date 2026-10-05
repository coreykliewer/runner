import { unlockAchievement } from "./progression.js";

export function normalizeAchievementRules(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.achievements)) return raw.achievements;
  return [];
}

export function checkAchievementRules(state, rules = []) {
  let nextState = state;
  const unlocked = [];

  for (const rule of normalizeAchievementRules(rules)) {
    if (!ruleMatches(nextState, rule)) continue;

    const before = nextState.runner?.achievements || [];
    nextState = unlockAchievement(nextState, rule);
    const after = nextState.runner?.achievements || [];

    if (after.length > before.length) {
      unlocked.push({
        type: "achievement",
        id: rule.id,
        title: rule.title || rule.id,
        body: rule.body || ""
      });
    }
  }

  return { state: nextState, unlocked };
}

export function getStateStat(state, stat) {
  const statBagValue = state.runner?.stats?.[stat];
  if (statBagValue != null) return Number(statBagValue) || 0;
  return Number(state.runner?.[stat] || 0);
}

function ruleMatches(state, rule) {
  const condition = rule?.when || rule;
  if (!rule?.id || !condition?.stat) return false;
  if (hasAchievement(state, rule.id)) return false;

  const value = getStateStat(state, condition.stat);
  if (condition.atLeast != null) return value >= condition.atLeast;
  if (condition.lessThan != null) return value < condition.lessThan;
  if (condition.equals != null) return value === condition.equals;

  return false;
}

function hasAchievement(state, id) {
  return (state.runner?.achievements || [])
    .some(item => (typeof item === "string" ? item : item.id) === id);
}
