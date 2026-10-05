import { mergeVariantDef } from "./variants.js";

export const DEFAULT_TILE_URLS = ["tiles2.json"];

export function addCacheBust(url, now = Date.now()) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}cb=${now}`;
}

export async function loadTileDefinitions({
  urls = DEFAULT_TILE_URLS,
  fetchImpl = globalThis.fetch,
  cacheBust = true
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required to load tile definitions.");
  }

  const errors = [];

  for (const url of urls) {
    try {
      const target = cacheBust ? addCacheBust(url) : url;
      const response = await fetchImpl(target, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return prepareTileDefinitions(await response.json());
    } catch (error) {
      errors.push({ url, error });
    }
  }

  const message = errors.map(item => `${item.url}: ${item.error.message}`).join("; ");
  throw new Error(`Unable to load tile definitions. ${message}`);
}

export function prepareTileDefinitions(rawTiles, { imageFactory = null } = {}) {
  const tiles = rawTiles && typeof rawTiles === "object" ? structuredCloneSafe(rawTiles) : {};

  for (const key of Object.keys(tiles)) {
    prepareTileImage(tiles[key], imageFactory);
    for (const bucket of ["monster", "lock", "sign", "exit", "platform", "pickup", "decor", "narrative"]) {
      const group = tiles[key]?.[bucket];
      if (!group || typeof group !== "object") continue;
      for (const variantKey of Object.keys(group)) {
        prepareTileImage(group[variantKey], imageFactory);
      }
    }
  }

  return tiles;
}

export function getTileContext({ tiles, mapTiles, mapVariants, x, y }) {
  const ch = mapTiles?.[y]?.[x] || ".";
  const variant = mapVariants?.[y]?.[x] || "";
  const baseDef = tiles?.[ch] || {};
  return {
    x,
    y,
    ch,
    ...mergeVariantDef(baseDef, variant)
  };
}

function prepareTileImage(def, imageFactory) {
  if (!def || typeof def.svg !== "string" || typeof imageFactory !== "function") return;
  def.img = imageFactory(def.svg);
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
