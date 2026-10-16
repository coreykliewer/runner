export const TILE_REGISTRY_FORMAT = "runner.numeric-tile-registry";
export const TILE_REGISTRY_VERSION_V1 = 1;
export const TILE_REGISTRY_VERSION_V2 = 2;
export const NUMERIC_MAP_FORMAT = "runner.numeric-map";
export const NUMERIC_MAP_VERSION_V1 = 1;
export const NUMERIC_MAP_VERSION_V2 = 2;
export const LEVEL_SET_VERSION_V1 = 1;
export const LEVEL_SET_VERSION_V2 = 2;
export const DICE_EVENT_BATCH_FORMAT = "runner.dice-event-batch";
export const DICE_EVENT_BATCH_VERSION = 1;

export const TILE_CATEGORIES_V2 = [
  "Environment",
  "Items",
  "Creatures",
  "Mechanisms",
  "Hazards",
  "Interactables",
  "Effects"
];

const RULE_CONDITIONS = new Set([
  "dice_sum",
  "dice_value",
  "inventory_quantity",
  "item_used",
  "state_equals"
]);
const RULE_ACTIONS = new Set([
  "damage",
  "modify_die",
  "consume_item",
  "grant_item",
  "grant_reward",
  "transition_state"
]);
const SPATIAL_RELATIONS = new Set([
  "distance",
  "inside",
  "above",
  "on_top",
  "below",
  "beside",
  "contact"
]);
const DISTANCE_METRICS = new Set(["manhattan", "chebyshev"]);
const LEGACY_CATEGORY_MAP = {
  Environmental: "Environment",
  Item: "Items",
  Interactive: "Interactables"
};

export function validateTileRegistryV2(registry) {
  const issues = [];
  const add = (path, message) => issues.push({ severity: "error", path, message });
  if (!isPlainObject(registry)) return [error("", "Registry must be an object.")];
  if (registry.format !== TILE_REGISTRY_FORMAT) add("format", `format must be '${TILE_REGISTRY_FORMAT}'.`);
  if (registry.version !== TILE_REGISTRY_VERSION_V2) add("version", `version must be ${TILE_REGISTRY_VERSION_V2}.`);
  if (!Number.isSafeInteger(registry.nextTileId) || registry.nextTileId < 1) {
    add("nextTileId", "nextTileId must be a positive safe integer.");
  }
  if (!Array.isArray(registry.tiles)) {
    add("tiles", "tiles must be an array.");
    return issues;
  }

  const tilesById = new Map();
  let maximumId = 0;
  for (const [index, tile] of registry.tiles.entries()) {
    const path = `tiles[${index}]`;
    if (!isPlainObject(tile)) {
      add(path, "Tile must be an object.");
      continue;
    }
    if (!Number.isSafeInteger(tile.id) || tile.id < 1) {
      add(`${path}.id`, "Tile ID must be a positive safe integer.");
    } else {
      if (tilesById.has(tile.id)) add(`${path}.id`, `Tile ID ${tile.id} is duplicated.`);
      else tilesById.set(tile.id, tile);
      maximumId = Math.max(maximumId, tile.id);
    }
    if (typeof tile.name !== "string" || !tile.name.trim()) add(`${path}.name`, "Tile name is required.");
    if (tile.category != null && !TILE_CATEGORIES_V2.includes(tile.category)) {
      add(`${path}.category`, `category must be one of: ${TILE_CATEGORIES_V2.join(", ")}.`);
    }
    if (tile.artwork != null && (!isPlainObject(tile.artwork) || (tile.artwork.svg != null && typeof tile.artwork.svg !== "string"))) {
      add(`${path}.artwork`, "artwork must be an object with optional string svg.");
    }
    if (!isPlainObject(tile.capabilities)) {
      add(`${path}.capabilities`, "capabilities must be an object.");
      continue;
    }
    validateCapabilities(tile.capabilities, path, add);
  }

  if (Number.isSafeInteger(registry.nextTileId) && registry.nextTileId <= maximumId) {
    add("nextTileId", `nextTileId must exceed the maximum active or reserved ID (${maximumId}).`);
  }
  const reservedLegacyCodes = new Map();
  if (registry.legacyIdMapping != null && !isPlainObject(registry.legacyIdMapping)) {
    add("legacyIdMapping", "legacyIdMapping must be an object.");
  }
  if (isPlainObject(registry.legacyIdMapping)) {
    for (const [code, id] of Object.entries(registry.legacyIdMapping)) {
      if (!/^[A-Za-z.]$/.test(code)) add(`legacyIdMapping.${code}`, "Legacy code must be one ASCII letter or '.'.");
      if (!isTileId(id)) add(`legacyIdMapping.${code}`, "Mapped ID must be a positive safe integer.");
      else {
        if (reservedLegacyCodes.has(id)) add(`legacyIdMapping.${code}`, `Numeric ID ${id} is reserved more than once.`);
        reservedLegacyCodes.set(id, code);
        maximumId = Math.max(maximumId, id);
      }
    }
    if (Number.isSafeInteger(registry.nextTileId) && registry.nextTileId <= maximumId) {
      add("nextTileId", `nextTileId must exceed the maximum active or reserved ID (${maximumId}).`);
    }
  }
  validateDiceCapacities(registry.settings?.dice, "settings.dice", add, { requireBoth: true });

  for (const [index, tile] of registry.tiles.entries()) {
    if (!isPlainObject(tile) || !isTileId(tile.id)) continue;
    const reservedCode = reservedLegacyCodes.get(tile.id);
    if (reservedCode != null && tile.legacyCode !== reservedCode) {
      add(`tiles[${index}].id`, `Tile ID ${tile.id} is reserved for legacy code '${reservedCode}'.`);
    }
  }

  for (const field of ["airTileId", "playerArtTileId", "defeatedMonsterTileId"]) {
    if (registry[field] != null && (!Number.isSafeInteger(registry[field]) || !tilesById.has(registry[field]))) {
      add(field, `${field} must reference an active tile ID.`);
    }
  }
  validateCapabilityReferences(registry.tiles, tilesById, add);
  return issues;
}

