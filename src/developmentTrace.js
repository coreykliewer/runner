// Diagnostic storage only: gameplay batches and dispatcher callbacks remain the owners.
export function developmentTraceEnabled(location) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
    new URLSearchParams(location.search).get("runnerTrace") === "1";
}

export function createDevelopmentTrace({ limit = 2000 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Trace limit must be a positive integer.");
  const records = [];
  let sequence = 0;
  let dropped = 0;
  return Object.freeze({
    record(record) {
      const copy = JSON.parse(JSON.stringify(record));
      records.push(freeze({ ...copy, traceSequence: ++sequence }));
      if (records.length > limit) { records.shift(); dropped++; }
    },
    snapshot: () => freeze({ dropped, records: records.slice() }),
    clear() { records.length = 0; sequence = 0; dropped = 0; }
  });
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
