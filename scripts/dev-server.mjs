import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.argv[2] || 8000);
const encounterPlaytest = process.argv.includes("--encounter-playtest")
  ? (await import("../fixtures/encounter-playtest.js")).createEncounterPlaytest(
    JSON.parse(await readFile(join(root, "tiles2.legacy.json"), "utf8"))) : null;

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml"
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const pathname = urlPath === "/" ? "/index.html" : urlPath;
    const fixture = encounterPlaytest && ({ "/tiles2.json": encounterPlaytest.registry, "/levels.json": encounterPlaytest.levels })[pathname];
    if (fixture) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(fixture));
      return;
    }
    const filePath = resolve(join(root, pathname));

    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    let body = await readFile(filePath);
    if (encounterPlaytest && pathname === "/index.html") {
      body = body.toString().replace('<script src="game.js"></script>',
        '<script src="fixtures/encounter-playtest-boot.js"></script><script src="game.js"></script>');
    }
    res.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Runner dev server: http://127.0.0.1:${port}/`);
  if (encounterPlaytest) console.log(`Encounter fixture: http://127.0.0.1:${port}/?runnerTrace=1&fog=off (fixed rolls; separate from production catalogs)`);
});
