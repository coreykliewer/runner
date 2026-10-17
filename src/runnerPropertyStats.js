// Read the authoritative map on every render; acquired zero remains a stat.
export function getRunnerPropertyStats(properties) {
  return Object.entries(properties || {})
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

export function appendRunnerPropertyStats(container, properties) {
  const document = container.ownerDocument;
  for (const [name, value] of getRunnerPropertyStats(properties)) {
    const row = document.createElement("span");
    row.className = "runner-property-stat";
    row.dataset.property = name;
    row.textContent = `${name}: ${value}`;
    container.append(document.createElement("br"), row);
  }
}