export function validateNumericMapV2(map, registry = null, path = "map") {
  const issues = [];
  const add = (issuePath, message) => issues.push({ severity: "error", path: issuePath, message });
  if (!isPlainObject(map)) return [error(path, "Map must be an object.")];
  if (map.format !== NUMERIC_MAP_FORMAT) add(`${path}.format`, `format must be '${NUMERIC_MAP_FORMAT}'.`);
  if (map.version !== NUMERIC_MAP_VERSION_V2) add(`${path}.version`, `version must be ${NUMERIC_MAP_VERSION_V2}.`);
  validateDimensions(map, path, add);
  validateGrid(map.cells, map.width, map.height, `${path}.cells`, add, isTileId);
  validateGrid(map.variants, map.width, map.height, `${path}.variants`, add, isValidVariantOrNull);
  validateGrid(map.instanceIds, map.width, map.height, `${path}.instanceIds`, add, isUuidOrNull);
  validateSpawn(map.spawn, map.width, map.height, `${path}.spawn`, add);
  validatePlacementIds(map, registry, path, add);
  if (registry && Array.isArray(map.cells)) {
    const tilesById = new Map((Array.isArray(registry.tiles) ? registry.tiles : []).map(tile => [tile.id, tile]));
    for (const [y, row] of map.cells.entries()) {
      if (!Array.isArray(row)) continue;
      for (const [x, id] of row.entries()) {
        if (isTileId(id) && !tilesById.has(id)) add(`${path}.cells[${y}][${x}]`, `Tile ID ${id} does not exist in the registry.`);
      }
    }
    if (map.spawn?.artTileId != null && !tilesById.has(map.spawn.artTileId)) {
      add(`${path}.spawn.artTileId`, `Tile ID ${map.spawn.artTileId} does not exist in the registry.`);
    }
  }
  return issues;
}

export function validateLevelSetV2(levelSet, registry = null) {
  const issues = [];
  const add = (path, message) => issues.push({ severity: "error", path, message });
  if (!isPlainObject(levelSet)) return [error("", "Level set must be an object.")];
  if (levelSet.schemaVersion !== LEVEL_SET_VERSION_V2) add("schemaVersion", `schemaVersion must be ${LEVEL_SET_VERSION_V2}.`);
  if (!isPlainObject(levelSet.levels)) return [ ...issues, error("levels", "levels must be an object.") ];
  if (levelSet.defaultLevel != null && !Object.hasOwn(levelSet.levels, levelSet.defaultLevel)) {
    add("defaultLevel", "defaultLevel must name an existing level.");
  }

  for (const [levelKey, level] of Object.entries(levelSet.levels)) {
    const path = `levels.${levelKey}`;
    if (!isPlainObject(level)) {
      add(path, "Level must be an object.");
      continue;
    }
    validateDiceCapacities(level.diceCapacities, `${path}.diceCapacities`, add);
    issues.push(...validateNumericMapV2(level.map, registry, `${path}.map`));
    if (registry && isPlainObject(level.map)) validateLevelInstanceStateV2(level, registry, path, add);
    if (level.exits != null) {
      if (!isPlainObject(level.exits)) add(`${path}.exits`, "exits must be an object.");
      else for (const [exitKey, destination] of Object.entries(level.exits)) {
        if (typeof destination !== "string" || !Object.hasOwn(levelSet.levels, destination)) {
          add(`${path}.exits.${exitKey}`, "Exit destination must name an existing level.");
        }
      }
    }
  }
  return issues;
}

