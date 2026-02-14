//version 1.4 Final - 2/01 1356 2026 - 01
// ================================================ = == = ========
// Dice display + spin
// ============================================================
window.updateDiceDisplay = function(a, b, shouldSpin = true) {
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
let rollCount = 0;
let dieValue1 = 0;
let dieValue2 = 0;
let selectedDie = null;
let deathReason = "";
let bounceHeight = [];
let sinkDelayMap = [];
let turboExecuting = false;
// Global grid/runner variables (initialized in initGame)
let grid = [];
let runner = null; 
let monsterStateMap = [];
let currentLevelKey = "default";
let turboGravityUsed = false;
let kills = 0;


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

  
function getMapFromURL() {
  const raw = getHashParamRaw("map");
  if (raw != null && raw !== "") return safeDecodeURIComponent(raw);

  sessionStorage.removeItem("exitIndex");
  sessionStorage.removeItem("levelKey");
  currentExitIndex = 0;
  currentLevelKey = "default";
  return null;
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
let TILE = {
  "X": { solid: true, gravity: true },
  ".": { solid: false, gravity: true }
};

const TILE_FALLBACK_IMG = {
  "E": null,
  "X": null
};

function svgToImg(svg) {
  const img = new Image();
  img.src = "data:image/svg+xml;base64," + btoa(svg);
  return img;
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
    "https://corsproxy.io/?https://clikproductions.com/runner/tiles2.json",
    "https://api.allorigins.win/raw?url=https://clikproductions.com/runner/tiles2.json"
];

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
      console.log(`[Runner] Successfully loaded tiles from: ${url}`);
      return res;
    })
    .catch(err => {
      console.warn(`[Runner] Network error for ${url}. Trying next URL...`, err);
      return tryFetch(urls);
    });
}


