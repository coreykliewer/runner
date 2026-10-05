import { decodeMap, DEFAULT_COLS, DEFAULT_ROWS } from "./shared/mapCodec.js";
import { sanitizeVariant, VARIANT_BUCKETS } from "./shared/variants.js";

export function validateTiles(tiles) {
  const issues = [];

  if (!tiles || typeof tiles !== "object") {
    return [{ severity: "error", path: "tiles", message: "Tile definitions must be an object." }];
  }

  for (const [code, def] of Object.entries(tiles)) {
    if (!/^[A-Za-z.]$/.test(code)) {
      issues.push(issue("error", `tiles.${code}`, "Tile code must be one letter or '.'."));
    }
    if (!def || typeof def !== "object") {
      issues.push(issue("error", `tiles.${code}`, "Tile definition must be an object."));
      continue;
    }
    if (def.solid != null && typeof def.solid !== "boolean") {
      issues.push(issue("error", `tiles.${code}.solid`, "solid must be boolean."));
    }
    if (def.gravity != null && typeof def.gravity !== "boolean") {
      issues.push(issue("error", `tiles.${code}.gravity`, "gravity must be boolean."));
    }
    if (def.tags != null) {
      if (!Array.isArray(def.tags)) {
        issues.push(issue("error", `tiles.${code}.tags`, "tags must be an array."));
      } else {
        for (const [index, tag] of def.tags.entries()) {
          if (typeof tag !== "string" || sanitizeVariant(tag) !== tag) {
            issues.push(issue("error", `tiles.${code}.tags[${index}]`, "Tile tags must be sanitized strings."));
          }
        }
      }
    }
    if (def.effects != null) {
      issues.push(...validateEffects(def.effects, `tiles.${code}.effects`));
    }
    if (def.grantStats != null) {
      issues.push(...validateStatGrants(def.grantStats, `tiles.${code}.grantStats`, "Tile stat grants"));
    }
    for (const bucket of VARIANT_BUCKETS) {
      const group = def[bucket];
      if (!group) continue;
      if (typeof group !== "object") continue;
      if (typeof group !== "object" || Array.isArray(group)) {
        issues.push(issue("error", `tiles.${code}.${bucket}`, "Variant bucket must be an object."));
        continue;
      }
      for (const key of Object.keys(group)) {
        if (sanitizeVariant(key) !== key) {
          issues.push(issue("error", `tiles.${code}.${bucket}.${key}`, "Variant key is not sanitized."));
        }
      }
    }
  }

  return issues;
}

function validateEffects(effects, path) {
  const issues = [];
  const allowed = new Set(["counter", "xp", "heart", "score", "message", "setFlag"]);

  if (!Array.isArray(effects)) {
    return [issue("error", path, "effects must be an array.")];
  }

  for (const [index, effect] of effects.entries()) {
    const effectPath = `${path}[${index}]`;
    if (!effect || typeof effect !== "object" || Array.isArray(effect)) {
      issues.push(issue("error", effectPath, "Effect must be an object."));
      continue;
    }

    if (!allowed.has(effect.type)) {
      issues.push(issue("error", `${effectPath}.type`, "Effect type is not supported."));
      continue;
    }

    if (effect.type === "counter" && !effect.stat) {
      issues.push(issue("error", `${effectPath}.stat`, "Effect stat is required."));
    }
    if (effect.type === "message" && !effect.text) {
      issues.push(issue("error", `${effectPath}.text`, "Message effect text is required."));
    }
    if (effect.type === "setFlag" && !effect.flag) {
      issues.push(issue("error", `${effectPath}.flag`, "Flag effect name is required."));
    }
    if (effect.amount != null && !Number.isFinite(Number(effect.amount))) {
      issues.push(issue("error", `${effectPath}.amount`, "Effect amount must be numeric."));
    }
  }

  return issues;
}