export function validatePlayerStateV2(playerState, registry) {
  const issues = [];
  const add = (path, message) => issues.push({ severity: "error", path, message });
  if (!isPlainObject(playerState)) return [error("playerState", "playerState must be an object.")];
  if (!isPlainObject(playerState.statistics)) add("playerState.statistics", "statistics must be an object separate from inventory.");
  else for (const [stat, value] of Object.entries(playerState.statistics)) {
    if (!stat || typeof value !== "number" || !Number.isFinite(value)) add(`playerState.statistics.${stat}`, "statistic values must be finite numbers.");
  }
  if (!isPlainObject(playerState.inventory)) return [...issues, error("playerState.inventory", "inventory must be an object.")];
  const stacks = playerState.inventory.stacks ?? [];
  const instances = playerState.inventory.instances ?? [];
  const equipment = playerState.inventory.equipment ?? [];
  if (!Array.isArray(stacks)) add("playerState.inventory.stacks", "stacks must be an array.");
  if (!Array.isArray(instances)) add("playerState.inventory.instances", "instances must be an array.");
  if (!Array.isArray(equipment)) add("playerState.inventory.equipment", "equipment must be an array.");
  const tiles = new Map((registry?.tiles || []).map(tile => [tile.id, tile]));
  const seenStackIds = new Set();
  for (const [index, stack] of (Array.isArray(stacks) ? stacks : []).entries()) {
    const path = `playerState.inventory.stacks[${index}]`;
    const item = tiles.get(stack?.itemId);
    if (!isPlainObject(stack) || !isTileId(stack.itemId) || !item?.capabilities?.item) add(`${path}.itemId`, "stack itemId must reference a catalog item definition.");
    else if (item.capabilities.item.stackable !== true) add(`${path}.itemId`, "stacked item definition must declare stackable: true.");
    if (!isPositiveInteger(stack?.quantity)) add(`${path}.quantity`, "quantity must be a positive safe integer.");
    if (seenStackIds.has(stack?.itemId)) add(`${path}.itemId`, "identical stack records must be combined by Item ID.");
    seenStackIds.add(stack?.itemId);
    rejectCopiedItemDefinition(stack, path, add);
  }
  const itemInstances = new Map();
  for (const [index, instance] of (Array.isArray(instances) ? instances : []).entries()) {
    const path = `playerState.inventory.instances[${index}]`;
    if (!isPlainObject(instance)) {
      add(path, "item instance must be an object.");
      continue;
    }
    if (typeof instance.instanceId !== "string" || !instance.instanceId.trim() || itemInstances.has(instance.instanceId)) add(`${path}.instanceId`, "item instanceId must be present and unique.");
    else itemInstances.set(instance.instanceId, instance);
    if (!isTileId(instance.itemId) || !tiles.get(instance.itemId)?.capabilities?.item) add(`${path}.itemId`, "itemId must reference a catalog item definition.");
    rejectCopiedItemDefinition(instance, path, add);
  }
  for (const [index, entry] of (Array.isArray(equipment) ? equipment : []).entries()) {
    const path = `playerState.inventory.equipment[${index}]`;
    if (!isPlainObject(entry) || typeof entry.slot !== "string" || !entry.slot.trim()) add(`${path}.slot`, "equipment slot is required.");
    if (typeof entry?.itemInstanceId !== "string" || !itemInstances.has(entry.itemInstanceId)) add(`${path}.itemInstanceId`, "equipment must reference an owned item instance.");
  }
  return issues;
}

export function resolveDiceCapacities(registry, level = {}) {
  const globalCapacities = registry?.settings?.dice;
  const levelCapacities = level?.diceCapacities || {};
  return {
    die1: levelCapacities.die1 ?? globalCapacities?.die1?.maximum,
    die2: levelCapacities.die2 ?? globalCapacities?.die2?.maximum
  };
}

export function resolveDistanceMetric(relation) {
  return relation?.metric ?? "manhattan";
}

export function validateDiceEventBatch(batch) {
  const issues = [];
  const add = (path, message) => issues.push(error(path, message));
  if (!isPlainObject(batch)) return [error("", "Dice event batch must be an object.")];
  if (batch.format !== DICE_EVENT_BATCH_FORMAT) add("format", `format must be '${DICE_EVENT_BATCH_FORMAT}'.`);
  if (batch.version !== DICE_EVENT_BATCH_VERSION) add("version", `version must be ${DICE_EVENT_BATCH_VERSION}.`);
  if (typeof batch.actionId !== "string" || !batch.actionId.trim()) add("actionId", "actionId is required.");
  if (batch.parentActionId != null && (typeof batch.parentActionId !== "string" || !batch.parentActionId.trim())) add("parentActionId", "parentActionId must be null or a non-empty string.");
  if (typeof batch.rollId !== "string" || !batch.rollId.trim()) add("rollId", "rollId is required.");
  if (!Array.isArray(batch.events) || batch.events.length === 0) return [...issues, error("events", "events must be a non-empty array.")];
  const eventIds = new Set();
  const sequences = new Set();
  let previousSequence = 0;
  for (const [index, event] of batch.events.entries()) {
    const path = `events[${index}]`;
    if (!isPlainObject(event)) {
      add(path, "event must be an object.");
      continue;
    }
    if (typeof event.eventId !== "string" || !event.eventId.trim() || eventIds.has(event.eventId)) add(`${path}.eventId`, "eventId must be non-empty and unique in the batch.");
    else eventIds.add(event.eventId);
    if (event.actionId !== batch.actionId) add(`${path}.actionId`, "event actionId must match its batch.");
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1 || sequences.has(event.sequence)) add(`${path}.sequence`, "sequence must be a unique positive safe integer.");
    else {
      if (event.sequence <= previousSequence) add(`${path}.sequence`, "events must be listed in ascending mutation sequence.");
      previousSequence = event.sequence;
      sequences.add(event.sequence);
    }
    if (!["die_changed", "die_rerolled"].includes(event.type)) add(`${path}.type`, "type must be die_changed or die_rerolled.");
    if (!["die1", "die2"].includes(event.die)) add(`${path}.die`, "die must be die1 or die2.");
    if (!isPlainObject(event.before) || !isPlainObject(event.after)) add(`${path}.snapshot`, "before and after dice snapshots must be objects.");
    else for (const field of ["die1", "die2"]) {
      if (!isNonNegativeInteger(event.before[field])) add(`${path}.before.${field}`, "snapshot die value must be a non-negative safe integer.");
      if (!isNonNegativeInteger(event.after[field])) add(`${path}.after.${field}`, "snapshot die value must be a non-negative safe integer.");
    }
    if (typeof event.valueChanged !== "boolean") add(`${path}.valueChanged`, "valueChanged must be boolean.");
    else if (isPlainObject(event.before) && isPlainObject(event.after)) {
      const changed = event.before[event.die] !== event.after[event.die];
      if (event.valueChanged !== changed) add(`${path}.valueChanged`, "valueChanged must match the changed die values; unchanged rerolls use false.");
      if (event.type === "die_changed" && !changed) add(`${path}.type`, "die_changed must represent an actual numeric change; same-value rerolls use die_rerolled.");
      if (event.type === "die_rerolled" && event.operation !== "reroll") add(`${path}.operation`, "die_rerolled operation must be reroll.");
    }
    if (typeof event.operation !== "string" || !event.operation.trim()) add(`${path}.operation`, "operation is required.");
    if (event.rollId !== batch.rollId) add(`${path}.rollId`, "event rollId must match its batch.");
    if (event.parentActionId !== batch.parentActionId) add(`${path}.parentActionId`, "event parentActionId must match its batch.");
    if (!isPlainObject(event.source) || typeof event.source.kind !== "string" || !event.source.kind) add(`${path}.source`, "source.kind is required.");
  }
  return issues;
}

