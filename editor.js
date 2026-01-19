// ---------------------------------------------------------
// Global tile metadata (loaded from tiles2.json)
// ---------------------------------------------------------
let TILE = {};          // tile definitions with svg/img etc.
const ROWS = 15;
const COLS = 25;

let selectedTile = ".";

// In-memory map (rows × cols of tile chars)
const map = Array.from({ length: ROWS }, () => Array(COLS).fill("."));

// Parallel variant grid ("" means no variant)
const variantMap = Array.from({ length: ROWS }, () => Array(COLS).fill(""));

const grid = document.getElementById("grid");
const variantBox = document.getElementById("variantBox");

// ---------------------------------------------------------
// Variant sanitization (safe URL + safe keys)
// Adjust allowed chars/len as you like
// ---------------------------------------------------------
function sanitizeVariant(raw) {
  if (!raw) return "";
  const v = String(raw).trim();
  if (!v) return "";
  // allow a-z, 0-9, underscore, dash only
  const cleaned = v.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned.slice(0, 12);
}

function getBrushVariant() {
  return sanitizeVariant(variantBox ? variantBox.value : "");
}

function setBrushVariant(v) {
  if (!variantBox) return;
  variantBox.value = sanitizeVariant(v);
}

// ---------------------------------------------------------
// SVG to Image (same as game)
// ---------------------------------------------------------
function svgToImg(svg) {
  const img = new Image();
  img.src = "data:image/svg+xml;base64," + btoa(svg);
  return img;
}

// ---------------------------------------------------------
// Load tiles2.json and prep TILE images + palette
// ---------------------------------------------------------
fetch("https://corsproxy.io/?https://clikproductions.com/runner/tiles2.json?cachekill=" + Date.now())
  .then(res => res.json())
  .then(json => {
    TILE = json || {};

    // Attach img objects for any SVG tiles
    for (const code in TILE) {
      const def = TILE[code];
      if (def && typeof def.svg === "string" && def.svg.trim().length > 0) {
        def.img = svgToImg(def.svg);
      }
    }

    console.log("[EDITOR] tiles2.json loaded", TILE);
    buildTileSelector();
  })
  .catch(err => {
    console.error("[EDITOR] Failed to load tiles2.json", err);
  });

// ---------------------------------------------------------
// Draw tile to mini canvas cell (optionally overlay variant)
// ---------------------------------------------------------
function drawTileToContext(ctx, tile, size, variant = "") {
  ctx.clearRect(0, 0, size, size);

  const def = TILE[tile];

  // If tile has a sprite image, use it
  if (def && def.img) {
    ctx.drawImage(def.img, 0, 0, size, size);
  } else {
    // Fallback basic colors if no SVG defined
    switch (tile) {
      case "W": ctx.fillStyle = "#3498db"; break;  // water
      case "L": ctx.fillStyle = "#e74c3c"; break;  // lava
      case "P": ctx.fillStyle = "#777777"; break;  // platform
      case "E": ctx.fillStyle = "#2ecc71"; break;  // exit
      default:  ctx.fillStyle = "#000000"; break;  // air / unknown
    }
    ctx.fillRect(0, 0, size, size);
  }

  // Variant overlay (small label, top-left)
  const v = sanitizeVariant(variant);
  if (v) {
    ctx.save();
    ctx.font = "bold 8px monospace";
    ctx.textBaseline = "top";
    // small dark backing for legibility
    const label = v.length > 4 ? v.slice(0, 4) + "…" : v;
    const pad = 2;
    const metrics = ctx.measureText(label);
    const w = Math.ceil(metrics.width) + pad * 2;
    const h = 10;

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, pad, 1);
    ctx.restore();
  }
}

// ---------------------------------------------------------
// Helper: highlight selected tile button in palette
// ---------------------------------------------------------
function highlightPaletteTile(code) {
  document.querySelectorAll(".tile-selector").forEach(b => {
    b.classList.toggle("selected", b.dataset.tile === code);
  });
}

// ---------------------------------------------------------
// Build editor grid (using CANVAS for each tile)
// ---------------------------------------------------------
if (grid) {
  // prevent right-click menu on the grid area
  grid.addEventListener("contextmenu", (e) => e.preventDefault());

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cell = document.createElement("canvas");
      cell.classList.add("cell");
      cell.width = 24;
      cell.height = 24;
      cell.dataset.x = x;
      cell.dataset.y = y;

      drawTileToContext(cell.getContext("2d"), ".", 24, "");

      // Use mousedown so we can detect right-click
      cell.addEventListener("mousedown", (e) => {
        const cx = parseInt(cell.dataset.x, 10);
        const cy = parseInt(cell.dataset.y, 10);

        const isPick = e.shiftKey || e.button === 2; // Shift or right-click
        if (isPick) {
          // PICK: read cell -> set selected tile + variant textbox
          selectedTile = map[cy][cx];
          highlightPaletteTile(selectedTile);
          setBrushVariant(variantMap[cy][cx] || "");
          return;
        }

        // PAINT: set tile + variant
        map[cy][cx] = selectedTile;

        // Do not store variants for air
        if (selectedTile === "." || selectedTile === "A") {
          variantMap[cy][cx] = "";
        } else {
          variantMap[cy][cx] = getBrushVariant();
        }

        drawTileToContext(
          cell.getContext("2d"),
          map[cy][cx],
          24,
          variantMap[cy][cx]
        );
      });

      grid.appendChild(cell);
    }
  }
}

