import { encodeCarryStatsFromRunner } from "./state.js";

export function createResumeHash({ map, runner, fog = null, level = null } = {}) {
  const params = [];

  if (map) params.push(`map=${encodeURIComponent(map)}`);
  if (runner) params.push(`st=${encodeURIComponent(encodeCarryStatsFromRunner(runner))}`);
  if (level) params.push(`level=${encodeURIComponent(level)}`);
  if (fog === false) params.push("fog=off");

  return params.length ? `#${params.join("&")}` : "";
}

export function createResumeUrl(baseUrl, options = {}) {
  const hash = createResumeHash(options);
  const cleanBase = String(baseUrl || "index.html").split("#")[0];
  return `${cleanBase}${hash}`;
}

export function createLocalResumeHash() {
  return "#resume=1";
}

export function createLocalResumeUrl(baseUrl = "index.html") {
  const cleanBase = String(baseUrl || "index.html").split("#")[0];
  return `${cleanBase}${createLocalResumeHash()}`;
}