export function decodeDiceEventBatch(batch) {
  const document = cloneJson(batch);
  throwIfInvalid(validateDiceEventBatch(document));
  return document;
}

export function encodeDiceEventBatch(batch) {
  return decodeDiceEventBatch(batch);
}

export function decodeRegistryDocument(value) {
  const document = cloneJson(value);
  const issues = validateRegistryDocument(document);
  throwIfInvalid(issues);
  return document;
}

export function encodeRegistryDocument(value) {
  return decodeRegistryDocument(value);
}

export function decodeMapDocument(value, registry = null) {
  const document = cloneJson(value);
  const issues = validateMapDocument(document, registry);
  throwIfInvalid(issues);
  return document;
}

export function encodeMapDocument(value, registry = null) {
  return decodeMapDocument(value, registry);
}

export function decodeLevelSetDocument(value, registry = null) {
  const document = cloneJson(value);
  const issues = validateLevelSetDocument(document, registry);
  throwIfInvalid(issues);
  return document;
}

export function encodeLevelSetDocument(value, registry = null) {
  return decodeLevelSetDocument(value, registry);
}

export function validateRegistryDocument(registry) {
  if (registry?.format !== TILE_REGISTRY_FORMAT) return [error("format", `format must be '${TILE_REGISTRY_FORMAT}'.`)];
  if (registry.version === TILE_REGISTRY_VERSION_V1) return validateRegistryV1(registry);
  if (registry.version === TILE_REGISTRY_VERSION_V2) return validateTileRegistryV2(registry);
  return [error("version", `Unsupported registry version '${registry.version}'.`)];
}

export function validateMapDocument(map, registry = null) {
  if (map?.format !== NUMERIC_MAP_FORMAT) return [error("format", `format must be '${NUMERIC_MAP_FORMAT}'.`)];
  if (map.version === NUMERIC_MAP_VERSION_V1) return validateNumericMapV1(map, registry);
  if (map.version === NUMERIC_MAP_VERSION_V2) return validateNumericMapV2(map, registry);
  return [error("version", `Unsupported map version '${map.version}'.`)];
}

export function validateLevelSetDocument(levelSet, registry = null) {
  if (levelSet?.schemaVersion === LEVEL_SET_VERSION_V1) return validateLevelSetV1(levelSet, registry);
  if (levelSet?.schemaVersion === LEVEL_SET_VERSION_V2) return validateLevelSetV2(levelSet, registry);
  return [error("schemaVersion", `Unsupported level-set schema version '${levelSet?.schemaVersion}'.`)];
}