// ---------------------------------------------------------
// Dynamic tile selector from TILE map
// ---------------------------------------------------------
function buildTileSelector() {
  const palette = document.getElementById("tilePalette");
  if (!palette) {
    console.warn("[EDITOR] No #tilePalette element found.");
    return;
  }

  palette.innerHTML = "";

  for (const code in TILE) {
    const def = TILE[code];
    const btn = document.createElement("button");
    btn.classList.add("tile-selector");
    btn.dataset.tile = code;
    btn.title = code;

    if (def && def.img) {
      const icon = def.img.cloneNode(true);
      icon.width = 20;
      icon.height = 20;
      btn.appendChild(icon);
    } else {
      btn.textContent = code;
    }

    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tile-selector")
        .forEach(b => b.classList.remove("selected"));

      btn.classList.add("selected");
      selectedTile = code;
      // Do not auto-change variant brush here; brush stays as-is
    });

    palette.appendChild(btn);
  }

  // Default highlight
  highlightPaletteTile(selectedTile);

  console.log("[EDITOR] Tile palette built.");
}

// ---------------------------------------------------------
// ENCODING / DECODING (tile + optional {variant} + count)
// "." is encoded as "A" (air alias) for backward compatibility
// ---------------------------------------------------------
function encodeChar(c) {
  return (c === "." ? "A" : c);
}

function encodeRowWithVariants(y) {
  let result = "";
  let count = 1;

  const rowTiles = map[y];
  const rowVars = variantMap[y];

  const normVar = (t, v) => {
    // air never carries variant
    if (t === "." || t === "A") return "";
    return sanitizeVariant(v || "");
  };

  for (let x = 1; x <= COLS; x++) {
    const prevT = rowTiles[x - 1];
    const prevV = normVar(prevT, rowVars[x - 1]);

    const curT = rowTiles[x];
    const curV = normVar(curT, rowVars[x]);

    if (x < COLS && curT === prevT && curV === prevV) {
      count++;
    } else {
      const t = encodeChar(prevT);
      if (prevV) result += `${t}{${prevV}}${count}`;
      else result += `${t}${count}`;
      count = 1;
    }
  }

  return result;
}

function decodeRowToTilesAndVariants(encoded) {
  // Supports both:
  // - old: P12A3W1
  // - new: I{aa}1P12
  const regex = /([A-Za-z])(?:\{([^}]*)\})?(\d+)/g;

  const tiles = [];
  const vars = [];

  let match;
  while ((match = regex.exec(encoded)) !== null) {
    let char = match[1];
    const rawVar = match[2]; // may be undefined
    const count = parseInt(match[3], 10);

    if (char === "A") char = ".";

    const v = sanitizeVariant(rawVar || "");
    for (let i = 0; i < count; i++) {
      tiles.push(char);
      // store no variant for air
      vars.push(char === "." ? "" : v);
    }
  }

  // Pad/truncate to COLS defensively
  while (tiles.length < COLS) { tiles.push("."); vars.push(""); }
  tiles.length = COLS;
  vars.length = COLS;

  return { tiles, vars };
}

// ---------------------------------------------------------
// Clear map
// ---------------------------------------------------------
document.getElementById("clearMap").addEventListener("click", () => {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      map[y][x] = ".";
      variantMap[y][x] = "";
    }
  }

  // redraw grid as empty
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cell = grid.children[y * COLS + x];
      drawTileToContext(cell.getContext("2d"), ".", 24, "");
    }
  }

  document.getElementById("mapBox").value = "";
  history.replaceState(null, "", window.location.pathname);

  console.log("[EDITOR] Map cleared and URL reset.");
});