function validateStatGrants(grants, path, label) {
  const issues = [];
  if (typeof grants !== "object" || Array.isArray(grants)) {
    return [issue("error", path, `${label} must be an object.`)];
  }

  for (const [stat, value] of Object.entries(grants)) {
    if (!stat) {
      issues.push(issue("error", path, `${label} names are required.`));
    }
    if (!Number.isFinite(Number(value))) {
      issues.push(issue("error", `${path}.${stat}`, `${label} values must be numeric.`));
    }
  }

  return issues;
}

export function validateLevels(levelFile, tiles, { rows = DEFAULT_ROWS, cols = DEFAULT_COLS } = {}) {
  const issues = [];
  const levels = levelFile?.levels;

  if (!levels || typeof levels !== "object") {
    return [issue("error", "levels", "levels must be an object.")];
  }

  for (const [id, level] of Object.entries(levels)) {
    if (!level || typeof level !== "object") {
      issues.push(issue("error", `levels.${id}`, "Level must be an object."));
      continue;
    }
    if (level.id && level.id !== id) {
      issues.push(issue("warning", `levels.${id}.id`, "Level id does not match its object key."));
    }
    if (typeof level.map !== "string" || !level.map.trim()) {
      issues.push(issue("error", `levels.${id}.map`, "Level map is required."));
      continue;
    }
    issues.push(...validateMap(level.map, tiles, { rows, cols }, `levels.${id}.map`));
  }

  return issues;
}

export function validateAchievements(achievementFile) {
  const issues = [];
  const achievements = achievementFile?.achievements;

  if (!Array.isArray(achievements)) {
    return [issue("error", "achievements", "achievements must be an array.")];
  }

  const seen = new Set();
  for (const [index, achievement] of achievements.entries()) {
    const path = `achievements[${index}]`;
    if (!achievement?.id) {
      issues.push(issue("error", `${path}.id`, "Achievement id is required."));
    } else if (seen.has(achievement.id)) {
      issues.push(issue("error", `${path}.id`, "Achievement id must be unique."));
    } else {
      seen.add(achievement.id);
    }

    if (!achievement?.title) {
      issues.push(issue("error", `${path}.title`, "Achievement title is required."));
    }

    const condition = achievement?.when;
    if (!condition || typeof condition !== "object") {
      issues.push(issue("error", `${path}.when`, "Achievement condition is required."));
      continue;
    }

    if (!condition.stat) {
      issues.push(issue("error", `${path}.when.stat`, "Achievement condition stat is required."));
    }

    if (
      condition.atLeast == null &&
      condition.lessThan == null &&
      condition.equals == null
    ) {
      issues.push(issue("error", `${path}.when`, "Achievement condition needs atLeast, lessThan, or equals."));
    }

    if (achievement.grantStats != null) {
      issues.push(...validateStatGrants(achievement.grantStats, `${path}.grantStats`, "Achievement stat grants"));
    }
  }

  return issues;
}

export function validateMap(encoded, tiles, { rows = DEFAULT_ROWS, cols = DEFAULT_COLS } = {}, path = "map") {
  const issues = [];
  const decoded = decodeMap(encoded, { rows, cols });

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tile = decoded.tiles[y][x];
      const variant = decoded.variants[y][x];
      const def = tiles?.[tile];

      if (!def) {
        const severity = /^[a-z]$/.test(tile) ? "warning" : "error";
        issues.push(issue(severity, `${path}[${y}][${x}]`, `Unknown tile '${tile}'.`));
        continue;
      }

      if (variant && !variantExists(def, variant)) {
        issues.push(issue("warning", `${path}[${y}][${x}]`, `Variant '${variant}' is not defined for tile '${tile}'.`));
      }
    }
  }

  return issues;
}

function variantExists(def, variant) {
  return VARIANT_BUCKETS.some(bucket => def[bucket] && def[bucket][variant]);
}

function issue(severity, path, message) {
  return { severity, path, message };
}
