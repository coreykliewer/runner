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

function ruleMatches(state, rule) {
  const condition = rule?.when || rule;
  if (!rule?.id || !condition?.stat) return false;
  if (hasAchievement(state, rule.id)) return false;

  const value = Number(state.runner?.[condition.stat] || 0);
  if (condition.atLeast != null) return value >= condition.atLeast;
  if (condition.lessThan != null) return value < condition.lessThan;
  if (condition.equals != null) return value === condition.equals;

  return false;
}

function hasAchievement(state, id) {
  return (state.runner?.achievements || [])
    .some(item => (typeof item === "string" ? item : item.id) === id);
}