// ---------------------------------------------------------
// Load map from textarea
// ---------------------------------------------------------
document.getElementById("loadMap").addEventListener("click", () => {
  const code = document.getElementById("mapBox").value.trim();
  if (!code) return alert("Paste a map code first.");

  const rows = code.split(".");
  if (rows.length !== ROWS) {
    return alert("Incorrect number of rows.");
  }

  for (let y = 0; y < ROWS; y++) {
    const decoded = decodeRowToTilesAndVariants(rows[y]);

    for (let x = 0; x < COLS; x++) {
      map[y][x] = decoded.tiles[x];
      variantMap[y][x] = decoded.vars[x];

      drawTileToContext(
        grid.children[y * COLS + x].getContext("2d"),
        map[y][x],
        24,
        variantMap[y][x]
      );
    }
  }

  console.log("[EDITOR] Map loaded from textarea.");
});

// ---------------------------------------------------------
// Generate code from current map
// ---------------------------------------------------------
document.getElementById("generateMap").addEventListener("click", () => {
  const encoded = Array.from({ length: ROWS }, (_, y) => encodeRowWithVariants(y)).join(".");
  document.getElementById("mapBox").value = encoded;
  console.log("[EDITOR] Map encoded to textarea.");
});

// ---------------------------------------------------------
// Open map in game
// ---------------------------------------------------------
document.getElementById("openMap").addEventListener("click", () => {
  const code = document.getElementById("mapBox").value.trim();
  if (!code) return alert("Generate or paste a map first.");

  window.open(
    "https://clikproductions.com/runner/index.html#map=" + encodeURIComponent(code),
    "_blank"
  );
});

// ---------------------------------------------------------
// Hollow Knight-style cave generator
// (Variants are blanked)
// ---------------------------------------------------------
function generateHollowKnightCave() {
  const tiles = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ".")
  );

  let topY = 2;
  let bottomY = ROWS - 3;

  for (let x = 0; x < COLS; x++) {
    const r = Math.random();

    if (r < 0.05 && topY > 1) topY--;
    else if (r < 0.10 && topY < ROWS - 5) topY++;

    if (r < 0.15 && bottomY > topY + 5) bottomY--;
    else if (r < 0.25 && bottomY < ROWS - 1) bottomY++;

    for (let y = 0; y < topY; y++) tiles[y][x] = "P";
    for (let y = bottomY; y < ROWS; y++) tiles[y][x] = "P";

    if (Math.random() < 0.15) {
      const ledgeY = Math.floor((topY + bottomY) / 2);
      const width = Math.floor(Math.random() * 3) + 1;
      for (let w = 0; w < width && x + w < COLS; w++) {
        tiles[ledgeY][x + w] = "P";
      }
    }

    if (Math.random() < 0.05) {
      const roomHeight = Math.floor(Math.random() * 3) + 3;
      const roomStart = Math.max(topY + 2, 2);
      const roomEnd = Math.min(bottomY - 2, ROWS - 3);
      for (let y = roomStart; y < roomStart + roomHeight && y < roomEnd; y++) {
        tiles[y][x] = ".";
      }
    }

    if (Math.random() < 0.03) {
      const shaftStart = topY + 1;
      const shaftEnd = bottomY - 1;
      for (let y = shaftStart; y < shaftEnd; y++) {
        tiles[y][x] = ".";
      }
    }
  }

  return tiles;
}

// ---------------------------------------------------------
// Dynamic Map Button
// ---------------------------------------------------------
document.getElementById("dynamicMap").addEventListener("click", () => {
  const tiles = generateHollowKnightCave();

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      map[y][x] = tiles[y][x];
      variantMap[y][x] = ""; // clear variants for generated maps

      drawTileToContext(
        grid.children[y * COLS + x].getContext("2d"),
        map[y][x],
        24,
        ""
      );
    }
  }

  const encoded = Array.from({ length: ROWS }, (_, y) => encodeRowWithVariants(y)).join(".");
  document.getElementById("mapBox").value = encoded;

  console.log("[EDITOR] Dynamic cave map generated.");
});

// ---------------------------------------------------------
// AUTO-LOAD MAP FROM URL (#map=...)
// ---------------------------------------------------------
(function loadMapFromURL() {
  const hash = window.location.hash;
  if (!hash.startsWith("#map=")) return;

  const code = decodeURIComponent(hash.slice(5));
  if (!code) return;

  const rows = code.split(".");
  if (rows.length !== ROWS) {
    alert("Map code in URL is invalid (wrong row count).");
    return;
  }

  for (let y = 0; y < ROWS; y++) {
    const decoded = decodeRowToTilesAndVariants(rows[y]);

    for (let x = 0; x < COLS; x++) {
      map[y][x] = decoded.tiles[x];
      variantMap[y][x] = decoded.vars[x];

      drawTileToContext(
        grid.children[y * COLS + x].getContext("2d"),
        map[y][x],
        24,
        variantMap[y][x]
      );
    }
  }

  document.getElementById("mapBox").value = code;
  console.log("[EDITOR] Loaded map from URL.");
})();
