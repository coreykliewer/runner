// EDIT NOTE: Declared `currentExitIndex` as an explicit top-level game state variable to avoid implicit global assignment.
//version 1.5 Final - 3/28
// ================================================ = == = ========
// Dice display + spin
// ============================================================
let diceDisplayRevision = 0;
window.updateDiceDisplay = function(a, b, shouldSpin = true) {
  const revision = ++diceDisplayRevision;
  const die1 = document.getElementById("die1");
  const die2 = document.getElementById("die2");

  if (!die1 || !die2) {
    console.error("Dice elements not found");
    return;
  }

  if (shouldSpin) {
    spinDie(die1);
    spinDie(die2);
  }

  setTimeout(() => {
    if (revision !== diceDisplayRevision) return;
    die1.textContent = a;
    die2.textContent = b;
  }, shouldSpin ? 250 : 0);
};

function spinDie(element) {
  if (!element) return;
  element.style.transition = "transform 0.25s ease";
  element.style.transform = "rotate(360deg)";
  setTimeout(() => element.style.transform = "rotate(0deg)", 250);
}

window.diagonalJump = function(dx) {
  singleMove(dx, -1, { diagonal: true });
};

// ============================================================
// Canvas + globals
// ============================================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const VERSION = "Runner Prototype v1.4 Log";
canvas.focus();

const TILE_SIZE = 32;
const ROWS = 15;
const COLS = 25;

let manualWaterEntry = false;
let gameOver = false;
let encounterDispatcher = null;
let encounterBatchCursor = 0;
let developmentTrace = null;
let turnTransaction = false;
let turnOutcome = null;
let restoredTurn = null;
let rollCount = 0;
let dieValue1 = 0;
let dieValue2 = 0;
let selectedDie = null;
let diceEngine = null;
const diceEventBatches = [];
let TileSystemV2Module = null;
let TileSystemV2DiceEngineModule = null;
let deathReason = "";
let bounceHeight = [];
let sinkDelayMap = [];
let turboExecuting = false;
// Global grid/runner variables (initialized in initGame)
let grid = [];
let runner = null; 
let monsterStateMap = [];
let currentLevelKey = "default";
let currentExitIndex = 0;
let currentMapString = "";
let runnerArtTileId = null;
let turboGravityUsed = false;
let kills = 0;

window.getRunnerDiceEventBatches = () => diceEventBatches.slice();
window.getRunnerDiceEngineState = () => diceEngine?.getState() || null;