tryFetch([...TILE_URLS])
  .then(res => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  })
  .then(json => {
    console.log("[Runner] tiles2.json loaded successfully.");
    for (const key in json) {
      if (!TILE[key]) TILE[key] = {};
      TILE[key] = { ...TILE[key], ...json[key] };
    }
    for (const key in TILE) {
      const def = TILE[key];
      if (!def) continue;
      
      // Base tile svg
      if (typeof def.svg === "string" && def.svg.trim().length > 0) {
        def.img = svgToImg(def.svg);
      }
      
     // Monster variant SVGs
  if (def.monster) {
    for (const v in def.monster) {
      const m = def.monster[v];
      if (typeof m.svg === "string" && m.svg.trim()) {
        m.img = svgToImg(m.svg);
      }
    }
  } 
      // Lock variant SVGs (K.a, K.b, etc.)
if (key === "K" && def.lock) {
  for (const v in def.lock) {
    const l = def.lock[v];
    if (typeof l.svg === "string" && l.svg.trim()) {
      l.img = svgToImg(l.svg);
    }
  }
}
// Generic variant SVG loaders (optional but recommended)
const VARIANT_BUCKETS = ["sign", "exit", "platform", "pickup", "decor"];

for (const bucket of VARIANT_BUCKETS) {
  const obj = def[bucket];
  if (!obj || typeof obj !== "object") continue;

  for (const v in obj) {
    const entry = obj[v];
    if (entry && typeof entry.svg === "string" && entry.svg.trim()) {
      entry.img = svgToImg(entry.svg);
    }
  }
}

    }
    // FIX: Initialize game ONLY after tiles are loaded
    initGame(); 
  })
  .catch(err => {
    console.error("[Runner] Failed to load tiles2.json, using fallback only:", err);
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
  const out = { ...DEFAULT_CARRY_STATS };
  if (!str || typeof str !== "string") return out;

  const parts = str.split(".");
  if (parts[0] !== "v1") return out;

  for (let i = 1; i < parts.length; i++) {
    const t = parts[i];
    if (t.startsWith("h")) out.hearts = parseInt(t.slice(1), 36) || out.hearts;
    else if (t.startsWith("s")) out.score = parseInt(t.slice(1), 36) || out.score;
    else if (t.startsWith("k")) out.kills = parseInt(t.slice(1), 36) || out.kills;
    else if (t.startsWith("t")) out.turbo = (parseInt(t.slice(1), 36) || 0) === 1;
    else if (t.startsWith("m")) out.turboMultiplier = parseInt(t.slice(1), 36) || out.turboMultiplier;
  }

  // sanity clamps
  out.hearts = Math.max(0, out.hearts);
  out.score = Math.max(0, out.score);
  out.kills = Math.max(0, out.kills);
  out.turboMultiplier = Math.max(1, out.turboMultiplier);

  return out;
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

    // --- DECODER FUNCTIONS ---
function decodeRow(encoded, rowIndex) {
  let tiles = [];
  let variants = [];

  monsterStateMap[rowIndex] = [];

  let i = 0;

  while (i < encoded.length && tiles.length < COLS) {
    const ch = encoded[i];

    // -------------------------
    // Literal dot support
    // -------------------------
    if (ch === ".") {
      tiles.push(".");
      variants.push(null);
      i++;
      continue;
    }

    // Only parse letters as tokens
    if (!/[A-Za-z]/.test(ch)) {
      i++;
      continue;
    }

    // Base tile char (A is encoded air)
    let tileChar = (ch === "A") ? "." : ch;

    let variant = null;
    let count = 1;

    // -------------------------
    // NEW: brace variant form: T{variant}N
    // Example: I{aa}1
    // -------------------------
    if (encoded[i + 1] === "{") {
      const end = encoded.indexOf("}", i + 2);
      if (end !== -1) {
        variant = sanitizeVariant(encoded.slice(i + 2, end));
        i = end + 1; // now positioned after }
      } else {
        // malformed token; treat as single tile
        i++;
      }

      // Read digits after brace (count)
      let num = "";
      while (i < encoded.length && /\d/.test(encoded[i])) {
        num += encoded[i];
        i++;
      }
      if (num) count = parseInt(num, 10) || 1;

    } else if (/[A-Z]/.test(ch) && /[a-z]/.test(encoded[i + 1] || "")) {
      // -------------------------
      // LEGACY: single-letter variant: Ia, Ma, Ka
      // Optional digits after it: Ia3
      // -------------------------
      variant = sanitizeVariant(encoded[i + 1]);
      i += 2;

      let num = "";
      while (i < encoded.length && /\d/.test(encoded[i])) {
        num += encoded[i];
        i++;
      }
      if (num) count = parseInt(num, 10) || 1;

    } else {
      // -------------------------
      // RUN-LENGTH: TNNN (or bare T meaning 1)
      // -------------------------
      i += 1;

      let num = "";
      while (i < encoded.length && /\d/.test(encoded[i])) {
        num += encoded[i];
        i++;
      }
      if (num) count = parseInt(num, 10) || 1;
    }

    // Emit cells
    for (let k = 0; k < count && tiles.length < COLS; k++) {
      tiles.push(tileChar);

      // Never store variants on air
      const v = (tileChar === ".") ? null : (variant || null);
      variants.push(v);

      // Initialize monster HP at this position
      if (tileChar === "M") {
        const xPos = tiles.length - 1;
        const def = TILE["M"]?.monster?.[v];
        monsterStateMap[rowIndex][xPos] = def?.hp ?? 1;
      }
    }
  }

  // Pad out the row
  while (tiles.length < COLS) {
    tiles.push(".");
    variants.push(null);
  }

  // Clamp
  tiles.length = COLS;
  variants.length = COLS;

  signVariantMap[rowIndex] = variants;
  return tiles.join("");
}


  const savedLevel = sessionStorage.getItem("levelKey");
if (savedLevel) {
  currentLevelKey = savedLevel;
}

function decodeMap(encoded) {
  let rowStrings;

  if (encoded.includes("~")) rowStrings = encoded.split("~");
  else if (encoded.includes(".")) rowStrings = encoded.split(".");
  else rowStrings = [encoded]; // single-row fallback

  const output = [];
  bounceHeight = [];
  sinkDelayMap = [];

  for (let r = 0; r < rowStrings.length && output.length < ROWS; r++) {
    const decoded = decodeRow(rowStrings[r] || "", output.length);
    output.push(decoded.split(""));
    bounceHeight.push(Array(COLS).fill(0));
    sinkDelayMap.push(Array(COLS).fill(null));
  }

  while (output.length < ROWS) {
    output.push(Array(COLS).fill("."));
    bounceHeight.push(Array(COLS).fill(0));
    sinkDelayMap.push(Array(COLS).fill(null));
    signVariantMap[output.length - 1] = Array(COLS).fill(null);
    monsterStateMap[output.length - 1] = Array(COLS).fill(null);
  }

  return output;
}


function hasEDefaultMap() {
  const s = TILE?.["E"]?.["default"];
  return (typeof s === "string" && s.trim().length > 0);
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
    const encodedMap = getMapFromURL();
  


 /*  if (encodedMap) {
  console.log("Using encoded map:", encodedMap);
  grid = decodeMap(encodedMap);

} else {
  console.log("No #map in URL; using tiles2.json E.default (or fallback)");
  signVariantMap = []; // reset variants for new map

  if (hasEDefaultMap()) {
    console.log("[Runner] Boot map from tiles2.json: E.default");
    currentLevelKey = "default";
    sessionStorage.setItem("levelKey", "default");
    grid = decodeMap(TILE["E"]["default"]);
  } else {
    console.warn("[Runner] tiles2.json missing E.default; using DEFAULT_ENCODED_MAP");
    currentLevelKey = "default";
    sessionStorage.setItem("levelKey", "default");
    grid = decodeMap(DEFAULT_ENCODED_MAP);
  } 
}*/

if (encodedMap) {
  console.log("Using encoded map:", encodedMap);
  grid = decodeMap(encodedMap);

} else {
  console.log("No #map in URL; booting from tiles2.json E.default ONLY");
  signVariantMap = []; // reset variants for new map

  const mapString = TILE?.E?.default;

  if (typeof mapString !== "string" || !mapString.trim()) {
    // Hard fail: do NOT load factory, do NOT guess.
    gameOver = true;
    setMessage("BOOT ERROR: tiles2.json is missing E.default, so no level can load.", {
      kind: "message"
    });
    draw();
    return;
  }

  currentLevelKey = "default";
  sessionStorage.setItem("levelKey", "default");
  grid = decodeMap(mapString);
}



  
  // Reset exit progression when a new map loads
if (!sessionStorage.getItem("exitIndex")) {
  currentExitIndex = 0;
  sessionStorage.setItem("exitIndex", 0);
}


    // --- RUNNER PLACEMENT (Robust Fallback) ---
    let startX = 1; 
    let startY = ROWS - 1; 

    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[0].length; x++) {
        if (grid[y][x] === "R") {
          startX = x;
          startY = y;
          grid[y][x] = "."; 
        }
      }
    }

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
  dead: false
};
  
