import { sanitizeVariant } from "./variants.js";

export const DEFAULT_COLS = 25;
export const DEFAULT_ROWS = 15;

export function splitRowsFlexible(raw) {
  const value = String(raw || "").trim();
  if (!value) return [];

  const delimiter = value.includes("~") ? "~" : value.includes(".") ? "." : null;
  const rows = delimiter ? value.split(delimiter) : value.split(/\r?\n/);

  return rows.map(row => row.trim()).filter(Boolean);
}

export function encodeTileChar(tile) {
  return tile === "." ? "A" : tile;
}

export function decodeTileChar(tile) {
  return tile === "A" ? "." : tile;
}

export function encodeRowWithVariants(rowTiles, rowVariants = [], cols = DEFAULT_COLS) {
  const tiles = normalizeRow(rowTiles, cols);
  const variants = normalizeVariantRow(rowVariants, cols);
  let result = "";
  let count = 1;

  const normalizedVariant = (tile, variant) => {
    if (tile === "." || tile === "A") return "";
    return sanitizeVariant(variant);
  };

  for (let x = 1; x <= cols; x++) {
    const prevTile = tiles[x - 1];
    const prevVariant = normalizedVariant(prevTile, variants[x - 1]);
    const currentTile = tiles[x];
    const currentVariant = normalizedVariant(currentTile, variants[x]);

    if (x < cols && currentTile === prevTile && currentVariant === prevVariant) {
      count++;
      continue;
    }

    const encodedTile = encodeTileChar(prevTile);
    result += prevVariant ? `${encodedTile}{${prevVariant}}${count}` : `${encodedTile}${count}`;
    count = 1;
  }

  return result;
}

export function decodeRowToTilesAndVariants(encoded, cols = DEFAULT_COLS) {
  const source = String(encoded || "");
  const tiles = [];
  const variants = [];
  let index = 0;

  while (index < source.length && tiles.length < cols) {
    const char = source[index];

    if (char === ".") {
      tiles.push(".");
      variants.push("");
      index++;
      continue;
    }

    if (!/[A-Za-z]/.test(char)) {
      index++;
      continue;
    }

    let tile = decodeTileChar(char);
    let variant = "";
    let count = 1;

    if (source[index + 1] === "{") {
      const end = source.indexOf("}", index + 2);
      if (end !== -1) {
        variant = sanitizeVariant(source.slice(index + 2, end));
        index = end + 1;
      } else {
        index++;
      }
    } else if (/[A-Z]/.test(char) && /[a-z]/.test(source[index + 1] || "")) {
      variant = sanitizeVariant(source[index + 1]);
      index += 2;
    } else {
      index++;
    }

    let digits = "";
    while (index < source.length && /\d/.test(source[index])) {
      digits += source[index];
      index++;
    }
    if (digits) count = parseInt(digits, 10) || 1;

    for (let i = 0; i < count && tiles.length < cols; i++) {
      tiles.push(tile);
      variants.push(tile === "." ? "" : variant);
    }
  }

  while (tiles.length < cols) {
    tiles.push(".");
    variants.push("");
  }

  tiles.length = cols;
  variants.length = cols;

  return { tiles, variants };
}

export function decodeMap(encoded, { rows = DEFAULT_ROWS, cols = DEFAULT_COLS } = {}) {
  const rowStrings = splitRowsFlexible(encoded);
  const tiles = [];
  const variants = [];

  for (let y = 0; y < rows; y++) {
    const decoded = decodeRowToTilesAndVariants(rowStrings[y] || "", cols);
    tiles.push(decoded.tiles);
    variants.push(decoded.variants);
  }

  return { tiles, variants };
}

export function encodeMap(tiles, variants = [], { rows = DEFAULT_ROWS, cols = DEFAULT_COLS } = {}) {
  const encodedRows = [];

  for (let y = 0; y < rows; y++) {
    encodedRows.push(encodeRowWithVariants(tiles[y] || [], variants[y] || [], cols));
  }

  return encodedRows.join("~");
}

function normalizeRow(row, cols) {
  const value = Array.isArray(row) ? row : String(row || "").split("");
  const normalized = value.slice(0, cols).map(tile => tile || ".");
  while (normalized.length < cols) normalized.push(".");
  return normalized;
}

function normalizeVariantRow(row, cols) {
  const value = Array.isArray(row) ? row : [];
  const normalized = value.slice(0, cols).map(variant => sanitizeVariant(variant));
  while (normalized.length < cols) normalized.push("");
  return normalized;
}