function validateCapabilities(capabilities, path, add) {
  if (Object.hasOwn(capabilities, "detection")) {
    add(`${path}.capabilities.detection`, "Spatial range belongs only in rules[].trigger.relation.");
  }
  const traversal = capabilities.traversal;
  if (traversal != null && !isPlainObject(traversal)) add(`${path}.capabilities.traversal`, "traversal must be an object.");
  if (isPlainObject(traversal)) {
    const movement = traversal.movement;
    if (movement != null && !isPlainObject(movement)) add(`${path}.capabilities.traversal.movement`, "movement must be an object.");
    if (isPlainObject(movement)) {
      if (movement.blockedCost != null && !isNonNegativeInteger(movement.blockedCost)) add(`${path}.capabilities.traversal.movement.blockedCost`, "blockedCost must be a non-negative safe integer.");
      if (movement.entryCost != null) {
        if (!isPlainObject(movement.entryCost)) add(`${path}.capabilities.traversal.movement.entryCost`, "entryCost must be an object.");
        else for (const [key, value] of Object.entries(movement.entryCost)) {
          if (!isNonNegativeInteger(value)) add(`${path}.capabilities.traversal.movement.entryCost.${key}`, "Movement cost must be a non-negative safe integer.");
        }
      }
    }
    if (traversal.gravity != null) {
      if (!isPlainObject(traversal.gravity)) add(`${path}.capabilities.traversal.gravity`, "gravity must be an object.");
      else {
        if (typeof traversal.gravity.enabled !== "boolean") add(`${path}.capabilities.traversal.gravity.enabled`, "enabled must be boolean.");
        if (traversal.gravity.timeCost != null && !isNonNegativeInteger(traversal.gravity.timeCost)) add(`${path}.capabilities.traversal.gravity.timeCost`, "timeCost must be a non-negative safe integer.");
      }
    }
  }
  const interaction = capabilities.interaction;
  if (interaction != null) {
    if (!isPlainObject(interaction)) add(`${path}.capabilities.interaction`, "interaction must be an object.");
    else if (interaction.timeCost != null && !isNonNegativeInteger(interaction.timeCost)) add(`${path}.capabilities.interaction.timeCost`, "Interaction timeCost must be a non-negative safe integer independent of movement costs.");
  }
  if (capabilities.vitals != null) {
    if (!isPlainObject(capabilities.vitals)) add(`${path}.capabilities.vitals`, "vitals must be an object.");
    else {
      for (const key of ["maximumHealth", "defense"]) {
        const value = capabilities.vitals[key];
        if (value != null && (!Number.isFinite(value) || value < 0)) add(`${path}.capabilities.vitals.${key}`, `${key} must be a finite non-negative number.`);
      }
    }
  }
  if (capabilities.item != null) {
    if (!isPlainObject(capabilities.item)) add(`${path}.capabilities.item`, "item must be an object.");
    else {
      if (capabilities.item.stackable != null && typeof capabilities.item.stackable !== "boolean") add(`${path}.capabilities.item.stackable`, "stackable must be boolean.");
      if (capabilities.item.useTimeCost != null && !isNonNegativeInteger(capabilities.item.useTimeCost)) add(`${path}.capabilities.item.useTimeCost`, "useTimeCost must be a non-negative safe integer.");
      if (capabilities.item.onUse != null) validateActions(capabilities.item.onUse, `${path}.capabilities.item.onUse`, add);
    }
  }
  if (capabilities.states != null) validateStates(capabilities.states, `${path}.capabilities.states`, add);
  if (capabilities.rewards != null) validateRewards(capabilities.rewards, `${path}.capabilities.rewards`, add);
  if (capabilities.rules != null) validateRules(capabilities.rules, `${path}.capabilities.rules`, add);
}

function validateRules(rules, path, add) {
  if (!Array.isArray(rules)) return add(path, "rules must be an array.");
  const ids = new Set();
  const orders = new Set();
  for (const [index, rule] of rules.entries()) {
    const rulePath = `${path}[${index}]`;
    if (!isPlainObject(rule)) {
      add(rulePath, "Rule must be an object.");
      continue;
    }
    if (typeof rule.id !== "string" || !rule.id.trim() || ids.has(rule.id)) add(`${rulePath}.id`, "Rule id must be non-empty and unique within the rule list.");
    else ids.add(rule.id);
    if (!Number.isSafeInteger(rule.priority)) add(`${rulePath}.priority`, "priority must be a safe integer.");
    if (!Number.isSafeInteger(rule.authorOrder) || rule.authorOrder < 1 || orders.has(rule.authorOrder)) add(`${rulePath}.authorOrder`, "authorOrder must be a positive safe integer unique within the rule list.");
    else orders.add(rule.authorOrder);
    if (!isPlainObject(rule.trigger)) add(`${rulePath}.trigger`, "trigger must be an object.");
    else {
      if (!Array.isArray(rule.trigger.events) || rule.trigger.events.length === 0 || rule.trigger.events.some(event => typeof event !== "string" || !event)) add(`${rulePath}.trigger.events`, "events must be a non-empty array of event names.");
      if (rule.trigger.relation != null) validateRelation(rule.trigger.relation, `${rulePath}.trigger.relation`, add);
    }
    if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) add(`${rulePath}.conditions`, "conditions must be a non-empty array.");
    else for (const [conditionIndex, condition] of rule.conditions.entries()) validateCondition(condition, `${rulePath}.conditions[${conditionIndex}]`, add);
    validateActions(rule.actions, `${rulePath}.actions`, add);
    if (rule.activation?.scope != null && !["attacker_per_player_roll", "per_action", "per_event"].includes(rule.activation.scope)) add(`${rulePath}.activation.scope`, "Unsupported activation scope.");
  }
}

function validateRelation(relation, path, add) {
  if (!isPlainObject(relation) || !SPATIAL_RELATIONS.has(relation.kind)) {
    add(path, `relation kind must be one of: ${[...SPATIAL_RELATIONS].join(", ")}.`);
    return;
  }
  if (relation.kind === "distance") {
    if (!isNonNegativeInteger(relation.minimum)) add(`${path}.minimum`, "minimum must be a non-negative safe integer.");
    if (!isNonNegativeInteger(relation.maximum)) add(`${path}.maximum`, "maximum must be a non-negative safe integer.");
    if (isNonNegativeInteger(relation.minimum) && isNonNegativeInteger(relation.maximum) && relation.maximum < relation.minimum) add(`${path}.maximum`, "maximum must be greater than or equal to minimum.");
    if (relation.metric != null && !DISTANCE_METRICS.has(relation.metric)) add(`${path}.metric`, `metric must be one of: ${[...DISTANCE_METRICS].join(", ")}.`);
  }
}

