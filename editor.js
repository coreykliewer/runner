// ---------------------------------------------------------
// Global tile metadata (loaded from tiles2.json)
// ---------------------------------------------------------
let TILE = {};          // tile definitions with svg/img etc.
const ROWS = 15;
const COLS = 25;
let selectedTile = ".";

// In-memory map (rows × cols of tile chars)
const map = Array.from({ length: ROWS }, () => Array(COLS).fill("."));
const grid = document.getElementById("grid");

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
// Draw tile to mini canvas cell
// ---------------------------------------------------------
function drawTileToContext(ctx, tile, size) {
  ctx.clearRect(0, 0, size, size);

  const def = TILE[tile];

  // If tile has a sprite image, use it
  if (def && def.img) {
    ctx.drawImage(def.img, 0, 0, size, size);
    return;
  }

  // Fallback basic colors if no SVG defined
  switch (tile) {
    case "W": ctx.fillStyle = "#3498db"; break;  // water
    case "L": ctx.fillStyle = "#e74c3c"; break;  // lava
    case "P": ctx.fillStyle = "#777777"; break;  // platform
    case "E": ctx.fillStyle = "#2ecc71"; break;  // exit pad
    default:  ctx.fillStyle = "#000000"; break;  // air / unknown
  }

  ctx.fillRect(0, 0, size, size);
}

// ---------------------------------------------------------
// Build editor grid (using CANVAS for each tile)
// ---------------------------------------------------------
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const cell = document.createElement("canvas");
    cell.classList.add("cell");
    cell.width = 24;
    cell.height = 24;
    cell.dataset.x = x;
    cell.dataset.y = y;

    drawTileToContext(cell.getContext("2d"), ".", 24);

    cell.addEventListener("click", () => {
      map[y][x] = selectedTile;
      drawTileToContext(cell.getContext("2d"), selectedTile, 24);
    });

    grid.appendChild(cell);
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
      const icon = def.img.cloneNode();
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
    });

    palette.appendChild(btn);
  }

  console.log("[EDITOR] Tile palette built.");
}

// ---------------------------------------------------------
// ENCODING / DECODING
// ---------------------------------------------------------
function encodeRow(row) {
  let result = "";
  let count = 1;

  const encodeChar = c => (c === "." ? "A" : c);

  for (let i = 1; i <= row.length; i++) {
    if (row[i] === row[i - 1]) {
      count++;
    } else {
      result += encodeChar(row[i - 1]) + count;
      count = 1;
    }
  }
  return result;
}

function decodeRow(encoded) {
  const regex = /([A-Za-z])(\d+)/g;
  let row = "";
  let match;

  while ((match = regex.exec(encoded)) !== null) {
    let char = match[1];
    const count = parseInt(match[2], 10);
    if (char === "A") char = ".";
    row += char.repeat(count);
  }

  return row.padEnd(COLS, ".");
}

// ---------------------------------------------------------
// Clear map
// ---------------------------------------------------------
document.getElementById("clearMap").addEventListener("click", () => {
  // reset map array
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      map[y][x] = ".";
    }
  }

  // redraw grid as empty
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cell = grid.children[y * COLS + x];
      drawTileToContext(cell.getContext("2d"), ".", 24);
    }
  }

  // clear textbox
  document.getElementById("mapBox").value = "";

  // remove #map=... from url
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
    const decoded = decodeRow(rows[y]);
    for (let x = 0; x < COLS; x++) {
      map[y][x] = decoded[x];
      drawTileToContext(
        grid.children[y * COLS + x].getContext("2d"),
        decoded[x],
        24
      );
    }
  }

  console.log("[EDITOR] Map loaded from textarea.");
});

// ---------------------------------------------------------
// Generate code from current map
// ---------------------------------------------------------
document.getElementById("generateMap").addEventListener("click", () => {
  const encoded = map.map(r => encodeRow(r)).join(".");
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
    "https://clikproductions.com/runner/index.html#map=" + code,
    "_blank"
  );
});

// ---------------------------------------------------------
// Hollow Knight-style cave generator
// ---------------------------------------------------------
function generateHollowKnightCave() {
  const tiles = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ".")
  );

  let topY = 2;
  let bottomY = ROWS - 3;

  for (let x = 0; x < COLS; x++) {
    const r = Math.random();

    // Drift top boundary
    if (r < 0.05 && topY > 1) topY--;
    else if (r < 0.10 && topY < ROWS - 5) topY++;

    // Drift bottom boundary
    if (r < 0.15 && bottomY > topY + 5) bottomY--;
    else if (r < 0.25 && bottomY < ROWS - 1) bottomY++;

    // Fill ceiling and floor
    for (let y = 0; y < topY; y++) tiles[y][x] = "P";
    for (let y = bottomY; y < ROWS; y++) tiles[y][x] = "P";

    // Random ledges inside cavern
    if (Math.random() < 0.15) {
      const ledgeY = Math.floor((topY + bottomY) / 2);
      const width = Math.floor(Math.random() * 3) + 1;

      for (let w = 0; w < width && x + w < COLS; w++) {
        tiles[ledgeY][x + w] = "P";
      }
    }

    // Occasional big open rooms
    if (Math.random() < 0.05) {
      const roomHeight = Math.floor(Math.random() * 3) + 3;
      const roomStart = Math.max(topY + 2, 2);
      const roomEnd = Math.min(bottomY - 2, ROWS - 3);

      for (let y = roomStart; y < roomStart + roomHeight && y < roomEnd; y++) {
        tiles[y][x] = ".";
      }
    }

    // Rare vertical shaft
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
      drawTileToContext(
        grid.children[y * COLS + x].getContext("2d"),
        tiles[y][x],
        24
      );
    }
  }

  const encoded = map.map(row => encodeRow(row)).join(".");
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
    const decoded = decodeRow(rows[y]);

    for (let x = 0; x < COLS; x++) {
      map[y][x] = decoded[x];
      drawTileToContext(
        grid.children[y * COLS + x].getContext("2d"),
        decoded[x],
        24
      );
    }
  }

  document.getElementById("mapBox").value = code;
  console.log("[EDITOR] Loaded map from URL.");
})();
