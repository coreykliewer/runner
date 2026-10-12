const ACTIVE = "active";
const COMPATIBILITY = "compatibility";
const UNCONFIRMED = "unconfirmed";

export const TILE_PROPERTY_CATEGORIES = [
  { id: "physics", label: "Collision and Physics" },
  { id: "movement", label: "Movement" },
  { id: "hazards", label: "Damage and Hazards" },
  { id: "rewards", label: "Pickups and Rewards" },
  { id: "text", label: "Text and Messaging" },
  { id: "artwork", label: "Artwork" },
  { id: "advanced", label: "Advanced and Compatibility" }
];

export const TILE_EDITOR_CATEGORIES = ["Environmental", "Item", "Interactive"];

export const TILE_CAPABILITY_GROUPS = [
  { id: "collision", label: "Collision", properties: ["solid", "fallDamageCancel"] },
  { id: "movement", label: "Movement", properties: ["moveCost", "moveCostTop", "moveCostInside", "insideMoveCost"] },
  { id: "physics", label: "Physics", properties: ["gravity", "bounce", "slope", "fallDamageThreshold", "fallDamageMultiplier", "jumpAllowed", "sinkSpeed", "riseSpeed", "autoPush"] },
  { id: "hazards", label: "Damage and Hazards", properties: ["insideDamage", "topDamage"] },
  { id: "rewards", label: "Items and Rewards", properties: ["pickupType", "effects", "grantStats", "tags"] },
  { id: "messaging", label: "Text and Messaging", properties: ["hint", "signMessage", "signHtml", "deathMessage", "pickupMessage", "logKind", "logHtml"] }
];

const property = (category, type, initialValue, runtimeDefault, status, description, options = {}) => ({
  category,
  type,
  initialValue,
  runtimeDefault,
  status,
  description,
  ...options
});

