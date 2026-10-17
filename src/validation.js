import { decodeMap, DEFAULT_COLS, DEFAULT_ROWS } from "./shared/mapCodec.js";
import { sanitizeVariant, VARIANT_BUCKETS } from "./shared/variants.js";
import { normalizeRollLimit } from "./rollLimit.js";
import { resolveExitDestination } from "./levelRouting.js";
import { validateNumericTileRegistry } from "./numericTileRegistry.js";
import { NUMERIC_MAP_FORMAT, validateNumericMap } from "./numericMapCodec.js";
import { TILE_PROPERTY_DEFINITIONS } from "./tileProperties.js";
import { validateEncounterRules as validateEncounterRuleData } from "./encounterRules.js";

export function validateTiles(tiles) {
  if (tiles?.format === "runner.numeric-tile-registry") {
    const issues = [...validateNumericTileRegistry(tiles)];
    for (const [index, tile] of (Array.isArray(tiles.tiles) ? tiles.tiles : []).entries()) {
      const path = `tiles[${index}].definition`;
      if (!isPlainObject(tile?.definition)) continue;
      issues.push(...validateTileProperties(tile.definition, path));
      for (const bucket of VARIANT_BUCKETS) {
        const group = tile.definition[bucket] || tile.definition.variants?.[bucket];
        if (!group || (bucket === "exit" && typeof group === "boolean")) continue;
        if (!isPlainObject(group)) {
          issues.push(issue("error", `${path}.${bucket}`, "Variant bucket must be an object."));
          continue;
        }
        for (const [key, entry] of Object.entries(group)) {
          if (sanitizeVariant(key) !== key) issues.push(issue("error", `${path}.${bucket}.${key}`, "Variant key is not sanitized."));
          if (!isPlainObject(entry)) {
            issues.push(issue("error", `${path}.${bucket}.${key}`, "Variant definition must be an object."));
            continue;
          }
          const variantPath = `${path}.${bucket}.${key}`;
          issues.push(...validateTileProperties(entry, variantPath));
          if (bucket === "lock") issues.push(...validateDiceRule(entry, variantPath, true));
          if (bucket === "monster") issues.push(...validateMonster(entry, variantPath));
        }
      }
    }
    return issues;
  }
  const issues = [];

  if (!isPlainObject(tiles)) {
    return [{ severity: "error", path: "tiles", message: "Tile definitions must be an object." }];
  }

  for (const [code, def] of Object.entries(tiles)) {
    if (!/^[A-Za-z.]$/.test(code)) {
      issues.push(issue("error", `tiles.${code}`, "Tile code must be one letter or '.'."));
    }
    if (!isPlainObject(def)) {
      issues.push(issue("error", `tiles.${code}`, "Tile definition must be an object."));
      continue;
    }
    issues.push(...validateTileProperties(def, `tiles.${code}`));
    for (const bucket of VARIANT_BUCKETS) {
      const group = def[bucket];
      if (!group) continue;
      if (bucket === "exit" && typeof group === "boolean") continue;
      if (!isPlainObject(group)) {
        issues.push(issue("error", `tiles.${code}.${bucket}`, "Variant bucket must be an object."));
        continue;
      }
      for (const [key, entry] of Object.entries(group)) {
        if (sanitizeVariant(key) !== key) {
          issues.push(issue("error", `tiles.${code}.${bucket}.${key}`, "Variant key is not sanitized."));
        }
        if (!isPlainObject(entry)) {
          issues.push(issue("error", `tiles.${code}.${bucket}.${key}`, "Variant definition must be an object."));
          continue;
        }
        issues.push(...validateTileProperties(entry, `tiles.${code}.${bucket}.${key}`));
        if (bucket === "lock") issues.push(...validateDiceRule(entry, `tiles.${code}.${bucket}.${key}`, true));
        if (bucket === "monster") issues.push(...validateMonster(entry, `tiles.${code}.${bucket}.${key}`));
      }
    }
  }

  return issues;
}