if (isFogEnabled()) initFogForCurrentGrid();
else fog = null;


    // Start the game loop now that everything is ready
    startGameLoop();
}


// ===========================================================
// TILE HELPERS
// ============================================================
function tileAt(x, y) {
  // Guard against grid not being ready
  if (!grid || !grid.length) return "X";
  if (x < 0 || y < 0 || y >= grid.length || x >= grid[0].length) return "X";
  return grid[y][x];
}

function getTileHintAt(x, y) {
  const ch = tileAt(x, y);
  const def = TILE[ch];
  if (!def) return null;

  const v = signVariantAt(x, y);

  // Monster variant override (preferred, because monsters are variant-driven)
  if (def.monster && v && def.monster[v] && def.monster[v].hint) {
    return def.monster[v].hint;
  }

  // Generic hint support
  const h = def.hint;
  if (!h) return null;

  // Simple string hint
  if (typeof h === "string") return h;

  // Variant dictionary hint: { a: "...", b: "...", default: "..." }
  if (v && typeof h === "object" && h[v]) return h[v];
  if (typeof h === "object" && h.default) return h.default;

  return null;
}


function getSignMessageAt(x, y) {


  const ch = tileAt(x, y);

  const def = TILE[ch];

  if (!def) {
    return null;
  }


  if (!def.signMessage) {
    return null;
  }

  if (typeof def.signMessage === "string") {
    return def.signMessage;
  }

  const v = signVariantAt(x, y);

  const msg = v && def.signMessage[v] ? def.signMessage[v] : null;

  return msg;
}

function getSignPayloadAt(x, y) {
  const ch = tileAt(x, y);
  const def = TILE[ch];
  if (!def) return null;

  const v = signVariantAt(x, y);

  // Prefer HTML sign text if present
  if (def.signHtml) {
    const html =
      typeof def.signHtml === "string"
        ? def.signHtml
        : (v && def.signHtml[v]) ? def.signHtml[v] : null;

    if (html) return { text: html, html: true, tileChar: ch };
  }

  // Fallback to plain signMessage
  if (def.signMessage) {
    const msg =
      typeof def.signMessage === "string"
        ? def.signMessage
        : (v && def.signMessage[v]) ? def.signMessage[v] : null;

    if (msg) return { text: msg, html: false, tileChar: ch };
  }

  return null;
}