function getLevelRollLimit(levelKey = currentLevelKey) {
  const level = LEVELS?.levels?.[levelKey];
  if (!level || typeof level !== "object") return null;
  const raw = level.rollLimit;
  if (raw === undefined || raw === null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function calculateCurrentRollLimitState() {
  const limit = getLevelRollLimit(currentLevelKey);
  const used = Number.isFinite(Number(rollCount)) ? Math.max(0, Number(rollCount)) : 0;
  return {
    rollLimit: limit,
    rollsUsed: used,
    rollsRemaining: limit === null ? null : Math.max(0, limit - used),
    percentConsumed: limit === null ? 0 : Math.min(100, Math.max(0, (used / limit) * 100))
  };
}

window.getCurrentRollLimitState = function() {
  return calculateCurrentRollLimitState();
};

function safeDecodeURIComponent(s) {
  try { return decodeURIComponent(s); }
  catch { return s; }
}

/**
 * Extract a single hash param value without URLSearchParams brittleness.
 * Reads from "#..." and returns the raw (still-encoded) value.
 */
function getHashParamRaw(name) {
  const hash = (window.location.hash || "").replace(/^#/, "");
  if (!hash) return null;

  // split by & only (we never use "." or "~" as param separators)
  const parts = hash.split("&");
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const k = p.slice(0, eq);
    if (k === name) return p.slice(eq + 1);
  }
  return null;
}

function getStatsFromURL() {
  const raw = getHashParamRaw("st");
  return raw ? safeDecodeURIComponent(raw) : null;
}

function shouldResumeFromLocalState() {
  const raw = getHashParamRaw("resume");
  return raw === "1" || raw === "true";
}

  
function getMapFromURL() {
  const raw = getHashParamRaw("map");
  if (raw != null && raw !== "") {
    const encoded = safeDecodeURIComponent(raw);
    const mapVersion = getHashParamRaw("mapv");
    if (mapVersion == null) return encoded;
    if (mapVersion !== "1") throw new Error(`Unsupported URL map version '${mapVersion}'.`);
    const map = JSON.parse(encoded);
    if (!TileCompatibilityModule?.isNumericMapDocument(map)) {
      throw new Error("URL map version does not match its numeric map document.");
    }
    return map;
  }
  return null;
}

function getLevelFromURL() {
  const raw = getHashParamRaw("level");
  return raw ? safeDecodeURIComponent(raw) : null;
}


function onCanvasClick(e) {
  if (!canvas || !grid || !grid.length) return;

  // If modal open, click closes it (recommended behavior)
  if (modalOpen) { hideModalMessage(); return; }

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;

  const tx = Math.floor(cx / TILE_SIZE);
  const ty = Math.floor(cy / TILE_SIZE);

  if (tx < 0 || ty < 0 || ty >= grid.length || tx >= grid[0].length) return;

  const MAX_INSPECT_DIST = 5;
  const dist = tileDistanceFromRunner(tx, ty);

  if (dist > MAX_INSPECT_DIST) {
    showModalMessage(defaultFarClickMessage(tx, ty, MAX_INSPECT_DIST));
    return;
  }

  const hint = getTileHintAt(tx, ty);
  if (hint) {
    showModalMessage(hint); // or setMessage(hint) if you prefer
  } else {
    showModalMessage(`Tile: ${tileAt(tx, ty)} (${tx},${ty})`);
  }
}


canvas.addEventListener("click", onCanvasClick);




// ============================================================
// Grid overlays caling
// ============================================================
function updateGridScale() {
  const overlay = document.getElementById("gameGridOverlay");
  if (!overlay) return;
  const realWidth = canvas.width;
  const realHeight = canvas.height;
  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  overlay.style.setProperty("--scale-x", displayWidth / realWidth);
  overlay.style.setProperty("--scale-y", displayHeight / realHeight);
}

updateGridScale();
window.addEventListener("resize", updateGridScale);

// ============================================================
// TILE metadata (attribute-based) + load tiles2.json
// ============================================================
let AIR_TILE_ID = null;
let PLAYER_ART_TILE_ID = null;
let currentMapSpawn = null;

function svgToImg(svg) {
  const img = new Image();
  img.src = "data:image/svg+xml;base64," + btoa(svg);
  return img;
}

function getTileVariantGroup(definition, bucket) {
  const nested = definition?.variants?.[bucket];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  const legacy = definition?.[bucket];
  return legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy : null;
}

function prepareNumericTileImages() {
  for (const tile of NormalizedTileRegistry?.registry?.tiles || []) {
    const definition = tile.definition;
    if (typeof definition.svg === "string" && definition.svg.trim()) definition.img = svgToImg(definition.svg);
    for (const bucket of GAME_VARIANT_BUCKETS) {
      const group = getTileVariantGroup(definition, bucket);
      for (const variant of Object.values(group || {})) {
        if (typeof variant?.svg === "string" && variant.svg.trim()) variant.img = svgToImg(variant.svg);
      }
    }
  }
}

function startGameLoop() {
  console.log("[Runner] Starting game loop...");
  loop();
}

// ============================================================
// TILE FETCHING logic
// ============================================================
const TILE_URLS = [
    "tiles2.json",
  "tiles2.legacy.json",
    "https://corsproxy.io/?https://clikproductions.com/runner/tiles2.json",
    "https://api.allorigins.win/raw?url=https://clikproductions.com/runner/tiles2.json"
];

const LEVEL_URL = "levels.json";
const NARRATIVE_URL = "fixtures/level1-narrative.json";
const ACHIEVEMENTS_URL = "achievements.json";
const GAME_VARIANT_BUCKETS = ["monster", "lock", "sign", "exit", "platform", "pickup", "decor"];
let LEVELS = null;
let StateModule = null;
let ResumeLinksModule = null;
let LevelRoutingModule = null;
let GameMapRuntimeModule = null;
let TileCompatibilityModule = null;
let NormalizedTileRegistry = null;
let NarrativeEventsModule = null;
let EncounterRulesModule = null;
let AchievementsModule = null;
let NARRATIVE_EVENTS = [];
let ACHIEVEMENT_RULES = [];

function addCacheBust(url) {
  const cb = "cb=" + Date.now();

  // 1) corsproxy pattern: https://corsproxy.io/?<TARGET_URL>
  if (url.startsWith("https://corsproxy.io/?")) {
    const target = url.slice("https://corsproxy.io/?".length);
    const targetWithCb = target + (target.includes("?") ? "&" : "?") + cb;
    return "https://corsproxy.io/?" + targetWithCb;
  }

  // 2) allorigins pattern: .../raw?url=<ENCODED_TARGET>
  // Keep it simple: just add cb to the *allorigins* URL; allorigins tolerates extra params.
  // (If you want it inside the target URL, we can do that too.)
  return url + (url.includes("?") ? "&" : "?") + cb;
}

function tryFetch(urls) {
  const url = urls.shift();
  if (!url) return Promise.reject(new Error("All tile loading attempts failed."));

  const freshUrl = addCacheBust(url);

  return fetch(freshUrl, { cache: "no-store" })
    .then(res => {
      if (!res.ok) {
        console.warn(`[Runner] Failed to load from ${url}. Trying next URL...`);
        return tryFetch(urls);
      }
      return res.clone().json()
        .then(() => {
          console.log(`[Runner] Successfully loaded tiles from: ${url}`);
          return res;
        })
        .catch(err => {
          console.warn(`[Runner] Invalid tile JSON from ${url}. Trying next URL...`, err);
          return tryFetch(urls);
        });
    })
    .catch(err => {
      console.warn(`[Runner] Network error for ${url}. Trying next URL...`, err);
      return tryFetch(urls);
    });
}

function loadLevels() {
  return fetch(addCacheBust(LEVEL_URL), { cache: "no-store" })
    .then(res => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(json => {
      LEVELS = normalizeLevels(json);
      console.log("[Runner] levels.json loaded successfully.");
      return LEVELS;
    })
    .catch(err => {
      LEVELS = null;
      console.warn("[Runner] Failed to load levels.json; using tiles2.json embedded maps.", err);
      return null;
    });
}

function normalizeLevels(json) {
  const levels = json?.levels && typeof json.levels === "object" ? json.levels : {};
  return {
    defaultLevel: json?.defaultLevel || "default",
    levels
  };
}

function getLevelMap(levelKey = "default") {
  const fromLevels = LEVELS?.levels?.[levelKey]?.map;
  if (isMapDocument(fromLevels)) return fromLevels;

  const fromTileExit = getLegacyEmbeddedLevelMap(levelKey);
  if (typeof fromTileExit === "string" && fromTileExit.trim()) return fromTileExit;

  return null;
}

function getLegacyEmbeddedLevelMap(levelKey) {
  for (const tile of NormalizedTileRegistry?.registry?.tiles || []) {
    const definition = tile.definition;
    if (definition?.exit === true && typeof definition[levelKey] === "string" && definition[levelKey].trim()) {
      return definition[levelKey];
    }
  }
  return null;
}

function isMapDocument(value) {
  return (typeof value === "string" && value.trim().length > 0) ||
    !!TileCompatibilityModule?.isNumericMapDocument(value);
}

function getDefaultLevelKey() {
  return LEVELS?.defaultLevel || "default";
}

function loadStateModule() {
  return import("./src/state.js")
    .then(module => {
      StateModule = module;
      console.log("[Runner] state.js loaded successfully.");
      return module;
    })
    .catch(err => {
      StateModule = null;
      console.warn("[Runner] Failed to load state.js; local persistence disabled.", err);
      return null;
    });
}

function loadResumeLinksModule() {
  return import("./src/resumeLinks.js")
    .then(module => {
      ResumeLinksModule = module;
      window.getRunnerResumeLink = () => {
        const hasCheckpoint = !!StateModule && !!window.localStorage?.getItem(StateModule.STORAGE_KEY);
        const checkpoint = hasCheckpoint ? StateModule.loadState() : null;
        return module.createResumeUrl(window.location.href, {
          level: checkpoint?.levelKey || currentLevelKey || "default",
          runner: checkpoint?.runner || runner
        });
      };
      console.log("[Runner] resumeLinks.js loaded successfully.");
      return module;
    })
    .catch(err => {
      ResumeLinksModule = null;
      console.warn("[Runner] Failed to load resumeLinks.js; portal links will use fallback hash generation.", err);
      return null;
    });
}

function loadLevelRoutingModule() {
  return import("./src/levelRouting.js")
    .then(module => {
      LevelRoutingModule = module;
      return module;
    })
    .catch(err => {
      LevelRoutingModule = null;
      console.warn("[Runner] Failed to load level routing module.", err);
      return null;
    });
}

function loadGameMapRuntimeModule() {
  return import("./src/gameMapRuntime.js")
    .then(module => {
      GameMapRuntimeModule = module;
      console.log("[Runner] gameMapRuntime.js loaded successfully.");
      return module;
    })
    .catch(err => {
      GameMapRuntimeModule = null;
      console.warn("[Runner] Failed to load gameMapRuntime.js; using fallback map decoder.", err);
      return null;
    });
}

function loadTileSystemV2DiceModule() {
  return Promise.all([
    import("./src/tileSystemV2.js"),
    import("./src/tileSystemV2DiceEngine.js")
  ])
    .then(([tileSystem, diceEngineModule]) => {
      TileSystemV2Module = tileSystem;
      TileSystemV2DiceEngineModule = diceEngineModule;
      return diceEngineModule;
    })
    .catch(error => {
      TileSystemV2Module = null;
      TileSystemV2DiceEngineModule = null;
      console.warn("[Runner] Failed to load the Tile System 2.0 dice engine.", error);
      return null;
    });
}

function loadNarrativeEventsModule() {
  return import("./src/events.js")
    .then(module => {
      NarrativeEventsModule = module;
      console.log("[Runner] events.js loaded successfully.");
      return module;
    })
    .catch(err => {
      NarrativeEventsModule = null;
      console.warn("[Runner] Failed to load events.js; tutorial narrative disabled.", err);
      return null;
    });
}

function loadEncounterRulesModule() {
  return import("./src/encounterIntegration.js")
    .then(module => {
      EncounterRulesModule = module;
      if (module.developmentTraceEnabled(window.location)) {
        developmentTrace = module.createDevelopmentTrace();
        window.getRunnerEventTrace = () => developmentTrace.snapshot();
        window.clearRunnerEventTrace = () => developmentTrace.clear();
      }
      console.log("[Runner] encounterRules.js loaded successfully.");
      return module;
    })
    .catch(error => {
      EncounterRulesModule = null;
      console.warn("[Runner] Failed to load encounterRules.js; universal encounter rules are disabled.", error);
      return null;
    });
}

function loadNarrativeData() {
  return fetch(addCacheBust(NARRATIVE_URL), { cache: "no-store" })
    .then(res => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(json => {
      NARRATIVE_EVENTS = Array.isArray(json?.events) ? json.events : [];
      console.log("[Runner] tutorial narrative loaded successfully.");
      return NARRATIVE_EVENTS;
    })
    .catch(err => {
      NARRATIVE_EVENTS = [];
      console.warn("[Runner] Failed to load tutorial narrative; continuing without it.", err);
      return [];
    });
}

function loadAchievementsModule() {
  return import("./src/achievements.js")
    .then(module => {
      AchievementsModule = module;
      console.log("[Runner] achievements.js loaded successfully.");
      return module;
    })
    .catch(err => {
      AchievementsModule = null;
      console.warn("[Runner] Failed to load achievements.js; stat achievements disabled.", err);
      return null;
    });
}

function loadAchievementRules() {
  return fetch(addCacheBust(ACHIEVEMENTS_URL), { cache: "no-store" })
    .then(res => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(json => {
      ACHIEVEMENT_RULES = AchievementsModule
        ? AchievementsModule.normalizeAchievementRules(json)
        : (Array.isArray(json?.achievements) ? json.achievements : []);
      console.log("[Runner] achievements.json loaded successfully.");
      return ACHIEVEMENT_RULES;
    })
    .catch(err => {
      ACHIEVEMENT_RULES = [];
      console.warn("[Runner] Failed to load achievements.json; stat achievements disabled.", err);
      return [];
    });
}

tryFetch([...TILE_URLS])
  .then(res => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  })
  .then(async json => {
    console.log("[Runner] tiles2.json loaded successfully.");
    TileCompatibilityModule = await import("./src/tileCompatibility.js");
    NormalizedTileRegistry = TileCompatibilityModule.normalizeTileDefinitions(json);
    AIR_TILE_ID = TileCompatibilityModule.getAirTileId(NormalizedTileRegistry);
    PLAYER_ART_TILE_ID = NormalizedTileRegistry.playerArtTileId ?? null;
    prepareNumericTileImages();
    // FIX: Initialize game ONLY after tiles and optional levels are loaded
    return Promise.all([
      loadLevels(),
      loadStateModule(),
      loadResumeLinksModule(),
      loadLevelRoutingModule(),
      loadGameMapRuntimeModule(),
      loadNarrativeEventsModule(),
      loadEncounterRulesModule(),
      loadNarrativeData(),
      loadAchievementsModule().then(() => loadAchievementRules()),
      loadTileSystemV2DiceModule()
    ]).then(() => initGame());
  })
  .catch(async err => {
    console.error("[Runner] Failed to load tiles2.json, using fallback only:", err);
    TileCompatibilityModule ||= await import("./src/tileCompatibility.js");
    if (!NormalizedTileRegistry) {
      NormalizedTileRegistry = TileCompatibilityModule.normalizeTileDefinitions({
        "X": { solid: true, gravity: true },
        ".": { solid: false, gravity: true, air: true },
        "R": { playerArt: true }
      });
      AIR_TILE_ID = TileCompatibilityModule.getAirTileId(NormalizedTileRegistry);
    }
    await Promise.all([
      loadLevels(),
      loadStateModule(),
      loadResumeLinksModule(),
      loadLevelRoutingModule(),
      loadGameMapRuntimeModule(),
      loadNarrativeEventsModule(),
      loadEncounterRulesModule(),
      loadNarrativeData(),
      loadAchievementsModule().then(() => loadAchievementRules()),
      loadTileSystemV2DiceModule()
    ]);
    initGame();
  });
  
  
let signVariantMap = [];

  function signVariantAt(x, y) {
  if (!signVariantMap[y]) return null;
  return signVariantMap[y][x] || null;
}

function sanitizeVariant(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return v ? v : null;
}


function getVariantBucketEntry(baseDef, variant) {
  if (!baseDef || !variant) return null;

  for (const bucket of [...GAME_VARIANT_BUCKETS, "narrative"]) {
    const group = getTileVariantGroup(baseDef, bucket);
    if (group && typeof group === "object" && group[variant]) {
      return {
        bucket,
        entry: group[variant]
      };
    }
  }

  return null;
}

function getTileVariantEntry(tileId, bucket, variant) {
  const record = getTileRecord(tileId);
  if (!record || !variant) return null;
  return getTileVariantGroup(record.definition, bucket)?.[variant] || null;
}

function getTileContextAt(x, y) {
  const id = tileAt(x, y);
  const record = id == null ? null : NormalizedTileRegistry?.definitionsById.get(id);
  const baseDef = record?.definition || null;
  const variant = signVariantAt(x, y);

  const variantInfo = getVariantBucketEntry(baseDef, variant);
  const variantBucket = variantInfo?.bucket || null;
  const variantDef = variantInfo?.entry || null;

  const effectiveDef = {
    ...baseDef,
    ...(variantDef || {})
  };

  return {
    x,
    y,
    id,
    legacyCode: record?.legacyCode ?? null,
    ch: record?.legacyCode ?? id,
    tileId: id,
    variant,
    record,
    baseDef,
    variantBucket,
    variantDef,
    def: effectiveDef
  };
}

function tileDataAt(x, y) {
  return tileData(tileAt(x, y), signVariantAt(x, y));
}

function getEffectiveTileDefAt(x, y) {
  return getTileContextAt(x, y).def;
}

function getRenderableImageAt(x, y) {
  const ctx = getTileContextAt(x, y);
  return ctx.def?.img || ctx.baseDef?.img || null;
}




// =========================
// Fog of War (MVP)
// =========================
const FOG_RADIUS = 5;

// fog: 1 = covered, 0 = revealed
let fog = null;
let fogOffsets = null;

// These track current grid size
let MAP_W = 0;
let MAP_H = 0;

function fogIndex(x, y) {
  return y * MAP_W + x;
}

function buildFogOffsets(radius = FOG_RADIUS) {
  const list = [];
  const r2 = radius * radius;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      // Circle reveal. For square reveal use: Math.max(Math.abs(dx), Math.abs(dy)) <= radius
      if ((dx * dx + dy * dy) <= r2) list.push([dx, dy]);
    }
  }

  fogOffsets = list;
}

function initFogForCurrentGrid() {
  if (!grid || !grid.length || !grid[0]?.length) return;

  MAP_H = grid.length;
  MAP_W = grid[0].length;

  fog = new Uint8Array(MAP_W * MAP_H);
  fog.fill(1);

  if (!fogOffsets) buildFogOffsets(FOG_RADIUS);

  // reveal starting area immediately
  if (runner) revealAround(runner.x, runner.y);
}

function isFogCovered(x, y) {
  if (!fog) return false;
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return true;
  return fog[fogIndex(x, y)] === 1;
}

function revealAround(px, py) {
  if (!fog || !fogOffsets) return;

  for (const [dx, dy] of fogOffsets) {
    const x = px + dx;
    const y = py + dy;
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
    fog[fogIndex(x, y)] = 0; // revealed permanently
  }
}

// Draw fog as rectangles over covered tiles (fast + simple)
function drawFogOverlay() {
  if (!fog || !grid?.length) return;

  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = "#000";

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (fog[fogIndex(x, y)] === 1) {
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  ctx.restore();
}








// ============================================================
// Carry-over runner stats via URL hash ("st")
// ============================================================
const DEFAULT_CARRY_STATS = {
  hearts: 5,
  score: 0,
  kills: 0,
  turbo: false,
  turboMultiplier: 2
};

function encodeCarryStatsFromRunner(r) {
  if (StateModule?.encodeCarryStatsFromRunner) {
    return StateModule.encodeCarryStatsFromRunner(r);
  }

  // compact + versioned; numbers base36 to shorten
  return [
    "v1",
    "h" + (r.hearts ?? 0).toString(36),
    "s" + (r.score ?? 0).toString(36),
    "k" + (r.kills ?? 0).toString(36),
    "t" + ((r.turbo ? 1 : 0).toString(36)),
    "m" + ((r.turboMultiplier ?? 2).toString(36))
  ].join(".");
}

function decodeCarryStats(str) {
  if (StateModule?.decodeCarryStats) {
    return StateModule.decodeCarryStats(str);
  }

  const out = { ...DEFAULT_CARRY_STATS };
  if (!str || typeof str !== "string") return out;

  const parts = str.split(".");
  if (parts[0] !== "v1") return out;

  for (let i = 1; i < parts.length; i++) {
    const t = parts[i];
    if (t.startsWith("h")) out.hearts = parseCarryNumber(t.slice(1), out.hearts);
    else if (t.startsWith("s")) out.score = parseCarryNumber(t.slice(1), out.score);
    else if (t.startsWith("k")) out.kills = parseCarryNumber(t.slice(1), out.kills);
    else if (t.startsWith("t")) {
      const turbo = parseCarryNumber(t.slice(1), null);
      if (turbo !== null) out.turbo = turbo === 1;
    } else if (t.startsWith("m")) {
      out.turboMultiplier = parseCarryNumber(t.slice(1), out.turboMultiplier);
    }
  }

  // sanity clamps
  out.hearts = Math.max(0, out.hearts);
  out.score = Math.max(0, out.score);
  out.kills = Math.max(0, out.kills);
  out.turboMultiplier = Math.max(1, out.turboMultiplier);

  return out;
}

function parseCarryNumber(value, fallback) {
  if (!/^-?[0-9a-z]+$/i.test(value)) return fallback;
  const parsed = Number.parseInt(value, 36);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildPersistentGameState() {
  if (!StateModule?.createCheckpointState || !runner) return null;
  const checkpoint = StateModule.createCheckpointState(currentLevelKey || "default", runner, {
    dieValue1,
    dieValue2,
    selectedDie,
    rollCount
  });
  const diceState = diceEngine?.getState();
  checkpoint.turn = {
    rollId: diceState?.currentRollId ?? null,
    phase: diceState?.turnPhase ?? "idle",
    outcome: turnOutcome,
    ledger: encounterDispatcher?.getLedgerSnapshot() ?? restoredTurn?.ledger ?? {}
  };
  return checkpoint;
}

function savePersistentGameState({ checkpoint = false } = {}) {
  if (!checkpoint || turnTransaction) return;
  if (!StateModule || !runner) return;
  if (!sameMapDocument(getLevelMap(currentLevelKey), currentMapString)) return;

  try {
    const state = buildPersistentGameState();
    if (state) StateModule.saveState(state);
  } catch (err) {
    console.warn("[Runner] Failed to save local game state.", err);
  }
}

function sameMapDocument(left, right) {
  if (typeof left === "string" || typeof right === "string") return left === right;
  if (left == null || right == null) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

function mapStateHash(map) {
  return typeof map === "string" ? map : map ? JSON.stringify(map) : "";
}

function getSavedGameState() {
  if (!StateModule) return null;

  try {
    return StateModule.loadState();
  } catch (err) {
    console.warn("[Runner] Failed to load local game state.", err);
    return null;
  }
}

function buildNarrativeState() {
  if (!StateModule || !runner) return null;

  const rollLimitState = calculateCurrentRollLimitState();
  return StateModule.createInitialState({
    levelKey: currentLevelKey || "default",
    exitIndex: currentExitIndex || 0,
    runner: {
      ...runner,
      xp: runner.xp || 0,
      counters: runner.counters || {},
      stats: runner.stats || {},
      achievements: runner.achievements || [],
      storyFlags: runner.storyFlags || {}
    },
    dice: {
      dieValue1,
      dieValue2,
      selectedDie,
      rollCount,
      rollLimit: rollLimitState.rollLimit,
      rollsRemaining: rollLimitState.rollsRemaining
    },
    world: {
      mapHash: mapStateHash(currentMapString),
      narrativeEventsSeen: runner.narrativeEventsSeen || []
    }
  });
}

function applyNarrativeState(state) {
  if (!state?.runner || !runner) return;

  runner.xp = state.runner.xp || 0;
  runner.counters = state.runner.counters || runner.counters || {};
  runner.stats = state.runner.stats || runner.stats || {};
  runner.achievements = state.runner.achievements || [];
  runner.storyFlags = state.runner.storyFlags || {};
  runner.narrativeEventsSeen = state.world?.narrativeEventsSeen || [];
}

function buildAchievementState() {
  if (!StateModule || !runner) return null;

  return StateModule.createInitialState({
    levelKey: currentLevelKey || "default",
    exitIndex: currentExitIndex || 0,
    runner: {
      ...runner,
      xp: runner.xp || 0,
      counters: runner.counters || {},
      stats: runner.stats || {},
      achievements: runner.achievements || [],
      storyFlags: runner.storyFlags || {}
    },
    world: {
      mapHash: mapStateHash(currentMapString),
      narrativeEventsSeen: runner.narrativeEventsSeen || []
    }
  });
}

function applyAchievementState(state) {
  applyNarrativeState(state);
}

function renderAchievement(action) {
  setMessage(formatAchievementMessage(action), {
    kind: "achievement",
    html: true
  });
}

function checkStatAchievements(context = {}) {
  if (!AchievementsModule || !ACHIEVEMENT_RULES.length || !runner) return;

  const baseState = buildAchievementState();
  if (!baseState) return;

  const result = AchievementsModule.checkAchievementRules(baseState, ACHIEVEMENT_RULES, context);
  applyAchievementState(result.state);

  for (const achievement of result.unlocked || []) {
    renderAchievement(achievement);
  }

  if ((result.unlocked || []).length > 0) {
    updateInfo();
    savePersistentGameState();
  }
}

function ensureRunnerStats() {
  if (!runner.stats || typeof runner.stats !== "object" || Array.isArray(runner.stats)) {
    runner.stats = {};
  }
  return runner.stats;
}

function ensureRunnerCounters() {
  if (!runner.counters || typeof runner.counters !== "object" || Array.isArray(runner.counters)) {
    runner.counters = {};
  }
  return runner.counters;
}

function addRunnerCounter(name, amount = 1) {
  if (!runner || !name) return 0;
  const counters = ensureRunnerCounters();
  counters[name] = Math.max(0, Number(counters[name] || 0) + amount);
  checkStatAchievements();
  return counters[name];
}

function recordMovementStats(dx, dy, options = {}) {
  addRunnerCounter("move");
  if (dy === 0 && dx < 0) addRunnerCounter("left");
  if (dy === 0 && dx > 0) addRunnerCounter("right");
  if (dy === -1) {
    addRunnerCounter("jump");
    if (options.diagonalJump === true) addRunnerCounter("diagonal_jump");
    if (options.doubleJump === true) addRunnerCounter("double_jump");
  }
  for (const tag of options.tile?.tags || []) {
    addRunnerCounter(`move_in_${tag}`);
  }
}

function buildMovementAchievementContext({
  dx,
  dy,
  fromX,
  fromY,
  toX,
  toY,
  here,
  target,
  targetChar,
  moveCost,
  isDiagonalJump = false
}) {
  const rollLimitState = calculateCurrentRollLimitState();
  return {
    movementPoints: totalMovementPoints(),
    movement: {
      attempted: true,
      dx,
      dy,
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      moveCost,
      diagonal: isDiagonalJump === true
    },
    dice: {
      dieValue1,
      dieValue2,
      selectedDie,
      rollCount,
      rollLimit: rollLimitState.rollLimit,
      rollsRemaining: rollLimitState.rollsRemaining
    },
    current: tileAchievementContext(here),
    target: {
      ...tileAchievementContext(target),
      ch: target.legacyCode ?? target.id,
      tileId: target.id,
      x: toX,
      y: toY,
      moveCost
    }
  };
}

function tileAchievementContext(tile) {
  if (!tile) return {};
  const { img, ...rest } = tile;
  return rest;
}

function runTutorialNarrative(context) {
  if (!NarrativeEventsModule || !NARRATIVE_EVENTS.length || !runner) return;

  const baseState = buildNarrativeState();
  if (!baseState) return;

  const result = NarrativeEventsModule.runNarrativeEvents(
    NARRATIVE_EVENTS,
    context,
    baseState
  );

  applyNarrativeState(result.state);

  for (const action of result.actions || []) {
    if (action.type === "message" && action.text) {
      setMessage(action.text, {
        kind: "tutorial",
        html: action.html === true
      });
    } else if (action.type === "achievement" && action.title) {
      renderAchievement(action);
    }
  }

  checkStatAchievements();

  if ((result.actions || []).length > 0) {
    updateInfo();
    savePersistentGameState();
  }
}

function formatAchievementMessage(action) {
  const title = action.title || "Achievement unlocked";
  const body = action.body ? `<br>${action.body}` : "";
  return `<b>ACHIEVEMENT: ${title}</b>${body}`;
}

// ============================================================
// Default hard-coded level map (fallback when no #map=...)
// Also used as fallback when exit key "E" is not defined in tiles2.json
// ============================================================

// const DEFAULT_ENCODED_MAP = [
//  "A24P1",
//  "A25",
//  "A11D1A13",
//  "A11P1A6D1A6",
//  "A2R1A2M{a}1A1Z1P2A5I{b}1A1P1A7",
//  "P10A2P2A1P2A3Y1A4",
//  "A7P1A12P1Y1A3",
//  "A1M{a}1A4D1K{a}1A5H1A11",
//  "P3W3P3W3P4A7Z1A1",
//  "P5W1P8A8Z1P1A1",
//  "A5W1A11S1A3Z1P2A1",
//  "A1E1A3W1A6D1A3B1P1A7",
//  "A1P3A1W1A1P1A2T1P2A12",
//  "L4P1W1P1L2P2L6P3A5",
//  "P25"
//].join("~");



// ============================================================
// CORE INIT FUNCTION (Wrapper to prevent race conditions)
// ============================================================
function initGame() {
  const savedLevel = sessionStorage.getItem("levelKey");
if (savedLevel) {
  currentLevelKey = savedLevel;
}

function decodeMap(encoded) {
  if (!TileCompatibilityModule || !NormalizedTileRegistry || !GameMapRuntimeModule) {
    throw new Error("Map loading requires the numeric tile compatibility modules.");
  }
  const normalizedMap = TileCompatibilityModule.decodeMapForRuntime(encoded, NormalizedTileRegistry, {
    rows: ROWS,
    cols: COLS
  });
  if (typeof encoded !== "string" && !normalizedMap.spawn) {
    throw new Error("Numeric gameplay maps require explicit spawn coordinates.");
  }
  encounterDispatcher = null;
  encounterBatchCursor = diceEventBatches.length;
  currentMapSpawn = normalizedMap.spawn || null;
  const runtime = GameMapRuntimeModule.buildNumericGameMap(normalizedMap, NormalizedTileRegistry);
  signVariantMap = runtime.signVariantMap;
  monsterStateMap = runtime.monsterStateMap;
  bounceHeight = runtime.bounceHeight;
  sinkDelayMap = runtime.sinkDelayMap;
  return runtime.grid;
}


function hasEDefaultMap() {
  const s = getLevelMap(getDefaultLevelKey());
  return isMapDocument(s);
}    


// ============================================================
// URL Hash helpers: #map=...&st=...
// ============================================================
  
  
  // =========================
// Fog toggle via URL: fog=off
// Supports both hash params (#...&fog=off) and query params (?fog=off)
// Default: ON
// =========================



  
  
  






    // --- MAP BUILDING ----
    const savedGameState = shouldResumeFromLocalState() ? getSavedGameState() : null;
    const requestedLevelKey = getLevelFromURL();
    const encodedMap = getMapFromURL();
  


if (encodedMap) {
  console.log("Using encoded map:", encodedMap);
  currentLevelKey = requestedLevelKey || "default";
  currentMapString = encodedMap;
  grid = decodeMap(encodedMap);

} else if (savedGameState) {
  console.log("Using saved level-boundary checkpoint.");
  currentLevelKey = savedGameState.levelKey || "default";
  currentExitIndex = savedGameState.exitIndex || 0;
  currentMapString = getLevelMap(currentLevelKey);
  if (!isMapDocument(currentMapString)) {
    currentLevelKey = getDefaultLevelKey();
    currentMapString = getLevelMap(currentLevelKey);
  }
  sessionStorage.setItem("levelKey", currentLevelKey);
  sessionStorage.setItem("exitIndex", currentExitIndex);
  grid = decodeMap(currentMapString);

} else if (requestedLevelKey) {
  console.log("Using portable checkpoint level.");
  currentLevelKey = requestedLevelKey;
  currentMapString = getLevelMap(currentLevelKey);
  if (!isMapDocument(currentMapString)) {
    gameOver = true;
    setMessage(`BOOT ERROR: no map found for level '${currentLevelKey}'.`, { kind: "message" });
    draw();
    return;
  }
  sessionStorage.setItem("levelKey", currentLevelKey);
  grid = decodeMap(currentMapString);

} else {
  console.log("No #map in URL; booting from levels.json default level or tiles2.json fallback");
  signVariantMap = []; // reset variants for new map

  const levelKey = getDefaultLevelKey();
  const mapString = getLevelMap(levelKey);

  if (!isMapDocument(mapString)) {
    // Hard fail: do NOT load factory, do NOT guess.
    gameOver = true;
    setMessage("BOOT ERROR: no default level map could be loaded.", {
      kind: "message"
    });
    draw();
    return;
  }

  currentLevelKey = levelKey;
  currentMapString = mapString;
  sessionStorage.setItem("levelKey", levelKey);
  grid = decodeMap(mapString);
}



  
  // Reset exit progression when a new map loads
if (!sessionStorage.getItem("exitIndex")) {
  currentExitIndex = 0;
  sessionStorage.setItem("exitIndex", 0);
}


    // --- RUNNER PLACEMENT (Robust Fallback) ---
    const startX = currentMapSpawn?.x ?? 1;
    const startY = currentMapSpawn?.y ?? ROWS - 1;
    runnerArtTileId = currentMapSpawn?.artTileId ?? PLAYER_ART_TILE_ID;

  const carried = decodeCarryStats(getStatsFromURL());

  
    // Initialize the global runner object
runner = {
  x: startX,
  y: startY,

  hearts: carried.hearts,
  score: carried.score,
  kills: carried.kills,

  jumpCredits: 0,
  movementLeft: 0,

  turbo: carried.turbo,
  turboMultiplier: carried.turboMultiplier,

  facingLeft: false,
  fallDistance: 0,
  damageFlashTimer: 0,
  diamondFlashTimer: 0,
  turboFlashTimer: 0,
  heartFlashTimer: 0,
  bouncePending: false,
  bounceHeightRemaining: 0,
  xp: carried.xp || 0,
  counters: carried.counters || {},
  stats: carried.stats || {},
  achievements: carried.achievements || [],
  storyFlags: carried.storyFlags || {},
  narrativeEventsSeen: carried.narrativeEventsSeen || [],
  dead: false
};

if (savedGameState?.runner) {
  runner = {
    ...runner,
    ...savedGameState.runner,
    x: startX,
    y: startY,
    dead: false,
    damageFlashTimer: 0,
    diamondFlashTimer: 0,
    turboFlashTimer: 0,
    heartFlashTimer: 0,
    bouncePending: false,
    bounceHeightRemaining: 0
  };
}

ensureRunnerStats();
ensureRunnerCounters();

if (savedGameState?.dice) {
  dieValue1 = savedGameState.dice.dieValue1 || 0;
  dieValue2 = savedGameState.dice.dieValue2 || 0;
  selectedDie = ["die1", "die2"].includes(savedGameState.dice.selectedDie)
    ? savedGameState.dice.selectedDie
    : null;
  rollCount = savedGameState.dice.rollCount || 0;
  updateDiceDisplay(dieValue1, dieValue2, false);
}

restoredTurn = savedGameState?.turn || null;
turnOutcome = restoredTurn?.outcome || null;
if (!turnOutcome && runner.hearts <= 0) turnOutcome = { kind: "death", message: "Run ended." };
initializeDiceEngine();
if (turnOutcome) { gameOver = true; runner.dead = turnOutcome.kind === "death"; }

runTutorialNarrative({
  type: "level_start",
  level: currentLevelKey
});
  
if (isFogEnabled()) initFogForCurrentGrid();
else fog = null;

updateInfo(turnOutcome?.message || "");
savePersistentGameState({ checkpoint: true });
const resumeLinkButton = document.getElementById("create-resume-link");
if (resumeLinkButton) resumeLinkButton.disabled = false;


    // Start the game loop now that everything is ready
    startGameLoop();
}


// ===========================================================
// TILE HELPERS
// ============================================================
function tileAt(x, y) {
  if (!grid || !grid.length) return null;
  if (x < 0 || y < 0 || y >= grid.length || x >= grid[0].length) return null;
  return grid[y][x];
}

function getTileRecord(tileId) {
  return tileId == null ? null : NormalizedTileRegistry?.definitionsById.get(tileId) || null;
}

function getTileHintAt(x, y) {
  const ctx = getTileContextAt(x, y);
  const def = ctx.def;

  if (!def) return null;

  if (typeof def.hint === "string") return def.hint;

  if (def.hint && typeof def.hint === "object") {
    if (ctx.variant && def.hint[ctx.variant]) return def.hint[ctx.variant];
    if (def.hint.default) return def.hint.default;
  }

  return null;
}


function getSignMessageAt(x, y) {
  const ctx = getTileContextAt(x, y);
  const def = ctx.def;

  if (!def || !def.signMessage) return null;

  if (typeof def.signMessage === "string") {
    return def.signMessage;
  }

  if (ctx.variant && typeof def.signMessage === "object" && def.signMessage[ctx.variant]) {
    return def.signMessage[ctx.variant];
  }

  if (typeof def.signMessage === "object" && def.signMessage.default) {
    return def.signMessage.default;
  }

  return null;
}

function getSignPayloadAt(x, y) {
  const ctx = getTileContextAt(x, y);
  const def = ctx.def;

  if (!def) return null;

  if (def.signHtml) {
    if (typeof def.signHtml === "string") {
      return { text: def.signHtml, html: true, tileId: ctx.id };
    }

    if (ctx.variant && typeof def.signHtml === "object" && def.signHtml[ctx.variant]) {
      return { text: def.signHtml[ctx.variant], html: true, tileId: ctx.id };
    }

    if (typeof def.signHtml === "object" && def.signHtml.default) {
      return { text: def.signHtml.default, html: true, tileId: ctx.id };
    }
  }

  if (def.signMessage) {
    if (typeof def.signMessage === "string") {
      return { text: def.signMessage, html: false, tileId: ctx.id };
    }

    if (ctx.variant && typeof def.signMessage === "object" && def.signMessage[ctx.variant]) {
      return { text: def.signMessage[ctx.variant], html: false, tileId: ctx.id };
    }

    if (typeof def.signMessage === "object" && def.signMessage.default) {
      return { text: def.signMessage.default, html: false, tileId: ctx.id };
    }
  }

  return null;
}



function tileData(tileId, variant = null) {
  if (tileId == null) {
    return {
      id: null,
      legacyCode: null,
      img: null,
      solid: true,
      gravity: true,
      moveCostTop: 1,
      moveCostInside: 1,
      insideDamage: { amount: 0, when: "instant" },
      topDamage: { amount: 0, when: "stand" },
      bounce: 0,
      autoPush: null,
      pickupType: null,
      effects: [],
      grantStats: null,
      tags: [],
      exit: false,
      slope: null,
      deathMessage: null,
      fallDamageThreshold: 3,
      fallDamageMultiplier: 1,
      fallDamageCancel: false,
      outOfBounds: true
    };
  }

  const record = getTileRecord(tileId);
  const baseDef = record?.definition || {};
  const def = baseDef;
  const exit = def.exit === true;
  const solid = exit ? false : (def.solid === true);
  const gravity = def.gravity !== undefined ? def.gravity : true;

  return {
    id: tileId,
    legacyCode: record?.legacyCode ?? null,
    ch: record?.legacyCode ?? tileId,
    variant,
    monster: getTileVariantEntry(tileId, "monster", variant),
    lock: getTileVariantEntry(tileId, "lock", variant),
    img: def.img || null,
    solid,
    gravity,
    moveCostTop: def.moveCostTop != null ? def.moveCostTop : (def.moveCost || 1),
    moveCostInside: def.moveCostInside != null ? def.moveCostInside : (def.insideMoveCost || (def.moveCost || 1)),
    insideDamage: def.insideDamage || { amount: 0, when: "instant" },
    topDamage: def.topDamage || { amount: 0, when: "stand" },
    bounce: typeof def.bounce === "number" ? def.bounce : 0,
    autoPush: def.autoPush || null,
    pickupType: def.pickupType || null,
    effects: Array.isArray(def.effects) ? def.effects : [],
    grantStats: (def.grantStats && typeof def.grantStats === "object" && !Array.isArray(def.grantStats)) ? def.grantStats : null,
    tags: Array.isArray(def.tags) ? def.tags : [],
    exit,
    levels: Object.keys(def).filter(k => k.startsWith("Level-") || k === "default" || k.startsWith("exit")).sort(),
    slope: def.slope || null,
    deathMessage: def.deathMessage || null,
    fallDamageThreshold: def.fallDamageThreshold != null ? def.fallDamageThreshold : 3,
    fallDamageMultiplier: def.fallDamageMultiplier != null ? def.fallDamageMultiplier : 1,
    fallDamageCancel: def.fallDamageCancel != null ? !!def.fallDamageCancel : (!solid && gravity === false)
  };
}


function exitIdAt(x, y) {
  if (!tileDataAt(x, y).exit) return null;
  return signVariantAt(x, y) || "default";
}



function TIP(tileId) { return tileData(tileId); }
function isFluidTile(tile) { return (!tile.solid && tile.gravity === false); }

function inWater() {
  const here = tileDataAt(runner.x, runner.y);
  return isFluidTile(here);
}

function resetFallDistanceIfNoGravityHere() {
  const here = tileDataAt(runner.x, runner.y);
  if (here.gravity === false) {
    runner.fallDistance = 0;
    return true;
  }
  return false;
}


function checkLanding(prevX, prevY, newX, newY) {
  const wasSupported = tileDataAt(prevX, prevY + 1).solid;
  const isSupported  = tileDataAt(newX,  newY  + 1).solid;

  if (!wasSupported && isSupported && runner.fallDistance > 0) {
    runner.fallDistance = 0;
    return true;
  }
  return false;
}




// ============================================================
// Damage & Physics Helpers
// ============================================================
function applyInsideDamage(tile) {
  const amt = tile.insideDamage?.amount || 0;
  if (amt > 0) {
    takeDamage(amt, tile);
    if (runner.hearts < 1) {
      deathReason = tile.deathMessage;
      setMessage(deathReason);
      endGame();
      return;
    }
  }
}

function applyTopDamage(tile) {
  const amt = tile.topDamage?.amount || 0;
  if (amt > 0) {
    takeDamage(amt, tile); 
    setMessage('Top damage');
  }
}

function runAttributeCheck() {
  const here = tileDataAt(runner.x, runner.y);
  const below = tileDataAt(runner.x, runner.y + 1);
  applyInsideDamage(here);
  if (below.solid) {
    applyTopDamage(below);
  }
}

function getBounceHeightAt(x, y) {
  const tile = tileDataAt(x, y);
  if (tile.outOfBounds || tile.bounce === undefined || tile.bounce === null) return null;
  const record = getTileRecord(tile.id);
  return record?.definition?.bounce == null ? null : tile.bounce;
}

// ============================================================
// UI helpers
// ============================================================

let modalOpen = false;

function showModalMessage(text) {
  const modal = document.getElementById("messageModal");
  const content = document.getElementById("messageModalContent");
  if (!modal || !content) return;

  content.textContent = text;
  modal.hidden = false;
  modalOpen = true;
}

function hideModalMessage() {
  const modal = document.getElementById("messageModal");
  if (!modal) return;

  modal.hidden = true;
  modalOpen = false;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Allow only a small subset of tags for tile-driven text.
// Expand this list only if you need it.
function sanitizeTileHtml(input) {
  const escaped = escapeHtml(input);

  // re-enable allowed tags (no attributes)
  return escaped
    .replaceAll(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replaceAll(/&lt;b&gt;/gi, "<b>").replaceAll(/&lt;\/b&gt;/gi, "</b>")
    .replaceAll(/&lt;strong&gt;/gi, "<strong>").replaceAll(/&lt;\/strong&gt;/gi, "</strong>")
    .replaceAll(/&lt;i&gt;/gi, "<i>").replaceAll(/&lt;\/i&gt;/gi, "</i>")
    .replaceAll(/&lt;em&gt;/gi, "<em>").replaceAll(/&lt;\/em&gt;/gi, "</em>");
}

function logMessage(text, { kind, type, scroll = true, html = false } = {}) {
  const log = document.getElementById("log");
  if (!log) return;

  const k = kind || type || "info"; // <-- supports your old calls using {type:"move"}

  const line = document.createElement("div");
  line.className = `log-line log-kind-${k}`;

  if (html) line.innerHTML = sanitizeTileHtml(text);
  else line.textContent = text;

  log.appendChild(line);
  if (scroll) log.scrollTop = log.scrollHeight;
}



function logTileText(text, {
  kind = null,          // NOTE: null, not "tile"
  html = null,          // NOTE: null, not false
  tileChar = null,
  tileId = null,
  scroll = true
} = {}) {
  const id = tileId ?? (tileChar == null ? null : NormalizedTileRegistry?.idsByLegacyCode.get(tileChar));
  const def = getTileRecord(id)?.definition || null;

  // Only apply tile defaults if caller didn't specify them
  if (def) {
    if (kind == null && def.logKind) kind = def.logKind;
    if (html == null && def.logHtml === true) html = true;
  }

  // Final fallbacks
  if (kind == null) kind = "tile";
  if (html == null) html = false;

  logMessage(text, { kind, html, scroll });
}



document
  .getElementById("messageModal")
  .addEventListener("click", hideModalMessage);


document.addEventListener("keydown", e => {
  if (modalOpen && (e.key === " " || e.key === "Enter" || e.key === "Escape")) {
    hideModalMessage();
  }
});


function handleBlockedTile(x, y, label = "Blocked") {
  const p = getSignPayloadAt(x, y);
  if (p) {
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(p.text) || /<br\s*\/?>/i.test(p.text);
  setMessage(p.text, {
    tileId: p.tileId,
    kind: "sign",
    html: p.html || looksLikeHtml
  });
} else {
  setMessage(label, { kind: "message" });
}


  draw();
}












function resolveSolidInteractionAt(x, y, options = {}) {
  const {
    blockedLabel = "Blocked",
    allowLock = true,
    allowMonster = true,
    drawAfter = false
  } = options;

  const ctx = getTileContextAt(x, y);
  const tile = tileDataAt(x, y);

  if (!tile.solid) {
    return {
      handled: false,
      blocked: false,
      moved: false,
      kind: "none"
    };
  }

  if (allowLock && tile.lock) {
    const opened = tryUnlockLockAt(x, y);

    if (drawAfter) draw();

    return {
      handled: true,
      blocked: !opened,
      moved: false,
      opened,
      kind: "lock"
    };
  }

  if (allowMonster && tile.monster) {
    const defeated = tryFightMonsterAt(x, y);

    if (drawAfter) draw();

    return {
      handled: true,
      blocked: !defeated,
      moved: false,
      defeated,
      kind: "monster"
    };
  }

  handleBlockedTile(x, y, blockedLabel);

  return {
    handled: true,
    blocked: true,
    moved: false,
    kind: "blocked"
  };
}




















function totalMovementPoints() { return dieValue1 + dieValue2; }

function createGameDiceEngine({
  initialDice = { die1: dieValue1, die2: dieValue2 },
  selected = selectedDie || "die1",
  playerRollCount = rollCount,
  currentRollId = null,
  turnPhase = null,
  playerRollLimit = isLevelObjectiveComplete() ? null : getLevelRollLimit()
} = {}) {
  const sourceRegistry = NormalizedTileRegistry?.registry || {};
  const sourceSettings = sourceRegistry.settings || {};
  const sourceCapacities = sourceSettings.dice || {};
  const registry = {
    ...sourceRegistry,
    settings: {
      ...sourceSettings,
      dice: {
        ...sourceCapacities,
        die1: { ...sourceCapacities.die1, maximum: sourceCapacities.die1?.maximum ?? 6 },
        die2: { ...sourceCapacities.die2, maximum: sourceCapacities.die2?.maximum ?? 6 }
      }
    }
  };
  const level = LEVELS?.levels?.[currentLevelKey] || {};
  const capacities = TileSystemV2Module.resolveDiceCapacities(registry, level);
  const boundedDice = {
    die1: Math.min(capacities.die1, Math.max(0, initialDice.die1)),
    die2: Math.min(capacities.die2, Math.max(0, initialDice.die2))
  };

  return TileSystemV2DiceEngineModule.createTileSystemV2DiceEngine({
    registry,
    level,
    initialDice: boundedDice,
    selectedDie: ["die1", "die2"].includes(selected) ? selected : "die1",
    playerRollLimit,
    playerRollCount,
    currentRollId,
    turnPhase
  });
}

function initializeDiceEngine() {
  diceEventBatches.length = 0;
  encounterBatchCursor = 0;
  encounterDispatcher = null;
  diceEngine = createGameDiceEngine({ currentRollId: restoredTurn?.rollId, turnPhase: restoredTurn?.phase });
  const state = diceEngine.getState();
  dieValue1 = state.dice.die1;
  dieValue2 = state.dice.die2;
  rollCount = state.playerRollCount;
  updateDiceDisplay(dieValue1, dieValue2, false);
}

function synchronizeDiceEngineRollLimit() {
  const state = diceEngine.getState();
  const playerRollLimit = isLevelObjectiveComplete() ? null : getLevelRollLimit();
  if (state.playerRollLimit === playerRollLimit) return;
  diceEngine = createGameDiceEngine({
    initialDice: state.dice,
    selected: state.selectedDie,
    playerRollCount: state.playerRollCount,
    currentRollId: state.currentRollId,
    turnPhase: state.turnPhase,
    playerRollLimit
  });
}

function applyDiceEngineResult(result, action = {}) {
  developmentTrace?.record({ type: "player_action", ...action, ok: result.ok,
    actionId: result.batch?.actionId ?? result.lifecycleBatch?.actionId,
    rollId: result.batch?.rollId ?? result.lifecycleBatch?.rollId,
    error: result.code, diagnostics: result.diagnostics, spent: result.spent, discardedTime: result.discardedTime,
    position: runner && { x: runner.x, y: runner.y } });
  if (!result.ok) return false;
  dieValue1 = result.state.dice.die1;
  dieValue2 = result.state.dice.die2;
  rollCount = result.state.playerRollCount;
  if (result.batch) {
    diceEventBatches.push(result.batch);
    for (const event of result.batch.events) developmentTrace?.record({ type: "dice_mutation", event });
  }
  return true;
}

function updateInfo(label = "") {
  const el = document.getElementById("info");
  if (!el) return;

  const moves = totalMovementPoints();
  const jumps = runner.jumpCredits;
  const hearts = runner.hearts;
  const diamonds = runner.score;
  const rolls = rollCount;
  const fallDistance = runner.fallDistance;
  const killCount = runner.kills;
  const xp = runner.xp || 0;

  const rollLimitState = calculateCurrentRollLimitState();
  const lines = [
    label ? `${label}` : null,
    `Moves: ${moves}`,
    `Fall: ${fallDistance}`,
    `Jumps: ${jumps}`,
    `Hearts: ${hearts}`,
    `Diamonds: ${diamonds}`,
    `Kills: ${killCount}`,
    `XP: ${xp}`,
    `Times rolled: ${rolls}`
  ];

  if (rollLimitState.rollLimit !== null) {
    lines.push(`Roll limit: ${rollLimitState.rollsRemaining}/${rollLimitState.rollLimit}`);
    lines.push(`Rolls used: ${rollLimitState.rollsUsed} (${rollLimitState.percentConsumed.toFixed(0)}%)`);
  }

  el.innerHTML = lines.filter(Boolean).join("<br>");

  el.innerHTML = lines.join("<br>");
  savePersistentGameState();
}




function setMessage(msg, { tileChar = null, tileId = null, kind = "message", html = false, scroll = true } = {}) {
  if (!msg || !msg.trim()) return;

  // Use tile-aware logger so tiles can override kind/html via tiles2.json
  logTileText(msg, { tileChar, tileId, kind, html, scroll });
}



function checkDeath() {
  if (runner.hearts <= 0 && !gameOver) {
    endGame();
    return true;
  }
  return false;
}

function takeDamage(n, sourceTile) {
  const heartsBefore = runner.hearts;
  runner.hearts -= n;
  developmentTrace?.record({ type: "damage_applied", amount: n, heartsBefore, heartsAfter: runner.hearts,
    lethal: runner.hearts <= 0, message: sourceTile.deathMessage, ...sourceTile.traceContext });
  runner.damageFlashTimer = 10;
  deathReason = sourceTile.deathMessage;
  savePersistentGameState();
  if (runner.hearts <= 0) {
      setMessage(deathReason);
      endGame();
    return;
  }
  checkDeath();
}

function tileDistanceFromRunner(tx, ty) {
  if (!runner) return Infinity;
  const dx = Math.abs(tx - runner.x);
  const dy = Math.abs(ty - runner.y);
  return Math.max(dx, dy); // Chebyshev distance (counts squares with diagonals)
}

function defaultFarClickMessage(tx, ty, max = 5) {
  const d = tileDistanceFromRunner(tx, ty);
  return `That's ${d} tiles away. Move within ${max} tiles to get a better view.`;
}



// ============================================================
// Dice spending
// ============================================================
function spendMovement(cost) {
  if (!diceEngine) initializeDiceEngine();
  const selected = selectedDie || "die1";
  diceEngine.selectDie(selected);
  const before = diceEngine.getState();
  const result = diceEngine.spendTime({
    actionId: `movement-${crypto.randomUUID()}`,
    cost,
    source: { kind: "movement" }
  });
  if (!applyDiceEngineResult(result, { action: "movement", timeCost: cost, selectedDie: selected, before: before.dice })) return false;

  if (cost > before.dice[selected]) {
    selectedDie = selected === "die1" ? "die2" : "die1";
    diceEngine.selectDie(selectedDie);
  }
  updateDiceDisplay(dieValue1, dieValue2, false);
  document.getElementById("die1")?.classList.toggle("selected", selectedDie === "die1");
  document.getElementById("die2")?.classList.toggle("selected", selectedDie === "die2");
  runner.movementLeft = totalMovementPoints();
  savePersistentGameState({ checkpoint: true });
  return true;
}

function evaluateDiceRule(rule) {
  const d1 = dieValue1;
  const d2 = dieValue2;

  if (rule.dice === 1) {
    return d1 === rule.value || d2 === rule.value;
  }

  if (rule.dice === 2) {
    if (rule.sum !== undefined) {
      return (d1 + d2) === rule.sum;
    }

    if (rule.parity) {
      const parity = (d1 + d2) % 2 === 0 ? "even" : "odd";
      return parity === rule.parity;
    }

    if (rule.exact) {
      const vals = [d1, d2].sort();
      const req = [...rule.exact].sort();
      return vals[0] === req[0] && vals[1] === req[1];
    }
  }

  return false;
}

function tryUnlockLockAt(x, y) {
  const tile = tileDataAt(x, y);
  const rule = tile.lock;
  if (!rule) return false;

  // Debug (optional)
  console.log("LOCK DEBUG", {
    x, y,
    variant: tile.variant,
    die1: dieValue1,
    die2: dieValue2
  });

  if (evaluateDiceRule(rule)) {
    grid[y][x] = AIR_TILE_ID;
    signVariantMap[y][x] = null;

    setMessage("The lock clicks open.", { tileId: tile.id, kind: "lock" });

    
    return true;
  }

  setMessage(rule.messageFail || "The lock will not open.", { tileId: tile.id, kind: "lock" });
  return false;
}


function tryFightMonsterAt(x, y) {
  const tile = tileDataAt(x, y);
  const monster = tile.monster;
  if (!monster) {
    return false;
  }

  let hp = monsterStateMap[y]?.[x] ?? monster.hp ?? 1;

  // ---------- PLAYER ATTACK ----------
  if (monster.playerHit) {

    const hitResult = evaluateDiceRule(monster.playerHit);
    

    if (hitResult) {
      hp -= monster.playerHit.damage;
      monsterStateMap[y][x] = hp;
      setMessage(monster.playerHit.messageHit || "You hit the monster.", { tileId: tile.id, kind: "combat" });
    } else {
      setMessage(monster.playerHit.messageFail || monster.messageFail || "You cannot hurt the monster.",  { tileId: tile.id, kind: "combat" });
      return false;
    }
  } else {
  }

  // ---------- MONSTER ATTACK ----------
  if (hp > 0 && monster.monsterHit && !dispatcherOwnsEncounterAt(x, y)) {

    const monsterHitResult = evaluateDiceRule(monster.monsterHit);
   
    if (monsterHitResult) {
      takeDamage(monster.monsterHit.damage, {
        deathMessage: monster.monsterHit.messageHit
      });
      setMessage(monster.monsterHit.messageHit, { tileId: tile.id, kind: "combat" });
    } 
  }

  // ---------- DEATH CHECK ----------
  if (hp <= 0) {
    const replacementId = monster.defeatedTileId ?? NormalizedTileRegistry.registry.defeatedMonsterTileId ?? AIR_TILE_ID;
    grid[y][x] = replacementId;
    signVariantMap[y][x] = null;
    monsterStateMap[y][x] = null;
    setMessage(`${monster.name} defeated.`, { tileId: tile.id, kind: "message" });
    return true;
  }


  setMessage(monster.messageFail || "The monster blocks you.");
  return false;
}


function checkAdjacentMonsterAttacks() {
  if (gameOver) return;
  
  const adjacent = [
    { x: runner.x,     y: runner.y - 1 }, // up.
    { x: runner.x,     y: runner.y + 1 }, // down
    { x: runner.x - 1, y: runner.y     }, // left
    { x: runner.x + 1, y: runner.y     }  // right
  ];
  
 

  for (const pos of adjacent) {
    const tile = tileDataAt(pos.x, pos.y);
    const monster = tile.monster;
    if (!monster?.monsterHit || dispatcherOwnsEncounterAt(pos.x, pos.y)) continue;

    // Monster attack roll
    const hit = evaluateDiceRule(monster.monsterHit);

    if (hit) {
      takeDamage(monster.monsterHit.damage, {
        deathMessage: monster.monsterHit.messageHit
      });

      setMessage(
  monster.monsterHit.messageHit || "The monster strikes you!",
  {
    tileId: tile.id,
    kind: monster.monsterHit.logKind || "combat",
    html: monster.monsterHit.logHtml === true
  }
);

      
       

      // IMPORTANT: only one monster attack per check
      return;
    }
  }
}

function dispatcherOwnsEncounterAt(x, y) {
  const tile = getTileContextAt(x, y);
  const owned = EncounterRulesModule?.encounterOwner(tile.def) === "dispatcher";
  if (owned) developmentTrace?.record({ type: "legacy_hook_skipped", reason: "dispatcher_owned_source",
    sourceInstanceId: currentLevelKey + ":" + x + ":" + y + ":" + tile.id, source: { tileId: tile.id, x, y } });
  return owned;
}
function runEncounterRulesAtEvent(event, explicitBatches = null) {
  const batches = explicitBatches ?? diceEventBatches.slice(encounterBatchCursor);
  encounterBatchCursor = diceEventBatches.length;
  if (gameOver || !EncounterRulesModule || !runner || !grid?.length) return;
  developmentTrace?.record({ type: "action_boundary", phase: event,
    actionIds: batches.map(batch => batch.actionId), player: { x: runner.x, y: runner.y },
    finalDice: { die1: dieValue1, die2: dieValue2 } });
  encounterDispatcher ||= EncounterRulesModule.createEncounterDispatcher((action, context) => {
    if (gameOver) return { applied: false };
    const dice = context.event.after;
    const amount = action.amountExpression == null ? action.amount : EncounterRulesModule.evaluateEncounterExpression(action.amountExpression, { d1: dice.die1, d2: dice.die2 });
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid encounter damage");
    const message = action.message || "You take " + amount + " damage.";
    takeDamage(amount, { deathMessage: message, traceContext: {
      actionId: context.actionId, rollId: context.rollId, eventId: context.event.eventId,
      snapshot: dice, ruleId: context.rule.id, sourceInstanceId: context.sourceInstanceId,
      source: context.rule.source, player: { x: runner.x, y: runner.y }
    } });
    setMessage(message, { kind: "combat" });
    updateInfo();
    draw();
    return { traceDetails: { amount, message, heartsAfter: runner.hearts, gameOver } };
  }, developmentTrace ? record => developmentTrace.record(record) : null, restoredTurn?.ledger || {});
  const sources = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const tile = getTileContextAt(x, y);
      sources.push({ x, y, tileId: tile.id, name: tile.record?.name, definition: tile.def,
        instanceId: currentLevelKey + ":" + x + ":" + y + ":" + tile.id });
    }
  }
  encounterDispatcher.dispatch({ batches, rules: EncounterRulesModule.encounterDispatcherRules(sources, event), context: { player: { x: runner.x, y: runner.y } } });
  savePersistentGameState({ checkpoint: true });
}

// ============================================================
// Pickups
// ============================================================
function handlePickupsAtCurrent() {
  const context = getTileContextAt(runner.x, runner.y);
  const ch = context.legacyCode ?? context.id;
  const data = tileDataAt(runner.x, runner.y);
  if (!data.pickupType && data.effects.length === 0) return;

  const def = context.def || {};
  
  console.log("[PICKUP DEBUG]", {
  ch,
  pickupType: data.pickupType,
  pickupMessage: def.pickupMessage,
  deathMessage: def.deathMessage,
  msg: (def.pickupMessage || def.deathMessage || data.deathMessage || "")
});


  // Prefer pickupMessage; fall back if you still have older tiles using deathMessage
  const msg = def.pickupMessage || def.deathMessage || data.deathMessage || "";

  if (data.pickupType === "diamond") {
    runner.score++;
    runner.diamondFlashTimer = 10;
    if (msg) setMessage(msg, { tileId: context.id, kind: "diamond", html: !!def.logHtml });

  } else if (data.pickupType === "turbo") {
    runner.turbo = true;
    runner.turboFlashTimer = 10;
    runner.turboMultiplier = 2;
    if (msg) setMessage(msg, { tileId: context.id, kind: "turbo", html: !!def.logHtml });

  } else if (data.pickupType === "heart") {
    runner.hearts++;
    runner.heartFlashTimer = 10;
    if (msg) setMessage(msg, { tileId: context.id, kind: "heart", html: !!def.logHtml });

  } else if (data.pickupType === "dead") {
    runner.kills++;
    if (msg) setMessage(msg, { tileId: context.id, kind: "dead", html: !!def.logHtml });
  }

  applyPickupEffects(data.effects, { tileId: context.id, def });

  runTutorialNarrative({
    type: "pickup",
    level: currentLevelKey,
    tile: ch,
    tileId: context.id,
    variant: signVariantAt(runner.x, runner.y),
    pickupType: data.pickupType
  });
  checkStatAchievements({
    movementPoints: totalMovementPoints(),
    pickup: {
      type: data.pickupType || null,
      tile: ch,
      tileId: context.id,
      variant: signVariantAt(runner.x, runner.y)
    },
    current: {
      ...tileAchievementContext(data),
      ch,
      tileId: context.id
    }
  });

  grid[runner.y][runner.x] = AIR_TILE_ID;
  savePersistentGameState();
}

function applyTileStatGrants(tile) {
  if (!tile?.grantStats) return;

  const stats = ensureRunnerStats();
  let changed = false;
  for (const [name, amount] of Object.entries(tile.grantStats)) {
    const value = Number(amount);
    if (!name || !Number.isFinite(value)) continue;
    stats[name] = Math.max(0, Number(stats[name] || 0) + value);
    changed = true;
  }
  if (changed) checkStatAchievements();
}

function applyPickupEffects(effects, { tileId, def } = {}) {
  if (!Array.isArray(effects)) return;

  for (const effect of effects) {
    if (!effect || typeof effect !== "object") continue;
    const amount = Number(effect.amount ?? 1);

    if (effect.type === "counter" && effect.stat) {
      addRunnerCounter(effect.stat, Number.isFinite(amount) ? amount : 1);
    } else if (effect.type === "xp") {
      runner.xp = Math.max(0, (runner.xp || 0) + (Number.isFinite(amount) ? amount : 0));
      checkStatAchievements();
    } else if (effect.type === "score") {
      runner.score = Math.max(0, (runner.score || 0) + (Number.isFinite(amount) ? amount : 0));
      checkStatAchievements();
    } else if (effect.type === "heart") {
      runner.hearts = Math.max(0, (runner.hearts || 0) + (Number.isFinite(amount) ? amount : 0));
      runner.heartFlashTimer = 10;
    } else if (effect.type === "setFlag" && effect.flag) {
      runner.storyFlags = {
        ...(runner.storyFlags || {}),
        [effect.flag]: effect.value ?? true
      };
    } else if (effect.type === "message" && effect.text) {
      setMessage(effect.text, {
        tileId,
        kind: effect.kind || def?.logKind || "message",
        html: effect.html === true
      });
    }
  }
}



// ============================================================
// Gravity + bounce
// ============================================================
function startBounce(height) {
  if (height <= 0) return;
  runner.bouncePending = true;
  runner.bounceHeightRemaining = height;
  runner.fallDistance = 0;
  setMessage("Bounce");
}

function resolveFallLanding() {
  const below = tileDataAt(runner.x, runner.y + 1);
  const bVal = getBounceHeightAt(runner.x, runner.y + 1);
  const fallDistance = runner.fallDistance || 0;

  // Case 1: Not a bounce tile
  if (bVal === null) {
    if (!below.fallDamageCancel &&
        !inWater() &&
        fallDistance >= below.fallDamageThreshold &&
        below.fallDamageMultiplier > 0) {
        const amt = below.fallDamageMultiplier;
        takeDamage(amt, below);
        checkStatAchievements({
          landing: {
            type: "fall",
            fallDistance,
            tile: tileAchievementContext(below)
          },
          damage: {
            amount: amt,
            source: "fall"
          }
        });
       setMessage(`Ouch that was a hard fall. Fall damage -${amt}`);
    }
    applyTopDamage(below);
    runner.fallDistance = 0;
    return;
  }

  // Case 2: Dynamic bounce
  if (bVal === 0) {
    const dyn = Math.max(0, fallDistance - 1);
    if (dyn > 0) startBounce(dyn);
    runner.fallDistance = 0;
    return;
    setMessage("Bounce");
  }

  // Case 3: Fixed bounce
  if (bVal > 0) {
    startBounce(bVal);
    runner.fallDistance = 0;
    setMessage("Bounce");
    return;
  }
}

function applyFullGravity() {
  if (gameOver) return;
  let fell = false;

  while (true) {
    const here = tileDataAt(runner.x, runner.y);
    const below = tileDataAt(runner.x, runner.y + 1);

    // If we're in a no-gravity tile, stop gravity and clear fall distance.
    if (isFluidTile(here)) {
      runner.fallDistance = 0;
      break;
    }

    if (below.solid) break;

    runner.y += 1;
    fell = true;

    const thisTile = tileDataAt(runner.x, runner.y);

    // If we just entered fluid, do NOT accumulate fall distance.
    if (thisTile.gravity === false) {
      runner.fallDistance = 0;
      addRunnerCounter("fall_in_water");
      applyTileStatGrants(thisTile);
      setMessage("Fall was broken.");
      applyInsideDamage(thisTile);
      if (gameOver) return;
      break;
    }

    logMessage("Falling", { type: "move" });
    runner.fallDistance++;
    addRunnerCounter("fall");

    // FIX: apply inside damage to the tile we are now standing in
    applyInsideDamage(thisTile);
    if (gameOver) return;

    // OPTIONAL (recommended): exit should trigger as soon as we enter the exit tile
    if (thisTile.exit) {
      handleExit(thisTile);
      return;
    }
  }

  if (!fell) return;

  const finalHere = tileDataAt(runner.x, runner.y);
  if (finalHere.gravity !== false) {
    resolveFallLanding();
  } else {
    runner.fallDistance = 0;
  }

  // Exit should trigger before pickups can mutate the tile.
  const hereNow = tileDataAt(runner.x, runner.y);
  if (hereNow.exit) { handleExit(hereNow); return; }

  handlePickupsAtCurrent();

  // Optional: if pickups can reveal/convert into an exit, keep this.
  const afterPickups = tileDataAt(runner.x, runner.y);
  if (afterPickups.exit) { handleExit(afterPickups); return; }
}




function applyGravityAfterMove() {
  if (gameOver) return;

  const here = tileDataAt(runner.x, runner.y);
  const below = tileDataAt(runner.x, runner.y + 1);

  // If we're in fluid, gravity doesn't apply
  if (isFluidTile(here)) {
    runner.fallDistance = 0;
    checkStandingHazard();
    return;
  }

  // Supported: no falling
  if (below.solid) {
    checkStandingHazard();
    return;
  }

  // --------------------------
  // Step Gravity (1 tile)
  // --------------------------
  if (totalMovementPoints() > 0) {
    runner.y += 1;

    const nowHere = tileDataAt(runner.x, runner.y);

    // If we stepped into a no-gravity tile (water), fall distance should not accumulate.
    if (nowHere.gravity === false) {
      runner.fallDistance = 0;
      addRunnerCounter("fall_in_water");
      applyTileStatGrants(nowHere);
    } else {
      runner.fallDistance++;
      logMessage("Falling", { type: "move" });
      addRunnerCounter("fall");
    }

    // Apply INSIDE damage for the tile we are now in
    applyInsideDamage(nowHere);
    if (gameOver) return;

    // EXIT should trigger before pickups can mutate the tile
    if (nowHere.exit) {
      handleExit(nowHere);
      return;
    }

    handlePickupsAtCurrent();

    // Re-check after pickups in case a pickup changes what we're standing on
    const afterPickups = tileDataAt(runner.x, runner.y);
    if (afterPickups.exit) {
      handleExit(afterPickups);
      return;
    }

    const under = tileDataAt(runner.x, runner.y + 1);
    if (under.solid && nowHere.gravity !== false) resolveFallLanding();

    checkStandingHazard();
    return;
  }

  // --------------------------
  // Full Gravity (fall until supported or fluid)
  // --------------------------
  applyFullGravity();
  checkStandingHazard();
}


function checkStandingHazard() {
  if (inWater()) {runner.jumpCredits = 1;}
  if (inWater() || gameOver) return;
  const below = tileDataAt(runner.x, runner.y + 1);
  if (below.solid) {
    applyTopDamage(below);
    if (below.topDamage.amount > 0) updateInfo("Hazard underfoot");
  }
}

function doBounceStep() {
  if (!runner.bouncePending) return;
  if (runner.bounceHeightRemaining <= 0) {
    runner.bouncePending = false;
    updateInfo("Bounce end");
    return;
  }
  const above = tileDataAt(runner.x, runner.y - 1);
  if (above.solid || above.insideDamage.amount > 0) {
    if (above.insideDamage.amount > 0) {
      takeDamage(above.insideDamage.amount, above);
    }
    runner.bouncePending = false;
    return;
  }
  runner.y -= 1;
  runner.bounceHeightRemaining--;
  handlePickupsAtCurrent();
  updateInfo(`Bounce ↑ (${runner.bounceHeightRemaining} left)`);
}

// ============================================================
// FORCE DOWN
// ============================================================
// ============================================================
// FORCE DOWN (player-initiated downward movement)-
// ============================================================
function forceDown() {
  if (gameOver) return;

  const here = tileDataAt(runner.x, runner.y);

  // ---------------------------------------------------
  // ONLY charge movement if gravity is DISABLED (water / fluid)
  // ---------------------------------------------------
  if (here.gravity === false) {
    const moveCost = here.moveCostInside ?? here.moveCostTop ?? 1;
    if (!spendMovement(moveCost)) return;
  }

  const tx = runner.x;
  const ty = runner.y + 1;

  let below = tileDataAt(tx, ty);

  // ---------------------------------------------------
  // SPECIAL: stomp/fight a monster directly below you
  // ---------------------------------------------------
  if (below.monster) {
    // Attempt combat in-place (stomp)
    tryFightMonsterAt(tx, ty);

    // Re-check what is now below (monster might have turned into "C" or "." etc.)
    below = tileDataAt(tx, ty);

    // If still solid, you cannot move down into it this press
    if (below.solid && !below.exit) {
      updateInfo("Force-down (stomped)");
      draw();
      return;
    }
  }

  // ---------------------------------------------------
  // SPECIAL: try unlock a lock directly below you
  // ---------------------------------------------------
  if (below.lock) {
    const opened = tryUnlockLockAt(tx, ty);

    // Re-check after attempt
    below = tileDataAt(tx, ty);

    // If not opened and still solid, stop here
    if (!opened && below.solid && !below.exit) {
      updateInfo("Force-down (locked)");
      draw();
      return;
    }
  }

  // ---------------------------------------------------
  // BLOCKED (normal solids)
  // Note: exits are always enterable if you applied the tileData() fix above
  // ---------------------------------------------------
  if (below.solid && !below.exit) {
    handleBlockedTile(tx, ty, "Blocked");
    return; // handleBlockedTile already draws
  }

  // ---------------------------------------------------
  // APPLY MOVE DOWN
  // ---------------------------------------------------
  const wasInWater = inWater();

  runner.y += 1;

  const thisTile = tileDataAt(runner.x, runner.y);
  const nowInWater = (thisTile.gravity === false);

  if (nowInWater) {
    runner.fallDistance = 0;
    if (!wasInWater) setMessage("Splash! You're in water.");
  } else {
    runner.fallDistance++;
    logMessage("Down", { type: "move" });
  }

  // Exit triggers immediately upon entering
  if (thisTile.exit) {
    handleExit(thisTile);
    return;
  }

  applyInsideDamage(thisTile);
  if (gameOver) return;

  handlePickupsAtCurrent();

  const nextBelow = tileDataAt(runner.x, runner.y + 1);
  if (nextBelow.solid && thisTile.gravity !== false) {
    resolveFallLanding();
    applyTopDamage(nextBelow);
  }

  // Combat checks after movement settles
  checkAdjacentMonsterAttacks();
  runEncounterRulesAtEvent("after_move");

  updateInfo("Force-down");
  draw();
}






function attemptStep(dx, dy) {
  const fromX = runner.x;
  const fromY = runner.y;

  let toX = fromX + dx;
  let toY = fromY + dy;

  let targetChar = tileAt(toX, toY);
  let target = tileDataAt(toX, toY);

  // --- SLOPE HANDLING (match your standard movement rules) ---
  if (target.solid && target.slope) {
    const upY = toY - 1;
    const upTile = tileDataAt(toX, upY);

    if (target.slope === "left") {
      if (dx === -1 && !upTile.solid) {
        toY = upY;
      } else {
        return false;
      }
    } else if (target.slope === "right") {
      if (dx === 1 && !upTile.solid) {
        toY = upY;
      } else {
        return false;
      }
    } else {
      return false;
    }

    // Recompute target after slope adjustment
    targetChar = tileAt(toX, toY);
    target = tileDataAt(toX, toY);
  }

// --- SOLID TILE HANDLING (via shared resolver) ---
if (target.solid) {
  const result = resolveSolidInteractionAt(toX, toY, {
    blockedLabel: "Blocked",
    allowLock: true,
    allowMonster: true,
    drawAfter: false
  });

  if (result.handled) {
    return false;
  }
}

  const prevX = runner.x;
  const prevY = runner.y;

  // --- APPLY MOVE ---
  runner.x = toX;
  runner.y = toY;

  if (dy === 0 && dx !== 0) {
    logMessage(dx < 0 ? "Left" : "Right", { type: "move" });
  }

  checkLanding(prevX, prevY, runner.x, runner.y);

  const tile = tileDataAt(runner.x, runner.y);
  recordMovementStats(dx, dy, { tile });
  applyTileStatGrants(tile);
  if (tile.exit) {
    handleExit(tile);
    return false; // stop further movement
  }

  handlePickupsAtCurrent();
  return true;
}

function handleExit(tile) {
  const exitVariant = exitIdAt(runner.x, runner.y);
  const configuredExits = LEVELS?.levels?.[currentLevelKey]?.exits;
  const hasConfiguredDestination = !!configuredExits && Object.hasOwn(configuredExits, exitVariant);
  const destKey = LevelRoutingModule?.resolveExitDestination(LEVELS, currentLevelKey, exitVariant) ||
    (!hasConfiguredDestination ? (exitVariant || "default") : null);
  const mapString = destKey ? getLevelMap(destKey) : null;

  if (!isMapDocument(mapString)) {
    setMessage(`Exit ${destKey} is not wired (no level map found).`, {
      tileId: tile.id,
      kind: "message"
    });
    draw();
    return;
  }

  currentLevelKey = destKey;
  currentMapString = mapString;
  sessionStorage.setItem("levelKey", currentLevelKey);
  sessionStorage.removeItem("exitIndex"); // optional cleanup
  savePersistentGameState({ checkpoint: true });

  updateInfo(`Entering ${destKey}...`);
  draw();

  if (ResumeLinksModule) {
    window.location.hash = ResumeLinksModule.createResumeHash({
      runner,
      level: destKey
    });
  } else {
    const st = encodeCarryStatsFromRunner(runner);
    window.location.hash =
      "#map=" + encodeURIComponent(mapString) +
      "&st=" + encodeURIComponent(st);
  }

  setTimeout(() => window.location.reload(), 0);
}









// ============================================================
// MOVEMENT
// ============================================================
function singleMove(dx, dy, opts = {}) {
  const isDiagonalJump = (opts && opts.diagonal === true);

  // If diagonal jump, enforce dy=-1 and dx=±1
  if (isDiagonalJump) {
    if (dy !== -1) dy = -1;
    if (dx !== -1 && dx !== 1) return;
  }
// ============================================================
// TURBO MODE: Double-speed movement (UP/LEFT/RIGHT)
// ============================================================
if (runner.turbo && !turboExecuting) {

    const turboEligible =
        (dy === -1) ||  
        (dx === -1) ||
        (dx === 1);

    if (turboEligible) {

        // Must have at least 1 movement point, but do not spend it yet.
// Interactions like monster combat need to see the current dice values.
if (totalMovementPoints() <= 0) return;

        // ---------------------------------------------------
        // Burn a jump ONLY if trying to move UP.
        // This happens BEFORE any motion.
        // -----------------------------------------------------
        if (dy === -1) {
            if (runner.jumpCredits <= 0) return;  // Cannot jump
            runner.jumpCredits--;                 // Burn jump immediately
        }

        // -----------------------------------------------------
        // TURBO EXECUTION BEGINS
        // Prevent turbo from triggering recursively
        // -----------------------------------------------------
        turboExecuting = true;
        turboGravityUsed = false;






// SAFE STEP #1
const startX = runner.x;
const startY = runner.y;

const firstCanMove = attemptStep(dx, dy);
if (!firstCanMove) {
  turboExecuting = false;
  updateInfo("Turbo stopped");
  draw();
  return;
}

if (!spendMovement(1)) {
  runner.x = startX;
  runner.y = startY;

  turboExecuting = false;
  draw();
  return;
}

// SAFE STEP #2
const secondCanMove = attemptStep(dx, dy);

// (optional) no rollback on step 2 — consistent with standard movement

turboExecuting = false;

// FULL POST PIPELINE
runAttributeCheck();
applyGravityAfterMove();
checkAdjacentMonsterAttacks();
runEncounterRulesAtEvent("after_move");

updateInfo(secondCanMove ? "Turbo Move (2 steps!)" : "Turbo Move (1 step)");
draw();
return;
    }
}



// ============================================
// STANDARD MOVEMENT LOGIC
// ============================================


function diagonalJump(dx) {
  // dx must be -1 (left) or 1 (right)
  singleMove(dx, -1, { diagonal: true });
}

  

 if (gameOver) return;

  const fromX = runner.x;
  const fromY = runner.y;
  let toX = fromX + dx;
  let toY = fromY + dy;

  let here = tileDataAt(fromX, fromY);
  let targetChar = tileAt(toX, toY);
  let target = tileDataAt(toX, toY);

  // --- FIXED SLOPE LOGIC ---
  if (target.solid && target.slope) {
    const upY = toY - 1;
    const upTile = tileDataAt(toX, upY);
    
    if (target.slope === "left") {
        if (dx === -1 && !upTile.solid) {
            toY = upY;
            targetChar = tileAt(toX, toY);
            target = tileDataAt(toX, toY);
          logMessage("On a slope...(left)", { type: "move" });
        } else return;
    }
    else if (target.slope === "right") {
        if (dx === 1 && !upTile.solid) {
            toY = upY;
            targetChar = tileAt(toX, toY);
            target = tileDataAt(toX, toY);
          logMessage("On a slope...(right)", { type: "move" }); 
        } else return;
    }
    else return;
  }

  const attemptedMoveCost = isDiagonalJump ? 2 : (isFluidTile(here) ? target.moveCostInside : target.moveCostTop);
  developmentTrace?.record({ type: "movement_attempt", from: { x: fromX, y: fromY },
    to: { x: toX, y: toY }, timeCost: attemptedMoveCost, availableTime: totalMovementPoints(),
    selectedDie: selectedDie || "die1", turbo: turboExecuting });
  const movementAchievementContext = buildMovementAchievementContext({
    dx,
    dy,
    fromX,
    fromY,
    toX,
    toY,
    here,
    target,
    targetChar: target.legacyCode ?? target.id,
    moveCost: attemptedMoveCost,
    isDiagonalJump
  });

  if (!turboExecuting) {
    checkStatAchievements(movementAchievementContext);
    if (totalMovementPoints() < attemptedMoveCost) return;
  }

if (target.solid && !target.slope) {

  const result = resolveSolidInteractionAt(toX, toY, {
    blockedLabel: "Blocked",
    allowLock: true,
    allowMonster: true,
    drawAfter: true // IMPORTANT: singleMove expects draw side-effects
  });

  if (result.handled) {
    return;
  }
}





  const below = tileDataAt(runner.x, runner.y + 1);
  if (below.solid && !isFluidTile(here)) {
    runner.jumpCredits = 2;
  }

  if (dx < 0) runner.facingLeft = true;
  if (dx > 0) runner.facingLeft = false;

  // ======================================================
  // UP MOVEMENT VALIDATION (includes diagonal jump)
  // ======================================================
  if (dy === -1) {
    if (target.solid) return;

    // Need jump credit unless in fluid
    if (!turboExecuting && !isFluidTile(here) && runner.jumpCredits <= 0) return;
  }


  // ======================================================
  // Movement cost
  // ======================================================
  let moveCost = attemptedMoveCost;

  if (!turboExecuting) {
    if (!spendMovement(moveCost)) return;
  }

  // ======================================================
  // Apply movement
  // ======================================================
 // ======================================================
// Apply movement
// ======================================================
runner.x = toX;
runner.y = toY;

// Movement logging
if (dy === 0 && dx !== 0) {
  logMessage(dx < 0 ? "Left" : "Right", { type: "move" });
}
if (dy === -1 && !isFluidTile(target)) {
  if (isDiagonalJump) logMessage(dx < 0 ? "Jump ↖" : "Jump ↗", { type: "move" });
  else logMessage("Jump", { type: "move" });
}
// If we were falling and are now supported, resolve landing effects
const belowNow = tileDataAt(runner.x, runner.y + 1);
if (runner.fallDistance > 0 && belowNow.solid) {
  resolveFallLanding();
}

// If we entered fluid, limit jumps
if (isFluidTile(target)) runner.jumpCredits = 1;

const usedSecondVerticalJumpCredit =
  dy === -1 &&
  !isDiagonalJump &&
  !isFluidTile(target) &&
  !turboExecuting &&
  runner.jumpCredits === 1;

// Burn jump credit (only if NOT turbo; turbo wrapper already burns it)
if (dy === -1 && !isFluidTile(target) && !turboExecuting) {
  runner.jumpCredits = Math.max(0, runner.jumpCredits - 1);
}

// ======================================================
// Post-move pipeline (NO early returns for jump)
// ======================================================
handlePickupsAtCurrent();

// Re-read tile after pickups (pickups can change the tile underfoot)
const tileAfterPickups = tileDataAt(runner.x, runner.y);
recordMovementStats(dx, dy, {
  diagonalJump: isDiagonalJump,
  doubleJump: usedSecondVerticalJumpCredit,
  tile: tileAfterPickups
});
applyTileStatGrants(tileAfterPickups);
if (tileAfterPickups.exit) {
  handleExit(tileAfterPickups);
  return;
}

runAttributeCheck();

// Gravity / swim resolution
// Gravity / swim resolution
if (isFluidTile(tileAfterPickups)) {
  runner.fallDistance = 0;
  logMessage("Swim", { type: "move" });
} else {
  // IMPORTANT: if the player just moved UP, do not apply gravity immediately
  // or Step Gravity will pull them back down in the same input.
  if (dy !== -1) {
    applyGravityAfterMove();
  } else {
    // leaving water counts as "fall distance reset" start
    runner.fallDistance = 0;
  }
}


// Combat checks after movement settles
checkAdjacentMonsterAttacks();
runEncounterRulesAtEvent("after_move");

updateInfo(runner.fallDistance);
draw();

}



// ============================================================
// Drawing
// ============================================================
function drawTile(t, x, y) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;

  const img = getRenderableImageAt(x, y);

  if (img) {
    ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
    return;
  }

  return;
}



function getParamAny(name) {
  // 1) hash params (#...&fog=off)
  const hvRaw = getHashParamRaw(name);
  if (hvRaw != null) return safeDecodeURIComponent(hvRaw);

  // 2) query params (?fog=off)
  return new URLSearchParams(window.location.search || "").get(name);
}


function isFogEnabled() {
  const v = (getParamAny("fog") || "").trim().toLowerCase();

  // Choose ONE default behavior:
  // Option A: default ON (my recommendation for your engine)
  //if (!v) return true;
  //return !(v === "off" || v === "false" || v === "0" || v === "no");

  // Option B: default OFF (your current logic)
   return (v === "on" || v === "true" || v === "1" || v === "yes");
}



function drawRunner() {
  if (!runner) return;

  const px = runner.x * TILE_SIZE;
  const py = runner.y * TILE_SIZE;
  const baseImg = getTileRecord(runnerArtTileId)?.definition?.img;

  if (!baseImg) {
    ctx.fillStyle = "white";
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    return;
  }

  ctx.save();

  // -------------------------------------------------
  // DEATH FLIP (vertical, upside down)
  // -------------------------------------------------
  if (runner.dead) {
    // Flip vertically around tile center
    ctx.translate(px + TILE_SIZE / 2, py + TILE_SIZE / 2);
    ctx.scale(1, -1);
    ctx.translate(-TILE_SIZE / 2, -TILE_SIZE / 2);
    ctx.drawImage(baseImg, 0, 0, TILE_SIZE, TILE_SIZE);
    ctx.restore();
    return; // no flashes or tints after death
  }

  // -------------------------------------------------
  // NORMAL DRAWING (with facingLeft)
  // -------------------------------------------------
  if (runner.facingLeft) {
    ctx.scale(-1, 1);
    ctx.drawImage(baseImg, -(px + TILE_SIZE), py, TILE_SIZE, TILE_SIZE);
  } else {
    ctx.drawImage(baseImg, px, py, TILE_SIZE, TILE_SIZE);
  }

  ctx.restore();

  // -------------------------------------------------
  // FLASH / TINT EFFECTS (alive only)
  // -------------------------------------------------
  if (runner.damageFlashTimer > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255,0,0,0.7)";
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.globalCompositeOperation = "source-over";
  }

  if (runner.diamondFlashTimer > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(0,255,255,0.7)";
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.globalCompositeOperation = "source-over";
  }

  if (runner.heartFlashTimer > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255,80,150,0.6)";
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.globalCompositeOperation = "source-over";
  }

  if (runner.turbo) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255,215,0,0.6)";
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.globalCompositeOperation = "source-over";
  }
}


