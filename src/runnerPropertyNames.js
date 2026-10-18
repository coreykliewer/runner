// Names resolve to existing owners; this module stores no gameplay values.
export const BUILT_IN_PROPERTY_NAMES = Object.freeze(["Hearts", "Diamonds", "XP", "Moves"]);

export function resolvePropertyName(name, version = 3) {
  const canonical = version === 3 && typeof name === "string"
    ? BUILT_IN_PROPERTY_NAMES.find(item => item.toLowerCase() === name.toLowerCase()) : null;
  return { kind: canonical ? "builtin" : "custom", name: canonical || name };
}

export function validateBuiltInValues(values, path = "nativeValues") {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return [{ severity: "error", path, code: "native_snapshot_required", message: "Version 3 requires an explicit snapshot of all four built-in values." }];
  }
  const diagnostics = [];
  for (const name of BUILT_IN_PROPERTY_NAMES) {
    if (!Object.hasOwn(values, name) || !Number.isFinite(values[name]) || (name !== "Hearts" && values[name] < 0) ||
        (name === "Moves" && !Number.isSafeInteger(values[name]))) {
      diagnostics.push({ severity: "error", path: `${path}.${name}`, code: "invalid_native_value",
        message: name === "Moves" ? "Moves must be a non-negative safe integer from the dice owner."
          : `${name} must be finite${name === "Hearts" ? "" : " and non-negative"}; fractions are preserved.` });
    }
  }
  for (const name of Object.keys(values)) if (!BUILT_IN_PROPERTY_NAMES.includes(name)) {
    diagnostics.push({ severity: "error", path: `${path}.${name}`, code: "unknown_native_value", message: "Native snapshots use the four canonical names only." });
  }
  return diagnostics;
}

export function readBuiltInProperties(runner, { getRemainingMoves } = {}) {
  if (typeof getRemainingMoves !== "function") throw new TypeError("An authoritative remaining-moves reader is required.");
  const values = { Hearts: runner?.hearts, Diamonds: runner?.score, XP: runner?.xp ?? 0, Moves: getRemainingMoves() };
  const issues = validateBuiltInValues(values);
  if (issues.length) throw new TypeError(issues.map(issue => issue.message).join(" "));
  return Object.freeze(values);
}

// Report collisions only; never rename references or transfer stored values.
export function findReservedPropertyCollisions(rules, properties = {}) {
  const collisions = [];
  const inspect = (property, path) => {
    const resolved = resolvePropertyName(property);
    if (resolved.kind === "builtin") collisions.push({ severity: "error", path, code: "reserved_property_collision",
      property, canonicalName: resolved.name,
      message: `Legacy custom property '${property}' conflicts with ${resolved.name}. Rename it explicitly before using version 3; no value was transferred.` });
  };
  if ([1, 2].includes(rules?.version) && Array.isArray(rules.blocks)) rules.blocks.forEach((block, index) => {
    if (block?.if) inspect(block.if.property, `propertyRules.blocks[${index}].if.property`);
    if (Array.isArray(block?.then)) block.then.forEach((effect, effectIndex) => {
      // Future instructions are preserved, not guessed at during migration.
      if (rules.version === 1 || effect?.type === "property") inspect(effect?.property, `propertyRules.blocks[${index}].then[${effectIndex}].property`);
    });
  });
  if (properties && typeof properties === "object") for (const name of Object.keys(properties)) inspect(name, `properties[${JSON.stringify(name)}]`);
  return collisions;
}
