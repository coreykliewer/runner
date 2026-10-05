import { unlockAchievement } from "./progression.js";

export function normalizeAchievementRules(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.achievements)) return raw.achievements;
  return [];
}

export function checkAchievementRules(state, rules = [], context = {}) {
  let nextState = state;
  const unlocked = [];

  for (const rule of normalizeAchievementRules(rules)) {
    if (!ruleMatches(nextState, rule, context)) continue;

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

function ruleMatches(state, rule, context = {}) {
  const condition = rule?.when || rule;
  if (!rule?.id || !condition) return false;
  if (hasAchievement(state, rule.id)) return false;

  return conditionMatches(state, condition, context);
}

function conditionMatches(state, condition, context = {}) {
  if (!condition || typeof condition !== "object") return false;

  if (Array.isArray(condition.all)) {
    return condition.all.every(item => conditionMatches(state, item, context));
  }

  if (Array.isArray(condition.any)) {
    return condition.any.some(item => conditionMatches(state, item, context));
  }

  if (condition.left != null && condition.operator && condition.right != null) {
    return compareValues(
      resolveValue(condition.left, state, context),
      condition.operator,
      resolveValue(condition.right, state, context)
    );
  }

  if (!condition.stat) return false;

  const value = getStateStat(state, condition.stat);
  if (condition.atLeast != null) return value >= condition.atLeast;
  if (condition.lessThan != null) return value < condition.lessThan;
  if (condition.equals != null) return value === condition.equals;

  return false;
}

export function resolveValue(ref, state, context = {}) {
  if (ref && typeof ref === "object" && !Array.isArray(ref)) {
    if (Object.hasOwn(ref, "literal")) return ref.literal;
    if (ref.path) return resolveValue(ref.path, state, context);
    if (ref.stat) return getStateStat(state, ref.stat);
  }

  if (typeof ref !== "string") return ref;

  const scoped = {
    ...context,
    runner: state.runner || {},
    counters: state.runner?.counters || {},
    stats: state.runner?.stats || {},
    storyFlags: state.runner?.storyFlags || {}
  };
  const pathValue = getPath(scoped, ref);
  if (pathValue !== undefined) return pathValue;

  return getStateStat(state, ref);
}

function compareValues(left, operator, right) {
  if (left === undefined || right === undefined) return false;

  if (operator === "equals") return left === right;
  if (operator === "notEquals") return left !== right;

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;

  if (operator === "lessThan") return leftNumber < rightNumber;
  if (operator === "atMost") return leftNumber <= rightNumber;
  if (operator === "greaterThan") return leftNumber > rightNumber;
  if (operator === "atLeast") return leftNumber >= rightNumber;

  return false;
}

function getPath(source, path) {
  return path.split(".").reduce((value, key) => {
    if (value == null || !Object.hasOwn(Object(value), key)) return undefined;
    return value[key];
  }, source);
}

function hasAchievement(state, id) {
  return (state.runner?.achievements || [])
    .some(item => (typeof item === "string" ? item : item.id) === id);
}