function draw() {
   if (!runner || !grid?.length) return; 

 

  // Clear first
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw tiles
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[0].length; x++) {
      drawTile(grid[y][x], x, y);
    }
  }

  // Draw runner
  drawRunner();

  
  
  
if (isFogEnabled()) {
  revealAround(runner.x, runner.y);
  drawFogOverlay();
}


  // HUD label
  ctx.fillStyle = "white";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "right";
  const levelLabel = currentLevelKey || "Level-?";
  ctx.fillText(`${levelLabel} | ${VERSION}`, canvas.width - 10, canvas.height - 10);
}

// ============================================================
// Input
// ============================================================
window.addEventListener("keydown", e => {
  if (modalOpen) return; // HARD PAUSE
  e.preventDefault();
  if (gameOver) return;

  const k = e.key.toLowerCase();

  if (k === "a") singleMove(-1, 0);
  if (k === "d") singleMove(1, 0);
  if (k === "s") forceDown();
  if (k === "w") singleMove(0, -1);

  // NEW:
  if (k === "q") diagonalJump(-1);
  if (k === "e") diagonalJump(1);
});


document.addEventListener("DOMContentLoaded", () => {
  setupDieSelection();

  document.getElementById("btn-up").onclick = () => singleMove(0, -1);
  document.getElementById("btn-down").onclick = () => forceDown();
  document.getElementById("btn-left").onclick = () => singleMove(-1, 0);
  document.getElementById("btn-right").onclick = () => singleMove(1, 0);

  // NEW:
  document.getElementById("btn-up-left").onclick = () => diagonalJump(-1);
  document.getElementById("btn-up-right").onclick = () => diagonalJump(1);

  document.getElementById("roll").onclick = () => rollDice();
  document.getElementById("create-resume-link").onclick = async () => {
    const linkInput = document.getElementById("resume-link");
    const resumeLink = window.getRunnerResumeLink?.();
    if (!resumeLink || !linkInput) return;

    linkInput.value = resumeLink;
    linkInput.hidden = false;
    linkInput.focus();
    linkInput.select();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(resumeLink);
      setMessage("Portable resume link copied.");
    } catch {
      setMessage("Portable resume link ready to copy.");
    }
  };
});
// ============================================================
// Dice roll
// ============================================================
function isLevelObjectiveComplete() {
  const here = tileDataAt(runner.x, runner.y);
  const exitVariant = exitIdAt(runner.x, runner.y);
  return !!(here?.exit || exitVariant);
}