export const TILE_PROPERTY_DEFINITIONS = {
  solid: property("physics", "boolean", false, "false unless exit is true", ACTIVE,
    "Blocks movement when true. Checked when the engine resolves collision; exit tiles are treated as non-solid. Allowed values: true or false."),
  gravity: property("physics", "boolean", true, "true", ACTIVE,
    "Allows gravity to affect the tile when present. Read while resolving tile physics. Allowed values: true or false; fallDamageCancel also depends on solidity and gravity."),
  bounce: property("physics", "number", 0, "0", ACTIVE,
    "Sets the bounce height when the player lands on this tile. Read on landing. Allowed values: finite numbers; zero disables bounce."),
  slope: property("physics", "enum", "left", "null", ACTIVE,
    "Selects the slope direction used by slope-aware map collision. Read by slope-aware collision. Allowed values: left or right.", { choices: ["left", "right"] }),
  fallDamageCancel: property("physics", "boolean", false, "true for non-solid non-gravity tiles; otherwise false", ACTIVE,
    "Prevents fall damage when landing on this tile. Read on landing after the fall threshold check. Explicit values override the fallback derived from solid and gravity."),

  moveCost: property("movement", "number", 1, "1 when no specific movement cost is supplied", ACTIVE,
    "Legacy shared movement cost used as a fallback for top and inside costs. Read during movement-cost calculation. Allowed values: finite numbers; specific costs take precedence."),
  moveCostTop: property("movement", "number", 1, "moveCost or 1", ACTIVE,
    "Movement-point cost for entering this tile from above. Read during movement. Allowed values: finite numbers; overrides moveCost for top entry."),
  moveCostInside: property("movement", "number", 1, "insideMoveCost, then moveCost, then 1", ACTIVE,
    "Movement-point cost for entering this tile while in fluid. Read during movement. Allowed values: finite numbers; overrides insideMoveCost and moveCost."),
  insideMoveCost: property("movement", "number", 1, "moveCost or 1", COMPATIBILITY,
    "Compatibility alias used as the inside-cost fallback. Read only when moveCostInside is absent. Allowed values: finite numbers."),

  insideDamage: property("hazards", "object", { amount: 0, when: "instant" }, "{ amount: 0, when: 'instant' }", ACTIVE,
    "Damage amount applied during inside-tile hazard checks. The current handler reads amount; when is preserved as text but has no confirmed effect."),
  topDamage: property("hazards", "object", { amount: 0, when: "stand" }, "{ amount: 0, when: 'stand' }", ACTIVE,
    "Damage amount applied during top-tile hazard checks. The current handler reads amount; when is preserved as text but has no confirmed effect."),
  fallDamageThreshold: property("hazards", "number", 3, "3", ACTIVE,
    "Minimum fall distance that can cause damage on landing. Read when landing on a tile that does not cancel fall damage. Allowed values: finite numbers."),
  fallDamageMultiplier: property("hazards", "number", 1, "1", ACTIVE,
    "Damage amount applied for a qualifying fall. Read with fallDamageThreshold; values at or below zero prevent fall damage. Allowed values: finite numbers."),

  pickupType: property("rewards", "enum", "diamond", "no pickup type", ACTIVE,
    "Selects a built-in pickup reward behavior when the tile is collected. Allowed values are diamond, turbo, heart, and dead; effects can add separate rewards.", { choices: ["diamond", "turbo", "heart", "dead"] }),
  effects: property("rewards", "array", [], "[]", ACTIVE,
    "Applies extra reward effects when the tile is collected. Evaluated by the pickup effect handler. Each row is an effect object with a supported type such as counter, xp, heart, score, message, or setFlag."),
  grantStats: property("rewards", "object", {}, "no stat grants", ACTIVE,
    "Adds the listed amounts to player stats when the tile is collected. Evaluated with pickup rewards. Values must be finite numbers; stat names are custom identifiers."),
  tags: property("rewards", "array", [], "[]", ACTIVE,
    "Adds tags to the tile context for game and event checks. Evaluated when tile tags are queried. Values are sanitized strings; remove all rows to store an empty array."),

  hint: property("text", "multiline", "", "no hint", ACTIVE,
    "Displays contextual hint text for the tile. Evaluated when the player requests tile help. Accepts text or a variant-to-text object."),
  signMessage: property("text", "multiline", "", "no sign message", ACTIVE,
    "Provides plain-text content for sign tiles. Evaluated when sign content is requested. Accepts text or a variant-to-text object; signHtml takes precedence."),
  signHtml: property("text", "multiline", "", "no HTML sign content", ACTIVE,
    "Provides HTML content for sign tiles. Evaluated before signMessage when sign content is requested. Accepts text or a variant-to-text object; runtime sanitization still applies."),
  deathMessage: property("text", "multiline", "", "no custom death message", ACTIVE,
    "Overrides the death message associated with this tile. Read when tile damage or a fall causes death. pickupMessage takes precedence for pickup feedback."),
  pickupMessage: property("text", "multiline", "", "no custom pickup message", ACTIVE,
    "Displays custom feedback when this tile is collected. Evaluated by pickup handling; logHtml controls whether supported markup is permitted."),
  logKind: property("text", "text", "", "runtime-selected message kind", ACTIVE,
    "Sets the message-log category for tile-generated text. Read when tile messages are added; empty uses the runtime-selected kind."),
  logHtml: property("text", "boolean", false, "false", ACTIVE,
    "Allows supported HTML formatting in tile-generated log messages. Read when pickup and log messages are rendered; it does not bypass the runtime sanitizer."),

  svg: property("artwork", "svg", "", "no tile image", ACTIVE,
    "Stores the tile's SVG artwork source. Loaded to create tile artwork used by the catalog and map renderer. Must be well-formed SVG; original source is retained unless edited."),

  jumpAllowed: property("advanced", "boolean", true, "not read by current gameplay engine", UNCONFIRMED,
    "Accepted by tile validation, but no current gameplay read is confirmed. It is preserved for compatibility and has no confirmed effect. Allowed values: true or false."),
  sinkSpeed: property("advanced", "number", 0, "not read by current gameplay engine", UNCONFIRMED,
    "Accepted by tile validation, but no current gameplay read is confirmed. It is preserved for compatibility and has no confirmed effect. Allowed values: finite numbers."),
  riseSpeed: property("advanced", "number", 0, "not read by current gameplay engine", UNCONFIRMED,
    "Accepted by tile validation, but no current gameplay read is confirmed. It is preserved for compatibility and has no confirmed effect. Allowed values: finite numbers."),
  autoPush: property("advanced", "text", "", "not read by current gameplay engine", UNCONFIRMED,
    "The runtime normalizes this field but has no confirmed gameplay read for it. It is preserved for compatibility and has no confirmed effect. Allowed value type: string identifier or omitted."),
};

export function getTilePropertyStatusLabel(status) {
  if (status === ACTIVE) return "Active gameplay property";
  if (status === COMPATIBILITY) return "Compatibility property";
  return "No confirmed gameplay effect";
}

export function getTilePropertyInitialValue(name, context = {}) {
  const metadata = TILE_PROPERTY_DEFINITIONS[name];
  if (!metadata) return "";
  if (name === "moveCostTop") return context.moveCost || 1;
  if (name === "moveCostInside") return context.insideMoveCost || context.moveCost || 1;
  if (name === "insideMoveCost") return context.moveCost || 1;
  if (name === "fallDamageCancel") {
    const solid = context.exit === true ? false : context.solid === true;
    return !solid && context.gravity === false;
  }
  return structuredCloneSafe(metadata.initialValue);
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}