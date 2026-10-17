import { createDefaultEncounterRules } from "./encounterRules.js";

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
  { id: "messaging", label: "Text and Messaging", properties: ["hint", "signMessage", "signHtml", "deathMessage", "pickupMessage", "logKind", "logHtml"] },
  { id: "encounters", label: "Encounter Rules", properties: ["encounterRules"] },
  { id: "propertyRules", label: "Property Rules", properties: ["propertyRules"] }
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
    "Blocks movement when enabled and supports the player from above. Exit tiles are always enterable. Leave off for pass-through tiles such as pickups and hazards intended to be walked over.", { label: "Solid (blocks movement)" }),
  gravity: property("physics", "boolean", true, "true", ACTIVE,
    "Allows gravity to affect the player while in this tile. Set false for fluid-like spaces; this also changes the default fall-damage cancellation behavior.", { label: "Gravity affects this tile" }),
  bounce: property("physics", "number", 0, "0", ACTIVE,
    "Sets the bounce height when the player lands on this tile. Zero disables bounce; use a finite number greater than zero for a bounce.", { label: "Landing bounce height" }),
  slope: property("physics", "enum", "left", "null", ACTIVE,
    "Selects the direction used by slope-aware map collision. Choose left or right; omit the property for a tile without slope behavior.", { choices: ["left", "right"], label: "Slope direction" }),
  fallDamageCancel: property("physics", "boolean", false, "true for non-solid non-gravity tiles; otherwise false", ACTIVE,
    "Prevents fall damage when landing on this tile. An explicit value overrides the fallback, which is true for non-solid, non-gravity tiles and false otherwise.", { label: "Cancel fall damage" }),

  moveCost: property("movement", "number", 1, "1 when no specific movement cost is supplied", ACTIVE,
    "Shared fallback cost in movement points. A top-entry or inside-entry cost takes precedence when present.", { label: "Shared movement cost" }),
  moveCostTop: property("movement", "number", 1, "moveCost or 1", ACTIVE,
    "Movement points spent when entering this tile from above. Overrides the shared movement cost.", { label: "Cost to enter from above" }),
  moveCostInside: property("movement", "number", 1, "insideMoveCost, then moveCost, then 1", ACTIVE,
    "Movement points spent when moving into this tile while already in fluid. Overrides the compatibility inside cost and shared movement cost.", { label: "Cost to enter while in fluid" }),
  insideMoveCost: property("movement", "number", 1, "moveCost or 1", COMPATIBILITY,
    "Compatibility alias used only when the inside-entry cost is absent. Prefer moveCostInside for new tiles.", { label: "Legacy inside movement cost" }),

  insideDamage: property("hazards", "object", { amount: 0, when: "instant" }, "{ amount: 0, when: 'instant' }", ACTIVE,
    "Damage applied while the player occupies this tile. The current handler reads amount; when is retained but has no confirmed effect.", { label: "Damage while inside" }),
  topDamage: property("hazards", "object", { amount: 0, when: "stand" }, "{ amount: 0, when: 'stand' }", ACTIVE,
    "Damage applied while standing on this tile. The current handler reads amount; when is retained but has no confirmed effect.", { label: "Damage while standing on tile" }),
  fallDamageThreshold: property("hazards", "number", 3, "3", ACTIVE,
    "Minimum fall distance required before landing damage applies on a tile that does not cancel it.", { label: "Minimum fall distance" }),
  fallDamageMultiplier: property("hazards", "number", 1, "1", ACTIVE,
    "Damage applied for a qualifying fall. Values at or below zero prevent fall damage.", { label: "Fall damage amount" }),

  pickupType: property("rewards", "enum", "diamond", "no pickup type", ACTIVE,
    "Selects the built-in reward when the tile is collected. Extra rewards can be added with effects.", { choices: ["diamond", "turbo", "heart", "dead"], label: "Pickup reward type" }),
  effects: property("rewards", "array", [], "[]", ACTIVE,
    "Extra rewards applied when this tile is collected. Supported effect types include counter, xp, heart, score, message, and setFlag.", { label: "Additional pickup effects" }),
  grantStats: property("rewards", "object", {}, "no stat grants", ACTIVE,
    "Adds the listed amounts to player stats when the tile is collected. Values must be finite numbers; stat names are custom identifiers.", { label: "Stats granted on pickup" }),
  tags: property("rewards", "array", [], "[]", ACTIVE,
    "Adds labels to the tile context for gameplay and event checks. Values are sanitized strings.", { label: "Gameplay tags" }),

  hint: property("text", "multiline", "", "no hint", ACTIVE,
    "Text shown when the player requests help about this tile. Can be plain text or variant-specific text.", { label: "Inspection hint" }),
  signMessage: property("text", "multiline", "", "no sign message", ACTIVE,
    "Plain-text content shown for a sign. Variant-specific text is supported; signHtml takes precedence when present.", { label: "Sign text" }),
  signHtml: property("text", "multiline", "", "no HTML sign content", ACTIVE,
    "HTML content shown for a sign. Variant-specific content is supported and runtime sanitization still applies.", { label: "Sign HTML" }),
  deathMessage: property("text", "multiline", "", "no custom death message", ACTIVE,
    "Overrides the message shown when this tile causes death.", { label: "Death message" }),
  pickupMessage: property("text", "multiline", "", "no custom pickup message", ACTIVE,
    "Feedback shown when this tile is collected. logHtml controls whether supported markup is permitted.", { label: "Pickup message" }),
  logKind: property("text", "text", "", "runtime-selected message kind", ACTIVE,
    "Sets the message-log category for text generated by this tile. Empty uses the runtime-selected category.", { label: "Message category" }),
  logHtml: property("text", "boolean", false, "false", ACTIVE,
    "Allows supported HTML formatting in tile-generated messages. Runtime sanitization still applies.", { label: "Allow HTML in messages" }),

  svg: property("artwork", "svg", "", "no tile image", ACTIVE,
    "SVG artwork shown in the tile catalog and map. The original source is retained unless edited; invalid SVG is not used for rendering.", { label: "SVG artwork" }),

  jumpAllowed: property("advanced", "boolean", true, "not read by current gameplay engine", UNCONFIRMED,
    "Accepted and preserved, but no current gameplay effect is confirmed.", { label: "Jumping allowed" }),
  sinkSpeed: property("advanced", "number", 0, "not read by current gameplay engine", UNCONFIRMED,
    "Accepted and preserved, but no current gameplay effect is confirmed.", { label: "Sink speed" }),
  riseSpeed: property("advanced", "number", 0, "not read by current gameplay engine", UNCONFIRMED,
    "Accepted and preserved, but no current gameplay effect is confirmed.", { label: "Rise speed" }),
  autoPush: property("advanced", "text", "", "not read by current gameplay engine", UNCONFIRMED,
    "The runtime normalizes this identifier, but no current gameplay effect is confirmed.", { label: "Auto-push target" }),
  encounterRules: property("advanced", "object", createDefaultEncounterRules(), "disabled", ACTIVE,
    "Optional, reusable trigger-condition-action rules for this tile. No encounter behavior runs unless enabled.", { label: "Encounter rules" }),
  propertyRules: property("advanced", "object", { version: 1, blocks: [] }, "no entry effects", ACTIVE,
    "Ordered Runner property changes on successful tile entry, including movement and gravity. IF reads the entry snapshot.", { label: "Property rules" }),
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
