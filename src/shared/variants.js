export const VARIANT_BUCKETS = [
  "monster",
  "lock",
  "sign",
  "exit",
  "platform",
  "pickup",
  "decor",
  "narrative"
];

export function sanitizeVariant(raw, { empty = "" } = {}) {
  if (raw == null) return empty;

  const cleaned = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 12);

  return cleaned || empty;
}

export function getVariantBucketEntry(baseDef, variant, bucketOrder = VARIANT_BUCKETS) {
  const key = sanitizeVariant(variant);
  if (!baseDef || !key) return null;

  for (const bucket of bucketOrder) {
    const group = baseDef[bucket];
    if (group && typeof group === "object" && group[key]) {
      return {
        bucket,
        key,
        entry: group[key]
      };
    }
  }

  return null;
}

export function mergeVariantDef(baseDef, variant, bucketOrder = VARIANT_BUCKETS) {
  const match = getVariantBucketEntry(baseDef, variant, bucketOrder);
  return {
    baseDef: baseDef || {},
    variant: sanitizeVariant(variant),
    variantBucket: match ? match.bucket : null,
    variantDef: match ? match.entry : null,
    def: {
      ...(baseDef || {}),
      ...(match ? match.entry : {})
    }
  };
}
