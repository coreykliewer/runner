export function normalizeRollLimit(value) {
  if (value === undefined || value === null || value === "") return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function getLevelRollLimit(level) {
  if (!level || typeof level !== "object") return null;
  return normalizeRollLimit(level.rollLimit);
}

export function getRollLimitState({ rollLimit = null, rollsUsed = 0 } = {}) {
  const limit = normalizeRollLimit(rollLimit);
  const used = Number.isFinite(Number(rollsUsed)) ? Math.max(0, Number(rollsUsed)) : 0;

  return {
    rollLimit: limit,
    rollsUsed: used,
    rollsRemaining: limit === null ? null : Math.max(0, limit - used),
    percentConsumed: limit === null ? 0 : Math.min(100, Math.max(0, (used / limit) * 100))
  };
}

export function hasRollLimitExpired({ rollLimit = null, rollsUsed = 0 } = {}) {
  const state = getRollLimitState({ rollLimit, rollsUsed });
  return state.rollLimit !== null && state.rollsRemaining === 0;
}
