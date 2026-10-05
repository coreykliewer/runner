export const STATE_VERSION = 2;
export const STORAGE_KEY = "runner:v2:state";

export const DEFAULT_CARRY_STATS = {
  hearts: 5,
  score: 0,
  kills: 0,
  turbo: false,
  turboMultiplier: 2
};

export function createInitialState(overrides = {}) {
  return {
    version: STATE_VERSION,
    levelKey: "default",
    exitIndex: 0,
    runner: {
      x: 1,
      y: 1,
      hearts: DEFAULT_CARRY_STATS.hearts,
      score: DEFAULT_CARRY_STATS.score,
      kills: DEFAULT_CARRY_STATS.kills,
      jumpCredits: 0,
      turbo: DEFAULT_CARRY_STATS.turbo,
      turboMultiplier: DEFAULT_CARRY_STATS.turboMultiplier,
      fallDistance: 0,
      xp: 0,
      counters: {},
      stats: {},
      achievements: [],
      storyFlags: {}
    },
    dice: {
      dieValue1: 0,
      dieValue2: 0,
      selectedDie: null,
      rollCount: 0
    },
    world: {
      mapHash: "",
      fogRevealed: [],
      pickupsCollected: [],
      monstersDefeated: [],
      narrativeEventsSeen: []
    },
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

export function encodeCarryStatsFromRunner(runner) {
  return [
    "v1",
    "h" + (runner?.hearts ?? 0).toString(36),
    "s" + (runner?.score ?? 0).toString(36),
    "k" + (runner?.kills ?? 0).toString(36),
    "t" + ((runner?.turbo ? 1 : 0).toString(36)),
    "m" + ((runner?.turboMultiplier ?? 2).toString(36))
  ].join(".");
}

export function decodeCarryStats(value) {
  const out = { ...DEFAULT_CARRY_STATS };
  if (!value || typeof value !== "string") return out;

  const parts = value.split(".");
  if (parts[0] !== "v1") return out;

  for (const token of parts.slice(1)) {
    if (token.startsWith("h")) out.hearts = parseInt(token.slice(1), 36) || out.hearts;
    else if (token.startsWith("s")) out.score = parseInt(token.slice(1), 36) || out.score;
    else if (token.startsWith("k")) out.kills = parseInt(token.slice(1), 36) || out.kills;
    else if (token.startsWith("t")) out.turbo = (parseInt(token.slice(1), 36) || 0) === 1;
    else if (token.startsWith("m")) out.turboMultiplier = parseInt(token.slice(1), 36) || out.turboMultiplier;
  }

  out.hearts = Math.max(0, out.hearts);
  out.score = Math.max(0, out.score);
  out.kills = Math.max(0, out.kills);
  out.turboMultiplier = Math.max(1, out.turboMultiplier);

  return out;
}

export function loadState(storage = globalThis.localStorage, key = STORAGE_KEY) {
  if (!storage) return createInitialState();

  try {
    const raw = storage.getItem(key);
    if (!raw) return createInitialState();
    return migrateState(JSON.parse(raw));
  } catch {
    return createInitialState();
  }
}

export function saveState(state, storage = globalThis.localStorage, key = STORAGE_KEY) {
  if (!storage) return state;

  const next = {
    ...state,
    version: STATE_VERSION,
    updatedAt: new Date().toISOString()
  };

  storage.setItem(key, JSON.stringify(next));
  return next;
}

export function clearState(storage = globalThis.localStorage, key = STORAGE_KEY) {
  if (storage) storage.removeItem(key);
}

export function migrateState(value) {
  const base = createInitialState();
  if (!value || typeof value !== "object") return base;

  return {
    ...base,
    ...value,
    version: STATE_VERSION,
    runner: {
      ...base.runner,
      ...(value.runner || {})
    },
    dice: {
      ...base.dice,
      ...(value.dice || {})
    },
    world: {
      ...base.world,
      ...(value.world || {})
    }
  };
}