function validateActions(actions, path, add) {
  if (!Array.isArray(actions) || actions.length === 0) return add(path, "actions must be a non-empty array.");
  for (const [index, action] of actions.entries()) {
    const actionPath = `${path}[${index}]`;
    if (!isPlainObject(action) || !RULE_ACTIONS.has(action.type)) {
      add(`${actionPath}.type`, "Unsupported rule action type.");
      continue;
    }
    if (action.type === "damage" && (!Number.isFinite(action.amount) || action.amount < 0)) add(`${actionPath}.amount`, "damage amount must be finite and non-negative.");
    if (action.type === "modify_die" && (!Number.isSafeInteger(action.amount) || !["add", "set", "reroll"].includes(action.operation))) add(actionPath, "modify_die requires a supported operation and safe-integer amount.");
    if (["consume_item", "grant_item"].includes(action.type)) {
      if (!isTileId(action.itemId)) add(`${actionPath}.itemId`, "itemId must be a positive safe integer.");
      if (!isPositiveInteger(action.quantity)) add(`${actionPath}.quantity`, "quantity must be a positive safe integer.");
    }
    if (action.type === "grant_reward" && (typeof action.rewardId !== "string" || !action.rewardId.trim())) add(`${actionPath}.rewardId`, "rewardId is required.");
    if (action.type === "transition_state" && (typeof action.to !== "string" || !action.to.trim())) add(`${actionPath}.to`, "transition target state is required.");
  }
}

function validateCondition(condition, path, add) {
  if (!isPlainObject(condition) || !RULE_CONDITIONS.has(condition.type)) {
    add(`${path}.type`, "Unsupported rule condition type.");
    return;
  }
  if (condition.type === "dice_sum") {
    if (!isComparisonOperator(condition.operator)) add(`${path}.operator`, "operator must be a supported comparison.");
    if (!Number.isFinite(condition.value)) add(`${path}.value`, "value must be finite.");
  } else if (condition.type === "dice_value") {
    if (!["die1", "die2"].includes(condition.die)) add(`${path}.die`, "die must be die1 or die2.");
    if (!isComparisonOperator(condition.operator)) add(`${path}.operator`, "operator must be a supported comparison.");
    if (!Number.isFinite(condition.value)) add(`${path}.value`, "value must be finite.");
  } else if (condition.type === "inventory_quantity") {
    if (!isTileId(condition.itemId)) add(`${path}.itemId`, "itemId must be a positive safe integer.");
    if (!isComparisonOperator(condition.operator)) add(`${path}.operator`, "operator must be a supported comparison.");
    if (!isNonNegativeInteger(condition.value)) add(`${path}.value`, "inventory quantity must be a non-negative safe integer.");
  } else if (condition.type === "item_used") {
    if (!isTileId(condition.itemId)) add(`${path}.itemId`, "itemId must be a positive safe integer.");
  } else if (condition.type === "state_equals") {
    if (typeof condition.target !== "string" || !condition.target) add(`${path}.target`, "target is required.");
    if (typeof condition.value !== "string" || !condition.value) add(`${path}.value`, "state value is required.");
  }
}

function isComparisonOperator(value) {
  return ["<", "<=", "==", "!=", ">=", ">", "lessThan", "lessThanOrEqual", "equals", "notEquals", "greaterThanOrEqual", "greaterThan"].includes(value);
}

function validateStates(states, path, add) {
  if (!isPlainObject(states)) return add(path, "states must be an object.");
  if (!isPlainObject(states.definitions)) add(`${path}.definitions`, "definitions must be an object.");
  else if (typeof states.initial !== "string" || !Object.hasOwn(states.definitions, states.initial)) add(`${path}.initial`, "initial must name a declared state.");
  if (states.transitions != null) {
    if (!Array.isArray(states.transitions)) add(`${path}.transitions`, "transitions must be an array.");
    else for (const [index, transition] of states.transitions.entries()) {
      if (!isPlainObject(transition) || !Object.hasOwn(states.definitions || {}, transition.from) || !Object.hasOwn(states.definitions || {}, transition.to)) add(`${path}.transitions[${index}]`, "transition from/to must reference declared states.");
    }
  }
}

function validateRewards(rewards, path, add) {
  if (!Array.isArray(rewards)) return add(path, "rewards must be an array.");
  const ids = new Set();
  for (const [index, reward] of rewards.entries()) {
    const rewardPath = `${path}[${index}]`;
    if (!isPlainObject(reward)) {
      add(rewardPath, "reward must be an object.");
      continue;
    }
    if (typeof reward.id !== "string" || !reward.id.trim() || ids.has(reward.id)) add(`${rewardPath}.id`, "reward id must be non-empty and unique within the capability.");
    else ids.add(reward.id);
    if (!isTileId(reward.itemId)) add(`${rewardPath}.itemId`, "itemId must be a positive safe integer.");
    if (!isPositiveInteger(reward.quantity)) add(`${rewardPath}.quantity`, "quantity must be a positive safe integer.");
  }
}

