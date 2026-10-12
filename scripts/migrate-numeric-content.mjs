import { constants } from "node:fs";
import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import { isNumericTileRegistry, migrateLegacyTileDefinitions } from "../src/numericTileRegistry.js";
import { decodeMapToNumeric } from "../src/tileCompatibility.js";

const tilePath = new URL("../tiles2.json", import.meta.url);
const levelPath = new URL("../levels.json", import.meta.url);
const tileBackupPath = new URL("../tiles2.legacy.json", import.meta.url);
const levelBackupPath = new URL("../levels.legacy.json", import.meta.url);
const apply = process.argv.includes("--apply");

const hasLegacyBackup = await fileExists(tileBackupPath);
const currentTiles = hasLegacyBackup ? null : await readJson(tilePath);
if (isNumericTileRegistry(currentTiles)) {
  throw new Error("tiles2.json is already numeric, but its legacy backup is missing; refusing to migrate without a source backup.");
}
const legacyTiles = hasLegacyBackup ? await readJson(tileBackupPath) : currentTiles;
const levels = await readJson(levelPath);
const registry = migrateLegacyTileDefinitions(legacyTiles);
const unresolved = [];
const convertedLevels = structuredClone(levels);

for (const [levelId, level] of Object.entries(convertedLevels.levels || {})) {
  try {
    const numericMap = decodeMapToNumeric(level.map, registry);
    if (!numericMap.spawn) unresolved.push(`${levelId}: map has no R spawn marker`);
    level.map = numericMap;
  } catch (error) {
    unresolved.push(`${levelId}: ${error.message}`);
  }
}

if (unresolved.length) {
  console.error("Numeric migration preview found unresolved content:");
  for (const issue of unresolved) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    mode: apply ? "apply" : "preview",
    tileCount: registry.tiles.length,
    nextTileId: registry.nextTileId,
    legacyCodes: Object.keys(registry.legacyIdMapping).length,
    levels: Object.entries(convertedLevels.levels || {}).map(([id, level]) => ({
      id,
      width: level.map.width,
      height: level.map.height,
      spawn: level.map.spawn
    }))
  }, null, 2));

  if (apply) {
    if (!await fileExists(tileBackupPath)) await copyFile(tilePath, tileBackupPath, constants.COPYFILE_EXCL);
    if (!await fileExists(levelBackupPath)) await copyFile(levelPath, levelBackupPath, constants.COPYFILE_EXCL);
    await Promise.all([
      writeFile(tilePath, `${JSON.stringify(registry, null, 2)}\n`),
      writeFile(levelPath, `${JSON.stringify(convertedLevels, null, 2)}\n`)
    ]);
    console.log("Updated the single numeric tiles2.json catalog and preserved legacy backups.");
  } else {
    console.log("Preview only. Pass --apply to write the numeric registry/maps and legacy backups.");
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function fileExists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}
