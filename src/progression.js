export function addXp(state, amount) {
  const value = Number.isFinite(amount) ? amount : 0;
  const runner = {
    ...state.runner,
    xp: Math.max(0, (state.runner?.xp || 0) + value)
  };
  return { ...state, runner };
}

export function unlockAchievement(state, achievement) {
  const id = typeof achievement === "string" ? achievement : achievement?.id;
  if (!id) return state;

  const current = state.runner?.achievements || [];
  if (current.some(item => (typeof item === "string" ? item : item.id) === id)) return state;

  const nextAchievement = typeof achievement === "string"
    ? { id, unlockedAt: new Date().toISOString() }
    : { ...achievement, unlockedAt: achievement.unlockedAt || new Date().toISOString() };

  return {
    ...state,
    runner: {
      ...state.runner,
      achievements: [...current, nextAchievement]
    }
  };
}

export function setStoryFlag(state, flag, value = true) {
  if (!flag) return state;

  return {
    ...state,
    runner: {
      ...state.runner,
      storyFlags: {
        ...(state.runner?.storyFlags || {}),
        [flag]: value
      }
    }
  };
}