function validateCapabilityReferences(tiles, tilesById, add) {
  const itemIds = new Set(tiles.filter(tile => tile?.capabilities?.item).map(tile => tile.id));
  for (const [index, tile] of tiles.entries()) {
    if (!isPlainObject(tile?.capabilities)) continue;
    const path = `tiles[${index}].capabilities`;
    for (const [capabilityName, entries] of [["rewards", tile.capabilities.rewards], ["rules", tile.capabilities.rules], ["item", tile.capabilities.item]]) {
      const text = JSON.stringify(entries ?? null);
      const referencedIds = new Set([...text.matchAll(/"itemId"\s*:\s*(\d+)/g)].map(match => Number(match[1])));
      for (const id of referencedIds) {
        if (!tilesById.has(id)) add(`${path}.${capabilityName}`, `Item ID ${id} does not exist in the shared registry.`);
        else if (!itemIds.has(id)) add(`${path}.${capabilityName}`, `Referenced ID ${id} must have the item capability.`);
      }
    }
    const rewardDefinitions = Array.isArray(tile.capabilities.rewards) ? tile.capabilities.rewards : [];
    const rewardIds = new Set(rewardDefinitions.map(reward => reward?.id).filter(id => typeof id === "string"));
    const rules = Array.isArray(tile.capabilities.rules) ? tile.capabilities.rules : [];
    for (const [ruleIndex, rule] of rules.entries()) {
      for (const [actionIndex, action] of (rule?.actions || []).entries()) {
        if (action?.type === "grant_reward" && !rewardIds.has(action.rewardId)) {
          add(`${path}.rules[${ruleIndex}].actions[${actionIndex}].rewardId`, `Reward '${action.rewardId}' is not defined by this tile.`);
        }
      }
    }
  }
}

function validateDiceCapacities(capacities, path, add, { requireBoth = false } = {}) {
  if (capacities == null && !requireBoth) return;
  if (!isPlainObject(capacities)) return add(path, "dice capacities must be an object.");
  for (const die of ["die1", "die2"]) {
    const value = capacities[die];
    if (value == null && !requireBoth) continue;
    const maximum = isPlainObject(value) ? value.maximum : value;
    if (!isPositiveInteger(maximum)) add(`${path}.${die}${isPlainObject(value) ? ".maximum" : ""}`, "die capacity must be a positive safe integer.");
  }
}

function validateRegistryV1(registry) {
  const issues = [];
  const add = (path, message) => issues.push(error(path, message));
  if (!Array.isArray(registry.tiles)) return [error("tiles", "tiles must be an array.")];
  const ids = new Set();
  let maximum = 0;
  for (const [index, tile] of registry.tiles.entries()) {
    const path = `tiles[${index}]`;
    if (!isPlainObject(tile) || !isTileId(tile.id) || !isPlainObject(tile.definition)) {
      add(path, "v1 tile requires positive numeric id and object definition.");
      continue;
    }
    if (ids.has(tile.id)) add(`${path}.id`, `Tile ID ${tile.id} is duplicated.`);
    ids.add(tile.id);
    maximum = Math.max(maximum, tile.id);
  }
  if (!isPositiveInteger(registry.nextTileId) || registry.nextTileId <= maximum) add("nextTileId", "nextTileId must exceed active v1 tile IDs.");
  return issues;
}

function validateNumericMapV1(map, registry) {
  const issues = [];
  const add = (path, message) => issues.push(error(path, message));
  validateDimensions(map, "map", add);
  validateGrid(map.cells, map.width, map.height, "map.cells", add, isTileId);
  if (map.variants != null) validateGrid(map.variants, map.width, map.height, "map.variants", add, isValidVariantOrNull);
  if (map.spawn != null) validateSpawn(map.spawn, map.width, map.height, "map.spawn", add);
  if (registry && Array.isArray(map.cells)) {
    const ids = new Set((Array.isArray(registry.tiles) ? registry.tiles : []).map(tile => tile.id));
    for (const [y, row] of map.cells.entries()) for (const [x, id] of (Array.isArray(row) ? row : []).entries()) {
      if (isTileId(id) && !ids.has(id)) add(`map.cells[${y}][${x}]`, `Tile ID ${id} does not exist in the registry.`);
    }
  }
  return issues;
}

function validateLevelSetV1(levelSet, registry) {
  const issues = [];
  const add = (path, message) => issues.push(error(path, message));
  if (!isPlainObject(levelSet.levels)) return [error("levels", "levels must be an object.")];
  if (levelSet.defaultLevel != null && !Object.hasOwn(levelSet.levels, levelSet.defaultLevel)) add("defaultLevel", "defaultLevel must name an existing level.");
  for (const [key, level] of Object.entries(levelSet.levels)) {
    if (!isPlainObject(level)) {
      add(`levels.${key}`, "level must be an object.");
      continue;
    }
    if (level.exits != null && isPlainObject(level.exits)) {
      for (const [exitKey, destination] of Object.entries(level.exits)) {
        if (typeof destination !== "string" || !Object.hasOwn(levelSet.levels, destination)) add(`levels.${key}.exits.${exitKey}`, "Exit destination must name an existing level.");
      }
    }
    if (typeof level.map === "string") continue;
    issues.push(...validateMapDocument(level.map, registry).map(item => ({ ...item, path: `levels.${key}.${item.path}` })));
  }
  return issues;
}

function validateDimensions(map, path, add) {
  if (!isPositiveInteger(map.width)) add(`${path}.width`, "width must be a positive safe integer.");
  if (!isPositiveInteger(map.height)) add(`${path}.height`, "height must be a positive safe integer.");
}

function validateGrid(grid, width, height, path, add, predicate) {
  if (!Array.isArray(grid)) return add(path, "grid must be a two-dimensional array.");
  if (isPositiveInteger(height) && grid.length !== height) add(path, "row count must match height.");
  for (const [y, row] of grid.entries()) {
    if (!Array.isArray(row)) {
      add(`${path}[${y}]`, "row must be an array.");
      continue;
    }
    if (isPositiveInteger(width) && row.length !== width) add(`${path}[${y}]`, "column count must match width.");
    for (const [x, value] of row.entries()) if (!predicate(value)) add(`${path}[${y}][${x}]`, "cell has an invalid value.");
  }
}

