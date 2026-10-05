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
      nextState = applyAchievementStatGrants(nextState, rule);
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
  return Math.max(
    Number(state.runner?.[stat] || 0),
    Number(state.runner?.counters?.[stat] || 0),
    Number(state.runner?.stats?.[stat] || 0)
  );
}

function applyAchievementStatGrants(state, rule) {
  const grants = rule?.grantStats || rule?.rewards?.stats;
  if (!grants || typeof grants !== "object" || Array.isArray(grants)) return state;

  const nextStats = { ...(state.runner?.stats || {}) };
  for (const [name, amount] of Object.entries(grants)) {
    const value = Number(amount);
    if (!name || !Number.isFinite(value)) continue;
    nextStats[name] = Math.max(0, Number(nextStats[name] || 0) + value);
  }

  return {
    ...state,
    runner: {
      ...state.runner,
      stats: nextStats
    }
  };
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