function validateTileProperties(def, path) {
  const issues = [];
  if (def.encounterRules != null) {
    try {
      for (const encounterIssue of validateEncounterRuleData(def.encounterRules, `${path}.encounterRules`)) {
        issues.push(issue("error", encounterIssue.path, encounterIssue.message));
      }
    } catch {
      issues.push(issue("error", `${path}.encounterRules`, "Malformed encounter structure; original JSON is preserved."));
    }
  }
  for (const [field, metadata] of Object.entries(TILE_PROPERTY_DEFINITIONS)) {
    const value = def[field];
    if (value == null) continue;
    const fieldPath = `${path}.${field}`;
    if (metadata.type === "boolean" && typeof value !== "boolean") {
      issues.push(issue("error", fieldPath, `${field} must be boolean.`));
    } else if (metadata.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      issues.push(issue("error", fieldPath, `${field} must be numeric.`));
    } else if (metadata.type === "enum" && !metadata.choices.includes(value)) {
      issues.push(issue("error", fieldPath, `${field} must be one of: ${metadata.choices.join(", ")}.`));
    } else if (metadata.type === "text" && typeof value !== "string") {
      issues.push(issue("error", fieldPath, `${field} must be a string.`));
    } else if (metadata.type === "multiline" && typeof value !== "string" && !isPlainObject(value)) {
      issues.push(issue("error", fieldPath, `${field} must be text or a variant-to-text object.`));
    } else if (metadata.type === "svg" && typeof value !== "string") {
      issues.push(issue("error", fieldPath, `${field} must be a string.`));
    } else if (metadata.type === "object" && !isPlainObject(value)) {
      issues.push(issue("error", fieldPath, `${field} must be an object.`));
    } else if (metadata.type === "array" && !Array.isArray(value)) {
      issues.push(issue("error", fieldPath, `${field} must be an array.`));
    }
  }
  const booleanFields = ["fog", "exit", "air", "playerArt"];

  for (const field of booleanFields) {
    if (def[field] != null && typeof def[field] !== "boolean" && !(field === "exit" && isPlainObject(def[field]))) {
      issues.push(issue("error", `${path}.${field}`, `${field} must be boolean.`));
    }
  }
  for (const field of ["insideDamage", "topDamage"]) {
    const damage = def[field];
    if (damage == null) continue;
    if (!isPlainObject(damage)) continue;
    if (damage.amount != null && (typeof damage.amount !== "number" || !Number.isFinite(damage.amount))) {
      issues.push(issue("error", `${path}.${field}.amount`, "Damage amount must be numeric."));
    }
    if (damage.when != null && typeof damage.when !== "string") {
      issues.push(issue("error", `${path}.${field}.when`, "Damage timing must be a string."));
    }
  }
  for (const field of ["hint", "signMessage", "signHtml"]) {
    if (typeof def[field] === "string" || def[field] == null || !isPlainObject(def[field])) continue;
    if (Object.values(def[field]).some(value => typeof value !== "string")) {
      issues.push(issue("error", `${path}.${field}`, `${field} must be text or a variant-to-text object.`));
    } else {
      for (const key of Object.keys(def[field])) {
        if (sanitizeVariant(key) !== key) issues.push(issue("error", `${path}.${field}.${key}`, "Variant key is not sanitized."));
      }
    }
  }
  for (const field of ["name", "messageFail", "messageHit"]) {
    if (def[field] != null && typeof def[field] !== "string") {
      issues.push(issue("error", `${path}.${field}`, `${field} must be a string.`));
    }
  }
  if (def.tags != null) {
    if (!Array.isArray(def.tags)) {
      issues.push(issue("error", `${path}.tags`, "tags must be an array."));
    } else {
      for (const [index, tag] of def.tags.entries()) {
        if (typeof tag !== "string" || sanitizeVariant(tag) !== tag) {
          issues.push(issue("error", `${path}.tags[${index}]`, "Tile tags must be sanitized strings."));
        }
      }
    }
  }
  if (Array.isArray(def.effects)) issues.push(...validateEffects(def.effects, `${path}.effects`));
  if (isPlainObject(def.grantStats)) issues.push(...validateStatGrants(def.grantStats, `${path}.grantStats`, "Tile stat grants"));
  return issues;
}