function tileData(ch) {
  const def = TILE[ch] || {};
  const exit = !!def.exit;

  // Exits must be enterable; treat as non-solid even if tiles2.json accidentally marks solid:true
  const solid = exit ? false : (def.solid === true);

  const gravity = def.gravity !== undefined ? def.gravity : true;

  return {
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
  if (tileAt(x, y) !== "E") return null;
  return signVariantAt(x, y) || "default";
}



function TIP(tileChar) { return tileData(tileChar); }
function isFluidTile(tile) { return (!tile.solid && tile.gravity === false); }

function inWater() {
  const here = tileData(tileAt(runner.x, runner.y));
  return isFluidTile(here);
}

function resetFallDistanceIfNoGravityHere() {
  const here = tileData(tileAt(runner.x, runner.y));
  if (here.gravity === false) {
    runner.fallDistance = 0;
    return true;
  }
  return false;
}


function checkLanding(prevX, prevY, newX, newY) {
  const wasSupported = tileData(tileAt(prevX, prevY + 1)).solid;
  const isSupported  = tileData(tileAt(newX,  newY  + 1)).solid;

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
  const here = tileData(tileAt(runner.x, runner.y));
  const below = tileData(tileAt(runner.x, runner.y + 1));
  applyInsideDamage(here);
  if (below.solid) {
    applyTopDamage(below);
  }
}

function getBounceHeightAt(x, y) {
  const ch = tileAt(x, y);
  const def = TILE[ch];
  if (!def || def.bounce === undefined || def.bounce === null) return null; 
  return def.bounce;
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
  scroll = true
} = {}) {
  const def = tileChar && TILE?.[tileChar] ? TILE[tileChar] : null;

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
    tileChar: p.tileChar,
    kind: "sign",
    html: p.html || looksLikeHtml
  });
} else {
  setMessage(label, { kind: "message" });
}


  draw();
}



function totalMovementPoints() { return dieValue1 + dieValue2; }

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

  const lines = [
    label ? `${label}` : null,
    `Moves: ${moves}`,
    `Fall: ${fallDistance}`,
    `Jumps: ${jumps}`,
    `Hearts: ${hearts}`,
    `Diamonds: ${diamonds}`,
    `Kills: ${killCount}`,
    `Times rolled: ${rolls}`
  ].filter(Boolean);

  el.innerHTML = lines.join("<br>");
}




function setMessage(msg, { tileChar = null, kind = "message", html = false, scroll = true } = {}) {
  if (!msg || !msg.trim()) return;

  // Use tile-aware logger so tiles can override kind/html via tiles2.json
  logTileText(msg, { tileChar, kind, html, scroll });
}



function checkDeath() {
  if (runner.hearts <= 0 && !gameOver) {
    endGame();
    return true;
  }
  return false;
}

