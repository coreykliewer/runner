const RESUME_FORMAT = "runner.resume-state";
const RESUME_VERSION = 2;
export const RESUME_URL_TARGET_BYTES = 8 * 1024;

export async function encodeResumeStateV2(state, {
  baseUrl = "index.html",
  maxUrlLength = RESUME_URL_TARGET_BYTES
} = {}) {
  if (!Number.isSafeInteger(maxUrlLength) || maxUrlLength < 1) throw new TypeError("maxUrlLength must be a positive safe integer.");
  const envelope = { format: RESUME_FORMAT, version: RESUME_VERSION, state };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(envelope));
  const compressedBytes = await gzip(jsonBytes);
  const payload = encodeBase64Url(compressedBytes);
  const base = String(baseUrl || "index.html").split("#")[0];
  const url = `${base}#resumev=${RESUME_VERSION}&payload=${payload}`;
  if (new TextEncoder().encode(url).byteLength <= maxUrlLength) {
    return { delivery: "url", url, encodedBytes: new TextEncoder().encode(url).byteLength };
  }
  return {
    delivery: "download",
    filename: "runner-resume-v2.json.gz",
    mimeType: "application/gzip",
    bytes: compressedBytes,
    encodedBytes: compressedBytes.byteLength
  };
}

export async function decodeResumePayloadV2(payload) {
  const compressedBytes = typeof payload === "string" ? decodeBase64Url(payload) : toBytes(payload);
  let envelope;
  try {
    const jsonBytes = await gunzip(compressedBytes);
    envelope = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch (error) {
    throw new Error(`Invalid compressed Runner resume payload: ${error.message}`);
  }
  if (envelope?.format !== RESUME_FORMAT || envelope.version !== RESUME_VERSION || !Object.hasOwn(envelope, "state")) {
    throw new Error(`Unsupported Runner resume payload version '${envelope?.version}'.`);
  }
  return envelope.state;
}

async function gzip(bytes) {
  if (typeof CompressionStream !== "function" || typeof Blob !== "function" || typeof Response !== "function") {
    throw new Error("Gzip compression streams are not available in this environment.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  if (typeof DecompressionStream !== "function" || typeof Blob !== "function" || typeof Response !== "function") {
    throw new Error("Gzip decompression streams are not available in this environment.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : globalThis.Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  if (typeof atob === "function") return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  return new Uint8Array(globalThis.Buffer.from(base64, "base64"));
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("Resume payload must be a base64url string, Uint8Array, or ArrayBuffer.");
}