function rollDice() {
  if (gameOver || turnTransaction) return;
  if (!diceEngine) initializeDiceEngine();
  turnTransaction = true;
  try {
    const before = diceEngine.getState();
    developmentTrace?.record({ type: "roll_attempt", before: before.dice, rollCount, timeCost: 0 });
    const closing = diceEngine.endTurn({ actionId: `end-${before.currentRollId || crypto.randomUUID()}` });
    if (!applyDiceEngineResult(closing, { action: "end_turn", timeCost: 0, before: before.dice })) return;
    updateDiceDisplay(dieValue1, dieValue2, false);
    runner.movementLeft = totalMovementPoints();
    // Each dispatch drains its child queue before the next boundary begins.
    runEncounterRulesAtEvent("dice_changed");
    if (!gameOver && closing.lifecycleBatch) {
      developmentTrace?.record({ type: "turn_ended", batch: closing.lifecycleBatch });
      runEncounterRulesAtEvent("turn_ended", [closing.lifecycleBatch]);
      // Existing Roll-time drowning becomes an explicit once-per-turn effect.
      if (!gameOver && inWater()) {
        takeDamage(1, { ...tileDataAt(runner.x, runner.y), deathMessage: "Drowning, took damage" });
        if (!gameOver) setMessage("Drowning, took damage");
      }
    } else if (!gameOver && before.turnPhase === "idle" && inWater()) {
      // Preserve initial-roll drowning without inventing a completed turn.
      takeDamage(1, { ...tileDataAt(runner.x, runner.y), deathMessage: "Drowning, took damage" });
      if (!gameOver) setMessage("Drowning, took damage");
    }
    if (gameOver || runner.hearts <= 0) return;
    if (isLevelObjectiveComplete()) {
      turnOutcome = { kind: "success", message: "Level complete." };
      gameOver = true;
      runner.dead = false;
      setMessage(turnOutcome.message);
      developmentTrace?.record({ type: "objective_complete", rollCount });
      return;
    }
    const budget = calculateCurrentRollLimitState();
    if (budget.rollLimit !== null && budget.rollsRemaining === 0) {
      deathReason = `Out of rolls: you used all ${budget.rollLimit} rolls without finishing the level.`;
      developmentTrace?.record({ type: "roll_limit", outcome: "death", ...budget });
      endGame();
      return;
    }
    synchronizeDiceEngineRollLimit();
    runner.turbo = false;
    const capacities = diceEngine.getState().capacities;
    const a = Math.floor(Math.random() * Math.min(6, capacities.die1)) + 1;
    const b = Math.floor(Math.random() * Math.min(6, capacities.die2)) + 1;
    const result = diceEngine.startRoll({ actionId: `roll-${crypto.randomUUID()}`, values: { die1: a, die2: b } });
    if (!applyDiceEngineResult(result, { action: "roll", timeCost: 0, before: result.batch?.events[0]?.before })) return;
    updateDiceDisplay(a, b, true);
    addRunnerCounter("dice_roll");
    runner.jumpCredits = 2;
    runner.movementLeft = totalMovementPoints();
    const here = tileDataAt(runner.x, runner.y);
    if (!isFluidTile(here) && !tileDataAt(runner.x, runner.y + 1).solid) applyFullGravity();
    logMessage(`Rolled ${a}+${b} = ${a + b}`, { type: "roll" });
    const remaining = calculateCurrentRollLimitState();
    if (remaining.rollLimit !== null && remaining.rollsRemaining === 0 && !isLevelObjectiveComplete()) {
      setMessage("Final roll! No rolls remaining after this one. Clicking Roll ends your turn and your run unless you finish the level.", { kind: "message" });
    }
    runEncounterRulesAtEvent("after_roll");
  } finally {
    turnTransaction = false;
    updateInfo();
    draw();
    savePersistentGameState({ checkpoint: true });
  }
}

