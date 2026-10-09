export function resolveExitDestination(levelFile, currentLevelKey, exitVariant) {
  const levels = levelFile?.levels || {};
  const level = levels[currentLevelKey];
  if (!level || !exitVariant) return null;

  if (level.exits && Object.hasOwn(level.exits, exitVariant)) {
    const destination = level.exits[exitVariant];
    return typeof destination === "string" && levels[destination] ? destination : null;
  }

  return levels[exitVariant] ? exitVariant : null;
}