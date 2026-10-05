export const STATE_VERSION = 2;
export const STORAGE_KEY = "runner:v2:state";

export const DEFAULT_CARRY_STATS = {
  hearts: 5,
  score: 0,
  kills: 0,
  turbo: false,
  turboMultiplier: 2
};

const DEFAULT_CARRY_PROGRESS = {
  xp: 0,
  counters: {},
  stats: {},
  achievements: [],
  storyFlags: {},
  narrativeEventsSeen: []
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
  const parts = [
    "v1",
    "h" + (runner?.hearts ?? 0).toString(36),
    "s" + (runner?.score ?? 0).toString(36),
    "k" + (runner?.kills ?? 0).toString(36),
    "t" + ((runner?.turbo ? 1 : 0).toString(36)),
    "m" + ((runner?.turboMultiplier ?? 2).toString(36))
  ];
  const progress = encodeCarryProgress(runner);
  if (progress) parts.push("p" + progress);
  return parts.join(".");
}

export function decodeCarryStats(value) {
  const out = {
    ...DEFAULT_CARRY_STATS,
    ...structuredCloneFallback(DEFAULT_CARRY_PROGRESS)
  };
  if (!value || typeof value !== "string") return out;

  const parts = value.split(".");
  if (parts[0] !== "v1") return out;

  for (const token of parts.slice(1)) {
    if (token.startsWith("h")) out.hearts = parseInt(token.slice(1), 36) || out.hearts;
    else if (token.startsWith("s")) out.score = parseInt(token.slice(1), 36) || out.score;
    else if (token.startsWith("k")) out.kills = parseInt(token.slice(1), 36) || out.kills;
    else if (token.startsWith("t")) out.turbo = (parseInt(token.slice(1), 36) || 0) === 1;
    else if (token.startsWith("m")) out.turboMultiplier = parseInt(token.slice(1), 36) || out.turboMultiplier;
    else if (token.startsWith("p")) {
      Object.assign(out, decodeCarryProgress(token.slice(1)));
    }
  }

  out.hearts = Math.max(0, out.hearts);
  out.score = Math.max(0, out.score);
  out.kills = Math.max(0, out.kills);
  out.turboMultiplier = Math.max(1, out.turboMultiplier);

  return out;
}

function encodeCarryProgress(runner) {
  const payload = {};

  if (Number(runner?.xp || 0) > 0) payload.xp = Number(runner.xp || 0);
  if (hasObjectEntries(runner?.counters)) payload.counters = runner.counters;
  if (hasObjectEntries(runner?.stats)) payload.stats = runner.stats;
  if (Array.isArray(runner?.achievements) && runner.achievements.length > 0) payload.achievements = runner.achievements;
  if (hasObjectEntries(runner?.storyFlags)) payload.storyFlags = runner.storyFlags;
  if (Array.isArray(runner?.narrativeEventsSeen) && runner.narrativeEventsSeen.length > 0) {
    payload.narrativeEventsSeen = runner.narrativeEventsSeen;
  }

  return Object.keys(payload).length > 0 ? encodeJson(payload) : "";
}

function decodeCarryProgress(value) {
  const payload = decodeJson(value);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return structuredCloneFallback(DEFAULT_CARRY_PROGRESS);
  }

  return {
    xp: Number(payload.xp || 0),
    counters: plainObjectOrEmpty(payload.counters),
    stats: plainObjectOrEmpty(payload.stats),
    achievements: Array.isArray(payload.achievements) ? payload.achievements : [],
    storyFlags: plainObjectOrEmpty(payload.storyFlags),
    narrativeEventsSeen: Array.isArray(payload.narrativeEventsSeen) ? payload.narrativeEventsSeen : []
  };
}

function hasObjectEntries(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function plainObjectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function encodeJson(value) {
  const json = encodeURIComponent(JSON.stringify(value));
  if (typeof btoa === "function") return toBase64Url(btoa(json));
  const buffer = globalThis.Buffer;
  if (buffer) return toBase64Url(buffer.from(json, "utf8").toString("base64"));
  return "";
}

function decodeJson(value) {
  try {
    const base64 = fromBase64Url(value);
    const encoded = typeof atob === "function"
      ? atob(base64)
      : globalThis.Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

function toBase64Url(value) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function structuredCloneFallback(value) {
  return JSON.parse(JSON.stringify(value));
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