function takeDamage(n, sourceTile) {
  runner.hearts -= n;
  runner.damageFlashTimer = 10;
  deathReason = sourceTile.deathMessage;
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
function useMovementPoint() {
  if (!selectedDie) selectedDie = "die1";

  if (selectedDie === "die1") {
    if (dieValue1 > 0) {
      dieValue1--;
    } else if (dieValue2 > 0) {
      selectedDie = "die2";
      dieValue2--;
    } else {
      return; 
    }
  } else if (selectedDie === "die2") {
    if (dieValue2 > 0) {
      dieValue2--;
    } else if (dieValue1 > 0) {
      selectedDie = "die1";
      dieValue1--;
    } else {
      return;
    }
  }

  updateDiceDisplay(dieValue1, dieValue2, false);
  const die1 = document.getElementById("die1");
  const die2 = document.getElementById("die2");
  die1.classList.toggle("selected", selectedDie === "die1");
  die2.classList.toggle("selected", selectedDie === "die2");
}

function spendMovement(cost) {
  if (totalMovementPoints() < cost) return false;
  let remaining = cost;
  while (remaining > 0) {
    useMovementPoint();
    remaining -= 1;
    if (totalMovementPoints() <= 0 && remaining > 0) return false;
  }
  runner.movementLeft = totalMovementPoints();
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
  const ch = tileAt(x, y);
  const def = TILE[ch];

  if (!def || !def.lock) return false;

  const variant = signVariantAt(x, y);
  if (!variant) return false;

  const rule = def.lock[variant];
  if (!rule) return false;

  // Debug (optional)
  console.log("LOCK DEBUG", {
    x, y,
    variant,
    die1: dieValue1,
    die2: dieValue2
  });

  if (evaluateDiceRule(rule)) {
    grid[y][x] = ".";
    signVariantMap[y][x] = null;

    setMessage("The lock clicks open.", { tileChar: "K", kind: "lock" });

    
    return true;
  }

  setMessage(rule.messageFail || "The lock will not open.", { tileChar: "K", kind: "lock" });
  return false;
}


function tryFightMonsterAt(x, y) {

  const ch = tileAt(x, y);

  const def = TILE[ch];

  if (!def || !def.monster) {
    return false;
  }

  const variant = signVariantAt(x, y);

  const monster = def.monster[variant];

  if (!monster) {
    return false;
  }

  let hp = monsterStateMap[y]?.[x];

  // ---------- PLAYER ATTACK ----------
  if (monster.playerHit) {

    const hitResult = evaluateDiceRule(monster.playerHit);
    

    if (hitResult) {
      hp -= monster.playerHit.damage;
      monsterStateMap[y][x] = hp;
      setMessage(monster.playerHit.messageHit || "You hit the monster.", { tileChar: "M", kind: "combat" });
    } else {
      setMessage(monster.playerHit.messageFail || monster.messageFail || "You cannot hurt the monster.",  { tileChar: "M", kind: "combat" });
      return false;
    }
  } else {
  }

  // ---------- MONSTER ATTACK ----------
  if (hp > 0 && monster.monsterHit) {

    const monsterHitResult = evaluateDiceRule(monster.monsterHit);
   
    if (monsterHitResult) {
      takeDamage(monster.monsterHit.damage, {
        deathMessage: monster.monsterHit.messageHit
      });
      setMessage(monster.monsterHit.messageHit, { tileChar: "M", kind: "combat" });
    } 
  }

  // ---------- DEATH CHECK ----------
  if (hp <= 0) {
  // Turn monster into skull
 grid[y][x] = "C";
signVariantMap[y][x] = null;
monsterStateMap[y][x] = null;


  setMessage(`${monster.name} defeated.`, { tileChar: "M", kind: "message" });
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
    const ch = tileAt(pos.x, pos.y);
    if (ch !== "M") continue;

    const def = TILE[ch];
    if (!def?.monster) continue;

    const variant = signVariantAt(pos.x, pos.y);
    if (variant === "dead") continue;
    const monster = def.monster[variant];
    if (!monster?.monsterHit) continue;

    // Monster attack roll
    const hit = evaluateDiceRule(monster.monsterHit);

    if (hit) {
      takeDamage(monster.monsterHit.damage, {
        deathMessage: monster.monsterHit.messageHit
      });

      setMessage(
  monster.monsterHit.messageHit || "The monster strikes you!",
  {
    tileChar: "M",
    kind: monster.monsterHit.logKind || "combat",
    html: monster.monsterHit.logHtml === true
  }
);

      
       

      // IMPORTANT: only one monster attack per check
      return;
    }
  }
}



// ============================================================
// Pickups
// ============================================================
function handlePickupsAtCurrent() {
  const ch = tileAt(runner.x, runner.y);
  const data = tileData(ch);
  if (!data.pickupType) return;

  const def = TILE?.[ch] || {};
  
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
    if (msg) setMessage(msg, { tileChar: ch, kind: "diamond", html: !!def.logHtml });

  } else if (data.pickupType === "turbo") {
    runner.turbo = true;
    runner.turboFlashTimer = 10;
    runner.turboMultiplier = 2;
    if (msg) setMessage(msg, { tileChar: ch, kind: "turbo", html: !!def.logHtml });

  } else if (data.pickupType === "heart") {
    runner.hearts++;
    runner.heartFlashTimer = 10;
    if (msg) setMessage(msg, { tileChar: ch, kind: "heart", html: !!def.logHtml });

  } else if (data.pickupType === "dead") {
    runner.kills++;
    if (msg) setMessage(msg, { tileChar: ch, kind: "dead", html: !!def.logHtml });
  }

  grid[runner.y][runner.x] = ".";
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
  const below = tileData(tileAt(runner.x, runner.y + 1));
  const bVal = getBounceHeightAt(runner.x, runner.y + 1);

  // Case 1: Not a bounce tile
  if (bVal === null) {
    if (!below.fallDamageCancel &&
        !inWater() &&
        runner.fallDistance >= below.fallDamageThreshold &&
        below.fallDamageMultiplier > 0) {
        const amt = below.fallDamageMultiplier;
        takeDamage(amt, below);
       setMessage(`Ouch that was a hard fall. Fall damage -${amt}`);
    }
    applyTopDamage(below);
    runner.fallDistance = 0;
    return;
  }

  // Case 2: Dynamic bounce
  if (bVal === 0) {
    const dyn = Math.max(0, runner.fallDistance - 1);
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
    const here = tileData(tileAt(runner.x, runner.y));
    const belowChar = tileAt(runner.x, runner.y + 1);
    const below = tileData(belowChar);

    // If we're in a no-gravity tile, stop gravity and clear fall distance.
    if (isFluidTile(here)) {
      runner.fallDistance = 0;
      break;
    }

    if (below.solid) break;

    runner.y += 1;
    fell = true;

    const thisTile = tileData(tileAt(runner.x, runner.y));

    // If we just entered fluid, do NOT accumulate fall distance.
    if (thisTile.gravity === false) {
      runner.fallDistance = 0;
      setMessage("Fall was broken.");
      applyInsideDamage(thisTile);
      if (gameOver) return;
      break;
    }

    logMessage("Falling", { type: "move" });
    runner.fallDistance++;

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

  const finalHere = tileData(tileAt(runner.x, runner.y));
  if (finalHere.gravity !== false) {
    resolveFallLanding();
  } else {
    runner.fallDistance = 0;
  }

  // Exit should trigger before pickups can mutate the tile.
  const hereNow = tileData(tileAt(runner.x, runner.y));
  if (hereNow.exit) { handleExit(hereNow); return; }

  handlePickupsAtCurrent();

  // Optional: if pickups can reveal/convert into an exit, keep this.
  const afterPickups = tileData(tileAt(runner.x, runner.y));
  if (afterPickups.exit) { handleExit(afterPickups); return; }
}




function applyGravityAfterMove() {
  if (gameOver) return;

  const here = tileData(tileAt(runner.x, runner.y));
  const belowChar = tileAt(runner.x, runner.y + 1);
  const below = tileData(belowChar);

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

    const nowHere = tileData(tileAt(runner.x, runner.y));

    // If we stepped into a no-gravity tile (water), fall distance should not accumulate.
    if (nowHere.gravity === false) {
      runner.fallDistance = 0;
    } else {
      runner.fallDistance++;
      logMessage("Falling", { type: "move" });
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
    const afterPickups = tileData(tileAt(runner.x, runner.y));
    if (afterPickups.exit) {
      handleExit(afterPickups);
      return;
    }

    const under = tileData(tileAt(runner.x, runner.y + 1));
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
  const below = tileData(tileAt(runner.x, runner.y + 1));
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
  const above = tileData(tileAt(runner.x, runner.y - 1));
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

  const here = tileData(tileAt(runner.x, runner.y));

  // ---------------------------------------------------
  // ONLY charge movement if gravity is DISABLED (water / fluid)
  // ---------------------------------------------------
  if (here.gravity === false) {
    const moveCost = here.moveCostInside ?? here.moveCostTop ?? 1;
    if (!spendMovement(moveCost)) return;
  }

  const tx = runner.x;
  const ty = runner.y + 1;

  let belowChar = tileAt(tx, ty);
  let below = tileData(belowChar);

  // ---------------------------------------------------
  // SPECIAL: stomp/fight a monster directly below you
  // ---------------------------------------------------
  if (belowChar === "M") {
    // Attempt combat in-place (stomp)
    tryFightMonsterAt(tx, ty);

    // Re-check what is now below (monster might have turned into "C" or "." etc.)
    belowChar = tileAt(tx, ty);
    below = tileData(belowChar);

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
  if (belowChar === "K") {
    const opened = tryUnlockLockAt(tx, ty);

    // Re-check after attempt
    belowChar = tileAt(tx, ty);
    below = tileData(belowChar);

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

  const thisTile = tileData(tileAt(runner.x, runner.y));
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

  const nextBelow = tileData(tileAt(runner.x, runner.y + 1));
  if (nextBelow.solid && thisTile.gravity !== false) {
    resolveFallLanding();
    applyTopDamage(nextBelow);
  }

  // Combat checks after movement settles
  checkAdjacentMonsterAttacks();

  updateInfo("Force-down");
  draw();
}






function attemptStep(dx, dy) {
  const fromX = runner.x;
  const fromY = runner.y;

  let toX = fromX + dx;
  let toY = fromY + dy;

  let targetChar = tileAt(toX, toY);
  let target = tileData(targetChar);

  // --- SLOPE HANDLING (match your standard movement rules) ---
  if (target.solid && target.slope) {
    const upY = toY - 1;
    const upTile = tileData(tileAt(toX, upY));

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
    target = tileData(targetChar);
  }

  // --- SOLID TILE HANDLING (locks/monsters/signs) ---
  if (target.solid) {
    const ch = tileAt(toX, toY);

    if (ch === "K") {
      tryUnlockLockAt(toX, toY);
      return false;
    }

    if (ch === "M") {
      tryFightMonsterAt(toX, toY);
      return false;
    }

    handleBlockedTile(toX, toY, "Blocked"); // this already draws
    return false;
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

  const tile = tileData(tileAt(runner.x, runner.y));
  if (tile.exit) {
    handleExit(tile);
    return false; // stop further movement
  }

  handlePickupsAtCurrent();
  return true;
}

function handleExit(tile) {
  // find the exit key (variant) at runner position
  const destKey = exitIdAt(runner.x, runner.y) || "default";

  const mapString = TILE?.E?.[destKey];

  if (typeof mapString !== "string" || !mapString.trim()) {
    setMessage(`Exit ${destKey} is not wired (no TILE.E.${destKey} map found).`, {
      tileChar: "E",
      kind: "message"
    });
    draw();
    return;
  }

  currentLevelKey = destKey;
  sessionStorage.setItem("levelKey", currentLevelKey);
  sessionStorage.removeItem("exitIndex"); // optional cleanup

  updateInfo(`Entering ${destKey}...`);
  draw();

  const st = encodeCarryStatsFromRunner(runner);
  window.location.hash =
    "#map=" + encodeURIComponent(mapString) +
    "&st=" + encodeURIComponent(st);

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

        // Must have at least 1 movement point!
        if (!spendMovement(1)) return; 

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

        // -----------------------------------------------------
        // SAFE STEP #1
        // -----------------------------------------------------
// SAFE STEP #1
const firstCanMove = attemptStep(dx, dy);
if (!firstCanMove) {
  turboExecuting = false;

  const tx = runner.x + dx;
  const ty = runner.y + dy;

handleBlockedTile(tx, ty, "Turbo Blocked");
turboExecuting = false;
return; // handleBlockedTile already draws
}


// Turbo gravity: allow ONLY once
if (dy === 0 && !turboGravityUsed) {
  applyGravityAfterMove();
  turboGravityUsed = true;
}

// SAFE STEP #2
attemptStep(dx, dy);
// END TURBO
turboExecuting = false;


        // End turbo if entering fluid
        const afterTile = tileData(tileAt(runner.x, runner.y));
      
      
        if (isFluidTile(afterTile)) {
            runner.turbo = false;
            runner.turboFlashTimer = 0;
        }

        // End turbo if movement ends
        if (totalMovementPoints() <= 0) {
            runner.turbo = false;
            runner.turboFlashTimer = 0;
        }

        updateInfo("Turbo Move (2 steps!)");
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
  if (totalMovementPoints() <= 0 && !turboExecuting) return; // Allow if executing turbo

  const fromX = runner.x;
  const fromY = runner.y;
  let toX = fromX + dx;
  let toY = fromY + dy;

  let here = tileData(tileAt(fromX, fromY));
  let targetChar = tileAt(toX, toY);
  let target = tileData(targetChar);

  // --- FIXED SLOPE LOGIC ---
  if (target.solid && target.slope) {
    const upY = toY - 1;
    const upTile = tileData(tileAt(toX, upY));
    
    if (target.slope === "left") {
        if (dx === -1 && !upTile.solid) {
            toY = upY;
            targetChar = tileAt(toX, toY);
            target = tileData(targetChar);
          logMessage("On a slope...(left)", { type: "move" });
        } else return;
    }
    else if (target.slope === "right") {
        if (dx === 1 && !upTile.solid) {
            toY = upY;
            targetChar = tileAt(toX, toY);
            target = tileData(targetChar);
          logMessage("On a slope...(right)", { type: "move" }); 
        } else return;
    }
    else return;
  }

if (target.solid && !target.slope) {

  // LOCK HANDLING
if (tileAt(toX, toY) === "K") {
  if (tryUnlockLockAt(toX, toY)) {
    // Lock opened; allow next move
    draw();
    return;
  }
  draw();
  return;
}

if (tileAt(toX, toY) === "M") {
  tryFightMonsterAt(toX, toY);
  draw();
  return;
}


  // SIGN FALLBACK
handleBlockedTile(toX, toY, "Blocked");
return; // handleBlockedTile already draws
}



  const below = tileData(tileAt(runner.x, runner.y + 1));
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
  let moveCost = isDiagonalJump ? 2 : (isFluidTile(here) ? target.moveCostInside : target.moveCostTop);

  if (!turboExecuting) {
    if (!spendMovement(moveCost)) return;
  }

  const hadJumpCredit = (dy === -1 && !isFluidTile(target) && runner.jumpCredits > 0);

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
const belowNow = tileData(tileAt(runner.x, runner.y + 1));
if (runner.fallDistance > 0 && belowNow.solid) {
  resolveFallLanding();
}

// If we entered fluid, limit jumps
if (isFluidTile(target)) runner.jumpCredits = 1;

// Burn jump credit (only if NOT turbo; turbo wrapper already burns it)
if (dy === -1 && !isFluidTile(target) && !turboExecuting) {
  runner.jumpCredits = Math.max(0, runner.jumpCredits - 1);
}

// ======================================================
// Post-move pipeline (NO early returns for jump)
// ======================================================
handlePickupsAtCurrent();

// Re-read tile after pickups (pickups can change the tile underfoot)
const tileAfterPickups = tileData(tileAt(runner.x, runner.y));
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

updateInfo(runner.fallDistance);
draw();

}



// ============================================================
// Drawing
// ============================================================
function drawTile(t, x, y) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const def = TILE[t];

  let img = def?.img || null;

  // Monster variant override
  if (def?.monster) {
    const v = signVariantAt(x, y);
    const m = def.monster?.[v];
    if (m?.img) {
      img = m.img;
    }
  }

    // Lock variant override
  if (t === "K" && def?.lock) {
    const v = signVariantAt(x, y);
    const l = def.lock?.[v];
    if (l?.img) {
      img = l.img;
    }
  }


  if (img) {
    ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
    return;
  }

  // fallback
  //ctx.fillStyle = "#000";
  //ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  // fallback: transparent (draw nothing)
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
  const runnerTile = TILE["R"];
  const baseImg = runnerTile?.img;

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
});
// ============================================================
// Dice roll
// ============================================================
function rollDice() {
  if (gameOver) return;
  runner.turbo = false;
if (inWater()) {
  const tile = tileData(tileAt(runner.x, runner.y));
  takeDamage(1, tile);

  // what you asked for:
  setMessage("Drowning, took damage");

}

  const a = Math.floor(Math.random() * 6) + 1;
  const b = Math.floor(Math.random() * 6) + 1;

  rollCount++;
  dieValue1 = a;
  dieValue2 = b;
  updateDiceDisplay(a, b, true);
  runner.jumpCredits = 2;
  runner.movementLeft = totalMovementPoints();

  const here = tileData(tileAt(runner.x, runner.y));
  if (!isFluidTile(here)) {
    const below = tileData(tileAt(runner.x, runner.y + 1));
    if (!below.solid) {
      applyFullGravity();
    }
  }
  const rollText = `Rolled ${a}+${b} = ${a + b}`;
logMessage(rollText, { type: "roll" });

}

function setupDieSelection() {
  const die1 = document.getElementById("die1");
  const die2 = document.getElementById("die2");
  if (!die1 || !die2) return;

  function selectDie(dieElement) {
    if (selectedDie === dieElement.id) {
      dieElement.classList.remove("selected");
      selectedDie = null;
      return;
    }
    die1.classList.remove("selected");
    die2.classList.remove("selected");
    dieElement.classList.add("selected");
    selectedDie = dieElement.id;
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
  gameOver = true;
    // NEW
  runner.dead = true;
  if (deathReason) setMessage(deathReason);
  else setMessage("Reached the exit!");
  dieValue1 = 0;
  dieValue2 = 0;
  runner.movementLeft = 0;
  updateDiceDisplay(0, 0, false);
  setMessage("Game over");
  
}