function validateDiceRule(rule, path, allowNoRule = false) {
  if (allowNoRule && rule.dice == null) return [];
  if (rule.dice !== 1 && rule.dice !== 2) {
    return [issue("error", `${path}.dice`, "Dice rule must use one or two dice.")];
  }

  const issues = [];
  for (const field of ["value", "sum", "damage"]) {
    if (rule[field] != null && !Number.isFinite(Number(rule[field]))) {
      issues.push(issue("error", `${path}.${field}`, `${field} must be numeric.`));
    }
  }
  if (rule.parity != null && !["even", "odd"].includes(rule.parity)) {
    issues.push(issue("error", `${path}.parity`, "parity must be 'even' or 'odd'."));
  }
  if (rule.exact != null && (!Array.isArray(rule.exact) || rule.exact.some(value => !Number.isFinite(Number(value))))) {
    issues.push(issue("error", `${path}.exact`, "exact must be an array of numeric dice values."));
  } else if (rule.exact != null && rule.dice === 2 && rule.exact.length !== 2) {
    issues.push(issue("error", `${path}.exact`, "A two-dice exact rule must contain two values."));
  }
  return issues;
}

function validateMonster(monster, path) {
  const issues = [];
  if (monster.hp != null && (!Number.isFinite(Number(monster.hp)) || Number(monster.hp) < 0)) {
    issues.push(issue("error", `${path}.hp`, "Monster hp must be a non-negative number."));
  }
  for (const field of ["playerHit", "monsterHit"]) {
    if (monster[field] == null) continue;
    if (!isPlainObject(monster[field])) {
      issues.push(issue("error", `${path}.${field}`, `${field} must be an object.`));
    } else {
      issues.push(...validateDiceRule(monster[field], `${path}.${field}`));
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
    if (effect.amount != null && (typeof effect.amount !== "number" || !Number.isFinite(effect.amount))) {
      issues.push(issue("error", `${effectPath}.amount`, "Effect amount must be numeric."));
    }
    if (effect.html != null && typeof effect.html !== "boolean") {
      issues.push(issue("error", `${effectPath}.html`, "Effect html must be boolean."));
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
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(issue("error", `${path}.${stat}`, `${label} values must be numeric.`));
    }
  }

  return issues;
}

export function validateLevels(levelFile, tiles, { rows = DEFAULT_ROWS, cols = DEFAULT_COLS, numericTiles = null } = {}) {
  const issues = [];
  const levels = levelFile?.levels;

  if (!levels || typeof levels !== "object") {
    return [issue("error", "levels", "levels must be an object.")];
  }
  if (levelFile.defaultLevel != null && !levels[levelFile.defaultLevel]) {
    issues.push(issue("error", "defaultLevel", "defaultLevel must name an existing level."));
  }

  for (const [id, level] of Object.entries(levels)) {
    if (!level || typeof level !== "object") {
      issues.push(issue("error", `levels.${id}`, "Level must be an object."));
      continue;
    }
    if (level.id && level.id !== id) {
      issues.push(issue("warning", `levels.${id}.id`, "Level id does not match its object key."));
    }
    if (level.exits != null) {
      if (!level.exits || typeof level.exits !== "object" || Array.isArray(level.exits)) {
        issues.push(issue("error", `levels.${id}.exits`, "exits must be an object mapping variants to level ids."));
      } else {
        for (const [variant, destination] of Object.entries(level.exits)) {
          if (typeof destination !== "string" || !levels[destination]) {
            issues.push(issue("error", `levels.${id}.exits.${variant}`, "Exit destination must name an existing level."));
          }
        }
      }
    }
    if (level.rollLimit != null) {
      if (normalizeRollLimit(level.rollLimit) === null) {
        issues.push(issue("error", `levels.${id}.rollLimit`, "rollLimit must be a positive integer."));
      }
    }
    if (typeof level.map !== "string" && !isNumericMap(level.map)) {
      issues.push(issue("error", `levels.${id}.map`, "Level map must be a legacy string or a versioned numeric map."));
      continue;
    }
    if (typeof level.map === "string" && !level.map.trim()) {
      issues.push(issue("error", `levels.${id}.map`, "Level map is required."));
      continue;
    }
    const mapTiles = isNumericMap(level.map) ? numericTiles || tiles : tiles;
    issues.push(...validateMap(level.map, mapTiles, { rows, cols }, `levels.${id}.map`));
  }

  return issues;
}

export function validateNarrative(narrativeFile) {
  const events = narrativeFile?.events;
  if (!Array.isArray(events)) return [issue("error", "events", "events must be an array.")];

  const issues = [];
  const seen = new Set();
  const triggerFields = ["type", "level", "tile", "variant", "pickupType", "storyFlag"];
  const actionTypes = new Set(["message", "xp", "achievement", "story_flag"]);

  for (const [index, event] of events.entries()) {
    const path = `events[${index}]`;
    if (!isPlainObject(event)) {
      issues.push(issue("error", path, "Event must be an object."));
      continue;
    }
    if (typeof event.id !== "string" || !event.id.trim()) {
      issues.push(issue("error", `${path}.id`, "Event id is required."));
    } else if (seen.has(event.id)) {
      issues.push(issue("error", `${path}.id`, "Event id must be unique."));
    } else {
      seen.add(event.id);
    }
    if (event.once != null && typeof event.once !== "boolean") {
      issues.push(issue("error", `${path}.once`, "once must be boolean."));
    }
    if (!isPlainObject(event.trigger)) {
      issues.push(issue("error", `${path}.trigger`, "Event trigger must be an object."));
    } else {
      for (const field of triggerFields) {
        if (event.trigger[field] != null && typeof event.trigger[field] !== "string") {
          issues.push(issue("error", `${path}.trigger.${field}`, `${field} must be a string.`));
        }
      }
      if (event.trigger.tileId != null && (!Number.isSafeInteger(event.trigger.tileId) || event.trigger.tileId < 1)) {
        issues.push(issue("error", `${path}.trigger.tileId`, "tileId must be a positive safe integer."));
      }
      if (event.trigger.value != null && !["string", "number", "boolean"].includes(typeof event.trigger.value)) {
        issues.push(issue("error", `${path}.trigger.value`, "Trigger value must be a JSON scalar."));
      }
    }
    if (!Array.isArray(event.actions)) {
      issues.push(issue("error", `${path}.actions`, "Event actions must be an array."));
      continue;
    }
    for (const [actionIndex, action] of event.actions.entries()) {
      const actionPath = `${path}.actions[${actionIndex}]`;
      if (!isPlainObject(action)) {
        issues.push(issue("error", actionPath, "Event action must be an object."));
        continue;
      }
      if (!actionTypes.has(action.type)) {
        issues.push(issue("error", `${actionPath}.type`, "Event action type is not supported."));
      } else if (action.type === "message") {
        if (typeof action.text !== "string" || !action.text) issues.push(issue("error", `${actionPath}.text`, "Message action text is required."));
        if (action.html != null && typeof action.html !== "boolean") issues.push(issue("error", `${actionPath}.html`, "html must be boolean."));
      } else if (action.type === "xp") {
        if (action.amount != null && !Number.isFinite(Number(action.amount))) issues.push(issue("error", `${actionPath}.amount`, "XP amount must be numeric."));
      } else if (action.type === "achievement") {
        if (typeof action.id !== "string" || !action.id) issues.push(issue("error", `${actionPath}.id`, "Achievement action id is required."));
      } else if (action.type === "story_flag") {
        if (typeof action.flag !== "string" || !action.flag) issues.push(issue("error", `${actionPath}.flag`, "Story flag action name is required."));
      }
    }
  }
  return issues;
}

export function validateContentDocuments({ levels, tiles, numericTiles = null, narrative, achievements } = {}, options = {}) {
  const issues = [];
  if (tiles) issues.push(...validateTiles(tiles));
  if (numericTiles) issues.push(...validateTiles(numericTiles));
  if (levels) issues.push(...validateLevels(levels, tiles, { ...options, numericTiles }));
  if (narrative) issues.push(...validateNarrative(narrative));
  if (achievements) issues.push(...validateAchievements(achievements));

  const levelsById = levels?.levels || {};
  const numericRegistry = numericTiles?.format === "runner.numeric-tile-registry"
    ? numericTiles
    : tiles?.format === "runner.numeric-tile-registry" ? tiles : null;
  const tileIds = {
    ...(tiles?.format === "runner.numeric-tile-registry" || !isPlainObject(tiles) ? {} : tiles),
    ...(numericRegistry ? Object.fromEntries((numericRegistry.tiles || []).filter(tile => tile?.legacyCode).map(tile => [tile.legacyCode, tile.definition])) : {})
  };
  const numericDefinitions = numericRegistry
    ? new Map((numericRegistry.tiles || []).map(tile => [tile.id, tile.definition]))
    : null;
  const numericTileIds = numericRegistry
    ? new Set((numericRegistry.tiles || []).map(tile => tile?.id))
    : null;
  const eventIds = new Set((narrative?.events || []).map(event => event?.id).filter(Boolean));
  const achievementIds = new Set((achievements?.achievements || []).map(item => item?.id).filter(Boolean));

  for (const [levelId, level] of Object.entries(levelsById)) {
    for (const [index, eventId] of (Array.isArray(level?.narrative) ? level.narrative : []).entries()) {
      if (typeof eventId !== "string" || !eventIds.has(eventId)) {
        issues.push(issue("error", `levels.${levelId}.narrative[${index}]`, `Narrative event '${eventId}' does not exist.`));
      }
    }
    const routedExits = new Set();
    if (typeof level?.map === "string") {
      const decoded = decodeMap(level.map, options);
      for (let y = 0; y < decoded.tiles.length; y++) {
        for (let x = 0; x < decoded.tiles[y].length; x++) {
          if (decoded.tiles[y][x] === "E") routedExits.add(decoded.variants[y][x] || "default");
        }
      }
    } else if (isNumericMap(level?.map) && numericDefinitions) {
      for (let y = 0; y < level.map.height; y++) {
        for (let x = 0; x < level.map.width; x++) {
          if (numericDefinitions.get(level.map.cells[y][x])?.exit === true) {
            routedExits.add(level.map.variants?.[y]?.[x] || "default");
          }
        }
      }
    }
    for (const exitVariant of routedExits) {
      if (resolveExitDestination(levels, levelId, exitVariant) == null) {
        issues.push(issue("warning", `levels.${levelId}.exits.${exitVariant}`, `Exit '${exitVariant}' has no destination.`));
      }
    }
  }

  for (const [index, event] of (narrative?.events || []).entries()) {
    const trigger = event?.trigger || {};
    if (trigger.level && !levelsById[trigger.level]) {
      issues.push(issue("error", `events[${index}].trigger.level`, `Level '${trigger.level}' does not exist.`));
    }
    if (trigger.tile && !tileIds[trigger.tile]) {
      issues.push(issue("error", `events[${index}].trigger.tile`, `Tile '${trigger.tile}' does not exist.`));
    }
    if (trigger.tile && trigger.variant && tileIds[trigger.tile] && !variantExists(tileIds[trigger.tile], trigger.variant)) {
      issues.push(issue("warning", `events[${index}].trigger.variant`, `Variant '${trigger.variant}' is not defined for tile '${trigger.tile}'.`));
    }
    if (trigger.tileId != null && numericDefinitions && !numericDefinitions.has(trigger.tileId)) {
      issues.push(issue("error", `events[${index}].trigger.tileId`, `Tile ID ${trigger.tileId} does not exist.`));
    }
    if (trigger.tileId != null && numericTileIds && !numericTileIds.has(trigger.tileId)) {
      issues.push(issue("error", `events[${index}].trigger.tileId`, `Tile ID ${trigger.tileId} does not exist.`));
    }
    for (const [actionIndex, action] of (event?.actions || []).entries()) {
      if (action?.type === "achievement" && achievements && !achievementIds.has(action.id)) {
        issues.push(issue("error", `events[${index}].actions[${actionIndex}].id`, `Achievement '${action.id}' does not exist.`));
      }
    }
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

    issues.push(...validateAchievementCondition(condition, `${path}.when`));

    if (achievement.grantStats != null) {
      issues.push(...validateStatGrants(achievement.grantStats, `${path}.grantStats`, "Achievement stat grants"));
    }
  }

  return issues;
}

function validateAchievementCondition(condition, path) {
  const issues = [];

  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    return [issue("error", path, "Achievement condition is required.")];
  }

  if (condition.all != null) {
    if (!Array.isArray(condition.all) || condition.all.length === 0) {
      issues.push(issue("error", `${path}.all`, "Achievement all condition must contain at least one condition."));
    } else {
      for (const [index, item] of condition.all.entries()) {
        issues.push(...validateAchievementCondition(item, `${path}.all[${index}]`));
      }
    }
    return issues;
  }

  if (condition.any != null) {
    if (!Array.isArray(condition.any) || condition.any.length === 0) {
      issues.push(issue("error", `${path}.any`, "Achievement any condition must contain at least one condition."));
    } else {
      for (const [index, item] of condition.any.entries()) {
        issues.push(...validateAchievementCondition(item, `${path}.any[${index}]`));
      }
    }
    return issues;
  }

  const isComparison = condition.left != null || condition.operator != null || condition.right != null;

  if (isComparison) {
    if (condition.left == null) {
      issues.push(issue("error", `${path}.left`, "Achievement comparison left value is required."));
    }
    if (!condition.operator) {
      issues.push(issue("error", `${path}.operator`, "Achievement comparison operator is required."));
    } else if (!["lessThan", "atMost", "equals", "notEquals", "greaterThan", "atLeast"].includes(condition.operator)) {
      issues.push(issue("error", `${path}.operator`, "Achievement comparison operator is not supported."));
    }
    if (condition.right == null) {
      issues.push(issue("error", `${path}.right`, "Achievement comparison right value is required."));
    }
    return issues;
  }

  if (!condition.stat) {
    issues.push(issue("error", `${path}.stat`, "Achievement condition stat is required."));
  }

  if (
    condition.atLeast == null &&
    condition.lessThan == null &&
    condition.equals == null
  ) {
    issues.push(issue("error", path, "Achievement condition needs atLeast, lessThan, or equals."));
  }

  return issues;
}