function validateSpawn(spawn, width, height, path, add) {
  if (!isPlainObject(spawn)) return add(path, "spawn must be an object.");
  if (!Number.isSafeInteger(spawn.x) || spawn.x < 0 || spawn.x >= width) add(`${path}.x`, "spawn x must be within map bounds.");
  if (!Number.isSafeInteger(spawn.y) || spawn.y < 0 || spawn.y >= height) add(`${path}.y`, "spawn y must be within map bounds.");
  if (spawn.artTileId != null && !isTileId(spawn.artTileId)) add(`${path}.artTileId`, "artTileId must be a positive safe integer.");
}

function validatePlacementIds(map, registry, path, add) {
  if (!Array.isArray(map.cells) || !Array.isArray(map.instanceIds) || !registry) return;
  const tilesById = new Map((Array.isArray(registry.tiles) ? registry.tiles : []).map(tile => [tile.id, tile]));
  const seen = new Set();
  for (const [y, row] of map.cells.entries()) {
    if (!Array.isArray(row)) continue;
    for (const [x, tileId] of row.entries()) {
      const instanceId = map.instanceIds[y]?.[x];
      const tile = tilesById.get(tileId);
      if (requiresInstanceId(tile) && !isUuid(instanceId)) add(`${path}.instanceIds[${y}][${x}]`, "stateful or reward-capable placement requires a UUID.");
      if (instanceId == null) continue;
      if (!isUuid(instanceId)) continue;
      if (seen.has(instanceId)) add(`${path}.instanceIds[${y}][${x}]`, `Placement UUID '${instanceId}' is duplicated in this level.`);
      seen.add(instanceId);
    }
  }
}

function validateLevelInstanceStateV2(level, registry, path, add) {
  const idGrid = Array.isArray(level.map.instanceIds) ? level.map.instanceIds : [];
  const instanceIds = new Set(idGrid.flatMap(row => Array.isArray(row) ? row : []).filter(isUuid));
  if (level.instanceState != null) {
    if (!isPlainObject(level.instanceState)) add(`${path}.instanceState`, "instanceState must be an object keyed by placement UUID.");
    else for (const [instanceId, state] of Object.entries(level.instanceState)) {
      if (!instanceIds.has(instanceId)) add(`${path}.instanceState.${instanceId}`, "instance state refers to a placement absent from this level map.");
      if (!isPlainObject(state)) add(`${path}.instanceState.${instanceId}`, "instance state must be an object.");
    }
  }
  if (level.rewardClaims != null) {
    if (!Array.isArray(level.rewardClaims)) return add(`${path}.rewardClaims`, "rewardClaims must be an array.");
    const tileByInstance = new Map();
    const cells = Array.isArray(level.map.cells) ? level.map.cells : [];
    for (let y = 0; y < cells.length; y++) for (let x = 0; x < (Array.isArray(cells[y]) ? cells[y] : []).length; x++) {
      const instanceId = level.map.instanceIds?.[y]?.[x];
      if (isUuid(instanceId)) tileByInstance.set(instanceId, (Array.isArray(registry.tiles) ? registry.tiles : []).find(tile => tile.id === cells[y][x]));
    }
    const seenClaims = new Set();
    for (const [index, claim] of level.rewardClaims.entries()) {
      const claimPath = `${path}.rewardClaims[${index}]`;
      if (!isPlainObject(claim) || !instanceIds.has(claim.instanceId)) {
        add(`${claimPath}.instanceId`, "reward claim must refer to a placed instance in this level.");
        continue;
      }
      const key = `${claim.instanceId}|${claim.rewardId}`;
      if (seenClaims.has(key)) add(claimPath, "duplicate reward claim.");
      seenClaims.add(key);
      const source = tileByInstance.get(claim.instanceId);
      const rewardIds = source?.capabilities?.rewards?.map(reward => reward.id) || [];
      if (typeof claim.rewardId !== "string" || !rewardIds.includes(claim.rewardId)) add(`${claimPath}.rewardId`, "rewardId must be defined by the placed source tile.");
    }
  }
}

function rejectCopiedItemDefinition(record, path, add) {
  if (!isPlainObject(record)) return;
  for (const property of ["name", "definition", "capabilities", "behavior"]) {
    if (Object.hasOwn(record, property)) add(`${path}.${property}`, "inventory records reference catalog Item IDs and must not duplicate item definitions.");
  }
}

function requiresInstanceId(tile) {
  const capabilities = tile?.capabilities || {};
  return Boolean(capabilities.states || capabilities.vitals || capabilities.rewards?.length || capabilities.item ||
    capabilities.rules?.some(rule => rule.activation?.scope === "attacker_per_player_roll"));
}

function isUuidOrNull(value) { return value == null || isUuid(value); }
function isUuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
function isValidVariantOrNull(value) { return value == null || (typeof value === "string" && /^[a-z0-9_-]{1,12}$/.test(value)); }
function isTileId(value) { return Number.isSafeInteger(value) && value > 0; }
function isPositiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function isNonNegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function error(path, message) { return { severity: "error", path, message }; }
function throwIfInvalid(issues) {
  if (issues.length === 0) return;
  const thrown = new Error(issues.map(item => `${item.path}: ${item.message}`).join("; "));
  thrown.issues = issues;
  throw thrown;
}
function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }