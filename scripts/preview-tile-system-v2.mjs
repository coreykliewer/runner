import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { previewAuthoredMigrationV1ToV2 } from "../src/tileSystemMigrationPreview.js";

const args = process.argv.slice(2);
if (args.includes("--apply") || args.includes("--write")) {
  console.error("This command is preview-only and never writes authored content.");
  process.exit(2);
}

const valueFor = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const registryPath = resolve(valueFor("--registry", "tiles2.json"));
const levelsPath = resolve(valueFor("--levels", "levels.json"));
const manifestPath = valueFor("--manifest", null);

const registry = await readJson(registryPath);
const levels = await readJson(levelsPath);
const manifest = manifestPath ? await readJson(resolve(manifestPath)) : null;
const report = previewAuthoredMigrationV1ToV2(registry, levels, {
  manifest,
  sourceKey: `${relative(process.cwd(), registryPath)}|${relative(process.cwd(), levelsPath)}`
});
console.log(JSON.stringify(report, null, 2));
if (report.diagnostics.some(issue => issue.severity === "error")) process.exitCode = 1;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    console.error(`Unable to read JSON document '${path}': ${error.message}`);
    process.exit(1);
  }
}