function setupDieSelection() {
  const die1 = document.getElementById("die1");
  const die2 = document.getElementById("die2");
  if (!die1 || !die2) return;

  function selectDie(dieElement) {
    if (selectedDie === dieElement.id) {
      dieElement.classList.remove("selected");
      selectedDie = null;
      diceEngine?.selectDie("die1");
      developmentTrace?.record({ type: "die_selected", selectedDie: "die1", explicitSelection: false, timeCost: 0 });
      return;
    }
    die1.classList.remove("selected");
    die2.classList.remove("selected");
    dieElement.classList.add("selected");
    selectedDie = dieElement.id;
    diceEngine?.selectDie(selectedDie);
    developmentTrace?.record({ type: "die_selected", selectedDie, timeCost: 0 });
  }
  die1.addEventListener("click", () => selectDie(die1));
  die2.addEventListener("click", () => selectDie(die2));
}

function loop() {
  if (!runner) return;
  if (runner.damageFlashTimer > 0) runner.damageFlashTimer--;
  if (runner.diamondFlashTimer > 0) runner.diamondFlashTimer--;
  if (runner.turboFlashTimer > 0) runner.turboFlashTimer--;
  if (runner.heartFlashTimer > 0) runner.heartFlashTimer--;

  if (runner.bouncePending) {
    doBounceStep();
  }
  draw();
  requestAnimationFrame(loop);
}

function endGame() {
  if (gameOver) return;
  developmentTrace?.record({ type: "game_over", message: deathReason || "Reached the exit!",
    remainingDice: { die1: dieValue1, die2: dieValue2 }, rollCount });
  turnOutcome = { kind: "death", message: deathReason };
  gameOver = true;
    // NEW
  runner.dead = true;
  if (deathReason) setMessage(deathReason);
  else setMessage("Reached the exit!");
  dieValue1 = 0;
  dieValue2 = 0;
  if (diceEngine) {
    diceEngine = createGameDiceEngine({
      initialDice: { die1: 0, die2: 0 },
      selected: selectedDie || "die1",
      playerRollCount: rollCount,
      turnPhase: "closed",
      currentRollId: diceEngine.getState().currentRollId
    });
  }
  runner.movementLeft = 0;
  updateDiceDisplay(0, 0, false);
  setMessage("Game over");
  savePersistentGameState({ checkpoint: true });
  
}
