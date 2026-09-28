// Exercise names are compared through a normalized key so trivial variations
// (case, extra whitespace, hyphen vs space, apostrophes) resolve to the same
// exercise. Search queries go through the same normalization.
//
// Deliberately NOT handled in V1: spelling variants ("Pushup" vs "Push-Up"),
// stemming, aliases or fuzzy matching.

/** Display form: Unicode-normalized, trimmed, internal whitespace collapsed. Casing is kept. */
export function toDisplayName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Lookup/dedupe key: lowercase, apostrophes removed, hyphens/underscores as spaces. */
export function toNormalizedName(value: string): string {
  return toDisplayName(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable seed key for built-in exercises, e.g. "Farmer’s Carry" -> "farmers-carry". */
export function toBuiltInKey(value: string): string {
  return toNormalizedName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