export function validateMap(encoded, tiles, { rows = DEFAULT_ROWS, cols = DEFAULT_COLS } = {}, path = "map") {
  if (isNumericMap(encoded)) {
    const issues = validateNumericMap(encoded).map(item => ({ ...item, path: item.path === "map" ? path : `${path}.${item.path}` }));
    if (encoded.width !== cols || encoded.height !== rows) {
      issues.push(issue("error", path, `Numeric gameplay map must be ${cols}x${rows}.`));
    }
    const definitions = tiles?.format === "runner.numeric-tile-registry"
      ? new Map((tiles.tiles || []).map(tile => [tile.id, tile.definition]))
      : null;
    if (!definitions) {
      issues.push(issue("error", path, "Numeric maps require a numeric tile registry."));
      return issues;
    }
    for (let y = 0; y < encoded.height; y++) {
      for (let x = 0; x < encoded.width; x++) {
        const id = encoded.cells[y]?.[x];
        const definition = definitions.get(id);
        if (!definition) {
          issues.push(issue("error", `${path}.cells[${y}][${x}]`, `Tile ID ${id} does not exist.`));
          continue;
        }
        const variant = encoded.variants?.[y]?.[x];
        if (variant && !variantExists(definition, variant)) {
          issues.push(issue("warning", `${path}.variants[${y}][${x}]`, `Variant '${variant}' is not defined for tile ID ${id}.`));
        }
      }
    }
    if (encoded.spawn?.artTileId != null && !definitions.has(encoded.spawn.artTileId)) {
      issues.push(issue("error", `${path}.spawn.artTileId`, `Tile ID ${encoded.spawn.artTileId} does not exist.`));
    }
    for (const field of ["airTileId", "playerArtTileId"]) {
      const id = tiles[field];
      if (id != null && !definitions.has(id)) issues.push(issue("error", `tiles.${field}`, `Tile ID ${id} does not exist.`));
    }
    if (!encoded.spawn) issues.push(issue("error", `${path}.spawn`, "Numeric gameplay map requires explicit spawn coordinates."));
    return issues;
  }
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
  if (def?.exit === true) return true;
  return VARIANT_BUCKETS.some(bucket => {
    const group = def[bucket] || def.variants?.[bucket];
    return group && group[variant];
  });
}

function issue(severity, path, message) {
  return { severity, path, message };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumericMap(value) {
  return isPlainObject(value) && value.format === NUMERIC_MAP_FORMAT;
}
